# Key Insights: CQRS Implementation

[← Back to Index](./00-index.md)

---

## Insight 1: The Dual-Write Problem Is the Single Biggest Source of Data Loss in CQRS Systems
**Category:** Atomicity
**One-liner:** Writing to the database and then publishing to the message broker in two separate operations creates a failure window where the DB succeeds but the event is lost, making the read model permanently diverge from reality.
**Why it matters:** This is not an Edge Case (Unusual or extreme situation) -- it is the default failure mode when CQRS is implemented naively. If the application writes to the write database and then crashes before publishing the event to the broker, the read models never receive the update. The system is now silently inconsistent with no mechanism for self-healing. Three solutions exist, each with distinct trade-offs: the outbox pattern (write event to an outbox table in the same DB transaction, relay asynchronously), CDC via Debezium (read the database WAL directly, no application code changes), or using an event store as the single source of truth (single write, built-in pub/sub). The outbox pattern is the most commonly adopted because it requires no infrastructure changes and provides explicit control over event shape.

**Architecture connection:** This dual-write problem is the same failure mode that [1.18 Event Sourcing](../1.18-event-sourcing-system/00-index.md) solves structurally -- by making the event stream the single source of truth, there is no second write to fail.

**2025-2026 development:** Debezium 3.x's outbox event router has become the standard CDC-based solution, reading structured events directly from outbox tables via the WAL without any polling. Netflix's Tudum platform (serving 20M users) migrated from CQRS with Kafka+Cassandra to CQRS with in-memory RAW Hollow, demonstrating that the synchronization mechanism underneath CQRS can vary dramatically based on dataset characteristics while the architectural pattern remains constant.

---

## Insight 2: Partition by Aggregate ID Is the Only Reliable Way to Guarantee Event Ordering for Projections
**Category:** Consistency
**One-liner:** Without partitioning events by aggregate ID, events for the same order can land on different broker partitions, arrive out of order, and corrupt the read model -- an ItemAdded event processed before its OrderCreated event creates an orphaned update.
**Why it matters:** Message brokers only guarantee ordering within a partition, not across partitions. If CQRS events are partitioned randomly (round-robin) or by event type, events for the same aggregate may cross partitions. The projection for "Order 123" sees ItemAdded(v2) before OrderCreated(v1), tries to update a non-existent row, and either fails silently or creates a partial record. Partitioning by aggregate ID (the event's `aggregateId` as the partition key) ensures all events for one aggregate flow through one partition and are processed sequentially by one consumer. This is a hard constraint, not an optimization -- violating it produces data corruption that is difficult to detect and repair.

---

## Insight 3: Version-Aware Projections with Event Buffering Handle Out-of-Order Delivery Gracefully
**Category:** Resilience
**One-liner:** When a projection receives an event at version N but the read model is at version N-2, it buffers the event and retries after a delay, processing it only when the gap is filled by the missing intermediate event.
**Why it matters:** Even with aggregate-ID-based partitioning, network delays and redeliveries can cause events to arrive out of sequence. A version-aware projection handler checks: if `currentVersion < expectedVersion` (gap detected), buffer the event; if `currentVersion >= event.version` (already processed), skip it (idempotent); otherwise, apply it and drain the buffer. This three-way check transforms a fragile projection into a self-healing one. The buffered-event retry with a short delay (100ms) handles transient reordering, while a timeout on the buffer prevents indefinite waiting on truly lost events. This pattern adds modest complexity but eliminates an entire class of data integrity issues.

---

## Insight 4: LISTEN/NOTIFY on the Outbox Table Reduces Projection Lag from 50ms Average to Near-Zero
**Category:** Caching
**One-liner:** Instead of polling the outbox table every 100ms (average 50ms latency), a PostgreSQL trigger fires NOTIFY on INSERT, waking the relay process immediately, with polling as a reliability fallback.
**Why it matters:** The outbox relay's polling interval directly determines minimum projection lag. At 100ms polling, the average lag is 50ms -- acceptable for most use cases but noticeable for real-time UIs. Push-based notification via PostgreSQL's LISTEN/NOTIFY mechanism reduces this to sub-millisecond: a trigger on the outbox table fires NOTIFY with the event ID, and the relay process, listening on that channel, wakes immediately to fetch and publish. The critical detail is that NOTIFY is not guaranteed (it can be lost if the relay is disconnected), so polling must remain as a fallback. This dual-mode approach (push for speed, poll for reliability) is a pattern that recurs whenever you need both low latency and guaranteed delivery.

---

## Insight 5: Synchronous Projection for Critical Paths, Async for Everything Else
**Category:** Consistency
**One-liner:** A hybrid projection mode -- where a few critical read models are updated in the same transaction as the write (strong consistency) while most projections process asynchronously (eventual consistency) -- balances correctness with throughput.
**Why it matters:** The binary choice between "all sync projections" (low throughput, high consistency) and "all async projections" (high throughput, stale reads) is a false dichotomy. In practice, only a few projections need immediate consistency: the user's own order status, an account balance after a transfer, or inventory count during checkout. These critical projections can be updated in the same database transaction as the write (`BEGIN; UPDATE orders; UPDATE order_list_view; COMMIT;`), while analytics dashboards, search indexes, and recommendation models project asynchronously. This per-projection consistency policy mirrors how managed NoSQL databases offer both strongly consistent and eventually consistent read modes -- let the caller choose the trade-off at the point of use.

**Production consideration:** The number of synchronous projections directly impacts write latency. Each sync projection adds 2-5ms to the write path. Beyond 3-4 sync projections, the cumulative latency penalty often exceeds acceptable thresholds, forcing a migration to async with client-side optimistic updates (see Insight 6).

---

## Insight 6: Read-After-Write Staleness Is Best Solved at the Client, Not the Server
**Category:** Consistency
**One-liner:** After a successful command, the client optimistically updates the UI with the expected new state and maintains a local pending-items list that merges with server results until the projection catches up.
**Why it matters:** The classic CQRS problem -- "I just created an order but it's not in my list" -- has both server-side and client-side solutions. Server-side approaches include: (1) the position token pattern, where the command returns a global event position and the query API blocks until the projection reaches that position (with a 2-second timeout and "data may be slightly delayed" fallback); (2) reading directly from the command database for single-entity GET-by-ID queries; and (3) constructing the response directly from the command data without waiting for the projection.

Client-side optimistic updates provide instant perceived responsiveness without server changes: after the command succeeds, the client adds the new order to a local pending list and merges it into the displayed results. When subsequent server fetches include the order (projection has caught up), it is removed from the pending list. The 2025 consensus is that client-side optimistic updates handle the 99% case, with position tokens as a server-side fallback for critical-path reads where optimistic updates would be misleading (e.g., account balances after transfers).

---

## Insight 7: SELECT FOR UPDATE SKIP LOCKED Enables Parallel Outbox Relays Without Double Publishing
**Category:** Contention
**One-liner:** Multiple outbox relay workers can process events in parallel by using `SELECT ... FOR UPDATE SKIP LOCKED`, where each worker locks a subset of unpublished rows and skips rows already locked by other workers.
**Why it matters:** A single outbox relay process is a throughput Slowest part of the process. Running multiple relay instances without coordination causes double-publishing (both instances read the same unpublished event). Traditional approaches -- sharding the outbox or partitioning by relay instance -- add complexity. `SKIP LOCKED` is an elegant database-level solution: each relay worker's SELECT locks the rows it fetches, and concurrent workers skip those locked rows, naturally dividing the work. Combined with adaptive backoff (increase sleep interval when no events are found), this creates a self-balancing pool of relay workers that scales horizontally without explicit coordination or partition management.

---

## Insight 8: Blue-Green Projection Deployment Eliminates the Rebuild Maintenance Window
**Category:** Resilience
**One-liner:** Building a new projection in the background while the old one serves traffic, then performing an atomic traffic switch once the new projection has caught up to live, achieves zero-downtime projection schema changes.
**Why it matters:** Projection rebuilds from 100M events can take hours. During a traditional rebuild, the read model is either unavailable (unacceptable) or serving stale data (confusing). Blue-green deployment of projections -- running old and new projections simultaneously against the same event stream, with traffic routed to the old until the new is caught up -- eliminates this window entirely. The new projection processes the historical backlog at its own pace, transitions to live processing, and traffic is switched once lag reaches zero. This requires double the read-model infrastructure temporarily, but the operational benefit (no maintenance windows, rollback is simply switching back) makes it the standard approach for mature event-sourced systems.

**2025-2026 development:** Modern frameworks now automate this pattern. The Marten/Wolverine "Critter Stack" in .NET supports true blue-green projection deployment where both old and new projection versions run simultaneously, with automatic distribution of projection work across cluster nodes and seamless cutover when the new version catches up. Stream compacting (compressing long-lived aggregate event histories into snapshots) further reduces rebuild times by 5-10x for aggregates with thousands of events.

---

## Insight 9: Denormalizing Data into Events Prevents N+1 Query Problems in Projections
**Category:** Scaling
**One-liner:** Including all necessary context (customer name, product title, etc.) directly in the domain event eliminates the need for projections to query other services during processing, converting a network-bound operation into a pure data transformation.
**Why it matters:** A common projection performance pitfall is enrichment: the `OrderCreated` event contains only `customerId` and `productId`, so the projection must query the Customer and Product services to populate the denormalized read model. At 10,000 events/sec, this means 10,000 network calls/sec per enrichment dimension -- an N+1 problem at the infrastructure level. By including denormalized data in the event itself (`customerName`, `productTitle`, `unitPrice` at the time of the event), the projection becomes a pure function from event to read model update, with no external dependencies. The trade-off is larger events and potential staleness of denormalized data, but for projections, point-in-time accuracy (what was the customer's name when they ordered) is often more valuable than current accuracy.

---

## Insight 10: The Outbox Pattern Combined with CDC Provides the Best of Both Worlds for Event Distribution
**Category:** Streaming
**One-liner:** Writing events to an outbox table gives explicit control over event shape and schema, while CDC (Debezium reading the WAL) provides the relay mechanism without polling overhead or application-level complexity.
**Why it matters:** Pure outbox with application-level polling has two weaknesses: polling latency and relay process management. Pure CDC without an outbox reads raw database changes (INSERT/UPDATE/DELETE on business tables), which couples event consumers to the write model's physical schema. The hybrid approach writes structured, versioned events to a dedicated outbox table (giving producers full control over the event contract), then uses CDC to capture those outbox inserts from the WAL (eliminating polling entirely). This provides the explicit event design of the outbox pattern with the zero-latency, zero-polling characteristics of CDC. Debezium's connector for this exact pattern (outbox event router) has become a standard component in production CQRS architectures.

**Architecture connection:** This hybrid CDC+outbox approach is the same pattern used for event distribution in [1.18 Event Sourcing](../1.18-event-sourcing-system/00-index.md) systems that bridge to non-event-sourced consumers.

**2025-2026 development:** Streaming databases like RisingWave are emerging as an alternative to custom projection code. These systems continuously ingest events and maintain incrementally-updated materialized views with sub-100ms freshness, effectively automating the projection-building process. Instead of writing projection handlers, engineers define SQL materialized views that the database keeps current. This shifts the complexity from application code to infrastructure, trading customization flexibility for dramatically reduced development effort.

---

## Insight 11: Multi-Tenant CQRS Requires Tenant-Aware Projection Isolation Without Per-Tenant Infrastructure

**Category:** Partitioning
**One-liner:** Sharing projection infrastructure across tenants while isolating data requires tenant-scoped event streams, per-tenant projection checkpoints, and tenant-aware read model schemas -- not separate databases per tenant.

**Why it matters:** In a multi-tenant SaaS system using CQRS, the naive approach of a separate event store and projection infrastructure per tenant does not scale beyond ~100 tenants (operational overhead becomes untenable). The scalable approach uses a shared event stream with tenant ID as a partition key (ensuring per-tenant ordering), shared projection workers that maintain per-tenant checkpoints, and either schema-level isolation (separate schemas per tenant in the same database) or row-level isolation (tenant_id column with row-level security). The critical constraint is that a slow or high-volume tenant must not degrade projection lag for other tenants. This requires per-tenant rate limiting at the event ingestion layer, priority-based projection scheduling (premium tenants get lower lag SLOs), and tenant-scoped monitoring so that one tenant's projection falling behind is detectable without scanning the entire event stream.

**Production consideration:** Noisy-neighbor detection in multi-tenant CQRS requires tracking projection lag per tenant. A tenant generating 10x the average event volume will consume disproportionate projection resources. The mitigation is tenant-aware consumer group assignment where high-volume tenants get dedicated projection workers while low-volume tenants share workers.

---

## Insight 12: CQRS Testing Requires Separate Strategies for Command Validation, Projection Correctness, and Eventual Consistency Verification

**Category:** Resilience
**One-liner:** Testing a CQRS system as a monolithic unit misses the failure modes that matter -- command handlers need domain logic tests, projections need event-replay correctness tests, and the system needs consistency convergence tests.

**Why it matters:** Traditional integration tests (write data, read it back, assert equality) fail in CQRS because the read and write paths are fundamentally different systems with eventual consistency between them. Three distinct test strategies are needed: (1) Command-side tests validate business rules by asserting which events a command produces given a set of prior events (no database needed, pure domain logic). (2) Projection tests replay a sequence of events and assert the resulting read model state matches expectations (catches projection bugs like missed event types or incorrect denormalization). (3) Consistency convergence tests write commands and poll the read model until it catches up, asserting convergence within an SLO (catches infrastructure issues like lost events, stuck projections, or reordering). The third category is the most often neglected and the most valuable in production -- it verifies the entire pipeline end-to-end under realistic conditions. Property-based testing (generating random event sequences and asserting projection invariants hold) catches edge cases that hand-crafted tests miss.

---

## Architecture Connections

| Insight | Related Topic | Connection |
|---------|---------------|------------|
| Dual-write problem | [1.18 Event Sourcing](../1.18-event-sourcing-system/00-index.md) | Event store eliminates dual-write structurally |
| Aggregate partitioning | [1.6 Distributed Message Queue](../1.6-distributed-message-queue/00-index.md) | Partition key selection for ordering guarantees |
| Blue-green projections | [1.18 Event Sourcing](../1.18-event-sourcing-system/00-index.md) | Projection rebuild strategies |
| CDC+outbox hybrid | [1.17 Distributed Transaction Coordinator](../1.17-distributed-transaction-coordinator/00-index.md) | Transactional outbox as saga participant |
| Multi-tenant isolation | [1.3 Distributed Key-Value Store](../1.3-distributed-key-value-store/00-index.md) | Tenant-aware partitioning strategies |
| Optimistic UI updates | [1.5 Distributed Cache](../1.5-distributed-cache/00-index.md) | Client-side cache with server reconciliation |

---

## Production Considerations

1. **Projection Lag SLOs**: Define explicit lag targets per projection type -- transactional views (< 100ms), operational dashboards (< 5s), analytics (< 1 minute) -- and alert on the derivative of lag (widening gap is an emergency; large but shrinking gap is healthy)
2. **Event Schema Evolution**: Read models must handle both old and new event formats during rolling deployments; upcasting transformers at the projection layer prevent breaking changes from requiring synchronized deployments. Plan for upcasting chains from day one -- this is the hardest operational challenge in production event-sourced CQRS
3. **Read Model Storage Selection**: Match the read model database to the query pattern -- document stores for entity lookups, search engines for full-text queries, time-series databases for analytics -- rather than forcing all projections into a single technology
4. **Disaster Recovery**: Read models are reconstructable from the event stream and do not need point-in-time backup; the event store and outbox table are the only components requiring durable backup strategies
5. **Start Simple**: Begin with CQRS only when you have genuinely asymmetric read/write workloads or complex query requirements. Start with a single database and logical separation before introducing physical separation of read/write stores. Simple CRUD is still appropriate for most domains — Netflix Tudum's migration shows that even at 20M user scale, the right CQRS implementation depends on dataset characteristics, not just scale
