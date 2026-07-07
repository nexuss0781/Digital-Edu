# 13.4 AI-Native Real Estate & PropTech Platform — Requirements & Estimations

## Functional Requirements

| # | Requirement | Notes |
|---|---|---|
| FR-01 | **Automated property valuation (AVM)** — Generate ML-driven property value estimates using comparable sales, property attributes, geospatial features, market trends, satellite imagery, and alternative data; support on-demand and batch valuation modes | Median absolute error ≤ 5% for on-market properties; ≤ 8% for off-market; recompute within 4 hours of new comparable sale recording |
| FR-02 | **Smart building management** — Ingest IoT sensor data (HVAC, electrical, water, occupancy, air quality) via BACnet/Modbus/MQTT; optimize HVAC setpoints, lighting, and energy usage through reinforcement learning; schedule predictive maintenance | Sub-second actuation for safety-critical controls; 5-minute optimization cycles for HVAC; support 10,000+ sensors per building |
| FR-03 | **Tenant matching and screening** — Score tenant-property compatibility using credit risk, income verification, rental history, lifestyle preferences, and property characteristics; produce explainable scores compliant with Fair Housing Act | Decision latency ≤ 3 seconds; adverse action notices with specific reasons; no use of prohibited variables or proxies |
| FR-04 | **Lease intelligence** — Ingest lease documents (PDF, scanned images, DOCX); extract 200+ clause types using OCR and NLP; detect anomalous clauses; model rent escalation schedules; support portfolio-level analytics | Processing time ≤ 10 minutes per lease; extraction accuracy ≥ 95% F1 for key terms; human-in-the-loop review for low-confidence extractions |
| FR-05 | **Property search and recommendation** — Support natural language queries ("3BR near good schools under $500K with a garage"), geospatial search, visual similarity (find homes that look like this photo), and personalized ranking based on user behavior | Search latency p99 ≤ 200 ms; support 140M+ residential and 6M+ commercial property corpus |
| FR-06 | **Climate risk assessment** — Score individual properties across 6 perils (flood, wildfire, heat stress, wind/storm, drought, sea-level rise) under multiple emission scenarios (SSP2-4.5, SSP5-8.5); provide time-horizon projections (2030, 2050, 2080); compute climate-adjusted valuations | Parcel-level granularity (~30m resolution); annual model refresh incorporating latest climate science; TCFD-aligned reporting |
| FR-07 | **Property data ingestion and reconciliation** — Ingest from 500+ MLS feeds, county recorder offices, tax assessor databases, satellite imagery providers, and building sensor networks; perform entity resolution to match records across sources | New MLS listing reflected in search within 15 minutes; entity resolution accuracy ≥ 98% |
| FR-08 | **Comparable sales selection** — Automatically identify and rank comparable properties for valuation using learned similarity embeddings that capture physical attributes, location quality, market conditions, and temporal relevance | Top-5 comparables should match appraiser selections ≥ 80% of the time; transparent adjustment methodology |
| FR-09 | **Building digital twin** — Maintain a real-time virtual representation of building systems (HVAC zones, electrical circuits, plumbing, elevators) reflecting current sensor state, equipment health scores, and energy consumption patterns | State refresh ≤ 5 seconds from sensor reading; support 50,000+ managed buildings |
| FR-10 | **Virtual tour and listing quality** — Analyze listing photos using computer vision to score listing quality (photo completeness, staging quality, image resolution); support 3D virtual tour hosting and serving | Photo scoring latency ≤ 2 seconds per image; 3D tour load time ≤ 3 seconds |
| FR-11 | **Market analytics and forecasting** — Provide neighborhood-level market trend analysis (median price, days on market, inventory levels, price-to-rent ratio) with forward-looking forecasts | Updated daily; 12-month forecast horizon; geographic granularity to census tract |
| FR-12 | **Portfolio analytics** — For commercial property managers: aggregate lease expiration schedules, occupancy trends, rent roll analysis, capital expenditure planning across property portfolios | Support portfolios of 10,000+ properties; real-time dashboard updates |
| FR-13 | **Valuation explainability** — For every AVM estimate, provide: selected comparables with adjustment factors, feature importance scores, confidence intervals, and regulatory compliance attestation | Explainability report generation ≤ 10 seconds; machine-readable for downstream audit systems |
| FR-14 | **Insurance cost modeling** — Estimate property insurance premiums based on climate risk scores, building characteristics, construction type, and location; model premium sensitivity to risk mitigation improvements | Support what-if scenarios for risk mitigation investments |

---

## Out of Scope

- **Mortgage origination and underwriting** — Loan application processing, credit decisioning, and loan servicing (separate lending platform)
- **Title search and escrow** — Title chain verification, lien search, and escrow account management (specialized title company systems)
- **Property management operations** — Rent collection, maintenance work order dispatch, accounting (operational property management system)
- **Real estate brokerage workflows** — Agent CRM, commission tracking, transaction management (brokerage operations platform)
- **Construction project management** — Permitting, contractor coordination, progress tracking (construction management system)

---

## Non-Functional Requirements

### Performance SLOs

| Metric | Target | Rationale |
|---|---|---|
| AVM computation latency (p99) | ≤ 30 s per property (on-demand) | Loan officers and investors need near-instant valuations during deal evaluation |
| AVM batch refresh (140M properties) | ≤ 8 h | Overnight refresh must complete before morning trading/lending decisions |
| Property search latency (p99) | ≤ 200 ms | Consumer search experience requires sub-second response |
| Building sensor ingestion (p99) | ≤ 500 ms from reading to queryable state | HVAC optimization requires fresh sensor data |
| Safety-critical actuation latency | ≤ 100 ms | Life-safety controls (fire, CO2, smoke) cannot tolerate delays |
| Lease abstraction throughput | ≤ 10 min per lease document | Commercial portfolios with 1,000+ leases need batch processing capability |
| Climate risk score computation (p99) | ≤ 5 s per property | On-demand risk assessment during property evaluation |
| Tenant screening decision (p99) | ≤ 3 s | Applicants expect near-instant decisions in online application flows |

### Reliability & Availability

| Metric | Target |
|---|---|
| Platform availability | 99.95% (≤ 22 min downtime/month) |
| Building safety system availability | 99.999% (≤ 26 s downtime/month) |
| AVM service availability | 99.9% |
| Property search availability | 99.95% |
| Sensor data ingestion durability | Zero data loss; at-least-once processing |
| Lease document storage durability | 99.999999999% (eleven 9s); immutable audit trail |

### Scalability

| Metric | Target |
|---|---|
| Properties in valuation universe | 140M residential + 6M commercial (US) |
| Daily AVM recomputations | 140M (full universe nightly) + 500K on-demand |
| Managed buildings (IoT) | 50,000 buildings |
| IoT sensor readings ingested per second | 2M readings/sec (50K buildings × 10K sensors × 1 reading/250s avg) |
| Concurrent property searches per second | 10,000 queries/sec at peak |
| Lease documents processed per month | 100,000 leases |
| Climate risk model coverage | 150M parcels across US |
| MLS feed integrations | 500+ feeds |

### Security & Compliance

| Requirement | Specification |
|---|---|
| Fair Housing Act compliance | No use of race, color, national origin, religion, sex, familial status, or disability in tenant screening or valuation; proxy variable detection and exclusion |
| Equal Credit Opportunity Act (ECOA) | AVM outputs used in lending must include adverse action reasons; model documentation per regulatory guidance |
| Fair lending compliance | Regular disparate impact testing; valuation accuracy parity across demographic groups |
| Tenant data privacy | CCPA/state privacy law compliance; data minimization; applicant data retention limits; right to deletion |
| Building data security | IoT sensor networks isolated from internet-facing systems; BACnet/IP security policies; encrypted sensor data at rest and in transit |
| TCFD compliance | Climate risk disclosures meet TCFD recommended disclosures framework; audit trail for risk methodology |

---

## Capacity Estimations

### Property Valuation (AVM)

```
Valuation universe:
  140M residential + 6M commercial = 146M properties
  Feature vector per property: ~2,000 features × 4 bytes = 8 KB
  Total feature store: 146M × 8 KB = ~1.1 TB

Nightly batch valuation:
  Model inference: ~15 ms per property (gradient-boosted ensemble + spatial model)
  146M × 15 ms = 2,190,000 seconds of inference
  Parallelized across 500 workers: 4,380 seconds = ~73 minutes
  Comparable selection: ~50 ms per property (embedding similarity search)
  146M × 50 ms = 7,300,000 seconds
  Parallelized across 500 workers: 14,600 seconds = ~4.1 hours
  Total nightly pipeline: ~5.2 hours (within 8-hour SLO)

On-demand valuations:
  500K/day = ~6 per second at baseline; peak 20/sec
  Each request: comparable search (50 ms) + model inference (15 ms) + explainability (20 ms) = ~85 ms

Transaction history:
  ~5.5M transactions/year × 20 years = 110M historical transactions
  Per transaction: ~2 KB (price, date, property attributes, parties)
  Total: ~220 GB (easily fits in columnar store)
```

### Building IoT Telemetry

```
Sensor data:
  50,000 buildings × average 10,000 sensors per building = 500M sensors
  Reading frequency: varies from 1/sec (safety) to 1/5min (temperature)
  Weighted average: 1 reading every 250 seconds per sensor
  Throughput: 500M / 250 = 2M readings/sec

Per reading size:
  {building_id, sensor_id, timestamp, value, unit, zone_id, status}
  ~200 bytes per reading

Daily volume:
  2M readings/sec × 86,400 sec/day × 200 bytes = ~34.6 TB/day raw
  With time-series compression (delta + run-length encoding): ~3.5 TB/day
  30-day hot retention: ~105 TB
  1-year warm retention (10x compression): ~130 TB

Digital twin state per building:
  ~50 MB (zone temperatures, equipment status, occupancy, energy meters)
  50,000 buildings × 50 MB = ~2.5 TB total twin state (distributed)
```

### Lease Document Processing

```
Document ingestion:
  100,000 leases/month = ~3,300/day = ~140/hour
  Average lease: 80 pages, 15 MB (scanned PDF)
  Daily ingestion: 3,300 × 15 MB = ~50 GB/day

Processing pipeline per lease:
  OCR: ~2 minutes (GPU-accelerated)
  Layout analysis: ~30 seconds
  NER + clause classification: ~3 minutes (transformer inference)
  Structured extraction + validation: ~1 minute
  Total: ~7 minutes per lease

GPU compute:
  140 leases/hour, each needing ~5 minutes GPU time
  = ~12 GPU-hours/day
  With 4 GPUs: ~3 hours processing time (comfortable headroom)

Extracted data store:
  Per lease: ~50 KB structured output (clause extractions, entities, metadata)
  100K leases/month × 50 KB = 5 GB/month
  10-year retention: ~600 GB
```

### Property Search

```
Search index:
  146M properties × average 2 KB per document (structured fields + text)
  = ~292 GB base index

Geospatial index (H3):
  146M properties indexed at resolution 9 (~175m hexagons)
  = ~2 GB H3 index

Visual embeddings:
  146M properties × average 15 photos × 512-dim float32 embedding
  = 146M × 15 × 2 KB = ~4.4 TB embedding store
  Approximate nearest neighbor index: ~500 GB

Query throughput:
  10,000 queries/sec peak
  Per query: geospatial filter (2 ms) + text search (5 ms) + reranking (10 ms) = ~17 ms
  With personalization model: add 8 ms = ~25 ms total
```

### Climate Risk Modeling

```
Climate data:
  Downscaled GCM output: ~1 km grid × 6 perils × 3 scenarios × 3 time horizons
  Grid cells covering US: ~10M cells
  Per cell per scenario: ~500 bytes (risk probabilities, return periods)
  Total: 10M × 6 × 3 × 3 × 500 bytes = ~270 GB climate grid data

Per-property risk scoring:
  Map parcel to grid cell(s) + apply building-specific adjustments
  ~100 ms per property (interpolation + building vulnerability model)
  150M parcels × 100 ms = 15M seconds
  Parallelized across 200 workers: 75,000 seconds = ~21 hours (annual refresh)

On-demand risk queries: ~5 ms (pre-computed scores cached)
```

### Storage Summary

```
Property feature store:               ~1.1 TB
Transaction history (20-year):         ~220 GB
Building IoT (30-day hot):            ~105 TB
Building digital twin state:           ~2.5 TB
Lease document storage (10-year):      ~18 TB (raw PDFs)
Lease extracted data (10-year):        ~600 GB
Property search index:                 ~292 GB
Visual embedding store:                ~4.4 TB
ANN index for visual search:           ~500 GB
Climate grid data:                     ~270 GB
Climate risk scores (pre-computed):    ~30 GB
Satellite imagery archive:             ~50 TB
MLS raw feed archive (1-year):         ~5 TB
```

---

## SLO Summary

| SLO | Target | Measurement Window |
|---|---|---|
| AVM on-demand latency p99 | ≤ 30 s | Rolling 1-hour |
| AVM batch completion | ≤ 8 h | Daily |
| AVM median absolute error (on-market) | ≤ 5% | Rolling 30-day |
| Property search p99 | ≤ 200 ms | Rolling 1-hour |
| Building sensor ingestion p99 | ≤ 500 ms | Rolling 1-hour |
| Safety actuation latency p99 | ≤ 100 ms | Per event |
| Lease abstraction throughput | ≤ 10 min per lease | Per document |
| Lease extraction F1 (key terms) | ≥ 95% | Rolling 30-day |
| Climate risk score latency (cached) | ≤ 5 ms | Rolling 1-hour |
| Tenant screening latency p99 | ≤ 3 s | Rolling 1-hour |
| Entity resolution accuracy | ≥ 98% | Rolling 30-day |
| Platform availability | 99.95% | Monthly |
| Building safety availability | 99.999% | Monthly |

---

## Derived Design Constraints

| # | Capacity Fact | Derived Constraint |
|---|---|---|
| DC-1 | 146M properties × 15ms inference = 2.19M seconds batch inference | AVM batch must be parallelized across ≥500 workers to fit 8-hour window; comparable selection (4.1h) is the Slowest part of the process, not inference (73m) |
| DC-2 | 2M sensor readings/sec × 200 bytes = 400 MB/sec sustained write | Time-series database must sustain 400 MB/sec writes; partitioned by building_id to distribute load across ~500 storage nodes |
| DC-3 | 4.4 TB visual embedding store across 146M properties | Cannot fit in single-server memory; must shard by geography matching search index partitioning; GPU memory for ANN search requires shards ≤25 GB each |
| DC-4 | 5.5M annual transactions provide ground truth for 146M properties (4% coverage) | AVM must generalize from 4% observed to 96% unobserved; spatial interpolation and temporal extrapolation are structural requirements, not optional model improvements |
| DC-5 | 500+ MLS feeds with heterogeneous schemas | Entity resolution is not a one-time ETL task—it is a continuously running service processing ~500K updates/day; requires dedicated engineering team |
| DC-6 | 100ms safety actuation budget with 30ms actuator transmission | No cloud round-trip possible (minimum 40ms); safety logic must execute entirely on building edge gateway |
| DC-7 | 100K leases/month × 7 min GPU time = ~12 GPU-hours/day | GPU pool shared with satellite analysis; must implement preemption hierarchy (lease > satellite) during contention |

---

## Operational SLA Contracts

### API Consumer SLAs

| Consumer Tier | Use Case | Latency SLO | Throughput Limit | Availability SLO | Penalty |
|---|---|---|---|---|---|
| **Enterprise (Lenders)** | On-demand AVM for mortgage origination | p99 ≤ 30s | 100 requests/sec | 99.9% during business hours | Service credits for SLO miss |
| **Platform (REITs)** | Portfolio analytics, lease processing, building IoT | Varies by endpoint | Per-contract | 99.95% | Service credits |
| **Developer (API)** | Property search, climate risk scores | p99 ≤ 200ms (search), ≤ 5s (climate) | Rate-limited per API key | 99.9% | Best effort |

### Internal SLAs Between Subsystems

| Producer | Consumer | SLO | Consequence of Miss |
|---|---|---|---|
| Entity resolution | AVM, Search | Property record updates within 15 min of source ingestion | AVM uses stale features; search shows outdated listings |
| MLS ingestion | Search index | New listing searchable within 15 min of MLS update | Listing agents complain about delayed visibility; SEV-3 |
| AVM batch | On-demand serving cache | Nightly valuations published by 6 AM ET | On-demand requests serve yesterday's estimates; staleness flag shown to consumers |
| Climate risk batch | Valuation service | Annual risk scores refreshed within 30 days of GCM data availability | Climate-adjusted valuations use stale risk; compliance disclosure required |

---

## Multi-Market Scale Testing Requirements

Before launching in a new geographic market, the platform must pass the following validation tests:

| Test Category | Test Description | Pass Criteria |
|---|---|---|
| **AVM accuracy backtest** | Run AVM on properties that transacted in the last 12 months (using only data available before each transaction) | MdAPE ≤ 8% on holdout; hit rate (±10%) ≥ 80% |
| **Entity resolution coverage** | Verify canonical property coverage against county assessor total parcel count | Coverage ≥ 95%; duplicate rate ≤ 0.5% |
| **Fair lending compliance** | Disparate impact test across demographic groups in the new market | Error ratio ≤ 1.25 for all demographic group comparisons |
| **Search index completeness** | Compare active MLS listings against search index content | Index coverage ≥ 99% of active listings within 24 hours of feed sync |
| **Climate risk model validation** | Hindcast validation: compare model's flood/fire predictions against historical FEMA declarations in the market | Hindcast correlation r ≥ 0.65 for flood and wildfire |
| **Latency benchmarks** | Run load test simulating market-specific query patterns (geospatial distribution, property type mix) | All SLOs met under projected peak load × 2x safety margin |

---

## Data Source Characteristics

Understanding the characteristics of each data source is critical for designing the ingestion and reconciliation layers:

| Data Source | Format | Update Frequency | Coverage | Reliability | Key Challenge |
|---|---|---|---|---|---|
| **MLS feeds (top 50)** | RETS/Web API (structured) | Real-time to hourly | ~65% of US residential | High (contractual SLAs) | Schema heterogeneity across MLSs; each MLS defines its own field names and enumerations |
| **MLS feeds (51-500)** | Mix of API and flat file | Hourly to daily | ~30% of US residential | Medium (variable quality) | Smaller MLSs have less investment in data quality; more missing fields and inconsistencies |
| **County tax records** | Flat file, PDF, web scraping | Monthly to annually | ~95% of all parcels | High (official records) | Extreme format heterogeneity: some counties use modern APIs, others publish scanned PDFs |
| **County deed records** | Flat file, document images | Daily to monthly | ~90% of transactions | High (legal records) | Recording lag: 30-90 days from transaction to recorded deed |
| **Satellite imagery** | GeoTIFF, multi-band imagery | Weekly to biweekly | 100% (national coverage) | High | Large file sizes (10-50 GB per update); GPU-intensive processing for feature extraction |
| **Building IoT sensors** | BACnet/Modbus/MQTT protocols | Sub-second to every 5 min | Building-specific (managed fleet) | Variable (sensor failures, network issues) | Protocol diversity; per-building custom configuration; sensor drift and calibration |
| **Climate model outputs** | NetCDF, HDF5 (scientific formats) | Annual to biannual | Global (downscaled to US) | High (peer-reviewed models) | Enormous file sizes; irregular grids; requires domain expertise to interpret |
| **Lease documents** | PDF, scanned images, DOCX | On-demand (portfolio uploads) | Client-specific | Variable (scan quality) | OCR quality varies dramatically; handwritten amendments; multi-document amendment chains |

### Data Quality Scorecard

Each data source maintains a real-time quality scorecard:

| Quality Dimension | Measurement | Target | Impact of Miss |
|---|---|---|---|
| **Completeness** | Percentage of required fields populated in incoming records | ≥ 95% | Missing features reduce AVM accuracy; incomplete listings provide poor search experience |
| **Timeliness** | Lag between real-world event and data availability in platform | See per-source specs above | Stale data causes AVM overvaluation in declining markets; search shows sold properties |
| **Accuracy** | Error rate when cross-validated against independent sources | ≤ 2% discrepancy rate | Incorrect attributes (wrong sqft, bedroom count) directly degrade AVM accuracy |
| **Consistency** | Agreement rate when same property appears in multiple sources | ≥ 90% cross-source agreement | Conflicts require resolution; systematic inconsistencies indicate a source-level problem |
| **Uniqueness** | Duplicate rate within and across sources | ≤ 0.5% duplicates | Duplicates create phantom properties in search results and inflate portfolio counts |
