# Key Insights: Event Sourcing System

[← Back to Index](./00-index.md)

---

## Insight 1: The Global Position Sequencer Is the Hidden Throughput Ceiling

**Category:** Contention

**One-liner:** Every event must be assigned a monotonically increasing global position, creating a single serialization point that limits the entire system to ~50K events/sec with replicated persistence.

**Why it matters:** Event sourcing's append-only model appears infinitely scalable at first glance -- appends are cheap. But the requirement for a total ordering across all streams introduces a global sequencer that every write must coordinate through. An in-memory atomic counter handles ~1M increments/sec, but persisting and replicating that counter drops throughput to ~50K/sec. The mitigation options reveal a fundamental design choice: batch position assignment (fast but creates gaps), hierarchical ordering with `{epoch}.{partition}.{local_sequence}` (partitions the Slowest part of the process but loses strict global order), or accepting partial ordering (only guarantee order within a stream, use timestamps across streams). The choice between these options defines whether projections can make cross-stream causal guarantees.

**Architecture connection:** This is the same sequencer Slowest part of the process seen in distributed log-based brokers ([1.5](../1.5-distributed-log-based-broker/09-insights.md)) and distributed unique ID generators ([1.7](../1.7-distributed-unique-id-generator/09-insights.md)). The hierarchical ordering approach mirrors how Snowflake-style IDs partition the monotonicity requirement across nodes -- the fundamental trade-off between strict total ordering and horizontal scalability applies identically in both contexts.

**Production consideration:** Modern event stores (2025-era) increasingly default to per-partition ordering rather than global ordering, recognizing that cross-stream causal guarantees are rarely needed in practice. When they are, hybrid clocks (combining physical timestamps with logical counters) provide "good enough" ordering at ~10x the throughput of a strict global sequencer. The key question to ask: does your projection actually need cross-stream ordering, or does it only correlate events within a single aggregate?

---

## Insight 2: Out-of-Order Commits Are Invisible to the Writer but Catastrophic for Subscribers

**Category:** Consistency

**One-liner:** Two transactions that receive consecutive global positions (100, 101) may commit in reverse order if one has slower disk I/O, causing subscribers to see position 101 before 100.

**Why it matters:** This pitfall is subtle because the write path works correctly -- both events are durably stored with correct positions. The problem only manifests on the read path: a subscriber processing the global stream sees position 101 arrive before 100, violating causal ordering. If position 100 contains "OrderCreated" and 101 contains "ItemAdded" for the same order, the projection tries to add an item to a non-existent order. Solutions include serializing all writes through a single writer thread (simple but limits throughput), implementing gap detection in subscribers (complex but preserves write parallelism), or assigning positions at commit time rather than pre-assignment (positions unknown until commit, complicating the write protocol). The single-writer approach is surprisingly common in production event stores because the simplicity outweighs the throughput limitation for most workloads.

**Gap detection in practice:** The subscriber maintains a "high-water mark" and a gap buffer. When position 101 arrives but 100 has not, the subscriber parks 101 in a bounded buffer and waits (with timeout) for 100. If 100 arrives, both are processed in order. If the timeout expires, the subscriber must decide: skip the gap (data loss risk), keep waiting (lag increases), or alarm and pause (operational intervention). Each choice has different failure modes, and the correct answer depends on whether the gap represents a slow commit (transient) or a failed write (permanent). Modern event stores expose a "committed position" that only advances when all positions up to that point are durably committed, giving subscribers a safe watermark to follow.

**Connection to CDC:** This exact problem appears in change data capture ([16.8](../16.8-change-data-capture-system/09-insights.md)) where the transaction log may expose rows in commit order, not statement order. The solutions converge: a single serialization point or a monotonic committed-position watermark.

---

## Insight 3: Snapshot Schema Evolution Is the Sleeper Complexity That Breaks Production Deploys

**Category:** Consistency

**One-liner:** When an aggregate's state schema changes, all existing snapshots become incompatible, forcing a choice between lazy migration (version each snapshot), mass invalidation (performance cliff), or background re-snapshotting (resource intensive).

**Why it matters:** Event schema evolution through upcasting is well-documented, but snapshot schema evolution is often overlooked until it causes an incident. Snapshots store serialized aggregate state, and when that state's structure changes (new field, renamed property, restructured object), old snapshots cannot be deserialized into the new schema. Lazy migration -- storing a schema version with each snapshot and converting on load -- is the most practical approach but accumulates technical debt as version chains grow. Mass invalidation is clean but causes a thundering herd of full replays when many aggregates are loaded simultaneously. The non-obvious best practice is to combine lazy migration for normal operations with background re-snapshotting during off-peak hours, preventing version chain accumulation.

**The thundering herd scenario:** Consider a deployment that changes the order aggregate schema. If all 10M order snapshots are invalidated, the next day's traffic forces 10M full replays (average 20 events each = 200M event reads). At 50K reads/sec, the event store needs over an hour just to serve snapshot rebuilds -- during which normal command processing competes for the same read capacity. The result is cascading latency spikes that look like an infrastructure failure but are actually a schema migration side effect. Canary deployments with gradual snapshot invalidation (invalidate 1% per hour) spread the replay load over time, preventing the thundering herd.

**Snapshot format best practice:** Use a forward-compatible serialization format (such as a schema registry with additive-only changes) for snapshots from day one. Adding fields with defaults is always safe; removing or renaming fields requires versioned migration. This mirrors the event schema evolution strategy but is often neglected because snapshots are viewed as "just a cache" rather than a first-class schema concern.

---

## Insight 4: Hot Aggregates Require Sharding the Aggregate Itself, Not Just the Event Store

**Category:** Scaling

**One-liner:** A popular product with 10,000 inventory updates per second generates 864M events per day in a single stream, causing constant version conflicts and unbounded replay times that no amount of snapshotting can fix.

**Why it matters:** Event sourcing assigns one stream per aggregate instance, so a hot aggregate like a global inventory counter becomes a single-stream Slowest part of the process. Optimistic concurrency means every concurrent write to the same stream version conflicts and retries, creating retry storms. The stream length grows without bound, and even with aggressive snapshots, the backlog between snapshots accumulates. The architectural response is to shard the aggregate itself (e.g., `inventory-product-popular-shard-1` through `shard-N`), distributing writes across independent streams and aggregating reads. Alternatively, for pure counter workloads, the counter should not be event-sourced at all -- use an atomic increment in a dedicated read model. This insight generalizes: event sourcing is not appropriate for all state shapes within the same system.

**Conflict rate math:** With N concurrent writers hitting the same stream, the probability of conflict per attempt is approximately `1 - (1/N)`. At 100 concurrent requests, each write has a ~99% chance of conflicting. With 3 retry rounds, only ~3% of requests succeed, and the rest generate load that worsens the problem. The breaking point for optimistic concurrency on a single stream is typically 10-20 concurrent writers -- beyond that, the retry storm dominates latency. Sharding to `K` sub-aggregates reduces per-shard concurrency to `N/K`, but requires a merge step in projections.

**The hybrid pattern:** The most successful production systems use event sourcing selectively within the same domain. Order lifecycles (low contention, high audit value) are fully event-sourced. Inventory counters (high contention, low audit value) use atomic decrements with CDC-based projections. The saga pattern ([1.17](../1.17-distributed-transaction-coordinator/09-insights.md)) coordinates between the two models, and the read model aggregates both sources.

---

## Insight 5: The Subscription Lag Spiral Is a Positive Feedback Loop That Leads to OOM Kills

**Category:** Resilience

**One-liner:** When a projection falls behind, buffer accumulation causes memory pressure, which triggers GC pauses, which slows processing further, which increases lag -- a vicious cycle that often ends in OOM termination and checkpoint rollback.

**Why it matters:** This failure mode is particularly insidious because it is self-reinforcing. A traffic spike causes the projection to process events slower than they arrive. The subscriber buffers unprocessed events in memory. Buffer growth triggers garbage collection pressure. GC pauses slow processing. The gap widens. Eventually, either memory is exhausted (OOM kill) or the subscription times out and reconnects -- from the last checkpoint, re-adding already-buffered events to the backlog. Prevention requires multiple complementary mechanisms: monitoring lag with early alerting, auto-scaling projection workers before the spiral begins, implementing backpressure to slow event production when projections cannot keep up, and circuit-breaking projections that fall too far behind rather than letting them continue accumulating buffers.

**Backpressure design:** The ideal backpressure mechanism is a bounded subscription buffer with blocking reads. When the buffer fills, the event store stops pushing events to that subscriber (not to other subscribers). This limits memory growth but introduces a new failure mode: if one slow projection blocks the buffer, the event store must decide whether to apply backpressure to the writer (reducing system throughput) or to disconnect the slow subscriber (causing a lag cliff). The pragmatic approach is tiered: buffer up to 10K events in memory, then write overflow to local disk, then disconnect if disk buffer exceeds a threshold. This gives slow projections time to recover from transient slowdowns while preventing unbounded resource consumption.

**Lag alerting strategy:** Alert on the derivative of lag, not the absolute value. A projection that is 5,000 events behind but closing the gap at 100 events/sec is healthy. A projection that is 500 events behind but the gap is widening at 50 events/sec will be dead in minutes. Rate-of-change alerting catches the spiral before it becomes critical, giving operators time to scale up projection workers or apply backpressure.

---

## Insight 6: Upcasting Chains Transform Schema Evolution from a Migration Problem into a Code Maintenance Problem

**Category:** System Modeling

**One-liner:** Instead of migrating stored events (which are immutable), register upcaster functions that transform old event versions to the current version on read, creating a chain (V1 to V2 to V3) that grows with every schema change.

**Why it matters:** The immutability of the event log -- the very property that makes event sourcing valuable for audit trails -- means you can never "fix" old events in place. Upcasting elegantly solves this by applying transformation functions at read time: a V1 event with `customerName: "John Doe"` is transformed by an upcaster that splits it into `customer: {firstName: "John", lastName: "Doe"}` for V2. But the chain accumulates: after 10 schema versions, reading a V1 event requires applying 9 upcasters sequentially. This is manageable if upcasters are pure functions (no I/O, no external dependencies), but becomes a testing and maintenance burden over time. The practical limit is ~5-8 versions before teams reach for copy-and-transform (creating a new event type), which is cleaner but adds events to the stream.

**Testing upcaster chains:** The combinatorial complexity of upcasting is often underestimated. With 5 event types and 3 schema versions each, there are 15 upcasting paths to test. With 10 types and 5 versions, the number reaches 50. The most effective testing strategy is property-based: generate random events at random versions, apply the upcaster chain, and verify the output matches the current schema. This catches edge cases (null fields in V2 that did not exist in V1, renamed enums, changed numeric precision) that hand-written tests miss.

**The copy-and-transform escape hatch:** When the upcaster chain reaches 5-8 versions, teams should create a new event type that supersedes the old one. A one-time migration projection reads old events through the upcaster chain and emits new-type events. The old event type is then frozen (no new code references it), and the upcaster chain becomes dead code that can eventually be removed. This is the event sourcing equivalent of a database migration -- the key difference is that both old and new events coexist in the log, and projections must handle both until the old events are archived.

---

## Insight 7: Transactional Checkpointing Eliminates the At-Least-Once Processing Problem for Projections

**Category:** Atomicity

**One-liner:** Wrapping the read model update and checkpoint advance in a single database transaction ensures that a crash between processing and checkpointing does not cause duplicate event application.

**Why it matters:** The naive projection loop -- process event, then update checkpoint -- has a failure window: if the process crashes after applying the event to the read model but before persisting the checkpoint, the event will be reprocessed on restart. For idempotent operations (setting a field to a value), this is harmless. For non-idempotent operations (incrementing a counter, appending to a list), it corrupts the read model. Transactional checkpointing (`BEGIN; UPDATE read_model; UPDATE checkpoint; COMMIT;`) closes this window entirely. When the read model and checkpoint live in different databases, the alternative is to store the last processed position directly in the read model row and skip events at or below that position.

**Cross-database checkpointing:** When the read model is in a search engine, graph database, or cache that does not support transactions with the checkpoint store, the best option is embedding the checkpoint in the read model itself. For a search index, store the last processed global position as a field in a dedicated checkpoint document. On startup, read this document to determine the resume position. The projection becomes "at-least-once with idempotent handling" rather than truly exactly-once, but this is acceptable because most read model operations can be made idempotent with upsert semantics.

**Connection to CQRS:** This pattern is the mechanical core of CQRS projections ([1.19](../1.19-cqrs-implementation/09-insights.md)). The dual-write problem -- updating both a read model and a checkpoint without losing one -- is the same fundamental challenge as the transactional outbox pattern. The outbox solves it for event publishing; transactional checkpointing solves it for event consumption. Both exploit the same insight: colocate the two writes in the same database to get transactional atomicity for free.

---

## Insight 8: Blue-Green Projections Enable Zero-Downtime Rebuilds of Read Models

**Category:** Resilience

**One-liner:** Building a new projection alongside the existing one, catching up to live, then atomically switching traffic eliminates the maintenance window traditionally required for projection rebuilds.

**Why it matters:** Projection rebuilds are operationally painful: processing 100M events at 10K/sec takes 2.7 hours, during which the read model is either stale or unavailable. Blue-green deployment of projections -- running the new projection in parallel while the old one serves traffic, then switching once the new one is caught up -- solves this but introduces its own complexity: you need to handle events written during the rebuild window (the new projection must process both historical and live events), coordinate the switchover atomically, and manage the resource overhead of running two projections simultaneously. This pattern is directly borrowed from blue-green application deployment and is one of the most operationally important techniques in event-sourced systems.

**The switchover race condition:** The critical moment is the cutover. The old projection is serving traffic at position N. The new projection has caught up to position N-50 (50 events behind). If you switch traffic now, users briefly see stale data. The solution is to monitor the lag between old and new projections, and only switch when the delta drops below a threshold (e.g., 10 events, which represents <1 second of real time). A load balancer health check on the new projection's "caught-up" status automates this -- the new projection reports healthy only when its lag is below threshold, and the load balancer routes traffic to healthy targets.

**Resource planning:** Running two projections doubles the read model storage and processing capacity during the rebuild. For large projections (terabytes of read model data), this requires pre-provisioned capacity. The 2025 best practice is to maintain permanent "warm standby" projection infrastructure at 50% capacity, scaling up to 100% only during rebuilds. This amortizes the cost of blue-green readiness across normal operations, where the standby can serve read replicas.

---

## Insight 9: Optimistic Concurrency on Stream Version Is the Natural Conflict Resolution for Event Sourcing

**Category:** Consistency

**One-liner:** Each event append includes an expected stream version; if the actual version has advanced (another write occurred), the append fails with a concurrency conflict, forcing the command to reload, re-evaluate, and retry.

**Why it matters:** Unlike traditional databases where optimistic concurrency requires manually adding version columns, event sourcing has it built in: the stream version is the count of events, and appending with an expected version is a natural CAS operation. What makes this non-obvious is the retry strategy: the command must be re-executed against the new aggregate state (not simply re-submitted), because the new events may have changed the preconditions. For example, "add item to cart" may succeed after retry, but "set price to $10" may conflict with a concurrent "set price to $15" and require user intervention. The choice between auto-retry (commutative operations), merge (CRDT-like semantics), and fail-to-user (conflicting operations) must be made per-command, not globally.

**Command classification framework:** In production systems, each command should be explicitly classified as one of three conflict resolution strategies:

1. **Auto-retry (commutative):** The command's effect is independent of current state. "Add item to cart" works regardless of what other items are present. On conflict, reload and retry automatically (bounded to 3-5 attempts).
2. **Merge (CRDT-compatible):** The command can be mechanically merged with the conflicting change. "Set field X to value Y" and "set field Z to value W" affect independent fields. On conflict, apply both changes.
3. **Fail-to-user (conflicting):** The command cannot be safely retried because the conflicting change may have invalidated the precondition. "Accept order" conflicts with "cancel order" -- the user must decide. Return the conflict to the caller with both the expected and actual state.

This classification is a design-time decision, not a runtime Practical rule of thumb. Frameworks that treat all conflicts identically (always retry, or always fail) miss the nuance that conflict resolution is domain-specific.

---

## Insight 10: Read-Your-Writes Consistency Bridges the Gap Between Eventual Consistency and User Expectations

**Category:** Consistency

**One-liner:** Returning a position token from the write path and passing it to the query path, where the server waits for the projection to reach that position, gives users the illusion of strong consistency without sacrificing async projection benefits.

**Why it matters:** The most common user complaint in eventually consistent systems is "I just created this order but it's not in my order list." Pure eventual consistency is correct but feels broken. Synchronous projections fix this but sacrifice throughput. Read-your-writes consistency threads the needle: the command returns the global position of the written event, the client passes this as a `minVersion` parameter on subsequent queries, and the query API waits (with timeout) for the projection to reach that position before returning. Other users may see slightly stale data (which is acceptable), but the acting user always sees their own mutations. This is the same principle behind consistent reads in key-value stores ([1.3](../1.3-distributed-key-value-store/09-insights.md)) and synchronous replication modes -- targeted consistency where it matters most.

**Implementation detail -- the wait mechanism:** The query API must implement a blocking wait with timeout. The simplest approach is polling the projection checkpoint at short intervals (10-50ms) until it reaches the target position. More efficient approaches use database LISTEN/NOTIFY or an in-memory condition variable that the projection signals after each batch commit. The timeout must be chosen carefully: too short (100ms) and users see "try again" errors during load spikes; too long (10s) and the thread is tied up, creating a thread pool exhaustion risk. A 2-second timeout with a "data may be slightly delayed" fallback response is the sweet spot for most applications.

**Token propagation:** In single-page applications, the position token should be stored in client-side state (not cookies) and passed on every subsequent query until a newer token replaces it. This handles the common pattern where a user creates an order, navigates to the order list, and expects to see it. The client automatically "upgrades" its expected position with every write, ensuring that all subsequent reads reflect at least the user's own changes. Server-side rendering requires session-scoped token storage instead.

---

## Insight 11: Crypto-Shredding Is the Only GDPR-Compatible Approach That Preserves Event Immutability

**Category:** Security

**One-liner:** Encrypting personally identifiable fields within events using per-user keys, then destroying the key on erasure request, renders PII unreadable without modifying or deleting any event -- preserving the append-only guarantee while satisfying the right to be forgotten.

**Why it matters:** Event sourcing's immutability is its greatest strength and its greatest GDPR liability. Article 17 requires that organizations erase personal data on request, but deleting or modifying events breaks the fundamental Rule that never changes that the event log is an immutable, append-only record. Crypto-shredding resolves this tension by separating the data plane from the key plane. Each user's PII fields are encrypted with a user-specific key stored in a separate key management service. When the user requests erasure, the key is deleted. The events remain intact (preserving ordering, checksums, and replay capability), but the PII fields are now indistinguishable from random bytes. Projections built after key deletion produce anonymized read models automatically.

**The cascade problem:** Crypto-shredding is straightforward for events that directly contain user PII, but complex when PII is embedded in cross-aggregate events. An "OrderShipped" event in the order stream contains the customer's shipping address. A "ReviewPosted" event contains the reviewer's display name. When the user requests erasure, the system must enumerate all streams that contain that user's PII -- not just the user's own stream. This requires a PII index: a mapping from `user_id` to all `(stream_id, event_position)` tuples containing that user's data. Building and maintaining this index is a projection itself, and its completeness determines whether erasure is actually complete.

**Compliance audit trail:** Paradoxically, the erasure itself must be auditable. Regulations require proof that erasure was performed. The solution is to emit an "ErasurePerformed" event (containing the user ID but no PII) that serves as an audit record. This event triggers projections to rebuild without the shredded data, and provides regulators with evidence that the system honored the erasure request. The key deletion timestamp, combined with the erasure event, forms the compliance proof. See the security and compliance deep dive in ([06](./06-security-and-compliance.md)) for implementation details.

---

## Insight 12: Event Sourcing with Serverless Functions Inverts the Cost Model from Provisioned Capacity to Per-Event Pricing

**Category:** Cost Optimization

**One-liner:** Serverless projections charge per event processed rather than per server-hour, making event sourcing dramatically cheaper for bursty workloads but dangerously expensive for sustained high-throughput or replay-heavy scenarios.

**Why it matters:** The traditional cost model for event-sourced systems assumes provisioned infrastructure: event store clusters, projection worker fleets, and read model databases running 24/7. Serverless platforms invert this by charging per invocation. A projection that processes 25M events/day at $0.20 per million invocations costs ~$5/day ($150/month) -- far cheaper than dedicated projection workers. But a projection rebuild that replays 2 billion historical events costs $400 in a single operation. And sustained high throughput (50K events/sec) generates $864/day in invocation costs alone, quickly exceeding provisioned alternatives.

**The replay cost trap:** The most dangerous cost scenario is the feedback loop between projection rebuilds and serverless billing. A bug in projection logic is discovered, requiring a full rebuild. The rebuild processes 2B events, costing $400. A second bug is found, requiring another rebuild -- another $400. In a single incident, rebuild costs can exceed months of normal operation. The mitigation is hybrid: use serverless for live event processing (low steady-state cost) but maintain a dedicated batch processing cluster for replays (predictable cost, higher throughput).

**Architectural pattern -- event-driven serverless:** The integration pattern that works best combines a managed event store (or log-based broker) with serverless function triggers. Each new event triggers a function invocation that updates the read model. The function is stateless and idempotent. The event store's subscription mechanism handles checkpointing. This pattern is particularly effective for systems with many read models (each implemented as a separate function) and infrequent write traffic (chatbot analytics, IoT device registrations, user preference tracking). For these workloads, serverless event sourcing costs 80-90% less than provisioned infrastructure while providing infinite horizontal scaling during traffic spikes.

**Connection to message queues:** Serverless projection triggers are functionally identical to consumer functions on a message queue ([1.6](../1.6-distributed-message-queue/09-insights.md)). The event store's subscription mechanism acts as the queue, and the serverless function acts as the consumer. The key difference is the replay guarantee: a message queue typically discards consumed messages (or retains them with TTL), while the event store retains all events forever, enabling projection rebuilds that message queues cannot support.
