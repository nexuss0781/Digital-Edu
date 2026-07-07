# Interview Guide — Error Tracking Platform

## Interview Pacing (45-min format)

| Time | Phase | Focus |
|------|-------|-------|
| 0-5 min | **Clarify** | Scope the system: real-time error tracking with SDKs, grouping, alerting. Clarify: web-only or multi-platform? Single-tenant or multi-tenant? Scale (events/sec)? |
| 5-15 min | **High-Level** | Draw the pipeline: SDK → Relay → Bus → Processing (normalize, symbolicate, fingerprint) → Storage (columnar + relational) → Alert engine. Explain the split between columnar (events) and relational (issues). |
| 15-30 min | **Deep Dive** | Pick 1-2: fingerprinting algorithm (stack trace normalization, fallback chain, merge/split), OR source map symbolication (lookup, parsing, caching, retro-symbolication), OR spike protection (baseline, sampling, quota). |
| 30-40 min | **Scale & Trade-offs** | Discuss: spike absorption (message bus), fingerprint cache invalidation on algorithm upgrades, cross-tenant isolation, multi-region data residency. Bottlenecks: source map parsing thundering herd, alert evaluation during spikes. |
| 40-45 min | **Wrap Up** | Summarize key decisions. Mention: observability of the platform itself (meta-monitoring), PII scrubbing, DSN security model. Handle follow-ups. |

---

## Meta-Commentary

### What Makes This System Unique/Challenging

1. **The grouping problem is the system:** Unlike most systems where the "core algorithm" is one component among many, the fingerprinting/grouping algorithm IS the product. If grouping is wrong, the platform is useless regardless of how well everything else works. Spend 30-40% of your deep-dive time here.

2. **Bursty by nature:** Error traffic is the opposite of steady-state. It correlates with incidents — exactly when the system is most needed, it faces its highest load. The architecture must handle 100x spikes without degradation.

3. **The source map bootstrapping problem:** After every deploy, the first errors arrive before source maps are uploaded. The system must gracefully handle this temporal gap and retro-symbolicate when maps arrive.

4. **Security inversion:** The DSN (auth token) is necessarily embedded in client-side code and is publicly visible. The security model must assume the auth token is compromised and defend via rate limiting, origin validation, and payload sanitization.

5. **Developer experience is the product:** Unlike infrastructure systems where operators are the users, error tracking serves developers. The UI's speed, the quality of stack traces, and the accuracy of grouping directly determine adoption. Technical excellence alone isn't enough — it must be usable.

### Where to Spend Most Time

- **Fingerprinting algorithm** (~35%): This is the differentiator. Explain the strategy chain (custom → rules → stack trace → exception → message), platform-specific normalization, and the precision-recall trade-off.
- **Ingestion pipeline with spike handling** (~25%): The relay → bus → worker pipeline, spike protection, and quota management.
- **Symbolication** (~20%): Source map lifecycle, caching strategy, retro-symbolication.
- **Storage design** (~20%): Why columnar for events and relational for issues; the consistency model between them.

---

## Trade-offs Discussion

### Trade-off 1: Grouping Precision vs Recall

| Decision | Over-Group (High Recall) | Under-Group (High Precision) | Recommendation |
|----------|--------------------------|-------------------------------|----------------|
| | Pros: Fewer issues in the list; developers see consolidated view | Pros: Each issue is a single root cause; debugging is straightforward | **Lean toward precision (under-group)** |
| | Cons: Multiple bugs merged into one issue; fix one, others persist | Cons: Same bug appears as 50 issues; duplicated triage effort | Developers can merge issues manually; splitting is much harder. Better to err on the side of separate issues. |

### Trade-off 2: Symbolication Latency vs Event Freshness

| Decision | Synchronous Symbolication | Asynchronous with Retro-Symbolication | Recommendation |
|----------|---------------------------|---------------------------------------|----------------|
| | Pros: Events always shown with resolved stack traces | Pros: Events visible immediately; symbolication doesn't block pipeline | **Asynchronous** |
| | Cons: Blocks event visibility until source map is available; processing pipeline slows during deploy surges | Cons: Brief window where events show minified traces; UI must handle "pending symbolication" state | The value of seeing events immediately (even with raw traces) outweighs the cost of temporary unresolved frames. |

### Trade-off 3: Event Fidelity vs Cost

| Decision | Store All Fields | Store Aggregates + Sampled Events | Recommendation |
|----------|-----------------|-----------------------------------|----------------|
| | Pros: Full debugging context for every event; no information loss | Pros: 10-50x storage reduction; faster queries | **Full events for recent data; sampled for old data** |
| | Cons: Expensive storage at scale (15 TB / 30 days); query performance degrades | Cons: Cannot inspect individual events from 3 months ago; debugging historical issues is limited | Use tiered retention: full events for 30 days, sampled representative events + aggregated counters for 90+ days. |

### Trade-off 4: Real-time Alerts vs Alert Fatigue

| Decision | Alert on Every New Issue | Alert with Threshold + Frequency Cap | Recommendation |
|----------|--------------------------|--------------------------------------|----------------|
| | Pros: No new issue goes unnoticed | Pros: Developers aren't overwhelmed; only significant issues trigger alerts | **Threshold + frequency cap** |
| | Cons: During deploys, dozens of new issues trigger a flood of alerts; developers mute everything | Cons: Some low-frequency issues may not trigger alerts immediately | Default: alert on new issues affecting >1% of sessions OR >10 occurrences in 5 minutes. Allow customization per project. |

### Trade-off 5: Columnar-Only vs Polyglot Storage

| Decision | Single Columnar Store | Columnar (Events) + Relational (Issues) | Recommendation |
|----------|----------------------|------------------------------------------|----------------|
| | Pros: Simpler operations; single query language | Pros: Each store optimized for its access pattern | **Polyglot** |
| | Cons: Columnar stores handle point lookups and transactions poorly; issue state management is awkward | Cons: Two systems to operate; consistency between event counts and issue counts requires synchronization | The access patterns are fundamentally different. Columnar for analytical scans (events); relational for transactional state (issues). |

---

## Trap Questions & How to Handle

| Trap Question | What Interviewer Wants | Best Answer |
|---------------|------------------------|-------------|
| "Why not just use the error message as the fingerprint?" | Test understanding of grouping nuance | Error messages contain data (timestamps, IDs, user inputs) that make identical bugs produce different messages. "User 12345 not found" and "User 67890 not found" are the same bug but different messages. Must strip data before hashing. |
| "Can't you just store everything in a relational database?" | Test storage design reasoning | At 500M events/day, relational databases cannot handle the write throughput or analytical query patterns (GROUP BY release, browser, time). Columnar stores compress 10-20x better for this data shape and scan 100x faster for aggregation queries. But relational is still needed for issue state management. |
| "What happens if the fingerprinting algorithm changes?" | Test understanding of state migration complexity | You cannot retroactively re-group all existing events — that would reassign events to different issues, breaking developer workflows. New algorithm applies only to new events. Maintain fingerprint versioning and auto-link "similar" issues across versions. Provide a preview tool before rollout. |
| "How do you handle errors from a language you don't have an SDK for?" | Test extensibility thinking | Provide a generic HTTP API that accepts structured JSON events. The server-side processing handles normalization. Any language that can make an HTTP POST can submit errors. Grouping may be less accurate without platform-specific frame normalization, but it still works via exception + message fallback. |
| "What if a customer sends 10 billion events in one day?" | Test spike handling and tenant isolation | Three-layer defense: (1) SDK-side rate limiting via `Retry-After` headers, (2) relay-side spike protection with dynamic sampling based on historical baseline, (3) hard quota enforcement. The 10B events never reach the processing pipeline — they're throttled at the relay. Other customers are unaffected due to per-project partitioning. |
| "How do you make sure source maps don't leak?" | Test security awareness | Source maps contain original source code — treat as highly sensitive. Never serve to browsers. Store with per-release encryption. Access requires authenticated admin permissions. Audit all uploads and downloads. Auto-expire after retention period. |
| "Why not use a single hash of the full stack trace?" | Test normalization understanding | Full stack traces include line numbers (change on any edit), framework version-specific frames (change on dependency update), and platform-specific variations (different browsers produce different frames). A naive hash would create a new issue every time any dependency or code line changes, even if the bug is identical. |
| "How do you handle errors in a serverless environment?" | Test architectural flexibility | Serverless functions are ephemeral — no persistent SDK state. The SDK must flush events synchronously before the function terminates (`flush()` call). Cold-start errors look different from warm-start errors (different stack traces due to initialization). Group serverless errors by function name + exception type rather than full stack trace. |
| "What if two different bugs produce the same fingerprint?" | Test handling of hash collisions | Explain that this is over-grouping. Monitor via event diversity within issues (if an issue has events with very different stack traces, it may be a collision). Provide manual split in the UI. Use hierarchical grouping (secondary hash) to surface sub-groups. The fingerprint algorithm should include enough signal (exception type + multiple frame attributes) to make collisions rare (<0.1%). |

---

## Key Insights to Demonstrate

| # | Insight | When to Mention | Impact |
|---|---------|----------------|--------|
| 1 | Fingerprinting precision > recall (lean toward under-grouping) | During grouping algorithm discussion | Shows you understand the asymmetric cost of merge vs. split |
| 2 | Error traffic is anti-correlated with system health | During scalability discussion | Shows you understand the unique spike pattern |
| 3 | DSN is a public credential, not a secret | During security discussion | Shows you understand the inverted auth model |
| 4 | Source maps contain full source code — treat as secrets | During security discussion | Shows awareness beyond "just a file upload" |
| 5 | Alert evaluation must be decoupled from event processing | During architecture discussion | Shows you prevent the alert-delay-during-spike problem |
| 6 | Dual-store consistency is approximate by design | During storage discussion | Shows pragmatic understanding of distributed systems |

---

## Clarification Questions to Ask

| Question | What It Signals | How Answer Shapes Design |
|----------|----------------|------------------------|
| "What's the expected event volume?" | Scope the system (100K/day vs. 1B/day) | Determines need for columnar store, sharding strategy |
| "Multi-platform or single platform?" | Scope symbolication complexity | Multi-platform requires symbolicator supporting source maps, ProGuard, dSYM |
| "How critical is sub-minute alerting?" | Priority of alert pipeline design | High criticality → dedicated alert topic with priority consumers |
| "Do we need to support custom grouping rules?" | Complexity of fingerprinting engine | Custom rules add a priority chain layer; declarative rule engine needed |
| "What's the retention requirement?" | Storage architecture and tiering | 90+ days requires tiered storage (hot/warm/cold) |
| "Is this multi-tenant SaaS or single-tenant?" | Isolation and quota requirements | Multi-tenant adds RBAC, tenant isolation, quota management |

---

## Senior vs Staff-Level Depth

| Topic | Senior Engineer | Staff+ Engineer |
|-------|----------------|----------------|
| **Fingerprinting** | Explain the strategy chain; describe stack trace normalization | Discuss precision-recall asymmetry; hierarchical grouping; ML-assisted similarity |
| **Spike protection** | Describe rate limiting and sampling | Explain seasonality-aware baseline; per-hour-of-week thresholds; adaptive baseline updates |
| **Symbolication** | Explain source map lookup and caching | Discuss retro-symbolication consistency problem; deploy-upload gap; pre-warm strategy |
| **Storage design** | Justify columnar + relational split | Discuss consistency gap between stores; approximate counters; write coalescing |
| **Alert pipeline** | Describe rule evaluation and notification delivery | Explain why alerts must be decoupled from processing; priority channels; burn-rate alerting |
| **Security** | Mention DSN public nature and source map sensitivity | Discuss full threat model: fingerprint manipulation, breadcrumb exfiltration, cross-tenant leakage |
| **Observability** | Describe key metrics and dashboards | Discuss meta-signals (new issue rate as grouping quality indicator); SLO error budgets |
| **Multi-region** | Describe active-passive with DR | Discuss data residency enforcement; EU-specific deployment; source map regional routing |

---

## Architecture Sketch Guide

When drawing the architecture during an interview, follow this sequence:

1. **Start with the SDK → Relay boundary** — Show the envelope protocol, DSN auth, rate limiting. This establishes the "public credential" security model early.
2. **Draw the message bus** — Show it as the central shock absorber between ingestion and processing. Label it with "spike buffer, ordering, replay."
3. **Show the processing pipeline** — Normalize → Symbolicate → Fingerprint → Enrich. Emphasize that these are sequential stages with clear failure modes at each.
4. **Split the storage layer** — Columnar (events) on one side, Relational (issues) on the other. Explain why: different access patterns, different consistency needs.
5. **Add the alert engine** — Show it consuming from a *separate* topic/queue, not inline with processing. Label: "decoupled to prevent spike-induced delay."
6. **Show the source map lifecycle** — CI/CD uploads → object storage → symbolicator cache → retro-symbolication queue. This demonstrates understanding of the deploy-upload gap.
7. **Add cross-cutting concerns** — Cache layer (fingerprint cache, rate limit counters, source map cache), quota manager, and PII scrubbing at the relay.

### Estimation Quick-Reference

| Metric | Value | Derivation |
|--------|-------|-----------|
| Events/sec (average) | ~5,800 | 500M/day ÷ 86,400s |
| Events/sec (peak) | ~100K | 17x average during spike |
| Avg event size (compressed) | ~1 KB | 5 KB raw × 80% compression |
| Storage per day | ~500 GB | 500M × 1 KB |
| Storage per month | ~15 TB | 500 GB × 30 |
| Source map cache memory | ~15 GB/node | 50 × 300 MB (LRU) |
| Fingerprint cache memory | ~520 MB | 5M entries × 104 bytes |
| Processing latency (p50) | ~2s | Normalize + symbolicate (cache hit) + fingerprint |
| Processing latency (p99) | ~15s | Includes symbolication cache miss |

---

## Discussion Talking Points

### For Senior-Level Discussion

1. Why per-project message bus partitioning is essential for ordering (first-seen detection requires per-project event ordering)
2. How the UPSERT with `xmax = 0` trick distinguishes new issues from existing ones (determines alert triggering)
3. Why source map pre-warming on upload eliminates the thundering herd (proactive vs. reactive caching)
4. How tiered retention (hot SSD / warm HDD / cold object storage) reduces costs 10x while preserving compliance
5. Why crash-free session rate is more actionable than raw error counts for mobile platforms

### For Staff-Level Discussion

1. The new issue rate as a meta-signal: distinguishing customer incidents from grouping algorithm regressions using correlation with release timelines
2. Why write coalescing for issue counters is necessary at 100K events/sec — turning 100K UPDATEs/sec into 1K UPDATEs/sec
3. How the columnar-relational consistency gap is deliberately approximate — the UI shows `~count` in the list view and exact count in the detail view
4. The asymmetric cost of quota accounting errors: over-acceptance (1-2% extra storage, acceptable) vs. under-acceptance (lost customer data, trust-destroying)
5. Why the alert pipeline must be independently scalable — during a 500x spike, only 0.01% of events trigger alerts, but those alerts are the most important output

---

## Deep Dive Preparation Questions

### Fingerprinting Deep Dive

1. What happens when a bug manifests differently in Chrome vs. Firefox (different stack traces)?
2. How do you handle grouping for errors with no stack trace (e.g., `fetch` network errors)?
3. What's your strategy for the "framework frame dominance" problem in React/Angular?
4. How do you version the fingerprinting algorithm without re-grouping existing issues?

### Scalability Deep Dive

1. How do you prevent a single hot project from consuming disproportionate message bus bandwidth?
2. What's your ClickHouse partitioning strategy for projects with 1M+ events/day?
3. How do you handle the relational DB write Slowest part of the process during issue upserts at 100K events/sec?
4. What's your strategy for warming the fingerprint cache after a new release deployment?

### Security Deep Dive

1. How do you prevent XSS via injected error messages displayed in the developer UI?
2. What's your approach to GDPR right-to-erasure when error events are in a columnar store?
3. How do you enforce data residency for EU customers when source maps are in a different region?
4. What's the threat model for a compromised DSN key?

---

## 30-Second Elevator Pitch

> "An error tracking platform ingests millions of error events from SDKs, groups them into issues using a multi-strategy fingerprinting algorithm, symbolicates minified stack traces using source maps, and delivers real-time alerts on new issues and regressions. The architecture separates ingestion (stateless relay with spike protection) from processing (message bus → workers → columnar store for events, relational store for issues). The key challenges are: fingerprinting accuracy (lean toward precision over recall), spike absorption (100x bursts during incidents), the deploy-upload temporal gap (retro-symbolication), and the DSN security model (public credential, defense via rate limiting and origin validation)."

---

## Quick Reference Card

| Concept | One-Line Summary |
|---------|-----------------|
| **DSN** | Public credential embedded in client code; auth by rate limiting, not secrecy |
| **Envelope** | Binary SDK transport format; header + items; gzip compressed |
| **Fingerprint** | SHA-256 hash of normalized error attributes; groups events into issues |
| **Issue** | Aggregated group of events sharing a fingerprint; the unit developers interact with |
| **Relay** | Stateless ingestion gateway; rate limiting, spike protection, PII scrubbing |
| **Symbolication** | Converting minified frames to original using source maps (VLQ decoding) |
| **Retro-symbolication** | Re-processing stored events when source maps arrive post-deploy |
| **Spike protection** | Seasonality-aware anomaly detection with consistent hash-based sampling |
| **MergeTree** | ClickHouse's columnar engine; time-partitioned, LSM-like merging |
| **Write coalescing** | Batching per-event issue counter updates to reduce DB IOPS |
| **Breadcrumbs** | Chronological trail of user actions leading up to the error |
| **Crash-free sessions** | Percentage of sessions without a fatal error; primary mobile health metric |

---

## Anti-Patterns to Discuss

| Anti-Pattern | Why It's Wrong | Correct Approach |
|-------------|---------------|-----------------|
| "Hash the full stack trace" | Line numbers change every commit; creates new issue per code change | Normalize frames: strip line numbers, filter framework frames, use context lines |
| "Store all events in PostgreSQL" | Cannot handle 500M events/day writes or analytical aggregation queries | Columnar store for events; relational for issue metadata |
| "Rate limit at a fixed threshold" | Miss spikes during low-traffic hours; throttle during legitimate peaks | Seasonality-aware baseline with per-hour-of-week thresholds |
| "Symbolicate synchronously" | Blocks event processing when source maps unavailable post-deploy | Async symbolication with retro-symbolication queue |
| "Single alert queue inline with processing" | Spike delays alerts — the most critical output during incidents | Decoupled alert pipeline with priority topic and independent consumers |
| "Trust the DSN as a secret" | DSN is in client-side JavaScript; inherently public | Defend via rate limiting, origin validation, payload sanitization |

---

## Format Selection Guide

When the interviewer asks about technology choices, use this reference:

| Requirement | Best Fit | Why |
|-------------|---------|-----|
| High-volume event ingestion (100K+/sec) | Kafka-style message bus | Partition ordering, durable buffering, replay |
| Event analytics (GROUP BY, COUNT, percentiles) | ClickHouse / columnar store | 10-100x faster than row-oriented for aggregation |
| Issue state management (ACID, UPSERT) | PostgreSQL | Transactional guarantees for state transitions |
| Source map storage (large blobs, immutable) | Object storage | Cost-effective for multi-MB files with CDN-backed retrieval |
| Rate limit counters (atomic, distributed) | Redis | Sub-millisecond atomic INCRBY across distributed fleet |
| Real-time event stream | WebSocket + Redis pub/sub | Low-latency fan-out to connected clients |
| Full-text error search | ClickHouse full-text index or dedicated search engine | Depends on query complexity and scale |

---

## Follow-Up Deep-Dive Scenarios

If the interviewer has extra time or wants to go deeper, be prepared for these advanced topics:

### Scenario 1: Multi-Language Monorepo

**Setup:** "Your customer has a monorepo with React frontend, Python API, and Go microservices. An error in the frontend triggers a cascade that causes errors in the API and Go services. How do you correlate them?"

**Key points:**
- Trace ID propagation: SDK injects a `trace_id` into the error context; all errors sharing the same trace ID are linked
- Cross-service issue linking: the React error and Python error are different issues (different fingerprints, different platforms) but linked via the shared trace
- Timeline view: show all errors from the same trace in chronological order, highlighting the root cause (earliest error)

### Scenario 2: Canary Deployment Error Monitoring

**Setup:** "The customer deploys to 5% of traffic first (canary). How does the error tracking platform support canary vs. stable comparison?"

**Key points:**
- Release tagging: canary release tagged as `frontend@2.4.1-canary`; stable as `frontend@2.4.0`
- Comparative dashboard: side-by-side error rates, new issues, and crash-free rates between canary and stable
- Automatic rollback signal: if canary crash-free rate drops >1% below stable, flag for automated rollback
- Statistical significance: require minimum session count before drawing conclusions (avoid false positives from small canary traffic)

### Scenario 3: AI/LLM Application Error Tracking

**Setup:** "Your customer is building an LLM-powered application. What new error types and grouping challenges arise?"

**Key points:**
- New error types: hallucination detection (output quality errors, not exceptions), rate limiting by LLM provider, token budget exhaustion, context window overflow
- Grouping challenge: LLM errors often don't have traditional stack traces — they manifest as unexpected output, not exceptions. Need semantic-level grouping based on prompt template + error category.
- Metadata: track model version, prompt template, token usage, latency per LLM call as error context
- Cost attribution: each LLM error has a direct cost (wasted tokens); integrate token cost into issue priority scoring

1. **Jumping to "just use a database" without considering event volume** — 500M events/day is ~6K events/sec. A single relational database cannot handle this write throughput, especially with the indexing needed for search. Always discuss the storage separation early.

2. **Ignoring the spike problem** — Error tracking traffic is not steady-state. Designing for average load means the system collapses during incidents — exactly when it's needed most. Spike protection must be a first-class concern, not an afterthought.

3. **Treating fingerprinting as a solved problem** — Many candidates say "hash the stack trace" and move on. The interviewer wants to hear about normalization, platform-specific handling, the fallback chain, and what happens when grouping is wrong (merge/split).

4. **Forgetting that source maps are a security concern** — Source maps contain original source code. Candidates who treat them as "just another file upload" miss the need for access control, encryption, and automatic expiration.

5. **Not discussing the DSN security model** — DSN keys are public by design (embedded in JavaScript). If you don't address how to prevent abuse of exposed keys, you've missed a critical security concern.

6. **Over-engineering day-1** — Start with the core pipeline (ingest → fingerprint → store → alert). Release tracking, breadcrumbs, and advanced analytics are important but should be discussed as extensions, not designed from scratch in a 45-minute interview.

7. **Not considering the developer experience** — This is a developer tool. If you design a technically perfect system but don't mention how the UI shows grouping reasons, how source map resolution improves stack traces, or how alert frequency caps prevent fatigue, you've missed the product perspective.

---

## Questions to Ask Interviewer

- What's the expected event volume? (Millions/day? Billions/day?)
- Multi-platform (web + mobile + backend) or single platform?
- Multi-tenant SaaS or single-tenant on-prem?
- How critical is real-time alerting vs. batch analytics?
- Are source maps / debug symbols in scope, or just raw stack traces?
- What's the retention requirement? (30 days? 1 year?)
- Do we need to handle multiple programming languages with different stack trace formats?
- Is release tracking and regression detection in scope?

---

## Follow-Up Deep-Dive Topics

If the interviewer has extra time or wants to go deeper:

1. **Hierarchical grouping:** How to show sub-groups within an issue when multiple code paths produce the same top-level fingerprint
2. **AI-assisted grouping:** Using embedding models to detect semantically similar errors that differ syntactically
3. **Session replay integration:** Linking error events to user session recordings for visual debugging
4. **Performance monitoring integration:** Correlating errors with slow transactions and infrastructure metrics
5. **On-premise deployment:** How the architecture changes when deployed in a customer's private cloud with limited resources
