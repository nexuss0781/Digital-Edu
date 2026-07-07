# 13.1 AI-Native Manufacturing Platform — Scalability & Reliability

## Edge Scaling Architecture

### Per-Factory Edge Topology

Each factory is a self-contained edge deployment with its own local compute, storage, and networking infrastructure:

```
Factory edge topology:
  Production cells: 20–100 (each cell = cluster of 5–20 machines)
  Edge gateways: 1 per cell → 20–100 gateways per factory
  Per gateway: 8-core CPU, 50 TOPS AI accelerator, 64 GB RAM, 2 TB NVMe

  Networking (OT side):
    EtherCAT / PROFINET for PLC communication (deterministic, <1 ms cycle)
    OPC-UA for sensor data aggregation (10 ms resolution)
    GigE Vision for camera data (dedicated camera network)

  Networking (IT side):
    10 GbE uplink to factory aggregation switch
    Factory WAN uplink to cloud: 1–10 Gbps (shared across all gateways)

  Physical isolation:
    OT and IT networks on physically separate NICs
    No routing between OT and IT at the gateway level
    DMZ with data diode for OT→IT data transfer
```

### Horizontal Scaling Within a Factory

Adding production capacity (new machines, new production lines) scales edge compute linearly:

- **New machine:** Add sensors → configure on existing edge gateway (if capacity allows) → register digital twin asset
- **New production cell:** Deploy new edge gateway → network configuration → model deployment from registry
- **New camera station:** Add camera → configure CV pipeline on nearest edge gateway → deploy defect model

No cloud-side infrastructure change is required for within-factory scaling. The cloud ingestion pipeline auto-discovers new edge gateways through a registration protocol.

### Multi-Factory Scaling

```
Multi-site architecture:
  50 factories × 100 edge gateways = 5,000 edge nodes globally

  Cloud ingestion:
    Per factory: ~430 GB/day cloud-bound data
    50 factories: ~21.5 TB/day aggregate cloud ingestion
    Stream processing: partitioned by plant_id → parallel pipelines per factory

  Twin state store:
    50 factories × 10,000 assets = 500,000 digital twin records
    State update rate: 500K assets × 1 update/sec = 500K writes/sec to twin store
    Read rate: analytics + PdM + scheduling queries: ~2M reads/sec

  Storage sharding:
    Time-series telemetry: partitioned by {plant_id, asset_type, date}
    Twin state: partitioned by plant_id (each factory is a natural shard boundary)
    CV images: partitioned by {plant_id, date}; lifecycle-managed (90-day hot, 1-year warm, delete)
```

---

## Data Pipeline Reliability

### Edge-to-Cloud Telemetry Pipeline

The telemetry pipeline must guarantee no data loss even under adverse conditions (network partitions, edge restarts, cloud maintenance windows):

```
Reliability guarantees:
  Edge → Cloud: At-least-once delivery
  Deduplication: Sequence numbers per sensor channel; cloud-side idempotent write

  Pipeline stages:
    1. Sensor → Edge gateway ring buffer (write-ahead, NVMe)
    2. Ring buffer → Edge MQTT publisher (read from buffer; publish to broker)
    3. Edge MQTT → DMZ MQTT bridge (OT→IT boundary crossing)
    4. DMZ → Cloud stream processor (message queue with replay capability)
    5. Stream processor → Time-series store + Twin engine (parallel write)

  Failure handling per stage:
    Stage 1 failure (sensor disconnect): quality_flag=SENSOR_FAULT; gap logged
    Stage 2 failure (gateway process crash): Ring buffer survives restart; replay from last ack
    Stage 3 failure (network partition): Ring buffer accumulates; 72h capacity before overflow
    Stage 4 failure (cloud ingestion down): Message queue retains with 7-day TTL; backpressure to edge
    Stage 5 failure (storage write error): Dead letter queue; retry with exponential backoff
```

### Edge Ring Buffer Design

```
Ring buffer specification:
  Capacity: 2 TB NVMe → 72 hours at 280 MB/sec raw ingestion
  Structure: Per-sensor circular buffer with write pointer and read pointer
  Write path: Lock-free single-producer (sensor adapter thread) append
  Read paths:
    - Local inference: zero-copy read from buffer (for FFT, anomaly detection)
    - Cloud forwarding: read from forwarding pointer; advance on cloud ack
    - Forensic replay: read from arbitrary timestamp using index

  Overflow policy:
    When buffer is 90% full: increase downsampling aggressiveness for cloud forwarding
    When buffer is 95% full: drop low-priority sensor channels (environmental > process)
    When buffer is 100% full: overwrite oldest data (safety audit log is on separate non-overwritable partition)

  Durability:
    NVMe with battery-backed write cache; survives power loss
    Checksum per block; corrupted blocks skipped during replay
```

### Stream Processing Scalability

```
Cloud stream processor design:
  Input: 21.5 TB/day from 50 factories = ~250 MB/sec aggregate
  Processing:
    - Parse and validate telemetry messages
    - Route to time-series store (all readings)
    - Route to twin engine (state updates for tracked assets)
    - Route to PdM feature pipeline (vibration + thermal channels only)
    - Route to anomaly detector (real-time statistical process control)

  Partitioning: by plant_id → 50 parallel processing lanes
  Per-lane throughput: ~5 MB/sec → easily handled by single stream processor instance

  Scaling:
    Horizontal: add partitions for new factories
    Vertical: increase partition count within a factory for high-density production lines

  Exactly-once semantics:
    Message queue provides offset tracking
    Stream processor checkpoints offset after successful write to all downstream stores
    On restart: replay from last checkpoint offset
```

---

## Fault Tolerance for Safety-Critical Systems

### Edge Gateway Redundancy

Safety-critical edge gateways (those controlling SIL-2 processes) are deployed in active-standby pairs:

```
Redundancy design:
  Primary gateway: Active; processes all sensor data and runs inference
  Standby gateway: Hot standby; receives sensor data in parallel; runs inference but does not actuate

  Failover trigger:
    - Primary watchdog timer expires (hardware watchdog, 100 ms timeout)
    - Primary inference latency exceeds deadline 3 consecutive times
    - Primary loses connectivity to PLC bus

  Failover process:
    1. Standby detects primary failure (heartbeat loss or watchdog alert)
    2. Standby promotes to active; begins actuating based on its own inference results
    3. Failover time: ≤ 200 ms (within one production cycle for most processes)
    4. Alert sent to operations dashboard; maintenance ticket auto-generated for failed gateway

  State synchronization:
    Twin state replicated between primary and standby every 100 ms
    Model versions identical on both gateways (model deployment is atomic to the pair)
    Ring buffer is not replicated (each gateway maintains its own buffer)
```

### PLC Safety Interlock (Defense in Depth)

The AI inference engine is never the sole safety mechanism. All safety-critical control paths have a hardware safety interlock in the PLC:

```
Defense in depth layers:
  Layer 1: AI inference detects anomaly → sends soft stop command to PLC
  Layer 2: PLC safety function monitors sensor thresholds independently of AI
           → triggers hard stop if threshold exceeded, regardless of AI state
  Layer 3: Hardware safety relay monitors critical sensors directly
           → de-energizes actuators on limit exceedance; no software in the loop

  Design principle:
    The AI model is an OPTIMIZATION layer, not a SAFETY layer.
    The PLC safety function and hardware relay ARE the safety layers.
    The AI model can recommend actions; only the PLC safety function can execute safety stops.
    If the AI model fails, times out, or produces garbage output, the PLC safety function
    continues to protect the equipment and workers independently.
```

### Graceful Degradation Hierarchy

When components fail, the system degrades gracefully rather than halting production:

| Failure | Impact | Degradation |
|---|---|---|
| Single camera failure | One inspection station offline | Bypass with manual inspection flag; increase inspection frequency on adjacent stations |
| Edge AI accelerator failure | No ML inference on one gateway | Fall back to PLC threshold-based alarms; flag all parts from affected cell for manual review |
| Cloud connectivity loss | No cloud analytics, no model updates | Full offline operation: edge inference, local scheduling, 72h telemetry buffer |
| Twin engine failure (cloud) | No what-if simulations, no cross-plant analytics | Edge twins continue; PdM runs on last-known model; scheduling uses local constraint solver |
| PdM model failure | No RUL predictions for one asset type | Revert to time-based maintenance schedule; increase manual inspection frequency |
| Complete edge gateway failure | Loss of monitoring for one production cell | Standby gateway takes over (if redundant); or production cell runs on PLC-only control |

---

## Offline Operation: Autonomous Edge

### Autonomous Operation Capabilities During Cloud Outage

| Capability | Offline Behavior | Limitation vs. Online |
|---|---|---|
| Sensor ingestion | Full operation; data buffered locally | No cloud forwarding (buffered for 72h) |
| CV defect detection | Full operation; models cached on-edge | No model retraining; no new defect category learning |
| PdM anomaly detection | Full operation; statistical process control on-edge | No fleet-wide trend analysis; no RUL model update |
| Digital twin sync | Local twin maintained; no cloud twin update | No what-if simulations requiring cloud physics engine |
| Production scheduling | Local constraint solver with last-known orders | Suboptimal vs. RL-optimized schedule; no new order ingestion |
| Safety audit logging | Full operation; logged to local immutable store | Upload deferred until reconnection |
| Energy optimization | Runs on last-known energy model | No grid price updates; may miss cost-saving opportunities |

### Reconnection Protocol

```
Reconnection sequence:
  1. Edge detects connectivity restored (MQTT broker handshake)
  2. Exchange vector clocks: edge sends its clock; cloud sends its clock
  3. Priority-ordered upload:
     a. Safety audit logs (highest priority, guaranteed delivery)
     b. PdM anomaly events and maintenance ticket updates
     c. Quality inspection results and defect images
     d. Routine telemetry summaries (downsampled during upload)
     e. Raw telemetry (uploaded in background, may take hours)
  4. Cloud-to-edge sync:
     a. Pending model updates (download, verify signature, stage)
     b. New production orders (validate against current schedule)
     c. Schedule recommendations (edge validates before applying)
  5. Conflict resolution:
     a. Edge-made scheduling decisions during outage: preserved if production completed
     b. Cloud-planned schedule: applied only to future (unstarted) jobs
     c. Maintenance tickets: merged (both edge and cloud tickets retained)
  6. Full synchronization verified → operations dashboard shows "ONLINE" status
```

---

## Multi-Region and Data Sovereignty

### Factory Data Residency

Manufacturing data often has data residency requirements (export control regulations, national security for defense manufacturing, GDPR for worker telemetry in EU):

```
Data residency architecture:
  Option 1: Regional cloud deployment
    - EU factories → EU cloud region
    - US factories → US cloud region
    - APAC factories → APAC cloud region
    Each region maintains its own telemetry store, twin engine, and ML training pipeline

  Option 2: Federated analytics
    - Raw data stays in regional cloud; never crosses regional boundary
    - Aggregated metrics (OEE, quality rates, PdM fleet trends) shared across regions
    - ML models: trained on regional data; model artifacts (not training data) shared for transfer learning

  Cross-region analytics:
    - Fleet-wide PdM insights: each region trains local models; model parameters averaged
      via federated learning protocol (no raw sensor data crosses boundaries)
    - Global OEE dashboard: each region publishes aggregated OEE metrics to a global aggregation layer
    - Benchmark comparisons: anonymized quality rates and uptime metrics shared for cross-plant benchmarking
```

### RTO and RPO

| Subsystem | RTO Target | RPO Target |
|---|---|---|
| Edge inference (safety-critical) | 200 ms (active-standby failover) | 0 (standby runs in parallel) |
| Edge gateway (non-critical) | 5 min (gateway restart) | 0 (ring buffer persists) |
| Cloud telemetry pipeline | 30 min | 0 (message queue retains messages) |
| Cloud twin engine | 1 hour | 15 min (twin state checkpointed every 15 min) |
| Cloud analytics | 4 hours | 1 hour |
| Safety audit log | 0 (edge-local, never depends on cloud) | 0 (NVMe with battery-backed cache) |

---

## Back-Pressure Mechanisms

| Component | Trigger | Action | Recovery |
|---|---|---|---|
| **Edge ring buffer** | Buffer 90% full (cloud sync backlog) | Increase downsampling aggressiveness (10× for low-priority sensors); drop environmental telemetry | Resume full-resolution forwarding when buffer drops below 70% |
| **Cloud telemetry pipeline** | Consumer lag > 60 seconds | Back-pressure signal to DMZ MQTT bridge; bridge reduces forwarding rate | Resume when consumer lag < 10 seconds |
| **CV annotation queue** | Human review backlog > 500 images | Lower anomaly sensitivity threshold (reduce "uncertain" detections routed to humans); increase auto-pass confidence threshold | Resume normal thresholds when backlog < 100 |
| **Model registry staging** | Multiple model updates queued during outage | Deploy one model at a time per gateway; 4h minimum between model swaps | Return to normal cadence after all staged models deployed |
| **Twin state store** | Write throughput exceeds capacity (500K writes/sec) | Batch twin updates at 100 ms windows instead of per-reading | Return to per-reading updates when throughput normalizes |
| **PdM training pipeline** | GPU cluster at capacity | Queue non-urgent retraining jobs; prioritize asset types with drift KL > 0.5 | Process queue FIFO (First-In-First-Out, like a line at a store) when capacity becomes available |

---

## Chaos Engineering Experiments

### Experiment 1: Edge Gateway Failure During Peak Production

**Hypothesis:** When a primary edge gateway fails during peak production (full line speed, all cameras active), the standby gateway takes over within 200 ms with no defect escape.

**Method:** Inject SIGKILL to the primary gateway's inference process on a production cell running at full speed. Monitor: (a) time to standby promotion, (b) CV inspection gap (frames not inspected during failover), (c) any defect escape in the gap window.

**Expected:** Standby promotes in ≤ 200 ms; ≤ 6 camera frames uninspected during transition (200 ms × 30 fps); PLC safety function covers the gap for safety-critical monitoring.

**Actual finding (from production validation):** Standby promotion completed in 140 ms. 4 camera frames uninspected. No defect escape (0 defective parts in that 4-frame window by statistical probability). PLC safety function confirmed active throughout.

### Experiment 2: Cloud Connectivity Loss During Model Deployment

**Hypothesis:** If cloud connectivity drops while a model OTA is 50% complete on a gateway, the gateway continues operating with the old model, and the partial download is safely discarded.

**Method:** During active model OTA to a test gateway, sever the DMZ-to-cloud link. Verify: (a) old model remains active and serving inference, (b) partial model artifact is not loaded, (c) OTA resumes from checkpoint when connectivity restores.

**Expected:** Old model continues serving; partial artifact quarantined; OTA resumes from last completed chunk (not from beginning).

**Actual finding:** Old model continued serving with zero inference interruption. Partial artifact automatically deleted after 60 minutes of no progress. OTA restarted from beginning (not resumable — identified as improvement opportunity; chunk-based OTA added in subsequent release).

### Experiment 3: PTP Clock Source Failure

**Hypothesis:** If the GPS-disciplined PTP grandmaster clock fails, edge gateways maintain sufficient time accuracy on local oscillators for cross-sensor analysis to remain valid for 4+ hours.

**Method:** Disconnect GPS antenna from PTP grandmaster. Monitor PTP clock holdover drift across 20 edge gateways over 8 hours. Evaluate FFT feature extraction accuracy under drift.

**Expected:** Local oscillator holdover ≤ 100 ns/hour drift → 800 ns total drift in 8 hours → negligible impact on 15-minute FFT windows.

**Actual finding:** Drift measured at 50–180 ns/hour across gateways (variation by hardware). FFT features unaffected up to 12 hours of holdover. Kurtosis computation unaffected (no time-alignment dependency). PdM predictions unchanged. Conclusion: PTP holdover is a non-issue for analytics; it only matters for cross-gateway event correlation, which requires tighter timing.

### Experiment 4: Twin State Store Overload from Mass Schedule Re-optimization

**Hypothesis:** When a cross-factory schedule re-optimization writes new job assignments to 500+ machine twins simultaneously, the twin state store handles the write burst without rejecting safety-critical writes.

**Method:** Trigger re-optimization of entire factory schedule (100 machines). Monitor: twin state store write latency, safety write rejection rate, edge twin sync lag.

**Expected:** Scheduling writes complete within 5 seconds. Safety writes never rejected (priority queue). Edge twin sync lag increases ≤ 50 ms during burst.

**Actual finding:** Scheduling writes completed in 3.2 seconds. Safety writes unaffected (separate priority queue — scheduling writes never contend with safety writes). Edge twin sync lag increased by 30 ms during burst, returning to baseline within 2 seconds after burst.

### Experiment 5: Sensor Flood from Malfunctioning Equipment

**Hypothesis:** If a vibration sensor malfunctions and floods the edge gateway with 10× normal data rate (500 kHz instead of 50 kHz), the gateway isolates the flood without affecting other sensor channels or inference pipelines.

**Method:** Configure a test sensor to transmit at 500 kHz. Monitor: gateway CPU utilization, ring buffer fill rate, other sensor channel processing latency, CV inference latency.

**Expected:** Gateway detects anomalous data rate, throttles the flooding channel, alerts operators.

**Actual finding:** Gateway CPU utilization spiked to 95% for 2 seconds before rate-limiting engaged. During those 2 seconds, CV inference latency increased from 5 ms to 8 ms (still within 10 ms budget). After rate-limiting: flooding channel downsampled to 50 kHz at gateway; alert generated; all other channels unaffected. Improvement: lower rate-limit detection threshold from 2× to 1.5× expected rate.

---

## Predictive Scaling

| Event | Lead Time | Pre-Scale Action |
|---|---|---|
| **New product launch** | 2–4 weeks | Pre-deploy CV models for new part type; pre-train PdM models with synthetic twin data for expected operating conditions; pre-configure scheduling engine with new product routing |
| **Shift change surge** | Daily, predictable | Pre-warm analytics dashboard caches 15 min before shift change; pre-compute OEE summaries for outgoing shift |
| **Quarterly maintenance window** | Scheduled | Pre-compute post-maintenance PdM baselines; pre-stage model re-calibration for assets with replaced components |
| **Seasonal temperature change** | Weeks, predictable from weather | Pre-adjust CV lighting compensation models; update thermal degradation model parameters for ambient temperature change |

---

## Multi-Plant Data Pipeline Architecture

### Cloud Ingestion and Partitioning Strategy

```
Data flow from 50 factories to cloud analytics:
  Each factory → dedicated WAN uplink → regional cloud ingestion endpoint
  Ingestion endpoints: 3 regional (Americas, EMEA, APAC) for latency optimization

  Partitioning:
    Stream processing: partitioned by plant_id
      - Each factory's telemetry processed in isolation (no cross-plant dependencies in real-time)
      - Parallel stream processors: 50 partitions × 3 consumers per partition = 150 stream consumers
      - Auto-scaling: consumer count scales with ingestion rate (burst during reconnection storms)

    Time-series storage: partitioned by plant_id + time_bucket
      - Hot tier (90 days): columnar storage optimized for recent queries
      - Warm tier (1 year): compressed, queryable with 5-second latency
      - Cold tier (10 years): immutable archive for regulatory compliance

    CV image storage: partitioned by plant_id + camera_id + date
      - Defect images: permanent retention (training data)
      - Normal images: 90-day lifecycle → delete (sampled subset kept permanently)

  Cross-plant analytics (daily batch):
    - Fleet-wide PdM aggregation: pool failure events across all plants for model training
    - Cross-plant OEE benchmarking: normalize by product complexity for fair comparison
    - Quality correlation: detect if defect patterns at one plant predict issues at others
    - Energy benchmarking: kWh per unit normalized by ambient temperature and product mix
```

### Reconnection Storm Management

When multiple factories restore connectivity simultaneously (e.g., after a regional cloud outage), the cloud ingestion layer faces a burst of accumulated data from all affected factories:

```
Scenario: 10 factories offline for 6 hours, each accumulated ~108 GB
  Total reconnection burst: 1.08 TB to upload
  If all start simultaneously: 10 × factory WAN bandwidth = 10-100 Gbps burst to cloud

Mitigation:
  1. Staggered reconnection: each factory adds random jitter (0-300 sec) before starting sync
  2. Priority-based upload:
     Class A (first 15 min): safety audit logs + anomaly events (small volume, critical)
     Class B (next 30 min): PdM alerts + quality events + maintenance tickets
     Class C (remaining): routine telemetry (bulk, can tolerate delay)
  3. Bandwidth throttling: each factory limited to 50% of WAN capacity during sync
     (other 50% reserved for real-time telemetry from resumed operations)
  4. Cloud-side admission control: per-plant ingestion rate limit; surplus queued in regional buffer
  5. Backfill vs. real-time separation: accumulated data ingested into backfill pipeline
     (different stream consumers) to avoid starving real-time telemetry processing
```

---

## Disaster Recovery

### Edge-Level Disaster Recovery

| Failure | Recovery Strategy | RTO | RPO |
|---|---|---|---|
| **Single edge gateway failure** | Hot standby promotion; PLC continues with safety function | < 200 ms | 0 (hot standby is synchronized) |
| **Edge NVMe failure** | Gateway restarts with model cache from network (peer gateway or DMZ); telemetry in ring buffer lost if not replicated | < 5 min | Up to 72 hours of local telemetry |
| **Edge AI accelerator failure** | Gateway falls back to CPU inference (higher latency); safety function reverts to PLC-only control; reduce line speed to accommodate slower inference | < 1 sec | 0 (no data loss) |
| **Full production cell gateway loss** | Manual failover to backup gateway (cold spare); requires network reconfiguration; production cell operates on PLC safety function only until restored | 15-60 min | Telemetry loss during failover window |
| **Factory-wide power loss** | UPS provides 5 min for graceful shutdown; edge gateways flush ring buffers to NVMe; on power restore, gateways boot from persisted state | 5-15 min (power-dependent) | Data from last flush to power loss |

### Cloud-Level Disaster Recovery

| Failure | Recovery Strategy | RTO | RPO |
|---|---|---|---|
| **Cloud analytics unavailable** | Factories continue operating in edge-autonomous mode; no impact on production; analytics delayed until cloud restores | 0 (edge autonomous) | Analytics delayed, not lost |
| **Cloud region failure** | Failover to secondary region; model registry replicated across regions; historical telemetry replayed from cold storage | < 4 hours for analytics | 0 (edge retained all data) |
| **Model registry corruption** | Restore from immutable backup; edge gateways continue with deployed models; new deployments halted until registry restored | < 1 hour | 0 (edge retains deployed models) |
| **Training data loss** | Restore from backup; CV annotated images replicated to secondary region; PdM failure events replicated; training pipeline paused until restored | < 24 hours | Up to 24 hours of annotations |

### Cross-Plant Isolation

A critical reliability property: **no single plant's failure can cascade to other plants**.

```
Isolation guarantees:
  1. Stream processing: per-plant partitions → one plant's telemetry spike cannot
     starve another plant's processing (dedicated consumer groups per plant)
  2. Model training: fleet-wide training runs on pooled data, but a corrupted dataset
     from one plant is detected by anomaly checks on training data quality before
     poisoning the fleet model
  3. Network: each plant has independent WAN uplink → one plant's bandwidth saturation
     does not affect others
  4. Cloud quotas: per-plant resource quotas for compute, storage, and API calls →
     runaway consumption at one plant triggers throttling for that plant only
  5. Twin isolation: each plant's twin engine runs in separate compute namespace →
     a physics simulation divergence at one plant cannot lock resources for others
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

**Note:** Model updates affecting core business recommendations (predictions, classifications, rankings) must reach Stage 4 (human-reviewed production) before any customer-impacting deployment. Stage 5 limited autonomy applies only to low-risk, well-bounded recommendation categories with established rollback procedures.
