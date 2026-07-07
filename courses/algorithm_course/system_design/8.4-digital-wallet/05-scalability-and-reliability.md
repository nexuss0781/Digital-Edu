# Scalability & Reliability

## Scaling Strategy Overview

The digital wallet system scales along two primary axes: **write throughput** (ledger entries at 57,870 peak writes/sec) and **wallet count** (500M registered wallets). The ledger is the critical Slowest part of the process---every transaction creates 2-3 ledger entries that must be durably written with strong consistency. The scaling strategy centers on **horizontal sharding by wallet ID** with co-located ledger entries, ensuring that same-shard operations (the majority of transactions) execute as single ACID transactions.

---

## Wallet Sharding Strategy

### Shard Key: Wallet ID

```
Sharding scheme: Consistent hash of wallet_id → shard assignment
Number of shards: 16 (initial), expandable to 64

Shard distribution:
  500M wallets / 16 shards = ~31M wallets per shard
  200M active wallets / 16 shards = ~12.5M active wallets per shard
  57,870 peak writes/sec / 16 shards = ~3,617 writes/sec per shard
  (well within PostgreSQL capacity of ~15,000 writes/sec with durability)

Co-located on each shard:
  - Wallet records (wallets table)
  - Wallet balances (wallet_balances table)
  - Ledger entries for those wallets (ledger_entries table)
  - Transaction records where source OR destination is on this shard
```

### Why Wallet ID (Not User ID)?

```
User ID sharding would co-locate a user's wallet with their profile,
but P2P transfers between users on different shards would ALWAYS be cross-shard.

Wallet ID sharding:
  - Co-locates wallet + its ledger entries → single-shard balance checks
  - Same-shard P2P possible when sender and receiver hash to same shard
  - System accounts (escrow, fee) can be placed on specific shards
```

### Shard-Aware Routing

```
FUNCTION routeToShard(walletId):
    shardIndex = consistentHash(walletId) MOD numShards
    RETURN shardConnections[shardIndex]

For P2P transfers:
    senderShard = routeToShard(senderWalletId)
    receiverShard = routeToShard(receiverWalletId)
    IF senderShard == receiverShard:
        executeSameShardTransfer()   // single ACID transaction
    ELSE:
        executeCrossShardTransfer()  // saga pattern
```

### Resharding Strategy

```
When a shard becomes hot or total capacity is reached:

1. Double-shard expansion: 16 → 32 shards
2. Use logical sharding (virtual shards) mapped to physical shards:
   - 256 virtual shards → 16 physical shards (16 virtual per physical)
   - To expand: reassign virtual shards to new physical shards
   - Only affected virtual shards need data migration

3. Online migration:
   a. Set up new shard with replication from source
   b. Enable dual-write: new transactions go to both old and new shard
   c. Backfill historical data
   d. Switch read traffic to new shard
   e. Stop writing to old shard for migrated wallets
   f. Clean up old shard

4. Zero-downtime: dual-write phase ensures no transaction is lost

Key constraint: during migration, cross-shard P2P transfers involving
migrating wallets must be paused (queued) to prevent saga inconsistency.
Migration window per virtual shard: ~15 minutes for 2M wallets.
```

### Locality-Aware Shard Optimization

```
Problem: ~38% of P2P transfers cross shard boundaries, adding saga latency.
Opportunity: frequent transfer pairs can be co-located on the same shard.

Approach:
1. Build P2P social graph: edges weighted by transfer frequency
2. Graph partitioning algorithm: minimize cross-shard edges while
   maintaining balanced shard sizes
3. Periodically (monthly) identify top 10% frequent pairs that are cross-shard
4. During resharding, prioritize co-locating frequent pairs

Expected improvement:
  - Without optimization: ~38% cross-shard
  - With social graph optimization: ~20% cross-shard
  - Reduces saga volume by ~47%, improving p99 latency
```

---

## Ledger Partitioning

### Time-Based Partitioning Within Shards

```
Each shard's ledger_entries table is partitioned by time:

ledger_entries_2025_03     (current month - hot)
ledger_entries_2025_02     (last month - warm)
ledger_entries_2025_01     (2 months ago - warm)
ledger_entries_2024_Q4     (quarterly - cold)
ledger_entries_2024_Q3     (quarterly - cold)
...
ledger_entries_archive     (7+ years - cold storage)

Benefits:
  - Hot partition is small → fast inserts, fits in buffer pool
  - Old partitions can be moved to cheaper storage
  - DROP PARTITION for data beyond retention (7 years) is instant vs. DELETE
  - Reconciliation runs per-partition in parallel
```

### Ledger Storage Tiers

```
Hot (0-90 days):
  Storage: NVMe SSD on primary DB servers
  Access pattern: frequent reads (transaction history, balance computation)
  Size per shard: 9 TB / 16 shards ≈ 562 GB per shard

Warm (90 days - 1 year):
  Storage: SSD-backed read replicas
  Access pattern: occasional reads (statement generation, dispute investigation)
  Size per shard: ~2.3 TB per shard

Cold (1-7 years):
  Storage: Compressed, columnar format in object storage
  Access pattern: rare reads (audit, regulatory inquiry)
  Total: ~85 TB compressed
  Access: Query via analytical engine (batch, not real-time)
```

---

## Read Replicas for Balance Queries

### Read Path Optimization

```
Balance queries: ~50,000/sec (2x transaction rate)
  → Cannot all hit primary database (would compete with writes)

Architecture:
  Primary DB (per shard): handles all writes (transactions, ledger entries)
  Read Replica 1: balance queries, transaction history
  Read Replica 2: balance queries, transaction history (load balanced)
  Read Replica 3: analytics, reconciliation, reporting

Replication lag:
  Synchronous replication to Replica 1: 0ms lag (used for balance after write)
  Asynchronous to Replicas 2-3: < 100ms lag (acceptable for browsing)

Balance read routing:
  After a write: read from primary or sync replica (read-your-own-writes)
  Normal app open: read from any replica (eventual consistency OK for display)
```

### Balance Cache Layer

```
Redis caches materialized balances:
  Key: "bal:{wallet_id}" → {available: 15000, held: 0, promotional: 500}
  TTL: none (updated on every transaction)
  Invalidation: write-through (update cache in same flow as DB write)

Cache hit rate: ~95% for balance queries
Cache miss: query read replica, populate cache

Consistency guarantee:
  Cache is updated AFTER DB commit (not before)
  If cache update fails: cache entry is deleted → next read hits DB
  Periodic reconciliation: compare cache vs DB for sampled wallets
```

---

## Multi-Region Architecture

### Active-Passive for Financial Transactions

```
Region A (Primary): All writes (transactions, ledger entries, balance updates)
Region B (DR): Synchronous standby for critical data, async for non-critical

Why not active-active for writes:
  - Ledger consistency requires serialized writes per wallet
  - Two regions accepting writes for the same wallet = split-brain risk
  - Financial regulators require provable transaction ordering

Failover:
  - Automatic health check: every 5 seconds
  - Detection threshold: 3 consecutive failures
  - Failover time: < 30 seconds (DNS TTL + connection drain)
  - RPO: 0 (synchronous replication for ledger)
  - RTO: < 30 seconds
```

### Active-Active for Read Operations

```
Balance queries and transaction history served from both regions:
  Region A: primary reads + writes
  Region B: read replicas (async replication, < 500ms lag)

User routing:
  Latency-based DNS routes users to nearest region for reads
  Writes always routed to primary region (Region A)
  If Region A fails: Region B promoted to primary

Cross-region replication:
  PostgreSQL streaming replication (synchronous for ledger, async for history)
  Redis cache: independent per region, populated from local DB replica
  Kafka: MirrorMaker for event replication across regions
```

---

## Idempotent Operations

### Why Idempotency Is Critical

```
Scenario: User taps "Send $50" → network timeout → app retries automatically
Without idempotency: two $50 debits → user charged $100
With idempotency: second request returns cached result of first

In financial systems, duplicate processing means real money lost.
```

### Idempotency Implementation

```
FUNCTION processWithIdempotency(idempotencyKey, operation):
    // Step 1: Check if already processed
    cached = redis.get("idem:" + idempotencyKey)
    IF cached:
        response = deserialize(cached)
        response.idempotent_replay = true
        RETURN response

    // Step 2: Acquire processing lock (prevent concurrent duplicates)
    lockAcquired = redis.setnx("idem_lock:" + idempotencyKey, instanceId, TTL=30s)
    IF NOT lockAcquired:
        // Another instance is processing this request
        WAIT 500ms
        RETURN processWithIdempotency(idempotencyKey, operation)  // retry

    TRY:
        // Step 3: Execute the operation
        result = operation.execute()

        // Step 4: Cache the result
        redis.setex("idem:" + idempotencyKey, 86400, serialize(result))
        // 24-hour TTL: client can retry within 24 hours

        RETURN result
    FINALLY:
        redis.del("idem_lock:" + idempotencyKey)


Idempotency key lifecycle:
  Client generates UUID before first request attempt
  Same UUID used for all retries of the same logical operation
  Server caches response for 24 hours
  After 24 hours: key expires, same operation would create a new transaction
```

### Database-Level Idempotency (Belt and Suspenders)

```
The transactions table has a UNIQUE constraint on idempotency_key:
  INSERT INTO transactions (id, idempotency_key, ...) VALUES (...)
  → If duplicate key: unique constraint violation → return existing transaction

This is the last line of defense if Redis cache fails or is unavailable.
```

---

## Reliability Patterns

### Circuit Breaker for External Services

```
External services: bank APIs, card networks, UPI rails, KYC providers

Per-service circuit breaker:
┌───────────────┬────────────┬────────────┬──────────────┐
│ Service       │ Failure    │ Open       │ Half-Open    │
│               │ Threshold  │ Duration   │ Probe Rate   │
├───────────────┼────────────┼────────────┼──────────────┤
│ Partner Bank  │ 5 failures │ 60 seconds │ 1 req / 15s  │
│               │ in 30s     │            │              │
├───────────────┼────────────┼────────────┼──────────────┤
│ Card Network  │ 3 failures │ 30 seconds │ 1 req / 10s  │
│               │ in 15s     │            │              │
├───────────────┼────────────┼────────────┼──────────────┤
│ UPI Rail      │ 5 failures │ 30 seconds │ 1 req / 10s  │
│               │ in 30s     │            │              │
├───────────────┼────────────┼────────────┼──────────────┤
│ KYC Provider  │ 3 failures │ 120 seconds│ 1 req / 30s  │
│               │ in 60s     │            │              │
└───────────────┴────────────┴────────────┴──────────────┘

Fallback strategies:
  Bank down: queue top-ups/withdrawals for retry, wallet-to-wallet still works
  Card network down: suggest alternative payment method (bank transfer, UPI)
  UPI down: suggest card or bank transfer
  KYC provider down: queue KYC submissions, allow continued use at current tier
```

### Transaction Retry with Backoff

```
FUNCTION retryableTransaction(operation, maxRetries=3):
    FOR attempt = 1 TO maxRetries:
        TRY:
            result = operation.execute()
            RETURN result
        CATCH DeadlockException:
            // Database deadlock: safe to retry immediately
            WAIT random(10ms, 50ms)
            CONTINUE
        CATCH SerializationException:
            // Optimistic lock failure: safe to retry
            WAIT random(50ms, 200ms) * attempt
            CONTINUE
        CATCH NetworkException:
            IF attempt < maxRetries:
                WAIT 1000ms * (2 ^ attempt)  // exponential backoff
                CONTINUE
            ELSE:
                THROW TransactionFailedException(operation)

    THROW MaxRetriesExceededException()
```

### Outbox Pattern for Event Reliability

```
Problem: Transaction commits but Kafka event publish fails
  → Notifications not sent, fraud features not updated, reconciliation gaps

Solution: Outbox pattern
  Within the DB transaction:
    INSERT INTO transactions (...)
    INSERT INTO ledger_entries (...)
    INSERT INTO outbox (event_type, payload, status='PENDING')
  COMMIT

  Background poller (every 100ms):
    SELECT * FROM outbox WHERE status = 'PENDING' ORDER BY created_at LIMIT 100
    FOR EACH event:
      kafka.publish(event)
      UPDATE outbox SET status = 'PUBLISHED'

  Guarantee: if transaction commits, event is eventually published.
  Cleanup: DELETE FROM outbox WHERE status = 'PUBLISHED' AND created_at < NOW() - 24h
```

---

## Graceful Degradation

```
Degradation levels based on system health:

Level 0 (Normal): All features available
Level 1 (Elevated): Disable non-critical features
  - Disable scheduled payments
  - Disable bill payments (queue for later)
  - Disable cashback/rewards calculation
  - Core P2P and merchant payments continue

Level 2 (Degraded): Reduce external dependencies
  - Disable top-up from external sources
  - Wallet-to-wallet transfers still work (internal only)
  - Balance queries served from cache (may be slightly stale)
  - Transaction history limited to last 7 days

Level 3 (Minimal): Read-only mode
  - Balance queries only (from cache)
  - No new transactions processed
  - All writes queued for processing when recovered
  - User-facing message: "Service temporarily limited"

Automatic escalation: monitoring triggers level changes based on:
  - Error rate thresholds
  - Latency percentile thresholds
  - External service health
  - Database replication lag
```

---

## Disaster Recovery and Data Protection

### RPO/RTO Targets

```
┌──────────────────────┬─────────┬─────────┬──────────────────────────┐
│ Component            │ RPO     │ RTO     │ Strategy                 │
├──────────────────────┼─────────┼─────────┼──────────────────────────┤
│ Ledger (primary DB)  │ 0       │ < 30s   │ Synchronous replication  │
│                      │         │         │ to standby; auto-failover│
├──────────────────────┼─────────┼─────────┼──────────────────────────┤
│ Balance cache (Redis)│ N/A     │ < 5s    │ Reconstructed from DB on │
│                      │(rebuild)│         │ miss; no data loss risk  │
├──────────────────────┼─────────┼─────────┼──────────────────────────┤
│ Event stream (Kafka) │ 0       │ < 60s   │ Replication factor 3;    │
│                      │         │         │ min.insync.replicas = 2  │
├──────────────────────┼─────────┼─────────┼──────────────────────────┤
│ KYC documents (obj)  │ < 1h    │ < 4h    │ Cross-region replication; │
│                      │         │         │ not on critical path     │
├──────────────────────┼─────────┼─────────┼──────────────────────────┤
│ Fraud feature store  │ < 5min  │ < 10min │ Rebuilt from event stream;│
│ (TSDB + Redis)       │         │         │ fallback to rule-based   │
└──────────────────────┴─────────┴─────────┴──────────────────────────┘
```

### Backup Strategy

```
Continuous:
  - PostgreSQL WAL archiving to object storage (point-in-time recovery)
  - Kafka topic mirroring to DR region

Daily:
  - Full logical backup of wallet + transaction tables (encrypted)
  - KYC document snapshot verification

Weekly:
  - Backup restoration drill (randomly selected shard)
  - Verify restored data passes reconciliation checks

Monthly:
  - Full DR failover test (read traffic only)
  - Verify RPO/RTO targets met under realistic load
```

---

## Auto-Scaling Triggers

```
Scale-Up Triggers:
┌─────────────────────────┬────────────────┬──────────────────────────┐
│ Signal                  │ Threshold      │ Action                   │
├─────────────────────────┼────────────────┼──────────────────────────┤
│ Transaction TPS         │ > 70% capacity │ Add read replicas; warm  │
│                         │ for 5 minutes  │ standby DB instances     │
├─────────────────────────┼────────────────┼──────────────────────────┤
│ API latency p99         │ > 1.5x SLO    │ Scale service pods       │
│                         │ for 3 minutes  │ horizontally             │
├─────────────────────────┼────────────────┼──────────────────────────┤
│ Kafka consumer lag      │ > 50K messages │ Add consumer instances   │
│                         │ for 5 minutes  │                          │
├─────────────────────────┼────────────────┼──────────────────────────┤
│ Redis memory            │ > 80%          │ Scale Redis cluster      │
│                         │                │ (add shards)             │
├─────────────────────────┼────────────────┼──────────────────────────┤
│ Fraud scoring latency   │ > 80ms p99     │ Scale inference pods;    │
│                         │ for 2 minutes  │ activate rule-only mode  │
└─────────────────────────┴────────────────┴──────────────────────────┘

Pre-Scaling Events (scheduled):
  - Festival/holiday: pre-warm 3x capacity 24h before
  - Salary day (1st, 15th): pre-warm 2x capacity at midnight
  - Flash sale partnerships: coordinate with merchant for expected TPS
```

---

## Load Testing and Capacity Planning

```
Load test scenarios:
1. Normal load: 2,315 TPS sustained for 24 hours
2. Peak load: 23,150 TPS sustained for 2 hours
3. Festival spike: 50,000 TPS burst for 15 minutes
4. Hot wallet: single merchant receiving 5,000 TPS
5. Cross-shard storm: 100% of transfers are cross-shard

Capacity planning formula:
  Shards needed = (peak_TPS × entries_per_txn) / writes_per_shard_capacity
  = (23,150 × 2.5) / 15,000
  = 3.86 → round up to 8 (minimum), 16 (comfortable headroom)

  Memory per shard:
    Active wallets: 12.5M × 500B = 6.25 GB
    Balance index: 12.5M × 100B = 1.25 GB
    Hot ledger partition: ~562 GB (90 days)
    Buffer pool: 64 GB recommended
```
