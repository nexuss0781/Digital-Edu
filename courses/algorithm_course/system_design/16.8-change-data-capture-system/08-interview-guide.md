# Interview Guide — Change Data Capture (CDC) System

## Interview Pacing (45-min Format)

| Time | Phase | Focus | Key Points |
|------|-------|-------|------------|
| 0-5 min | **Clarify** | Scope the problem | What databases? (PostgreSQL, MySQL, both?) What downstream consumers? (search, cache, warehouse?) Scale? (events/sec, number of sources) Latency requirements? |
| 5-15 min | **High-Level** | Core architecture | Log-based capture from WAL/binlog, event envelope format, streaming platform as durable buffer, schema registry for evolution |
| 15-30 min | **Deep Dive** | 1-2 critical components | Pick: snapshot-to-streaming handoff, exactly-once semantics, or schema evolution handling. Go deep on internals. |
| 30-40 min | **Scale & Trade-offs** | Production challenges | WAL retention pressure, connector failover, large transaction handling, multi-source coordination |
| 40-45 min | **Wrap Up** | Summary + operational concerns | Monitoring (lag metrics), security (WAL access = full data access), compliance (GDPR propagation via CDC) |

---

## Meta-Commentary

### What Makes This System Unique/Challenging

1. **The dual-write problem is the genesis:** CDC exists because writing to a database AND publishing an event is fundamentally unsafe without distributed transactions. CDC eliminates the dual-write by making the database's own transaction log the single source of truth for both the mutation and the event.

2. **The snapshot-to-streaming handoff is the hardest problem:** Getting the initial full-table snapshot to seamlessly merge with the live streaming pipeline — without duplicates, gaps, or inconsistency — is the defining engineering challenge. Most CDC failures in production occur at this boundary.

3. **You are building a replication protocol:** CDC is conceptually identical to database replication. The connector is a replica that consumes the WAL and applies changes to a different target (a streaming platform instead of another database instance). Understanding database replication internals gives you the vocabulary for this design.

4. **WAL access is god-mode:** The transaction log contains every mutation to every table in the database. The security implications are profound — a compromised CDC connector has read access to the entire database's change history.

### Where to Spend Most Time

- **Log-based capture mechanics:** Explain WAL/binlog tailing vs. polling vs. triggers. This is the foundational design decision.
- **Snapshot-to-streaming handoff:** This is where most candidates fail. Show the consistent snapshot approach with LSN recording and deduplication at the boundary.
- **Exactly-once semantics:** Explain the combination of idempotent producers, transactional offset commits, and idempotent consumers. Do NOT claim that the streaming platform alone gives you exactly-once.

### How to Approach This Problem

1. Start with WHY CDC exists — the dual-write problem in distributed systems
2. Explain the log-based approach (WAL/binlog tailing) and why it is superior to polling/triggers
3. Design the event envelope (before/after images, source metadata, operation type)
4. Design the snapshot mechanism for initial load with consistent handoff to streaming
5. Address offset management and exactly-once delivery
6. Discuss schema evolution and the role of the schema registry
7. Cover operational concerns: WAL retention, connector failover, monitoring

---

## Trade-offs Discussion

### Decision 1: Log-Based CDC vs. Query-Based CDC

| Aspect | Log-Based CDC | Query-Based CDC (Polling) |
|--------|--------------|--------------------------|
| Pros | Zero source impact; captures all changes including deletes; sub-second latency; preserves transaction order | Simpler setup; no replication configuration; works with any database |
| Cons | Requires database replication configuration; engine-specific log parsers; WAL retention management | Source query load; misses changes between polls; cannot capture deletes; higher latency |
| **Recommendation** | **Choose log-based** for any production system where completeness, latency, and source impact matter |

### Decision 2: Embedded CDC vs. Standalone CDC Platform

| Aspect | Embedded (in-process) | Standalone (distributed workers) |
|--------|----------------------|--------------------------------|
| Pros | No external infrastructure; lower operational overhead; simpler for single-service use | Fault isolation; independent scaling; centralized management; multi-source support |
| Cons | Tied to application lifecycle; single-threaded; limited monitoring | Additional infrastructure to manage; operational complexity |
| **Recommendation** | **Standalone** for production multi-service architectures. Embedded for prototypes or single-service use cases. |

### Decision 3: Per-Table Topics vs. Single-Database Topic

| Aspect | Per-Table Topics | Single-Database Topic |
|--------|-----------------|---------------------|
| Pros | Independent scaling; selective consumption; per-table retention; clear ownership | Preserves cross-table transaction order; simpler topic management |
| Cons | Many topics to manage; cross-table transactions split across topics | All consumers receive all tables' events; single partition ordering limit |
| **Recommendation** | **Per-table topics** with transaction metadata headers for consumers that need cross-table atomicity. This is the industry standard approach. |

### Decision 4: Full Snapshot vs. Incremental Snapshot (Watermark)

| Aspect | Full Snapshot (Lock-Based) | Incremental Snapshot (Watermark) |
|--------|--------------------------|--------------------------------|
| Pros | Simple consistency model; proven approach; snapshot transaction guarantees | No global lock; non-blocking; can snapshot individual tables on demand; interleaves with streaming |
| Cons | Requires long-running transaction; prevents vacuum; brief lock for LSN capture | More complex implementation; watermark coordination; chunk-boundary edge cases |
| **Recommendation** | **Full snapshot** for initial setup (simplicity). **Incremental watermark** for on-demand re-snapshots of individual tables in production without disrupting streaming. |

### Decision 5: Avro vs. Protobuf vs. JSON for Event Serialization

| Aspect | Avro | Protobuf | JSON |
|--------|------|----------|------|
| Pros | Compact binary; excellent schema evolution; native Kafka integration; dynamic schema | Very compact; strong typing; code generation; fast serialization | Human-readable; universal support; no compilation step |
| Cons | Requires schema registry; learning curve; dynamic typing can be loose | Requires .proto compilation; less dynamic schema support | Verbose; no built-in evolution rules; larger payload |
| **Recommendation** | **Avro as default** for CDC workloads. Schema registry integration, dynamic schema evolution (adding columns without recompiling consumers), and compact binary format make it the strongest fit. JSON for debugging environments. |

---

## Trap Questions & How to Handle

### Trap 1: "Why not just use database triggers for CDC?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test understanding of trigger overhead and limitations | Triggers execute synchronously within the transaction, adding latency to every write. A trigger-based CDC on a table with 10K writes/sec means 10K trigger executions per second, each potentially inserting into a separate events table within the same transaction. This doubles the write load and transaction size. Additionally, triggers must be maintained for every table (schema changes require trigger updates), they don't capture schema changes themselves, and they create tight coupling between the data model and the event model. Log-based CDC adds zero overhead to the source because it reads the log that the database already writes for its own durability. |

### Trap 2: "How do you guarantee exactly-once delivery?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test depth beyond "Kafka gives us exactly-once" | True end-to-end exactly-once requires three coordinated guarantees: (1) idempotent producer — the streaming platform deduplicates messages using producer ID + sequence number, (2) transactional offset commits — the connector's offset update and the event publish happen in a single atomic transaction within the streaming platform, and (3) idempotent consumer — the sink writes are idempotent using the event's primary key and offset as a deduplication key. No single component provides exactly-once alone — it is an end-to-end property of the pipeline. |

### Trap 3: "What happens when the connector falls behind the WAL?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test operational awareness of WAL retention | This is the most dangerous operational scenario in CDC. On PostgreSQL, a stalled replication slot prevents WAL recycling, and the WAL files accumulate indefinitely until the disk is full — at which point the database stops accepting ALL writes (total outage). Mitigations: (1) set `max_slot_wal_keep_size` to cap retention, (2) monitor replication slot lag with alerts at 1 GB and 10 GB thresholds, (3) implement automatic slot drop after a configurable retention limit (accepting that dropped events will require a re-snapshot), (4) use heartbeat events to advance the slot even when tables have no writes. On MySQL, the binlog simply expires after the configured retention period — if the connector is behind, events are permanently lost and a re-snapshot is needed. |

### Trap 4: "How do you handle the initial snapshot for a billion-row table?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test snapshot-to-streaming handoff understanding | The challenge is not just reading a billion rows — it is doing so while the source continues accepting writes and ensuring zero gaps or duplicates at the transition to streaming. Approach: (1) Open a REPEATABLE READ transaction and record the current LSN — this gives us a consistent point-in-time view. (2) Read the table in chunks (ordered by primary key, 10K rows per chunk) to avoid holding a massive result set in memory. (3) Persist chunk progress so we can resume if the snapshot is interrupted. (4) After all chunks are read, commit the transaction and start streaming from the recorded LSN. (5) At the handoff, deduplicate: events from the WAL between the snapshot LSN and the streaming start are compared against the snapshot — if the snapshot already captured the newer state, the WAL event is skipped. For tables so large that a single transaction is impractical, use the watermark-based incremental snapshot approach (Netflix DBLog pattern). |

### Trap 5: "How do you handle schema changes in the middle of streaming?"

| What Interviewer Wants | Best Answer |
|------------------------|-------------|
| Test schema evolution understanding | DDL changes (ALTER TABLE) appear in the transaction log interleaved with data changes. The connector must: (1) detect the DDL from the log, (2) parse the new schema, (3) check compatibility with the schema registry (backward/forward/full), (4) register the new schema version, (5) use the correct schema version for each event based on the event's LSN position (events before the DDL use the old schema, events after use the new schema). The schema history store, keyed by LSN, ensures this mapping is correct. If the schema change is incompatible (e.g., dropping a required column), the connector should halt or route events to a dead-letter topic rather than silently corrupting the data stream. |

---

## Common Mistakes to Avoid

| Mistake | Why It's Wrong | Better Approach |
|---------|---------------|-----------------|
| Proposing polling-based CDC | Misses deletes, adds source load, higher latency | Start with log-based CDC; explain WAL/binlog tailing |
| Ignoring the snapshot-to-streaming handoff | This is the hardest part; skipping it suggests lack of production experience | Design the snapshot mechanism with LSN recording and deduplication |
| Saying "Kafka gives us exactly-once" | Exactly-once is an end-to-end property, not a transport property | Explain idempotent producer + transactional offsets + idempotent consumer |
| Not discussing WAL retention | The #1 operational risk in production CDC | Address disk pressure, slot monitoring, heartbeat events early |
| Ignoring schema evolution | Schema changes are inevitable and can break the pipeline | Design schema registry integration with compatibility rules |
| Treating CDC as a simple connector | CDC has deep database internals (WAL format, logical decoding) | Show understanding of database replication mechanics |
| No before-image discussion | Before-images are essential for updates and deletes | Include before/after images in the event envelope design |

---

## Questions to Ask Interviewer

| Question | Why It Matters |
|----------|---------------|
| What source databases? (PostgreSQL, MySQL, MongoDB?) | Determines log format (WAL, binlog, oplog) and connector architecture |
| What downstream consumers? | Determines delivery guarantees and topic design |
| What latency requirements? | Sub-second requires log-based CDC; minutes allows polling |
| What is the write throughput? | Determines connector sizing and streaming platform capacity |
| Are there very large tables that need initial snapshot? | Determines snapshot strategy (full vs. incremental) |
| How often do schema changes happen? | Determines schema evolution strategy priority |
| Any compliance requirements? (GDPR, HIPAA) | Determines PII masking and audit requirements |
| Is this single-tenant or multi-tenant? | Determines topic namespace and isolation strategy |

---

## Quick Reference Card

```
CDC SYSTEM DESIGN CHEATSHEET
──────────────────────────────
Capture: Log-based (WAL/binlog tailing) — zero source impact
Envelope: op (c/u/d/r) + before + after + source metadata + schema
Snapshot: REPEATABLE READ txn + record LSN + chunked SELECT + handoff dedup
Offsets: Transactional commit (events + offset in single atomic write)
Exactly-Once: Idempotent producer + transactional offsets + idempotent consumer
Schemas: Registry with Avro + backward compatibility + LSN-keyed history
Topics: Per-table ({server}.{db}.{table}) with PK-based partitioning
Streaming: Durable partitioned log with configurable retention
WAL Risk: Stalled slot → disk full → database outage
Key Metric: Replication lag (ms and bytes)
Key Trade-off: Snapshot consistency vs. source impact (locks vs. watermarks)
Heartbeat: Periodic writes to advance slot when tables are idle
```

---

## Red Flags in Candidate Responses

| Red Flag | What It Reveals | What to Look For Instead |
|----------|----------------|--------------------------|
| Proposes trigger-based CDC without acknowledging trade-offs | Doesn't understand source impact and operational overhead | Immediately identifies log-based approach as the correct starting point |
| Claims "zero data loss" without explaining exactly-once mechanics | Confuses transport guarantees with end-to-end semantics | Explains the three-layer exactly-once: idempotent producer + transactional offsets + idempotent consumer |
| Ignores the WAL retention problem entirely | No production experience with CDC | Proactively raises WAL disk pressure as the #1 operational risk |
| Designs CDC as a REST polling layer | Fundamental misunderstanding of CDC architecture | Understands that CDC reads the transaction log, not the tables |
| Treats all downstream consumers identically | Doesn't understand consumer heterogeneity | Designs per-consumer group configuration with different SLOs |
| No mention of schema evolution | Assumes schemas are static | Includes schema registry, compatibility rules, and DDL detection in the design |
| Proposes distributed transactions between source and streaming platform | Over-engineering; misunderstands the problem CDC solves | Uses the outbox pattern or transactional offset commits instead |

---

## Extended Discussion Topics

### Topic 1: When NOT to Build a CDC System

Not every data integration problem needs CDC. Discuss scenarios where CDC is overkill or inappropriate:

- **Low-volume, infrequent changes:** If a table changes < 100 times/day, a simple cron-based polling query is simpler and cheaper than maintaining CDC infrastructure.
- **No real-time requirement:** If downstream consumers only need daily updates, batch ETL (pg_dump, mysqldump, or SQL-to-parquet pipelines) is operationally simpler.
- **Application controls all writes:** If a single application owns all writes to a database and can reliably publish events in the same transaction (outbox pattern without CDC), the application-level approach may suffice — though CDC provides defense-in-depth.
- **Ephemeral data:** If the source data is transient (session stores, temporary caches), CDC adds overhead for data that has no downstream value.

### Topic 2: CDC as a Database Migration Tool

CDC enables zero-downtime database migrations: capturing changes from the old database and replaying them to the new database in real time. Key discussion points:

- **Cross-engine migrations** (PostgreSQL → MySQL or vice versa) require type mapping and schema translation in the CDC pipeline.
- **Cutover protocol:** Pause writes on old DB → verify CDC lag is zero → switch application to new DB → enable reverse CDC for rollback capability.
- **Verification:** Sample-based checksumming between source and target to verify data consistency before cutover.

### Topic 3: The Outbox Pattern and CDC's Role

The outbox pattern is the most common CDC use case in microservices. Discuss why CDC + outbox eliminates the dual-write problem:

- Application writes business data AND domain events to the same database transaction.
- CDC captures the outbox table and publishes events to the streaming platform.
- No dual write: the database transaction is the single source of truth.
- The outbox event schema can differ from the database schema — decoupling the internal model from the published contract.

### Topic 4: CDC vs. Event Sourcing

| Dimension | CDC | Event Sourcing |
|-----------|-----|---------------|
| Source of truth | Database state (tables) | Event log |
| Events derived from | Transaction log (post-hoc) | Application (first-class) |
| Schema coupling | Events reflect database schema | Events reflect domain model |
| Retrofit complexity | Can be added to existing systems | Requires rebuilding from scratch |
| Replay capability | Limited to WAL retention window | Unlimited (events are forever) |
| Application changes needed | None (reads existing WAL) | Complete rewrite of persistence layer |

**Key insight:** CDC is "event sourcing for free" — it generates events from existing database writes without application changes. The trade-off is that CDC events reflect the physical data model, not the domain model. For systems that need domain-aligned events, the outbox pattern bridges this gap.

---

## Extended Scoring Rubric

| Level | Score | Criteria |
|-------|-------|----------|
| **Junior** | 1-2 | Proposes polling or trigger-based CDC; no snapshot discussion; treats the streaming platform as the entire solution |
| **Mid-Level** | 3 | Log-based approach; basic snapshot design; mentions schema registry; discusses ordering at the topic level |
| **Senior** | 4 | Snapshot-to-streaming handoff with LSN coordination; exactly-once end-to-end; WAL retention management; schema compatibility levels |
| **Staff** | 5 | Watermark-based incremental snapshots; connector rebalancing protocol; multi-source ordering strategies; chaos engineering approach; production war stories |
| **Distinguished** | 6 | Designs CDC as a platform (multi-engine, multi-tenant); cross-region topology; database migration use case; back-pressure mechanisms; capacity planning formulas |

### Scoring Dimensions

| Dimension | Weight | What to Evaluate |
|-----------|--------|-----------------|
| **Database internals** | 25% | WAL/binlog understanding, logical decoding, replication slots, TOAST handling |
| **Distributed systems** | 25% | Exactly-once semantics, offset management, idempotency, transaction boundaries |
| **Operational awareness** | 20% | WAL disk pressure, connector failover, monitoring, capacity planning |
| **Schema governance** | 15% | Registry integration, compatibility rules, DDL detection, evolution strategies |
| **System design** | 15% | Component decomposition, data flow clarity, technology trade-offs, scalability approach |

---

## Deep Dive Prompts

Use these follow-up questions to probe deeper when candidates give surface-level answers:

| Initial Answer | Deep Dive Prompt | What You're Testing |
|---------------|-----------------|-------------------|
| "We use Kafka for CDC" | "Walk me through what happens to an event from the moment the application commits a transaction to the moment a downstream search index is updated" | End-to-end understanding vs. black-box thinking |
| "We do a snapshot first, then stream" | "What happens if a row is updated during the snapshot? How do you ensure the consumer doesn't see that update twice — or miss it entirely?" | Handoff mechanics: LSN recording, dedup logic, consistency guarantees |
| "Exactly-once is guaranteed" | "If the connector crashes after publishing an event but before committing the offset, what happens on restart? Walk me through the recovery." | Understanding of at-least-once window and idempotency role |
| "Schema changes are handled by the registry" | "A developer runs ALTER TABLE orders DROP COLUMN discount on production. What happens in the CDC pipeline in the next 5 seconds?" | DDL detection → compatibility check → connector behavior → consumer impact |
| "We monitor lag" | "The dashboard shows replication lag at 45 GB and growing. The source DB disk is at 82%. What do you do?" | Operational triage: diagnose root cause, assess blast radius, make drop-or-keep decision |

---

## Scenario-Based Deep Dives

### Scenario 1: "Design CDC for a 2-Billion-Row Table Snapshot"

**What to evaluate:** Does the candidate understand the limitations of long-running transactions and propose watermark/incremental approaches?

**Expected discussion points:**
- 2B rows × 1 KB = 2 TB to snapshot; at 50K rows/sec = ~11 hours
- REPEATABLE READ transaction held for 11 hours blocks vacuum → table bloat
- Should propose chunked reads by PK range with watermark tokens (DBLog approach)
- Must address: what happens if snapshot is interrupted at 1B rows? (checkpoint + resume)
- Must address: deduplication between snapshot chunks and concurrent WAL events

### Scenario 2: "CDC Connector Falls 6 Hours Behind During Peak Sale"

**What to evaluate:** Operational crisis response and recovery prioritization.

**Expected answer framework:**
1. **Immediate check:** WAL disk usage — is source DB at risk of outage?
2. **If WAL disk safe (< 70%):** Let connector catch up; it's behind but not dangerous. Estimated catch-up: (lag_events / connector_throughput) = recovery time
3. **If WAL disk at 80%+:** Critical decision — drop slot and accept re-snapshot, or throttle source writes
4. **Consumer impact:** Should downstream consumers skip ahead to latest? Or wait for catch-up?
5. **Prevention:** Pre-scale connectors and platform before known peak events; implement back-pressure controls

### Scenario 3: "Developer Adds NOT NULL Column Without Default"

**What to evaluate:** Understanding of schema evolution failure modes and registry behavior.

**Expected discussion:**
- This is backward-incompatible: existing events lack the new column; old consumers can't write a NOT NULL value
- Schema registry with BACKWARD compatibility will **reject** this schema
- Connector halts with compatibility error → lag starts growing
- **Correct approach:** ADD COLUMN with DEFAULT value, then backfill, then optionally add NOT NULL constraint
- The registry **prevented** a silent consumer failure — working as designed

---

## Candidate Self-Assessment Checklist

| # | Checkpoint | Strong Signal |
|---|-----------|---------------|
| 1 | Why is log-based CDC superior to triggers/polling? | Names zero source impact, complete capture, ordering, delete detection |
| 2 | Design the snapshot-to-streaming handoff | Describes LSN recording, dedup logic, watermark alternative |
| 3 | Explain exactly-once end-to-end | Names all three layers: producer + platform + consumer idempotency |
| 4 | Describe the WAL retention risk | Explains disk exhaustion cascade: stalled slot → WAL growth → DB outage |
| 5 | Design the event envelope | Includes op type, before/after images, source metadata, schema ID |
| 6 | Handle schema evolution | Describes registry compatibility modes and LSN-keyed schema history |
| 7 | Handle large transactions | Contrasts buffered vs. streaming approach with memory trade-offs |
| 8 | Design offset management | Describes transactional offset commits and idempotent recovery |
| 9 | Handle connector failover | Describes rebalancing, offset resume, at-least-once recovery window |
| 10 | Explain cross-source ordering | Notes no global clock, per-connector independence, consumer-side strategies |

---

## Quick Reference Card (Extended)

```
CDC SYSTEM DESIGN CHEATSHEET (v2)
──────────────────────────────────────

ARCHITECTURE:
  Capture: Log-based (WAL/binlog tailing) — zero source impact
  Envelope: op (c/u/d/r) + before + after + source metadata + schema
  Snapshot: REPEATABLE READ txn + record LSN + chunked SELECT + handoff dedup
  Offsets: Transactional commit (events + offset in single atomic write)
  Exactly-Once: Idempotent producer + transactional offsets + idempotent consumer
  Schemas: Registry with Avro + backward compatibility + LSN-keyed history
  Topics: Per-table ({server}.{db}.{table}) with PK-based partitioning

OPERATIONAL RISKS (ordered by severity):
  1. Stalled slot → WAL disk full → database outage (P0)
  2. Schema incompatibility → connector halt → growing lag (P1)
  3. Large transaction → memory exhaustion → connector OOM (P1)
  4. Snapshot interruption → inconsistent sink state (P2)
  5. Consumer lag → stale downstream views (P2)

KEY METRICS:
  #1 Replication lag (ms and bytes)
  #2 WAL disk usage (%)
  #3 Consumer group lag (messages and seconds)
  #4 Connector status + events/sec
  #5 Schema compatibility check results

KEY TRADE-OFFS:
  Snapshot: lock-based consistency vs. watermark non-blocking
  Exactly-once: commit frequency vs. at-least-once window
  Large txns: buffered atomicity vs. streaming memory safety
  Topics: per-table isolation vs. single-topic transaction order
  Serialization: Avro compactness vs. JSON readability

HEARTBEAT: Periodic writes to advance slot when tables are idle
OUTBOX: Domain events in same txn as data → CDC publishes → no dual write
```
