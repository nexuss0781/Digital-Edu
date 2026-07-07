# Interview Guide — Incident Management System

## 1. Forty-Five-Minute Pacing

| Phase | Minutes | Focus | Key Deliverables |
|-------|---------|-------|-----------------|
| **Requirements** | 0-7 | Scope the system; clarify alert sources, notification channels, scale | Written functional/non-functional requirements; capacity estimates |
| **High-Level Design** | 7-20 | Draw the architecture; data flow from alert to notification | Architecture diagram with all major components; explain the alert lifecycle |
| **Deep Dive** | 20-35 | Go deep on 1-2 components (dedup engine, escalation state machine, or notification pipeline) | Algorithms, data structures, handling race conditions |
| **Scalability & Reliability** | 35-42 | Address the meta-reliability problem; alert storms; multi-region | Scaling strategy, fault tolerance, degraded modes |
| **Wrap-up** | 42-45 | Trade-offs, monitoring, future improvements | Summary of key decisions and their justifications |

---

## 2. Requirements Phase (Minutes 0-7)

### 2.1 Clarifying Questions to Ask

| Question | Why It Matters |
|----------|---------------|
| "What's the scale — how many monitored services and teams?" | Determines whether you need a single-region or multi-region design |
| "What notification channels are required?" | Phone/SMS have fundamentally different reliability and cost profiles than push/Slack |
| "What's the expected alert volume during normal operations vs. a major incident?" | Drives capacity planning and determines whether dedup is a must-have |
| "Do we need automated remediation (runbooks) or just notification?" | Adds significant security complexity if runbooks can modify production |
| "What availability does the incident platform itself need?" | Surfaces the meta-reliability requirement early |
| "Is this a multi-tenant SaaS or a single-organization deployment?" | Multi-tenant adds tenant isolation, noisy-neighbor protection |

### 2.2 Requirements You Should Propose

Even if the interviewer doesn't mention them, demonstrate awareness of:
- **Alert deduplication** — Without it, the system is useless during storms
- **Escalation policies** — Without them, a sleeping on-call engineer means a missed incident
- **Multi-channel notification with failover** — Single-channel systems have single points of failure
- **Post-incident review** — Shows you understand the learning loop, not just the fire-fighting

---

## 3. High-Level Design Phase (Minutes 7-20)

### 3.1 Components to Draw

At minimum, your architecture must include:

1. **Alert Ingestion Gateway** — API + normalizer (don't skip normalization)
2. **Durable Queue** — Between ingestion and processing (explain why: decoupling, zero alert loss)
3. **Deduplication Engine** — With fingerprint store
4. **On-Call Resolver** — Schedule evaluation
5. **Escalation Engine** — Timer-driven, separate from lifecycle manager
6. **Notification Dispatcher** — Multi-channel with failover
7. **Incident Database** — State persistence
8. **Analytics / Postmortem** — Learning loop

### 3.2 Data Flow to Trace

Walk through the happy path: Alert arrives → normalized → queued → fingerprint computed → dedup check → new incident created → on-call resolved → escalation started → L1 notified → L1 acknowledges → escalation cancelled.

Then trace the failure path: L1 doesn't acknowledge → timer fires → L2 notified → L2 acknowledges.

### 3.3 Common Mistakes in This Phase

| Mistake | Why It's Wrong | Better Approach |
|---------|----------------|-----------------|
| No queue between ingestion and processing | Alert storms will overwhelm processing; alerts will be lost | Always show a durable queue for decoupling |
| Dedup and incident creation in the same box | These are different concerns with different scaling profiles | Separate components with clear interfaces |
| Single notification channel | "Just send a push notification" ignores that phones can be on DND, batteries die, apps crash | Multi-channel with preference-based routing |
| Ignoring the meta-reliability problem | If the platform is down, who pages you about the platform being down? | Mention meta-monitoring early; it impresses interviewers |

---

## 4. Deep Dive Phase (Minutes 20-35)

The interviewer will likely ask you to go deep on one of these. Be prepared for all three.

### 4.1 Deep Dive: Alert Deduplication

**Key points to cover:**
- Fingerprint computation (hash of dedup_key)
- Sliding window with TTL extension
- The contention problem during storms (atomic CAS)
- Multi-layer dedup: exact → rule-based → time-window → ML semantic
- Trade-off: over-grouping (hiding incidents) vs. under-grouping (noise)

**Trap question:** "What if two different incidents produce the same fingerprint?"
- **Good answer:** The dedup_key is configurable by the integration. If the key is too coarse (e.g., just "service_name"), different incidents will collide. The default key includes source + class + service, which is specific enough for most cases. For critical services, customers can add custom fields to the dedup_key to increase specificity.

### 4.2 Deep Dive: Escalation State Machine

**Key points to cover:**
- State diagram: L1_notified → L2_notified → L3_notified → repeat or exhausted
- Timer management: persistent timer wheel with crash recovery
- The ACK/escalation race condition (optimistic concurrency with generation counter)
- Design choice: unnecessary notification (safe) vs. missed escalation (dangerous)

**Trap question:** "What happens if the escalation engine crashes and restarts?"
- **Good answer:** Timers are persisted to a durable store. On restart, the engine loads all pending timers and fires any that are overdue. This may cause a burst of escalation notifications, but "late notification" is always better than "no notification." The generation counter on the escalation state prevents duplicate processing.

### 4.3 Deep Dive: Notification Delivery

**Key points to cover:**
- Channel selection based on user preferences × severity × time-of-day
- Per-channel retry logic with exponential backoff
- Channel failover chain (push → SMS → phone)
- Phone call specifics: voicemail detection, IVR for acknowledgment, multi-provider failover
- Notification dedup (don't page the same person twice for the same incident)

**Trap question:** "How do you guarantee notification delivery?"
- **Good answer:** You can't guarantee delivery for any single channel (phones can be off, push tokens expire, SMS gets spam-filtered). You guarantee delivery through redundancy: multiple channels with failover, multiple providers per channel, and escalation as the ultimate backstop. If L1 doesn't respond through any channel, L2 is paged. The system doesn't guarantee delivery to one person — it guarantees that someone is notified.

---

## 5. Scalability & Reliability Phase (Minutes 35-42)

### 5.1 Must-Discuss Topics

1. **Alert storm scaling** — How the system handles 100x normal alert volume
2. **The meta-reliability paradox** — The incident platform must be more reliable than everything it monitors
3. **Multi-region active-active** — Why single-region is unacceptable for this system
4. **Degraded mode operation** — What happens when components fail (queue bypass, cache-only scheduling, push-only notifications)

### 5.2 Key Trade-Offs to Articulate

| Trade-Off | Option A | Option B | Recommended |
|-----------|----------|----------|-------------|
| Dedup accuracy vs. noise | Conservative dedup (more incidents, less risk of hiding problems) | Aggressive dedup (fewer incidents, risk of over-grouping) | Start conservative, tune toward aggressive per-service |
| Notification latency vs. cost | Phone every engineer immediately | Push first, phone only after push timeout | Per-severity: phone for P1, push-first for P3 |
| Consistency vs. availability for incident state | Strong consistency (CP) | Eventual consistency (AP) | AP with domain-specific conflict resolution (ACK wins over escalation) |
| Single-region simplicity vs. multi-region reliability | Cheaper, simpler, lower latency | Survives region failure, more complex | Multi-region is non-negotiable for incident platforms |
| Fingerprint dedup vs. ML grouping | Deterministic, debuggable, fast | More flexible, can group "related but different" alerts | Fingerprint as baseline; ML as optional enhancement |

---

## 6. Evaluation Criteria

### 6.1 What Strong Candidates Demonstrate

| Signal | Example |
|--------|---------|
| **Understands the meta-reliability problem** | Proactively mentions that the incident platform must not share infrastructure with what it monitors |
| **Thinks about failure modes, not just happy paths** | Discusses what happens when telephony providers go down, when the database fails during a storm |
| **Designs for alert storms** | Includes dedup, backpressure, and graceful degradation in the initial design, not as an afterthought |
| **Handles race conditions in the escalation engine** | Identifies the ACK/escalation timer race and proposes a concrete solution |
| **Considers the human element** | Discusses alert fatigue, on-call burden, and why notification channel selection matters |
| **Traces the complete lifecycle** | Can walk through alert → dedup → route → notify → acknowledge → resolve → postmortem without gaps |

### 6.2 What Weak Candidates Do

| Anti-Pattern | Problem |
|-------------|---------|
| Treat it as "just a notification system" | Miss dedup, escalation, lifecycle management, and postmortems |
| Skip deduplication | The system is useless during storms without dedup — this is the core technical challenge |
| Single notification channel | "We'll just send an email" — emails get lost in spam, ignored at night, and provide no delivery guarantee |
| Don't address the meta-reliability problem | If your incident platform goes down with the infrastructure, you've designed a system that fails precisely when it's needed most |
| Over-engineer with ML from the start | ML-based dedup is a luxury; start with fingerprint-based dedup and prove it works first |
| Ignore the escalation timer race condition | Shows lack of experience with concurrent state machines |

---

## 7. Variations and Follow-Ups

| Variation | Key Differences |
|-----------|----------------|
| "Design for a 10-person startup vs. 10,000-person enterprise" | Startup: single schedule, Slack-only notification, no runbooks. Enterprise: multi-team, multi-channel, full automation |
| "Add AI-powered incident response" | Auto-correlation of alerts with recent deployments; auto-suggested remediation; auto-generated postmortems |
| "Design just the on-call scheduling system" | Deep dive into rotation algorithms, override handling, fairness metrics, timezone complexity |
| "Focus on the notification pipeline only" | Deep dive into multi-channel delivery, provider failover, delivery guarantees, and cost optimization |
| "How would you migrate from PagerDuty to a custom system?" | Data migration, dual-running period, integration rewiring, rollback strategy |

---

## 8. Quick Reference: Numbers to Know

| Metric | Value | Source |
|--------|-------|--------|
| PagerDuty SLA | 99.9% web availability, zero scheduled downtime | Industry benchmark |
| Median P1 MTTR (high-performing teams) | 30-45 minutes | Industry surveys |
| Median P1 MTTA | 3-5 minutes | Industry surveys |
| Alert storm multiplier | 50-100x normal volume | Common during cascading failures |
| Dedup ratio during storms | 50:1 to 500:1 | Depends on architecture and failure mode |
| Phone call setup latency | 5-15 seconds | Telephony provider dependent |
| Push notification latency | 0.5-3 seconds | Push service dependent |
| On-call rotation size (healthy) | 4-8 engineers per rotation | Industry best practice |
| After-hours pages (healthy team) | < 2 per week per engineer | SRE best practice |

---

## 9. Architectural Decision Justification Cheat Sheet

Quick one-line justifications for whiteboard defense:

| Decision | Justification |
|----------|--------------|
| Durable queue between ingestion and processing | Alert storms produce 100x burst; queue absorbs spikes so we never drop an alert |
| Fingerprint-based dedup over ML grouping | Deterministic, debuggable, conservative — wrong grouping hides incidents; ML can be layered on top as suggestion |
| Escalation engine separate from lifecycle manager | Timer accuracy is latency-critical; isolating it gives independent scaling and fault domain |
| Multi-channel notification with failover | Channel failure modes are weakly correlated; composite reliability of 3 channels far exceeds any single channel |
| Active-active multi-region | The incident platform must survive region failure — if it goes down with infrastructure, you lose situational awareness |
| Break-glass local auth | When the SSO provider IS the incident, engineers must still access the platform |
| Synthetic transaction monitoring | The meta-monitoring problem requires an independent pipeline that verifies end-to-end health every 60s |
| Per-tenant encryption keys | Tenant data breach must be containable; shared keys mean one compromise exposes all tenants |

---

## 10. Common Mistakes Table

| Mistake | Why It's Wrong | What to Say Instead |
|---------|---------------|-------------------|
| "We'll use a cron job for escalation timers" | Cron has minute-level granularity; escalation timers need second-level accuracy with crash recovery | "Persistent timer wheel with durable storage and crash-recovery replay" |
| "Dedup is just a hash map" | Ignores sliding window, TTL extension, CAS contention during storms, and the over-grouping risk | "Fingerprint store with sliding window, hard TTL cap, and atomic CAS for concurrent updates" |
| "Just send push notifications" | Push tokens expire, apps get uninstalled, phones die; single-channel delivery is unreliable | "Multi-channel with preference-based routing and failover chain" |
| "Store everything in one database" | Alert payloads, incident state, and escalation timers have completely different access patterns | "Polyglot persistence: document store for payloads, relational for state, sorted set for timers" |
| "We don't need multi-region for this" | Single-region incident platform fails when the region fails — exactly when you need it most | "Active-active is non-negotiable; the platform must be strictly more available than what it monitors" |
| "ML will group related alerts" | ML grouping is opaque, hard to debug, and dangerous if it over-groups — hiding real incidents | "Fingerprint dedup as baseline; ML as an optional suggestion layer, never auto-merge" |
| "The on-call schedule is just a calendar" | Ignores layers, overrides, follow-the-sun, timezone conversion, and override precedence rules | "Schedule resolution is a layered computation: base rotation → overrides → handoff rules → cache" |
| "Rate limit the alert API to prevent storms" | Rejecting alerts means missing incidents; you can never reject — only buffer and dedup | "Rate limit per-integration for abuse prevention; never reject alerts globally" |

---

## 11. Quick Whiteboard Sketch Sequence

Draw these four milestones to structure your answer:

**Milestone 1 (minute 8):** Alert Sources → API Gateway → Queue → Dedup → Incident DB
- Establishes the ingestion pipeline and dedup as first-class concern

**Milestone 2 (minute 13):** On-Call Resolver → Escalation Engine → Notification Dispatcher → Channels
- Shows the routing and notification layer; mention the timer isolation

**Milestone 3 (minute 18):** Add Schedule Cache, Timer Store, Fingerprint Store as state components
- Demonstrates awareness of stateful components and their persistence needs

**Milestone 4 (minute 20):** Draw the meta-monitoring loop as a separate box
- Shows the independent monitoring path; this is the moment that impresses

---

## 12. System Comparison Guide

| If interviewer asks about... | How this system differs |
|----------------------------|----------------------|
| **Notification Service** (generic) | Incident management adds dedup, escalation state machine, on-call resolution, and the meta-reliability requirement |
| **Task Queue / Job Scheduler** | Escalation timers are not jobs — they're dead man's switches with crash recovery and race-condition handling |
| **Monitoring / Alerting System** | Monitoring detects problems; incident management ensures humans respond to them — different SLOs, different failure modes |
| **Ticketing System** (Jira) | Tickets are async with human-driven SLAs; incidents are real-time with machine-enforced escalation |
| **Status Page** | Status pages communicate externally; incident management coordinates internal response — they're complementary, not competing |

---

## 13. Deep Dive Selection Strategy

How to choose your deep dive based on interviewer signals:

| Interviewer Focus | Recommended Deep Dive | Key Points to Hit |
|------------------|---------------------|-------------------|
| Distributed systems | Escalation timer consistency | Timer wheel, crash recovery, CAS, generation counters, split-brain prevention |
| Scale / performance | Alert storm handling | Dedup engine scaling, back-pressure, queue absorption, adaptive dedup windows |
| Reliability | Meta-monitoring + notification delivery | Synthetic transactions, multi-channel failover, composite reliability math |
| Security | Runbook safety + alert injection | Sandboxed execution, approval gates, HMAC verification, injection detection |
| Product / UX | On-call experience + postmortems | Burden metrics, fairness scoring, action item tracking, severity vs. urgency |
| Data modeling | Incident lifecycle + dedup schema | State machine, fingerprint schema, sharding strategy, polyglot persistence |

---

## 14. Red Flags and Scoring

### 14.1 Red Flags

| Red Flag | What It Signals |
|----------|----------------|
| Never mentions deduplication | Doesn't understand the core technical challenge of this system |
| Designs a single-region architecture without discussing the trade-off | Misses the meta-reliability requirement that makes this system unique |
| Proposes synchronous processing (no queue) | Will lose alerts during storms; doesn't understand decoupling |
| Ignores the escalation timer race condition | Lacks experience with concurrent state machines |
| No mention of notification failover | Treats notification as a solved problem rather than a reliability challenge |

### 14.2 Scoring Dimensions

| Dimension | Weight | Junior Signal | Senior Signal |
|-----------|--------|--------------|---------------|
| Requirements scoping | 15% | Lists CRUD operations | Identifies meta-reliability, alert storms, human factors |
| Architecture completeness | 25% | Missing dedup or escalation | Queue + dedup + escalation engine + multi-channel + meta-monitoring |
| Deep dive depth | 25% | Surface-level descriptions | Race conditions, CAS, timer crash recovery, composite reliability math |
| Trade-off articulation | 20% | Binary choices | Contextual trade-offs with severity-dependent decisions |
| Operational awareness | 15% | No monitoring discussed | Synthetic transactions, on-call burden, postmortem action tracking |

---

## 15. Extension Topics

| Extension | What It Adds |
|-----------|-------------|
| **AIOps correlation** | ML-based grouping of "related but different" alerts using service dependency graph + temporal proximity |
| **Autonomous remediation** | AI agents that execute runbook sequences without human intervention for well-characterized failure modes |
| **Cross-organization incident sharing** | Federated incident protocols for supply-chain outages that span multiple companies |
| **Predictive escalation** | ML model that predicts L1 non-response based on time-of-day, engineer history, and channel — pre-pages L2 |
| **Cost-aware notification routing** | Real-time optimization that balances delivery reliability against telephony cost per notification |

---

## 16. Five-Minute Elevator Pitch

> "The incident management system ingests alerts from all monitoring sources, deduplicates them using fingerprint-based grouping to prevent alert storms from overwhelming responders, resolves the on-call schedule to determine who should be notified, and drives a multi-level escalation state machine that guarantees someone is always notified — even if the first three responders are unreachable.
>
> The key architectural decisions are: a durable queue between ingestion and processing to absorb alert bursts without loss; fingerprint-based dedup with a sliding window as the primary noise reduction layer; an isolated escalation engine with persistent timers that survive process restarts; and multi-channel notification with per-user preferences and automatic failover.
>
> The unique challenge is meta-reliability: this system must be strictly more available than everything it monitors, because if it goes down during an outage, the organization is blind. We solve this with active-active multi-region deployment, break-glass authentication independent of SSO, and a separate meta-monitoring system that uses an independent notification path to detect platform failures."
