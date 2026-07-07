# Requirements & Estimations — Email Delivery System

## 1. Functional Requirements

### 1.1 Core Features

| # | Feature | Description |
|---|---|---|
| F1 | **Message Ingestion** | Accept emails via REST API (JSON payload) and SMTP relay (RFC 5321) with validation, rate limiting, and idempotency |
| F2 | **Template Rendering** | MJML-based responsive template engine with Handlebars-style variable interpolation, conditional blocks, and localization |
| F3 | **Email Authentication** | Automated DKIM signing (RSA-2048/Ed25519), SPF alignment validation, DMARC policy enforcement, ARC sealing for forwarding |
| F4 | **SMTP Delivery Pipeline** | Multi-stage queue with priority scheduling, per-ISP throttling, TLS negotiation, connection pooling, and retry with exponential backoff |
| F5 | **Bounce Management** | Real-time hard/soft bounce classification from SMTP response codes, automated suppression, and deliverability scoring |
| F6 | **Engagement Tracking** | Open tracking (1x1 pixel), click tracking (redirect proxy), unsubscribe tracking, with bot/machine detection |
| F7 | **Suppression Management** | Global suppression lists (bounces, unsubscribes, spam complaints, manual) with sub-second lookup enforcement |
| F8 | **Webhook Event Delivery** | Real-time HTTP webhooks for all message lifecycle events with retry, batching, HMAC signature, and dead-letter queue |
| F9 | **IP Reputation Management** | IP pool allocation, automated warming schedules, reputation monitoring, and dynamic pool reassignment |
| F10 | **Analytics Dashboard** | Real-time and historical metrics: delivery rates, open/click rates, bounce rates, spam complaint rates, ISP breakdown |

### 1.2 Extended Features

| # | Feature | Description |
|---|---|---|
| F11 | **Campaign Orchestrator** | Scheduled campaign sends with audience segmentation, send-time optimization, and throttled rollout |
| F12 | **A/B Testing** | Subject line, content, and send-time variant testing with statistical significance calculation |
| F13 | **Dedicated IP Management** | Customer-assigned dedicated IPs with self-service warming schedules and reputation dashboards |
| F14 | **Inbound Email Processing** | Receive and parse incoming emails for reply handling, autoresponder triggers, and webhook forwarding |
| F15 | **BIMI Support** | Brand Indicators for Message Identification with VMC certificate management and logo hosting |
| F16 | **Email Validation** | Pre-send recipient validation via MX lookup, syntax check, role account detection, and disposable domain filtering |
| F17 | **Sender Identity Management** | Domain authentication setup wizard, DNS record verification, and multi-domain support per account |
| F18 | **Contact List Management** | Recipient list CRUD with field mapping, segment builder, and consent status tracking |
| F19 | **Email Preview** | Cross-client rendering preview (Gmail, Outlook, Apple Mail, mobile) with spam score estimation |
| F20 | **Feedback Loop Integration** | Automated ARF (Abuse Reporting Format) processing from ISPs with complaint-to-suppression pipeline |

### 1.3 Out of Scope

| Exclusion | Rationale |
|---|---|
| Full CRM / Contact management | Focused on delivery infrastructure, not customer relationship management |
| Mailbox hosting (IMAP/POP3) | This is a sending platform, not a receiving mailbox provider |
| Calendar invites / scheduling | Specialized protocol (CalDAV) outside core delivery focus |
| Social media integration | Cross-channel marketing is a separate platform concern |
| Landing page builder | Web content management is orthogonal to email delivery |

---

## 2. Non-Functional Requirements

### 2.1 Performance

| Metric | Target | Rationale |
|---|---|---|
| **API ingestion latency** | < 200ms (P95) | API calls should return accepted status quickly; actual delivery is asynchronous |
| **Transactional delivery time** | < 5 seconds (P95) | Password resets, 2FA codes, and order confirmations are user-blocking |
| **Template rendering time** | < 50ms (P99) | Rendering must not Slowest part of the process the delivery pipeline |
| **Suppression lookup** | < 5ms (P99) | Every outgoing message must check suppression lists; latency multiplies by volume |
| **Click redirect latency** | < 100ms (P95) | Redirect delay affects user experience and perceived link quality |
| **Webhook delivery** | < 30 seconds (P95) | Near-real-time event notification for customer integrations |
| **Bounce classification** | < 2 seconds | Bounce events must update suppression lists before next send attempt |
| **Dashboard query latency** | < 3 seconds (P95) | Analytics queries across large datasets with interactive filtering |

### 2.2 Availability & Durability

| Metric | Target | Rationale |
|---|---|---|
| **API availability** | 99.99% (52.6 min/year downtime) | Customers build critical workflows (password resets, 2FA) on this API |
| **Delivery pipeline availability** | 99.95% (4.4 hours/year) | Queued messages survive component failures; delay is acceptable, loss is not |
| **Message durability** | 99.9999% (six nines) | Once accepted via API, a message must never be lost before delivery or bounce |
| **Suppression list durability** | 99.99999% (seven nines) | Sending to a suppressed address has legal and reputation consequences |
| **Analytics data durability** | 99.999% (five nines) | Engagement data drives customer business decisions |
| **RPO (Recovery Point Objective)** | 0 for message queue, < 5 min for analytics | Zero message loss; analytics can tolerate short gaps |
| **RTO (Recovery Time Objective)** | < 5 min for API, < 15 min for pipeline | API must recover quickly; pipeline can drain queue after recovery |

### 2.3 Consistency Model

| Data Type | Consistency | Justification |
|---|---|---|
| **Suppression lists** | Strong consistency | Sending to a suppressed address is a compliance violation; must block immediately |
| **DKIM keys / domain config** | Strong consistency | Signing with a revoked key produces authentication failures |
| **Message queue state** | Strong consistency | Double-delivery is preferable to message loss, but neither is acceptable |
| **Engagement events** | Eventual consistency | Open/click events tolerate seconds of delay; analytics aggregation is batch |
| **Analytics aggregates** | Eventual consistency | Dashboard metrics lag by seconds to minutes; freshness is not critical |
| **IP reputation scores** | Eventual consistency | Reputation scores are Practical rule of thumb and update on minute-scale windows |

---

## 3. Capacity Estimations

### 3.1 Traffic Profile

**Assumptions (Large Email Service Provider):**
- 100B emails/month = ~3.3B emails/day
- 60% marketing (batched), 40% transactional (real-time)
- Average email size: 75 KB (HTML body + headers + tracking)
- Peak-to-average ratio: 3x (marketing campaigns cluster around business hours)
- Average open rate: 25%, average click rate: 3%
- Bounce rate: 2%, spam complaint rate: 0.05%

### 3.2 Capacity Table

| Metric | Estimation | Calculation |
|---|---|---|
| **Daily email volume** | 3.3B emails/day | 100B / 30 days |
| **Average send rate** | ~38,200 emails/sec | 3.3B / 86,400 |
| **Peak send rate** | ~115,000 emails/sec | 38,200 × 3x peak factor |
| **API ingestion (peak)** | ~80,000 requests/sec | 70% via API × 115K; remainder via SMTP relay |
| **SMTP connections (outbound)** | ~750,000 concurrent | At 150 emails/connection/sec avg, need 750K connections |
| **Daily bandwidth (outbound)** | ~248 TB/day | 3.3B × 75 KB |
| **Peak bandwidth** | ~23 Gbps | 248 TB / 86,400 × 3x peak × 8 bits |
| **Daily open events** | 825M events/day | 3.3B × 25% open rate |
| **Daily click events** | 99M events/day | 3.3B × 3% click rate |
| **Daily bounce events** | 66M events/day | 3.3B × 2% bounce rate |
| **Webhook events** | 5B events/day | ~1.5 events per email (delivery + engagement) |
| **Pixel server requests (peak)** | ~28,600 req/sec | 825M / 86,400 × 3x peak |
| **Click redirect (peak)** | ~3,400 req/sec | 99M / 86,400 × 3x peak |
| **Suppression lookups** | 115,000 lookups/sec (peak) | Every outbound email checks suppression |

### 3.3 Storage Estimates

| Data Type | Size | Calculation |
|---|---|---|
| **Message metadata (Year 1)** | ~120 TB | 3.3B/day × 100 bytes metadata × 365 days |
| **Message content (30-day retention)** | ~7.4 PB | 3.3B/day × 75 KB × 30 days |
| **Engagement events (Year 1)** | ~200 TB | 5B events/day × 150 bytes × 365 days |
| **Suppression list** | ~200 GB | 5B addresses × 40 bytes avg (hash + metadata) |
| **Template storage** | ~5 TB | 10M templates × 500 KB avg (MJML + compiled HTML + versions) |
| **DKIM keys + domain config** | ~50 GB | 5M domains × 10 KB (keys + DNS records + config) |
| **Analytics aggregates (Year 1)** | ~50 TB | Pre-computed rollups by account/domain/ISP/day |
| **Webhook delivery logs (90-day)** | ~135 TB | 5B events/day × 100 bytes × 90 days |
| **Total active storage** | ~8 PB | Sum of all active data |
| **Total with replication** | ~24 PB | 3x replication factor |

---

## 4. SLOs / SLAs

### 4.1 Service Level Objectives

| Metric | SLO Target | Measurement Window | Measurement Method |
|---|---|---|---|
| **API Availability** | 99.99% | Monthly | Successful API responses / total requests |
| **API Latency (P99)** | < 500ms | Rolling 5 min | Time from request receipt to 202 Accepted response |
| **Transactional Delivery (P95)** | < 5 seconds | Rolling 1 hour | Time from API acceptance to first delivery attempt |
| **Marketing Delivery Completion** | < 4 hours | Per campaign | Time from campaign start to last message delivered |
| **Inbox Placement Rate** | > 95% | Weekly | Seed-based inbox monitoring across major ISPs |
| **Bounce Rate (platform avg)** | < 2% | Monthly | Hard + soft bounces / total sent |
| **Spam Complaint Rate** | < 0.05% | Monthly | FBL complaints / delivered messages |
| **Webhook Delivery (P95)** | < 30 seconds | Rolling 1 hour | Time from event occurrence to webhook POST |
| **Webhook Success Rate** | > 99.5% | Monthly | Successful webhook deliveries / total attempts (with retries) |

### 4.2 Service Level Agreements

| Tier | API Uptime | Delivery SLA | Credit |
|---|---|---|---|
| **Free** | 99.9% | Best effort | None |
| **Pro** | 99.95% | < 10 sec transactional (P95) | 10% credit per 0.1% below target |
| **Enterprise** | 99.99% | < 5 sec transactional (P99) | 25% credit per 0.01% below target |
| **Dedicated** | 99.99% | < 3 sec transactional (P99), dedicated IPs | Custom SLA with financial penalties |

---

## 5. Key Design Constraints

### 5.1 External Constraints

| Constraint | Impact |
|---|---|
| **ISP rate limits** | Gmail accepts ~100-500 connections/IP; exceeding triggers temporary blocks |
| **RFC 5321 compliance** | SMTP protocol requirements for HELO, MAIL FROM, RCPT TO, DATA flow |
| **DNS propagation** | SPF/DKIM/DMARC record changes take 0-48 hours to propagate |
| **IP warming requirements** | New IPs start at 50-100 emails/day, taking 4-6 weeks to reach full volume |
| **ISP authentication mandates** | Gmail/Yahoo (Feb 2024), Microsoft (May 2025): DKIM + SPF + DMARC required for bulk senders |
| **RFC 8058** | One-click unsubscribe via List-Unsubscribe-Post header required for marketing emails |
| **Message size limits** | Most ISPs reject messages > 25-50 MB |

### 5.2 Internal Constraints

| Constraint | Impact |
|---|---|
| **Shared IP isolation** | Bad sender on shared IP affects all senders on that IP; requires traffic quality monitoring |
| **DKIM key size** | RSA-2048 signatures add ~350 bytes per header; Ed25519 is smaller but has less ISP support |
| **Suppression check latency** | Must be sub-millisecond at 115K lookups/sec; bloom filter + cache + persistent store |
| **Template rendering CPU** | MJML transpilation is CPU-intensive; must be cached and pre-compiled |
| **Connection state** | SMTP connections are stateful and long-lived; connection pooling per destination domain is critical |

---

## 6. Back-of-Envelope Calculations

### 6.1 Outbound SMTP Connection Pool Sizing

At peak, the system delivers ~115,000 emails/second. Each SMTP connection involves a multi-round-trip handshake:

```
Connection lifecycle:
  TCP handshake:      ~10ms
  TLS negotiation:    ~20ms
  EHLO exchange:      ~5ms
  MAIL FROM + RCPT TO: ~5ms per recipient
  DATA transfer:      ~10ms (75 KB email at 100 Mbps LAN to MX)
  Total per message:  ~50ms (single recipient, new connection)

With SMTP pipelining (batch N messages per connection):
  First message:      ~50ms
  Each subsequent:    ~20ms (MAIL FROM + RCPT TO + DATA only)
  Batch of 10:        ~230ms → ~23ms per message

Required connections at peak (115K msg/s ÷ (1000ms / 23ms per msg)):
  = 115,000 × 0.023 = ~2,645 concurrent connections (with pipelining)

Without pipelining (conservative):
  = 115,000 × 0.050 = ~5,750 concurrent connections

Add overhead for ISP-specific throttling (some ISPs limit to 10 msg/connection):
  Gmail pool:     ~600 connections (60% traffic × 115K ÷ 100 msg/conn/s)
  Microsoft pool: ~230 connections (20% traffic)
  Yahoo pool:     ~115 connections (10% traffic)
  Other ISPs:     ~700 connections (10% traffic, many small domains)
  Total:          ~1,645 active + 50% reserve = ~2,500 connection pool
```

### 6.2 Suppression Bloom Filter Sizing

```
Parameters:
  n = 5 billion suppressed addresses
  p = 0.001 (0.1% false positive rate)

Optimal bloom filter size:
  m = -(n × ln(p)) / (ln(2))²
  m = -(5×10⁹ × ln(0.001)) / (0.693)²
  m = -(5×10⁹ × -6.908) / 0.480
  m = 71.9 × 10⁹ bits = ~8.99 GB

Optimal hash functions:
  k = (m/n) × ln(2)
  k = (71.9×10⁹ / 5×10⁹) × 0.693
  k = 14.38 × 0.693 ≈ 10 hash functions

Memory budget:
  Bloom filter:              ~9 GB
  Process-local replica:     ~9 GB per MTA worker (too large)
  Solution: Partition into 32 shards of ~281 MB each
  Each MTA worker loads shards for its assigned domain range
  Per-worker memory: 4 shards × 281 MB = ~1.1 GB (manageable)
```

### 6.3 DKIM Signing Throughput Budget

```
RSA-2048 signing cost:
  ~0.3ms per signature on modern CPU
  Single core throughput: ~3,333 signatures/second

At peak 115K msg/s:
  Required cores: 115,000 / 3,333 = ~35 CPU cores

Ed25519 signing cost (alternative):
  ~0.02ms per signature
  Single core throughput: ~50,000 signatures/second
  Required cores: 115,000 / 50,000 = ~3 CPU cores

Trade-off: Ed25519 is 15x faster but ~80% ISP support vs. ~99% for RSA-2048
Strategy: Dual-sign (both RSA-2048 + Ed25519) costs ~0.32ms, needs ~37 cores
Recommendation: 10 signing workers × 4 cores each = 40 cores with headroom
```

### 6.4 Webhook Event Delivery Budget

```
Total webhook events: ~5B/day = ~58K events/second average
Peak (3x): ~174K events/second

Per webhook delivery:
  HTTP POST:        ~100ms average (varies by customer endpoint)
  Retry overhead:   0.5% of events need retry × 3 retries avg = 1.5% overhead
  Effective rate:   ~177K deliveries/second at peak

With batching (100 events per POST):
  Required outbound connections: 177K / 100 = 1,770 POST/s
  At 100ms per POST: ~177 concurrent HTTP connections
  With 10x headroom for slow endpoints: ~1,770 connections

Worker sizing:
  Each worker handles 50 concurrent connections
  Workers needed: 1,770 / 50 = ~36 workers at peak
  With 2x safety margin: 72 webhook workers
```

### 6.5 Cost Estimation

| Component | Monthly Cost | Calculation |
|---|---|---|
| **Compute (MTA fleet)** | ~$180K | 200 MTA workers × $900/month avg |
| **Compute (API/processing)** | ~$90K | 100 workers × $900/month |
| **IP addresses** | ~$50K | 2,000 IPs × $25/month lease + management |
| **Bandwidth (outbound)** | ~$350K | 248 TB/day × 30 × $0.005/GB (bulk rate) |
| **Queue storage** | ~$30K | Message queue + retry queue + webhook queue |
| **Persistent storage** | ~$120K | 24 PB replicated storage (tiered pricing) |
| **Tracking infrastructure** | ~$40K | Edge PoP costs for pixel/click servers |
| **DNS infrastructure** | ~$15K | Dedicated resolver cluster + anycast DNS |
| **Monitoring/observability** | ~$25K | Metrics, logging, tracing infrastructure |
| **Total** | **~$900K/month** | **~$0.009 per email sent** |

---

## 7. Traffic Patterns and Spike Scenarios

### 7.1 Typical Weekly Pattern

| Day | Relative Volume | Peak Hours (UTC) | Notes |
|---|---|---|---|
| Monday | 1.3x average | 14:00–18:00 | Marketing catch-up after weekend |
| Tuesday–Thursday | 1.1x average | 14:00–18:00 | Steady marketing + transactional |
| Friday | 1.0x average | 12:00–16:00 | Slight decline as campaigns wind down |
| Saturday | 0.6x average | 16:00–20:00 | Minimal marketing; transactional steady |
| Sunday | 0.5x average | 18:00–22:00 | Lowest volume; transactional only |

### 7.2 Spike Scenarios

| Scenario | Volume Spike | Duration | System Response |
|---|---|---|---|
| **Black Friday/Cyber Monday** | 5–8x normal | 3 days | Pre-scaled MTA fleet; campaign throttling; transactional priority |
| **Major platform outage notification** | 10x transactional | 1–2 hours | Dedicated transactional path bypasses marketing queue |
| **Password reset storm (breach disclosure)** | 20x transactional for one customer | 30–60 min | Per-customer rate limiting; burst capacity from warm IP reserves |
| **Simultaneous large campaigns** | 3–5x marketing | 4–8 hours | Campaign staggering; queue backpressure; ISP-aware throttling |
| **ISP recovery after outage** | Drain spike: 2x normal | 1–2 hours | Gradual drain with ISP-specific ramp-up; avoid triggering blocks |

---

*Previous: [Index](./00-index.md) | Next: [High-Level Design ->](./02-high-level-design.md)*
