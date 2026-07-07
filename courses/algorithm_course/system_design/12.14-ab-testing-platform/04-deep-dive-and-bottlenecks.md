# 04 — Deep Dives & Bottlenecks: A/B Testing Platform

## Deep Dive 1: Assignment Engine

### Ruleset Compilation and Distribution

The assignment engine's central challenge is reconciling two requirements: assignments must be deterministic and fast (sub-millisecond), but experiments are constantly being created, modified, started, and stopped. The solution is a **compiled ruleset** — a snapshot of all active experiment configurations expressed as an immutable, versioned document that SDKs can evaluate without network I/O.

The Ruleset Manager compiles a new document whenever experiment configuration changes. The document contains:
- All active experiments (ID, salt, traffic fraction, targeting predicates, variant definitions)
- Layer assignments (which experiments are in which mutual-exclusion namespace)
- SDK-evaluable targeting expressions (encoded as a simple predicate tree, not arbitrary code)

The compiled ruleset is stored in object storage and distributed via a content delivery network. SDK clients poll for the latest version every 30–60 seconds (with jitter to prevent thundering herds). The version key is a content hash; unchanged rulesets produce no bandwidth cost due to 304 Not Modified responses.

```
Ruleset document structure:
{
    version: "sha256:abc123...",
    generated_at: timestamp,
    layers: [
        {
            layer_id: UUID,
            layer_salt: string,
            experiments: [
                {
                    experiment_id: UUID,
                    experiment_salt: string,
                    traffic_fraction: 0.20,
                    targeting_rules: [...],
                    variants: [
                        { variant_id, ordinal, weight, flag_overrides }
                    ]
                }
            ]
        }
    ]
}
```

### Hash Function Selection

The hash function must be:
1. **Uniform:** all buckets receive equal probability
2. **Deterministic:** same input always maps to same output
3. **Independent across experiments:** small change in experiment_id or salt produces completely different bucket assignment (avalanche effect)
4. **Fast:** hash millions of times per second on commodity hardware

MD5 and SHA-256 both satisfy these requirements, but SHA-256 provides stronger independence guarantees. The salt per experiment ensures that two experiments testing the same user produce uncorrelated bucket assignments — critical for experiment isolation even within a shared layer.

### Targeting Rule Evaluation

Targeting rules filter which users are eligible for an experiment. They are evaluated before the hash, so ineligible users never enter the traffic pool:

```
TargetingRule evaluation order (short-circuit on first false):
1. User attribute matches (country IN ["US", "CA"], platform = "ios")
2. Cohort membership (user.created_at > experiment.started_at - 30d)
3. Custom properties (user.subscription_tier = "premium")
4. Holdout exclusion (user not in global holdback group)
```

Rules are expressed as a predicate tree with AND/OR/NOT operators and comparison leaves. The SDK evaluates them against a snapshot of user attributes provided at assignment call time. Targeting attributes are not fetched by the SDK — the caller must supply them.

### Sticky Assignment Guarantee

The deterministic hash guarantees stickiness: the same `(entity_id, experiment_id, salt)` always produces the same bucket. No session state or database lookup is required. This is the core insight of hash-based assignment — stickiness is a mathematical property of the function, not a stored fact.

One subtle failure mode: if the experiment's `traffic_fraction` changes (say, from 10% to 20%) midway through the experiment, users in buckets 1000–1999 will be newly assigned to treatment. This creates a contaminated cohort (they experienced the product without the treatment first). The platform guards against this by:
- Warning when traffic fraction increases after experiment start
- Optionally preventing such changes once the experiment has been running for > 24 hours
- Never reducing traffic fraction (that would eject users from treatment, creating survivorship bias)

---

## Deep Dive 2: Statistical Engine

### Metric Pipeline Architecture

The statistical engine receives pre-aggregated per-user metric values from the batch aggregator. It does not operate on raw event streams — this separation is important for correctness, because the stats engine needs a stable snapshot to avoid computing on partially-received data.

```
Statistical engine processing per experiment per metric:

1. Ingest per-user observations: { entity_id, variant_id, metric_value }
2. Apply outlier winsorization: cap values at p99.5 to reduce noise from outliers
3. Compute sufficient statistics per variant: { n, sum, sum_sq, mean, variance }
4. If CUPED enabled: apply covariate adjustment (see Algorithm 2 in document 03)
5. Run primary statistical test (z-test or t-test based on metric type)
6. Compute confidence intervals and effect sizes
7. If analysis_mode = sequential: compute mSPRT always-valid p-value
8. If analysis_mode = bayesian: update Beta/Normal-Normal posterior
9. Evaluate significance and guardrail status
10. Write results to Results Store
```

### Frequentist Analysis Details

**Continuous metrics (mean):** Welch's t-test (does not assume equal variances). For large samples (n > 1000), the z-approximation is used.

**Binary metrics (conversion rate):** Two-proportion z-test. Chi-squared test for multi-variant experiments (> 2 variants).

**Ratio metrics (revenue per page view):** Delta method to approximate variance of a ratio. The delta method accounts for correlation between numerator and denominator.

**Quantile metrics (p95 latency, p50 revenue):** Bootstrap resampling (1000 samples) or the Hodges-Lehmann estimator. These are reserved for the batch path due to computational cost.

### CUPED Implementation Nuances

CUPED works best when the covariate has high correlation with the outcome metric (ρ > 0.5). If correlation is low, the variance reduction is minimal and can actually add noise. The platform:
- Computes ρ for each metric and reports it to analysts
- Skips CUPED when |ρ| < 0.2 (negligible benefit)
- Applies CUPED independently to each variant (not pooled) to avoid bias

A more advanced variant, **CUPAC** (Controlled Using Pre-treatment Assigned Control), uses a machine learning model trained on pre-experiment data to predict user outcomes, then uses model predictions as covariates. This can achieve variance reductions of 50–70% for behavioral metrics with strong temporal autocorrelation.

### Bayesian Analysis Details

For binary metrics, the platform uses a **Beta-Binomial conjugate model**:
- Prior: `Beta(1, 1)` (uninformative uniform prior)
- After observing `s` successes in `n` trials: Posterior `Beta(1+s, 1+n-s)`
- Key outputs: `P(treatment > control)`, expected loss of choosing treatment if control is actually better

For continuous metrics, the platform uses a **Normal-Normal conjugate model** with a weakly informative prior calibrated to the pre-experiment metric distribution.

Bayesian results are displayed alongside frequentist results, not as replacements. The Bayesian `P(treatment > control)` is intuitive for stakeholders and does not require understanding of p-values, but the platform is clear that it is not a substitute for the frequentist Type I error guarantee.

### Multiple Metrics Correction

When an experiment defines 10+ metrics, the probability of at least one spurious significant result approaches 40% under independent testing (multiple comparisons problem). The platform applies **Benjamini-Hochberg False Discovery Rate (FDR) correction** to secondary metrics (not the primary pre-registered metric). The primary metric uses uncorrected p-values because it was pre-registered before the experiment started.

---

## Deep Dive 3: Event Ingest Pipeline

### Idempotency and Exactly-Once Semantics

Event delivery is at-least-once (SDKs retry on failure), but metric computation requires exactly-once counting. The deduplication strategy:

1. Each event carries a client-generated `event_id` (UUID).
2. The Event Processor maintains a **dedup window** in a distributed cache: for each event_id, record receipt timestamp with TTL of 7 days.
3. On receipt, check the dedup cache. If event_id present, drop the event. If absent, insert and process.
4. The dedup cache uses a Bloom filter for fast negative checks (95% of events are not duplicates), with an exact hash map fallback for the 5% that are.

This approach reduces dedup overhead to ~2 cache lookups per event (Bloom filter read + conditional hash map write), keeping the Event Processor on the hot path.

### Backpressure and Ordering

Events flow from SDK → Event Gateway → Message Queue → Event Processor. The message queue is the system's buffer against ingest spikes. Partitioning is by `entity_id` to ensure that all events for a given user arrive at the same processor shard, enabling per-user aggregation without distributed coordination.

The event pipeline is **not ordered** by event timestamp within a partition — events may arrive out of order due to SDK retry batching. The metric computation handles this by aggregating over time windows with a configured **watermark lag** (events arriving up to 5 minutes late are included; later arrivals trigger a recomputation job).

### Schema Evolution

Event schemas evolve continuously as products add new properties. The pipeline uses a **schema registry** where each event type has a versioned schema. The Event Gateway validates inbound events against the registered schema, rejects events with unknown fields (strict mode, opt-in) or silently drops unknown fields (lenient mode, default). Schema changes go through a review process to prevent breaking downstream metric definitions.

---

## Deep Dive 4: Experiment Interaction Detection

### Why Interactions Are Dangerous

Two experiments running concurrently may interact even when assigned to separate layers if they affect the same downstream behavior. Example: Experiment A tests a faster checkout animation (layer 1); Experiment B tests a checkout coupon offer (layer 2). A user in treatment A and treatment B may exhibit a synergistic response — they complete checkout faster *and* with a coupon, boosting conversion well beyond what either experiment alone would predict. This makes both experiments' effect estimates wrong.

### Mutual Exclusion via Layering

The primary defense is **mandatory layer assignment**. Experiments within a layer use the same namespace hash, ensuring each user appears in at most one experiment per layer. Experiments in different layers operate on independent namespaces and may coincide on the same user.

Layer design guidance:
- Put experiments testing the same surface (checkout page) in the same layer
- Put experiments testing independent surfaces (checkout vs. homepage) in different layers
- Use a global holdback layer with a permanently excluded 5% of users to measure cumulative platform-level effects

### Statistical Interaction Detection

For experiments in different layers that share users, the platform can detect statistical interactions retroactively:

```
Interaction detection algorithm:
1. Identify pairs of concurrent experiments (A, B) that share eligible users
2. Segment users into 4 groups: (A_control ∩ B_control), (A_treat ∩ B_control),
   (A_control ∩ B_treat), (A_treat ∩ B_treat)
3. Compute metric values for each group
4. Test for interaction effect:
   Interaction = (metric[A_treat ∩ B_treat] - metric[A_control ∩ B_treat])
               - (metric[A_treat ∩ B_control] - metric[A_control ∩ B_control])
5. If |Interaction| / SE(Interaction) > z_alpha, flag as potential interaction
```

This 2×2 factorial analysis is computationally expensive for O(N²) experiment pairs. The platform runs it lazily for experiments that product owners flag as potentially related, not for all pairs.

---

## Race Conditions and Edge Cases

### Assignment Before Experiment Starts

SDKs cache the ruleset with up to 60-second staleness. If an experiment starts at T=0 and a user requests assignment at T=15s, their SDK may not yet have the updated ruleset and will see no experiment. The assignment log will reflect this — no assignment for this user. This is acceptable because the experiment start event and assignment log timestamps allow precise identification of the "ramping up" period, which can be excluded from analysis.

### Traffic Fraction Reduction Mid-Experiment

Reducing traffic fraction mid-experiment ejects users from treatment. These users' pre-ejection data is included in the metric computation but their post-ejection data is not. This creates **survivorship bias**: the remaining treatment users are not a representative sample of the original cohort. The platform blocks traffic fraction reduction after experiment start, or requires analyst acknowledgment that results will be invalidated.

### Clock Skew Between SDKs and Servers

Events generated by the SDK carry a client-generated timestamp. Client clocks can be wrong by minutes or even hours. The platform stores both `client_timestamp` and `server_received_at`, and uses `server_received_at` for watermark-based windowing in metric computation. Client timestamps are used only for ordering within a user session.

---

## Slowest part of the process Analysis

| Slowest part of the process | Manifestation | Mitigation |
|---|---|---|
| Assignment service under cold-start | First request before SDK cache warms up takes full round trip | Pre-warm SDK on app startup; serve stale cache during fetch |
| Event gateway fan-out | Single gateway node at 300K events/sec saturates NIC | Horizontal shard behind load balancer; auto-scale on queue depth |
| Dedup cache at high event volume | 300K lookups/sec exceeds single cache node throughput | Shard dedup cache by hash(event_id) % N_shards |
| Batch aggregator reprocessing | 90-day event log reprocessing for new metric definition takes hours | Incremental computation; store intermediate checkpoints |
| Statistical engine for large experiments | Computing CUPED for experiment with 10M users takes minutes | Sampling-based variance estimation for large N |
| Ruleset compilation latency | Frequent experiment changes trigger recompilation; each takes ~5s | Incremental patch diffs; debounce rapid changes with 10s window |

---

## Deep Dive 5: Multi-Armed Bandit Mode

### When Bandits Beat A/B Tests

Standard A/B tests allocate traffic equally between variants for the experiment's duration, then pick the winner at the end. During this period, inferior variants continue receiving traffic — this "exploration cost" is the price of statistical precision. Multi-armed bandits reduce this cost by adaptively shifting traffic toward better-performing variants during the experiment.

Bandits are appropriate when:
- The metric of interest is a short-term metric (conversion rate, click-through) observable within the same session
- The cost of serving a bad variant is high (each bad variant impression represents lost revenue)
- The experimenter values maximizing total conversions during the experiment, not just learning which variant is best

Bandits are inappropriate when:
- The primary metric has long feedback delays (30-day retention, lifetime value)
- Statistical rigor is paramount (compliance, medical devices)
- The number of variants is small (2) and the experiment is short — the exploration savings are negligible

### Regret Analysis

```
Regret = (optimal_conversion_rate × total_traffic) - (actual_conversions)

For a standard 50/50 A/B test with treatment uplift of δ:
  Expected regret per impression = δ / 2
  Total regret = N × δ / 2

For Thompson Sampling:
  Expected regret scales as O(sqrt(N × K × log(N)))
  where K = number of variants, N = total impressions

At N = 1,000,000 impressions, δ = 2%, K = 3:
  A/B test regret: ~10,000 conversions "lost" to inferior variants
  Thompson Sampling regret: ~2,000 conversions "lost"

Improvement: ~80% regret reduction for this scenario
```

### Implementation Challenges

**Delayed conversions**: Thompson Sampling updates the posterior after each observation. If conversions happen hours after exposure, the bandit is making allocation decisions based on incomplete data. Mitigation: use an attribution window (count only conversions within 1 hour of exposure) and accept that the bandit optimizes the attributed metric, not the true long-term metric.

**Non-stationarity**: User behavior changes over time (day-of-week effects, seasonal trends). A bandit that converges to an "optimal" arm based on weekday data may be wrong on weekends. Mitigation: use a discounted Thompson Sampling variant that weights recent observations more heavily, or reset the posterior weekly.

**Small sample instability**: With few observations, the posterior is wide and Thompson Sampling will sample extreme values frequently, causing rapid traffic oscillation between arms. Mitigation: enforce the epsilon-greedy floor (minimum 5% traffic per arm regardless of posterior) and require a minimum observation window (e.g., 1,000 observations per arm) before starting adaptive allocation.

---

## Deep Dive 6: Novelty Effect Detection

### The Problem

When a product change is deployed to users who have never seen it, they may behave differently because the change is *new*, not because it is *better*. A new button color gets more clicks because it stands out, not because the color is inherently better. After habituation, the effect may disappear entirely. If the experiment is stopped during the novelty period, the conclusion is wrong.

### Detection Method

```
FUNCTION detectNoveltyEffect(experiment_id, metric_id):
  // Compare effect size in early vs. late experiment period
  day_1_3_effect = computeEffectSize(experiment_id, metric_id, day_range=[1, 3])
  day_7_14_effect = computeEffectSize(experiment_id, metric_id, day_range=[7, 14])

  // Compute ratio
  novelty_ratio = day_1_3_effect / day_7_14_effect

  IF novelty_ratio > 2.0:
    // Early effect is more than 2× the late effect → likely novelty
    RETURN NoveltyWarning(
      message = "Effect decayed by " + (1 - 1/novelty_ratio) × 100 + "% from day 1-3 to day 7-14",
      recommendation = "Extend experiment to 21+ days to measure steady-state effect"
    )

  IF day_7_14_effect is not significant AND day_1_3_effect is significant:
    RETURN NoveltyWarning(
      message = "Early significance not sustained in steady-state period",
      recommendation = "Treatment effect may be entirely due to novelty"
    )

  RETURN NoNoveltyDetected()
```

The platform displays novelty analysis on the results dashboard whenever an experiment has > 7 days of data and the early/late effect sizes diverge significantly.

---

## Real-World Case Studies

### Case Study 1: E-Commerce Platform — 500M Users, 8,000 Concurrent Experiments

**Context:** A global e-commerce platform running 8,000 concurrent experiments across search, product pages, checkout, and recommendations.

**Key architectural decisions:**
- **Layer per product surface:** 15 layers, each owning a product surface (search results, product detail page, cart, checkout, post-purchase). Experiments within a surface are mutually exclusive. Cross-surface experiments (testing a change that affects both search and product pages) require a dedicated "cross-surface" layer with reduced traffic.
- **Revenue guardrails per experiment:** Every experiment that touches a conversion-path page has an automated revenue guardrail. A 0.5% drop in revenue-per-session triggers automatic kill-switch within 15 minutes. This makes launching experiments at 20% traffic safe enough that product managers launch without engineering approval.
- **CUPED as default:** Pre-experiment purchase behavior is the covariate for all revenue metrics. Average variance reduction: 45%. This cuts the time-to-significance from 14 days to 8 days for a typical experiment, enabling teams to run 75% more experiments per quarter.

**Lesson:** The platform's value is measured not in individual experiment results but in the velocity it enables. A platform that lets 300 teams run experiments independently, with automated safety, generates more organizational value than one that runs a few experiments with perfect statistical rigor.

### Case Study 2: Social Media Platform — Network Effects Challenge

**Context:** A social platform where users interact with each other's content, violating the Stable Unit Treatment Value Assumption (SUTVA) that A/B tests assume.

**Key architectural decisions:**
- **Cluster-randomized experiments:** Instead of randomizing individual users, the platform randomizes clusters (friend groups, geographic communities) to contain network spillover effects within clusters. The statistical engine uses cluster-robust standard errors instead of individual-level variance.
- **Ego-network isolation check:** Before starting a social-feature experiment, the platform estimates the fraction of treatment users who have > 50% of their friends also in treatment. If this fraction is < 80%, the experiment is flagged for potential spillover contamination.
- **Shadow metric comparison:** For every social experiment, the platform computes treatment effects both with and without network-adjacent users excluded. If the effect sizes differ by > 30%, the experiment is flagged for potential network effect bias.

**Lesson:** Standard A/B testing assumptions (independence between units) break in social and marketplace platforms. The platform must provide cluster randomization, spillover detection, and shadow metric analysis to produce valid causal estimates in networked environments.

### Case Study 3: SaaS Platform — Account-Level Experimentation

**Context:** A B2B SaaS product where the experiment unit is an account (organization), not an individual user. 50,000 active accounts; experiments test pricing, features, and workflows.

**Key architectural decisions:**
- **Account-level assignment:** entity_type = "org" ensures all users within an account see the same variant. This prevents the confusing experience of two users in the same company seeing different product versions.
- **Small-sample statistical methods:** With 50,000 accounts (not 500M users), many experiments have only a few thousand observations per variant. The platform uses exact tests (permutation tests) instead of asymptotic z-tests, and Bayesian analysis (where small-sample posteriors are naturally cautious) as the default analysis mode.
- **Revenue metric sensitivity:** B2B revenue metrics are extremely heavy-tailed (one enterprise account may represent 1000× the revenue of a small account). The platform applies aggressive winsorization (cap at p99) and uses log-transformed metrics to reduce variance from outlier accounts.

**Lesson:** B2B experimentation requires different statistical defaults than consumer experimentation. Small sample sizes, heavy tails, and account-level randomization demand exact tests, Bayesian analysis, and aggressive outlier handling.

---

## Performance Optimization Patterns

### Pattern 1: Incremental Batch Aggregation

The batch aggregator processes 8.55B events/day across 10,000 experiments. Reprocessing all events from scratch every hour would require scanning the entire 90-day event log — infeasible at this scale.

```
Incremental aggregation strategy:
1. Maintain per-(experiment, variant, metric) checkpoint: { last_processed_offset, partial_aggregates }
2. Each batch run starts from the checkpoint offset, not from the beginning
3. New events are merged into existing partial aggregates
4. Only when a metric definition changes is a full recomputation triggered (rare)

Cost savings:
  Full recomputation: scan 115 TB × 200 workers = ~90 minutes
  Incremental update: scan 1 hour of new data (~5 TB) × 200 workers = ~4 minutes
  22× faster; enables sub-15-minute batch freshness
```

### Pattern 2: Sampling for Statistical Estimation

For experiments with > 10M users, computing exact CUPED adjustment requires fetching and processing pre-experiment data for all users. This is expensive. The platform supports **stratified sampling**:

- For experiments with > 1M users per variant: sample 500K users per variant (stratified by key dimensions: country, platform)
- CUPED adjustment computed on the sample
- Confidence intervals widened by the sampling factor (but the sample is large enough that widening is negligible)
- Full computation runs in a background job and overwrites the sampled estimate when complete

### Pattern 3: Result Caching and Pre-Computation

The Results Store caches pre-computed statistical results keyed by `(experiment_id, metric_id, analysis_type, segment_dimension, computed_at)`. Dashboard queries hit the cache directly; they never trigger live computation.

Cache invalidation:
- Streaming: invalidate when streaming aggregator emits a new estimate
- Batch: invalidate when batch aggregator completes a new run
- Config change: invalidate when metric definition is updated

---

## Deep Dive 7: Segment Analysis and Heterogeneous Treatment Effects

### Why Overall Averages Can Be Misleading

An experiment may show no significant overall effect but have strongly positive effects for one user segment and strongly negative effects for another. These cancel out in the overall average, masking a real treatment interaction. Segment analysis decomposes the overall effect by dimensions (country, platform, user cohort, subscription tier) to detect these heterogeneous treatment effects.

### Segment Analysis Implementation

```
FUNCTION computeSegmentAnalysis(experiment_id, metric_id, segment_dimension):
  // Get all unique values for the segment dimension
  segments = get_distinct_values(segment_dimension, experiment_id)

  results = []
  FOR EACH segment_value IN segments:
    // Filter users to this segment
    control_data = get_metric_values(experiment_id, CONTROL, metric_id,
                                     filter={segment_dimension: segment_value})
    treatment_data = get_metric_values(experiment_id, TREATMENT, metric_id,
                                       filter={segment_dimension: segment_value})

    // Skip segments with insufficient sample size
    IF len(control_data) < MIN_SEGMENT_SIZE OR len(treatment_data) < MIN_SEGMENT_SIZE:
      CONTINUE  // k-anonymity: suppress segments < 1000 users

    // Compute segment-level statistical result
    result = compute_statistical_test(control_data, treatment_data)
    result.segment_dimension = segment_dimension
    result.segment_value = segment_value
    results.append(result)

  // Apply FDR correction across segments (Benjamini-Hochberg)
  corrected_results = benjamini_hochberg_correction(results)

  RETURN corrected_results
```

### Segment Analysis Caveats

- **Multiple comparisons**: With 50 countries and 5 platforms, there are 250 segments. At α = 0.05, ~12 will be significant by chance. FDR correction is mandatory.
- **Simpson's paradox**: If segment composition differs between treatment and control (due to SRM or targeting), segment-level effects can reverse the overall effect direction. Always check SRM per segment.
- **Ecological fallacy**: A segment-level effect does not necessarily apply to individual users within that segment. Segment analysis identifies populations for further investigation, not individual-level predictions.

---

## Deep Dive 8: Pricing Experiment Statistical Considerations

### Price Sensitivity Analysis

Pricing experiments have unique statistical requirements because price is not a binary treatment — it is a continuous variable with a non-linear response curve.

**Discrete price points**: Most pricing experiments test 2-5 specific price points (e.g., $9.99, $12.99, $14.99). Each price point is a variant. The analysis tests: (a) which price maximizes revenue (price × conversion rate), and (b) whether the price-revenue curve has a clear optimum.

**Revenue-optimal price estimation**: The platform fits a log-linear demand model to the observed (price, conversion_rate) data points and estimates the revenue-maximizing price. This requires at least 3 price points to identify curvature.

```
Revenue at price P = P × conversion_rate(P)

If conversion_rate(P) = a × exp(-b × P):
  Revenue(P) = P × a × exp(-b × P)
  Optimal P = 1/b  (derivative = 0)

At 3+ price points, fit (a, b) via maximum likelihood
Report: optimal price estimate with 95% CI
```

### Long-Term Price Effects

A short-term pricing experiment may show that a higher price reduces conversion but the users who do convert have higher lifetime value (they are less price-sensitive). The platform supports **post-experiment cohort tracking**: users assigned to each price variant are tracked for 90 days post-experiment to measure LTV, retention, and support ticket volume. This delayed metric analysis uses the same event log infrastructure, applied to a different time window.

---

## Race Conditions in Experiment Configuration

### Concurrent Experiment Stop and Event Processing

When an experiment is stopped at time T, events generated before T but arriving after T (due to SDK buffering and network latency) must still be included in the final metric computation. The system handles this by:

1. Setting `experiment.stopped_at = T` in the config store
2. The event pipeline continues processing events with `event.timestamp ≤ T` for up to the watermark window (5 minutes)
3. The final batch aggregation uses `stopped_at` as the cutoff, not the time the stop command was issued
4. Events arriving after the watermark window are still processed if they have `timestamp ≤ T`; they update the batch aggregates but not the streaming estimates

### Ruleset Compilation Race

Multiple experiment configuration changes arriving within seconds can cause the Ruleset Manager to compile multiple ruleset versions in rapid succession. Each compilation takes ~5 seconds. Without debouncing, rapid changes create a queue of compilations that delay propagation:

```
Debounce strategy:
- Changes are queued in a 10-second debounce window
- After 10 seconds with no new changes, compilation runs once with all pending changes
- Emergency changes (guardrail kill-switch) bypass the debounce and trigger immediate compilation
- Maximum debounce: 30 seconds (even with continuous changes, compile at least every 30s)
```

### Assignment During Experiment Ramp-Up

When an experiment transitions from SCHEDULED to RUNNING, there is a 30-60 second window during which some SDK instances have the new ruleset (with the experiment) and others have the old ruleset (without it). During this window:

- Users visiting the site may or may not be evaluated for the experiment, depending on which SDK version they hit
- The assignment log records which ruleset version was used for each assignment
- The analysis pipeline can optionally exclude the first 60 seconds of data to avoid the ramp-up artifact
- This "soft start" is actually beneficial: it creates a natural canary window where only a fraction of traffic sees the experiment before full propagation

---

## Slowest part of the process: Large-Scale CUPED Computation

CUPED requires fetching pre-experiment metric data for every user in the experiment. For an experiment with 50M users and a 14-day pre-experiment window, this means:

```
Data volume: 50M users × 14 days × 5 metrics = 3.5B user-day-metric values
At 50 bytes per value: ~175 GB per experiment

Compute: For each user, compute Cov(Y, X) contribution → O(N) per metric
Total: 5 metrics × 50M users × 10 operations ≈ 2.5B operations

Without optimization: ~25 minutes per experiment at 100M ops/sec
With optimization:
  - Pre-computed covariate summaries (X_mean, X_variance per user): reduces to O(1) per user
  - Distributed across 200 workers: ~7.5 seconds per experiment
  - Incremental update (only new users since last batch): ~1 second per experiment
```

The incremental CUPED strategy makes even 50M-user experiments tractable within the 90-minute batch window.
