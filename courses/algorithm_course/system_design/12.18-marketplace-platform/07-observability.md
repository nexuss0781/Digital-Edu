# 12.18 Marketplace Platform — Observability

## Business Metrics (North Star Signals)

Marketplace observability starts with business health metrics, not just infrastructure metrics. An engineer must understand which technical signals map to which business outcomes.

| Business Metric | Definition | Technical Signal | Alert Threshold |
|---|---|---|---|
| **GMV** | Gross merchandise value transacted per hour | Order Service: sum of order_total on completed orders | < 80% of same hour last week |
| **Checkout conversion rate** | Completed checkouts / checkout sessions initiated | Order Service: complete_count / reserve_count | < 2σ below 7-day rolling avg |
| **Search conversion rate** | Orders initiated from search results / search queries | Search Service click-to-checkout events | < 2σ below 7-day rolling avg |
| **Take rate health** | Actual platform fee collected vs. expected | Payment Service: fee_collected / GMV | Deviation > 0.5% from target |
| **Dispute rate** | Disputes opened / orders delivered (30-day rolling) | Dispute Service: dispute_open_count / delivered_count | > 3% (platform health signal) |
| **Payout on-time rate** | Payouts within SLA / total payouts due | Payment Service: disbursed_on_time / disbursed_total | < 99.9% |
| **Fraud removal rate** | Fraudulent listings removed within 60 min / total fraud detected | Trust Service: (removed_before_60min / total_flagged) | < 95% |

---

## Service-Level Metrics

### Search Service

```
Metrics emitted per query:
  search.latency_ms{stage=recall|rerank|filter|personalize}  (histogram)
  search.result_count{query_type=keyword|browse|semantic}     (gauge)
  search.cache_hit_ratio                                      (gauge)
  search.index_shard_availability{shard_id}                   (gauge: 0 or 1)
  search.zero_result_queries_rate                             (counter ratio)
  search.degraded_mode{reason=reranker_timeout|personalization_down} (counter)

Key dashboards:
  - Search p99 latency by stage (breakdown identifies Slowest part of the process stage)
  - Zero-result query rate (high rate → query understanding issue or inventory gap)
  - Index freshness: time-since-last-update per shard (alert on shard > 60s stale)
  - Cache hit ratio (drop indicates traffic pattern shift or cache invalidation storm)
```

### Order Service

```
Metrics:
  order.reservation_rate{result=success|conflict|unavailable}  (counter)
  order.checkout_duration_ms                                    (histogram)
  order.payment_authorization_rate{result=approved|declined|error} (counter)
  order.saga_compensation_count{step=reserve|authorize|capture} (counter: saga rollbacks)
  order.idempotency_replay_count                               (counter: duplicate requests)

Alerts:
  - Saga compensation rate > 0.5% of orders (indicates upstream system degradation)
  - Payment authorization error rate > 0.2% (excludes card declines)
  - Checkout p99 > 5 seconds (SLO: 3 seconds)
```

### Payment Service

```
Metrics:
  payment.escrow_balance_total_cents                          (gauge: total funds in escrow)
  payment.escrow_hold_count{hold_reason}                      (gauge)
  payment.disbursement_batch_size                             (histogram)
  payment.disbursement_failure_count{reason}                  (counter)
  payment.processor_error_rate{processor=primary|secondary}   (gauge)
  payment.reconciliation_discrepancy_cents                    (gauge: should be 0)

Critical alerts:
  - reconciliation_discrepancy_cents > 0 (immediate PagerDuty; financial integrity issue)
  - processor_error_rate > 1% for 2 consecutive minutes (trigger secondary failover)
  - escrow_balance_total drops unexpectedly (could indicate unauthorized disbursements)
```

### Trust & Safety

```
Metrics:
  trust.listing_fraud_score_distribution{bucket}             (histogram)
  trust.listings_flagged_for_review_rate                     (counter ratio)
  trust.listings_removed_within_60min_rate                   (counter ratio)
  trust.review_fraud_suppression_rate                        (counter ratio)
  trust.seller_quality_score_distribution{tier}              (histogram)
  trust.human_review_queue_depth{category}                   (gauge)
  trust.human_review_sla_breach_rate                         (counter ratio)
  trust.account_takeover_detections_per_hour                 (counter)
```

---

## Distributed Tracing

Every marketplace request is instrumented with distributed traces to enable cross-service latency attribution:

```
Trace: checkout request
  Root span: API Gateway (total: 2,400ms)
    └─ ListingService.checkAvailability (50ms)
    └─ OrderService.createReservation (30ms)
        └─ DB write: listings (10ms)
        └─ Cache write: reservation (5ms)
    └─ PaymentService.authorize (800ms)  ← external processor call
        └─ TokenVault.lookup (15ms)
        └─ ExternalProcessor.authorize (760ms)  ← external latency
    └─ OrderService.commitOrder (100ms)
        └─ DB write: orders (20ms)
        └─ DB write: escrow (25ms)
        └─ EventBus.publish (55ms)
    └─ NotificationService.sendConfirmation (async, not in critical path)
```

**Trace sampling:** 100% sampling for error traces; 10% sampling for successful traces; 100% sampling for fraud-flagged transactions (forensic value).

---

## Search Quality Metrics

Search quality requires business-aware metrics beyond infrastructure latency:

| Metric | Definition | Collection Method |
|---|---|---|
| **NDCG@10** | Normalized discounted cumulative gain at position 10 | Offline evaluation on human-labeled relevance judgments |
| **Click-through rate by position** | CTR at rank 1 vs. rank 10 vs. rank 48 | Click event stream joined with search results |
| **Purchase conversion by result rank** | Orders completed / search sessions reaching checkout, grouped by first result clicked rank | Join purchase events with search impression events |
| **Zero-result rate** | Queries returning 0 results / total queries | Search Service metric |
| **Reformulation rate** | Queries from same session within 60 seconds (buyer didn't find what they wanted) | Session analytics pipeline |
| **Promoted listing CTR vs. organic** | Click-through rate on promoted listings vs. equivalent organic results | A/B measurement; ensures promoted listings maintain relevance threshold |

---

## Seller Quality Score Observability

Seller quality score is a critical computed signal that drives multiple downstream systems. Its health must be continuously monitored:

```
Monitoring dimensions:
  Score distribution: histogram of all seller quality scores
    - Alert if distribution shifts materially (> 5% change in mean within 24 hours)
    - Shift indicates a data quality issue or a bug in score computation

  Propagation latency: time from qualifying event to score update in cache
    - P99 should be < 10 minutes
    - Alert if P95 exceeds 30 minutes

  Score version freshness: age of cached score per seller
    - Alert if > 1% of sellers have score older than 1 hour (computation pipeline issue)

  Score-to-tier distribution: sellers per trust tier
    - Monitor for unexpected shifts (fraud campaigns can temporarily inflate scores)
    - Comparison: week-over-week tier distribution
```

---

## Anomaly Detection and Alerting

### Trust Anomaly Alerts

| Signal | Detection Method | Alert |
|---|---|---|
| Review bombing campaign | Sudden spike in 1-star reviews for a seller (> 5× 7-day avg within 1 hour) | PagerDuty to trust team |
| Fake review campaign | Velocity burst in 5-star reviews with fraud score > 0.7 for a seller | Trust team + automatic score hold |
| Coordinated listing fraud | Multiple new accounts listing same items with similar photos within 24 hours | Automatic listing hold + fraud analyst review |
| ATO wave | Account takeover detections > 50/hour platform-wide | Security incident response |

### Financial Anomaly Alerts

| Signal | Detection Method | Alert |
|---|---|---|
| GMV drop | Current hour GMV < 70% of same hour last week | PagerDuty (SEV-1) |
| Disbursement failure spike | Disbursement failure rate > 2% in a 1-hour window | Payment team + finance team |
| Reconciliation mismatch | Escrow ledger total ≠ payment processor settlement total | Immediate SEV-1; financial investigation |
| Tax collection anomaly | Collected tax / GMV deviates > 1% from jurisdiction model | Tax team review |

---

## Dashboard Design

### Executive Dashboard (GMV, Conversion, Trust Health)

```
Top-level KPIs (real-time):
  - GMV (hourly, daily, week-to-date)
  - Checkout conversion rate (trend + vs. last week)
  - Active listings count
  - Dispute rate

Trust health panel:
  - Open disputes count and trend
  - Fraud listings removed (last 24h)
  - Account takeovers detected (last 24h)
  - Human review queue depth and SLA compliance

Search health panel:
  - p99 search latency
  - Zero-result rate
  - Index shard availability
```

### On-Call Engineering Dashboard (Infrastructure Health)

```
Per-service latency and error rate (RED metrics):
  Rate, Errors, Duration for each core service

Database health:
  - Query latency p99 per shard
  - Replication lag
  - Connection pool utilization

Event bus health:
  - Consumer lag per topic/consumer group
  - Producer throughput per topic

Payment processor health:
  - Authorization rate (success/failure/error)
  - Current processor (primary/secondary indicator)
  - Escrow balance (should be monotonically positive)
```

---

## SLO Dashboard Design

### Error Budget Tracking

```
SLO Error Budget Dashboard (per service, rolling 30 days):

┌──────────────────────────────────────────────────┐
│ Search Service - 99.95% availability SLO         │
│ ================================================ │
│ Budget: 21.6 min/month  Used: 8.2 min  Remaining: 13.4 min │
│ [████████░░░░░░░░░░░░░░] 38% consumed           │
│ Status: HEALTHY                                   │
│                                                    │
│ Burn rate (last 1h): 0.5× normal                 │
│ Projected budget exhaustion: Never (at current rate) │
├──────────────────────────────────────────────────┤
│ Payment Service - 99.99% availability SLO        │
│ ================================================ │
│ Budget: 4.3 min/month  Used: 3.1 min  Remaining: 1.2 min │
│ [██████████████████░░░░] 72% consumed            │
│ Status: WARNING — freeze non-critical deploys    │
│                                                    │
│ Burn rate (last 1h): 2.1× normal                 │
│ Projected budget exhaustion: 3 days at current rate │
├──────────────────────────────────────────────────┤
│ Checkout p99 Latency - 3s target                 │
│ ================================================ │
│ Budget: 0.1% requests > 3s  Current: 0.04%      │
│ [████████░░░░░░░░░░░░░░] 40% consumed           │
│ Status: HEALTHY                                   │
└──────────────────────────────────────────────────┘
```

### Error Budget Policy

```
FUNCTION evaluate_error_budget(service, slo_target, window_days=30):
  total_requests = count_requests(service, last_n_days=window_days)
  failed_requests = count_failures(service, last_n_days=window_days)

  budget_total = total_requests * (1 - slo_target)  // e.g., 0.05% for 99.95%
  budget_consumed = failed_requests
  budget_remaining = budget_total - budget_consumed
  burn_rate = budget_consumed / (elapsed_days / window_days) / budget_total

  IF budget_remaining < 0:
    action = "SLO_BREACHED: Incident review required; freeze deploys"
  ELIF burn_rate > 5.0:
    action = "CRITICAL: Page on-call; likely to breach within hours"
  ELIF burn_rate > 2.0:
    action = "WARNING: Freeze non-critical changes; investigate"
  ELIF budget_remaining / budget_total < 0.25:
    action = "CAUTION: Budget running low; reduce risk"
  ELSE:
    action = "HEALTHY: Normal operations"

  RETURN ErrorBudgetStatus(budget_remaining, burn_rate, action)
```

---

## Operational Runbooks

### Runbook: GMV Drop > 20% (SEV-1)

```
Trigger: Current hour GMV < 80% of same hour last week

Step 1 — Scope (< 5 min):
  - Is GMV drop across all categories or specific category?
  - Is checkout count down, or only order value down?
  - Is search QPS normal? (If search is down, buyers can't find items)

Step 2 — Diagnose (< 10 min):
  - Check checkout conversion: normal QPS + low conversion = payment issue
  - Check payment processor: error rate, latency, authorization success rate
  - Check search availability: shard availability, zero-result rate
  - Check listing availability: availability cache health, false "sold out" rate

Step 3 — Mitigate:
  - If payment processor: failover to secondary processor
  - If search: check index health; fall back to BM25-only if re-ranker is down
  - If availability cache: clear and rebuild from source DB
  - If listing service: check if listing activation pipeline is stalled

Step 4 — Communicate:
  - Update status page if buyer-facing impact > 5 minutes
  - Notify finance team (GMV impact = direct revenue impact)
```

### Runbook: Reconciliation Mismatch (SEV-1)

```
Trigger: Escrow ledger total ≠ payment processor settlement total

Step 1 — Quantify:
  - What is the discrepancy amount? ($100 vs $100,000 = different urgency)
  - Is it positive (we think we have more than processor says) or negative?

Step 2 — Investigate:
  - Pull escrow events for the reconciliation period
  - Pull settlement report from payment processor
  - Run diff: identify specific transactions present in one but not the other

Step 3 — Common causes:
  - Timing mismatch: transaction captured just before settlement cutoff
    → will appear in next reconciliation (wait 24 hours)
  - Duplicate capture: same order captured twice
    → issue refund for duplicate; investigate idempotency failure
  - Missing escrow event: capture succeeded but escrow event not written
    → replay from payment processor webhook log

Step 4 — Resolution:
  - If timing: mark as "expected reconciliation lag" in audit log
  - If real discrepancy: freeze payouts for affected sellers until resolved
  - File financial incident report; notify compliance team
```

### Runbook: Review Fraud Campaign Detected

```
Trigger: Velocity burst > 5× 7-day average for seller's reviews

Step 1 — Assess scope:
  - How many reviews in the burst? (10 vs 500)
  - Are reviews positive (seller boosting) or negative (competitor bombing)?
  - How many unique reviewer accounts? Shared IP/device characteristics?

Step 2 — Immediate actions:
  - Hold all burst reviews from public display (pending_fraud_check state)
  - Freeze seller quality score (prevent score from being gamed by burst)
  - If bombing: notify seller; no quality score penalty until investigation complete

Step 3 — Investigation:
  - Run graph analysis: are reviewer accounts connected?
  - Check reviewer account age, purchase history, review diversity
  - Check IP clustering and device fingerprint overlap

Step 4 — Resolution:
  - Confirmed fraud: suppress all campaign reviews; ban reviewer accounts
  - If seller-orchestrated boosting: issue policy violation; adjust quality score
  - If competitor bombing: restore reviews; consider counterfeit investigation on competitor
```

---

## Marketplace-Specific Observability Patterns

### Two-Sided Health Monitoring

Unlike single-sided systems, marketplace observability must track health for both buyer-side and seller-side independently:

| Dimension | Buyer Metric | Seller Metric | Combined Signal |
|---|---|---|---|
| **Satisfaction** | Checkout conversion rate | Listing activation rate | Platform health score |
| **Latency** | Search p99, checkout p99 | Listing creation p99, payout latency | Weighted latency index |
| **Availability** | Search availability, checkout availability | Listing service availability, payout availability | Worst-of-two-sides |
| **Trust** | Dispute rate, fraud exposure rate | ATO detection rate, false suspension rate | Trust balance score |
| **Economic** | GMV per buyer, cart abandonment | Revenue per seller, payout on-time rate | Take rate accuracy |

### Seller Churn Early Warning

Seller churn has a disproportionate impact because each seller represents multiple listings (supply loss is multiplicative):

```
Seller churn risk signals (tracked per seller):
  - Listing creation frequency: declining trend over 4 weeks
  - Login frequency: declining trend over 2 weeks
  - Response time to buyer messages: increasing trend
  - Payout amount: declining (less GMV)
  - Support ticket frequency: increasing
  - Competitor marketplace activity: seller's items appearing on competitor

Risk score: weighted combination of above signals
Action: sellers with risk score > 0.7 → seller success team outreach
```

---

## End-to-End Transaction Tracing

### Checkout Flow Trace Example (Annotated)

```
Trace ID: tx-2024-03-15-a7b3c2d4
Duration: 2,847ms
Outcome: SUCCESS

Timeline:
  T+0ms     [API Gateway]  Receive POST /v1/checkout/complete
  T+5ms     [API Gateway]  JWT validation, rate limit check → pass
  T+8ms     [Order Service] Begin checkout saga
  T+12ms    [Order Service] Validate reservation: reservation_id=res-881
  T+15ms    [Listing Svc]   Check listing state = active ✓
  T+18ms    [Listing Svc]   Verify reservation not expired (TTL remaining: 7m 22s) ✓
  T+22ms    [Tax Engine]    Calculate tax for ZIP 94107 → $3.82 (CA state + SF county)
  T+35ms    [Payment Svc]   Begin authorize: amount=$48.82, token=tok_xxx
  T+40ms    [Token Vault]   Decrypt payment token → card_last4=4242
  T+55ms    [Payment Svc]   → External processor: authorize $48.82
  T+820ms   [Payment Svc]   ← Authorization approved: auth_id=auth-7721
                            ⚠ External call latency: 765ms (> 500ms p95 threshold)
  T+825ms   [Listing Svc]   Hard commit: convert reservation to sold
  T+835ms   [DB Write]      UPDATE listings SET state='sold', version=version+1
  T+840ms   [Payment Svc]   Capture: auth_id=auth-7721
  T+1,600ms [Payment Svc]   ← Capture success: capture_id=cap-3344
  T+1,605ms [Escrow Svc]    Create escrow record: amount=$48.82, hold=5d (standard tier)
  T+1,620ms [DB Write]      INSERT INTO escrow_records (...) ✓
  T+1,625ms [Order Service]  Create order record
  T+1,640ms [DB Write]       INSERT INTO orders (...) ✓
  T+1,645ms [Event Bus]     Publish order.created event
  T+1,660ms [Order Service]  Saga complete → return success
  T+1,665ms [API Gateway]   Return 200 OK to buyer

  // Async downstream (not in critical path):
  T+1,700ms [Search Indexer]  Consume order.created → mark listing as sold in availability cache
  T+1,720ms [Trust Scorer]    Consume order.created → queue seller score recomputation
  T+1,750ms [Notification]    Consume order.created → send confirmation email to buyer
  T+1,800ms [Notification]    Consume order.created → send new order notification to seller
  T+2,847ms [Analytics]       Consume order.created → update GMV counters

Annotations:
  - Payment processor latency 765ms (flagged: above p95 of 500ms)
  - Total saga duration: 1,652ms (within 3s SLO)
  - DB writes: 3 (listing, escrow, order) — all successful
  - Event publication: 1 event, 5 consumers
```

### Trace-Based Alerting Rules

| Alert | Trigger | Action |
|---|---|---|
| Checkout saga > 3s | p99 latency exceeding SLO | Page on-call; check payment processor latency |
| Payment processor > 500ms (p95) | External call degradation | Consider failover to secondary processor |
| DB write > 100ms | Database contention | Check query plan; shard hot-spotting |
| Saga compensation triggered | Any compensating transaction executed | Log incident; check upstream failure cause |
| Event bus publish > 200ms | Event bus congestion | Check partition distribution; add capacity |

---

## Data Quality Monitoring

### Financial Data Integrity Checks

```
Automated financial integrity checks (run hourly):

  Check 1: Escrow balance consistency
    SUM(held_amount) for state='holding'
    must equal
    SUM(capture_amount) - SUM(released_amount) - SUM(refunded_amount)
    Tolerance: $0 (exact match required)
    Action on failure: SEV-1 page + freeze payouts

  Check 2: Order-escrow linkage
    Every order with state IN ('paid', 'shipped', 'delivered')
    must have exactly one escrow record with matching order_id
    Tolerance: 0 orphaned records
    Action on failure: Create missing escrow record; investigate root cause

  Check 3: Take rate accuracy
    platform_fee_cents / total_cents for each order
    must be within 0.1% of configured take_rate
    Tolerance: 0 orders outside range
    Action on failure: Investigate fee calculation; recompute if needed

  Check 4: Payout completeness
    Every escrow record with state='released_to_seller' older than 24 hours
    must have a corresponding payout record
    Tolerance: 0 missing payouts
    Action on failure: SEV-2 alert; queue missing payouts
```
