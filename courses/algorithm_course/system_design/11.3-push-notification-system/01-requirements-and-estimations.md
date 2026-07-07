# Requirements & Estimations — Push Notification System

## 1. Functional Requirements

### 1.1 Core Features

| # | Feature | Description |
|---|---|---|
| F1 | **Multi-Provider Delivery** | Send notifications via APNs (iOS), FCM (Android/Web), HMS (Huawei), and Web Push (VAPID) through unified API |
| F2 | **Device Token Management** | Register, validate, rotate, and deactivate device tokens with multi-device per-user support |
| F3 | **Notification Routing** | Route notifications to correct provider based on device platform, with fallback chains for critical messages |
| F4 | **Targeting & Segmentation** | Define audiences via boolean expressions over user attributes (location, behavior, demographics, app version) |
| F5 | **Template Management** | Create, version, and render notification templates with variable interpolation and locale support |
| F6 | **Rich Notifications** | Support images, action buttons, deep links, expandable content, and custom data payloads |
| F7 | **Scheduling & Time Zones** | Schedule delivery at specific times, enforce quiet hours, and optimize send times per user's local timezone |
| F8 | **User Preferences** | Per-category opt-in/out, channel preferences, frequency caps, and quiet hours per user |
| F9 | **Silent/Data Push** | Background data sync notifications that don't display to user but trigger app-level processing |
| F10 | **Campaign Management** | Create, schedule, A/B test, and track marketing campaigns targeting millions of devices |

### 1.2 Extended Features

| # | Feature | Description |
|---|---|---|
| F11 | **Topic Subscriptions** | Users subscribe to topics (e.g., "sports_scores", "breaking_news") for interest-based notifications |
| F12 | **Priority Classification** | Classify notifications as transactional (high priority, immediate) or marketing (normal priority, batchable) |
| F13 | **Delivery Receipts** | Track notification lifecycle: accepted → delivered → displayed → opened → dismissed |
| F14 | **Analytics Dashboard** | Real-time metrics: delivery rates, open rates, CTR, uninstall correlation, A/B test results |
| F15 | **Rate Limiting** | Per-provider rate limiting (respect APNs/FCM quotas), per-user frequency capping, campaign pacing |
| F16 | **Notification Grouping** | Collapse multiple notifications into summary groups on device (e.g., "5 new messages from Chat") |
| F17 | **Personalization Engine** | ML-driven optimal send time, content variant selection, and channel preference prediction |
| F18 | **Fallback Channels** | Escalate undelivered critical notifications to email or SMS after configurable timeout |
| F19 | **Webhook Callbacks** | Notify calling services of delivery events (sent, delivered, opened, failed) via webhook |
| F20 | **Multi-Tenant Support** | Serve multiple applications/tenants with isolated credentials, quotas, and analytics |

---

## 2. Non-Functional Requirements

### 2.1 Performance

| Metric | Target | Rationale |
|---|---|---|
| **Ingestion-to-provider latency** | < 500ms (P95) for transactional | Transactional notifications (OTP, order updates) must reach provider within half a second |
| **Ingestion-to-provider latency** | < 5 seconds (P95) for marketing | Marketing campaigns can tolerate batching and pacing delays |
| **Campaign fan-out (100M devices)** | < 10 minutes | Breaking news or flash sale notifications lose value rapidly; complete fan-out must be fast |
| **Device token lookup** | < 10ms (P99) | Token resolution is on the critical path for every notification; must be sub-10ms |
| **Segment evaluation** | < 2 seconds for 100M user base | Segment queries against user attribute store must resolve target audience quickly |
| **Template rendering** | < 5ms (P99) | Variable interpolation and locale selection per notification must not Slowest part of the process throughput |
| **API response time** | < 100ms (P95) | Ingestion API must acknowledge receipt quickly so callers aren't blocked |
| **Feedback processing lag** | < 30 seconds | Invalid token signals from providers must be processed quickly to prevent further wasted sends |

### 2.2 Availability & Durability

| Metric | Target | Rationale |
|---|---|---|
| **Ingestion API availability** | 99.95% | 22 min/month max downtime; callers must reliably submit notifications |
| **Delivery pipeline availability** | 99.9% | 43 min/month; pipeline can tolerate brief pauses with queue buffering |
| **Device registry availability** | 99.99% | 4.3 min/month; token lookups are on the critical path for all deliveries |
| **Notification durability** | 99.99% | Accepted notifications must not be silently dropped; lost notifications erode trust |
| **Device token durability** | 99.999% | Token data is difficult to reconstruct; users must re-register if lost |
| **RPO (Recovery Point Objective)** | 0 for in-flight notifications, < 5 min for analytics | Zero notification loss; analytics can tolerate short gaps |
| **RTO (Recovery Time Objective)** | < 3 minutes for ingestion, < 10 minutes for pipeline | Fast API recovery; pipeline backlog drains from queue on restart |

### 2.3 Scalability

| Dimension | Target |
|---|---|
| **Registered device tokens** | 2B tokens across all providers |
| **Daily notifications sent** | 10B notifications/day |
| **Peak throughput** | 2M notifications/sec (campaign bursts + transactional baseline) |
| **Sustained throughput** | 200K notifications/sec average |
| **Concurrent provider connections** | 50K connections to APNs, 10K to FCM, 5K to HMS |
| **Topic subscriptions** | 100M active topic subscriptions |
| **Campaigns per day** | 10,000 scheduled campaigns |
| **Tenants** | 1,000+ applications sharing the platform |
| **Delivery events/day** | 30B events (sent, delivered, opened, dismissed) |
| **Analytics queries** | 10K dashboard queries/hour with < 5s response |

### 2.4 Security & Compliance

| Requirement | Description |
|---|---|
| **Provider credential isolation** | APNs certificates, FCM service account keys, HMS app secrets stored in encrypted vault per tenant |
| **Payload encryption** | TLS 1.3 for all provider connections; optional end-to-end encryption for sensitive payloads |
| **Token privacy** | Device tokens are PII; stored encrypted at rest, access audited, retention-limited |
| **GDPR compliance** | Respect user consent for marketing notifications, support data deletion requests including token purge |
| **Preference enforcement** | Honor user opt-out within 24 hours of preference change; marketing sends to opted-out users is a compliance violation |
| **Audit trail** | Every notification decision (sent, suppressed, rate-limited) logged with reason for compliance audits |
| **Rate abuse protection** | Per-tenant quotas to prevent one caller from exhausting provider limits for all tenants |
| **Content scanning** | Optional content policy enforcement for user-generated notification content |

---

## 3. Capacity Estimations

### 3.1 Traffic Estimations

| Metric | Estimation | Calculation |
|---|---|---|
| **Registered devices** | 2 billion | 500M users × 4 devices average (phone, tablet, web, secondary phone) |
| **Active devices (daily)** | 400M | 20% of registered tokens are active daily |
| **Daily notifications** | 10B | 400M active devices × 25 notifications/device/day average |
| **Average QPS** | ~115K notifications/sec | 10B / 86,400 seconds |
| **Peak QPS** | 2M notifications/sec | ~17× average (campaign bursts during peak hours) |
| **Provider API calls/day** | 10B+ | ~1:1 ratio (each notification = one provider call; multicast batching reduces FCM calls) |
| **Delivery events/day** | 30B | 10B sends × 3 events average (accepted, delivered, opened/dismissed) |
| **Read:Write ratio** | 1:10 | Writes dominate: mostly sending notifications; reads are analytics queries and preference lookups |

### 3.2 Storage Estimations

| Component | Calculation | Size |
|---|---|---|
| **Device token registry** | 2B tokens × 600 bytes (token + metadata + preferences) | ~1.2 TB |
| **Notification log (30-day)** | 10B/day × 30 days × 500 bytes per record | ~150 TB |
| **Delivery events (30-day)** | 30B/day × 30 days × 200 bytes per event | ~180 TB |
| **Template store** | 100K templates × 10 KB average | ~1 GB |
| **User preference store** | 500M users × 1 KB (category preferences + settings) | ~500 GB |
| **Segment definitions** | 50K segments × 5 KB | ~250 MB |
| **Campaign metadata** | 10K/day × 365 days × 10 KB | ~36 GB |
| **Analytics aggregates** | Pre-computed hourly/daily rollups | ~10 TB |
| **Total active storage** | Sum of above | ~342 TB |
| **Year 5 projection** | 3× growth in devices and volume | ~1 PB |

### 3.3 Bandwidth Estimations

| Direction | Calculation | Bandwidth |
|---|---|---|
| **Inbound (ingestion API)** | 2M notifications/sec × 2 KB average payload | ~4 GB/s (32 Gbps) peak |
| **Outbound to APNs** | 800K/sec × 4 KB (payload + HTTP/2 framing) | ~3.2 GB/s (25.6 Gbps) |
| **Outbound to FCM** | 900K/sec × 4 KB | ~3.6 GB/s (28.8 Gbps) |
| **Outbound to HMS + Web Push** | 300K/sec × 4 KB | ~1.2 GB/s (9.6 Gbps) |
| **Provider feedback inbound** | 10B responses/day × 200 bytes | ~23 MB/s (sustained) |
| **Total peak outbound** | Sum of provider outbound | ~8 GB/s (64 Gbps) |

---

## 4. SLOs / SLAs

### 4.1 Service Level Objectives

| Metric | Target | Measurement |
|---|---|---|
| **Ingestion availability** | 99.95% | Percentage of minutes the ingestion API returns 2xx for valid requests |
| **Transactional delivery latency (P95)** | < 500ms to provider | Time from API receipt to provider acceptance, measured at provider adapter |
| **Marketing delivery latency (P95)** | < 30 seconds to provider | Time from scheduled send time to provider acceptance |
| **Delivery success rate** | > 97% for fresh tokens | Percentage of sends to tokens active within 7 days that receive provider acceptance |
| **False suppression rate** | < 0.01% | Percentage of legitimate notifications incorrectly suppressed by rate limiting or dedup |
| **Notification loss rate** | < 0.001% | Percentage of accepted notifications that are silently dropped before provider handoff |
| **Analytics freshness** | < 5 minutes | Delay between provider delivery event and dashboard metric update |
| **Token cleanup latency** | < 1 hour | Time from provider invalid-token feedback to token deactivation in registry |

### 4.2 Service Level Agreements (Multi-Tenant)

| Tier | Throughput | Latency (P95) | Support |
|---|---|---|---|
| **Free** | 10K notifications/day | < 5 seconds | Community |
| **Growth** | 1M notifications/day | < 2 seconds | Email, 24-hour response |
| **Enterprise** | Unlimited (custom quota) | < 500ms transactional | Dedicated support, 99.95% SLA with financial credits |

---

## 5. User Personas

| Persona | Description | Key Flows |
|---|---|---|
| **End User (Consumer)** | Receives notifications on mobile/web; manages preferences | Receive push → open/dismiss → manage preferences → opt out of categories |
| **Application Developer** | Integrates notification API into their service | Register device → send transactional notifications via API → check delivery status |
| **Campaign Manager** | Creates and manages marketing notification campaigns | Define segment → create template → schedule campaign → monitor analytics → A/B test |
| **Platform Admin** | Manages the notification platform infrastructure | Configure provider credentials → set tenant quotas → monitor system health → rotate keys |
| **Tenant Admin** | Manages their application's notification configuration | Create templates → manage segments → view analytics → configure preferences schema |
| **On-Call Engineer** | Responds to system alerts and incidents | Receive page → diagnose delivery pipeline → investigate provider issues → resolve |

---

## 6. Constraints & Assumptions

### 5.1 Provider Constraints

| Provider | Constraint | Impact |
|---|---|---|
| **APNs** | 4 KB maximum payload; HTTP/2 only; JWT or certificate auth; connection-based throttling | Must maintain persistent HTTP/2 connections; payload compression for rich content |
| **APNs** | Silent notifications limited to ~1 per 20 minutes per device | Background sync rate is provider-limited; cannot use silent push as a polling replacement |
| **FCM** | 4 KB data payload, 2 KB notification payload; 500 tokens per multicast; OAuth 2.0 auth | Batch sends to FCM to amortize HTTP overhead; token limits require multiple batches |
| **FCM** | Topic messages have no per-device customization | Personalized content cannot use FCM topic broadcast; must expand to individual sends |
| **HMS** | Similar to FCM with OAuth 2.0; smaller developer ecosystem; separate token namespace | Must maintain parallel provider infrastructure for Huawei devices without Google services |
| **Web Push** | VAPID authentication; payload must be encrypted with user's public key; no guaranteed delivery when browser closed | Each message individually encrypted; offline delivery depends on browser's push service |

### 5.2 Design Assumptions

- Average user has 2.5 active devices registered
- 60% of traffic is Android (FCM), 30% iOS (APNs), 5% Huawei (HMS), 5% Web Push
- 70% of notifications are marketing, 30% transactional
- Notification open rate averages 5-8% across all categories
- Token staleness rate is 7% per month (uninstalls, token rotation, device changes)
- Peak traffic occurs during morning hours (8-10 AM local time) across time zones, creating a rolling global peak
- Provider outages occur 2-4 times per year per provider, lasting 15-60 minutes each

---

## 6. Cost Estimation

### 6.1 Infrastructure Cost Model

```
Monthly infrastructure cost (at 10B notifications/day scale):

Compute:
  Ingestion API:          50 instances × $300/mo     = $15,000
  Fan-Out Workers:        200 instances × $400/mo    = $80,000
  APNs Adapter Pool:      150 instances × $300/mo    = $45,000
  FCM Adapter Pool:       100 instances × $300/mo    = $30,000
  HMS/WebPush Adapters:   30 instances × $300/mo     = $9,000
  Feedback Processor:     20 instances × $300/mo     = $6,000
  Template/Pref Services: 20 instances × $300/mo     = $6,000
  Segmentation Engine:    10 instances × $800/mo     = $8,000
  Analytics Pipeline:     30 instances × $400/mo     = $12,000
  ────────────────────────────────────────────────────────────
  Compute subtotal:                                    $211,000/mo

Storage:
  Device Registry (sharded): 1.2 TB × $200/TB        = $240
  Distributed Cache:         500 GB cluster            = $3,000
  Notification Log (150 TB): Tiered storage            = $15,000
  Delivery Events (180 TB):  Tiered storage            = $18,000
  Analytics Store:           10 TB columnar             = $2,000
  Template + Preferences:    500 GB                    = $100
  ────────────────────────────────────────────────────────────
  Storage subtotal:                                    $38,340/mo

Networking:
  Outbound to providers:   ~8 GB/s peak × utilization = $50,000
  Inter-service traffic:   Internal                    = $10,000
  Queue cluster:           High-throughput             = $15,000
  ────────────────────────────────────────────────────────────
  Network subtotal:                                    $75,000/mo

Total cloud infrastructure:                            $324,340/mo
Per notification:                                      ~$0.001 per 1,000 notifications
```

### 6.2 Cost Optimization Strategies

| Strategy | Savings | Implementation |
|---|---|---|
| **FCM multicast batching** | 60% reduction in FCM API calls | Batch 500 tokens per multicast request instead of individual sends |
| **Reserved instances for baseline** | 30-40% compute savings | Reserve capacity for baseline throughput; use spot/preemptible for burst |
| **Tiered notification log storage** | 70% storage cost reduction | Hot (7 days) on fast storage; warm (30 days) on standard; cold on archive |
| **Token cleanup** | 5-10% reduction in provider API costs | Eliminate wasted sends to stale tokens; reduce provider quota consumption |
| **Campaign pacing** | 15-20% compute cost smoothing | Spread campaign sends over longer windows to reduce peak instance count |

---

## 7. Failure Impact Analysis

| Component Failure | Blast Radius | User Impact | Recovery Strategy |
|---|---|---|---|
| **Single API instance** | None (load balanced) | Zero impact; traffic redistributed | Auto-replaced by health check; no manual action |
| **Fan-out worker crash** | One partition delayed | ~1/N of campaign notifications delayed by 10-30s | Partition reassigned to healthy worker; resume from checkpoint |
| **APNs adapter pool failure** | All iOS notifications | iOS users receive notifications late (queued) | Queue buffers APNs sends; auto-restart pool; FCM/HMS unaffected |
| **FCM credential expiry** | All Android notifications | Android notifications fail until credential refreshed | Alert on credential expiry 30 days before; auto-refresh OAuth token |
| **Device registry shard failure** | ~1/16 of user base | Notifications for affected users fail token lookup | Replica promoted in 30s; stale cache serves reads during failover |
| **Message queue broker failure** | One queue partition | Notifications in that partition delayed | ISR replica takes over; consumers rebalance within 10s |
| **Entire AZ failure** | ~33% of capacity | Throughput temporarily reduced; latency increases | Other AZs absorb traffic; auto-scale replaces capacity within 2 min |
| **Provider outage (APNs)** | All iOS devices | iOS notifications queued; other platforms unaffected | Queue buffers with 24h TTL; fallback to email for critical after 5 min |
| **Scheduling service failure** | All scheduled campaigns | Campaigns don't fire at scheduled time | Active-passive failover in 10s; catchup logic sends missed campaigns |
| **Analytics pipeline lag** | Dashboard freshness | Stale metrics; no impact on notification delivery | Pipeline catches up on recovery; delivery pipeline fully independent |

---

*Previous: [Index](./00-index.md) | Next: [High-Level Design ->](./02-high-level-design.md)*
