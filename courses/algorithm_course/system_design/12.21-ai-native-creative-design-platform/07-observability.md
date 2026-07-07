# 12.21 AI-Native Creative Design Platform — Observability

## Observability Philosophy

The creative design platform has four distinct observability audiences with different needs:

1. **Engineering teams**: Generation latency, GPU utilization, error rates, pipeline throughput, infrastructure health
2. **ML teams**: Model quality metrics, generation success rates, safety filter accuracy, cache hit rates
3. **Product teams**: User engagement with AI features, generation-to-edit ratios, template conversion, collaboration adoption
4. **Finance/operations**: GPU cost per generation, cost per active user, infrastructure cost allocation

Each audience requires purpose-built metrics and dashboards. Raw GPU utilization is necessary but insufficient—the system must emit semantic metrics from within the generation pipeline (e.g., "brand violation rate per model version") that cannot be inferred from infrastructure counters alone.

---

## Key Metrics

### AI Generation Quality Metrics (ML)

| Metric | Description | Alert Threshold |
|---|---|---|
| **Generation success rate** | % of generation requests that complete without error or safety block | < 95% → model or infrastructure issue |
| **Brand violation rate** | % of generated designs with at least one brand constraint violation (before correction) | > 30% → model conditioning quality degradation |
| **Content safety block rate** | % of generated images blocked by safety classifier | > 5% → prompt classifier may be passing unsafe prompts; or model producing more unsafe content |
| **Safety false positive rate** | % of safety-blocked images confirmed safe by human review | > 2% → safety model retraining needed |
| **Generation cache hit rate** | % of generation requests served from cache | < 10% → cache key strategy review |
| **Layout overlap score** | Average overlap area between elements in generated layouts | > 5% overlap area → layout model quality regression |
| **User regeneration rate** | % of AI generations followed by immediate regeneration (same prompt, new seed) | > 40% → generation quality not meeting user expectations |
| **User edit-after-generation ratio** | Average number of manual edits users make to AI-generated designs before publishing | Track trend; sudden increase indicates model quality regression |
| **Brand enforcement correction count** | Average corrections applied by brand enforcer per generation | > 5 corrections → model not learning brand conditioning effectively |

### Generation Pipeline Performance (Engineering)

| Metric | Description | Alert Threshold |
|---|---|---|
| **Text-to-design e2e p95 latency** | End-to-end generation latency including all subtasks | > 5 s (SLO breach) |
| **Image generation p95 latency** | Diffusion model inference time only | > 3.5 s (consumes too much latency budget) |
| **Layout generation p95 latency** | Layout transformer inference time | > 800 ms |
| **Prompt interpretation p95 latency** | LLM intent extraction time | > 600 ms |
| **Brand validation p99 latency** | Deterministic rule engine execution time | > 200 ms |
| **GPU queue depth** | Number of generation requests waiting for GPU allocation | > 500 → capacity issue; scale GPU pool |
| **GPU utilization** | Average GPU compute utilization across fleet | < 50% → over-provisioned (cost waste); > 85% → under-provisioned (latency risk) |
| **Generation job failure rate** | % of generation jobs that fail (all subtask retries exhausted) | > 2% → investigate; likely GPU health or model issue |

### Collaboration Metrics (Engineering)

| Metric | Description | Alert Threshold |
|---|---|---|
| **Collaboration sync latency p95** | Time from operation submission to all participants receiving update | > 100 ms (SLO breach) |
| **CRDT merge conflict rate** | % of operations requiring conflict resolution (human-human or human-AI) | > 5% → investigate; high conflict rate indicates UX or AI timing issues |
| **WebSocket disconnection rate** | % of active sessions experiencing disconnection per hour | > 1% → network or CRDT engine health issue |
| **Session recovery time p95** | Time to rebuild session state after WebSocket reconnection | > 2 s → checkpoint frequency or state size issue |
| **AI-human spatial conflict rate** | % of AI generation operations with spatial conflicts against concurrent human edits | > 10% → improve presence-aware generation; extend soft-lock zone |

### User Engagement Metrics (Product)

| Metric | Description | Alert Threshold |
|---|---|---|
| **AI generation adoption rate** | % of active users who use AI generation features per month | Track trend; used for feature investment decisions |
| **Generation-to-publish ratio** | % of AI-generated designs that are exported or published | < 20% → generation quality not useful enough for production use |
| **Template conversion rate** | % of template browsing sessions that result in a design being created from template | < 15% → template discovery or quality issue |
| **Brand kit activation rate** | % of enterprise designs with an active brand kit | < 50% in enterprise → brand kit onboarding or usability issue |
| **Magic resize usage** | % of designs that are resized to at least 2 additional formats | Tracks multi-format content creation adoption |

### Cost Metrics (Finance)

| Metric | Description | Alert Threshold |
|---|---|---|
| **GPU cost per generation** | Dollar cost per AI generation request (blended across all generation types) | > $0.008 → optimization review needed |
| **GPU cost per monthly active user** | Total GPU cost / MAU | > $0.15 → cost model unsustainable for free-tier users |
| **Cache savings ratio** | GPU cost avoided due to cache hits / total potential GPU cost | < 10% → cache strategy review |
| **Storage cost per user** | Total storage cost / active users | Track trend; alert on > 20% month-over-month increase |

---

## Distributed Tracing

Every generation request receives a trace_id at the API gateway. This trace propagates through all pipeline stages:

```
Trace propagation:
  User triggers generation → trace_id generated at API gateway
  ↓
  Generation orchestrator → trace_id in orchestration context
    ↓ prompt interpretation → trace_id in LLM inference request
    ↓ layout generation → trace_id in transformer inference request
    ↓ image generation → trace_id in diffusion inference request (per image)
    ↓ text generation → trace_id in LLM inference request
    ↓ brand validation → trace_id in validation context
    ↓ content safety → trace_id in classifier request
    ↓ CRDT merge → trace_id in collaboration operation
  ↓
  Client render → trace_id available for client-side performance tracking

Use cases:
  - Debug slow generation: trace shows which subtask consumed the most latency
    (image generation 3,200 ms vs. typical 2,500 ms → GPU contention identified)
  - Investigate safety false positive: trace links blocked image to specific prompt,
    model version, and safety classifier confidence score
  - Track brand violation: trace shows which model output violated which brand rule,
    and whether the enforcer's correction was applied or failed
  - Cost attribution: trace includes GPU-seconds consumed per subtask;
    aggregate by user/workspace for cost allocation
```

---

## Alerting and On-Call Design

### Alert Tiers

| Tier | Condition | Response |
|---|---|---|
| **SEV-1 (Page immediately)** | Content safety classifier unavailable (all AI generation must stop); design document store write failure; collaboration service total failure | On-call engineer paged immediately; content safety → all generation blocked until service restored |
| **SEV-2 (Page within 15 min)** | Generation p95 latency > 8 s; GPU pool utilization > 90% sustained; export renderer backlog > 10,000 jobs; WebSocket disconnection rate > 5% | On-call engineer paged; GPU auto-scaling triggered |
| **SEV-3 (Alert in business hours)** | Brand violation rate > 30%; safety false positive rate > 2%; generation cache hit rate < 5%; user regeneration rate > 50% | ML engineer notified next business day; model quality review |
| **SEV-4 (Weekly digest)** | GPU cost per generation trending up; storage growth exceeding projections; template conversion rate declining; collaboration adoption trending down | Product + engineering leadership weekly report |

### On-Call Rotation Structure

```
On-call rotations:
  1. Infrastructure on-call: GPU fleet, document store, asset pipeline, networking
     Scope: hardware failures, capacity issues, networking outages
     Rotation: weekly, 2-person team (primary + secondary)

  2. AI/ML on-call: generation pipeline, safety classifiers, model serving
     Scope: model quality regressions, safety incidents, GPU inference failures
     Rotation: weekly, 2-person team (ML engineer + platform engineer)

  3. Content safety on-call: escalated safety reviews, policy violations
     Scope: safety false negatives (unsafe content displayed), DMCA takedowns, policy updates
     Rotation: daily, trust & safety team member

  Escalation path:
    Automated alert → primary on-call → secondary on-call → engineering manager → VP Engineering
    Safety incidents: parallel notification to legal team and trust & safety lead
```

---

## Dashboards

### Generation Pipeline Dashboard

```
Panels:
  [1] Generation request rate (requests/sec, 1-min resolution, by generation type)
  [2] Generation latency heatmap (p50/p95/p99, by subtask: prompt/layout/image/text/brand)
  [3] GPU pool utilization (% utilization per pool: image/layout/safety)
  [4] GPU queue depth (waiting requests per pool, 1-min resolution)
  [5] Generation success rate (%, with breakdown: success/safety-blocked/error/timeout)
  [6] Cache hit rate (%, 15-min resolution)
  [7] Active model versions (table: service, model version, traffic %, deployed_at)
  [8] Generation cost ($/hour, broken down by model type)
```

### Content Safety Dashboard

```
Panels:
  [1] Safety block rate by category (NSFW, violence, copyright, deepfake — stacked bar, daily)
  [2] False positive rate (confirmed-safe blocks / total blocks, weekly trend)
  [3] Prompt classifier confidence distribution (histogram, daily snapshot)
  [4] Human review queue depth and review SLA compliance (% reviewed within 4h/24h)
  [5] DMCA takedown requests (count per week, resolution time)
  [6] Adversarial prompt detection rate (count of detected prompt injection attempts)
```

### Collaboration Health Dashboard

```
Panels:
  [1] Active collaborative sessions (count, 5-min resolution)
  [2] Sync latency p50/p95/p99 (line chart, 1-min resolution)
  [3] CRDT merge conflict rate (%, by conflict type: spatial/deletion/style)
  [4] WebSocket disconnection rate (%, per region)
  [5] AI-human conflict rate (%, 1-hour resolution)
  [6] Session recovery time distribution (histogram, daily)
```

### Business Metrics Dashboard

```
Panels:
  [1] AI generation adoption funnel: MAU → AI users → published AI designs (monthly)
  [2] Generation-to-publish ratio (%, by generation type, weekly trend)
  [3] User regeneration rate (%, weekly — lower is better)
  [4] Brand kit activation rate by enterprise customer (table, monthly)
  [5] GPU cost per MAU ($/user, monthly trend)
  [6] Top template categories by generation volume (bar chart, weekly)
```

---

## Model Monitoring and Quality Tracking

### Generation Quality Drift Detection

```
Process:
  Daily job: sample 10,000 generated designs from production
  Compute:
    - Layout quality score: overlap %, whitespace balance, hierarchy compliance
    - Image quality score: FID (Fréchet Inception Distance) against reference set
    - Brand compliance rate: % passing brand validation on first attempt
    - User satisfaction proxy: regeneration rate for sampled designs

  Thresholds:
    FID increase > 10% from baseline → model quality regression alert
    Layout overlap > 5% → layout model review
    Brand compliance < 70% → conditioning pipeline review
    Regeneration rate > 40% → user experience degradation alert

  Baseline:
    Established at each model version deployment
    Refreshed quarterly with new reference sets
```

### A/B Testing Framework for Model Versions

```
Framework:
  When deploying a new model version:
    1. Route 5% of generation traffic to new model (canary)
    2. Compare metrics against stable model:
       - Generation latency (must not regress > 10%)
       - User regeneration rate (must not increase > 5 percentage points)
       - Safety block rate (must not decrease — safety must not regress)
       - Brand violation rate (must not increase > 5 percentage points)
    3. After 7 days: if all metrics pass, promote to 50%; then 100% after 3 more days
    4. If any metric fails: auto-rollback to stable version; alert ML team

  Safety constraint: new model versions NEVER reduce safety thresholds
  Rollback latency: < 5 minutes (model version is a configuration flag, not a deployment)
```

---

## SLO Burn Rate Monitoring

```
Burn Rate Alerts (multi-window):
  Design Generation ≤ 5s p95 (99.9% target):
    Fast burn: > 14.4× rate for 5 min   → page immediately (exhausts budget in 1 hour)
    Slow burn: > 6× rate for 30 min      → page within 15 min
    Trend: > 1× rate for 72 hours         → SEV-3 (budget exhaustion by quarter end)

  Content Safety ≥ 99.99% catch rate:
    Any confirmed safety miss             → SEV-1 page immediately
    Miss rate > 0.005% for any 1-hour window → SEV-2
    Miss rate trending up over 7 days     → SEV-3 (model degradation)

  Collaboration Sync ≤ 100ms p95:
    p95 > 200ms for 5 min                → SEV-2 (collaboration unusable)
    p95 > 150ms for 30 min               → SEV-3 (degraded experience)

  GPU Cost Per Generation ≤ $0.005:
    Daily average > $0.006                → SEV-3 (cost overrun alert)
    Daily average > $0.008                → SEV-2 (investigate: cache miss spike? model regression?)
```

---

## Incident Playbooks

### Playbook 1: Generation Latency SLO Breach

**Trigger:** Design generation p95 exceeds 8s for > 5 minutes.

**Steps:**
1. **T+0:** Check GPU fleet utilization dashboard. If > 90% utilization → GPU capacity shortage → activate overflow routing to secondary region.
2. **T+2 min:** Check generation pipeline stage breakdown. Identify Slowest part of the process: prompt interpretation, layout, image generation, or brand validation?
3. **T+5 min:** If image generation is Slowest part of the process: check model serving latency, batch size efficiency, GPU memory pressure. If single model is slow → possible GPU hardware degradation → drain node.
4. **T+10 min:** If not resolved by capacity: enable aggressive progressive generation (show 2-step preview instead of 4-step); reduce diffusion steps for free-tier from 20 to 12.
5. **T+30 min:** If sustained → engage ML infrastructure team; consider temporary model downgrade (smaller, faster model version).

### Playbook 2: Content Safety Miss Escalation

**Trigger:** User reports unsafe AI-generated content; confirmed by human review.

**Steps:**
1. **T+0:** Remove content from CDN and all caches (content-addressed deletion by SHA-256 hash). User sees placeholder instead.
2. **T+15 min:** Analyze the generation: what prompt produced this? What model version? What was the safety classifier's confidence score? Was this a near-miss (confidence 0.48 on a 0.5 threshold) or a clear miss?
3. **T+30 min:** If near-miss: lower safety threshold by 0.05 for this content category. If clear miss: add the prompt pattern and the generated image embedding to the explicit block list.
4. **T+1 hour:** Scan all generations from the last 24 hours that used the same model version + similar prompt patterns. If additional misses found → escalate to Tier 2.
5. **T+4 hours:** Add the missed content as a negative example to safety classifier training set. Schedule safety classifier retrain.

### Playbook 3: CRDT Divergence Detected in Collaborative Session

**Trigger:** Client reports "edits not visible to collaborator" or CRDT integrity check detects vector clock inconsistency.

**Steps:**
1. **T+0:** Log session state: all connected clients, their vector clocks, and the server's authoritative state.
2. **T+1 min:** Identify which client(s) diverged. Compare client state hash against server state hash after replaying all known operations.
3. **T+2 min:** If a single client diverged: force-refresh that client's state from server (client re-fetches full scene graph). Other participants unaffected.
4. **T+5 min:** If multiple clients diverged: create a version checkpoint of the server state; force-refresh all clients; operations during the divergence window are replayed from the server's operation log.
5. **T+1 hour:** Root cause analysis: network partition? CRDT engine bug? Client-side caching issue? File incident for engineering review.

---

## Model Quality and Brand Compliance Dashboard

```
Panels:
  [1] Brand violation rate by type (color, typography, logo, imagery style — stacked bar, daily)
      Breakdown: first-pass violations (before correction) vs. unresolvable violations
      Target: < 30% first-pass, < 1% unresolvable

  [2] Layout quality metrics (daily trend):
      Overlap score: average % overlap between elements
      Whitespace balance: standard deviation of margin distribution
      Hierarchy compliance: % of designs where heading > body size

  [3] Image quality score distribution (histogram, daily):
      FID score of generated images against reference set
      Broken down by generation type (text-to-image, background, icon)

  [4] User satisfaction proxy (weekly trend):
      Regeneration rate: % of generations followed by same-prompt retry
      Edit-after-generation ratio: average edits before publish
      Progressive preview acceptance: % of users who accept 4-step preview

  [5] Design token resolution failures (count per day):
      Token not found: component references undefined token
      Contrast failure: resolved token pair fails WCAG AA contrast check
      Hierarchy conflict: component token overrides global in unexpected way
```

---

## Export Quality Dashboard

```
Panels:
  [1] Export volume by format (PNG, PDF, SVG, MP4 — stacked area, hourly)

  [2] Export render time distribution (p50/p95/p99 per format):
      PNG: target <5s
      PDF: target <15s (complex print-ready exports)
      SVG: target <3s
      MP4: target <30s per second of video

  [3] Export failure rate by format and failure type:
      Out-of-memory: scene graph too complex for renderer
      Font embedding failure: missing font file
      Color profile error: CMYK conversion failure
      Timeout: export exceeded maximum render time

  [4] Color accuracy in cross-format export:
      Sample of designs exported to both sRGB PNG and CMYK PDF
      Measure: average ΔE between corresponding colors across formats
      Target: ΔE < 3.0 for brand colors

  [5] Export queue depth and wait time (real-time):
      Total queue depth by priority tier
      Average wait time before render starts
      Renderer pool utilization (% busy)
```

---

## Cost Observability Dashboard

```
Panels:
  [1] GPU cost per generation (real-time):
      Time-series: hourly GPU cost per generation request, broken down by:
        - Full design generation vs. image-only generation
        - Free-tier vs. paid-tier
        - Model version
      Target line at $0.005; red zone above $0.008

  [2] Cache efficiency:
      Stacked bar: cache hit rate by type (exact match, semantic similarity, template)
      Line overlay: estimated GPU savings from caching ($)
      Trend: is cache hit rate improving or degrading?

  [3] Generation rejection and retry rate:
      Percentage of generations that users reject (regenerate with different prompt)
      Progressive preview acceptance rate (% accepting 4-step preview)
      Estimated GPU waste from rejected generations ($)

  [4] Cost by user tier:
      Pie chart: GPU cost distribution across free, pro, and enterprise tiers
      Revenue per generation by tier (to compute unit economics)
      Free-tier cost-to-serve ratio (GPU cost vs. estimated ad/conversion revenue)

  [5] Model efficiency comparison:
      Table: [model version, avg inference time, avg quality score, cost per generation]
      Highlight: which model versions are most cost-efficient at acceptable quality?

  [6] Capacity utilization:
      GPU fleet utilization by region (% busy, % idle, % in cool-down)
      Collaboration server utilization (active sessions / capacity)
      Export renderer utilization (queue depth, processing rate)
```

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
