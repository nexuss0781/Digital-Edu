# 13.1 AI-Native Manufacturing Platform — Requirements & Estimations

## Functional Requirements

| # | Requirement | Notes |
|---|---|---|
| FR-01 | **Real-time sensor data ingestion** — Ingest telemetry from vibration, thermal, acoustic, visual, and PLC sensors at rates up to 50 kHz per channel; time-align streams using IEEE 1588 PTP; apply edge-side filtering and downsampling before cloud forwarding | Edge gateway normalizes heterogeneous protocols (OPC-UA, MQTT, Modbus, EtherCAT) to a unified telemetry schema |
| FR-02 | **Digital twin synchronization** — Maintain a physics-based virtual replica of every monitored asset (geometry, kinematics, thermal state, health indicators) synchronized within 100 ms of physical state | Bidirectional: twin receives sensor data, runs physics solvers, and can push optimized setpoints back to PLCs |
| FR-03 | **Predictive maintenance (PdM)** — Estimate remaining useful life (RUL) for critical rotating equipment (bearings, spindles, pumps) using vibration spectral analysis, thermal trend modeling, and operational load history | Output: probabilistic RUL distribution per asset; maintenance ticket auto-generated when P(failure within 7 days) > threshold |
| FR-04 | **Computer vision quality inspection** — Run real-time defect detection on inline cameras at full production line speed (≥30 fps); classify defect types (crack, scratch, discoloration, dimensional deviation); trigger automated rejection for critical defects | Must handle novel defect types via anomaly detection, not just supervised classification |
| FR-05 | **Production schedule optimization** — Dynamically re-optimize job-shop scheduling in response to machine breakdowns, quality holds, rush orders, and material shortages; maximize OEE across throughput, quality, and availability | Multi-agent RL or constraint optimization; re-plan within 2 minutes of disruption event |
| FR-06 | **Autonomous robotics coordination** — Orchestrate AGV (Automated Guided Vehicle) fleets and robotic arms through digital twin simulation; plan collision-free paths; adapt to dynamic obstacles and layout changes | Simulation-validated path plans before physical execution |
| FR-07 | **Edge inference engine** — Execute safety-critical ML models (defect rejection, anomaly detection, emergency stop triggers) on edge accelerators with deterministic sub-10 ms latency; fail-safe to predefined safe state on model timeout | RTOS-hosted inference; hardware watchdog enforces timeout |
| FR-08 | **Offline operation mode** — Continue all edge inference, local scheduling, and telemetry logging during cloud connectivity outages; sync accumulated data and model updates upon reconnection | No production stoppage or degraded quality during cloud partition |
| FR-09 | **Cross-plant analytics** — Aggregate telemetry and production metrics across multiple factory sites for fleet-wide predictive maintenance, quality trend analysis, and capacity planning | Cloud-tier analytics; federated data model respecting per-plant data sovereignty |
| FR-10 | **Model lifecycle management** — Version, test, deploy, and roll back ML models (PdM, CV, scheduling) across edge nodes and cloud; canary deployment with automated rollback on accuracy regression | OTA model deployment to edge with integrity verification (signed model artifacts) |
| FR-11 | **Maintenance work order integration** — Auto-generate maintenance tickets from PdM predictions; integrate with CMMS (Computerized Maintenance Management System) for scheduling, parts requisition, and completion tracking | Closed-loop: maintenance completion event feeds back to PdM model as label |
| FR-12 | **Regulatory and safety compliance logging** — Log all safety-critical decisions (emergency stop, defect rejection, setpoint changes) with immutable audit trail; support IEC 61508 functional safety documentation requirements | Tamper-evident log with cryptographic chaining |
| FR-13 | **Energy optimization** — Monitor energy consumption per machine and production line; optimize machine scheduling and setpoints to minimize energy usage while maintaining production targets | Energy cost model integrated into scheduling objective function |
| FR-14 | **Worker safety monitoring** — Detect unsafe human proximity to operating machinery using LiDAR and camera feeds; trigger machine speed reduction or stop when worker enters exclusion zone | Hard real-time requirement: detection-to-action within 50 ms |

---

## Out of Scope

- **ERP integration** — Order management, procurement, and financial accounting (separate enterprise system; manufacturing platform receives production orders as input)
- **Product design and CAD** — Part design, bill of materials management (upstream PLM system)
- **Supply chain logistics** — Warehouse management, transportation, supplier management (separate supply chain platform)
- **HR and workforce scheduling** — Shift planning, payroll, training management (separate HR system)
- **Customer-facing quality reporting** — Certificate of conformance generation and customer portal (downstream quality system)

---

## Non-Functional Requirements

### Performance SLOs

| Metric | Target | Rationale |
|---|---|---|
| Edge inference latency (safety-critical models) p99 | ≤ 10 ms | Defect rejection on conveyor at 2 m/s; emergency stop for equipment protection |
| Digital twin sync lag p95 | ≤ 100 ms | Twin must reflect physical state within one control cycle for what-if simulations |
| PdM RUL prediction refresh | Every 15 min per asset | Bearing degradation evolves over hours-to-days; 15-min refresh captures trends |
| CV defect detection throughput | ≥ 30 fps per camera at 4K resolution | Full line speed inspection; no sampling gaps |
| Schedule re-optimization latency | ≤ 2 min from disruption event | Production cannot wait longer than one takt cycle for rescheduling |
| Sensor ingestion throughput per edge gateway | ≥ 500,000 data points/sec | Supports 100 machines × 50 sensors × 100 Hz average sample rate |

### Reliability & Availability

| Metric | Target |
|---|---|
| Edge inference availability | 99.999% (≤ 5 min downtime/year; safety-critical) |
| Digital twin platform availability | 99.95% (≤ 4.4 hours downtime/year) |
| Cloud analytics availability | 99.9% (≤ 8.8 hours downtime/year; non-production-blocking) |
| Sensor data durability (edge buffer) | No data loss during 72-hour cloud outage |
| Safety audit log durability | 99.9999999% (9 nines); 10-year regulatory retention |

### Scalability

| Metric | Target |
|---|---|
| Sensors per factory | 50,000–200,000 active sensor channels |
| Edge gateways per factory | 20–100 (one per production cell or machine cluster) |
| Factories supported (multi-site) | 50+ globally distributed plants |
| Digital twin assets per factory | 5,000–20,000 (machines, conveyors, robots, fixtures) |
| CV cameras per factory | 200–500 inline inspection cameras |
| Daily sensor data volume per factory | 5–20 TB raw; 200–500 GB forwarded to cloud after edge filtering |
| ML models deployed per factory | 500–2,000 (PdM per asset + CV per camera + scheduling) |

---

## Capacity Estimations

### Sensor Data Throughput

**Assumptions:**
- Large automotive assembly plant: 1,000 machines, 100 sensors per machine = 100,000 sensor channels
- Average sample rate: 100 Hz (mix of 50 kHz vibration, 1 Hz temperature, 10 Hz pressure)
- High-frequency vibration sensors: 500 channels × 50 kHz = 25M samples/sec
- Each sample: 8 bytes (timestamp delta + float32 value)

```
Raw sensor throughput per factory:
  Low-frequency sensors: 99,500 channels × 100 Hz × 8 bytes = 79.6 MB/sec = 6.9 TB/day
  High-frequency vibration: 500 channels × 50,000 Hz × 8 bytes = 200 MB/sec = 17.3 TB/day
  Total raw: ~280 MB/sec = ~24 TB/day per factory

Edge filtering (change-of-value + downsampling):
  Low-frequency: 95% reduction → 4 MB/sec forwarded to cloud
  High-frequency: only spectral features forwarded → 99.5% reduction → 1 MB/sec
  Total cloud-bound: ~5 MB/sec = ~430 GB/day per factory

Multi-site (50 factories):
  Cloud ingestion: 50 × 430 GB = ~21.5 TB/day aggregate
  Cloud storage (1-year hot, 10-year cold): ~8 PB/year hot; ~80 PB cold archive
```

### Edge Compute Sizing

```
Per edge gateway (covers one production cell, ~10 machines):
  Sensor ingestion: 10 machines × 100 sensors × 100 Hz = 100,000 data points/sec
  CV inference: 2 cameras × 30 fps = 60 inferences/sec
  PdM feature computation: 10 assets × 1 FFT/sec = 10 spectral analyses/sec
  Digital twin sync: 10 assets × 100 state updates/sec = 1,000 twin updates/sec

  Hardware: Industrial edge server with:
    - 8-core ARM/x86 CPU (sensor ingestion, twin sync)
    - Edge AI accelerator (GPU or NPU): 50 TOPS for CV + anomaly models
    - 64 GB RAM (sensor ring buffers, twin state, model weights)
    - 2 TB NVMe SSD (72-hour telemetry buffer for offline operation)
    - Dual 10 GbE (OT network + IT network, physically separated)

Per factory: 20-100 edge gateways
  Total edge compute: 160-800 CPU cores, 1-5 PFLOPS AI inference capacity
```

### Computer Vision Pipeline

```
Cameras per factory: 300 inline inspection cameras (4K resolution, 30 fps)
Per camera inference:
  Image preprocessing (crop, normalize): 2 ms
  Defect detection model (Vision Transformer, INT8 quantized): 5 ms
  Classification + localization: 1 ms
  Decision + actuator trigger: 2 ms
  Total: ~10 ms end-to-end (within conveyor transit window)

GPU utilization per edge:
  2 cameras × 30 fps × 5 ms model inference = 300 ms GPU time per second
  30% GPU utilization per edge gateway → headroom for burst and model updates

Training data generation:
  300 cameras × 30 fps × 8 hours/shift × 2 shifts = ~518M frames/day
  Defect rate: ~0.1% → ~518K defect frames/day for training pipeline
  Storage: defect frames + 10x normal sampling = ~5.7M frames × 500 KB = 2.85 TB/day to cloud training store
```

### Predictive Maintenance

```
Assets monitored: 2,000 critical rotating equipment per factory
RUL refresh cycle: every 15 min per asset
  = 2,000 × 96 cycles/day = 192,000 RUL predictions/day per factory
  = ~2.2 predictions/sec

Per RUL prediction:
  Feature extraction (FFT, envelope analysis, kurtosis): 50 ms
  Model inference (survival model + gradient boosted ensemble): 20 ms
  Health index update + twin sync: 10 ms
  Total: ~80 ms per prediction → easily within 15-min cycle budget

Training data for RUL models:
  Run-to-failure data: rare (10-50 failure events per asset type per year)
  Physics-augmented: synthetic failure trajectories from digital twin simulation
  Transfer learning: pre-train on fleet-wide data; fine-tune per asset type
```

### Storage Summary

```
Per factory (daily):
  Edge raw telemetry buffer (72h rolling):  ~72 TB (retained on-edge NVMe)
  Cloud-forwarded telemetry:                ~430 GB/day
  CV inspection images (defect + sample):   ~2.85 TB/day
  Digital twin state snapshots:             ~50 GB/day
  PdM predictions + health indices:         ~5 GB/day
  Safety audit logs:                        ~1 GB/day

Multi-site cloud (annual):
  Telemetry: 50 factories × 430 GB × 365 = ~7.8 PB/year
  CV training images: 50 × 2.85 TB × 365 = ~52 PB/year (with lifecycle management)
  Model artifacts (all versions): ~500 GB
```

---

## Hardware and Infrastructure Cost Model

### Per-Factory Edge Infrastructure

| Component | Specification | Unit Cost | Count per Factory | Total |
|---|---|---|---|---|
| **Edge gateway (standard)** | 8-core ARM, 50 TOPS NPU, 64 GB RAM, 2 TB NVMe, dual 10 GbE | $8,000 | 80 | $640,000 |
| **Edge gateway (SIL-2 pair)** | Same spec + hot standby + hardware watchdog | $20,000 | 10 pairs | $200,000 |
| **Inline inspection camera** | 4K GigE Vision, 30 fps, industrial IP67 housing | $3,500 | 300 | $1,050,000 |
| **Safety LiDAR** | Industrial safety-rated, SIL-2 certified | $4,000 | 50 | $200,000 |
| **OT network switches** | Industrial managed, PROFINET/EtherCAT capable | $2,500 | 40 | $100,000 |
| **Data diode (hardware)** | Unidirectional, 1 Gbps, certified | $15,000 | 5 | $75,000 |
| **DMZ servers** | Historian + staging, redundant pair | $12,000 | 2 | $24,000 |
| **Factory total** | | | | **~$2.3M** |

### Cloud Infrastructure (Per-Factory Share)

| Component | Monthly Cost | Notes |
|---|---|---|
| **Telemetry stream processing** | $3,000 | 430 GB/day ingestion per factory |
| **Time-series storage (hot, 90 days)** | $5,000 | ~12 TB/factory at compressed rates |
| **CV training images (lifecycle managed)** | $4,000 | 2.85 TB/day with 90-day hot retention |
| **Twin engine compute** | $6,000 | Physics simulation for 10,000+ assets |
| **ML training GPU** | $8,000 | Shared cluster across factories; ~160 GPU-hours/factory/month |
| **Model registry + deployment** | $1,000 | Artifact storage, signing, OTA orchestration |
| **Per-factory cloud total** | **~$27,000/month** | $324K/year |

### Cost Optimization Levers

| Lever | Savings | Trade-off |
|---|---|---|
| Edge-side filtering (95% raw data reduction) | 95% cloud ingestion bandwidth | Lose raw waveform for forensic replay (mitigated by 72h edge buffer) |
| Archetype-based PdM (shared model per asset class) | 80% training compute | Slightly less per-asset customization |
| CV image lifecycle (90-day hot → delete non-defect) | 70% image storage | Cannot retrain on old normal images; mitigated by keeping defect frames permanently |
| Federated learning (model params, not raw data) | Eliminates cross-plant data transfer | Slower convergence than centralized training |
| Spot GPU instances for non-urgent training | 60% training GPU cost | Training job may be preempted; acceptable for weekly retraining cycles |

---

## Error Budget Policy

| SLO | Budget (per window) | Burn Rate Alert | Exhaustion Action |
|---|---|---|---|
| Edge inference ≤ 10 ms (99.999%) | 5 min/year | Alert at 2× burn (5h/month budget, alert if >10h/month burn) | Freeze model deployments; revert to last known-good model |
| Digital twin sync ≤ 100 ms (99.95%) | 4.4 h/year | Alert at 3× burn rate | Reduce twin physics simulation complexity; increase sync interval |
| PdM false positive ≤ 5% (30-day rolling) | 5% per 30 days | Alert at 7% (3 consecutive days) | Increase PdM confidence threshold; switch to "observation" tickets only |
| CV defect escape ≤ 100 DPM | 100 defective parts per million | Alert at 150 DPM (any production batch) | Slow line speed; add manual inspection station; trigger emergency model retraining |
| Safety zone response ≤ 50 ms (100%) | 0 violations | Any single violation | Production line immediate stop; safety officer investigation; no restart until cleared |

---

## SLO Summary

| SLO | Target | Measurement Window |
|---|---|---|
| Edge inference p99 (safety-critical) | ≤ 10 ms | Continuous |
| Digital twin sync lag p95 | ≤ 100 ms | Rolling 1-hour |
| PdM false positive rate | ≤ 5% | Rolling 30-day |
| CV defect escape rate (missed defects) | ≤ 0.01% (100 DPM) | Per production batch |
| Schedule re-optimization | ≤ 2 min | Per disruption event |
| Edge availability (safety-critical) | 99.999% | Annual |
| Cloud analytics availability | 99.9% | Monthly |
| Sensor data loss during cloud outage | 0% | Per outage event |
| Safety audit log durability | 99.9999999% | Continuous |
| Model deployment to edge fleet | ≤ 4 hours for full factory rollout | Per deployment |
| PdM recall (failure prediction) | ≥ 70% (predicted ≥ 24h in advance) | Rolling 90-day |
| Worker safety response time | ≤ 50 ms detection to machine stop | Continuous |
| Reconnection delta sync | ≤ 30 min for full sync after 72h outage | Per outage recovery |

---

## Capacity Planning Summary

| Dimension | Per Factory | 50 Factories (Fleet) |
|---|---|---|
| Raw sensor data generated | 24 TB/day | 1.2 PB/day |
| Cloud-forwarded telemetry | 430 GB/day | 21.5 TB/day |
| Edge compute nodes | 80 gateways | 4,000 gateways |
| CV cameras | 300 | 15,000 |
| CV inferences | 9,000/sec | 450,000/sec |
| PdM predictions | 192,000/day | 9.6M/day |
| Digital twin assets | 10,000 | 500,000 |
| ML models deployed | 1,000 | 50,000 |
| Safety audit log entries | ~1M/day | ~50M/day |
| Edge NVMe storage (72h buffer) | 72 TB | 3.6 PB |
| Cloud hot storage (90-day) | ~12 TB | ~600 TB |
| Annual cloud storage | ~160 TB | ~8 PB |
