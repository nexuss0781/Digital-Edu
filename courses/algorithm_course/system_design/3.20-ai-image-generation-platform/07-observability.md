# Observability

## Key Metrics

### Generation Metrics (Primary)

| Metric | Description | Target | Alert Threshold |
|--------|-------------|--------|-----------------|
| `generation_time_seconds` | E2E time from request to image URL | Turbo: <10s, Fast: <25s | >2x target |
| `queue_wait_seconds` | Time in queue before worker assignment | Turbo: <2s, Fast: <10s | >3x target |
| `model_load_seconds` | Time to load model (cold start) | <5s (warm), <30s (cold) | >30s |
| `diffusion_step_time_ms` | Time per denoising step | ~200ms | >500ms |
| `vae_decode_time_ms` | VAE decoding latency | <500ms | >1000ms |
| `safety_check_time_ms` | Post-gen safety latency | <200ms | >500ms |
| `cdn_upload_time_ms` | Image upload latency | <500ms | >2000ms |

### Queue Metrics

| Metric | Description | Target | Alert Threshold |
|--------|-------------|--------|-----------------|
| `queue_depth{tier}` | Requests waiting per tier | Turbo: <10, Fast: <50 | >5x target |
| `queue_oldest_seconds{tier}` | Age of oldest request | <SLO wait time | >SLO |
| `queue_starvation_events` | Requests exceeding max wait | 0 | >10/hour |
| `queue_throughput_per_second` | Requests processed/second | Match inbound | <50% inbound |

### GPU Metrics

| Metric | Description | Target | Alert Threshold |
|--------|-------------|--------|-----------------|
| `gpu_vram_utilization_percent` | GPU memory usage | 70-85% | >95% or <30% |
| `gpu_compute_utilization_percent` | SM active time | >60% | <30% (idle) |
| `gpu_temperature_celsius` | GPU temperature | <80°C | >85°C |
| `worker_pool_size{tier}` | Workers per tier | Per config | <minimum |
| `warm_pool_hit_rate` | Cache hit for model loading | >90% | <80% |
| `model_load_failures` | Failed model loads | 0 | >3/minute |

### Safety Metrics

| Metric | Description | Target | Alert Threshold |
|--------|-------------|--------|-----------------|
| `prompt_block_rate` | Pre-gen blocks / total | 1-3% | >5% |
| `image_block_rate` | Post-gen blocks / total | 1-3% | >10% |
| `csam_detection_count` | CSAM detections | 0 | >0 (immediate) |
| `safety_false_positive_reports` | User disputes | <1% | >3% |
| `safety_classifier_latency_ms` | Classification time | <150ms | >300ms |

### Business Metrics

| Metric | Description | Target | Alert Threshold |
|--------|-------------|--------|-----------------|
| `generations_per_minute` | Throughput | Per capacity | <70% capacity |
| `revenue_per_generation` | Monetization | Per model | Declining trend |
| `user_retry_rate` | Requests retried by users | <5% | >15% |
| `conversion_rate` | Free to paid | Tracking | Declining trend |

---

## Metric Definitions

### Prometheus/OpenTelemetry Format

```yaml
# Generation timing histogram
- name: generation_time_seconds
  type: histogram
  labels: [tier, model, scheduler, has_controlnet]
  buckets: [2, 5, 10, 15, 25, 40, 60, 120]
  description: "End-to-end generation time from request to image URL"

# Queue depth gauge
- name: queue_depth
  type: gauge
  labels: [tier, model_required]
  description: "Current number of requests waiting in queue"

# GPU utilization gauge
- name: gpu_vram_utilization_percent
  type: gauge
  labels: [worker_id, gpu_type, region]
  description: "Percentage of GPU VRAM in use"

# Safety block counter
- name: safety_blocks_total
  type: counter
  labels: [stage, category, tier]
  description: "Total requests blocked by safety checks"

# Warm pool hit rate
- name: warm_pool_requests_total
  type: counter
  labels: [result]  # hit, cold_start, failed
  description: "Model loading cache results"

# Request outcome counter
- name: requests_total
  type: counter
  labels: [tier, status, model]
  description: "Total requests by outcome"
```

---

## Dashboard Design

### Operations Dashboard

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    AI IMAGE GENERATION - OPERATIONS                      │
│  Status: HEALTHY | GPUs: 85/100 | QPS: 45.2 | Queue: 127               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────┐  │
│  │   Generation Time (p95)     │  │      Queue Depth by Tier        │  │
│  │                             │  │                                 │  │
│  │  sec                        │  │  depth                          │  │
│  │   40│                       │  │  500│                           │  │
│  │   30│         ╱╲            │  │  250│    Relax ───────          │  │
│  │   20│────────╱  ╲───        │  │   50│    Fast ─────             │  │
│  │   10│ SLO ─────────────     │  │   10│    Turbo ──               │  │
│  │    5│                       │  │     └────────────────────       │  │
│  │     └───────────────────    │  │         1h    30m    now        │  │
│  │       1h    30m    now      │  │                                 │  │
│  └─────────────────────────────┘  └─────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────┐  │
│  │      GPU Pool Status        │  │     Request Outcome (1h)        │  │
│  │                             │  │                                 │  │
│  │  SDXL:  ████████████ 45    │  │  Success:   ███████████████ 94%│  │
│  │  SD3:   ██████ 20          │  │  Blocked:   ██ 3%               │  │
│  │  Flux:  █████ 15           │  │  Failed:    █ 2%                │  │
│  │  Idle:  ██ 5               │  │  Timeout:   ░ 1%                │  │
│  └─────────────────────────────┘  └─────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                   Request Rate & Throughput                      │   │
│  │                                                                  │   │
│  │  req/s                                                           │   │
│  │    60│     ████                     ████████████                │   │
│  │    45│   ████████                 ████████████████              │   │
│  │    30│  ██████████               █████████████████████          │   │
│  │    15│ ████████████             ███████████████████████████     │   │
│  │     0└───────────────────────────────────────────────────────▶  │   │
│  │       00:00  04:00  08:00  12:00  16:00  20:00  now            │   │
│  │       ── Requests   ── Completed                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Recent Alerts:                                                         │
│  [14:32:15] ⚠️ Fast queue depth high (180) - scaling up               │
│  [13:15:02] ℹ️ VRAM defragmentation completed on worker-12            │
│  [12:45:30] ⚠️ Model load latency elevated (avg 18s)                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Safety Dashboard

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    AI IMAGE GENERATION - SAFETY                          │
│  Status: NORMAL | Block Rate: 2.8% | Escalations: 3 pending             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────┐  │
│  │     Block Rate by Stage     │  │    Block Reasons (24h)          │  │
│  │                             │  │                                 │  │
│  │  rate%                      │  │  NSFW:      ████████████ 45%   │  │
│  │   10│                       │  │  Violence:  █████ 20%          │  │
│  │    5│  Pre-gen ─────────── │  │  Prompt:    ████ 18%            │  │
│  │    3│  Post-gen ──────      │  │  Celebrity: ██ 10%              │  │
│  │    1│                       │  │  Other:     ██ 7%               │  │
│  │     └────────────────────   │  │                                 │  │
│  └─────────────────────────────┘  └─────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────┐  ┌─────────────────────────────────┐  │
│  │  Classifier Performance     │  │    Escalations Queue            │  │
│  │                             │  │                                 │  │
│  │  Metric      Value  Status  │  │  ID        Age     Category     │  │
│  │  ─────────────────────────  │  │  ─────────────────────────────  │  │
│  │  Precision   96.2%  ✅     │  │  ESC-001   15m     NSFW edge    │  │
│  │  Recall      93.8%  ✅     │  │  ESC-002   32m     Violence     │  │
│  │  Latency     142ms  ✅     │  │  ESC-003   1h      Celebrity    │  │
│  │  FP Rate     3.1%   ✅     │  │                                 │  │
│  └─────────────────────────────┘  └─────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Safety Events Timeline                        │   │
│  │                                                                  │   │
│  │  blocks                                                          │   │
│  │   200│                                                           │   │
│  │   150│     ▲ Spike (possible attack)                            │   │
│  │   100│  ───────────────────────────────────                     │   │
│  │    50│                                                           │   │
│  │     0└───────────────────────────────────────────────────────▶  │   │
│  │       00:00  04:00  08:00  12:00  16:00  20:00  now            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  🚨 CSAM Detections (0 in last 30 days) ✅                             │
│  ⚠️ Bias Detection Rate: 4.2% (monitoring only)                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Logging Strategy

### Log Levels and Content

```
LOG_LEVEL_STRATEGY:

    DEBUG:
        - Detailed diffusion step timing
        - VRAM allocation details
        - Scheduler decisions
        - NOT in production

    INFO:
        - Request received
        - Generation started/completed
        - Model loaded/unloaded
        - Worker status changes

    WARN:
        - Queue depth high
        - VRAM pressure
        - Retry triggered
        - Rate limit approaching

    ERROR:
        - Generation failed
        - Model load failed
        - Safety check failed
        - Worker unhealthy

    CRITICAL:
        - CSAM detection
        - Security breach
        - Data corruption
        - System outage
```

### Structured Log Format

```json
{
    "timestamp": "2024-01-15T14:32:15.123Z",
    "level": "INFO",
    "service": "generation-worker",
    "worker_id": "worker-abc123",
    "region": "us-west-2",

    "trace_id": "trace-xyz789",
    "span_id": "span-456",
    "request_id": "gen-a1b2c3d4",

    "event": "generation_complete",

    "metrics": {
        "queue_wait_ms": 5200,
        "model_load_ms": 0,
        "generation_ms": 8500,
        "safety_check_ms": 150,
        "cdn_upload_ms": 450,
        "total_ms": 14300
    },

    "config": {
        "model": "sdxl-1.0",
        "steps": 30,
        "scheduler": "dpm_pp_2m_karras",
        "resolution": "1024x1024",
        "loras": ["detail-v1"],
        "controlnet": null,
        "batch_size": 1
    },

    "safety": {
        "prompt_passed": true,
        "image_passed": true,
        "nsfw_score": 0.02,
        "violence_score": 0.01
    },

    "user_context": {
        "user_id_hash": "sha256:abc...",
        "tier": "fast",
        "organization_id_hash": "sha256:def..."
    }

    // NEVER LOG:
    // - Actual prompts
    // - Image content/URLs
    // - Raw user IDs
    // - IP addresses (hash only)
}
```

### What NOT to Log

```
PROHIBITED_LOG_CONTENT:

    # Privacy
    - Raw user prompts (use hash for abuse detection)
    - Generated image content or URLs
    - User email addresses
    - IP addresses (hash acceptable for abuse)
    - API keys (even partial)

    # Security
    - Internal service credentials
    - Database connection strings
    - Encryption keys
    - Auth tokens

    # Compliance
    - PII that could identify users
    - Content of blocked images
    - Detailed safety classifier scores (aggregates OK)
```

---

## Distributed Tracing

### Trace Structure

```
GENERATION_TRACE:

generation_request [total: 14.3s]
├── gateway [5ms]
│   ├── auth_check [2ms]
│   ├── rate_limit_check [1ms]
│   └── request_routing [2ms]
│
├── prompt_processing [120ms]
│   ├── prompt_parsing [5ms]
│   ├── safety_pre_check [15ms]
│   ├── tokenization [10ms]
│   ├── clip_encoding [45ms]
│   └── t5_encoding [45ms]
│
├── queue_wait [5200ms]
│   ├── enqueue [2ms]
│   └── wait_for_worker [5198ms]
│
├── worker_assignment [25ms]
│   ├── find_optimal_worker [10ms]
│   ├── model_cache_check [5ms]   // hit
│   └── reserve_worker [10ms]
│
├── generation [8500ms]
│   ├── latent_init [50ms]
│   ├── diffusion_loop [7900ms]
│   │   ├── step_1 [263ms]
│   │   ├── step_2 [263ms]
│   │   │   ... (30 steps)
│   │   └── step_30 [263ms]
│   └── vae_decode [550ms]
│
├── safety_post_check [150ms]
│   ├── nsfw_classifier [60ms]
│   ├── violence_classifier [40ms]
│   ├── csam_scanner [30ms]
│   └── watermark_embed [20ms]
│
└── delivery [450ms]
    ├── format_optimization [200ms]
    ├── cdn_upload [200ms]
    └── url_generation [50ms]
```

### Key Spans to Instrument

| Span | Purpose | Critical Attributes |
|------|---------|---------------------|
| `gateway` | Auth and routing | `user_tier`, `rate_limit_remaining` |
| `prompt_processing` | Text encoding | `prompt_length`, `encoder_types` |
| `queue_wait` | Queue latency | `tier`, `queue_position`, `wait_time` |
| `worker_assignment` | Model matching | `cache_hit`, `model`, `worker_id` |
| `diffusion_loop` | Main generation | `steps`, `scheduler`, `step_times[]` |
| `vae_decode` | Image decoding | `resolution`, `batch_size` |
| `safety_check` | Content moderation | `scores`, `passed`, `categories` |
| `cdn_upload` | Delivery | `file_size`, `format`, `region` |

---

## Alerting

### Alert Rules

```yaml
# Critical (Page immediately)
- alert: CSAMDetected
  expr: csam_detections_total > 0
  for: 0s
  severity: critical
  annotations:
    summary: "CSAM content detected - immediate action required"
    runbook: "https://runbooks/csam-response"

- alert: ServiceDown
  expr: up{job="generation-api"} == 0
  for: 1m
  severity: critical
  annotations:
    summary: "Generation API is down"

# High (Page within 5 minutes)
- alert: QueueBacklogCritical
  expr: queue_depth{tier="turbo"} > 50 or queue_depth{tier="fast"} > 200
  for: 5m
  severity: high
  annotations:
    summary: "Queue backlog critical - {{ $labels.tier }}: {{ $value }}"
    runbook: "https://runbooks/queue-scaling"

- alert: GenerationLatencyHigh
  expr: histogram_quantile(0.95, generation_time_seconds) > 40
  for: 5m
  severity: high
  annotations:
    summary: "P95 generation time > 40s"

- alert: SafetyBlockRateSpike
  expr: rate(safety_blocks_total[5m]) > 0.1
  for: 5m
  severity: high
  annotations:
    summary: "Safety block rate > 10% - possible attack"

# Medium (Alert within 1 hour)
- alert: GPUUtilizationLow
  expr: avg(gpu_compute_utilization_percent) < 30
  for: 30m
  severity: medium
  annotations:
    summary: "GPU utilization below 30% - consider scaling down"

- alert: WarmPoolMissRate
  expr: rate(warm_pool_requests_total{result="cold_start"}[30m]) > 0.2
  for: 30m
  severity: medium
  annotations:
    summary: "Warm pool miss rate > 20%"

- alert: VRAMPressure
  expr: gpu_vram_utilization_percent > 90
  for: 10m
  severity: medium
  annotations:
    summary: "VRAM utilization > 90% on {{ $labels.worker_id }}"

# Low (Notification)
- alert: ModelLoadLatency
  expr: histogram_quantile(0.95, model_load_seconds) > 20
  for: 15m
  severity: low
  annotations:
    summary: "Model load latency elevated"
```

### Runbook References

| Alert | Runbook | Key Actions |
|-------|---------|-------------|
| CSAMDetected | /runbooks/csam-response | Block user, preserve evidence, report NCMEC |
| ServiceDown | /runbooks/service-recovery | Check health, restart pods, failover |
| QueueBacklogCritical | /runbooks/queue-scaling | Scale GPU pool, check for bottlenecks |
| GenerationLatencyHigh | /runbooks/latency-investigation | Check model loading, GPU health, queue depth |
| SafetyBlockRateSpike | /runbooks/safety-incident | Analyze patterns, possible coordinated attack |
| GPUUtilizationLow | /runbooks/capacity-optimization | Consider scale-down, rebalance |
| WarmPoolMissRate | /runbooks/warm-pool-tuning | Analyze model popularity, adjust tiers |
| VRAMPressure | /runbooks/vram-management | Defragment, reduce batch size, route elsewhere |

---

## SLO Monitoring

### SLO Definitions

```yaml
slos:
  - name: generation_availability
    description: "Percentage of requests that complete successfully"
    target: 99.9%
    window: 30d
    indicator:
      type: request_based
      good: requests_total{status="success"}
      total: requests_total

  - name: generation_latency_fast
    description: "Percentage of Fast tier requests under 25s"
    target: 95%
    window: 30d
    indicator:
      type: request_based
      good: generation_time_seconds_bucket{tier="fast",le="25"}
      total: generation_time_seconds_count{tier="fast"}

  - name: generation_latency_turbo
    description: "Percentage of Turbo tier requests under 10s"
    target: 99%
    window: 30d
    indicator:
      type: request_based
      good: generation_time_seconds_bucket{tier="turbo",le="10"}
      total: generation_time_seconds_count{tier="turbo"}

  - name: safety_false_negative
    description: "Percentage of unsafe content not caught"
    target: 99.9%  # <0.1% miss rate
    window: 30d
    indicator:
      type: manual_review_based
      measurement: periodic_audit

error_budgets:
  - slo: generation_availability
    budget: 0.1%  # 43 minutes/month
    burn_rate_alert: 2x  # Alert if burning 2x normal rate

  - slo: generation_latency_fast
    budget: 5%
    burn_rate_alert: 3x
```

### Error Budget Dashboard

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ERROR BUDGET STATUS (30-day window)                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  SLO: Availability (99.9%)                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Budget: 43.2 min | Used: 12.5 min | Remaining: 30.7 min (71%)   │   │
│  │ ████████████████████████████████░░░░░░░░░░░░░░░░                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  SLO: Fast Latency (95% < 25s)                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Budget: 5% | Used: 2.1% | Remaining: 2.9%                       │   │
│  │ ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  SLO: Turbo Latency (99% < 10s)                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Budget: 1% | Used: 0.3% | Remaining: 0.7%                       │   │
│  │ ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Burn Rate: Normal (0.8x) ✅                                            │
│  Projected Month-End: 85% budget remaining ✅                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## AI Observability Standards

This system's AI components inherit patterns from:
- **[3.25 AI Observability & LLMOps](../3.25-ai-observability-llmops-platform/00-index.md)** — distributed tracing, token accounting, prompt-completion linkage
- **[3.26 AI Model Evaluation & Benchmarking](../3.26-ai-model-evaluation-benchmarking-platform/00-index.md)** — eval taxonomy, regression testing, quality metrics
