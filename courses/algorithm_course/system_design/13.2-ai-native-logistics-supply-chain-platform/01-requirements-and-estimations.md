# 13.2 AI-Native Logistics & Supply Chain Platform — Requirements & Estimations

## Functional Requirements

| # | Requirement | Notes |
|---|---|---|
| FR-01 | **Multi-modal shipment visibility** — Ingest GPS, EDI, AIS (ocean), ADS-B (air), and RFID signals from carriers; normalize into a unified shipment event stream with real-time ETA prediction | ETA updated every 5 minutes; supports 80,000+ carriers across road, rail, ocean, and air |
| FR-02 | **Vehicle route optimization** — Solve capacitated VRP with time windows, multi-depot, and heterogeneous fleet constraints; support continuous re-optimization as new orders and real-time conditions arrive | Re-optimization cycle ≤ 5 seconds for incremental changes; full re-plan within 30 seconds |
| FR-03 | **Hierarchical demand forecasting** — Generate probabilistic demand forecasts at SKU-location-day granularity; reconcile across product, geography, and time hierarchies | Quantile forecasts (P10, P25, P50, P75, P90) with coherent reconciliation; daily forecast refresh |
| FR-04 | **Warehouse orchestration** — Coordinate AMR fleets, human pickers, conveyor systems, and automated storage/retrieval systems (AS/RS); optimize pick paths and wave planning in real time | Digital twin of warehouse floor state; collision-free AMR path planning; dynamic slotting |
| FR-05 | **Fleet telematics management** — Ingest vehicle sensor data (engine diagnostics, tire pressure, fuel level, temperature); compute predictive maintenance schedules and driver safety scores | 1M+ vehicles; telematics pings every 15–30 seconds per vehicle |
| FR-06 | **Last-mile delivery optimization** — Dynamic route planning with real-time re-routing; customer-facing live ETA tracking; proof-of-delivery capture (photo, signature, GPS) | Re-routing every 60 seconds based on traffic, cancellations, and new orders |
| FR-07 | **Inventory intelligence** — Compute safety stock levels from probabilistic forecasts; generate replenishment recommendations; detect slow-moving and dead stock | Safety stock parameterized by service level target and forecast uncertainty |
| FR-08 | **Cold chain monitoring** — Continuous temperature and humidity tracking via IoT sensors on refrigerated shipments; automated excursion detection and alerting | Compliance with FDA FSMA, HACCP, EU GDP; sensor readings every 60 seconds |
| FR-09 | **Supply chain disruption detection** — Monitor external signals (weather, port congestion, geopolitical events, carrier capacity) and internal anomalies (shipment trajectory deviation); classify disruption severity and recommend mitigation | ML-based anomaly detection with automated re-routing for affected shipments |
| FR-10 | **Carrier connectivity and onboarding** — API-first carrier integration with support for EDI (204/214/990), API-based tracking, and telematics feed ingestion; self-service carrier onboarding | Target: 95% of carrier connections live within minutes, not weeks |
| FR-11 | **Order orchestration** — Accept orders from multiple channels (ERP, e-commerce, EDI); apply business rules for carrier selection, mode optimization, and consolidation | Multi-leg shipment planning with intermodal optimization |
| FR-12 | **What-if simulation** — Enable planners to simulate disruption scenarios, demand spikes, carrier capacity changes, and route alternatives before committing to operational changes | Simulation completes within 60 seconds for networks with 500+ nodes |
| FR-13 | **Customer-facing delivery tracking** — Provide branded tracking pages with real-time shipment status, live map, and proactive delay notifications via SMS/email/push | Sub-second page load; proactive notification within 5 minutes of status change |
| FR-14 | **Analytics and reporting** — Carrier scorecards, on-time delivery rates, cost-per-shipment analysis, warehouse productivity, forecast accuracy dashboards | Pre-computed daily aggregations; drill-down to individual shipment level |

---

## Out of Scope

- **Customs brokerage and trade compliance** — Tariff classification, duty calculation, and customs filing (separate trade management system)
- **Freight payment and audit** — Invoice matching, carrier payment processing, and rate auditing (separate financial system)
- **Procurement and sourcing** — Supplier selection, RFQ management, and contract negotiation
- **Manufacturing execution** — Shop floor scheduling, machine control, and production tracking (upstream MES)
- **Returns and reverse logistics** — Return authorization, refurbishment, and secondary market logistics
- **Fleet acquisition and leasing** — Vehicle procurement, leasing agreements, and depreciation management
- **Driver recruitment and training** — HR functions for driver hiring, certification, and ongoing training programs

### Scope Boundaries Rationale

The platform focuses on **operational intelligence** (real-time decisions about routing, forecasting, warehouse operations, and visibility) rather than **transactional processing** (payment, customs filing, procurement). This boundary is drawn because operational intelligence requires a unified real-time data architecture (shared telemetry streams, cross-subsystem event propagation), while transactional systems have fundamentally different consistency and latency requirements (exact financial amounts, regulatory filing deadlines, supplier contract terms). Integration with out-of-scope systems happens through well-defined API contracts and event-driven interfaces, not through shared databases.

---

## Non-Functional Requirements

### Performance SLOs

| Metric | Target | Rationale |
|---|---|---|
| Route re-optimization latency (p99) | ≤ 5 s | Drivers waiting for updated route during active delivery |
| ETA prediction update latency (p95) | ≤ 30 s from telemetry arrival | Customer and shipper visibility depends on fresh ETAs |
| Demand forecast generation (daily batch) | ≤ 4 h for 10M SKU-location combinations | Must complete overnight before replenishment planning runs |
| Warehouse pick-path computation (p99) | ≤ 500 ms | AMR must receive next task before completing current one |
| Shipment event ingestion (p99) | ≤ 2 s from source to queryable state | Real-time visibility requires near-instant event processing |
| Cold chain excursion alert latency | ≤ 60 s from sensor reading to alert | Perishable goods require immediate intervention |

### Reliability & Availability

| Metric | Target |
|---|---|
| Platform availability | 99.95% (≤ 22 min downtime/month) |
| Route optimization availability | 99.99% (route engine is operationally critical) |
| Shipment tracking availability | 99.9% |
| Warehouse orchestration availability | 99.99% (AMR fleet stops if orchestration is down) |
| Telemetry ingestion durability | No data loss; at-least-once processing |
| Event ordering guarantee | Per-shipment causal ordering preserved |

### Scalability

| Metric | Target |
|---|---|
| Active shipments tracked concurrently | 5M shipments |
| GPS/telemetry pings ingested per second | 200,000 pings/sec (1M vehicles × 1 ping every 5 seconds at peak) |
| Warehouse AMR coordination | 2,000 AMRs per warehouse; 500 warehouses |
| Demand forecast coverage | 10M SKU-location combinations |
| Daily route optimization problems solved | 50,000 VRP instances (one per depot per planning horizon) |
| Last-mile deliveries per day | 10M deliveries |
| Carrier integrations | 80,000+ carriers across all modes |

### Security & Compliance

| Requirement | Specification |
|---|---|
| Shipment data confidentiality | Customer shipment data isolated per tenant; no cross-tenant visibility |
| Driver data privacy | GDPR compliance for driver telematics (location tracking); driver consent; data minimization |
| Cold chain compliance | FDA FSMA, HACCP, EU GDP continuous temperature logging with tamper-evident audit trail |
| Customs security | CTPAT (US), AEO (EU) certified data handling for cross-border shipments |
| API security | OAuth 2.0 + mTLS for carrier API integrations; per-carrier API key rotation |

---

## Capacity Estimations

### Shipment Telemetry Volume

**Assumptions:**
- 5M active shipments tracked concurrently
- Average shipment duration: 5 days
- GPS/status update frequency: every 5 minutes (road), every 1 hour (ocean), every 15 minutes (rail/air)
- Weighted average: ~1 update per shipment every 8 minutes

```
Telemetry event rate:
  5M shipments / 8 min = 625,000 events/min = ~10,400 events/sec (baseline)
  Peak (morning dispatch + evening delivery surge): 3x = ~31,200 events/sec

Per event size:
  {shipment_id, carrier_id, lat, lon, timestamp, speed, heading, temp, humidity, battery}
  ~500 bytes per event

Daily telemetry volume:
  10,400 events/sec × 86,400 sec/day × 500 bytes = ~449 GB/day
  With 3x peak headroom storage: ~1.3 TB/day raw telemetry
  30-day hot retention: ~40 TB
  1-year warm retention (compressed 5x): ~33 TB
```

### Fleet Telematics (Vehicle Sensors)

```
Vehicle sensor data:
  1M vehicles × 1 ping every 15 seconds = 66,667 pings/sec
  Each ping: ~1 KB (engine diagnostics, tire pressure, fuel, location, driver behavior)
  Daily: 66,667 × 86,400 × 1 KB = ~5.7 TB/day
  With 10x compression (time-series encoding): ~570 GB/day stored

Predictive maintenance model input:
  Per vehicle: rolling 30-day sensor history = ~170 MB per vehicle
  Full fleet: 1M × 170 MB = ~170 TB (hot storage for ML inference)
  Solution: Compute features incrementally; store only aggregated features (~5 KB/vehicle)
  Aggregated feature store: 1M × 5 KB = 5 GB (fits in memory)
```

### Route Optimization

```
VRP instance characteristics:
  Typical instance: 200 vehicles, 3,000 stops, 8-hour time windows
  Solver time budget: 5 seconds for incremental re-optimization
  Full solve time budget: 30 seconds for daily plan

Daily VRP instances:
  50,000 instances/day (one per depot per shift)
  Each instance solution: ~50 KB (vehicle assignments, stop sequences, ETAs)
  Daily output: 50,000 × 50 KB = 2.5 GB

Route optimization compute:
  Solver: CPU-bound (metaheuristic search)
  Per instance: 4–8 CPU cores for 5 seconds = 20–40 CPU-seconds
  Throughput: 50,000 instances/day = ~0.6 instances/sec
  Peak (morning planning 6–8 AM): 10x concentration = 6 instances/sec
  Cores needed at peak: 6 × 40 = 240 CPU cores dedicated to route optimization
```

### Demand Forecasting

```
Forecast universe:
  10M SKU-location combinations
  Each forecast: 90-day horizon × 5 quantiles = 450 numbers × 4 bytes = 1.8 KB
  Total forecast store: 10M × 1.8 KB = 18 GB (fits in memory)

Daily forecast refresh:
  Model inference: ~10 ms per SKU-location (lightweight gradient-boosted model)
  Total: 10M × 10 ms = 100,000 seconds of model inference
  Parallelized across 100 workers: 1,000 seconds = ~17 minutes
  Hierarchical reconciliation (MinT): 30 minutes for full hierarchy
  Total daily forecast pipeline: ~47 minutes (well within 4-hour SLO)

Training data:
  3 years of daily demand history × 10M SKU-locations × 50 bytes per record
  = ~548 TB (stored in columnar format, compressed to ~55 TB)
  Model retraining: weekly, on rolling 2-year window
```

### Warehouse Operations

```
Per warehouse:
  2,000 AMRs × position update every 1 second = 2,000 pings/sec per warehouse
  500 warehouses × 2,000 pings/sec = 1M pings/sec platform-wide

Pick-path optimization:
  1,000 pick tasks/hour per warehouse × 500 warehouses = 500,000 tasks/hour
  = ~139 tasks/sec platform-wide
  Each optimization: ~50 ms (graph shortest path with obstacle avoidance)

Digital twin state:
  Per warehouse: ~200 MB (bin occupancy, AMR positions, conveyor status, zone temperatures)
  500 warehouses: ~100 GB total digital twin state (distributed, per-warehouse sharding)
```

### Storage Summary

```
Shipment telemetry (30-day hot):   ~40 TB
Fleet telematics (30-day):         ~17 TB (compressed)
Demand history (3-year):           ~55 TB (columnar, compressed)
Route solutions (90-day):          ~225 GB
Forecast store:                    ~18 GB
Warehouse digital twin:            ~100 GB
Cold chain audit trail (7-year):   ~15 TB
Shipment lifecycle records:        ~5 TB (30-day active window)
```

---

## SLO Summary

| SLO | Target | Measurement Window |
|---|---|---|
| Route re-optimization p99 | ≤ 5 s | Rolling 1-hour |
| ETA prediction freshness p95 | ≤ 30 s from telemetry | Rolling 1-hour |
| Shipment event ingestion p99 | ≤ 2 s | Rolling 1-hour |
| Demand forecast pipeline completion | ≤ 4 h | Daily |
| Pick-path computation p99 | ≤ 500 ms | Rolling 1-hour |
| Cold chain alert latency | ≤ 60 s | Per excursion event |
| Platform availability | 99.95% | Monthly |
| Route optimization availability | 99.99% | Monthly |
| Telemetry ingestion durability | 0 data loss | Continuous |

---

## SLO Error Budgets

| SLO | Target | Error Budget (30-day) | Burn-Rate Alert | Escalation |
|---|---|---|---|---|
| Platform availability | 99.95% | 21.6 min downtime | 5x burn (10.8 min consumed in 6 hours) → SEV-2 page | Freeze non-critical deployments |
| Route optimization availability | 99.99% | 4.3 min downtime | 2x burn (4.3 min consumed in 15 days) → SEV-1 page | Immediate failover; halt feature work |
| Telemetry ingestion p99 | ≤ 2 s | 1% of events exceeding 2 s | > 2% violations in 1-hour window → SEV-2 | Scale stream partitions; add consumers |
| ETA freshness p95 | ≤ 30 s | 5% of updates exceeding 30 s | > 8% violations in 1-hour window → SEV-3 | Investigate slow inference; increase ETA worker pool |
| Route re-optimization p99 | ≤ 5 s | 1% of solves exceeding 5 s | > 3% violations in 1-hour window → SEV-2 | Reduce solver instance load; increase solver pool |
| Forecast pipeline | ≤ 4 h | 0 missed windows per month | Pipeline still running at 3h mark → SEV-3 | Add forecast workers; investigate Slowest part of the process |
| Cold chain alert latency | ≤ 60 s | 0 missed excursions | Any excursion missed or delayed > 120 s → SEV-1 | Dedicated cold chain pipeline restart |

**Error budget policy:** When 50% of the monthly error budget is consumed in the first week, all non-critical deployments freeze. When 80% is consumed, the engineering team shifts to reliability-only work until the budget resets.

---

## Hardware and Cost Estimations

### Compute Requirements

| Component | Instance Profile | Count | Rationale |
|---|---|---|---|
| Telemetry Ingestion Gateway | 4 vCPU, 8 GB RAM (network-optimized) | 200 | 200K events/sec; each instance handles ~1,000 events/sec with headroom |
| Stream Processing (Shipment Event) | 4 vCPU, 16 GB RAM | 1,000 | 1 consumer per stream partition; lightweight enrichment + dedup |
| Route Optimization Engine | 8 vCPU, 32 GB RAM (compute-optimized) | 5,000 (active) | 1 solver per active depot; 4–8 cores per VRP solve; 50 KB solution state in memory |
| Demand Forecasting Workers | 8 vCPU, 16 GB RAM | 100 | Batch inference; 10M SKU-locations / 100 workers = 100K per worker |
| Hierarchical Reconciliation | 16 vCPU, 64 GB RAM (memory-optimized) | 20 | Large sparse matrix operations for MinT reconciliation |
| Warehouse Orchestrator | 8 vCPU, 32 GB RAM | 500 | 1 per warehouse; digital twin (~200 MB) resident in memory |
| ETA Prediction Engine | 4 vCPU, 8 GB RAM | 50 | Stateless inference; ~17K predictions/sec across cluster |
| Last-Mile Delivery Optimizer | 8 vCPU, 16 GB RAM | 200 | Regional instances; 60-second re-optimization cycle |
| Visibility Service | 4 vCPU, 16 GB RAM | 100 | Read-heavy; serves dashboards, tracking pages, partner APIs |
| Fleet Management Service | 4 vCPU, 8 GB RAM | 50 | Telematics aggregation and predictive maintenance inference |
| Cold Chain Monitoring | 4 vCPU, 8 GB RAM | 30 | Dedicated pipeline for excursion detection with guaranteed latency |
| Customer Tracking Portal | 2 vCPU, 4 GB RAM | 50 | CDN-backed; handles overflow from CDN cache misses |

### Storage Cost Breakdown

| Storage Tier | Volume | Technology | Monthly Cost Estimate |
|---|---|---|---|
| Hot (SSD) — telemetry, digital twin, route state | ~60 TB | Distributed time-series store + in-memory | ~$12,000/TB/year × 60 TB = ~$60K/month |
| Warm — 30-day telemetry, fleet telematics | ~57 TB | Columnar store with compression | ~$3,000/TB/year × 57 TB = ~$14K/month |
| Cold — historical demand, archived telemetry | ~70 TB | Object storage with infrequent access tier | ~$300/TB/year × 70 TB = ~$1.7K/month |
| Compliance archive — cold chain 7-year, ELD 6-month | ~15 TB | Write-once immutable storage | ~$600/TB/year × 15 TB = ~$750/month |

**Total estimated storage:** ~$76K/month

### Network Bandwidth

```
Telemetry ingestion:
  200K events/sec × 500 bytes = 100 MB/sec inbound = ~800 Mbps sustained
  Peak (3x): ~2.4 Gbps

Warehouse AMR telemetry:
  1M pings/sec × 200 bytes = 200 MB/sec internal traffic

Cross-region replication:
  ~10% of telemetry crosses regions (multi-leg shipments)
  ~80 Mbps cross-region bandwidth

Customer tracking portal:
  ~50K concurrent sessions × 5 KB refresh every 30 sec = ~8 MB/sec outbound
  Peak (10x holiday): ~80 MB/sec → CDN absorbs 95%, origin serves ~4 MB/sec

Estimated network cost: ~$15K/month (inter-region transfer + CDN)
```

---

## Growth Projections (3-Year Horizon)

| Metric | Year 1 (Current) | Year 2 | Year 3 | Growth Driver |
|---|---|---|---|---|
| Active shipments tracked | 5M | 8M | 12M | Customer acquisition + existing customer volume growth |
| Telemetry events/sec (peak) | 31K | 55K | 85K | More granular tracking (every 30s vs. 5 min); IoT sensor proliferation |
| Fleet vehicles | 1M | 1.8M | 3M | EV fleet expansion; autonomous vehicle integration |
| SKU-location forecasts | 10M | 18M | 30M | Geographic expansion; long-tail SKU coverage |
| Warehouses | 500 | 800 | 1,200 | Customer growth + micro-fulfillment center adoption |
| AMRs per warehouse (avg) | 2,000 | 2,500 | 3,500 | Warehouse automation deepening; humanoid robot integration |
| VRP instances/day | 50K | 90K | 150K | More depots; finer planning horizons (per-shift vs. per-day) |
| Cold chain shipments/day | 500K | 1.2M | 2.5M | Pharmaceutical logistics growth; regulatory expansion to new categories |

### Scaling Implications

- **Year 2:** Stream partition count doubles (1,000 → 2,000); route solver pool scales with active depot count; demand forecasting pipeline parallelism increases from 100 → 180 workers
- **Year 3:** Consider tiered solver architecture (fast Practical rule of thumb for small depots, full ALNS for large depots); forecast pipeline may require GPU-accelerated reconciliation for 30M-node hierarchy; warehouse orchestrator must support heterogeneous robot fleets (AMRs + autonomous forklifts + sorting robots)
