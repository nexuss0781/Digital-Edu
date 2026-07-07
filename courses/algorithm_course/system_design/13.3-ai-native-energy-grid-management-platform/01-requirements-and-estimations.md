# 13.3 AI-Native Energy & Grid Management Platform — Requirements & Estimations

## Functional Requirements

| # | Requirement | Notes |
|---|---|---|
| FR-01 | **Real-time grid state estimation** — Ingest SCADA telemetry (voltage, current, power flow, breaker status) from substations; compute grid state vector every 4 seconds; detect topology changes and equipment anomalies | Supports 50,000+ measurement points; state estimation completes within 2 seconds |
| FR-02 | **Optimal power flow dispatch** — Continuously solve OPF to determine generator set points, transformer tap positions, and capacitor bank switching that minimize generation cost while satisfying physical constraints | Dispatch signals issued every 4 seconds; N-1 contingency screening on every state update |
| FR-03 | **Renewable generation forecasting** — Produce probabilistic solar and wind generation forecasts at plant and aggregate levels using ensemble NWP post-processing; detect and alert on ramp events | Quantile forecasts (P10, P25, P50, P75, P90) at 15-minute granularity; ramp alerts for >30% change within 60 minutes |
| FR-04 | **Demand response orchestration** — Manage DR programs across residential, commercial, and industrial customers; dispatch load curtailment and shifting signals via OpenADR 3.0 and IEEE 2030.5 | Support 5M+ enrolled DERs; granular dispatch (per-device, per-zone); stagger signals to prevent rebound peaks |
| FR-05 | **Virtual power plant management** — Aggregate heterogeneous DERs (rooftop solar, batteries, EVs, smart thermostats, commercial HVAC) into virtual generation units; bid aggregated capacity into energy and ancillary service markets | Portfolio of 2M+ DERs; real-time availability tracking; co-optimized energy + frequency regulation bidding |
| FR-06 | **Smart meter data management** — Ingest interval meter reads (15-minute, 5-minute, or sub-minute) from AMI head-end systems; validate, estimate missing reads, and publish to downstream analytics | 10M meters; ~1B readings/day; support meter data validation/estimation/editing (VEE) |
| FR-07 | **Electricity theft detection** — Analyze consumption patterns across smart meter data to detect non-technical losses (meter tampering, bypass, unauthorized connections) | ML-based anomaly detection with <5% false positive rate; flag suspicious meters for field investigation |
| FR-08 | **Outage prediction and management** — Predict equipment failures using sensor data, weather forecasts, and vegetation satellite imagery; support FLISR (fault location, isolation, service restoration) | Predict transformer failures 7+ days in advance; FLISR automated isolation within 60 seconds |
| FR-09 | **Energy market bidding** — Automate participation in day-ahead, real-time, and ancillary service markets; optimize bid strategy under renewable uncertainty; settle positions against market clearing prices | Day-ahead bids submitted by market deadline (typically 10 AM day before); real-time adjustments every 5 minutes |
| FR-10 | **DER device management** — Register, authenticate, and manage lifecycle of distributed energy resources; issue firmware updates; monitor device health and communication status | Support IEEE 2030.5 device registration; OCPP 2.0 for EV chargers; real-time heartbeat monitoring |
| FR-11 | **Grid contingency analysis** — Continuously run N-1 contingency screening; identify potential cascading failures; pre-compute remedial action schemes (RAS) for critical contingencies | Full N-1 screening completes within 30 seconds; N-2 analysis for high-risk scenarios |
| FR-12 | **Customer energy analytics** — Provide customers with consumption insights, bill projections, solar generation analytics, and EV charging optimization recommendations | Near-real-time dashboard updated every 15 minutes; historical comparison and peer benchmarking |
| FR-13 | **Storm damage forecasting** — Combine weather forecasts with infrastructure vulnerability models and vegetation analysis to predict storm damage zones and pre-position restoration crews | Damage zone predictions 24–72 hours ahead; automatic crew dispatch optimization |
| FR-14 | **Regulatory reporting** — Generate compliance reports for NERC reliability standards, state renewable portfolio standards, interconnection queue management, and emissions tracking | Automated report generation; tamper-evident audit trails for all control actions |

---

## Out of Scope

- **Power plant construction and permitting** — Generation planning, site selection, and environmental impact assessment
- **Retail energy billing** — Customer billing, payment processing, rate design, and collections (separate CIS/billing system)
- **Wholesale energy trading** — Speculative energy trading, financial derivatives, and risk management beyond physical asset optimization
- **Transmission planning** — Long-term transmission expansion planning and interconnection studies (separate planning tools)
- **Building energy management** — Inside-the-building HVAC, lighting, and plug load optimization (separate BEMS)

---

## Non-Functional Requirements

### Performance SLOs

| Metric | Target | Rationale |
|---|---|---|
| Grid state estimation latency (p99) | ≤ 2 s | Must complete within SCADA 4-second scan cycle to enable continuous OPF |
| OPF dispatch computation (p99) | ≤ 3 s | Dispatch signals must be issued within the same SCADA cycle as state estimation |
| Renewable forecast update latency | ≤ 5 min from NWP data arrival | Stale forecasts cause suboptimal dispatch and market position errors |
| DR signal delivery (p99) | ≤ 10 s from dispatch decision | DER must receive curtailment signal before grid frequency deviation worsens |
| VPP dispatch-to-response verification | ≤ 30 s | Must verify DER actually responded to dispatch signal via telemetry |
| Meter data ingestion (p99) | ≤ 60 s from AMI head-end delivery | Revenue metering must be timely for billing accuracy |
| Theft detection alert latency | ≤ 24 h from pattern onset | Balance detection speed with false positive minimization |
| FLISR automated isolation | ≤ 60 s from fault detection | Minimize customer minutes interrupted (CMI) |

### Reliability & Availability

| Metric | Target |
|---|---|
| Grid control plane availability | 99.999% (≤ 5.3 min downtime/year) — grid control is safety-critical |
| Renewable forecast service availability | 99.95% — degraded dispatch during outage, not catastrophic |
| VPP dispatch availability | 99.99% — market penalties for non-delivery |
| AMI data ingestion availability | 99.9% — batch catch-up acceptable for billing |
| Market bidding availability | 99.99% — missed bids have direct financial impact |
| SCADA telemetry durability | Zero data loss — regulatory requirement for control action audit |
| Event ordering guarantee | Per-device causal ordering for all SCADA and DER telemetry |

### Scalability

| Metric | Target |
|---|---|
| SCADA measurement points | 50,000+ measurement points per control area |
| Smart meters managed | 10M meters per utility |
| Meter readings processed per day | ~1B readings/day (10M meters × 96 readings at 15-min intervals) |
| DERs orchestrated concurrently | 5M DERs (solar, battery, EV, thermostat) |
| VPP portfolios managed | 500 VPPs with 10,000–50,000 DERs each |
| Concurrent N-1 contingency scenarios | 5,000+ contingency cases per screening cycle |
| Renewable forecast models | 200+ solar/wind plants with 15-minute resolution |
| Market bids generated per day | 10,000+ bid segments across energy + ancillary markets |

### Security & Compliance

| Requirement | Specification |
|---|---|
| NERC CIP compliance | CIP-002 through CIP-014: BES cyber system identification, access control, network segmentation, change management |
| SCADA network isolation | Air-gapped or DMZ-separated OT network; no direct IT-OT connectivity |
| DER authentication | IEEE 2030.5 certificate-based mutual TLS; per-device PKI enrollment |
| Customer data privacy | GDPR / CCPA compliance for smart meter data; granular consent management |
| Audit trail | Tamper-evident logging of every control action, operator command, and automated dispatch decision |
| Encryption | TLS 1.3 for all data in transit; AES-256 for data at rest; hardware security modules for key management |

---

## Capacity Estimations

### SCADA Telemetry Volume

**Assumptions:**
- 50,000 measurement points across substations and feeders
- SCADA scan rate: every 4 seconds
- Per measurement: voltage, current, power, reactive power, breaker status

```
SCADA telemetry rate:
  50,000 measurements / 4 sec = 12,500 measurements/sec (steady state)
  Per measurement: ~200 bytes (point_id, timestamp, value, quality_flag, status)
  Daily: 12,500 × 86,400 × 200 bytes = ~216 GB/day
  30-day hot retention: ~6.5 TB
  7-year regulatory retention (compressed 10x): ~5.6 TB
```

### Smart Meter (AMI) Data Volume

```
Meter reading ingestion:
  10M meters × 96 readings/day (15-min intervals) = 960M readings/day
  Peak hour (evening ramp 5-8 PM): 3x concentration = ~120,000 readings/sec
  Per reading: ~150 bytes (meter_id, timestamp, kWh, kW, voltage, power_factor)
  Daily: 960M × 150 bytes = ~144 GB/day (uncompressed)
  Monthly: ~4.3 TB/month
  With 5x compression (time-series columnar encoding): ~860 GB/month
  3-year retention for analytics: ~31 TB compressed
  Sub-minute metering (5M meters at 1-min intervals):
    5M × 1,440 readings/day = 7.2B readings/day = ~1.08 TB/day
```

### Renewable Forecast Compute

```
Forecast pipeline:
  200 solar/wind plants × 5 NWP ensemble members × 96 time steps (15-min, 24h horizon)
  Per forecast run: 200 × 5 × 96 = 96,000 quantile regression inferences
  Inference time: ~50 ms per (lightweight gradient-boosted model)
  Total: 96,000 × 50 ms = 4,800 seconds single-threaded
  Parallelized across 20 workers: 240 seconds = 4 minutes per forecast cycle
  Forecast cycles per day: 96 (every 15 minutes)
  Daily compute: 96 × 4 min = 384 minutes = 6.4 hours of worker time

NWP input data:
  5 ensemble models × 50 MB per model update × 4 updates/day = 1 GB/day
  Historical NWP archive (3 years for model training): ~1 TB
```

### VPP Dispatch and DER Telemetry

```
DER telemetry:
  5M DERs reporting status every 60 seconds = 83,333 messages/sec
  Per message: ~300 bytes (device_id, type, SoC/generation/consumption, availability_flag)
  Daily: 83,333 × 86,400 × 300 bytes = ~2.2 TB/day
  With 8x compression: ~275 GB/day stored
  30-day retention: ~8.3 TB

VPP dispatch:
  500 VPPs × average 20,000 DERs each = 10M dispatch targets
  Dispatch cycles: every 4 seconds for frequency regulation, every 5 min for energy market
  Frequency regulation: 500 VPPs × 1 aggregate signal/4s = 125 signals/sec
  Energy dispatch: 10M individual signals every 5 min = 33,333 signals/sec (peak)
```

### Grid Optimization Compute

```
State estimation:
  50,000 measurements → weighted least squares estimation
  Matrix dimensions: ~20,000 × 20,000 (bus-level state vector)
  Solve time: ~500 ms on modern hardware (sparse matrix factorization)

Optimal power flow:
  SOCP relaxation with 20,000 buses, 30,000 branches
  Solve time: ~1.5 seconds using interior-point method
  Contingency screening: 5,000 N-1 cases × simplified DC power flow (~5 ms each)
  Total N-1 screening: 5,000 × 5 ms = 25 seconds
  Parallelized across 50 cores: ~500 ms per screening cycle

Combined cycle (state est + OPF + N-1 screening):
  500 ms + 1,500 ms + 500 ms = 2,500 ms < 4,000 ms SCADA cycle ✓
```

### Market Bidding

```
Day-ahead bid optimization:
  24 hours × 12 intervals per hour × 500 VPPs × (energy + 3 ancillary products)
  = 576,000 bid segments per day-ahead submission
  Stochastic optimization with 100 renewable scenarios: ~10 minutes solve time
  Must complete by market submission deadline (typically 10 AM)

Real-time market:
  5-minute intervals × 500 VPPs = 100 position updates per 5-minute window
  Solve time per VPP: ~2 seconds
  Parallelized: all 500 VPPs solved within 5-minute window ✓
```

### Storage Summary

```
SCADA telemetry (30-day hot):           ~6.5 TB
SCADA audit trail (7-year):            ~5.6 TB (compressed)
Smart meter readings (3-year):          ~31 TB (compressed)
DER telemetry (30-day):                ~8.3 TB (compressed)
NWP archive (3-year):                  ~1 TB
Renewable forecast history (1-year):    ~500 GB
Grid state snapshots (30-day):          ~2 TB
Market bid/settlement history (3-year): ~200 GB
Outage prediction model artifacts:      ~100 GB
Customer analytics aggregations:        ~500 GB
```

---

## SLO Summary

| SLO | Target | Measurement Window |
|---|---|---|
| Grid state estimation p99 | ≤ 2 s | Rolling 1-minute |
| OPF dispatch p99 | ≤ 3 s | Rolling 1-minute |
| N-1 contingency screening | ≤ 30 s full cycle | Per SCADA cycle |
| Renewable forecast freshness | ≤ 5 min from NWP arrival | Per forecast cycle |
| DR signal delivery p99 | ≤ 10 s | Per dispatch event |
| VPP dispatch verification p99 | ≤ 30 s | Per dispatch cycle |
| AMI data ingestion p99 | ≤ 60 s | Rolling 1-hour |
| Theft detection alert latency | ≤ 24 h | Per pattern detection |
| FLISR automated isolation | ≤ 60 s | Per fault event |
| Grid control plane availability | 99.999% | Annual |
| Market bidding availability | 99.99% | Monthly |
| AMI pipeline availability | 99.9% | Monthly |

---

## SLO Error Budgets and Burn-Rate Alerts

| SLO | Budget (30-day) | 1h Burn-Rate Alert | 6h Burn-Rate Alert | Escalation |
|---|---|---|---|---|
| Grid state estimation ≤ 2 s (p99) | 432 missed cycles (0.001% of 43.2M cycles/month) | > 5 missed/hour (120× normal) | > 15 missed/6h (60× normal) | SEV-1: Grid operating in open-loop mode |
| OPF dispatch ≤ 3 s (p99) | 432 missed cycles | > 5 missed/hour | > 15 missed/6h | SEV-1: Dispatch stale, manual operator intervention |
| N-1 screening ≤ 30 s | 4,320 late cycles (0.01%) | > 10 late/hour | > 30 late/6h | SEV-2: Extended contingency exposure |
| DR signal delivery ≤ 10 s (p99) | 0.01% of signals | > 3 failed deliveries/event | > 10 failed/day | SEV-2: DR program reliability impaired |
| VPP dispatch verification ≤ 30 s | 0.01% of verifications | > 5% unverified in window | > 2% sustained 6h | SEV-2: Market penalty exposure |
| AMI ingestion ≤ 60 s (p99) | 0.1% of readings | Queue depth > 5M | Queue depth > 10M for 2h | SEV-3: Billing and analytics delayed |
| Grid control plane 99.999% | 26.3 seconds/month | Any downtime > 10 s | Cumulative > 20 s/week | SEV-1: Immediate failover to backup center |
| Market bidding 99.99% | 4.3 minutes/month | Any downtime > 2 min | Cumulative > 3 min/week | SEV-2: Manual bid submission required |

---

## Hardware and Cost Estimations

### Compute Infrastructure

| Component | Specification | Count | Rationale |
|---|---|---|---|
| **OT Control Cluster (primary)** | 64-core, 512 GB RAM, FPGA co-processor for sparse matrix ops | 8 servers | State estimation + OPF + contingency screening; dedicated cores, no resource sharing |
| **OT Control Cluster (backup)** | Identical to primary | 8 servers | Backup control center; hot standby with <30 s failover |
| **SCADA Front-End Processors** | 16-core, 64 GB RAM, dual 10 GbE | 6 (3 primary + 3 backup) | Triple-redundant; each handles ~17K measurement points |
| **DER Communication Gateways** | 8-core, 32 GB RAM | 100 instances | 50K DERs each at 833 msg/sec; stateless behind load balancer |
| **AMI Ingestion Workers** | 8-core, 32 GB RAM | 768 peak / 256 baseline | Pre-scheduled auto-scaling for midnight surge |
| **Forecast Compute** | 32-core, 128 GB RAM, GPU (optional for deep learning ensemble) | 20 workers | Parallelized quantile regression across 200 plants × 5 NWP models |
| **Market Bidding Optimizer** | 64-core, 256 GB RAM | 4 servers | Stochastic optimization with 200 scenarios; Benders decomposition |
| **Theft Detection Batch** | 8-core, 32 GB RAM | 1,000 workers (ephemeral) | Daily batch: 10M meters × 50 ms feature computation + 1 ms scoring |
| **Substation Edge Compute** | Ruggedized 8-core, 32 GB, 1 TB SSD | 500 units | One per substation; local FLISR, voltage regulation, DER monitoring |

### Storage Infrastructure

| Store | Technology | Capacity | Cost Driver |
|---|---|---|---|
| **SCADA Time-Series (hot)** | In-memory ring buffer + SSD-backed time-series DB | 17 GB (ring) + 6.5 TB (30-day) | Low-latency read for real-time control; DRAM cost for ring buffer |
| **SCADA Audit Archive** | Write-once append store, cryptographic chaining | 5.6 TB (7-year compressed) | Tamper-evident; NERC CIP retention mandate |
| **AMI Hot Tier** | Columnar time-series DB on NVMe SSD | 4.3 TB/month × 1 month = 4.3 TB | 15-minute resolution; real-time billing/analytics queries |
| **AMI Warm Tier** | Columnar analytics store | 860 GB/month × 36 months = 31 TB | 90-day theft features; daily rollups for analytics |
| **AMI Cold Tier** | Object storage, Parquet format | 200 GB/month × 84 months = 16.8 TB | Regulatory retention; infrequent access |
| **DER Telemetry** | Time-series DB with tag-based partitioning | 275 GB/day × 30 days = 8.3 TB | 60-second resolution; device-level queries for dispatch verification |
| **Forecast Store** | Time-series with quantile columns | 500 GB (1-year history) | Forecast vs. actuals for model retraining; calibration monitoring |
| **Grid Model DB** | Relational with spatial extensions | 50 GB | Network topology, equipment registry, protection settings |
| **Market Position Store** | Relational with ACID transactions | 200 GB (3-year) | Bid/settlement audit trail; financial reconciliation |

### Network Bandwidth

| Path | Bandwidth Required | Protocol | Redundancy |
|---|---|---|---|
| SCADA substations → control center | 50 Mbps aggregate (500 substations × 100 Kbps) | DNP3 over TCP/IP via MPLS | Dual fiber + cellular backup per substation |
| AMI head-end → ingestion gateway | 200 Mbps peak (midnight surge) | TLS 1.3 | Dual path; 10-minute buffer in message queue |
| DER devices → communication gateway | 400 Mbps (5M devices × 300 bytes/min) | IEEE 2030.5 / OCPP 2.0 over TLS | Multi-path: cellular + Wi-Fi + mesh radio |
| NWP data feeds → forecast service | 50 Mbps burst (1 GB per NWP update × 4/day) | HTTPS from meteorological agencies | Multi-provider redundancy (5-10 NWP sources) |
| OT → IT data diode | 100 Mbps sustained | Hardware-enforced unidirectional fiber | Dual data diodes for availability |
| IT → OT command proxy | 10 Mbps (rate-limited: 100 commands/sec × 1 KB) | TLS 1.3 with mutual authentication | Active-standby proxy pair |
| Control center → backup center | 1 Gbps (synchronous state replication) | Dedicated dark fiber | Geographically diverse routing |

---

## 3-Year Growth Projections

| Metric | Year 1 | Year 2 | Year 3 | Growth Driver |
|---|---|---|---|---|
| Smart meters managed | 10M | 14M | 18M | AMI rollout completion; sub-minute metering expansion |
| DERs orchestrated | 5M | 12M | 25M | EV adoption (30% CAGR); battery storage mandates; V2G scaling |
| VPP portfolios | 500 | 1,200 | 3,000 | FERC Order 2222 market entry; community aggregation growth |
| Renewable plants forecasted | 200 | 400 | 700 | Solar/wind buildout; distributed generation interconnection queue |
| SCADA measurement points | 50K | 65K | 80K | Grid modernization; PMU (phasor measurement unit) deployment |
| Market bid segments/day | 576K | 1.4M | 4.2M | More VPPs × more products × finer granularity (15-min markets) |
| DER telemetry (daily) | 2.2 TB | 5.3 TB | 11 TB | Device count growth + higher reporting frequency (30 s → 15 s) |
| AMI readings/day | 960M | 2B | 5.8B | More meters + transition from 15-min to 5-min intervals |

---

## Scope Boundaries and Rationale

| Area | In Scope | Out of Scope | Rationale |
|---|---|---|---|
| **Grid optimization** | Real-time OPF, state estimation, N-1 contingency | Transmission expansion planning, interconnection studies | Planning uses different tools (year-horizon); real-time operation is the AI-native value |
| **Renewable forecasting** | Probabilistic generation forecasts, ramp detection | NWP model development, satellite imagery processing | NWP models developed by meteorological agencies; we consume their output |
| **DER management** | Dispatch, availability modeling, market bidding | DER installation, permitting, interconnection application | Physical installation is a separate field service process |
| **Smart metering** | Ingestion, VEE, theft detection, load analytics | Meter hardware design, AMI RF network management | RF network managed by AMI vendor; we consume head-end output |
| **Market operations** | Automated bidding, settlement, position management | Market rule design, regulatory proceedings, tariff design | Market rules set by ISO/RTO; we participate within existing rules |
| **Customer analytics** | Consumption insights, bill projection, solar analytics | Customer billing, payment processing, collections | Billing is a separate CIS system; we provide data feeds |

---

## Critical Constraints and Assumptions

| Constraint | Source | Impact on Design |
|---|---|---|
| 4-second SCADA cycle | Physics (grid frequency stability) | All control-path computation budgeted within this window; no queuing, no retries |
| Zero SCADA data loss | NERC CIP regulatory requirement | Synchronous replication to backup; write-ahead log; tamper-evident audit |
| IT/OT air gap | NERC CIP-005 | Dual infrastructure; data diode + command proxy; doubled hardware cost |
| 35-day change management | NERC CIP-010 | OT software updates require 35-day advance notification; no hot patches |
| GPS time synchronization | Phasor measurement unit standards (IEEE C37.118) | All SCADA timestamps ±1 μs; GPS receivers at every substation |
| Customer consent for granular data | GDPR / CCPA | Load disaggregation opt-in; minimum peer group size 15; differential privacy |
| Market submission deadlines | ISO/RTO market rules | Day-ahead bids by 10 AM; real-time adjustments every 5 minutes; no late submissions |
| DER communication diversity | Device manufacturer ecosystem | Must support IEEE 2030.5, OpenADR 3.0, OCPP 2.0, and proprietary protocols simultaneously |

---

## Derived Performance Budgets

The 4-second SCADA cycle imposes a strict time budget that cascades through the entire control pipeline:

```
SCADA Cycle Time Budget (4,000 ms total):

  ┌─ SCADA scan reception + validation ───── 200 ms
  │
  ├─ Topology processing ──────────────────── 50 ms
  │   (breaker status → network model update)
  │
  ├─ State estimation (WLS) ──────────────── 500 ms
  │   (400 ms compute + 100 ms safety margin)
  │
  ├─ OPF solve (SOCP relaxation) ─────────── 1,500 ms
  │   (interior-point method)
  │
  ├─ Contingency screening (500 critical) ── 500 ms
  │   (parallelized DC power flow)
  │
  ├─ RAS computation + arming ────────────── 200 ms
  │   (only if violations detected)
  │
  ├─ Command validation + signing ──────────  50 ms
  │
  ├─ Dispatch signal transmission ──────────  200 ms
  │   (DNP3 to RTUs/generators)
  │
  └─ Safety margin ────────────────────────── 800 ms
      (absorbs variance; never consumed)

  Total committed: 3,200 ms
  Safety margin: 800 ms (20%)
```

**Key constraint:** If any stage exceeds its budget, downstream stages are compressed. The safety margin is consumed first; if fully consumed, contingency screening is reduced from 500 to 100 cases; if still insufficient, OPF switches to DC approximation (saves 800 ms, costs 1–3% dispatch suboptimality).
