# 03 — Low-Level Design: A/B Testing Platform

## Data Models

### Experiment

```
Experiment {
    experiment_id:    UUID                    // globally unique
    name:             string
    description:      string
    layer_id:         UUID                    // mutual exclusion namespace
    status:           ENUM(draft, running, paused, stopped, archived)
    traffic_fraction: float [0.0, 1.0]       // fraction of eligible users exposed
    targeting_rules:  TargetingRule[]         // eligibility filters
    variants:         Variant[]
    primary_metric_id: UUID
    guardrail_metric_ids: UUID[]
    analysis_mode:    ENUM(frequentist, sequential, bayesian, bandit)
    salt:             string                  // random string mixed into hash
    created_at:       timestamp
    started_at:       timestamp
    stopped_at:       timestamp
    owner:            string                  // team or individual owner
    hypothesis:       string                  // pre-registered hypothesis text
    min_detectable_effect: float             // pre-registered MDE
    target_power:     float                  // pre-registered statistical power
    scheduled_stop_at: timestamp             // auto-stop date
}
```

### Variant

```
Variant {
    variant_id:       UUID
    experiment_id:    UUID
    name:             string                  // e.g. "control", "treatment_v1"
    ordinal:          int                     // 0 = control, 1+ = treatment
    traffic_weight:   float                  // relative weight within experiment traffic
    flag_overrides:   Map<flag_key, value>   // feature flag values for this variant
    metadata:         Map<string, any>       // arbitrary variant config
}
```

### Assignment

```
Assignment {
    assignment_id:    UUID
    experiment_id:    UUID
    variant_id:       UUID
    entity_id:        string                 // hashed/tokenized user identifier
    entity_type:      ENUM(user, device, session, org)
    bucket:           int [0, 9999]
    assigned_at:      timestamp
    assignment_source: ENUM(sdk_local, server_api, edge_node)
    eligibility_snapshot: Map<string, any>  // targeting attribute values at assignment time
}
```

### Event

```
Event {
    event_id:         UUID                   // idempotency key
    entity_id:        string
    entity_type:      ENUM(user, device, session, org)
    event_type:       string                 // e.g. "purchase", "click", "page_view"
    experiment_context: ExperimentContext[]  // list of active experiments at event time
    properties:       Map<string, any>      // metric-specific payload
    value:            float                 // optional numeric value (e.g. revenue amount)
    timestamp:        timestamp
    received_at:      timestamp             // server receipt time for lag monitoring
    session_id:       string
    server_digest:    string               // HMAC for integrity verification
}

ExperimentContext {
    experiment_id:    UUID
    variant_id:       UUID
    layer_id:         UUID
}
```

### Metric Definition

```
MetricDefinition {
    metric_id:        UUID
    name:             string
    description:      string
    metric_type:      ENUM(conversion_rate, mean, ratio, percentile, count)
    numerator_event:  string                // event type for numerator
    denominator_entity: ENUM(user, session) // what to count in denominator
    aggregation_fn:   ENUM(sum, mean, p50, p75, p95, p99, count_distinct)
    value_expression: string               // expression over event properties
    direction:        ENUM(increase, decrease)  // desired direction for "winning"
    winsorize_percentile: float           // cap outliers at this percentile
}
```

### Statistical Result

```
StatisticalResult {
    result_id:        UUID
    experiment_id:    UUID
    metric_id:        UUID
    variant_id:       UUID                  // treatment variant being compared to control
    computed_at:      timestamp
    analysis_type:    ENUM(frequentist, sequential, bayesian)

    // Sample statistics
    control_n:        int                   // sample size in control
    treatment_n:      int                   // sample size in treatment
    control_mean:     float
    treatment_mean:   float
    control_variance: float
    treatment_variance: float

    // Frequentist
    effect_size:      float                // absolute difference
    relative_effect:  float               // relative lift %
    p_value:          float
    confidence_interval_lower: float
    confidence_interval_upper: float
    is_significant:   bool

    // Sequential (if applicable)
    sequential_p_value:      float
    always_valid_ci_lower:   float
    always_valid_ci_upper:   float

    // Bayesian (if applicable)
    prob_treatment_better:   float
    expected_loss:           float
    credible_interval_lower: float
    credible_interval_upper: float

    // CUPED adjustment
    cuped_applied:    bool
    variance_reduction_pct: float
}
```

---

## API Design

### Experiment Management API

```
POST /v1/experiments
    Request: { name, description, layer_id, traffic_fraction, targeting_rules,
               variants, primary_metric_id, guardrail_metric_ids, analysis_mode,
               hypothesis, min_detectable_effect }
    Response: { experiment_id, status: "draft" }

PUT /v1/experiments/{experiment_id}/start
    Response: { experiment_id, status: "running", started_at }

PUT /v1/experiments/{experiment_id}/stop
    Response: { experiment_id, status: "stopped", stopped_at }

GET /v1/experiments/{experiment_id}
    Response: Experiment object with current status

GET /v1/experiments?status=running&layer_id=X&owner=Y
    Response: Paginated list of experiments
```

### Assignment API (Server-Side Fallback)

```
POST /v1/assignments/resolve
    Request: { entity_id, entity_type, attributes: { country, platform, ... } }
    Response: {
        assignments: [
            { experiment_id, variant_id, variant_name, flag_overrides },
            ...
        ]
    }
    Latency SLO: p99 < 5 ms
    Note: SDK evaluates locally; this endpoint is fallback for non-SDK clients
```

### Event Ingest API

```
POST /v1/events/batch
    Request: {
        events: [
            {
                event_id,        // idempotency key
                entity_id,
                entity_type,
                event_type,
                properties,
                value,
                timestamp
            }
        ]
    }
    Response: { accepted: N, rejected: M, rejected_reasons: [...] }
    Max batch size: 500 events
    Note: experiment_context injected server-side from assignment log
```

### Results API

```
GET /v1/experiments/{experiment_id}/results
    Query params: metric_id, analysis_type, segment_dimension
    Response: {
        results: StatisticalResult[],
        srm_status: { detected: bool, p_value: float },
        guardrail_status: { metric_id, status: ENUM(ok, warning, breach) }[]
    }
```

---

## Core Algorithms

### Algorithm 1: Deterministic Variant Assignment

```
function assign_variant(entity_id, experiment):
    // Step 1: Check eligibility
    if not evaluate_targeting_rules(entity_id, experiment.targeting_rules):
        return NO_ASSIGNMENT

    // Step 2: Compute deterministic bucket
    // Concatenate entity_id with experiment salt to prevent correlation across experiments
    hash_input = entity_id + "." + experiment.experiment_id + "." + experiment.salt

    // SHA-256 produces uniform output; take first 8 bytes as uint64
    digest = SHA256(hash_input)
    uint64_val = bytes_to_uint64(digest[0:8])

    // Map to [0, 9999] bucket (10,000 buckets = 0.01% granularity)
    bucket = uint64_val mod 10000

    // Step 3: Check if bucket is within experiment traffic allocation
    // traffic_fraction=0.10 means buckets 0-999 are in-experiment
    experiment_threshold = floor(experiment.traffic_fraction * 10000)
    if bucket >= experiment_threshold:
        return NO_ASSIGNMENT

    // Step 4: Assign to variant based on variant weights
    // Variants have relative weights; map bucket within experiment range to variant
    cumulative = 0
    total_weight = sum(v.traffic_weight for v in experiment.variants)
    for variant in experiment.variants sorted by ordinal:
        cumulative += (variant.traffic_weight / total_weight) * experiment_threshold
        if bucket < cumulative:
            return variant

    return experiment.variants[0]  // fallback to control
```

### Algorithm 2: CUPED Variance Reduction

```
// CUPED: adjust outcome Y using pre-experiment covariate X
// Adjusted metric: Y_cuped = Y - theta * (X - mean(X))
// theta = Cov(Y, X) / Var(X)  (minimizes variance of Y_cuped)

function compute_cuped_adjustment(experiment_id, metric_id):
    // Fetch pre-experiment period data (e.g., 14 days before experiment start)
    pre_exp_data = fetch_user_metric_values(
        metric_id = metric_id,
        period = [experiment.started_at - 14d, experiment.started_at],
        entity_ids = all_assigned_entities(experiment_id)
    )

    // Fetch in-experiment outcome data
    in_exp_data = fetch_user_metric_values(
        metric_id = metric_id,
        period = [experiment.started_at, now()],
        entity_ids = all_assigned_entities(experiment_id)
    )

    // Compute theta per variant (or globally if sample small)
    X = pre_exp_data.values       // pre-experiment metric per user
    Y = in_exp_data.values        // in-experiment metric per user

    theta = covariance(Y, X) / variance(X)
    X_mean = mean(X)

    // Compute adjusted Y for each user
    Y_cuped = [y - theta * (x - X_mean) for (y, x) in zip(Y, X)]

    variance_reduction_pct = 1 - variance(Y_cuped) / variance(Y)

    return {
        adjusted_values: Y_cuped,
        theta: theta,
        variance_reduction_pct: variance_reduction_pct
    }
```

### Algorithm 3: Sequential Testing (mSPRT Always-Valid P-Value)

```
// Mixture Sequential Probability Ratio Test
// At any time t, compute a p-value that remains valid under continuous monitoring
// Reference: Johari et al. "Always Valid Inference"

function compute_sequential_p_value(control_data, treatment_data, tau_squared):
    // tau_squared: mixing parameter (variance of the prior in mSPRT)
    // Recommended: tau_squared = MDE^2 / 4  (calibrated to pre-registered MDE)

    n_c = len(control_data)
    n_t = len(treatment_data)

    x_bar_c = mean(control_data)
    x_bar_t = mean(treatment_data)

    // Pooled variance estimate
    s_sq = pooled_variance(control_data, treatment_data)

    // Compute mSPRT statistic
    n_harmonic = harmonic_mean(n_c, n_t)

    // SPRT mixing statistic (simplified form for normal approximation)
    z = (x_bar_t - x_bar_c) / sqrt(s_sq * (1/n_c + 1/n_t))

    // Always-valid p-value via e-value inversion
    // e_value = sqrt(1 + n_harmonic * tau_squared / s_sq)
    //           * exp(- z^2 * n_harmonic * tau_squared
    //                 / (2 * s_sq * (1 + n_harmonic * tau_squared / s_sq)))
    e_value = compute_e_value(z, n_harmonic, s_sq, tau_squared)

    // p-value = min(1, 1 / e_value)  by Markov's inequality
    sequential_p_value = min(1.0, 1.0 / e_value)

    return sequential_p_value
```

### Algorithm 4: Sample Ratio Mismatch Detection

```
// SRM: test whether actual traffic split matches expected split
// Use chi-squared goodness-of-fit test

function detect_srm(experiment_id):
    variants = get_experiment_variants(experiment_id)

    // Fetch actual assignment counts per variant
    actual_counts = []
    for variant in variants:
        actual_counts.append(count_assignments(experiment_id, variant.variant_id))

    total_assigned = sum(actual_counts)

    // Compute expected counts based on variant weights
    expected_counts = []
    for variant in variants:
        weight_fraction = variant.traffic_weight / sum(v.traffic_weight for v in variants)
        expected_counts.append(total_assigned * weight_fraction)

    // Chi-squared statistic
    chi_sq = sum(
        (actual - expected)^2 / expected
        for (actual, expected) in zip(actual_counts, expected_counts)
    )

    degrees_of_freedom = len(variants) - 1
    p_value = chi_squared_p_value(chi_sq, degrees_of_freedom)

    srm_detected = p_value < SRM_SIGNIFICANCE_THRESHOLD  // typically 0.001

    if srm_detected and total_assigned > MIN_SAMPLE_FOR_SRM_CHECK:  // e.g., 1000
        emit_alert(experiment_id, "SRM detected", p_value, actual_counts, expected_counts)

    return { srm_detected, p_value, actual_counts, expected_counts }
```

### Algorithm 5: Thompson Sampling for Multi-Armed Bandit

```
// Thompson Sampling for binary conversion metric (Beta-Binomial model)
// Each variant maintains Beta(alpha, beta) posterior over conversion rate

function thompson_sampling_allocation(experiment_id):
    variants = get_experiment_variants(experiment_id)

    // Fetch sufficient statistics per variant
    samples = []
    for variant in variants:
        conversions = count_metric_events(experiment_id, variant.variant_id, "conversion")
        non_conversions = count_assignments(experiment_id, variant.variant_id) - conversions

        // Prior: Beta(1, 1) = Uniform
        alpha = 1 + conversions
        beta  = 1 + non_conversions

        // Sample from posterior
        theta_sample = beta_distribution_sample(alpha, beta)
        samples.append({ variant, theta_sample })

    // Allocate traffic proportional to probability each arm is best
    // Run N Monte Carlo samples (e.g., N=10000) to estimate P(arm_i is best)
    win_counts = {variant: 0 for variant in variants}
    for _ in range(N_SAMPLES):
        variant_samples = {v: beta_distribution_sample(alpha_v, beta_v) for v in variants}
        winner = argmax(variant_samples)
        win_counts[winner] += 1

    // Set new traffic weights proportional to win probability
    new_weights = {v: win_counts[v] / N_SAMPLES for v in variants}

    // Apply epsilon-greedy floor: ensure minimum 5% traffic to each arm
    epsilon = 0.05
    for variant in variants:
        new_weights[variant] = max(new_weights[variant], epsilon / len(variants))

    // Normalize
    total = sum(new_weights.values())
    normalized_weights = {v: w / total for v, w in new_weights.items()}

    update_variant_traffic_weights(experiment_id, normalized_weights)
```

### Algorithm 6: Guardrail Metric Evaluation

```
// Guardrail metrics are pre-defined metrics that must not degrade
// If a treatment causes significant degradation on any guardrail, the experiment is auto-stopped

function evaluate_guardrails(experiment_id):
    experiment = get_experiment(experiment_id)
    guardrails = experiment.guardrail_metric_ids

    for metric_id in guardrails:
        result = compute_statistical_result(experiment_id, metric_id)

        // Guardrails use one-sided tests: we only care about degradation
        // Direction depends on metric type (latency: increase is bad; conversion: decrease is bad)
        metric_def = get_metric_definition(metric_id)

        if metric_def.direction == INCREASE:
            // Higher is better (e.g., conversion rate)
            // Degradation = treatment mean < control mean with significance
            degraded = result.treatment_mean < result.control_mean
                       AND result.p_value < GUARDRAIL_SIGNIFICANCE  // typically 0.01
                       AND abs(result.relative_effect) > GUARDRAIL_MDE  // e.g., -0.5%
        else:
            // Lower is better (e.g., latency, error rate)
            degraded = result.treatment_mean > result.control_mean
                       AND result.p_value < GUARDRAIL_SIGNIFICANCE
                       AND abs(result.relative_effect) > GUARDRAIL_MDE

        if degraded:
            // Auto-stop the experiment
            stop_experiment(experiment_id, reason="guardrail_breach",
                           metric=metric_id, effect=result.relative_effect)
            emit_alert(experiment_id, "GUARDRAIL_BREACH", metric_id)
            return BREACHED

    return OK
```

### Algorithm 7: Metric Winsorization

```
// Winsorization caps extreme values to reduce variance from outliers
// Applied before all statistical tests

function winsorize_metric_values(values, percentile):
    // percentile is typically 0.995 (cap at 99.5th percentile)
    lower_cap = quantile(values, 1 - percentile)  // e.g., 0.5th percentile
    upper_cap = quantile(values, percentile)       // e.g., 99.5th percentile

    winsorized = []
    for v in values:
        if v < lower_cap:
            winsorized.append(lower_cap)
        elif v > upper_cap:
            winsorized.append(upper_cap)
        else:
            winsorized.append(v)

    return winsorized
```

**Why winsorize instead of trim (remove outliers)?** Trimming reduces sample size, which reduces statistical power. Winsorization preserves sample size while reducing variance. For revenue metrics with heavy tails, winsorization at the 99.5th percentile typically reduces variance by 20-40% with negligible bias in the mean estimate.

### Algorithm 8: Layer Assignment Resolution

```
// Resolve all experiment assignments for a user across all layers
// This is the core logic the SDK executes on every assignment call

function resolve_all_assignments(entity_id, entity_type, attributes, ruleset):
    assignments = []

    // Check global holdback first
    holdback_layer = ruleset.holdback_layer
    if holdback_layer:
        holdback_bucket = compute_bucket(entity_id, holdback_layer.layer_salt)
        if holdback_bucket < holdback_layer.holdback_fraction × 10000:
            // User is in global holdback — no experiments
            return [HoldbackAssignment(layer_id=holdback_layer.layer_id)]

    // Iterate through each layer
    for layer in ruleset.layers:
        // Compute user's bucket in this layer's namespace
        layer_bucket = compute_bucket(entity_id, layer.layer_salt)

        // Find the experiment this bucket maps to (if any)
        assigned_experiment = null
        bucket_cursor = 0
        for experiment in layer.experiments sorted by bucket_range_start:
            experiment_threshold = floor(experiment.traffic_fraction × 10000)
            if layer_bucket >= bucket_cursor AND layer_bucket < bucket_cursor + experiment_threshold:
                // User falls within this experiment's bucket range
                if evaluate_targeting_rules(attributes, experiment.targeting_rules):
                    assigned_experiment = experiment
                    break
            bucket_cursor += experiment_threshold

        if assigned_experiment:
            // Assign to a variant within the experiment
            variant = assign_variant(entity_id, assigned_experiment)
            assignments.append(Assignment(
                experiment_id=assigned_experiment.experiment_id,
                variant_id=variant.variant_id,
                layer_id=layer.layer_id,
                flag_overrides=variant.flag_overrides
            ))

    return assignments

function compute_bucket(entity_id, salt):
    digest = SHA256(entity_id + "." + salt)
    return bytes_to_uint64(digest[0:8]) mod 10000
```

### Algorithm 9: Experiment Interaction Detection

```
// Detect statistical interactions between concurrent experiments in different layers
// Run as a background analysis for experiment pairs flagged as potentially related

function detect_interaction(experiment_a_id, experiment_b_id, metric_id):
    // Segment users into 4 groups
    users_a_ctrl_b_ctrl = get_users(a=CONTROL, b=CONTROL)
    users_a_treat_b_ctrl = get_users(a=TREATMENT, b=CONTROL)
    users_a_ctrl_b_treat = get_users(a=CONTROL, b=TREATMENT)
    users_a_treat_b_treat = get_users(a=TREATMENT, b=TREATMENT)

    // Compute metric means for each group
    m_00 = mean(metric_values(users_a_ctrl_b_ctrl, metric_id))
    m_10 = mean(metric_values(users_a_treat_b_ctrl, metric_id))
    m_01 = mean(metric_values(users_a_ctrl_b_treat, metric_id))
    m_11 = mean(metric_values(users_a_treat_b_treat, metric_id))

    // Interaction effect = difference of differences
    // If treatments are additive: m_11 - m_01 should equal m_10 - m_00
    interaction = (m_11 - m_01) - (m_10 - m_00)

    // Standard error via bootstrap or delta method
    se_interaction = bootstrap_se(users_a_ctrl_b_ctrl, users_a_treat_b_ctrl,
                                  users_a_ctrl_b_treat, users_a_treat_b_treat, metric_id)

    z_stat = interaction / se_interaction
    p_value = 2 × (1 - normal_cdf(abs(z_stat)))

    if p_value < INTERACTION_SIGNIFICANCE:  // typically 0.05
        return InteractionDetected(
            interaction_effect=interaction,
            p_value=p_value,
            recommendation="Consider placing experiments in the same layer or shipping sequentially"
        )

    return NoInteractionDetected()
```

---

## Storage Architecture

### Data Partitioning Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Data Category       │ Partition Key     │ Sort Key      │ Storage Engine    │
├─────────────────────┼───────────────────┼───────────────┼───────────────────┤
│ Raw events          │ entity_id hash    │ timestamp     │ Append-only log   │
│ Assignment log      │ entity_id hash    │ timestamp     │ Append-only log   │
│ Streaming aggregates│ experiment_id     │ metric_id     │ In-memory store   │
│ Batch aggregates    │ experiment_id     │ metric_id+day │ Columnar store    │
│ Statistical results │ experiment_id     │ computed_at   │ Document store    │
│ Experiment config   │ experiment_id     │ version       │ Key-value store   │
│ Audit log           │ actor_id          │ timestamp     │ Append-only log   │
│ Compiled rulesets   │ ruleset_version   │ —             │ Object store      │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Entity-ID partitioning for events** is the critical choice: it ensures that all events from the same user land on the same partition, enabling local aggregation per-entity without cross-partition shuffles. The trade-off is potential hot-partition risk if certain entity IDs are disproportionately active (bots, power users), mitigated by a secondary hash on the raw entity ID.

### Event Log Compaction and Retention

```
Tier 0 — Hot (0-7 days):
    Format: Row-oriented in durable queue
    Purpose: Streaming aggregation, dedup window
    Access: Sequential read by stream processors
    Storage: SSD-backed distributed log, 3× replicated

Tier 1 — Warm (7-90 days):
    Format: Columnar (Parquet-equivalent), partitioned by date + entity_id hash
    Purpose: Batch aggregation, CUPED computation, ad-hoc metric re-computation
    Access: Batch scan by analysis jobs
    Storage: Distributed file system, erasure-coded (1.5× overhead)

Tier 2 — Cold (90-365 days):
    Format: Compressed columnar, partitioned by month
    Purpose: Audit compliance, retrospective analysis
    Access: Infrequent; query latency SLO relaxed to minutes
    Storage: Object storage, lifecycle policy to archive class at 180 days

Tier 3 — Archive (365+ days):
    Format: Compressed columnar, deduplicated
    Purpose: Regulatory retention
    Access: On-demand restore with 12-hour retrieval SLA
    Storage: Archive-tier object storage
```

### Compiled Ruleset Format

The ruleset is the serialized representation of all active experiments distributed to SDKs. Its internal format is optimized for evaluation speed:

```
CompiledRuleset {
    version:          uint64              // monotonically increasing
    compiled_at:      timestamp
    checksum:         bytes[32]           // SHA-256 of serialized content

    global_holdback: {
        layer_salt:     string
        fraction:       float             // e.g. 0.01 for 1% holdback
    }

    layers: [
        {
            layer_id:     UUID
            layer_salt:   string
            experiments: [
                {
                    experiment_id:    UUID
                    salt:             string
                    traffic_fraction: float
                    targeting_rules:  CompiledTargetingRule[]   // pre-compiled for fast evaluation
                    variants: [
                        { variant_id, ordinal, traffic_weight, flag_overrides }
                    ]
                }
            ]
        }
    ]

    // Pre-computed lookup tables for fast targeting evaluation
    targeting_index: {
        // Maps attribute keys → list of experiments that filter on them
        // Allows SDK to short-circuit evaluation for users with specific attributes
        attribute_to_experiments: Map<string, ExperimentId[]>
    }
}
```

**Serialization**: Binary format (e.g., FlatBuffers or Protocol Buffers) for zero-copy deserialization. Typical size: 400-800 KB compressed for a platform running 10,000 experiments. Compression ratio: ~3:1 (2-3 MB uncompressed → 800 KB).

### SDK Internal Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Application Process                                            │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  A/B Testing SDK                                         │   │
│  │                                                          │   │
│  │  ┌──────────────┐    ┌────────────────────────────────┐  │   │
│  │  │ Public API   │───▶│ Assignment Engine               │  │   │
│  │  │ .getVariant()│    │  - targeting evaluation         │  │   │
│  │  │ .track()     │    │  - hash computation             │  │   │
│  │  └──────────────┘    │  - variant resolution           │  │   │
│  │                      └───────────────┬────────────────┘  │   │
│  │                                      │ reads              │   │
│  │  ┌──────────────────────────────────▼────────────────┐   │   │
│  │  │ Ruleset Store                                      │   │   │
│  │  │  - in-memory compiled ruleset                      │   │   │
│  │  │  - version tracking                                │   │   │
│  │  │  - atomic swap on update                           │   │   │
│  │  └──────────────────────────────────┬────────────────┘   │   │
│  │                                      │ background         │   │
│  │  ┌──────────────────────────────────▼────────────────┐   │   │
│  │  │ Ruleset Updater (background thread)                │   │   │
│  │  │  - polls CDN every 30 seconds                      │   │   │
│  │  │  - ETag-based conditional fetch                    │   │   │
│  │  │  - validates checksum before swap                  │   │   │
│  │  │  - emits update events for observability           │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  │                                                          │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │ Event Buffer                                       │   │   │
│  │  │  - in-memory ring buffer (max 10,000 events)       │   │   │
│  │  │  - flushes every 10 seconds or at 500 events       │   │   │
│  │  │  - persistent overflow to disk on flush failure    │   │   │
│  │  │  - retry with exponential backoff (max 5 minutes)  │   │   │
│  │  │  - attaches experiment_context at track() time      │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Thread safety**: The ruleset is read on every assignment call (potentially thousands per second in high-traffic services). Updates use an atomic pointer swap — the updater builds a new `CompiledRuleset` in a separate allocation, validates it, and swaps the pointer. No locking on the hot path.

**Initialization sequence**:
1. SDK loads cached ruleset from local disk (if available)
2. SDK immediately begins serving assignments from cached ruleset
3. Background thread fetches latest ruleset from CDN
4. If CDN version is newer, atomic swap to new ruleset
5. If CDN is unreachable, continue with cached version indefinitely

**Failure modes**:
- CDN unreachable → stale ruleset (still functional; assignment is deterministic from the same ruleset)
- Corrupt ruleset download → checksum validation fails → keep current ruleset
- Process restart with no disk cache → SDK returns CONTROL for all experiments until first successful CDN fetch (typically < 2 seconds)
