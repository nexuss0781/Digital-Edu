# 13.5 AI-Native Agriculture & Precision Farming Platform — Scalability & Reliability

## Scaling Challenges Unique to Precision Agriculture

### Extreme Seasonality

Agricultural workloads are among the most seasonal in any industry. In the US Midwest:
- **Planting season (April–May):** Equipment telemetry and prescription generation spike 10x
- **Growing season (June–August):** Satellite monitoring, pest detection, and irrigation optimization at peak
- **Spray season (May–July):** 50,000 spray rigs active simultaneously; 130 TB/day of spray logs
- **Harvest (September–November):** Yield data ingestion and combine telemetry at peak
- **Winter (December–March):** < 5% of peak load; planning, analytics, and model training

The platform must scale from winter baseline to peak-season capacity and back within days, not weeks. Over-provisioning for peak is economically unviable given the thin per-acre margins in agriculture.

### Geographic Distribution

Managed acreage spans continental scales (US alone: Great Plains to the Southeast, covering 4 time zones and 15+ distinct agro-climatic regions). Satellite imagery arrives in regional tiles, weather data varies by grid cell, and sensor data flows from LoRaWAN gateways distributed across rural areas with minimal network infrastructure.

---

## Imagery Pipeline Scaling

### Satellite Processing

```
Architecture: Fan-out pipeline with auto-scaling workers

Ingestion tier:
  - Satellite data providers push tiles via webhook or pull from provider API
  - Ingestion service: 5 instances (one per major provider + Sentinel)
  - Writes raw tiles to object storage with metadata in catalog database

Processing tier (auto-scaling worker pool):
  - Step 1: Atmospheric correction (CPU-bound, ~30 sec per tile)
  - Step 2: Cloud masking (GPU-accelerated ML, ~10 sec per tile)
  - Step 3: Vegetation index computation (CPU, ~5 sec per tile)
  - Step 4: Field-level clipping and anomaly detection (~2 sec per field)

  Peak load: 500 Sentinel-2 tiles + 2,000 commercial tiles per day
  Processing time per tile: ~45 sec average
  Total compute: 2,500 tiles × 45 sec = ~31 CPU-hours/day
  Worker pool: 10–50 GPU-equipped workers (auto-scales based on queue depth)
  SLO: all tiles processed within 4 hours of acquisition

Optimization:
  - Cloud-Optimized GeoTIFF (COG) format enables partial tile reads
    (process only the geographic extent of managed fields, skip empty regions)
  - Skip processing for tiles with > 90% cloud cover (detected via quick thumbnail analysis)
  - Cache atmospheric correction LUTs per satellite/date to avoid recomputation
```

### Drone Processing

```
Architecture: Job queue with GPU worker pool

Upload path:
  - Drone companion computer → farm WiFi → object storage (resumable upload)
  - Average upload: 8 GB per flight at 5–20 Mbps = 7–27 minutes per flight
  - Peak: 5,000 flights/day → 40 TB/day inbound

Processing pipeline:
  - Ortho-mosaic stitching: GPU-accelerated SfM, ~45 min per 200-acre flight
  - Plant detection: GPU inference on ortho-mosaic tiles, ~15 min per flight
  - Product generation: vegetation index, DSM, anomaly maps, ~10 min

  Total per flight: ~70 min on 1 GPU worker
  Peak daily: 5,000 flights × 70 min = 5,833 GPU-hours
  Worker pool: 50–250 GPU workers (auto-scales; spot/preemptible instances for cost)
  SLO: results within 2 hours of upload completion

Cost optimization:
  - Priority tiers: urgent scouting flights processed immediately;
    routine monitoring flights queued for off-peak processing
  - Spot instance strategy: 80% of processing on preemptible GPU instances
    (20% cost of on-demand); re-queue interrupted jobs automatically
  - Progressive resolution: deliver low-res preview in 15 min, full-res in 2 hours
```

---

## Sensor Data Pipeline Scaling

### LoRaWAN Ingestion Architecture

```
Sensor → LoRaWAN Gateway → Network Server → MQTT Broker → Ingestion Service → Time-Series DB

Scale numbers:
  10M sensors → 50,000 gateways → 100 network server instances → message broker cluster

Gateway-level batching:
  Each gateway aggregates readings from ~200 sensors
  Uplink: 1 batch every 15 min → ~200 readings × 200 bytes = 40 KB per batch
  50,000 gateways × 40 KB / 15 min = 133 MB/min = 2.2 MB/sec

Network server tier:
  100 instances, each handling 500 gateways
  Decrypts LoRaWAN payloads, deduplicates (sensor may reach multiple gateways),
    applies device-level processing (calibration, quality scoring)

Message broker:
  Partitioned by farm_id (ensures per-field ordering)
  Peak throughput: ~11K readings/sec
  Retention: 1 hour (consumers should process within minutes)

Ingestion service:
  Writes calibrated readings to time-series database
  Updates field digital twin with latest sensor values
  Triggers irrigation recomputation if moisture crosses threshold

Time-series database:
  Partitioned by field_id and time (monthly partitions)
  Automatic downsampling: raw (15 min) retained 90 days,
    hourly averages retained 2 years, daily averages retained 10 years
  Compression: time-series encoding achieves 8–10x for soil sensor data
```

### Sensor Fleet Management at Scale

```
Challenges at 10M sensors:
  - Battery monitoring: predict replacement needs 30 days in advance
  - Firmware updates: staged OTA via LoRaWAN Class C (firmware < 50 KB)
  - Drift detection: per-sensor calibration model maintenance
  - Sensor provisioning: self-registration via activation code on farm WiFi

Battery prediction model:
  Input: voltage trend (last 90 days), transmission frequency, environmental temperature
  Output: predicted days to critical voltage threshold
  Runs daily for all sensors; generates replacement alerts with geographic clustering
    (replace all low-battery sensors in a region during a single farm visit)

Provisioning at scale:
  - New sensor powers on → joins nearest LoRaWAN gateway → sends activation beacon
  - Activation service matches beacon to pre-registered sensor batch (purchased by farmer)
  - Auto-assigns field_id based on GPS coordinates from gateway triangulation
  - Full provisioning in < 5 minutes, no manual configuration needed
```

---

## Edge Fleet Scaling

### Managing 50,000 Spray Rigs

```
Edge management challenges:
  - Model deployment: push 200 MB model update to 50,000 rigs over limited bandwidth
  - Configuration: per-crop spray thresholds, nozzle geometry calibration
  - Monitoring: detect hardware failures (camera, GPU, solenoid) in the field
  - Data collection: aggregate 130 TB/day of spray logs from rigs with intermittent connectivity

Model deployment strategy:
  - Staged rollout: 1% → 10% → 50% → 100% over 72 hours
  - Delta updates: only transfer changed model layers (~20 MB vs. 200 MB full model)
  - Pre-position models during off-season or overnight via farm WiFi
  - Fallback: every rig maintains n-1 model version; auto-rollback on validation failure

Spray log aggregation:
  - Each rig: ~2.6 GB/day of spray logs (compressed)
  - Upload window: typically 2–4 hours per day when rig is near farm WiFi/cellular
  - Bandwidth budget: 2.6 GB / 4 hours = ~180 KB/sec sustained upload
  - At 2 Mbps uplink, this is feasible but leaves little headroom
  - Optimization: on-rig aggregation reduces log volume by 10x
    (per-acre summaries instead of per-nozzle-per-frame detail)
  - Full detail logs retained on-rig for 7 days; uploaded opportunistically

Rig health monitoring:
  - Heartbeat every 60 sec when operating (GPS, model version, camera status, nozzle test results)
  - Heartbeat routed through LoRaWAN if cellular unavailable (100 bytes fits in LoRaWAN uplink)
  - Fleet dashboard: map view of all rigs with status indicators
  - Alert rules: camera feed frozen > 10 sec, GPU temperature > 85°C,
    nozzle solenoid test failure, model version outdated > 7 days
```

---

## Seasonal Scaling Strategy

### Resource Allocation by Season

| Resource | Winter (Dec–Mar) | Spring (Apr–May) | Summer (Jun–Aug) | Fall (Sep–Nov) |
|---|---|---|---|---|
| Satellite processing workers | 10 | 25 | 50 | 30 |
| Drone processing GPU workers | 5 | 50 | 250 | 100 |
| Sensor ingestion instances | 20 | 50 | 100 | 50 |
| Yield prediction workers | 0 | 50 | 200 | 50 |
| Irrigation optimizer instances | 0 | 20 | 100 | 10 |
| API servers | 10 | 30 | 50 | 30 |
| Model training GPU cluster | 50 | 10 | 10 | 50 |

**Key insight:** Model training workloads are counter-seasonal to operational workloads. Winter is when the platform retrains all models using the previous season's data, while summer is peak operational demand. This allows the same GPU fleet to serve training in winter and inference in summer.

### Multi-Region Architecture

For platforms operating across continents (Americas, Europe, Asia-Pacific), data sovereignty and latency requirements drive regional deployment:

```
Region allocation:
  US-Central:    US Midwest, Great Plains (60% of managed acreage)
  US-Southeast:  US Southeast, Delta (15% of managed acreage)
  EU-West:       Western Europe (10% of managed acreage)
  SA-East:       Brazil, Argentina (10% of managed acreage)
  AP-Southeast:  India, SE Asia (5% of managed acreage)

Per-region services:
  - Satellite processing: tiles processed in region closest to satellite ground station
  - Sensor ingestion: LoRaWAN network servers deployed regionally (latency-sensitive)
  - Field digital twin: replicated within region; cross-region sync for multi-region farms
  - Yield prediction: regional models trained on local agro-climatic data
  - Prescription generation: regional to comply with local agrochemical regulations

Global services (single region, replicated):
  - Model training pipeline (centralized GPU fleet)
  - Weather forecast ingestion (global data, regionally distributed)
  - Edge fleet management and OTA coordination
  - Analytics and reporting
```

### Auto-Scaling Triggers

```
Satellite processing:
  Trigger: tile queue depth > 100 OR processing lag > 2 hours
  Action: scale up workers by 50% (max: 100)
  Cool-down: scale down when queue empty for 30 min

Drone processing:
  Trigger: job queue depth > 500 OR oldest job age > 1 hour
  Action: scale up GPU workers (prefer spot instances)
  Cool-down: scale down when queue depth < 50 for 15 min

Sensor ingestion:
  Trigger: message broker consumer lag > 100,000 messages
  Action: add ingestion instances (scaled by partition count)
  Cool-down: scale down when lag < 10,000 for 10 min

Yield prediction:
  Trigger: weekly prediction job queued (scheduled trigger)
  Action: burst to 200 workers for ~1 hour, then scale down
  Pattern: predictable weekly burst, pre-warmed worker pool
```

---

## Reliability Architecture

### Edge Reliability (Spray Controller)

The spray controller is the most reliability-critical component—a failure mid-field means either stopping the operation (losing time in a narrow spray window) or reverting to broadcast spray (wasting 50–90% of the herbicide savings).

```
Reliability measures:
  - Dual-boot firmware: primary + fallback firmware partitions
    If primary fails health check at boot, auto-boot fallback
  - Watchdog timer: hardware watchdog resets the controller if main loop
    does not service the watchdog within 100 ms
  - Camera redundancy: 24 cameras arranged in overlapping pairs
    If one camera fails, its partner covers the gap (with slightly reduced accuracy)
  - Nozzle fail-safe: solenoid default state is OPEN (spray on)
    On controller failure, all nozzles spray → reverts to broadcast
    (prefer wasting herbicide over missing weeds)
  - GPS fallback: dual GPS receivers; if both fail, spray operates
    on dead reckoning from wheel speed sensor for up to 500 m

  Target: < 1 field-stopping failure per 10,000 operating hours
```

### Cloud Platform Reliability

```
Redundancy strategy:
  - Stateless services: 3+ replicas across availability zones
  - Database: primary-replica configuration with automatic failover
  - Object storage: triple-replicated across zones (imagery, spray logs)
  - Message broker: 3-broker cluster with topic replication factor 3
  - Time-series database: replication factor 2 with automated rebalancing

Disaster recovery:
  - RPO: 1 hour (asynchronous replication to secondary region)
  - RTO: 4 hours (failover to secondary region with pre-provisioned compute)
  - Edge operates independently during cloud outage (edge-first architecture)

  Rationale for relatively relaxed cloud RTO:
  - Edge devices operate autonomously; cloud outage does not stop farming operations
  - Satellite imagery pipeline can buffer tiles for hours without data loss
  - Sensor data is buffered at LoRaWAN gateways (24-hour buffer)
  - Critical path (spray decisions) has zero cloud dependency
```

### Data Durability

| Data Type | Durability Strategy | Recovery |
|---|---|---|
| Spray logs | Write to edge SSD + upload to cloud; both copies retained | Re-upload from edge if cloud copy lost |
| Sensor readings | LoRaWAN confirmed uplinks + cloud write-ahead log | Replay from LoRaWAN network server buffer (24h) |
| Satellite products | Source imagery available from provider for re-download | Reprocess from raw tiles (idempotent pipeline) |
| Drone imagery | Upload to object store with checksum verification | Re-fly the field if both edge and cloud copies lost |
| Field digital twin | Snapshotted daily; reconstructable from source data | Replay all source data from last snapshot |
| Prescriptions | Versioned in database + cached on edge devices | Regenerate from current field digital twin state |

### Geographic Data Partitioning

```
Partitioning strategy:
  - Primary partition key: H3 resolution-4 cell (regional, ~1,770 km²)
  - Secondary partition key: time (monthly buckets for time-series data)

  Benefits:
    - Queries for a single farm's data hit ≤ 3 partitions
      (most farms span 1–2 H3 resolution-4 cells)
    - Regional satellite processing reads only local partitions
    - Time-based partitioning enables efficient retention policies
      (drop partitions older than retention window)

  Scale:
    - US lower 48 states ≈ 4,200 H3 resolution-4 cells
    - Average managed fields per cell: 120
    - Average data volume per cell per month: ~500 GB
    - Total active partition count: 4,200 cells × 12 months = ~50,400 partitions
```

---

## Performance Optimization

### Imagery Processing Optimization

```
Cloud-Optimized GeoTIFF (COG) benefits:
  - HTTP range requests: read only the spatial extent needed
    (a 100 km × 100 km tile, but we only need the 1 km × 1 km field)
  - 100x reduction in bytes read for single-field queries
  - Pyramidal overviews: zoom levels pre-computed; farm-level view
    reads low-res overview instead of full-resolution raster

Tile caching strategy:
  - Recent tiles (30 days): fast object storage with CDN edge caching
  - Archive tiles (1–5 years): cold object storage, accessed for trend analysis
  - NDVI time series: pre-extracted per field, stored in time-series DB
    (avoids re-reading raster tiles for historical queries)
```

### Yield Prediction Optimization

```
Simulation caching:
  - Weather varies slowly across space; fields within 10 km receive nearly
    identical weather forcing
  - Cache simulation results by weather cell (10 km grid) + soil class
  - Fields sharing weather cell and soil class: reuse simulation,
    adjust only for management differences (planting date, fertilizer rates)
  - Cache hit rate: ~60% (reduces effective simulation count by 60%)

Feature store:
  - Pre-compute satellite features (NDVI time series statistics) nightly
  - Store in columnar format indexed by (field_id, prediction_date)
  - ML inference reads pre-computed features instead of raw satellite rasters
  - Reduces per-prediction feature assembly from 500 ms to 5 ms
```

---

## Capacity Planning Model

### 5-Year Growth Projections

| Metric | Year 1 | Year 2 | Year 3 | Year 5 |
|--------|--------|--------|--------|--------|
| Acres under management | 50M | 100M | 150M | 300M |
| Active spray rigs | 12,500 | 25,000 | 37,500 | 75,000 |
| Soil sensors deployed | 2.5M | 5M | 7.5M | 15M |
| Drone flights/day (peak) | 1,250 | 2,500 | 3,750 | 7,500 |
| Satellite processing (GB/day) | 22 | 45 | 67 | 135 |
| Spray log ingestion (TB/day) | 32 | 65 | 97 | 195 |
| Total storage (PB) | 4 | 12 | 25 | 60 |
| GPU workers (peak season) | 75 | 150 | 225 | 450 |

### Cost Optimization Strategies

| Strategy | Annual Savings | Implementation |
|----------|---------------|----------------|
| **Spot/preemptible GPU instances** | 55–65% on drone processing | Checkpoint-resume for interrupted SfM jobs; 80% spot, 20% on-demand baseline |
| **Counter-seasonal GPU allocation** | Eliminates idle GPU fleet 4 months/year | Training pipelines scheduled Dec–Mar; inference fleet repurposed |
| **Edge aggregation of spray logs** | 90% reduction in upload bandwidth | Per-acre summaries replace per-nozzle-per-frame detail for routine analysis |
| **COG format for satellite imagery** | 100x reduction in reads for field queries | HTTP range requests read only the field's spatial extent from full tiles |
| **Time-series downsampling** | 80% storage reduction for historical sensor data | Raw (15 min) → hourly (90 days) → daily (2 years) → monthly (10 years) |
| **Simulation caching by weather cell** | 60% reduction in yield prediction compute | Fields sharing weather grid cell and soil class reuse cached simulation results |

---

## Disaster Recovery Architecture

### Recovery Scenarios

| Scenario | Impact | Recovery Strategy | RTO |
|----------|--------|-------------------|-----|
| **Single AZ failure** | Partial cloud service degradation | Auto-failover to healthy AZs; stateless services continue on remaining replicas | < 5 min |
| **Region-wide outage** | Cloud platform unavailable | Failover to secondary region; edge devices continue autonomously | 4 hours |
| **Satellite provider outage** | No new satellite imagery | Fall back to alternative provider; gap-fill with SAR data; extend drone survey coverage | 24 hours |
| **LoRaWAN network server failure** | Sensor data stops flowing | Gateways buffer readings locally (24-hour buffer); network server failover to standby | 1 hour |
| **Edge GPU failure on spray rig** | Single rig loses AI targeting | Auto-failback to broadcast spray mode (solenoid fail-safe); alert operator | Immediate |
| **Model corruption in edge fleet** | Spray accuracy degradation | Auto-rollback to previous model version; fleet-wide halt if corruption is widespread | < 5 min per rig |
| **Imagery object store corruption** | Historical imagery lost | Re-download source imagery from satellite provider; reprocess pipeline is idempotent | 48 hours |

### Chaos Engineering Test Scenarios

| Test | Frequency | Purpose |
|------|-----------|---------|
| Kill random satellite processing worker | Weekly | Verify job re-queue and processing continuity |
| Disconnect LoRaWAN gateway from cellular backhaul | Monthly | Verify 24-hour gateway buffering and sensor data recovery |
| Corrupt edge model file on test rig | Monthly | Verify signature check catches corruption and triggers rollback |
| Simulate 48-hour cloud outage | Quarterly | Verify all edge operations continue autonomously; verify data sync after recovery |
| Inject bad weather forecast data | Quarterly | Verify irrigation optimizer bounds checking; verify yield prediction anomaly detection |
| Overload drone processing queue (10x normal volume) | Monthly | Verify auto-scaling triggers; verify priority tiers function correctly |
| Simulate spray rig with corrupted GPS | Monthly | Verify geofence safety (buffer zones) gracefully handles GPS uncertainty |
| Flood LoRaWAN gateway with burst traffic | Monthly | Verify collision handling and message deduplication under Aloha contention |

---

## Edge Hardware Lifecycle Management

### Hardware Refresh Strategy

Edge spray controllers have a useful life of 5–7 years. Managing hardware across 50,000+ rigs requires systematic lifecycle tracking:

```
Hardware lifecycle stages:
  1. Provisioning: new rig registered, hardware spec validated, initial model loaded
  2. Active: operational, receiving model updates, generating spray logs
  3. Degraded: hardware nearing end of life (GPU thermal issues, camera degradation)
  4. End of life: hardware cannot run current model version; restricted to broadcast mode

Refresh triggers:
  - GPU cannot meet 8 ms inference budget with current model generation
  - Camera resolution insufficient for latest model input requirements
  - SSD write endurance exhausted (typical: 3–5 years at 180 MB/sec write rate)
  - Solenoid response time degraded beyond 3 ms (mechanical wear)

Compatibility matrix:
  Each model release specifies minimum hardware requirements:
  - Minimum TOPS (INT8): current = 275; projected year 3 = 400
  - Minimum memory: current = 8 GB; projected year 3 = 16 GB
  - Minimum camera resolution: 2 MP (current); 4 MP (year 3)

  Rigs below minimum receive the last compatible model version indefinitely
  and are flagged for hardware refresh in the next maintenance cycle.

Fleet statistics (projected):
  - Year 1: 100% compatible with current model
  - Year 3: 85% compatible; 15% on legacy models
  - Year 5: 60% compatible; 40% on legacy models (refresh cycle begins)
  - Target: < 20% of fleet on legacy models at any time
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
