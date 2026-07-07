# Interview Guide

## 45-Minute Pacing

### Minutes 0-5: Clarify Scope

**Key clarifying questions to ask (or expect):**

| Question | Why It Matters |
|----------|---------------|
| "Are we designing a closed-loop wallet (funds stay within ecosystem) or open-loop (interoperable with banks, UPI, card networks)?" | Closed-loop is simpler (internal ledger only); open-loop requires bank integrations, regulatory compliance, settlement |
| "Do we need to support P2P transfers or only merchant payments?" | P2P adds cross-shard transfer complexity, social graph, money request features |
| "What is the KYC requirement? Is this a regulated money transmitter?" | Determines whether tiered KYC, transaction limits, AML monitoring, and licensing are in scope |
| "What is the expected scale? How many wallets and transactions per day?" | Drives sharding strategy and whether hot wallet optimization is needed |
| "Do we need multi-currency support?" | Adds FX rate management, conversion flows, and per-currency balance tracking |

**Recommended scope for 45 minutes:**
- Closed-loop wallet with bank top-up and withdrawal (open-loop for money movement)
- P2P transfers + merchant payments (QR code)
- Tiered KYC with transaction limits
- Focus on: ledger consistency, double-spend prevention, P2P transfer atomicity
- Discuss but do not fully design: NFC payments, multi-currency, bill payments

---

### Minutes 5-15: High-Level Architecture

Draw the architecture with these components:
1. **Client layer** → API Gateway → Idempotency Service
2. **Core services**: Wallet Service, Ledger Service, Transfer Service, Merchant Payment Service
3. **External integrations**: Partner Bank (escrow), Card Network, KYC Provider
4. **Data stores**: PostgreSQL (sharded by wallet_id), Redis (balance cache, locks), Kafka (events)
5. **Support services**: Fraud Detection, Notification, KYC

**Key points to make:**
- "The ledger is the single source of truth. Every operation---top-up, transfer, payment---is a double-entry journal entry: debit one account, credit another."
- "Balance checks and debits must be atomic. This is how we prevent double-spend."
- "User funds are custodial---we hold actual money in escrow at a partner bank. The ledger tracks who owns what."
- "P2P transfers on the same database shard are a single ACID transaction. Cross-shard transfers use a saga pattern."

---

### Minutes 15-28: Deep Dive --- Ledger Consistency + Double-Spend Prevention

This is where you differentiate. Focus on:

**1. Double-Entry Bookkeeping**
- Every transaction produces a journal entry with balanced debits and credits
- Sum of all debits must always equal sum of all credits (global Rule that never changes)
- Ledger entries are immutable (append-only); reversals create new compensating entries
- This prevents money from being created or destroyed in the system

**2. Atomic Balance-Check-and-Debit**
- The critical operation: "does the user have enough balance?" + "debit the amount" must be atomic
- Implementation: `SELECT balance FOR UPDATE` (pessimistic lock) → check balance ≥ amount → `UPDATE balance` → `INSERT ledger entry` → COMMIT
- The lock serializes concurrent operations on the same wallet
- Alternative: optimistic concurrency with version field (CAS operation)

**3. Double-Spend Prevention**
- Scenario: user with $100 sends two $80 transfers simultaneously
- Without protection: both read $100, both succeed, balance = -$60
- With pessimistic lock: second transaction waits for first to complete, sees $20, rejects
- Idempotency key prevents network retries from creating duplicate transactions

**4. Materialized vs. Computed Balances**
- `balance = SUM(credits) - SUM(debits)` is correct but too slow (scans entire ledger)
- Materialize balance in wallet table, update atomically with ledger writes
- Reconciliation job verifies materialized balance matches computed balance

---

### Minutes 28-38: P2P Transfer Atomicity + Hot Wallet Problem

**P2P Transfer Architecture:**
- Same-shard: single ACID transaction (debit sender + credit receiver)
- Cross-shard: saga pattern
  - Step 1: Debit sender on Shard A
  - Step 2: Credit receiver on Shard B
  - If Step 2 fails: compensate Step 1 (re-credit sender)
- Always lock wallets in sorted ID order to prevent deadlocks
- Idempotent at each saga step (saga_log tracks progress)

**Hot Wallet Problem:**
- Popular merchants receive thousands of payments per second
- All payments update the same wallet row → lock contention Slowest part of the process
- Solutions: sub-wallets (shard merchant balance across 16 sub-wallets), async credit batching, in-memory accumulator with periodic flush
- "This is the same problem as a Twitter celebrity's follower count or a counter with extreme write concurrency"

**Cross-Shard Optimization:**
- Analyze P2P transfer graph, co-locate frequent transfer pairs on same shard
- Transfer holding account per shard reduces cross-shard hops

---

### Minutes 38-43: Security, KYC, and Fraud

**Tiered KYC:**
- Tier 1 (basic): phone + self-declared name → $500/txn, $10K/month
- Tier 2 (intermediate): government ID verification → $2K/txn, $50K/month
- Tier 3 (full): video KYC + income proof → $10K/txn, $200K/month
- Progressive unlock: low-friction onboard, increase limits as trust grows

**Fraud Detection:**
- Inline (synchronous) for every transaction: < 100ms budget
- Pre-computed velocity features in Redis (txn count/hour, amount/day, unique recipients)
- ML model produces risk score (0-100)
- Score < 30: auto-approve, 30-70: step-up auth, > 70: decline

**Fund Safety:**
- User funds escrowed at partner bank (legally separated from platform funds)
- Daily escrow reconciliation: SUM(user balances) matches bank escrow
- Platform revenue (fees) flows to separate revenue accounts

---

### Minutes 43-45: Trade-offs + Discussion

Summarize 2-3 key trade-offs:
1. Pessimistic vs. optimistic locking for balance operations
2. Same-shard simplicity vs. cross-shard saga complexity for P2P
3. Inline vs. async fraud scoring (latency vs. accuracy)

---

## What Makes Digital Wallet Uniquely Hard

| Challenge | Why It Is Unique | How It Shapes Architecture |
|-----------|-----------------|--------------------------|
| **Ledger must balance** | Financial Rule that never changes: not a single cent can be unaccounted for | Double-entry bookkeeping; every operation is a journal entry |
| **Double-spend prevention** | Concurrent requests must never exceed available balance | Pessimistic locking on wallet row; atomic check-and-debit |
| **Custodial responsibility** | Platform holds actual money (not just routing transactions) | Escrow accounts, fund segregation, regulatory compliance |
| **P2P cross-shard atomicity** | Instant transfer between users on different shards | Saga pattern with compensation; no 2PC across shards |
| **Hot wallet contention** | Popular merchants cause row-level lock Slowest part of the process | Sub-wallets, async batching, write distribution |
| **Regulatory tiering** | KYC requirements proportional to transaction limits | Progressive verification; per-tier limit enforcement |
| **Multi-channel payments** | Same balance via NFC, QR, in-app, bank transfer | Unified ledger; channel-specific auth and security |

---

## Key Trade-Offs Table

| Decision | Option A | Option B | Recommendation | Rationale |
|----------|----------|----------|----------------|-----------|
| **Concurrency control** | Pessimistic locking (FOR UPDATE) | Optimistic (version CAS) | Pessimistic | Lock duration is short (< 5ms); simpler; no retry logic needed for majority of wallets |
| **Balance storage** | Computed from ledger on read | Materialized + reconciliation | Materialized | Computing from 500M entries/day is too slow; materialize and verify with hourly reconciliation |
| **Cross-shard transfer** | 2PC (distributed transaction) | Saga with compensation | Saga | 2PC requires all shards available simultaneously; saga tolerates partial failure with compensation |
| **Fraud scoring** | Synchronous (inline) | Asynchronous (post-transaction) | Synchronous | Preventing fraud is worth < 100ms latency cost; reversing fraud after the fact is expensive |
| **Ledger immutability** | Allow updates/deletes | Append-only with compensating entries | Append-only | Audit trail integrity; regulatory requirement; prevents tampering |
| **Hot wallet strategy** | Pessimistic lock (accept latency) | Sub-wallets (distribute writes) | Sub-wallets for merchants | Merchant payments cannot tolerate multi-second latency; sub-wallets reduce contention 16x |
| **Fund storage** | Co-mingle with platform funds | Segregated escrow at partner bank | Segregated escrow | Regulatory requirement; protects users if platform goes bankrupt |
| **Idempotency store** | Database (durable) | Redis (fast, TTL-based) | Redis + DB constraint | Redis for fast path; DB unique constraint as safety net |

---

## Trap Questions & Strong Answers

### "What if the user has $100 and sends two $80 transfers at the same time?"

**Weak answer:** "We check the balance before debiting."

**Strong answer:** "The balance check and debit must be atomic---done in a single database transaction with a pessimistic lock. The first request acquires a `SELECT ... FOR UPDATE` lock on the wallet row, reads $100, debits $80, and commits. The second request blocks on the lock until the first commits, then reads $20, and rejects because $20 < $80. We never check balance and debit in separate steps, because that creates a TOCTOU (time-of-check-time-of-use) race condition. Additionally, every request carries a client-generated idempotency key, so if the first $80 transfer was a network retry of the same logical request, it returns the cached result instead of debiting again."

### "How do you handle P2P transfers when sender and receiver are on different database shards?"

**Weak answer:** "We use a distributed transaction across both databases."

**Strong answer:** "We use a saga pattern. Step 1: debit the sender on Shard A within a local ACID transaction. Step 2: credit the receiver on Shard B within a separate local ACID transaction. If Step 2 fails, we execute a compensating transaction on Shard A that re-credits the sender. Each step is idempotent---a saga_log table tracks which steps have completed so that retries do not double-process. During the brief window between debit and credit (typically < 500ms), the transfer shows as 'PROCESSING.' We avoid 2PC because it requires all shards to be available simultaneously, and coordinator failure can leave transactions in an indeterminate state."

### "What happens if the system crashes between debiting the sender and crediting the receiver?"

**Weak answer:** "We use retries."

**Strong answer:** "The saga_log table records which steps have completed, persisted in the same transaction as the debit. On recovery, a saga recovery worker scans for sagas in DEBIT_COMPLETED but not CREDIT_COMPLETED state. For each, it retries the credit step. If the credit fails (e.g., receiver wallet is closed), it executes the compensating transaction to re-credit the sender. The key insight is that the saga_log is updated atomically with each step---so we always know exactly where we left off. Combined with idempotent operations, recovery is straightforward: just re-run from the last completed step."

### "How do you ensure the ledger always balances?"

**Weak answer:** "We run a daily reconciliation job."

**Strong answer:** "We enforce balance at three levels. First, at write time: every journal entry is validated before commit---the sum of debit entries must equal the sum of credit entries, or the transaction is rejected. Second, hourly reconciliation verifies the global Rule that never changes: SUM(all debits) = SUM(all credits). Third, per-wallet drift detection compares each wallet's materialized balance against the computed sum from its ledger entries. If any check fails, it triggers a P0 alert that halts new transactions on the affected shard until resolved. The ledger is append-only---entries are never modified or deleted, only compensated with new entries---which makes the audit trail tamper-proof."

### "How would you handle a merchant like a coffee chain receiving 10,000 payments per minute?"

**Weak answer:** "We scale the database."

**Strong answer:** "This is the 'hot wallet' problem. Every payment credits the merchant's wallet, and with pessimistic locking, all 10,000 payments per minute contend for the same row lock. The solution is sub-wallets: split the merchant's balance across 16 sub-wallets. Each incoming payment credits a random sub-wallet, reducing contention by 16x. The merchant's displayed balance is the sum of all sub-wallets. For withdrawals, we debit sub-wallets sequentially. An alternative is async credit batching: individual credits go to a staging table (no lock contention), and a background job batches them into a single wallet update every few seconds."

### "Why not use eventual consistency for balances?"

**Weak answer:** "Because we need accurate balances."

**Strong answer:** "In a financial system, eventual consistency for balances means there is a window where a user's displayed balance does not reflect their actual balance. During that window, they could overspend, resulting in a negative balance---which is real money the platform has to absorb. For a system processing $3B daily, even a 0.01% error rate means $300K in daily losses. The balance-check-and-debit must be strongly consistent to prevent this. However, we can use eventual consistency for non-critical reads: the transaction history view, analytics dashboards, and notification delivery can all tolerate slight delays. The key principle is: strong consistency where money moves, eventual consistency where humans read."

---

## Follow-Up Deep Dives

If the interviewer wants to go deeper, be prepared for:

| Topic | Key Points |
|-------|-----------|
| **Multi-currency wallets** | Per-currency balance tracking; FX rate locked at transfer time vs. settlement time; markup on conversion; regulatory implications per currency |
| **NFC payment flow** | Tokenization via Secure Element; Device Account Number; one-time cryptograms; EMV contactless protocol |
| **Settlement to merchants** | Daily/weekly settlement cycles; net settlement (batch all credits/debits); settlement reconciliation; holdback for disputes |
| **Promotional balance** | Non-withdrawable cashback credited to separate promotional balance; used before regular balance; expiry tracking |
| **Dispute resolution** | Charge held in dispute-holding account; investigation workflow; provisional credit to user; 30-day resolution SLA |
| **Regulatory reporting** | Transaction volume reports; suspicious activity reports (SARs); currency transaction reports (CTRs); annual audit |

---

## Extension Deep Probes

### "How would you add offline payments for markets with unreliable connectivity?"

**Key points:**
- Store-and-forward model: transaction queued locally on device, submitted when connectivity returns
- Offline balance is a "last-known" balance cached on device with a configurable offline spending limit (e.g., $50 max offline)
- Cryptographic signature on offline transaction prevents tampering; device secure element signs the payload
- Reconciliation on reconnect: server validates queued transactions, rejects any that exceed actual balance
- Risk: user could spend more than their balance offline if they factory-reset between transactions → platform absorbs small offline fraud as cost of accessibility
- India's UPI Lite and China's e-CNY use this pattern for small-value offline payments

### "How would you build Wallet-as-a-Service (embedded wallets)?"

**Key points:**
- Multi-tenant ledger: each partner (e.g., ride-hailing app, e-commerce platform) gets isolated wallet namespace
- Tenant-specific fee schedules, KYC flows, and branding
- API-first: partner integrates via SDK, user never sees wallet provider's brand
- Regulatory: wallet provider holds the money transmission license; partner operates under umbrella
- Ledger isolation: each tenant's wallets in separate logical partition but shared physical infrastructure
- Settlement: partner receives aggregated settlement reports; individual user data stays within wallet platform

---

## Key Technical Concepts Quick Reference

| Concept | Definition | Where It Appears |
|---------|-----------|-----------------|
| **Double-entry bookkeeping** | Every financial operation creates balanced debit/credit entries | Ledger Service; every transaction |
| **Materialized balance** | Denormalized balance field updated atomically with ledger writes | Wallet table; avoids SUM queries |
| **Pessimistic locking** | SELECT FOR UPDATE acquires exclusive row lock before read | Balance-check-and-debit path |
| **Saga pattern** | Multi-step distributed operation with compensating transactions | Cross-shard P2P transfers |
| **Idempotency key** | Client-generated UUID ensuring at-most-once processing | Every mutation API endpoint |
| **Sub-wallets** | Sharded balance across N rows to reduce write contention | Hot merchant wallets |
| **Transfer holding account** | Intermediate ledger account for cross-shard fund movement | Saga step intermediary |
| **Escrow account** | Partner bank account holding user funds in trust | Fund segregation; regulatory |
| **Chart of accounts** | Classification of all accounts (asset, liability, revenue, expense) | Ledger integrity; audit |
| **Circuit breaker** | Automatic failover when external service error rate exceeds threshold | Bank/card/UPI integrations |

---

## Quick Whiteboard Reference

### Key Numbers to Have Ready

```
Scale:
  500M wallets, 200M MAU, 80M DAU
  200M transactions/day → 2,315 avg TPS → 23,150 peak TPS
  500M ledger entries/day → 57,870 peak writes/sec
  36.5 TB/year ledger growth
  $3B daily settlement volume

Latency:
  P2P p99 < 2s, QR payment p99 < 1s, balance query p99 < 100ms
  Fraud scoring < 100ms inline
  DB commit with sync replication: ~140ms

Sharding:
  16 shards → 3,617 writes/sec/shard (capacity: 15K)
  ~31M wallets per shard, 12.5M active per shard
  ~38% of P2P transfers are cross-shard

Fraud:
  0.072% auto-decline rate
  3.2% false positive rate
  0.006% fraud loss rate
```

### Architecture Sketch Checklist

```
Must-have components for whiteboard:
  ☐ API Gateway + Idempotency Service
  ☐ Wallet Service (balance, KYC tier enforcement)
  ☐ Ledger Service (double-entry, FOR UPDATE)
  ☐ Transfer Service (saga coordinator)
  ☐ Fraud Detection (inline, < 100ms)
  ☐ PostgreSQL sharded by wallet_id
  ☐ Redis (balance cache, idempotency, locks, fraud features)
  ☐ Kafka (transaction events, outbox pattern)
  ☐ Partner Bank (escrow)

Key data flows to trace:
  ☐ P2P same-shard (single ACID transaction)
  ☐ P2P cross-shard (saga: debit → credit → compensate)
  ☐ Merchant QR payment (debit user → credit merchant → fee)
  ☐ Top-up (async bank callback → credit wallet)
```

---

## Behavioral Assessment Dimensions

| Dimension | What Interviewer Is Looking For | Signal |
|-----------|-------------------------------|--------|
| **Financial thinking** | Candidate treats money as a first-class concern, not an afterthought | Mentions ledger Rule that never changes unprompted; discusses escrow; worries about cent-level precision |
| **Failure reasoning** | Candidate asks "what if this crashes here?" at every step | Discusses saga compensation; idempotency as safety net; reconciliation as verification |
| **Concurrency intuition** | Candidate spots race conditions without being prompted | Identifies TOCTOU in balance check; explains deadlock prevention; knows lock ordering |
| **Regulatory awareness** | Candidate understands that financial systems have compliance constraints | Mentions KYC tiers, AML monitoring, fund segregation, data localization |
| **Scale calibration** | Candidate makes reasonable estimates and ties them to architecture | Derives shard count from TPS; identifies hot wallet problem; sizes cache appropriately |

---

## Red Flags to Avoid

| Red Flag | Why It Is Wrong | Correct Approach |
|----------|----------------|------------------|
| "We check balance then debit in two separate calls" | TOCTOU race condition → double-spend | Atomic check-and-debit in single transaction with row lock |
| "We use a single database for all wallets" | 500M wallets + 57K writes/sec won't fit on one node | Shard by wallet_id; co-locate wallet + ledger entries |
| "We use 2PC for cross-shard transfers" | 2PC blocks if coordinator fails; poor availability | Saga with compensation; idempotent steps; saga_log for recovery |
| "We use eventual consistency for balances" | User can overspend during inconsistency window | Strong consistency for balance operations; eventual for reads/analytics |
| "We store the balance as a counter only (no ledger)" | No audit trail; cannot reconcile; cannot detect errors | Double-entry ledger is the source of truth; materialized balance is a cache |
| "We run fraud checks asynchronously after the transaction" | Fraudulent transaction already executed; reversal is expensive | Inline fraud scoring (< 100ms) before ledger write |
| "We use auto-increment IDs for transactions" | Exposes transaction volume; sequential IDs are guessable | Use UUIDs or ULIDs (sortable but non-sequential) |
