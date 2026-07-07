# 14.12 AI-Native Field Service Management for SMEs — Interview Guide

## 45-Minute Interview Pacing

| Phase | Time | Focus | Interviewer Goals |
|---|---|---|---|
| **Phase 1: Scope & Requirements** | 0–8 min | Clarify the problem; establish FSM domain understanding; define key requirements | Assess ability to ask clarifying questions; understand the scheduling + offline + IoT tension |
| **Phase 2: High-Level Architecture** | 8–20 min | Draw the system architecture; identify core components; explain data flows | Evaluate architectural thinking; look for CQRS awareness, event-driven design, offline-first awareness |
| **Phase 3: Deep Dive** | 20–35 min | Drill into 1-2 hard problems (scheduling optimization, offline sync, predictive maintenance) | Test algorithmic depth; assess trade-off reasoning; look for NP-hard problem awareness |
| **Phase 4: Scale & Operations** | 35–42 min | Address scaling challenges, fault tolerance, observability | Evaluate production mindset; multi-tenant scaling; failure mode thinking |
| **Phase 5: Wrap-up** | 42–45 min | Extensions, trade-offs not covered, questions | Assess intellectual curiosity; ability to identify gaps in own design |

---

## Opening Problem Statement

> "Design an AI-powered field service management platform for small and medium businesses. The platform should automatically schedule and dispatch technicians to service jobs, optimize routes, support offline-capable mobile apps for technicians, generate invoices on-site, and integrate IoT sensor data for predictive maintenance. Target: 50,000 SME customers with an average of 12 technicians each."

### Expected Clarifying Questions (Strong Candidate)

| Question | Why It Matters | Good Answer Direction |
|---|---|---|
| "What types of field service—HVAC, plumbing, electrical, or general?" | Different service types have different scheduling constraints (certifications, parts, job durations) | Platform should be generic but support skill-based routing and job type templates |
| "How frequently do schedules change during the day? Is it mostly batch planning or real-time?" | This determines whether the system needs real-time re-optimization | 30-40% of daily schedules change due to cancellations, overruns, and emergencies—real-time re-optimization is essential |
| "What's the connectivity situation for technicians? Always online or frequently offline?" | This fundamentally shapes the mobile architecture | Frequently offline (basements, rural, poor signal)—offline-first is a hard requirement |
| "Are IoT sensors already deployed, or does the platform need to support onboarding?" | Determines whether predictive maintenance is a core or optional feature | Mix: some customers have smart equipment, others don't. Platform should handle both with graceful degradation |
| "What's the invoice complexity? Flat rate, time-and-materials, or both?" | Impacts the offline pricing engine design | Both, plus warranty coverage, membership discounts, and tax computation—all computable offline |

### Red Flags in Clarifying Phase

- Does not ask about offline requirements (misses the key mobile challenge)
- Assumes always-online connectivity for technicians
- Does not ask about schedule volatility (assumes static daily plans)
- Focuses only on CRUD operations without recognizing the optimization problem

---

## Key Discussion Points by Phase

### Phase 2: Architecture Discussion Points

**What strong candidates identify:**
1. **CQRS for schedule data** — High-frequency reads (technician polling for schedule) vs. low-frequency writes (schedule mutations) warrant separate read/write models
2. **Event-driven architecture** — Job state transitions should emit events consumed by multiple downstream services (notifications, analytics, billing)
3. **Stateful scheduling engine** — The optimizer needs in-memory schedule state for real-time incremental optimization; this is a deliberate deviation from stateless-everything
4. **Offline-first mobile architecture** — Not "offline-capable" (works sometimes offline) but "offline-first" (designed to work offline, syncs when possible)
5. **Separate IoT pipeline** — Telemetry data (high volume, time-series) should not flow through the same path as transactional data

**Architecture trade-off the candidate should discuss:**

| Decision | Option A | Option B | Key Consideration |
|---|---|---|---|
| Scheduling engine state | Stateful (in-memory) | Stateless (DB-backed) | Latency vs. operational complexity |
| Offline sync strategy | CRDT (automatic merge) | Last-write-wins | Data correctness vs. simplicity |
| Job event model | Event sourcing | State-based CRUD | Audit trail vs. implementation cost |
| Mobile data storage | Embedded relational DB | Document store | Query flexibility vs. sync simplicity |
| IoT processing | Stream processing | Batch processing | Latency vs. cost |

### Phase 3: Deep Dive Options

The interviewer should pick 1-2 of these based on the candidate's strengths:

**Option A: Scheduling Optimization**
- "How do you solve the technician-to-job assignment problem?"
- Look for: recognition of NP-hardness; VRPTW formulation; metaheuristic approaches (not just greedy)
- Strong answer: discusses constraint programming for hard constraints + metaheuristic search (ALNS, genetic algorithms, simulated annealing) for optimization; explains incremental re-optimization vs. full re-solve
- Excellent answer: discusses warm-start optimization, multi-objective Pareto trade-offs, and the distance matrix caching strategy to reduce maps API costs

**Option B: Offline Sync & Conflict Resolution**
- "A technician is offline for 2 hours. During that time, the dispatcher reassigns one of their jobs. How do you handle the sync?"
- Look for: understanding of distributed systems conflict resolution; not just "last write wins"
- Strong answer: discusses CRDTs or operational transforms; explains how different field types need different merge strategies (status vs. notes vs. photos)
- Excellent answer: discusses the specific CRDT types per field (state machine CRDT for status, LWW register with actor priority for scalars, grow-only set for photos); explains delta sync with priority ordering

**Option C: Predictive Maintenance with Sparse Data**
- "How do you build a failure prediction model for equipment with only a few months of data and zero failures?"
- Look for: transfer learning awareness; understanding that per-device models are infeasible
- Strong answer: discusses equipment family models trained on aggregated data; hierarchical model architecture
- Excellent answer: discusses the specific challenge of false positive suppression, multi-gate validation pipelines, and how predicted maintenance becomes a scheduling lever (demand shaping)

**Option D: Real-Time ETA with Stochastic Job Durations**
- "Customer Job 4 wants an accurate ETA, but Jobs 1-3 haven't started yet. How do you provide an accurate estimate?"
- Look for: recognition that deterministic ETAs fail; understanding of uncertainty propagation
- Strong answer: discusses probabilistic ETAs using historical duration distributions; Monte Carlo simulation
- Excellent answer: discusses tiered computation to manage cost; customer communication strategy (P80 estimates, notification thresholds for re-notification)

---

## Follow-Up Probes by Candidate Level

### For Candidates Who Identify ALNS / Metaheuristic

| Probe | What You're Testing |
|---|---|
| "How do you warm-start the solver after a single job change?" | Understanding of incremental vs. cold-start optimization; memory management implications |
| "What happens if the solver doesn't converge in time?" | Timeout handling; graceful degradation to greedy; anytime algorithm awareness |
| "How do you prevent the solver from oscillating between two similar solutions?" | Simulated annealing acceptance criteria; tabu search awareness; convergence properties |

### For Candidates Who Identify CRDTs

| Probe | What You're Testing |
|---|---|
| "Why can't you use the same CRDT type for all fields?" | Understanding of asymmetric authority; domain-specific merge semantics |
| "What happens when a CRDT payload grows unbounded?" | Awareness of CRDT garbage collection; state compaction; tombstone management |
| "How do you test correctness of your CRDT merge logic?" | Property-based testing awareness; linearizability verification |

### For Candidates Who Identify IoT Predictive Maintenance

| Probe | What You're Testing |
|---|---|
| "How does the model handle its first week on a brand-new equipment type it's never seen?" | Cold-start problem; transfer learning viability thresholds; graceful degradation |
| "What happens if a sensor goes offline for 2 weeks and comes back?" | Gap handling in time-series; baseline recalibration; false positive risk from stale baseline |
| "How does seasonal variation affect your anomaly detection?" | Temporal feature engineering; seasonal normalization; training data requirements |

---

## Common Trap Questions

### Trap 1: "Can't you just use a simple greedy algorithm for scheduling?"

**The trap:** Greedy scheduling (assign the nearest available technician) seems reasonable and is fast. Many candidates accept this and move on.

**Why it's a trap:** Greedy is myopic—assigning the nearest technician to Job A may force a much longer drive for Job B later. For example: Technician X is 5 minutes from Job A and 30 minutes from Job B. Technician Y is 15 minutes from Job A and 10 minutes from Job B. Greedy assigns X→A (nearest), then Y→B. Total: 5+10=15 min. But optimal is X→B, Y→A. Total: 30+15=45 min... wait, that's worse. The trap within the trap is that the candidate needs to construct a valid example where greedy fails, not just assert it.

**Strong answer:** "Greedy works surprisingly well for many cases—90-95% of assignments are the same as optimal. But it fails in constrained scenarios: when skill requirements limit candidates, when time windows create ordering dependencies, or when vehicle inventory matters. For a fleet of 20 technicians with 80 jobs, greedy might produce a schedule that's 15% worse than optimal, which translates to 2-3 fewer jobs completed per technician per day. The real issue is that greedy can't re-optimize—when a disruption occurs, greedy re-assignment looks only at the immediate next job, not the cascading impact."

### Trap 2: "Why not just require connectivity for the mobile app?"

**The trap:** Always-online simplifies everything: no sync conflicts, no offline pricing, no CRDT complexity.

**Why it's a trap:** Field service technicians work in basements, crawl spaces, metal buildings, and rural areas. Requiring connectivity would mean the app is unusable 20-30% of the time, forcing technicians back to paper forms and creating a worse experience than having no app at all.

**Strong answer:** "The value proposition of the mobile app is that it replaces paper processes entirely. If the app doesn't work where the technician works (which is on-site, often in connectivity-challenged environments), technicians will carry paper as backup and eventually stop using the app. The offline-first approach means the app is always reliable, and connectivity is a performance enhancement, not a requirement."

### Trap 3: "IoT predictive maintenance sounds expensive for SMEs. Is it worth the infrastructure cost?"

**The trap:** Treating predictive maintenance as a pure cost center rather than a revenue optimization lever.

**Strong answer:** "The ROI calculation has three components: (1) Direct savings: preventing emergency failures reduces expensive urgent dispatches—emergency jobs cost 2-3× normal visits in overtime and expedited parts. (2) Revenue optimization: predicted maintenance has flexible scheduling windows, allowing the optimizer to fill schedule gaps, increasing billable hours by 15-20%. (3) Customer retention: proactive service ('we detected your AC is degrading, we'll fix it before it fails') dramatically improves customer lifetime value. The infrastructure cost (sensors + cloud pipeline) is ~$5-10/device/month; a single prevented emergency dispatch saves $200-400."

### Trap 4: "How do you handle the invoice price being different on the device vs. the server?"

**The trap:** Many candidates either ignore this problem or propose real-time server validation (which requires connectivity).

**Strong answer:** "The key insight is that price determinism depends on agreeing on inputs, not on real-time communication. Both the device and server compute the same price for the same (line_items + pricing_version) inputs. The device stamps which pricing version it used. If the pricing version is current, the server's computation will match exactly—verified by fixed-point arithmetic (integer cents, no floating-point rounding differences). If pricing changed while the technician was offline, the server flags the invoice for human review rather than silently adjusting. The flag rate is < 1% with 24-hour pricing update tolerance."

---

## Scoring Rubric

### Requirements & Scoping (0-4 points)

| Score | Criteria |
|---|---|
| 0 | No clarifying questions; jumps to implementation |
| 1 | Basic questions about scale but misses offline requirement |
| 2 | Identifies scheduling, offline, and IoT as key challenges |
| 3 | Asks about schedule volatility, connectivity patterns, invoice complexity; defines clear SLOs |
| 4 | All of above + identifies the scheduling-optimization NP-hardness; discusses functional vs. non-functional trade-offs; considers multi-tenant implications |

### Architecture Design (0-4 points)

| Score | Criteria |
|---|---|
| 0 | Monolithic design; no consideration of offline or optimization |
| 1 | Basic microservices with REST APIs; scheduling as simple CRUD |
| 2 | Event-driven architecture; separate scheduling engine; mentions CQRS |
| 3 | Stateful scheduling engine with justification; offline-first mobile design; IoT pipeline separated; event sourcing for audit trail |
| 4 | All of above + discusses CRDT selection strategy; explains distance matrix caching; considers multi-tenant isolation in stateful engine; discusses saga pattern for multi-step workflows |

### Deep Dive Technical Depth (0-4 points)

| Score | Criteria |
|---|---|
| 0 | Cannot explain any algorithm beyond basic CRUD |
| 1 | Mentions "optimization" but no specific algorithm; basic last-write-wins for sync |
| 2 | Discusses specific optimization approaches (greedy + local search); understands CRDT basics; mentions ML for predictions |
| 3 | Explains ALNS or similar metaheuristic; discusses CRDT type selection per data type; explains transfer learning for sparse data |
| 4 | All of above + discusses warm-start optimization; explains delta sync protocol with bandwidth adaptation; discusses false positive suppression pipeline; probabilistic ETA with Monte Carlo |

### Scalability & Operations (0-4 points)

| Score | Criteria |
|---|---|
| 0 | No scaling discussion |
| 1 | "Add more servers"; basic horizontal scaling |
| 2 | Discusses stateful vs. stateless scaling differences; mentions caching strategy |
| 3 | Tenant-partitioned scheduling; graceful degradation hierarchy; discusses sync storm handling |
| 4 | All of above + discusses failover for stateful services; cross-region disaster recovery; ML model observability; capacity planning with realistic numbers |

### Total: 16 points

| Range | Assessment |
|---|---|
| 0-4 | Below expectations |
| 5-8 | Meets basic expectations |
| 9-12 | Strong candidate |
| 13-16 | Exceptional candidate |

---

## Advanced Discussion Topics

### Topic 1: Build vs. Buy — Scheduling Optimizer

**Prompt:** "Should an FSM startup build a custom scheduling optimizer or integrate an open-source solver (OR-Tools, OptaPlanner)?"

**Discussion points to evaluate:**
- Build: domain-specific ALNS operators (skill-weighted insertion, churn-penalty aware), warm-start capability, tight integration with in-memory tenant state, competitive differentiation
- Buy: faster time-to-market, community-maintained, proven correctness; but lacks warm-start, treats each solve as independent, overhead of adapting general solver to FSM-specific constraints
- Hybrid: use OR-Tools for overnight batch planning (where warm-start doesn't matter) and custom ALNS for real-time re-optimization

**Strong answer traits:** Recognizes that the warm-start requirement for real-time re-optimization is the key differentiator; general-purpose solvers can't maintain state across requests. Proposes concrete evaluation criteria (latency, solution quality, integration cost) rather than abstract philosophy.

### Topic 2: Privacy vs. Productivity — Technician Location Tracking

**Prompt:** "Technician GPS tracking is essential for ETA accuracy and route optimization, but raises significant privacy concerns. How do you balance this?"

**Discussion points to evaluate:**
- Technical: tracking only during working hours; precision degradation after hours; customer-visible only (not platform-operator visible); consent-based with clear data retention policy
- Business: technicians who opt out lose AI-optimized routing and ETA features; reduced scheduling quality impacts their job count and earnings
- Regulatory: GDPR right to object; labor union restrictions in EU; India DPDP Act requirements
- Architecture: location data separate from PII; TTL-based purge; aggregated anonymized analytics for fleet-level insights

**Strong answer traits:** Doesn't treat it as a binary (track everything vs. track nothing). Proposes graduated consent model with clear value exchange. Considers both technician and customer privacy interests.

### Topic 3: Multi-Objective Optimization — When Objectives Conflict

**Prompt:** "The scheduling optimizer must simultaneously minimize drive time, maximize first-time-fix rate, balance workload, and maintain emergency capacity. These objectives conflict. How do you handle trade-offs?"

**Discussion points to evaluate:**
- Pareto frontier: generate multiple non-dominated solutions; let dispatcher choose or auto-select based on configurable weights
- Weight customization per industry/tenant: HVAC prioritizes skill match; pest control prioritizes route efficiency
- Churn penalty: the hidden objective—humans need schedule stability to maintain trust in AI recommendations
- Emergency capacity: the capacity reserved for emergencies is wasted if no emergencies occur; how to calibrate?

**Strong answer traits:** Goes beyond "use weighted sum" to discuss how different stakeholders value different objectives. Mentions dispatcher trust as a design constraint, not just mathematical optimization. Discusses how to measure whether the multi-objective balance is working (dispatcher override rate as feedback signal).

### Topic 4: Offline Invoice Determinism as a Distributed Systems Problem

**Prompt:** "How do you guarantee that an invoice generated on a mobile device matches what the server would compute, given that the device might be using stale pricing data?"

**Discussion points to evaluate:**
- Versioned pricing engine: both sides compute using the same version, not the "current" version
- Fixed-point arithmetic: all computation in integer cents to avoid IEEE 754 non-associativity
- Tolerance window: accept device-computed total if pricing version is within 24-48 hours of current
- Edge cases: admin deletes a service code; tax rate changes retroactively; discount coupon expires during job

**Strong answer traits:** Recognizes this as a determinism problem, not a communication problem. Mentions the specific failure mode (floating-point rounding differences across architectures). Proposes the versioning approach rather than "just validate online" (which requires connectivity).

---

## Red Flags / Green Flags

### Red Flags (Candidate Weaknesses)

| Red Flag | What It Indicates |
|---|---|
| "Just use a greedy algorithm for scheduling" without discussing limitations | Doesn't recognize the NP-hard nature of the problem or the impact of myopic assignment on fleet utilization |
| "The mobile app can just cache data locally" without discussing conflict resolution | Treats offline-first as a simple caching problem; doesn't understand distributed systems challenges of concurrent writes |
| "Use microservices for everything" without identifying which services should be stateful | Applies patterns without understanding the scheduling engine's fundamental need for in-memory state |
| "Machine learning will handle the IoT predictions" without discussing false positive costs | Hand-waves ML as a black box; doesn't consider the business impact of model errors on SME trust |
| Ignores multi-tenancy in the design | Misses the core business constraint: 50K tenants sharing infrastructure with isolation requirements |
| Proposes synchronous pricing validation requiring server connectivity | Fundamentally misunderstands the offline-first requirement |
| No mention of CRDT or conflict resolution strategy | Doesn't know how to handle distributed state convergence—will propose "last write wins" and lose data |

### Green Flags (Candidate Strengths)

| Green Flag | What It Indicates |
|---|---|
| Asks about schedule volatility rate before designing | Understands that the scheduling problem's real-time nature depends on disruption frequency |
| Identifies the scheduling engine as necessarily stateful with justification | Deep understanding of optimization algorithms and their state requirements |
| Proposes field-level CRDT selection with actor priority | Sophisticated distributed systems knowledge applied to a domain-specific problem |
| Discusses the distance matrix caching strategy with cost analysis | Understands the operational cost dimension of external API dependencies |
| Mentions the churn penalty as a design constraint for the optimizer | Understands that technically optimal solutions can fail in practice if users don't trust them |
| Proposes fixed-point arithmetic for pricing determinism | Knows the specific failure mode (IEEE 754) and the industry-standard solution |
| Discusses false positive costs and economic gate for predictive maintenance | Understands the asymmetric cost structure for SMEs vs. enterprises |

---

## System Design Comparison Table

| Design Dimension | Weak Answer | Acceptable Answer | Strong Answer | Exceptional Answer |
|---|---|---|---|---|
| **Scheduling** | "Assign nearest available technician" | "Optimization with constraints" (no specifics) | "ALNS with warm starts; NP-hard recognition; incremental re-optimization" | All of strong + discusses operator adaptation, churn penalty, Pareto trade-offs, distance matrix caching economics |
| **Offline Sync** | "Cache data on device" | "Use offline database with sync" | "CRDT-based merge with actor priority; delta sync protocol" | All of strong + discusses field-level CRDT selection, sync storm handling, bandwidth-adaptive sync |
| **Predictive Maintenance** | "Use ML to predict failures" | "Train model on sensor data" | "Transfer learning across equipment families; survival analysis for RUL" | All of strong + discusses false positive suppression pipeline, economic gate, demand shaping |
| **Multi-Tenancy** | Not mentioned | "Separate data by tenant_id" | "RLS + ORM enforcement + scheduling engine state isolation" | All of strong + discusses noisy-neighbor prevention, resource quotas, tenant-partitioned stateful scaling |
| **ETA Accuracy** | "Show estimated arrival time" | "Update ETA based on traffic" | "Probabilistic ETAs with Monte Carlo; P80 customer-facing estimates" | All of strong + discusses tiered computation, notification threshold, duration distribution modeling |
| **Invoicing** | "Generate invoice on server" | "Offline invoicing with price sync" | "Versioned pricing with fixed-point arithmetic; deterministic computation" | All of strong + discusses architecture-specific rounding, version tolerance window, flagging protocol |

---

## Evaluation Anti-Patterns

| Anti-Pattern | Description | Why It's Problematic |
|---|---|---|
| **Over-indexing on scale** | Candidate focuses entirely on handling billions of requests without addressing the core optimization problem | Field service scale is moderate (5K QPS); the real challenge is algorithm design and offline architecture |
| **Cloud-native without offline** | Beautiful serverless/container architecture that requires constant connectivity | Fails the fundamental requirement that technicians work in connectivity-challenged environments |
| **ML hand-waving** | "AI will optimize the schedule" / "ML predicts failures" without any algorithmic specifics | The value of this system is in the specific algorithms; vague ML references indicate no depth |
| **Ignoring human-in-the-loop** | Pure AI system with no dispatcher override, no manual fallback, no escalation path | Production systems must degrade gracefully and allow human intervention; pure automation fails in edge cases |
| **Single-objective optimization** | Optimizing only for drive time (or only for any single metric) | Real scheduling requires multi-objective balancing; single-objective solutions are globally poor |
| **Treating offline as an Edge Case (Unusual or extreme situation)** | Designing for online-first and "handling" offline as a fallback | For field service, offline IS the primary mode; online is the enhancement. Architecture must invert the assumption |
