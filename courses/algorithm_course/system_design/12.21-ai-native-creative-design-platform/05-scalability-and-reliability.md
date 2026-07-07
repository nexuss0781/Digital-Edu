# 12.21 AI-Native Creative Design Platform — Scalability & Reliability

## Horizontal Scaling Architecture

### Stateless Services and Their Scaling Axes

The platform separates compute-intensive AI inference from lightweight API serving and collaboration. Each service tier scales independently along its primary resource axis:

| Service | Scaling Axis | State Location |
|---|---|---|
| API Gateway | Replica count (CPU-bound) | No local state; auth tokens validated statelessly via JWT |
| Generation Orchestrator | Replica count (CPU-bound) | Job state in distributed job store; orchestrator is stateless |
| Prompt Interpreter | GPU replica count (small LLM) | Model loaded at startup; no request-local state |
| Layout Generator | GPU replica count (transformer) | Model loaded at startup; no request-local state |
| Image Generator | GPU replica count (diffusion model) | Model loaded at startup; result cache in distributed store |
| Text Generator | GPU replica count (LLM) | Model loaded at startup; no request-local state |
| Brand Enforcer | Replica count (CPU-bound) | Brand kit rules cached from database; refreshed on update |
| CRDT Engine | Replica count (memory-bound) | Session state in distributed memory store; sharded by document_id |
| Document Service | Replica count (I/O-bound) | Document store (distributed database) |
| Asset Pipeline | Worker pool (CPU + I/O bound) | Job queue; results in object storage |
| Export Renderer | Worker pool (CPU-bound) | Job queue; output in object storage |
| Content Safety Filter | GPU replica count (classifier) | Model loaded at startup; no request-local state |

### GPU Fleet Architecture

The GPU fleet is the most expensive and operationally complex tier. It is organized into three pools:

```
GPU pool architecture:
  Pool 1 — Image Generation (diffusion models):
    GPU type: High-memory GPUs (80 GB VRAM)
    Model: INT8-quantized diffusion model (~4 GB per instance)
    Instances per GPU: 4 concurrent inferences (via dynamic batching)
    Pool size: 1,800 GPUs (peak) / 600 GPUs (off-peak)
    Autoscaling: GPU utilization target 75%; scale-up latency ~5 min
      (GPU instances pre-warmed in standby pool with model pre-loaded)

  Pool 2 — Layout + Prompt + Text (transformer/LLM models):
    GPU type: Standard GPUs (40 GB VRAM)
    Models: Layout transformer (~2 GB) + Prompt interpreter (~4 GB) + Text generator (~4 GB)
    Instances per GPU: 8 concurrent inferences (smaller models, faster inference)
    Pool size: 400 GPUs (peak) / 150 GPUs (off-peak)

  Pool 3 — Content Safety + Segmentation:
    GPU type: Standard GPUs (40 GB VRAM)
    Models: Safety classifier (~1 GB) + Segmentation model (~2 GB)
    Instances per GPU: 16 concurrent inferences
    Pool size: 200 GPUs (peak) / 80 GPUs (off-peak)

  Total fleet: ~2,400 GPUs (peak) / ~830 GPUs (off-peak)
  Cost optimization: off-peak scaling saves ~65% GPU cost during low-traffic hours
```

### GPU Cost Optimization Strategies

```
1. Dynamic batching:
   Group generation requests arriving within a 50 ms window into a single batch inference
   Throughput gain: ~3x over sequential inference
   Latency cost: up to 50 ms added wait time (acceptable within 5s SLO)

2. INT8 quantization:
   Quantize diffusion model from FP32 to INT8
   Memory reduction: 4x (fit 4 instances per GPU instead of 1)
   Quality impact: <1% perceptual quality loss (validated by human evaluation)
   Throughput gain: ~2x

3. Progressive generation:
   Generate a 4-step preview image (400 ms) displayed immediately
   Complete the full 20-step generation (2,500 ms) in background
   User sees instant feedback; high-quality result replaces preview seamlessly
   Perceived latency reduction: ~2 seconds

4. Generation cache:
   Cache generated images by {prompt_hash, brand_kit_version, seed}
   Cache hit rate: ~12% (popular prompts like "abstract background", "gradient")
   Cache TTL: 7 days
   Storage: ~100 TB (LRU eviction)
   GPU cost savings: ~12% of image generation fleet

5. Model distillation:
   Distill 50-step teacher model to 8-step student model for common generation types
   Quality trade-off: acceptable for simple backgrounds and icons; not for complex scenes
   Used for: background generation, icon generation, simple illustrations
   Latency: ~500 ms instead of 2,500 ms
```

### Collaboration Service Scaling

```
CRDT engine scaling:
  Sharding: document_id consistent hashing across CRDT engine replicas
  Each replica manages ~50,000 concurrent sessions
  40 replicas for 2M concurrent sessions

  Memory per session: ~55 KB (scene graph + cursor state)
  Total memory: 2M × 55 KB = 110 GB → distributed across 40 replicas (~2.75 GB each)

  Operations throughput: 4M ops/sec → 100K ops/sec per replica
  Per-operation latency: ~1 ms CRDT merge + ~5 ms broadcast → well within capacity

  Session migration on replica failure:
    Sessions re-established on a different replica within 2 seconds
    Client reconnects via WebSocket; CRDT state rebuilt from last checkpoint
    No data loss: checkpoints persist to distributed store every 500 ms
```

---

## Fault Tolerance

### Generation Pipeline Resilience

The generation pipeline has multiple failure modes, each with a specific recovery strategy:

```
Failure: GPU instance crash during diffusion inference
  Detection: health check timeout (10 seconds)
  Recovery: orchestrator detects subtask timeout; resubmits image generation to different GPU
  User impact: ~3-4 second additional latency; within SLO if original generation started early in budget
  Mitigation: GPU watchdog process restarts crashed instances; pre-warmed standby pool absorbs load

Failure: Layout transformer produces degenerate output (overlapping elements)
  Detection: post-generation overlap validator
  Recovery: retry with different random seed (up to 2 retries)
  User impact: ~1.2 second additional latency per retry
  Fallback: if 2 retries fail, serve template-based layout matching the intent

Failure: Brand enforcer detects unresolvable violation
  Detection: violation count exceeds threshold after 2 re-generation attempts
  Recovery: serve design with violations flagged in UI (yellow warning indicators)
  User impact: non-blocking; user sees design with highlighted issues; can manually fix

Failure: Content safety classifier unavailable
  Detection: health check failure on safety service
  Recovery: BLOCK all AI-generated images until safety service recovers
  User impact: generation requests return error; manual editing unaffected
  Rationale: never serve potentially unsafe content; safety is non-negotiable
```

### Design Document Durability

```
Document store replication:
  Write path: synchronous write to primary + 1 replica within same region
  Async replication: to 1 replica in a different availability zone
  RPO: 0 for single-AZ failures; < 500 ms for multi-AZ failures

  Checkpoint strategy:
    During active editing: checkpoint every 500 ms to document store
    On collaboration session close: immediate full checkpoint
    On version creation: snapshot stored as immutable version record

  Backup:
    Daily full backup of document store to separate object storage
    Point-in-time recovery window: 30 days
    Backup tested monthly via automated restore verification
```

### Collaboration Service Failover

```
CRDT engine failover:
  Active-passive within availability zone:
    Each session has a primary CRDT replica and a hot standby
    Primary and standby sync state every 100 ms
    On primary failure: standby promoted within 1 second
    Client WebSocket reconnects; detects new primary; replays buffered local ops

  Cross-AZ failover:
    If entire AZ fails: sessions migrate to replicas in surviving AZ
    RTO: 5 seconds (WebSocket reconnection + state rebuild from last checkpoint)
    RPO: < 500 ms (last checkpoint interval)
    User experience: brief "reconnecting" indicator; no data loss in practice
```

---

## Surge Handling

### Viral Template Events

When a design template goes viral (shared by an influencer, trending social event), the platform experiences sudden 10x spikes in generation requests as millions of users customize the same template. The spike pattern:

```
Viral template surge handling:
  Detection: template usage rate exceeds 10x normal within 15 minutes
  Response:
    1. Cache the template's base layout and pre-generated common variations
       (avoid re-running layout transformer for identical inputs)
    2. Pre-warm GPU pool: request additional GPU instances from standby pool
       (standby pool maintains 30% headroom for exactly this scenario)
    3. Rate limit per-user generation requests (max 5 concurrent per user)
       to prevent a single user from monopolizing GPU capacity
    4. Serve cached variations where prompt similarity > 0.9 (same template + minor text changes)
    5. If GPU capacity is exhausted: queue requests with estimated wait time shown to user;
       prioritize paying users over free-tier users

  Historical data: viral events typically peak within 2 hours and subside within 6 hours
```

### Seasonal Spikes

Predictable demand increases around holidays, marketing seasons, and social media events:

| Event | Spike Factor | Pre-scaling Strategy |
|---|---|---|
| End-of-year holidays | 3x | Scale GPU fleet 48h before; pre-cache holiday template variations |
| Back-to-school | 2x | Scale GPU fleet 24h before |
| Major social media trends | 5-10x (unpredictable) | Standby GPU pool + generation queue with backpressure |
| Product launch events (platform feature release) | 4x | Pre-scale all tiers; feature-flag gradual rollout |

### GPU Fleet Disaster Recovery

| Failure Scenario | Detection | Recovery | RTO | RPO |
|---|---|---|---|---|
| **Single GPU instance failure** | Health check timeout (10s) | Job rerouted to another instance; failed instance replaced from warm pool | 10-15s (transparent retry) | N/A (stateless) |
| **GPU rack failure (8-16 GPUs)** | Aggregate health check; >50% rack unhealthy | Drain rack; redistribute load across remaining racks; request capacity from standby pool | 2-5 min | N/A |
| **GPU pool region failure** | Region health check; generation success rate <80% | Overflow routing to secondary region; geo-aware load balancer update | 5-10 min | N/A |
| **Model serving infrastructure failure** | Model inference errors >10%; health check failure | Roll back to last known-good model serving config; restart serving containers from checkpoint | 3-8 min | N/A |
| **GPU driver/firmware issue** | Inference produces NaN/garbage output; image quality score <threshold | Quarantine affected GPU instances; route to unaffected hardware; vendor escalation | 10-30 min per instance | N/A |

### Data Layer Disaster Recovery

| Subsystem | DR Strategy | RTO | RPO | Test Frequency |
|---|---|---|---|---|
| **Design document store** | Synchronous intra-region replication + async cross-region replication; automated failover | 5 min | 0 (intra-region); <500 ms (cross-region) | Monthly |
| **Asset object store** | Multi-AZ by default; cross-region replication with eventual consistency | 10 min | <30s (replication lag) | Quarterly |
| **Generation cache** | LRU cache; no DR needed — cache miss simply triggers re-generation | Immediate (cache miss) | N/A | N/A |
| **Template index** | Vector index rebuilt from source documents; read replicas in each region | 30 min (index rebuild) | 0 (source documents have DR) | Monthly |
| **Collaboration session state** | In-memory with 500ms checkpoints to document store; sessions recoverable from checkpoint | 5s (session rebuild) | <500 ms | Weekly |

### Data Sovereignty and Regional Compliance

```
Data sovereignty rules:
  EU (GDPR):
    User designs and personal data stored exclusively in EU regions
    AI generation requests processed in EU GPU fleet (no cross-region routing)
    Exception: if EU GPU fleet exhausted, generation queued (NOT routed to US)
    Generation prompts stored in EU region; retention per GDPR data minimization

  US (CCPA/CPRA):
    User designs stored in US regions
    Cross-region GPU routing permitted for latency optimization (no personal data in payload)
    Generation prompts retained 90 days; anonymized after

  APAC (various):
    Per-country rules: China (data must stay in mainland); India (localization pending)
    Default: APAC-East or APAC-South regional storage
    Cross-region routing within APAC permitted

  Enterprise customers:
    Contractual data residency commitment
    Workspace-level region pinning: all data and compute in specified region
    No cross-region routing even for overflow
    Verified by automated compliance audit monthly
```

### Regional GPU Overflow Routing

```
GPU overflow routing strategy:
  When regional GPU capacity < 10% available:
    1. Check overflow eligibility:
       - Enterprise customers with region-pinning: NOT eligible (queue instead)
       - Data sovereignty restricted (EU users): NOT eligible (queue instead)
       - All other users: eligible for cross-region routing

    2. Select overflow region:
       Priority: nearest region with >30% GPU capacity available
       US-West overflow → US-East (preferred, same country) → EU-West (secondary)
       EU-West overflow → EU-Central (preferred) → US-East (secondary, non-EU users only)
       APAC-East overflow → APAC-South (preferred) → US-West (secondary)

    3. Routing mechanics:
       Only the GPU inference request is routed cross-region
       Prompt text and parameters sent to remote GPU fleet
       Generated image returned to origin region
       All metadata and logging remain in user's home region
       Additional latency: 50-150 ms for cross-region network transit

    4. Monitoring:
       Track overflow routing rate per region per hour
       Alert if overflow rate >20% sustained for >30 min (capacity planning trigger)
       Track cross-region generation latency to ensure SLO still met
```

### Bulkhead Isolation

```
Bulkhead design:
  1. AI generation pipeline has a dedicated GPU fleet separate from the export renderer
     A spike in generation does not starve export capacity

  2. Collaboration service has a dedicated connection pool and memory allocation
     A spike in concurrent editors does not affect API gateway capacity

  3. Free-tier and paid-tier users are served by separate GPU pools
     Free-tier GPU exhaustion does not degrade paid-tier generation latency

  4. Asset upload pipeline has a dedicated worker pool
     A burst of uploads does not consume generation orchestrator capacity

  5. Export renderer has a dedicated job queue with priority levels
     High-resolution print exports do not block quick social media exports
```

---

## Multi-Region Deployment

### Data Residency and Latency Optimization

```
Regional deployment:
  Regions: US-West, US-East, EU-West, EU-Central, APAC-East, APAC-South

  Data residency rules:
    User design documents stored in user's home region
    Assets stored in content-addressable global store with regional edge caches
    AI generation requests routed to nearest region with available GPU capacity

  Cross-region collaboration:
    When users in different regions collaborate on the same document:
    - CRDT session hosted in document's home region
    - Remote users connect via regional WebSocket relay
    - Relay adds ~50-100 ms latency for cross-region participants
    - Acceptable for collaboration; not acceptable for local canvas rendering (which is client-side)

  GPU fleet distribution:
    US-West: 40% of total GPU fleet (largest user base)
    EU-West: 25%
    APAC-East: 20%
    Other: 15%
    Overflow routing: if regional GPU capacity exhausted, route to nearest region with capacity
```

### RTO and RPO

| Subsystem | RTO Target | RPO Target |
|---|---|---|
| API Gateway | 1 min | 0 (multi-region active-active) |
| Collaboration Service | 5 sec | < 500 ms (session checkpoint interval) |
| Design Document Store | 5 min | 0 (synchronous intra-region replication) |
| AI Generation Pipeline | 2 min | N/A (stateless; retry on different GPU) |
| Asset Store | 10 min | 0 (multi-AZ object storage) |
| Export Renderer | 5 min | 0 (job queue is persistent; reprocessed on recovery) |

---

## Graceful Degradation Hierarchy

When the platform faces resource constraints, services degrade in a defined priority order that preserves the most critical user-facing capabilities:

| Priority | Capability | Degradation Strategy | User Impact |
|---|---|---|---|
| 1 (never degrade) | Canvas editing (manual) | Client-side rendering; no server dependency | None — always available |
| 2 (never degrade) | Content safety | Fail-closed; generation stops if safety fails | Generation blocked; editing continues |
| 3 (degrade last) | Collaboration sync | Increase checkpoint interval; reduce broadcast frequency | Slight cursor lag; no data loss |
| 4 (degrade mid) | AI generation (paid) | Queue with priority; extend SLO temporarily | Slower generation; always completes |
| 5 (degrade early) | AI generation (free) | Route to cached templates; show queue position | Cached results or wait |
| 6 (degrade first) | Export rendering | Queue with extended SLA; batch during off-peak | Delayed export delivery |
| 7 (degrade first) | Thumbnail generation | Serve low-res placeholder; regenerate async | Blurry thumbnails temporarily |

---

## Chaos Engineering Experiments

### Experiment 1: GPU Pool Partial Failure During Peak Hours

**Hypothesis:** If 20% of the GPU fleet becomes unavailable during peak hours, the admission control and priority queuing system maintains <8s latency for paid-tier users while gracefully degrading free-tier to cached/template results.

**Method:** During weekday peak (3x baseline), drain 20% of GPU instances. Monitor: generation latency by tier, rejection rate, cache hit rate, user abandonment.

**Expected:** Paid-tier latency stays within 6s SLO; free-tier latency degrades to 12-15s; cache routing for free-tier activates; no errors, just slower.

**Actual finding:** Paid-tier latency maintained at 5.8s (within SLO). Free-tier degraded to 18s before cache routing activated (activation threshold too high). After tuning: cache routing at queue depth 2x instead of 5x, free-tier stabilized at 8s using cached template variations. Improvement: lower cache routing threshold.

### Experiment 2: Collaboration Service Node Failure During Active Session

**Hypothesis:** If the CRDT engine node hosting a 5-participant collaborative session fails, the session fails over to a replica within 5 seconds with no data loss and all participants resume editing within 10 seconds.

**Method:** Kill the CRDT engine process hosting a test collaborative session with 5 active participants making continuous edits. Monitor: client-perceived gap, operation loss, session state integrity post-failover.

**Expected:** WebSocket disconnect detected in 2s; reconnect to replica in 3s; CRDT replay of uncommitted operations in 1s; total user-perceived gap <6s.

**Actual finding:** Clients detected disconnect in 1.5s. Reconnection to replica took 4.2s (DNS propagation delay). CRDT replay recovered all operations from the 500ms checkpoint window. One participant experienced a 200ms stutter during replay. No operation loss. Total perceived gap: 5.7s.

### Experiment 3: Asset Store Region Unavailability

**Hypothesis:** If the primary asset storage region becomes unavailable, the CDN edge cache and secondary region serve all asset requests with <50ms additional latency for cached assets and <500ms for cache misses.

**Method:** Block access to primary asset store region. Monitor: asset load times, cache hit rates, 404 error rates for recently uploaded assets.

**Expected:** CDN-cached assets (>80% of requests) served normally. Cache misses routed to secondary region with cross-region latency. Recently uploaded assets (not yet replicated) may return 404 until replication catches up.

**Actual finding:** 83% of asset requests served from CDN cache with no impact. 15% routed to secondary region with 120ms additional latency (acceptable). 2% of requests for assets uploaded in the last 30 seconds returned 404 (replication lag). Mitigation: upload acknowledgment now waits for secondary region replication confirmation before confirming upload to user.

### Experiment 4: Content Safety Classifier Latency Spike

**Hypothesis:** If the content safety classifier latency spikes to 500ms (10x normal), the generation pipeline degrades gracefully by queueing safety checks without blocking canvas display, while maintaining the safety gate for new generations.

**Method:** Inject 500ms artificial latency into safety classifier. Monitor: generation latency, safety queue depth, bypass rate.

**Expected:** Generation latency increases from 4s to 4.5s (safety is on the critical path). If safety queue depth exceeds threshold, new generations queued rather than bypassed.

**Actual finding:** Generation latency increased to 4.6s. Safety queue depth remained manageable. No safety bypass occurred (correct behavior—safety must never be bypassed). At extreme levels (2000ms), generation latency exceeded 5s SLO, triggering the safety fallback: route to a secondary lighter-weight safety model (higher false positive rate but faster) while primary model recovers.

---

## Back-Pressure Mechanisms

| Component | Signal | Response |
|---|---|---|
| **GPU queue** | Queue depth > 2x baseline for > 30s | Admission control: free-tier → cached templates; paid-tier → priority queue |
| **CRDT engine** | Operation merge latency > 50ms | Reduce AI generation concurrency for that session; batch smaller operations |
| **Asset upload pipeline** | Upload processing lag > 30s | Throttle non-premium uploads; defer thumbnail generation |
| **Export renderer** | Export queue depth > 1000 | Defer non-urgent exports; prioritize paid-tier; expand renderer pool |
| **Content safety** | Classifier response time > 200ms | Route to fallback classifier (faster, more conservative); alert ML team |
| **Brand enforcer** | Validation cascade > 3 iterations | Deliver with violations flagged (bypass iterative correction); log for model improvement |

---

## Predictive Scaling

| Event | Lead Time | Pre-Scale Action |
|---|---|---|
| **Viral template event** | Minutes (detected by template usage spike) | Pre-generate variations of trending template; cache aggressively; spin up warm standby GPUs |
| **Enterprise campaign launch** | Days (scheduled via enterprise API) | Pre-provision dedicated GPU pool; pre-warm brand kit caches; alert collaboration service for high-concurrency session |
| **Weekly peak (Tuesday 10am–2pm)** | Predictable | GPU fleet at 100% by 9:30am; collaboration service scaled by 9am; CDN pre-warmed |
| **Holiday design surge** | Weeks (seasonal) | Increase GPU fleet 40% for 6-week window; expand export renderer pool; pre-generate holiday template variations |
| **New model version deployment** | Scheduled | Parallel fleet: old + new model running simultaneously; gradual traffic shift over 10 days |

---

## Capacity Planning Model

### GPU Fleet Sizing Formula

```
GPU fleet sizing:
  Variables:
    R = peak generation requests per second
    T_gpu = GPU-seconds per generation request (varies by generation type)
    C = concurrent inferences per GPU (via batching and quantization)
    U_target = target GPU utilization (75% — leave headroom for burst)

  Formula:
    GPU_count = (R × T_gpu) / (C × U_target)

  Example (image generation pool):
    R = 1,700 requests/sec (peak)
    T_gpu = 2.5s per generation
    C = 4 concurrent per GPU (INT8 quantized diffusion model)
    U_target = 0.75

    GPU_count = (1,700 × 2.5) / (4 × 0.75) = 4,250 / 3.0 = 1,417 GPUs

  With caching (12% hit rate):
    Effective R = 1,700 × 0.88 = 1,496 requests/sec
    GPU_count = (1,496 × 2.5) / (4 × 0.75) = 3,740 / 3.0 = 1,247 GPUs

  With progressive generation (30% accept 4-step preview):
    Effective T_gpu = 0.7 × 2.5 + 0.3 × 0.4 = 1.87s average
    GPU_count = (1,496 × 1.87) / (4 × 0.75) = 2,798 / 3.0 = 933 GPUs

  Combined optimizations reduce peak fleet from 1,417 to 933 GPUs (34% savings)
```

### Storage Growth Model

```
Storage growth projections:
  Daily ingest:
    AI-generated images: 50M generations × 1.2 MB average = 60 TB/day (before dedup)
    User-uploaded assets: 100M uploads × 3 MB average = 300 TB/day (before dedup)
    Total gross ingest: 360 TB/day

  Deduplication savings:
    AI-generated images: ~5% dedup (low repeat rate) → 57 TB/day net
    User uploads: ~40% dedup (high stock photo repetition) → 180 TB/day net
    Total net ingest: 237 TB/day → ~86.5 PB/year

  Lifecycle management:
    Hot tier (< 30 days): 7.1 PB
    Warm tier (30-180 days): 28.5 PB
    Cold tier (180-365 days): 28.5 PB (cheaper storage class)
    Deletion eligible (> 365 days, unreferenced): estimated 15% of cold tier

  Cost optimization:
    Hot tier: ~$0.023/GB/month → $163K/month
    Warm tier: ~$0.0125/GB/month → $356K/month
    Cold tier: ~$0.004/GB/month → $114K/month
    Total storage cost: ~$633K/month → $7.6M/year
```

### Collaboration Capacity Model

```
Collaboration scaling:
  Peak concurrent sessions:
    MAU: 265M
    Daily active: 35M (13% of MAU)
    Peak concurrent: 2M (5.7% of daily active)
    Average participants per session: 1.8
    Total concurrent connections: 3.6M WebSocket connections

  CRDT engine capacity per replica:
    Sessions: 50,000
    Operations: 100K ops/sec
    Memory: 50,000 × 55 KB = 2.75 GB

  Fleet size:
    Session replicas: 2M / 50,000 = 40 replicas
    WebSocket servers: 3.6M / 100K connections per server = 36 servers
    Total: 40 CRDT replicas + 36 WebSocket servers

  Growth buffer:
    Provision for 1.5x (anticipate collaboration adoption growth)
    Actual fleet: 60 CRDT replicas + 54 WebSocket servers
```

## AI Release Ladder

Every AI model or capability change in this system MUST follow this rollout sequence:

| Stage | Description | Gate Criteria |
|-------|-------------|---------------|
| 1. Offline Evaluation | Benchmark against historical ground truth | Meets baseline metrics |
| 2. Shadow Mode | Run in parallel with production, compare outputs | No regression on key metrics |
| 3. Canary (Blast-Radius Capped) | 1-5% traffic, human review of all outputs | Error rate < threshold |
| 4. Human-Reviewed Production | AI recommends, human approves all actions | Approval rate > 90% |
| 5. Limited Autonomous Production | AI acts within pre-approved boundaries | Continuous monitoring, no alerts |
| 6. Instant Rollback | One-click revert to previous model/rules | < 5 min rollback time |

**Note:** AI capabilities that directly interact with end users or execute actions on their behalf must reach Stage 4 (human-reviewed production) with domain-expert sign-off before deployment. Stage 5 limited autonomy applies only to well-bounded, low-risk action categories with established rollback procedures.
