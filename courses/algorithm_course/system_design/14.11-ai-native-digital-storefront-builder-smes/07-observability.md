# 14.11 AI-Native Digital Storefront Builder for SMEs — Observability

## Metrics

### Business Metrics (Golden Signals for Stakeholders)

| Metric | Description | Collection | Alert Threshold |
|---|---|---|---|
| **Stores created/hour** | Rate of new store completions | Counter from store builder service | < 50% of rolling 7-day average for same hour |
| **GMV (hourly)** | Gross merchandise value processed | Aggregated from order service | < 60% of rolling 7-day average |
| **Conversion rate** | Storefront visitors → completed orders | Computed from analytics events | Drop > 20% in 1-hour window |
| **Payment success rate** | Successful payments / attempted payments | Counter from payment service | < 94% over 15-minute window |
| **Channel sync health** | % of product updates synced within SLO | Computed from sync completion events | < 90% synced within 5 minutes |
| **Store creation to first order** | Time from store publish to first customer order | Event correlation | Informational; trend tracking only |

### Infrastructure Metrics (RED Method)

**Rate — Requests per second:**

| Service | Metric | Dashboard |
|---|---|---|
| Storefront CDN | Requests/sec by edge location | CDN provider dashboard |
| API Gateway | Requests/sec by endpoint | Gateway metrics |
| Product Manager | CRUD operations/sec | Service metrics |
| Order Manager | Orders/sec by channel | Service metrics |
| Inventory Manager | Reservation operations/sec | Service metrics |
| Content Generator | Inference requests/sec | GPU cluster metrics |

**Errors — Error rate by type:**

| Error Category | Metric | Alert |
|---|---|---|
| 5xx errors (API) | Rate by service and endpoint | > 1% of requests in 5-min window |
| Payment failures | Rate by gateway and method | > 6% failure rate in 15-min window |
| Channel sync failures | Rate by channel | > 5% failure rate in 30-min window |
| Content generation failures | Rate by failure reason | > 10% failure rate in 1-hour window |
| Database errors | Connection failures + query timeouts | Any sustained (> 1 min) error rate |

**Duration — Latency distributions:**

| Operation | p50 target | p95 target | p99 target | Alert |
|---|---|---|---|---|
| Storefront TTFB | 50 ms | 200 ms | 500 ms | p95 > 300 ms for 5 min |
| API response | 30 ms | 150 ms | 500 ms | p95 > 200 ms for 5 min |
| Product description generation | 3 s | 8 s | 15 s | p95 > 12 s for 15 min |
| Inventory reservation | 5 ms | 20 ms | 50 ms | p95 > 30 ms for 5 min |
| Payment initiation | 500 ms | 3 s | 5 s | p95 > 4 s for 5 min |
| Multi-channel sync (inventory) | 5 s | 30 s | 60 s | p95 > 45 s for 15 min |

### AI-Specific Metrics

| Metric | Description | Target | Alert |
|---|---|---|---|
| **Description quality score** | Average quality score of AI-generated descriptions | > 0.85 | < 0.80 over 100 descriptions |
| **Description acceptance rate** | % of AI descriptions accepted by merchants without edit | > 70% | < 60% rolling 7-day |
| **Theme match satisfaction** | % of merchants keeping AI-selected theme | > 80% | < 70% rolling 7-day |
| **Pricing recommendation acceptance** | % of price suggestions accepted by merchants | > 40% | < 25% rolling 7-day |
| **Content regeneration rate** | % of descriptions manually requested for regeneration | < 15% | > 25% rolling 7-day |
| **GPU utilization** | GPU compute utilization across inference pools | 60-80% | > 90% sustained 15 min or < 30% sustained 1 hour |
| **Inference latency** | LLM inference time per request | p95 < 5 s | p95 > 8 s for 15 min |

---

## Logging

### Log Levels and Retention

| Level | Use Case | Examples | Retention |
|---|---|---|---|
| **ERROR** | Failures requiring attention | Payment processing failure, database connection error, channel API 5xx | 90 days |
| **WARN** | Degraded behavior | Channel sync retry, content quality below threshold, rate limit approaching | 30 days |
| **INFO** | Significant business events | Store created, order placed, payment settled, channel connected | 30 days |
| **DEBUG** | Troubleshooting detail | API request/response bodies (sanitized), query execution plans, cache hit/miss | 7 days |

### Structured Log Format

```
{
  "timestamp": "2026-03-10T14:30:00.123Z",
  "level": "INFO",
  "service": "product-manager",
  "instance": "pm-prod-07",
  "trace_id": "abc123def456",
  "span_id": "span_789",
  "tenant_id": "st_merchant_42",      // always present for tenant-scoped operations
  "event": "product.updated",
  "details": {
    "product_id": "prod_xyz",
    "updated_fields": ["price", "inventory"],
    "sync_triggered": true,
    "channels": ["website", "whatsapp", "instagram"]
  },
  "duration_ms": 45,
  "user_id": "usr_abc",
  "ip": "203.0.113.42"
}
```

### Log Sanitization Rules

- **Payment data:** Card numbers, CVVs, bank account numbers → replaced with `[REDACTED]`
- **Authentication tokens:** JWT tokens, API keys, OTPs → replaced with `[TOKEN]` or `[OTP]`
- **Customer PII:** Email addresses → `u***@domain.com`; phone numbers → `***XXX1234`
- **Merchant credentials:** Channel API keys, gateway secrets → `[SECRET]`

### Key Log Queries (Common Troubleshooting)

| Scenario | Query Pattern |
|---|---|
| Why did a channel sync fail? | `service=channel-sync AND tenant_id=X AND level=ERROR AND event=sync.failed` |
| Why was a payment declined? | `service=payment AND trace_id=X AND event=payment.*` |
| What happened during store creation? | `trace_id=X AND event=store.creation.*` ORDER BY timestamp |
| Why is a storefront slow? | `service=web-renderer AND tenant_id=X AND duration_ms>1000` |
| AI content quality issues? | `service=content-generator AND details.quality_score<0.80` |

---

## Distributed Tracing

### Trace Propagation

Traces propagate across all service boundaries via W3C Trace Context headers. Key trace paths:

**Trace 1: Store Creation (end-to-end)**
```
[Store Builder] → [Visual Analyzer (GPU)] → [Theme Intelligence]
                → [Content Generator (GPU)] × N products (parallel spans)
                → [Product Manager] → [Search Index] → [Web Renderer] → [CDN Publish]
Total spans: 10-50 depending on product count
Expected duration: 60-180 seconds
```

**Trace 2: Product Update → Multi-Channel Sync**
```
[API Gateway] → [Product Manager] → [Event Bus]
  → [Web Adapter] → [CDN Invalidation]
  → [WhatsApp Adapter] → [WhatsApp Business API]
  → [Instagram Adapter] → [Instagram Graph API]
  → [Marketplace Adapter] → [Marketplace API]
Total spans: 8-15 depending on connected channels
Expected duration: 5-300 seconds (varies by channel API latency)
```

**Trace 3: Customer Checkout → Payment → Order**
```
[Storefront] → [Cart Service] → [Inventory Manager (reserve)]
  → [Payment Service] → [Gateway Router] → [Payment Gateway]
  → [Order Manager] → [Notification Service (WhatsApp/SMS)]
  → [Inventory Manager (confirm)] → [Channel Sync (inventory update)]
Total spans: 10-15
Expected duration: 3-30 seconds (payment flow dominates)
```

### Sampling Strategy

| Trace Type | Sampling Rate | Rationale |
|---|---|---|
| Storefront page views | 1% | High volume; CDN serves most requests |
| API requests (merchant dashboard) | 10% | Moderate volume; useful for latency analysis |
| Store creation | 100% | Low volume; every creation is significant |
| Payment transactions | 100% | Every payment matters; full auditability |
| Channel sync operations | 10% | High volume; sample for performance analysis |
| Errored requests | 100% | Always trace errors for debugging |

---

## Alerting

### Alert Tiers

| Tier | Severity | Response Time | Notification Channel | Example |
|---|---|---|---|---|
| **P0 — Critical** | Service outage or data loss | 5 minutes | Phone call + SMS + chat | Storefront serving down; payment processing failure > 50% |
| **P1 — High** | Degraded service | 15 minutes | SMS + chat | p95 latency 2× SLO; single gateway failure; channel sync > 1 hour behind |
| **P2 — Medium** | Potential issue | 1 hour | Chat + email | Content quality score declining; single database replica lag > 30s |
| **P3 — Low** | Informational | Next business day | Email + dashboard | GPU utilization consistently low; cache hit ratio declining |

### Key Alert Definitions

```
ALERT: StorefrontAvailability
  CONDITION: success_rate(storefront_requests) < 99.99% over 5 minutes
  SEVERITY: P0
  RUNBOOK: Check CDN health → origin health → database connectivity
  AUTO-ACTION: Page on-call engineer; increase CDN TTL to serve stale content

ALERT: PaymentSuccessRate
  CONDITION: success_rate(payment_attempts) < 94% over 15 minutes
  SEVERITY: P0
  RUNBOOK: Check gateway health scores → identify failing gateway → verify failover routing
  AUTO-ACTION: Mark degraded gateway; route traffic to backup; notify merchants

ALERT: ChannelSyncLag
  CONDITION: max(sync_lag_seconds) > 1800 for any channel over 30 minutes
  SEVERITY: P1
  RUNBOOK: Check channel API status → adapter health → event queue depth
  AUTO-ACTION: Increase channel safety buffer; page on-call if inventory sync affected

ALERT: ContentQualityDegradation
  CONDITION: avg(description_quality_score) < 0.80 over 100 descriptions
  SEVERITY: P2
  RUNBOOK: Check GPU health → model version → input data quality
  AUTO-ACTION: Switch to backup model; queue affected descriptions for regeneration

ALERT: InventoryReservationContention
  CONDITION: reservation_failure_rate > 5% over 10 minutes
  SEVERITY: P1
  RUNBOOK: Check inventory DB load → lock contention → hot product identification
  AUTO-ACTION: Enable queued reservation mode for hot products

ALERT: DatabaseReplicaLag
  CONDITION: replica_lag_seconds > 30 for any replica over 5 minutes
  SEVERITY: P2
  RUNBOOK: Check replication health → write throughput → network bandwidth
  AUTO-ACTION: Remove lagging replica from read pool; alert DBA team
```

### SLO Burn Rate Alerts

Using multi-window burn rate for SLO-based alerting:

| SLO | Error Budget (monthly) | Fast Burn (1h window) | Slow Burn (6h window) |
|---|---|---|---|
| Storefront availability 99.99% | 4.3 minutes | > 14.4× burn rate → P0 | > 3× burn rate → P1 |
| Payment success 99.99% | 4.3 minutes | > 14.4× burn rate → P0 | > 3× burn rate → P1 |
| API latency p95 < 150ms | 5% of requests | > 14.4× burn rate → P1 | > 3× burn rate → P2 |

---

## Dashboards

### Dashboard 1: Business Health (Executive View)

- Active stores (total + trend)
- GMV (hourly, daily, monthly) with YoY comparison
- New store creation rate with conversion (created → published → first order)
- Payment success rate by method
- Top 10 stores by GMV
- Channel distribution (% of orders by channel)

### Dashboard 2: Platform Reliability (SRE View)

- SLO status for all tracked SLOs (traffic light indicators)
- Error budget remaining by SLO (burn-down chart)
- Service latency heatmap (services × time)
- Event queue depths by channel
- Database shard health (connections, query latency, replication lag)
- CDN cache hit ratio by edge location

### Dashboard 3: AI Pipeline Health (ML Ops View)

- Content generation throughput (requests/min by pool)
- GPU utilization by pool (sync vs. async vs. image)
- Description quality score distribution (histogram)
- Merchant acceptance rate trend
- Pricing recommendation acceptance trend
- Model inference latency by model version
- Queue depth and wait time for each AI pipeline stage

### Dashboard 4: Multi-Channel Sync (Integration View)

- Sync lag by channel (time series)
- Sync success/failure rate by channel
- API rate limit utilization by channel (% of limit consumed)
- Drift detection results (mismatches found per scan)
- Products pending sync by channel
- Channel API response time trends

---

## Operational Runbooks

### Runbook 1: Storefront TTFB Degradation

**Trigger:** Alert `StorefrontTTFB_P95 > 300ms for 5 minutes`

**Diagnostic steps:**

1. **Check CDN cache hit ratio** — If ratio dropped below 90%, investigate cache invalidation storm
   - Query: CDN dashboard → cache hit ratio by edge location → identify affected region
   - If invalidation rate > 10× normal: check for bulk product update or platform-wide promotion
   - Action: temporarily increase CDN TTL to 1 hour; enable stale-while-revalidate globally

2. **Check origin shield health** — If shield is down, edge nodes bypass directly to origin
   - Query: Origin shield health endpoint; check origin request rate
   - If origin requests > 5× normal: shield failure confirmed
   - Action: activate hot-standby origin pool; page infrastructure team

3. **Check origin server health** — If origin CPU > 80% or connection pool exhausted
   - Query: Origin server metrics dashboard; check active connections, query latency
   - If auto-scaler hasn't responded: manually scale origin to 2× current capacity
   - Action: enable stale-while-revalidate; investigate slow queries

4. **Check for noisy neighbor** — If a single tenant is consuming disproportionate origin resources
   - Query: Request logs filtered by `tenant_id`, sorted by request count
   - If one tenant > 10× average: likely viral store
   - Action: redirect tenant's reads to dedicated read replica; initiate shard migration if sustained

### Runbook 2: Channel Sync Lag Exceeding SLO

**Trigger:** Alert `ChannelSyncLag > 1800s for any channel over 30 minutes`

**Diagnostic steps:**

1. **Check channel API status** — External API may be down or rate-limiting
   - Query: Channel adapter health dashboard → API response codes → check for 429 or 503 patterns
   - If channel API is down: increase safety buffer for that channel; queue events; set merchant notification

2. **Check event queue depth** — Consumer may be behind or stuck
   - Query: Event bus consumer group lag per partition
   - If specific partitions lagging: check for poison message (event that causes consumer crash)
   - Action: skip poison message to dead letter queue; restart consumer for affected partitions

3. **Check adapter resource utilization** — Consumer may be CPU/memory constrained
   - Query: Adapter pod metrics → CPU, memory, network
   - If resource constrained: scale consumer group horizontally
   - Action: increase consumer count; verify new consumers join consumer group correctly

4. **Check rate limiter state** — May be over-throttling
   - Query: Rate limiter metrics → token bucket fill rate vs. consumption rate
   - If utilization at 100% for extended period: check if rate limit has been reduced by channel provider
   - Action: reduce low-priority sync frequency; alert capacity planning team

### Runbook 3: AI Content Quality Score Drop

**Trigger:** Alert `avg(description_quality_score) < 0.80 over 100 descriptions`

**Diagnostic steps:**

1. **Check GPU cluster health** — Hardware failures can cause corrupted inference
   - Query: GPU health dashboard → check for thermal throttling, memory errors, or failed instances
   - If GPU hardware issue: remove unhealthy instances from pool; route to healthy instances

2. **Check model version** — Recent deployment may have introduced regression
   - Query: Model registry → compare current version deployment timestamp with quality score drop timestamp
   - If correlated: roll back to previous model version
   - Action: disable canary; restore previous version; page ML on-call

3. **Check input data distribution** — Merchant product images or attributes may have shifted
   - Query: Sample 20 low-scoring descriptions; inspect input images and attributes
   - If new product category not well-represented in training data: flag for model retraining
   - Action: lower quality threshold for under-represented categories; queue for human review

4. **Check prompt template** — Recent prompt changes may have degraded quality
   - Query: Prompt version history → compare with quality score timeline
   - If prompt change correlated: revert prompt template
   - Action: A/B test prompt variants before next deployment

---

## Cross-Subsystem Correlation Dashboard

| Upstream Signal | Downstream Impact | Correlation | Response |
|---|---|---|---|
| GPU inference latency spike | Store creation latency exceeds SLO | Direct — GPU is the Slowest part of the process in sync creation path | Scale GPU sync pool; enable template fallback |
| Event bus consumer lag | Channel listings show stale data | Direct — events not processed means channels not updated | Scale consumers; investigate partition-level issues |
| Database shard CPU spike | API response latency increases; dashboard slow | Direct — queries slowed by resource contention | Identify noisy tenant; route reads to replica |
| CDN cache hit ratio drop | Origin server load increases; TTFB degrades | Cascading — cache misses become origin requests | Investigate invalidation pattern; increase TTL |
| Payment gateway success rate drop | GMV decreases; merchant support tickets increase | Business impact — failed payments are lost revenue | Activate failover routing; notify merchants |

---

## Model Performance Drift Detection

### Content Generation Model Monitoring

| Metric | Baseline | Drift Detection Method | Alert Threshold |
|---|---|---|---|
| Quality score distribution | Mean 0.87, std 0.05 | Kolmogorov-Smirnov test against baseline distribution | KS statistic > 0.1 (p < 0.01) |
| Merchant acceptance rate | 73% | CUSUM control chart with 7-day rolling window | 5 consecutive days below 65% |
| Category detection accuracy | 89% top-1 (on production traffic) | Weekly evaluation against human-labeled sample (500 images) | Accuracy drops > 3% vs. previous week |
| Description uniqueness | 95% below 30% overlap threshold | Platform-wide similarity index check | Uniqueness drops below 90% |

### Dynamic Pricing Model Monitoring

| Metric | Baseline | Drift Detection | Alert Threshold |
|---|---|---|---|
| Recommendation acceptance rate | 42% | Weekly trend analysis | 3 consecutive weeks of decline |
| Margin floor violations | < 0.5% of recommendations | Real-time counter | > 1% in any 4-hour window |
| Price change magnitude distribution | Mean ±8%, std 4% | Distribution shift detection | Mean magnitude > 15% |
| Revenue impact of accepted recommendations | +3.2% GMV lift | Causal analysis via holdout group | Lift drops below 1% |

---

## Merchant Experience Monitoring

### Merchant Funnel Metrics

| Stage | Metric | Target | Alert |
|---|---|---|---|
| Registration → Store creation started | 85% | < 75% for 24 hours | UX issue in onboarding flow |
| Store creation started → Store published | 72% | < 60% for 24 hours | AI pipeline latency or quality issue |
| Store published → First product sold | 35% (within 30 days) | < 25% rolling 30-day | Product-market fit or discovery issue |
| Active merchant → Churned (30-day inactive) | < 8% monthly | > 12% for any month | Platform value delivery issue |

### WhatsApp Business Briefing Delivery Monitoring

| Metric | Target | Alert |
|---|---|---|
| Briefing delivery success rate | > 98% | < 95% for 1 day |
| Briefing generation latency (p95) | < 30 seconds | > 60 seconds for 100 merchants |
| Merchant read rate (WhatsApp receipts) | > 65% | < 50% rolling 7-day (content relevance issue) |
| Action taken from briefing | > 15% | < 10% rolling 7-day (recommendation quality issue) |

---

## Cost Observability

### Per-Merchant Cost Tracking

| Cost Component | Metric | Target Per Merchant | Alert |
|---|---|---|---|
| CDN bandwidth | GB served per merchant/month | < 0.5 GB average | > 5 GB sustained (potential abuse or hotlinking) |
| GPU inference | Inference calls per merchant/month | < 100 (initial creation + regeneration) | > 500 (excessive regeneration; possible automation abuse) |
| Database IOPS | Queries per merchant/hour | < 1,000 average | > 10,000 sustained (noisy neighbor candidate) |
| Storage | Total storage per merchant | < 500 MB average | > 5 GB (large catalog; evaluate storage tier) |
| Channel sync | API calls per merchant/day | < 200 average | > 2,000 (high churn catalog; optimize delta sync) |

### Infrastructure Cost Allocation Dashboard

| View | Purpose | Audience |
|---|---|---|
| **Cost by service** | Identify most expensive services for optimization | Engineering leadership |
| **Cost by tier** | Compare free vs. growth vs. pro tier profitability | Product management |
| **Cost per merchant by percentile** | Identify cost outliers (top 1% merchants consuming 20%+ of resources) | Platform engineering |
| **Cost trend** | Track sub-linear cost scaling as platform grows | Finance + Engineering |
| **GPU cost per inference** | Track model efficiency over time; compare model versions | ML Platform |

---

## AI Observability Standards

This system's AI components MUST implement the observability patterns defined in:
- **[3.25 AI Observability & LLMOps](../3.25-ai-observability-llmops-platform/00-index.md)** — trace model, token accounting, prompt-completion linkage
- **[3.26 AI Model Evaluation & Benchmarking](../3.26-ai-model-evaluation-benchmarking-platform/00-index.md)** — eval taxonomy, regression testing, human review sampling

### Required AI-Specific Metrics
- AI resolution rate (queries handled without human escalation)
- Escalation rate and top escalation reasons
- End-to-end action latency (request to AI-completed action)
- Policy violation attempt rate (actions blocked by guardrails)
- User satisfaction score for AI-handled interactions
