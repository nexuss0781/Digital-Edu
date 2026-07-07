# Deep Dive & Bottlenecks

## 1. Real-Time Credit Decisioning Engine

### The Problem

A BNPL credit decision must complete in under 2 seconds during checkout---the most conversion-sensitive moment in e-commerce. Each decision requires orchestrating multiple data sources (credit bureau, feature store, device fingerprint), running an ML model, computing plan eligibility, generating regulatory disclosures, and persisting an audit record. Every additional 100ms of latency costs measurable conversion loss.

### Architecture Deep Dive

The credit decision pipeline is structured as a **staged pipeline with parallel fan-out**:

**Stage 1: Pre-Screen (< 10ms)**
Fast rule-based checks that reject obviously ineligible requests without touching external services: account status, platform exposure limits, order amount bounds, merchant-level blocks, and velocity limits (e.g., max 3 active plans). This stage rejects ~10--15% of requests, saving expensive downstream processing.

**Stage 2: Data Assembly (< 500ms, parallelized)**
The most latency-sensitive stage. Three data fetches happen in parallel:
- **Soft credit pull**: Bureau data is cached for 24 hours per consumer. Cache hit ratio is ~70% (repeat consumers within a day). On cache miss, the bureau API call takes 300--500ms.
- **Feature store lookup**: Pre-computed features (repayment history, velocity, behavioral signals) are served from an in-memory store. Latency: 5--10ms.
- **Device/session scoring**: Device fingerprint, IP geolocation, and browser signals are computed client-side and validated server-side. Latency: 10--20ms.

The total Stage 2 latency is MAX(bureau_call, feature_lookup, device_scoring) ≈ 500ms (worst case, bureau cache miss).

**Stage 3: ML Inference (< 100ms)**
The assembled feature vector (200+ features) is passed to the risk model and fraud model. Models are served via a low-latency inference service with models pre-loaded in memory. Batch inference is not an option; each request requires individual scoring. Model versions are deployed via blue-green deployment with shadow scoring to validate new models against production traffic.

**Stage 4: Decision Logic & Plan Eligibility (< 50ms)**
Rule-based decision layer that combines ML scores with business rules: risk thresholds, affordability checks (debt-to-income ratio), merchant-specific policies, and regulatory constraints (state-level lending limits, maximum APR caps).

**Stage 5: Disclosure Generation & Audit (< 50ms, partially async)**
TILA disclosure computation (APR, finance charge, total of payments) is synchronous (required in response). Audit record persistence is fire-and-forget to a durable queue---the decision response is not blocked by audit write completion.

### Slowest part of the process Analysis

| Slowest part of the process | Impact | Mitigation |
|-----------|--------|------------|
| Bureau API latency (300--500ms) | Dominates decision latency on cache miss | 24h cache per consumer; fallback to bureau-less scoring model (higher risk tolerance, lower approval limit) |
| ML model cold start | First request after deployment takes 2--5s | Pre-warm models on deployment; canary routing to new model instances |
| Feature store staleness | Stale features lead to incorrect risk scores | Hourly refresh for active consumers; event-driven updates for material changes (missed payment, new plan) |
| Audit write amplification | Each decision generates ~5KB of audit data | Async write via durable queue; batch persist to audit database |

### Race Condition: Concurrent Checkout Sessions

**Scenario**: A consumer opens two browser tabs at different merchants and initiates checkout simultaneously. Both credit decisions see the same outstanding balance and approve, potentially exceeding the consumer's safe exposure limit.

**Solution**: Pessimistic reservation lock. When a credit decision is approved, a "credit reservation" is created with a short TTL (15 minutes). Subsequent credit decisions see the reservation and reduce available spending power accordingly. If the checkout is not confirmed within the TTL, the reservation expires.

```
FUNCTION check_and_reserve_credit(consumer_id, amount):
    LOCK consumer_credit_mutex(consumer_id):  -- distributed lock, 5s TTL
        current_outstanding = get_total_outstanding(consumer_id)
        active_reservations = get_active_reservations(consumer_id)
        total_committed = current_outstanding + SUM(active_reservations)

        IF total_committed + amount > consumer.spending_power:
            RETURN insufficient_credit

        create_reservation(consumer_id, amount, ttl=15_minutes)
        RETURN reservation_id
```

---

## 2. Payment Collection at Scale

### The Problem

5 million scheduled payments per day, concentrated in 3 collection windows (morning, afternoon, evening), must be collected reliably. Each collection attempt involves charging a consumer's payment method via an external payment processor. Failures must be retried intelligently, and the system must handle partial payments, expired cards, insufficient funds, and processor outages---all while maintaining exactly-once payment semantics.

### Collection Architecture

**Batch Generation**: A scheduler queries `ScheduledPayment WHERE due_date <= TODAY AND status = 'scheduled'`, partitioned by payment processor to optimize batch API calls. Payments are grouped into batches of 1,000 for processor submission.

**Idempotent Execution**: Each collection attempt is identified by `payment_id + attempt_number`. The payment processor deduplicates on this key. Even if the collection service crashes and replays the batch, no consumer is charged twice.

**Processor Fan-Out**: Different consumers use different payment methods routed to different processors. The orchestration layer fans out to multiple processors in parallel, respecting each processor's rate limits and batch size constraints.

**Result Reconciliation**: Processor responses (success/failure per payment) are reconciled against the batch. Successful payments update plan state immediately. Failures are categorized and routed to the appropriate retry strategy.

### Retry Intelligence

Not all payment failures are equal. The retry strategy is tailored to the failure reason:

| Failure Reason | Retry Strategy | Max Retries | Delay Pattern |
|---------------|----------------|-------------|---------------|
| Insufficient funds | Exponential backoff (1d, 3d, 5d, 7d) | 4 | Wait for paycheck cycle |
| Card expired | Notify consumer; retry after card update | 2 | 3-day wait + notification |
| Card declined (generic) | Retry next collection window | 3 | 8h, 24h, 72h |
| Processor timeout | Immediate retry with different processor route | 3 | 0s, 30s, 2min |
| Bank maintenance | Retry next business day | 2 | Next business day |
| Fraud hold | Do not retry; flag for manual review | 0 | N/A |

### Slowest part of the process: Collection Window Thundering Herd

When 2M payments are due at the same collection window, the burst load on payment processors can trigger rate limiting or degraded response times.

**Solution**: Staggered batch submission with jitter. Instead of submitting all 2M payments at 9:00 AM:
1. Partition payments into 100 batches of 20K
2. Submit each batch with 30-second intervals (total: 50 minutes to submit all)
3. Within each batch, add random jitter (0--5 seconds per payment)
4. Prioritize by delinquency risk (payments already late are collected first)

---

## 3. Merchant Settlement Reconciliation

### The Problem

500K merchants receive daily or periodic settlements. Each settlement must exactly equal the sum of confirmed transactions minus refunds, chargebacks, and the merchant discount fee. A single penny of discrepancy triggers merchant disputes and regulatory scrutiny.

### Settlement Pipeline

```
1. Transaction Aggregation (T+0, end of day)
   - Query all confirmed plans for merchant in settlement window
   - Include: plan creation amount (gross)
   - Deduct: refunds processed, chargebacks, adjustments

2. Fee Calculation
   - Apply merchant-specific discount rate to gross amount
   - Apply any volume-based tier discounts
   - Calculate net settlement = gross - refunds - chargebacks - fee

3. Reconciliation Check
   - Compare computed settlement against running total from event stream
   - Flag any discrepancy > $0.01 for manual review
   - Settlement proceeds only if reconciliation passes

4. Settlement Execution (T+1 to T+3)
   - Generate bank transfer instruction
   - Submit to banking partner
   - Track settlement status to completion
   - Send settlement report to merchant (webhook + dashboard)
```

### Race Condition: Late Refund vs. Settlement Cutoff

**Scenario**: A refund is processed at 11:59 PM, but the settlement aggregation job started at 11:55 PM. The refund is not included in today's settlement, so the merchant is overpaid.

**Solution**: Settlement aggregation uses a snapshot timestamp. Any transactions or refunds with timestamps after the snapshot are included in the next settlement period. The snapshot timestamp is recorded in the settlement record for audit. A nightly reconciliation job compares settlement records against the full transaction log to detect any mismatches.

---

## 4. Virtual Card Authorization Flow

### The Problem

For non-integrated merchants, the platform issues single-use virtual cards. When the consumer uses this card, the merchant's payment processor sends an authorization request through the card network to the BNPL platform (acting as card issuer). The authorization must be processed in < 3 seconds (card network timeout), and the BNPL platform must validate that the card is being used at the correct merchant for the correct amount.

### Authorization Flow

```
Consumer → Enters virtual card at merchant checkout
Merchant → Sends auth request to acquiring bank
Acquiring Bank → Routes through card network
Card Network → Sends auth request to BNPL (as issuer)

BNPL Authorization Handler:
    1. Look up virtual card by card_number_token
    2. Validate: card not expired, not already used
    3. Validate: merchant matches merchant_lock
    4. Validate: amount <= authorized_amount (with 10% tolerance for tax/shipping)
    5. Create installment plan (same as direct integration flow)
    6. Respond with approval code

Card Network → Returns approval to acquiring bank
Acquiring Bank → Returns approval to merchant
Merchant → Completes order
```

### Slowest part of the process: Card Network Timeout

Card networks enforce strict timeout windows (typically 3--5 seconds). The BNPL platform must complete the full credit decision, plan creation, and first installment charge within this window when using the virtual card flow.

**Mitigation**: Pre-approval. When the consumer requests a virtual card, the credit decision is already completed. The card is issued with a pre-approved amount. The authorization handler only needs to validate the card and merchant match---skipping the expensive credit decision pipeline. This reduces authorization latency to < 500ms.

---

## 5. Delinquency Management and Collections Workflow

### The Problem

5--15% of plans experience at least one missed payment. The collections workflow must balance maximizing recovery (collecting owed amounts) with consumer experience (maintaining the relationship) and regulatory compliance (fair debt collection practices, hardship accommodation).

### Dunning Sequence

```
Day 0:   Payment fails → Auto-retry in 24h
Day 1:   Retry #1 fails → Send email reminder
Day 3:   Retry #2 fails → Send SMS + push notification
Day 5:   Retry #3 fails → Assess late fee (if permitted in jurisdiction)
Day 7:   Retry #4 fails → Offer payment plan modification
Day 14:  → In-app banner + email: hardship program offer
Day 30:  → Phone outreach (if opted in) + formal notice
Day 60:  → Final notice: plan will be charged off in 60 days
Day 90:  → Suspend consumer account; report to credit bureau
Day 120: → Charge off; queue for debt sale or collection agency
```

### Hardship Program Logic

```
FUNCTION evaluate_hardship(consumer, plan):
    -- Eligibility criteria
    IF plan.delinquency_stage NOT IN (late_2, late_3, collections):
        RETURN not_eligible  -- too early for hardship

    IF consumer has hardship_plan within last 12 months:
        RETURN not_eligible  -- prevent abuse

    -- Determine modification options
    options = []

    -- Option 1: Extended terms (reduce installment amount)
    IF plan.remaining_installments <= 12:
        extended = create_extended_schedule(
            plan.remaining_balance,
            new_term = plan.remaining_installments × 2,
            apr = plan.apr  -- maintain original APR
        )
        options.add(extended)

    -- Option 2: Reduced payment (temporary)
    reduced = create_reduced_schedule(
        plan.remaining_balance,
        reduced_amount = plan.installment_amount × 0.5,
        reduced_period = 3_months,
        then_resume_original = true
    )
    options.add(reduced)

    -- Option 3: Waive late fees
    IF plan.late_fees_accrued > 0:
        options.add(waive_late_fees(plan))

    RETURN hardship_options(options)
```

---

## 6. Critical Race Conditions Summary

| Race Condition | Trigger | Impact | Resolution |
|---------------|---------|--------|------------|
| **Concurrent checkout** | Same consumer, two merchants, simultaneous | Over-extension of credit | Credit reservation with TTL + distributed lock |
| **Double payment** | Consumer manual pay + auto-collection overlap | Consumer charged twice | Idempotency key on payment_id; optimistic lock on payment status |
| **Refund during collection** | Refund processed while payment is in-flight | Plan state inconsistency | Saga: refund waits for in-flight collection to complete or fail |
| **Settlement cutoff** | Late refund near settlement aggregation | Merchant over/underpayment | Snapshot-based aggregation with next-period carry-over |
| **Virtual card replay** | Card number reused (attack or error) | Double disbursement | Single-use enforcement: card status set to "used" atomically on first auth |
| **Plan modification during payment** | Hardship plan accepted while payment processing | Incorrect amount collected | Optimistic concurrency: payment checks plan version before executing |

---

## 7. Failure Modes and Degradation

| Failure | Impact | Graceful Degradation |
|---------|--------|---------------------|
| Credit bureau unavailable | Cannot get credit pull data | Fall back to bureau-less model with lower approval limits; flag decisions as "limited_data" |
| ML model service down | Cannot score risk | Fall back to rules-based scoring with conservative thresholds |
| Payment processor outage | Cannot collect payments | Queue payments; retry when processor recovers; extend grace period automatically |
| Feature store stale | Risk scores based on old data | Accept staleness up to 24h; reject if feature freshness > 24h |
| Database primary failover | Write unavailability | Promote replica; queue writes during failover window (seconds); replay from WAL |
| Card network timeout | Virtual card auth fails | Consumer sees "payment declined"; they can retry or use a different payment method |
| Settlement bank unavailable | Merchant payouts delayed | Queue settlements; notify affected merchants; process when bank recovers |
| Open banking API degraded | Cannot verify real-time income | Fall back to bureau-only affordability; reduce approval limits by 20% |

---

## 8. Open Banking Affordability Assessment

### The Problem

Traditional credit bureau data provides a backward-looking view of creditworthiness (debt history, utilization, delinquencies) but reveals nothing about current cashflow, regular income deposits, or essential expenses. Open banking APIs enable real-time affordability checks by analyzing actual bank transaction data---but introduce new latency, consent management, and data quality challenges.

### Architecture

```
Open Banking Affordability Pipeline:
  1. Consent Acquisition (one-time, pre-checkout):
     - Consumer grants read-only access to bank transaction data
     - Consent stored with scope (accounts, transactions) and expiry (90 days typical)
     - Refresh token enables ongoing access without re-consent

  2. Data Retrieval (< 400ms via cached aggregation):
     - Fetch 90 days of transaction history from consented accounts
     - Cache aggregated features (income, expenses, balance trends) with 24h TTL
     - On cache hit: 5ms feature lookup (same as bureau cache pattern)
     - On cache miss: 200-400ms API call + computation

  3. Cashflow Feature Extraction:
     - Regular income detection: salary deposits, gig income, government benefits
     - Essential expense categorization: rent, utilities, insurance, debt payments
     - Discretionary spending patterns: dining, entertainment, shopping
     - Balance trajectory: trending up, stable, or declining
     - Overdraft frequency: indicator of cash stress

  4. Affordability Score:
     - Disposable income = detected_income - essential_expenses
     - Affordability ratio = proposed_installment / disposable_income
     - Threshold: installment must be < 15% of disposable income
     - Combined with bureau data for hybrid risk score
```

### Impact on Credit Decisioning

| Metric | Bureau-Only | Bureau + Open Banking |
|--------|-------------|----------------------|
| Approval rate | ~72% | ~78% (thin-file consumers gain access) |
| Default rate | ~3.2% | ~2.8% (better affordability signal) |
| Decline-to-appeal rate | ~8% | ~4% (fewer false declines) |
| Thin-file consumer approval | ~35% | ~55% (transaction history replaces credit history) |

### Consent Lifecycle Management

```
FUNCTION manage_open_banking_consent(consumer):
    existing_consent = get_consent(consumer.id)

    IF existing_consent AND existing_consent.expires_at > NOW() + 30_days:
        -- Consent is fresh; use cached data
        RETURN use_cached_features(consumer.id)

    IF existing_consent AND existing_consent.expires_at > NOW():
        -- Consent expiring soon; request refresh in background
        queue_consent_refresh(consumer.id)
        RETURN use_cached_features(consumer.id)

    IF NOT existing_consent:
        -- No consent; credit decision proceeds without open banking
        -- Offer consent acquisition in consumer app for future decisions
        RETURN bureau_only_decision(consumer)
```

---

## 9. Adaptive Checkout and Dynamic Plan Optimization

### The Problem

Offering the same plan options to every consumer at every merchant is suboptimal. A consumer buying $50 of groceries should not see the same plans as a consumer buying $2,000 of electronics. The platform must dynamically optimize which plan types, terms, and promotional offers to present based on consumer risk profile, merchant category, order value, and competitive landscape.

### Adaptive Plan Selection Logic

```
FUNCTION optimize_plan_offers(consumer, order, merchant, risk_score):
    base_plans = get_merchant_enabled_plans(merchant)
    optimized_offers = []

    FOR plan_type IN base_plans:
        -- Calculate platform economics for this plan
        expected_merchant_fee = order.amount × merchant.discount_rate
        expected_default_loss = order.amount × risk_score × loss_given_default
        expected_interest_income = compute_interest_income(plan_type, order.amount)
        expected_late_fee_income = estimate_late_fees(risk_score, plan_type)

        plan_npv = expected_merchant_fee + expected_interest_income
                   + expected_late_fee_income - expected_default_loss
                   - cost_of_capital(plan_type.duration)

        IF plan_npv > MIN_PROFITABILITY_THRESHOLD:
            -- This plan is profitable to offer
            offer = build_offer(plan_type, order, risk_score)

            -- Apply merchant-funded promotions
            IF merchant.has_active_promotion(plan_type):
                offer.apply_promotion(merchant.promotion)

            -- Apply consumer loyalty benefits
            IF consumer.credit_tier == "premium" AND consumer.on_time_rate > 0.95:
                offer.reduce_apr(loyalty_discount_bps)

            optimized_offers.add(offer)

    -- Sort: interest-free first, then by consumer value
    SORT optimized_offers BY (apr ASC, installment_count ASC)
    RETURN optimized_offers[0:MAX_DISPLAYED_PLANS]
```

### Dynamic Pricing by Vertical

| Merchant Category | Typical Discount Rate | Avg Plan Type | Default Risk | AOV Uplift |
|------------------|----------------------|---------------|-------------|------------|
| Fashion / Apparel | 4--6% | Pay-in-4 | Low (2.1%) | +45% |
| Electronics | 3--5% | Pay-in-6 to Pay-in-12 | Medium (3.5%) | +35% |
| Health / Wellness | 5--8% | Pay-in-6 | Low (1.8%) | +55% |
| Travel | 3--4% | Pay-in-12 | High (4.2%) | +25% |
| Home Furnishing | 4--6% | Pay-in-12 | Medium (2.9%) | +40% |
| Luxury Goods | 2--3% | Pay-in-12+ | Low (1.5%) | +30% |
| Grocery / Essentials | 1--2% | Pay-in-4 | Very Low (0.8%) | +10% |

---

## 10. BNPL-as-a-Service (White-Label) Architecture

### The Problem

Banks, fintechs, and large retailers increasingly want to offer BNPL under their own brand, powered by a white-label platform. This requires multi-tenant architecture where each tenant has isolated branding, risk policies, regulatory configurations, and settlement accounts---while sharing the underlying infrastructure for cost efficiency.

### Multi-Tenant Isolation Model

```
Tenant Isolation:
  Shared (cost-efficient):
    - Payment processor connections (pooled)
    - ML model infrastructure (shared compute, per-tenant model weights)
    - Event bus infrastructure
    - Monitoring and observability

  Isolated (security / compliance):
    - Consumer data (separate database schemas or encryption keys per tenant)
    - Credit decision policies (per-tenant risk thresholds, plan types, APR limits)
    - Regulatory configuration (per-tenant jurisdiction rules)
    - Settlement accounts (per-tenant bank accounts)
    - Branding (per-tenant checkout widgets, notifications, dashboards)
    - API keys and webhook configurations

  Tenant Configuration Record:
    tenant_id, brand_name, brand_assets (logo, colors, fonts)
    risk_policy_version, plan_types_enabled, max_order_amount
    jurisdiction_rules, settlement_bank_account, discount_rate_schedule
    api_key_hash, webhook_url, notification_templates
```

### Key Challenge: Shared ML Models with Per-Tenant Data

Each tenant has different consumer populations and risk profiles. A single shared model would underperform across all tenants. The solution is a **base model with per-tenant fine-tuning layers**:

1. Base risk model trained on aggregated, anonymized data from all tenants
2. Per-tenant adaptation layer fine-tuned on tenant-specific repayment data
3. New tenants start with the base model; fine-tuning begins after 10,000 decisions
4. Tenant data is never shared across tenants (only aggregated, anonymized features flow to the base model)
