# Requirements & Estimations

## Functional Requirements

### Primary (Must-Have)

1. **Ticket Lifecycle Management**: Create, assign, update, resolve, and close support tickets with full audit trail. Support statuses: New, Open, Pending, On-Hold, Solved, Closed. Tickets can be created via email, chat, API, web form, or social media.

2. **Live Chat**: Real-time bidirectional messaging between customers and agents via WebSocket. Support typing indicators, read receipts, file attachments, and emoji reactions. Agent-side features: canned responses, internal notes, conversation transfer.

3. **Knowledge Base**: Self-service portal with articles organized in categories and sections. Full-text search with relevance ranking. Article versioning, access control (public vs. internal), and feedback collection (helpful/not helpful).

4. **AI-Powered Routing**: Automatically classify incoming tickets by intent (billing, technical, account, etc.), predict priority (low/normal/high/urgent), and route to the best-matched agent based on skills, availability, and current workload. Confidence-based fallback to manual triage.

5. **SLA Management**: Define SLA policies with response and resolution time targets per priority level. Track SLA timers accounting for business hours, timezone, holidays, and paused states. Trigger escalation workflows on breach or near-breach.

6. **Omnichannel Threading**: Unify conversations across email, chat, phone, social media, and API into a single ticket thread. Preserve full context when a conversation transitions between channels.

7. **Agent Workspace**: Unified agent dashboard showing assigned tickets, active chats, SLA status, customer context (previous tickets, account info), and suggested knowledge base articles. Support for agent collision detection (two agents working the same ticket).

### Secondary (Should-Have)

8. **Automation Rules (Triggers & Automations)**: Event-driven rules that execute actions on tickets (auto-tag, auto-assign, auto-close stale tickets, send notifications). Triggers fire on ticket events; automations fire on time-based conditions.

9. **Reporting & Analytics**: Real-time dashboards for ticket volume, SLA compliance, agent performance (handle time, CSAT scores), knowledge base effectiveness (deflection rate, article views). Historical trend analysis.

10. **Customer Satisfaction (CSAT) Surveys**: Automatically send satisfaction surveys after ticket resolution. Aggregate scores per agent, team, and organization.

11. **Integrations**: Webhook-based integrations with CRM, e-commerce, and internal tools. REST API for ticket creation, updates, and querying. SSO for agent authentication.

12. **Multilingual Support**: Automatic language detection for incoming tickets. Machine translation for agents who do not speak the customer's language. Knowledge base article translation management.

### Out of Scope

- Phone/voice call infrastructure (IVR, call recording)---assume integration with third-party telephony
- Full CRM functionality (pipeline management, lead scoring)
- Marketing automation (campaigns, drip sequences)
- Social media monitoring (brand mentions, sentiment analysis beyond support tickets)

---

## Non-Functional Requirements

| Requirement | Target | Justification |
|-------------|--------|---------------|
| **Availability** | 99.95% (26 min downtime/month) | Support is business-critical; extended outages mean missed SLAs |
| **Chat Message Latency** | p50 <100ms, p99 <300ms | Real-time chat requires near-instant delivery |
| **Ticket API Latency** | p50 <200ms, p99 <800ms | Agents interact with tickets continuously; slow responses degrade productivity |
| **Search Latency** | p50 <300ms, p99 <1s | Knowledge base search must feel instant for deflection to work |
| **SLA Timer Accuracy** | Within 1 second of actual business time | SLA breaches have contractual and financial implications |
| **Consistency** | Strong for ticket state, SLA timers | A ticket must never show conflicting states to two agents |
| **Durability** | Zero ticket data loss | Every customer interaction is a contractual record |
| **Throughput** | 50K tickets/min peak across all tenants | Black Friday, product outages cause 10-20x spikes |
| **Multi-tenancy** | 100K+ tenant organizations | Shared infrastructure with strict data isolation |
| **Data Retention** | Configurable per tenant (90 days to 7 years) | Compliance requirements vary by industry |

---

## Scale Assumptions

| Metric | Value | Basis |
|--------|-------|-------|
| Total tenant organizations | 150,000 | Zendesk serves 170K+ customers |
| Total agents across all tenants | 5,000,000 | Average 33 agents per tenant |
| Daily Active Agents (DAA) | 2,000,000 | ~40% daily active rate |
| Tickets created per day | 15,000,000 | ~100 tickets/day per active tenant |
| Chat conversations per day | 5,000,000 | ~1/3 of ticket volume is chat |
| Chat messages per day | 100,000,000 | ~20 messages per chat conversation |
| Concurrent chat sessions | 500,000 | Peak concurrent at any moment |
| Knowledge base articles (total) | 50,000,000 | Average 333 articles per tenant |
| Knowledge base searches per day | 30,000,000 | 2x ticket volume (deflection attempts) |
| Automation rule evaluations per day | 500,000,000 | ~33 rule evaluations per ticket event |
| Webhook deliveries per day | 200,000,000 | ~13 webhooks per ticket lifecycle |

---

## Capacity Estimations

| Resource | Estimation | Calculation |
|----------|-----------|-------------|
| **Ticket storage (per year)** | ~55 TB | 15M tickets/day * 365 days * 10 KB avg ticket size |
| **Chat message storage (per year)** | ~37 TB | 100M messages/day * 365 days * 1 KB avg message |
| **Knowledge base storage** | ~25 TB | 50M articles * 500 KB avg (including images in object storage) |
| **SLA timer state** | ~15 GB active | 5M active tickets * 3 timers * 1 KB timer state |
| **Search index size** | ~5 TB | 50M articles + 500M recent tickets, indexed fields |
| **Ticket write QPS (avg)** | ~5,200 | 15M tickets * ~30 events/ticket / 86,400 seconds |
| **Ticket write QPS (peak)** | ~52,000 | 10x average during incident spikes |
| **Chat message QPS (avg)** | ~1,160 | 100M messages / 86,400 seconds |
| **Chat message QPS (peak)** | ~11,600 | 10x during business hours concentration |
| **WebSocket connections** | 2,500,000 | 2M agents + 500K concurrent customer chat sessions |
| **Bandwidth (inbound)** | ~5 Gbps | Ticket + chat + attachment uploads |
| **Bandwidth (outbound)** | ~15 Gbps | Agent workspace reads + knowledge base serves + webhooks |
| **Cache size** | ~500 GB | Hot tickets, agent sessions, SLA policies, routing rules |

---

## SLO Targets

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| **Platform Availability** | 99.95% | Uptime of core ticket and chat APIs |
| **Chat Message Delivery** | p99 <300ms | Timestamp delta: sender publish to receiver delivery |
| **Ticket API Response** | p99 <800ms | Server-side latency at API gateway |
| **Knowledge Base Search** | p99 <1s | End-to-end search including permission filtering |
| **SLA Timer Accuracy** | <1s drift per 24h | Comparison of computed business time vs wall clock reference |
| **Webhook Delivery** | 99.9% within 60s | First delivery attempt success rate |
| **Error Rate** | <0.1% of API requests | 5xx responses / total requests |
| **Data Durability** | 99.999999999% (11 nines) | No ticket or conversation data loss |
| **Tenant Isolation** | Zero cross-tenant data leaks | Automated isolation testing + audit |
| **AI Routing Accuracy** | >85% correct first assignment | Percentage of tickets not manually reassigned within 1 hour |

---

## Back-of-Envelope Calculations

### Ticket Storage Sizing

```
Given:
  15M tickets/day
  Average ticket: 10 KB (subject, description, metadata, custom fields)
  Average events per ticket: 30 (comments, status changes, assignments)
  Average event: 500 bytes

Ticket records per year:
  15M * 365 = 5.475 B tickets
  5.475B * 10 KB = ~55 TB

Ticket events per year:
  15M * 30 events * 365 = 164 B events
  164B * 500 bytes = ~82 TB

Total ticket storage: ~137 TB/year (before compression)
With 3:1 compression: ~46 TB/year
With 3-year retention: ~138 TB active storage
```

### Chat Message Throughput

```
Given:
  5M chat conversations/day
  Average 20 messages per conversation
  Peak: 80% of chats during 10-hour business window

Average message QPS:
  100M messages / 86,400 seconds = ~1,160 msg/s

Peak message QPS (business hours adjusted):
  80M messages / 36,000 seconds (10 hours) = ~2,222 msg/s
  With 3x burst factor: ~6,666 msg/s

WebSocket fan-out:
  Each message delivered to 2 participants (customer + agent)
  Peak delivery rate: ~13,332 deliveries/s
  Plus typing indicators (ephemeral, ~3x message rate): ~40K events/s
```

### SLA Timer Memory Budget

```
Given:
  5M active tickets * 3 timers each = 15M active timers
  Timer state:
    - timer_id (16 bytes)
    - ticket_id (16 bytes)
    - tenant_id (16 bytes)
    - timer_type (1 byte)
    - status (1 byte)
    - target_at (8 bytes)
    - remaining_seconds (8 bytes)
    - policy_id (16 bytes)
    - timestamps (32 bytes)
    Total: ~114 bytes per timer

Active timer state: 15M * 114 bytes = ~1.7 GB
With overhead (hash maps, pointers): ~5 GB
Timer wheel buckets (10-sec resolution, 24h window):
  8,640 buckets * avg 1,736 timers/bucket * 24 bytes ref = ~360 MB

Total in-memory: ~5.4 GB (fits in single node; partition for availability)
```

### AI Inference Budget

```
Given:
  15M tickets/day requiring classification
  Peak: 70% during business hours → ~10.5M in 10 hours
  Peak QPS: 10.5M / 36,000 = ~292 tickets/s

Per-ticket inference:
  - Tokenization: ~2ms
  - Embedding generation: ~15ms
  - Intent classification: ~8ms
  - Priority prediction: ~5ms
  Total: ~30ms per ticket

GPU utilization (batch size 32):
  Effective throughput: ~1,000 tickets/s per GPU
  Peak requirement: 292 / 1,000 = 0.3 GPUs
  With headroom (3x): 1 GPU minimum, 2 for redundancy

CPU fallback (no batching):
  ~100 tickets/s per core
  Peak: 3 cores, with headroom: 8 cores
```

---

## Traffic Patterns

### Daily Pattern
- **Business hours concentration**: 70% of ticket volume arrives between 8am-6pm in each tenant's local timezone. Since tenants span all timezones, the global system sees a smoothed wave with peaks following the sun.
- **Chat peaks**: Chat volume is even more concentrated during business hours (80%) with sharp ramps at 9am and 1pm local time.
- **Knowledge base traffic**: Follows a similar business hours pattern but with a longer tail---customers search for self-service answers outside business hours when agents are unavailable.
- **Webhook delivery**: Follows ticket event patterns with an additional lag; webhook processing peaks 1-2 seconds after ticket event peaks.

### Spike Scenarios

| Scenario | Multiplier | Duration | Affected Scope |
|----------|-----------|----------|----------------|
| **Product outage (single tenant)** | 50-100x for that tenant | Minutes to hours | One tenant's queue; must not affect others |
| **Seasonal event (Black Friday)** | 5-10x for e-commerce tenants | 24-48 hours | 10-15% of tenants simultaneously |
| **Security incident notification** | 20-50x for affected tenant | 1-4 hours | One tenant with mass-notification to customers |
| **Platform-wide email outage** | 3-5x globally (channel shift to chat) | Hours | All tenants; chat infrastructure must absorb email overflow |
| **New feature rollout** | 2-3x for launching tenant | 1-2 weeks (decaying) | One tenant, predictable and plannable |
| **End-of-quarter B2B SaaS** | 3-5x for SaaS tenants | Last week of quarter | 20-30% of B2B tenants |

### Implications
- Auto-scaling must respond within 2-3 minutes to absorb spikes
- Per-tenant rate limiting prevents one tenant's surge from degrading service for others
- SLA timers must continue ticking accurately even under load spikes
- Channel failover capability: when one channel is degraded, traffic shifts to others
- Pre-warming for predictable spikes (seasonal events) reduces scaling latency

---

## Cost Estimation

| Resource | Monthly Cost Estimate | Basis |
|----------|----------------------|-------|
| **Compute (API + services)** | ~$150K | 200 nodes * $750/node/month |
| **WebSocket Gateway** | ~$45K | 30 nodes optimized for connection handling |
| **Database (primary shards)** | ~$90K | 30 shards * $3K/shard/month (managed service) |
| **Database (read replicas)** | ~$60K | 60 replicas * $1K/replica/month |
| **Distributed cache** | ~$30K | 500 GB cluster |
| **Search engine cluster** | ~$40K | 5 TB index, 12-node cluster |
| **Object storage** | ~$15K | 150 TB at $0.10/GB/month (tiered) |
| **Message queue** | ~$20K | Managed service, 500M+ messages/day |
| **AI/ML inference** | ~$25K | 4 GPU nodes + CPU fallback |
| **CDN + bandwidth** | ~$35K | 15 Gbps outbound average |
| **Monitoring + logging** | ~$20K | Log ingestion, metrics, tracing |
| **Total** | **~$530K/month** | ~$0.0035 per ticket (at 150M tickets/month) |
