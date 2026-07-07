# Scalability & Reliability

## Horizontal Scaling Strategy

### Stateless Service Tier

All core services (Envelope Service, Signer Workflow Service, Signature Capture Service, etc.) are stateless. State lives in the relational database, object storage, and distributed cache. This enables:

- **Auto-scaling**: Add/remove service instances based on request rate
- **Zero-downtime deployment**: Rolling updates with health checks
- **Regional deployment**: Services replicated across regions

### Scaling by Component

| Component | Scaling Strategy | Auto-Scale Trigger | Min / Max Instances |
|-----------|-----------------|-------------------|-------------------|
| API Gateway | Horizontal | Request rate > 10K req/s per instance | 4 / 50 |
| Envelope Service | Horizontal | CPU > 70% or request latency p99 > 500ms | 4 / 40 |
| Signer Workflow Service | Horizontal | Active signing sessions > 1K per instance | 4 / 30 |
| Signature Capture Service | Horizontal | Signing ops/s > 50 per instance | 4 / 30 |
| Document Processing Service | Horizontal (CPU-intensive) | CPU > 60% or queue depth > 100 | 8 / 100 |
| PDF Rendering Service | Horizontal (CPU-intensive) | CPU > 60% or render queue > 200 | 8 / 80 |
| Document Sealing Service | Horizontal | Sealing queue depth > 50 | 4 / 40 |
| Notification Service | Horizontal | Queue depth > 1K messages | 4 / 30 |
| Audit Service | Horizontal | Write throughput > 5K events/s per instance | 4 / 20 |
| Bulk Send Workers | Horizontal | Bulk queue depth > 500 messages | 2 / 50 |

---

## Document Storage Architecture

### Object Storage Tiers

Completed documents are immutable. Storage costs are managed via tiering:

| Tier | Access Pattern | Storage | When |
|------|---------------|---------|------|
| **Hot** | Frequent reads (signing in progress, recently completed) | Standard object storage | 0-30 days after creation |
| **Warm** | Occasional reads (download, audit queries) | Infrequent-access tier | 30 days - 1 year |
| **Cold** | Rare reads (legal hold, compliance queries) | Archive tier | 1 year - retention limit |
| **Glacier** | Near-zero reads (regulatory retention) | Deep archive | Beyond standard retention |

### Content-Addressed Storage

Sealed documents use content-addressed addressing:

```
storage_key = "sealed/" + SHA256(document_bytes)[:16] + "/" + envelope_id + "/" + document_id + ".pdf"
```

**Benefits**:
- Built-in deduplication (same content = same hash prefix)
- Tamper detection (if content changes, hash changes, key no longer valid)
- Efficient integrity verification (recompute hash, compare to key)

### Storage Organization

```
Object Storage Layout:
├── uploads/                    # Original uploaded documents
│   └── {org_id}/{envelope_id}/{document_id}/original.pdf
├── converted/                  # PDF conversions
│   └── {org_id}/{envelope_id}/{document_id}/converted.pdf
├── rendered/                   # Page images for signing UI (cached)
│   └── {envelope_id}/{document_id}/page-{n}.png
├── signatures/                 # Signature images
│   └── {envelope_id}/{signer_id}/{signature_id}.png
├── sealed/                     # Completed, immutable documents
│   └── {envelope_id}/
│       ├── {document_id}.pdf   # Sealed PDF with embedded signatures
│       ├── certificate.pdf     # Certificate of completion
│       └── audit_trail.pdf     # Audit trail PDF
└── bulk/                       # Bulk send data
    └── {batch_id}/recipients.json
```

---

## Audit Log Architecture

### Append-Only Writes

The audit log uses an append-only storage model:

- **Primary store**: Relational database with append-only constraints (no UPDATE or DELETE permissions on audit tables for application users)
- **Secondary store**: Immutable append-only log (write-once storage) for tamper resistance
- **Read replicas**: For audit queries without impacting write performance

### Write Path Optimization

```
Audit Event Write Path:
1. Application writes to primary relational DB (synchronous)
2. Change data capture (CDC) streams to:
   a. Immutable backup store (async, <5s lag)
   b. Search index for full-text audit queries (async, <30s lag)
   c. Analytics pipeline for compliance dashboards (async, <5m lag)
```

### Audit Log Partitioning

| Strategy | Implementation | Purpose |
|----------|---------------|---------|
| **Shard by envelope_id** | Hash-based sharding | Co-locate audit events with envelope data |
| **Time-based partitioning** | Monthly partitions within each shard | Efficient range queries for compliance |
| **Archive partitioning** | Move partitions older than 1 year to cold storage | Cost management |

---

## Workflow State Sharding

### Shard by envelope_id

All data for an envelope (envelope record, signers, fields, signatures, audit events) is co-located on the same database shard. This ensures:

- Atomic transactions for envelope state changes
- No cross-shard queries for the signing critical path
- Natural isolation---one envelope's load does not affect another

### Shard Distribution

```
Shard assignment: consistent_hash(envelope_id) → shard_id

Example with 16 shards:
  envelope_id "abc-123" → hash → shard 7
  All tables for this envelope: shard 7
  (envelopes, signers, fields, signatures, audit_events)
```

### Cross-Shard Queries

Some queries span shards:
- "All envelopes sent by user X" → scatter-gather across shards, merge by timestamp
- "All envelopes for organization Y" → scatter-gather, filtered by org_id
- Search index (separate from sharded DB) handles full-text and filtered queries efficiently

---

## Disaster Recovery

### Geo-Replication Strategy

| Data Type | Replication | RPO | RTO |
|-----------|------------|-----|-----|
| Relational DB (envelope state) | Synchronous replication to standby region | 0 (zero data loss) | < 5 minutes |
| Object storage (documents) | Cross-region replication | < 1 minute | < 10 minutes |
| Audit log | Synchronous replication + immutable backup | 0 (zero data loss) | < 5 minutes |
| HSM keys | Key backup to geographically separated HSM | N/A (keys are durable) | < 30 minutes (HSM initialization) |
| Cache | No replication (rebuilt from DB) | N/A | < 2 minutes (warm-up) |
| Search index | Async replication | < 5 minutes | < 15 minutes |

### Data Residency Compliance

Some jurisdictions require data to remain within geographic boundaries:

```
Data Residency Architecture:
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│   US Region      │    │   EU Region      │    │   APAC Region    │
│                  │    │                  │    │                  │
│ DB Shard (US)    │    │ DB Shard (EU)    │    │ DB Shard (APAC)  │
│ Object Store (US)│    │ Object Store (EU)│    │ Object Store(APAC)│
│ HSM Cluster (US) │    │ HSM Cluster (EU) │    │ HSM Cluster(APAC)│
│ Audit Log (US)   │    │ Audit Log (EU)   │    │ Audit Log (APAC) │
│                  │    │                  │    │                  │
└──────────────────┘    └──────────────────┘    └──────────────────┘
         │                       │                       │
         └───────────┬───────────┘───────────────────────┘
                     │
              Global Routing Layer
              (routes by org.data_region)
```

Organizations are assigned to a data region at creation time. All data (documents, audit logs, keys) stays within that region. The global routing layer directs API requests to the correct region.

**Cross-region envelopes**: When Signer A is in the US and Signer B is in the EU, the envelope data is stored in the sender's region. Signer B's requests are routed to the sender's region for data access, but the signing session UI is served from the nearest edge.

---

## Failure Modes and Recovery

### Failure Mode 1: HSM Unavailability

**Impact**: AES/QES signatures cannot be created. SES (click-to-sign) signatures are unaffected.

**Detection**: HSM health check fails; signing operation timeout > 500ms.

**Recovery**:
1. Circuit breaker opens for affected HSM cluster
2. Failover to secondary HSM cluster (geo-replicated keys)
3. If both clusters down: queue AES/QES signing requests with client notification ("Signature will be processed when service recovers")
4. SES signatures continue via software path
5. Alert on-call engineering

### Failure Mode 2: Signer Session Timeout

**Impact**: Signer loses progress on partially filled fields.

**Detection**: Session heartbeat stops; WebSocket disconnect.

**Recovery**:
1. Auto-save field values every 30 seconds to server
2. On reconnect, restore field values from last auto-save
3. Signing token remains valid until explicit expiry (not tied to session)
4. Signer can resume by clicking the original email link

### Failure Mode 3: PDF Generation Failure

**Impact**: Document cannot be converted, rendered, or sealed.

**Detection**: PDF processing worker returns error or timeout.

**Recovery**:
1. Retry with exponential backoff (3 attempts)
2. If conversion fails: return error to sender, suggest uploading a PDF directly
3. If rendering fails: fall back to server-side rendering (slower) or return page-by-page
4. If sealing fails: queue for retry; envelope remains in COMPLETED (not SEALED) state; signer notifications delayed

### Failure Mode 4: Database Primary Failure

**Impact**: No new envelopes can be created; active signing sessions may fail.

**Detection**: Database connection pool exhausted; health check failure.

**Recovery**:
1. Automatic failover to synchronous replica (< 30 seconds)
2. Connection pool switches to new primary
3. In-flight transactions may fail; clients retry
4. Active signing sessions: field values cached client-side; retry on submission
5. Zero data loss due to synchronous replication

### Failure Mode 5: Notification Service Failure

**Impact**: Signers not notified; signing ceremony delayed but not blocked.

**Detection**: Notification queue depth growing; email delivery rate drops.

**Recovery**:
1. Notifications are non-blocking (async via queue)
2. Messages buffered in queue; delivered when service recovers
3. Senders can manually resend notifications via API
4. Exponential backoff for email provider failures
5. Dead letter queue for messages that fail after max retries; manual investigation

---

## Caching Strategy

### Cache Layers

| Layer | What Is Cached | TTL | Invalidation |
|-------|---------------|-----|-------------|
| **CDN/Edge** | Rendered PDF page images (for signing UI) | 1 hour | On document modification (rare for active envelopes) |
| **Application Cache** | Envelope metadata, signer status, org settings | 60 seconds | Event-driven invalidation on state change |
| **Session Cache** | Active signing session data, field auto-save values | Session duration | On session end or token expiry |
| **Permission Cache** | Org membership, user roles | 5 minutes | On role change event |

### Cache Invalidation Events

```
On envelope state change → invalidate envelope metadata cache
On signature captured → invalidate signer status cache
On signer activated → invalidate envelope cache + trigger notification
On org settings change → invalidate org settings cache for all users
```

### What Is NOT Cached

- **Sealed documents**: Served directly from object storage (immutable, no invalidation needed)
- **Audit trail**: Always read from primary database (consistency requirement)
- **HSM operations**: Never cached (cryptographic operations must be fresh)
- **Signing tokens**: Always validated against database (security requirement)

---

## Load Testing Strategy

| Scenario | Description | Target | Success Criteria |
|----------|-------------|--------|-----------------|
| **Steady-state signing** | Simulate 100K concurrent signing sessions with realistic field-filling and signature capture | 54 signatures/sec sustained | p99 signature capture < 500ms; zero audit chain errors |
| **Quarter-end spike** | 5x normal envelope volume over 2 hours, concentrated 9am--11am | 115 envelopes/sec peak | No SLO violation; HSM latency p99 < 200ms |
| **Bulk send storm** | 10 concurrent bulk sends of 10,000 recipients each | 10,000 envelopes/min | All 100K envelopes created within 15 minutes; zero duplicates |
| **HSM saturation** | Send 100% AES/QES traffic (normally 20%) to stress HSM cluster | 270 HSM ops/sec | Circuit breaker activates cleanly; SES traffic unaffected |
| **Database failover** | Kill primary database during active signing sessions | Auto-failover < 30s | In-flight signatures retried successfully; zero data loss |
| **Cross-region envelope** | Signers distributed across US, EU, APAC regions | p99 signing session load < 3s | Document rendering served from nearest edge; signing routed to data region |

### Load Testing Anti-Patterns

| Anti-Pattern | Why It Misleads | Correct Approach |
|-------------|----------------|-----------------|
| Testing only SES signatures | SES avoids HSM entirely; misses the real Slowest part of the process | Include 20% AES/QES traffic matching production ratio |
| Uniform arrival rate | Real traffic has sharp 10am peaks and month-end spikes | Use recorded traffic patterns with calendar multipliers |
| Single-document envelopes | Misses PDF processing overhead of multi-document packages | Mix envelope sizes: 60% single-doc, 30% 2-3 docs, 10% 5+ docs |
| Ignoring audit trail verification | Tests write performance but not integrity verification load | Include periodic hash chain verification during load test |

---

## Connection Pool and Resource Management

| Resource | Pool Size | Timeout | Retry Policy |
|----------|-----------|---------|-------------|
| **Database connections** (per service instance) | 20 connections | 5s acquire, 30s query | 3 retries with 100ms backoff |
| **HSM sessions** (per HSM node) | 50 concurrent sessions | 500ms per operation | Circuit breaker: open after 5 failures in 30s |
| **Object storage connections** | 100 concurrent uploads | 30s per upload | 3 retries with exponential backoff |
| **Email provider connections** | 50 concurrent sends | 10s per send | 5 retries with 1s backoff; dead letter after max |
| **PDF rendering workers** | CPU-bound: 1 worker per core | 30s per render | Retry once; fail with error if still failing |
| **Search index connections** | 20 connections | 5s per query | 2 retries; degrade to DB query on failure |

---

## Auto-Scaling Policies

| Component | Scale-Up Trigger | Scale-Down Trigger | Min | Max | Cooldown |
|-----------|-----------------|-------------------|-----|-----|----------|
| **API Gateway** | Request rate > 10K/s per instance | Request rate < 3K/s per instance for 10m | 4 | 50 | 3 min |
| **Envelope Service** | CPU > 70% OR p99 latency > 500ms | CPU < 30% for 15m | 4 | 40 | 5 min |
| **PDF Rendering Service** | Render queue > 200 OR CPU > 60% | Queue < 20 for 10m | 8 | 80 | 3 min |
| **Document Sealing Service** | Sealing queue > 50 | Queue = 0 for 15m | 4 | 40 | 5 min |
| **Bulk Send Workers** | Bulk queue > 500 messages | Queue = 0 for 10m | 2 | 50 | 2 min |
| **Notification Service** | Notification queue > 1K | Queue < 100 for 10m | 4 | 30 | 3 min |

---

## Chaos Engineering Experiments

| Experiment | Fault Injection | Steady-State Hypothesis | Blast Radius |
|-----------|----------------|------------------------|-------------|
| **HSM node failure** | Kill one HSM node in the 8-node cluster | AES/QES signing latency increases but stays < 500ms p99; no signing failures | 12.5% of org key slots temporarily unavailable |
| **Database primary kill** | Terminate primary DB process | Auto-failover completes in < 30s; in-flight signing sessions retry successfully | All write operations pause briefly |
| **Object storage degradation** | Inject 50% upload failures | Document uploads retry with backoff; no data loss; upload latency increases 2x | Envelope creation slows but does not fail |
| **Network partition: HSM segment** | Block network between app tier and HSM cluster | SES signatures continue unaffected; AES/QES circuit breaker opens; requests queued with user notification | Only HSM-dependent signatures affected |
| **Audit service slowdown** | Add 500ms latency to audit writes | Signing operations proceed (audit is synchronous but fast); overall signing latency increases by ~500ms | All signing operations affected |
| **Notification queue overflow** | Stop all notification consumers for 30 minutes | Queue buffers all messages; no signing operations affected; notifications delayed but delivered on recovery | Signer notifications delayed |
| **Bulk send worker crash** | Kill 50% of bulk send workers mid-batch | Remaining workers continue processing; unprocessed messages re-queued; zero duplicate envelopes (idempotency) | Bulk send throughput halved temporarily |

---

## HSM Scaling Deep Dive

### HSM Capacity Planning

```
HSM Operations Budget:
  Total daily signatures:          5,670,000 envelopes × 2.3 signers = 13,041,000
  SES signatures (80%):            10,432,800 → software path (no HSM)
  AES signatures (15%):            1,956,150 → HSM signing
  QES signatures (5%):             652,050 → HSM signing (QSCD-certified)
  Platform sealing operations:     5,670,000 → HSM signing
  Total HSM ops/day:               1,956,150 + 652,050 + 5,670,000 = 8,278,200
  Average HSM ops/sec:             96
  Peak HSM ops/sec (3x):           288
  Required HSM cluster capacity:   ~400 ops/sec (with 30% headroom)
  Per HSM node capacity:           ~100 ops/sec
  Minimum cluster size:            4 nodes (active) + 2 nodes (standby)
```

### HSM Failover Architecture

| Component | Primary | Secondary | Failover Time |
|-----------|---------|-----------|--------------|
| **HSM cluster** | 4 active nodes, region A | 4 standby nodes, region B | < 30 seconds (DNS failover) |
| **Key synchronization** | Real-time key replication to standby | Standby holds read-only copy of all keys | Keys available immediately on failover |
| **Session state** | Active signing sessions reference primary | On failover, sessions re-authenticate to secondary | Sessions retry automatically; < 5s user-visible delay |
| **Certificate authority** | Org CA keys on primary HSM | Replicated to secondary | Certificate issuance continues on secondary |

### HSM Vendor Independence Strategy

HSM vendor lock-in is a significant operational risk. Mitigation:

| Strategy | Implementation | Trade-Off |
|----------|---------------|-----------|
| **PKCS#11 abstraction layer** | All HSM operations via PKCS#11 standard API | Limits use of vendor-specific optimizations |
| **Key export capability** | Wrapped key export enabled for disaster recovery | Requires careful key custody procedures |
| **Multi-vendor clusters** | Primary from Vendor A, secondary from Vendor B | Increased operational complexity; validates portability |
| **Cloud HSM evaluation** | Regularly benchmark managed HSM services against on-premises | Cloud HSM may not meet QSCD certification requirements |

---

## Capacity Planning for Calendar Spikes

| Event | Expected Multiplier | Pre-Scaling Action | Duration |
|-------|-------------------|-------------------|----------|
| **Month-end** | 3x | Scale all services to 3x minimum 2 hours before | Last 2 days of month |
| **Quarter-end** | 5x | Pre-warm HSM sessions; scale PDF workers to max; pre-allocate DB connections | Last 3 days of quarter |
| **Fiscal year-end** | 8x | Full infrastructure scale-out; dedicated HSM capacity for top 100 orgs; CDN pre-warming | Last 5 days of fiscal year |
| **US tax deadline** | 4x | Scale notification service for tax document delivery spike | April 1--15 |
| **Back-to-school** | 2x | Scale bulk send workers for enrollment document batches | August--September |

---

## Database Partition Lifecycle

Completed envelope data follows a predictable lifecycle that enables aggressive partition management:

| Age | Partition State | Access Pattern | Storage Location |
|-----|----------------|---------------|-----------------|
| 0--30 days | **Hot** | Active signing, frequent reads, state transitions | Primary database, SSD storage |
| 30 days--1 year | **Warm** | Occasional document retrieval, audit queries | Read replicas, standard storage |
| 1--7 years | **Cold** | Rare legal/compliance queries only | Archive partitions, compressed |
| 7+ years | **Deep archive** | Legal hold or regulatory retention only | Offline storage, restored on-demand (minutes to hours) |

### Partition Cutting off unnecessary steps Rules

- Completed envelopes older than 30 days: move to warm partition (read-only)
- Audit trail data: never pruned; partitioned by month, compressed after 90 days
- Draft envelopes older than 30 days without activity: auto-delete with notification to sender
- Voided/declined envelopes: retain audit trail for 1-3 years; purge document bytes per org policy
