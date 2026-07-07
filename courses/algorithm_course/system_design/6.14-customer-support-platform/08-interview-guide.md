# Interview Guide

## 45-Minute Interview Pacing

| Time | Phase | Focus | Key Actions |
|------|-------|-------|-------------|
| **0-5 min** | Clarify & Scope | Ask clarifying questions; define boundaries | Establish scale, channels, SLA importance, multi-tenancy |
| **5-12 min** | High-Level Architecture | Core components and data flow | Draw the architecture: clients → gateway → services → data stores |
| **12-25 min** | Deep Dive | 1-2 critical components | Choose: SLA engine + AI routing OR live chat + omnichannel threading |
| **25-35 min** | Scale & Trade-offs | Bottlenecks, failure modes, scaling | Multi-tenancy isolation, noisy neighbors, SLA timer accuracy at scale |
| **35-42 min** | Extensions | Additional features, edge cases | Knowledge base deflection, automation rules, GDPR compliance |
| **42-45 min** | Wrap Up | Summary, handle questions | Highlight unique aspects, mention what you would improve with more time |

---

## Start Here: What to Say in the First 5 Minutes

### Opening Statement

> "A customer support platform is fundamentally a **ticket lifecycle engine** with **real-time chat**, **knowledge base deflection**, **AI-powered routing**, and **SLA enforcement**---all operating in a **multi-tenant SaaS** model. Let me ask a few questions to scope this correctly."

### Clarifying Questions to Ask

1. **Scale**: "How many tenant organizations? Are we talking 1,000 or 100,000+?"
2. **Channels**: "Which channels do we need to support? Email, live chat, social, phone?"
3. **SLA complexity**: "Do different tenants have different SLA policies with business hour calculations?"
4. **AI expectations**: "Should AI route tickets automatically, or just suggest to agents?"
5. **Multi-tenancy model**: "Shared infrastructure or dedicated per tenant?"
6. **Real-time requirement**: "Is live chat in scope, or just async ticketing?"

### After Clarification, State Your Assumptions

> "I'll design for 150K+ tenants, 15M tickets/day, 500K concurrent chat sessions. Multi-tenant with shared infrastructure, AI-powered routing with human fallback, SLA tracking with business hour calculations, and an LLM-powered autonomous resolution layer for straightforward queries. Let me start with the architecture."

### Architecture Skeleton (Draw This First)

```
Clients (Widget, Agent Dashboard, API)
  → API Gateway (REST) + WebSocket Gateway (Chat)
    → Core Services:
       Ticket Service → SLA Engine
       Chat Service → WebSocket Gateway
       KB Service → Search Engine
       AI/ML Service → Routing Service
       Automation Service → Worker Pool
       Notification Service → Email/Push/Webhook
    → Data Layer:
       Primary DB (sharded by tenant_id)
       Chat DB (append-only, time-partitioned)
       Search Index (BM25 + vector)
       Distributed Cache (SLA timers, sessions)
       Message Queue (event bus)
       Object Storage (attachments)
```

---

## 10 Likely Interviewer Questions with Answers

### 1. "How would you design the SLA timer system?"

**Answer**: SLA timers are distributed stateful computations. Each ticket gets timers (first response, resolution) with targets computed in business hours using the tenant's timezone and holiday calendar. I'd use a **timer wheel** partitioned by tenant across worker nodes, with 10-second resolution. Timer state lives in a distributed cache backed by durable storage. On ticket events (status changes, agent replies), timers are paused/resumed/fulfilled. On breach, an event triggers the escalation chain. The key challenge is business hour computation---converting wall clock time to business time requires timezone-aware, calendar-aware arithmetic.

### 2. "How does AI routing work?"

**Answer**: Three-phase pipeline: (1) **Intent classification** using a fine-tuned transformer model that predicts the ticket category (billing, technical, account, etc.) in ~50ms. (2) **Priority prediction** combining text features with customer context (tier, sentiment, history). (3) **Agent matching** scoring candidates on skill match (35%), availability (25%), customer affinity (15%), and load balance (25%). If AI confidence is below 0.6, the ticket goes to a manual triage queue. Tenant-configured rules take precedence over AI decisions. Agent reassignments feed back into model retraining.

### 3. "How do you handle multi-tenancy?"

**Answer**: Shared-schema with `tenant_id` on every table. Isolation enforced at three layers: (1) API Gateway extracts tenant from subdomain/API key. (2) Service layer requires tenant_id in every query via middleware. (3) Database-level row security policies prevent cross-tenant access even if application code has bugs. Per-tenant rate limiting prevents noisy neighbors. Enterprise tenants can get dedicated compute pools.

### 4. "How do you handle a hot tenant scenario?"

**Answer**: When one tenant's product goes down and they get 100x normal ticket volume: (1) Per-tenant rate limiting at the API Gateway caps their request rate. (2) Per-tenant query budgets at the database layer prevent their queries from monopolizing shared resources. (3) Auto-scaling adds capacity, but scoped to the hot tenant's shard. (4) For enterprise tenants, traffic can be dynamically routed to a dedicated pool. (5) SLA timers for other tenants continue unaffected because timer workers are partitioned by tenant.

### 5. "How does knowledge base deflection work?"

**Answer**: When a customer starts typing a ticket or enters chat, we run a **hybrid search** (BM25 keyword + semantic embedding) against the tenant's published articles. Results are merged via Reciprocal Rank Fusion and re-ranked by engagement signals (click-through rate, helpful ratio, recency). Top 3-5 articles are shown before the customer submits. We track whether the customer viewed an article and still created a ticket (failed deflection) or left without creating one (successful deflection). This data drives a flywheel: articles with high deflection rates are promoted; queries with no effective articles are flagged as content gaps.

### 6. "How do you ensure chat messages are delivered in order?"

**Answer**: The Chat Service assigns a **monotonic sequence number** per conversation when messages arrive at the server. Even if network timing causes out-of-order arrival, the server-assigned sequence is the source of truth. Clients buffer incoming messages and render them sorted by sequence number. For the rare case where two messages arrive at the server simultaneously, the server serializes them within the conversation (single-writer pattern per conversation).

### 7. "What happens when the AI model is wrong?"

**Answer**: Every AI routing decision is transparent---agents see the predicted intent, confidence score, and routing reason. Agents can manually reassign the ticket with a reason (wrong skill, overloaded, customer request). Reassignments are logged and fed back as training data. We track AI routing accuracy as a metric (target: >85% correct first assignment). If accuracy drops below 75%, we alert the ML team and can fall back to rule-based routing per tenant.

### 8. "How do you handle GDPR data deletion requests?"

**Answer**: On a deletion request, we identify all customer data (tickets, conversations, analytics), check for legal holds, then **anonymize** rather than hard-delete. Customer name becomes "Deleted Customer," email is hashed, custom fields are cleared. Ticket content is retained (with PII redacted) because it may be needed for operational continuity. Pure customer data (session logs, analytics events) is fully deleted. The entire process is audit-logged. We also auto-detect and redact PII (credit card numbers, SSNs) on ingestion.

### 9. "How does the system handle a WebSocket gateway node failure?"

**Answer**: When a gateway node crashes, all its connections drop. Clients detect the disconnect and auto-reconnect to a different gateway node. On reconnect, the client sends its `last_message_id`, and the server replays any missed messages. No messages are lost because they're persisted to the Chat DB before delivery acknowledgment. Agent presence updates within 5-10 seconds. Active conversations are briefly interrupted but resume seamlessly.

### 10. "How would you scale this to handle 100x growth?"

**Answer**: Current architecture handles this with: (1) **Database**: Add more shards; consistent hashing means only 1/N of tenants migrate per new shard. (2) **WebSocket Gateway**: Add nodes; connections are distributed by user hash. (3) **AI inference**: Add GPU nodes; batch requests for efficiency. (4) **SLA timers**: Add worker nodes; partitions redistribute automatically. The architecture is already event-driven and horizontally scalable. The main challenge at 100x is database shard management and cross-shard reporting---I'd invest in a dedicated analytics layer with pre-aggregated data.

---

## Trade-Off Questions to Proactively Raise

| Decision | Option A | Option B | Recommendation |
|----------|----------|----------|----------------|
| **Multi-tenancy model** | Shared schema (all tenants in same DB) | Dedicated DB per tenant | Shared schema for cost efficiency at 150K tenants; dedicated for top-tier enterprise |
| **SLA timer storage** | Cache only (fast but volatile) | Database only (durable but slow) | Cache + DB hybrid: cache for active computation, DB for durability and recovery |
| **AI routing confidence** | Auto-route at any confidence | Only auto-route above threshold | Threshold-based: >0.8 auto-route, 0.6-0.8 route to group, <0.6 manual triage |
| **Chat message persistence** | Sync write before delivery | Async write after delivery | Sync write: latency cost (~5ms) is worth zero message loss guarantee |
| **Search freshness** | Real-time indexing | Batch indexing (every N minutes) | Near-real-time via CDC: 5-30 second lag is acceptable; avoids indexing storm on bulk updates |
| **Notification delivery** | Sync (block until sent) | Async (queue and deliver) | Async: ticket creation should not depend on email delivery success |
| **Ticket event storage** | Denormalized in ticket record | Separate event log (event sourcing) | Event log: preserves full history, enables replay, supports audit requirements |

---

## Trap Questions to Avoid

| Trap Question | What They Want | How to Answer |
|---------------|---------------|---------------|
| "Why not just use a simple cron job for SLA timers?" | Test understanding of distributed timer challenges | "Cron works at small scale, but at 15M timers it means scanning all timers every minute. Timer wheel with event-driven updates is O(active timers due) per check, not O(all timers)." |
| "Can't you just use WebSocket for everything?" | Test protocol choice reasoning | "WebSockets are great for real-time (chat, presence), but REST is better for CRUD operations---it's cacheable, stateless, and works with standard API tooling. Mixing them adds unnecessary complexity for ticket operations." |
| "Why not store chat messages in the same database as tickets?" | Test polyglot persistence understanding | "Tickets need ACID transactions and complex queries (JOINs, aggregations). Chat messages are high-throughput, append-only, time-ordered. Different access patterns warrant different storage optimized for each." |
| "How is this different from a CRM?" | Test domain understanding | "CRM manages the sales relationship (leads, opportunities, pipeline). Support platform manages post-sale service (tickets, SLAs, chat). Different lifecycle, different time sensitivity, different metrics. The customer record may be shared, but the core engines are fundamentally different." |
| "What if an SLA timer fires and the message queue is backed up?" | Test failure mode thinking | "SLA breaches are detected by the timer worker, not the message queue. Breach detection is a pull model (worker checks timers), not push. Queue backlog affects downstream actions (notifications, escalation) but not breach detection itself." |
| "Why not use ML for everything?" | Test pragmatism | "ML is great for classification and prediction (intent, priority), but terrible for deterministic business logic (SLA computation, escalation rules). Rules are transparent, auditable, and instantly changeable. ML is a black box that requires retraining." |

---

## Key Numbers to Memorize

| Metric | Value | Context |
|--------|-------|---------|
| Tickets per day | 15M | Across all tenants |
| Chat messages per day | 100M | ~20 messages per conversation |
| Concurrent chat sessions | 500K | Peak at any moment |
| WebSocket connections | 2.5M | Agents + customers |
| Active SLA timers | 15M | 5M active tickets * 3 timers |
| Tenants | 150K | Shared infrastructure |
| API latency target | p99 <800ms | Ticket operations |
| Chat latency target | p99 <300ms | Message delivery |
| SLA timer accuracy | <1 second drift per 24h | Business time computation |
| AI routing accuracy | >85% | First-contact resolution |
| KB deflection rate target | >15% | Tickets avoided via self-service |
| Ticket event throughput | ~52K/s peak | Creation + updates + comments |

---

## Comparison: "How Is This Different from Designing a CRM?"

| Dimension | CRM (Salesforce-style) | Customer Support Platform (This) |
|-----------|------------------------|----------------------------------|
| **Primary workflow** | Sales pipeline (Lead → Opportunity → Close) | Service lifecycle (New → Open → Solved → Closed) |
| **Time horizon** | Days to months (sales cycle) | Minutes to hours (SLA targets) |
| **Real-time needs** | Low (dashboards, notifications) | High (live chat, SLA timers, presence) |
| **AI role** | Lead scoring, forecasting | Intent classification, routing, deflection |
| **Key metric** | Revenue, conversion rate | SLA compliance, CSAT, resolution time |
| **Data model complexity** | Custom objects, relationships | Tickets, conversations, SLA timers, business calendars |
| **Unique challenge** | Flexible schema (custom objects/fields) | SLA timer computation across business hours/timezones |
| **Multi-tenancy emphasis** | Metadata-driven customization | Noisy neighbor isolation, per-tenant SLA policies |
| **Channel diversity** | Primarily email + phone | Email + chat + social + phone + API (unified threading) |

### What to Emphasize in a Support Platform Interview (vs. CRM)

1. **SLA timers** are the unique distributed systems challenge---not present in CRM design
2. **Real-time chat** adds WebSocket infrastructure not needed in CRM
3. **Knowledge base deflection** is a support-specific optimization loop
4. **AI routing** is more time-sensitive (must decide in <500ms) than CRM lead scoring
5. **Business hours calculation** is a surprisingly complex domain-specific problem

---

## Architecture Evolution: From V1 to V3

### V1: Monolithic Support Tool (Day 1)
- Single relational database, all tenants in one schema
- Email-only channel with basic ticketing
- Manual assignment (round-robin within groups)
- Simple SLA: wall-clock timer, no business hours
- Monolithic application server
- **Scales to**: 1K tenants, 100K tickets/day

### V2: Service-Oriented with Chat (Growth Stage)
- Microservices split: Ticket Service, Chat Service, KB Service
- WebSocket gateway for live chat (separate from REST API)
- Event-driven architecture for cross-service coordination
- Database sharded by tenant_id
- AI routing introduced (intent classification + agent matching)
- SLA engine with business hour support
- **Scales to**: 50K tenants, 5M tickets/day

### V3: AI-Native Platform (Current Target)
- LLM-powered autonomous resolution (30-40% of tickets resolved without humans)
- RAG-based agent copilot surfaces relevant context and drafts responses
- Proactive support: predictive issue detection from telemetry signals
- Multi-region with data sovereignty (EU tenants served from EU)
- Composable platform with headless API for custom frontends
- Knowledge base auto-generation from resolved ticket patterns
- **Scales to**: 150K+ tenants, 15M+ tickets/day

---

## Extension: Proactive and Predictive Support

If the interviewer asks about proactive support, cover these points:

1. **Anomaly detection on customer telemetry**: If a tenant's product exposes health signals (API error rates, checkout failures), the support platform can detect anomalies and create proactive tickets *before* customers report issues.

2. **Known-issue matching**: When a tenant reports a product bug, the system identifies other customers likely affected by the same issue and proactively reaches out.

3. **Predictive escalation**: ML model predicts which tickets will breach SLA based on current queue depth, agent availability, and historical patterns. Supervisors see a "likely breach" dashboard with time to act.

4. **Post-resolution follow-up**: After resolving a complex issue, the system schedules an automated follow-up to verify the fix worked, reducing reopen rates.

---

## Extension: LLM-Powered Autonomous Resolution

Key points for discussing AI-driven resolution:

1. **Architecture**: Customer query → LLM with RAG retrieves KB articles + similar resolved tickets → generates candidate resolution → confidence scoring → if high confidence, deliver to customer; if low, route to agent with draft.

2. **Guardrails**: LLM responses are bounded by the tenant's KB and approved templates. No hallucinated URLs, no fabricated policies. Every response includes a citation to the source article.

3. **Escalation triggers**: Detect when the LLM conversation is going in circles (repeated questions), when customer sentiment turns negative, or when the topic involves billing/refunds (high-risk actions require human approval).

4. **Metrics**: Autonomous resolution rate (target: 30-40%), customer satisfaction with AI-resolved tickets, escalation rate from AI to human, false-resolution rate (customer reopens within 24h).

---

## Common Mistakes to Avoid

1. **Ignoring multi-tenancy**: Designing as if it is a single-tenant system. Multi-tenancy affects every layer---data isolation, rate limiting, SLA computation, feature gating.

2. **Underestimating SLA timer complexity**: Treating SLA as a simple `target_time = created_at + sla_hours`. Business hours, timezones, holidays, and pause/resume logic make this a real distributed systems problem.

3. **Over-indexing on AI**: Spending 20 minutes on ML architecture when the interviewer wants to hear about the support platform infrastructure. AI routing is one component, not the whole system.

4. **Forgetting about the knowledge base**: The KB deflection mechanism is a key differentiator that shows you understand the support domain.

5. **Not discussing the WebSocket/REST split**: Many candidates try to use one protocol for everything. Explaining why chat uses WebSocket and tickets use REST shows protocol literacy.

6. **Single points of failure in SLA timer**: If the SLA timer service has a single master, a crash means breaches go undetected. This must be distributed with partition tolerance.

7. **Ignoring noisy neighbor**: Without per-tenant isolation, one tenant's outage becomes everyone's outage.

8. **Skipping the feedback loop**: AI routing and KB deflection without feedback collection are static systems. Showing the flywheel (agent overrides → retraining, failed deflections → content gaps) demonstrates systems thinking.

9. **Treating chat and tickets as separate systems**: The omnichannel threading model---where a single issue spans chat, email, and phone---is the core architectural challenge. Designing chat and tickets as isolated subsystems misses this.

10. **Ignoring agent experience**: The agent workspace is the highest-traffic view in the system. Not discussing how it aggregates data from tickets, SLA timers, customer history, and AI suggestions misses a key read-path optimization challenge.

---

## What "World-Class" Looks Like

A candidate who nails this interview will demonstrate:

| Dimension | What to Show |
|-----------|-------------|
| **Breadth** | Cover all 5 subsystems: tickets, chat, KB, AI routing, SLA---even if briefly |
| **Depth** | Go deep on 1-2 areas (SLA timers and AI routing are the strongest choices) |
| **Trade-offs** | Every decision has a cost; name it unprompted ("the downside of this approach is...") |
| **Scale awareness** | Use specific numbers (15M tickets/day, 2.5M WebSocket connections) to justify decisions |
| **Domain expertise** | Reference support-specific concepts: deflection rate, first-contact resolution, CSAT, SLA breach escalation |
| **Evolution** | Describe how the architecture grows from V1 to V3; interviewers love seeing iterative thinking |
| **Multi-tenancy** | Weave tenant isolation throughout, not as an afterthought |

---

## Quick Reference: Key Numbers

| Metric | Value | Why It Matters |
|--------|-------|----------------|
| Tickets per day | 15M | Drives storage, throughput, and scaling decisions |
| Chat messages per day | 100M | ~20 messages per conversation, high-throughput write path |
| Concurrent chat sessions | 500K | Peak WebSocket connections; drives gateway sizing |
| WebSocket connections | 2.5M | Agents + customers; stateful connection management |
| Active SLA timers | 15M | 5M active tickets * 3 timers; timer wheel sizing |
| Tenants | 150K | Shared infrastructure with strict isolation |
| API latency target | p99 <800ms | Ticket operations; agent productivity |
| Chat latency target | p99 <300ms | Message delivery; real-time experience |
| SLA timer accuracy | <1s drift/24h | Business time computation; contractual compliance |
| AI routing accuracy | >85% | First-contact resolution; measured by reassignment rate |
| KB deflection rate | >15% | Tickets avoided via self-service; direct cost savings |
| Autonomous resolution | >30% | LLM-resolved without human; 2025+ benchmark |
| Ticket storage/year | ~55 TB | Raw tickets; ~137 TB including events |
| Per-ticket cost | ~$0.0035 | Infrastructure cost at 150M tickets/month |

---

## Whiteboard Walkthrough Script

For a 45-minute interview, here is a concrete script for pacing:

**Minutes 0-2**: State the opening summary. Ask 3-4 clarifying questions.

**Minutes 2-5**: Draw the architecture skeleton (see above). Name each box. Explain the REST/WebSocket split.

**Minutes 5-8**: Walk through the ticket creation data flow end-to-end. Mention each service touched: API Gateway → Ticket Service → AI/ML Service → Routing Service → SLA Engine → Notification Service.

**Minutes 8-12**: Describe the data model briefly. Key entities: Tenant, Agent, Customer, Ticket, TicketEvent, Conversation, Message, SLATimer, Article. Emphasize tenant_id on everything.

**Minutes 12-25**: Deep dive into **SLA timer architecture** (timer wheel, business hour computation, pause/resume, breach detection) and **AI routing** (intent classification, priority prediction, agent scoring, confidence thresholds). These are the two strongest choices because they demonstrate distributed systems and ML integration simultaneously.

**Minutes 25-33**: Scale and reliability. Cover: database sharding by tenant_id, noisy neighbor isolation (rate limiting + dedicated pools), WebSocket gateway horizontal scaling, multi-region with data sovereignty, graceful degradation hierarchy.

**Minutes 33-40**: Extensions. Cover KB deflection (hybrid search, deflection measurement, content gap flywheel), LLM autonomous resolution (RAG, confidence gating, human escalation), and proactive support (telemetry ingestion, anomaly detection, automated outreach).

**Minutes 40-45**: Summarize trade-offs. Mention what you would improve with more time: cross-shard analytics, advanced NLP for conversation merge, and agent workforce management optimization.
