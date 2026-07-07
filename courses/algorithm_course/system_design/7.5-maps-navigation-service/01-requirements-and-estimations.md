# Requirements & Estimations — Maps & Navigation Service

## Functional Requirements

### Map Rendering
- Display interactive map tiles at any zoom level (0–22) for any location on Earth
- Support pan, zoom, rotate, and tilt interactions with smooth tile loading
- Render vector tiles client-side with customizable styling (day/night mode, terrain)
- Support satellite imagery overlay and 3D building views at high zoom levels

### Routing
- Calculate optimal route between two or more points (waypoints supported)
- Support multiple travel modes: driving, walking, cycling, public transit
- Provide alternative routes ranked by time, distance, or preference
- Traffic-aware routing with real-time congestion data
- Avoid preferences: tolls, highways, ferries, unpaved roads
- Re-routing when user deviates from planned path

### Turn-by-Turn Navigation
- Real-time voice guidance with lane-level instructions
- Speed limit display and speeding alerts
- Estimated time of arrival (ETA) with continuous updates
- Incident and hazard alerts along route
- Offline navigation with pre-downloaded region data

### Geocoding
- Forward geocoding: address string → (latitude, longitude)
- Reverse geocoding: (latitude, longitude) → formatted address
- Autocomplete suggestions as user types an address
- Support multilingual address formats and scripts

### Search & Points of Interest
- POI search: "coffee shops near me", "gas stations along route"
- Category-based browsing (restaurants, hotels, hospitals)
- Business details: hours, ratings, photos, contact info
- Search results ranked by relevance, distance, and popularity

### Traffic
- Real-time traffic speed overlay on map tiles
- Incident reporting (accidents, road closures, construction)
- Historical traffic patterns for future trip planning

---

## Non-Functional Requirements

| Requirement | Target | Rationale |
|---|---|---|
| **Tile serve latency** | p99 < 100ms (CDN hit), < 500ms (origin) | Map must feel instantaneous during pan/zoom |
| **Route calculation** | p99 < 2s (city), < 5s (cross-country) | Users expect near-instant route results |
| **Geocoding latency** | p99 < 200ms | Autocomplete must feel real-time |
| **Search latency** | p99 < 300ms | POI results during navigation must be fast |
| **Tile cache hit rate** | > 99% at CDN edge | Origin cannot handle full tile request volume |
| **Traffic data freshness** | < 5 min from probe to map display | Stale traffic defeats the purpose |
| **Map data freshness** | Road changes reflected within 24 hours | New roads, closures must appear quickly |
| **Availability** | 99.99% for tile serving, 99.95% for routing | Maps is a critical service for navigation safety |
| **Offline capability** | Full navigation for downloaded regions | Users in tunnels, rural areas need offline |
| **Global coverage** | Every country, every road classification | Service must work everywhere |

### CAP Theorem Choice

**AP (Availability + Partition Tolerance)** — Tile serving and routing must remain available even during network partitions. Serving a slightly stale tile or using cached traffic data is acceptable; being unavailable is not.

---

## Scale Estimations

### Traffic Volume

| Metric | Calculation | Result |
|---|---|---|
| Daily Active Users (DAU) | Google Maps scale | **1B** |
| Map sessions per user per day | Average across casual + navigation use | **10** |
| Tiles per map session | ~30 tiles per view (pan/zoom generates more) | **30** |
| **Total tile requests/day** | 1B × 10 × 30 | **300B/day** |
| **Average tile req/sec** | 300B / 86,400 | **~3.5M req/sec** |
| **Peak tile req/sec** | 10× average (rush hour, global) | **~35M req/sec** |
| Routing queries/day | 1B users × ~1 route/day average | **~1B/day** |
| **Routing req/sec (avg)** | 1B / 86,400 | **~11.5K req/sec** |
| **Routing req/sec (peak)** | 5× average | **~58K req/sec** |
| Geocoding queries/day | Similar to routing + autocomplete | **~2B/day** |
| **Geocoding req/sec (avg)** | 2B / 86,400 | **~23K req/sec** |
| Traffic probe updates | 100M active vehicles × 1 update/30s | **~3.3M updates/sec** |

### Storage

| Data Type | Size | Notes |
|---|---|---|
| Road network graph (planet) | ~50GB compressed | 700M nodes, 1.5B edges with metadata |
| Vector tiles (all zoom levels) | ~100–200TB | Zoom 0–22, global coverage |
| Raster tiles (legacy, all zooms) | ~1–2PB | PNG format, much larger than vector |
| Geocoding spatial index | ~200GB | Addresses, POIs, spatial indexes |
| Traffic time-series (7 days) | ~5TB | Speed per edge, 5-min buckets |
| Historical traffic profiles | ~2TB | 24h × 7day per edge, aggregated |
| Satellite imagery tiles | ~10PB+ | High-resolution global coverage |
| POI database | ~500GB | Business info, reviews, photos metadata |

### Bandwidth

| Flow | Calculation | Result |
|---|---|---|
| Tile serving (CDN egress) | 300B tiles/day × 15KB avg vector tile | **~4.5PB/day** |
| Traffic probe ingestion | 3.3M updates/sec × 200 bytes | **~660MB/sec** |
| Route responses | 58K peak/sec × 5KB avg response | **~290MB/sec peak** |

---

## SLOs and SLAs

| Service | SLO | SLA (contractual) | Measurement |
|---|---|---|---|
| Tile Serving | p99 < 100ms, 99.99% availability | 99.95% uptime | CDN edge response time |
| Routing | p99 < 2s (city), 99.95% availability | 99.9% uptime | End-to-end route computation |
| Geocoding | p99 < 200ms, 99.95% availability | 99.9% uptime | Query to first result |
| Traffic Freshness | 95% of segments updated within 5 min | 90% within 10 min | Probe-to-display lag |
| Navigation ETA | Within ±15% of actual arrival 90% of time | ±20% accuracy | Predicted vs actual |
| Map Data Freshness | Road changes in < 24h | < 48h for critical changes | Change detection to tile update |

---

## Key Constraints

| Constraint | Requirement | Impact |
|---|---|---|
| **CDN is mandatory** | 99%+ tiles from edge cache | No origin farm can handle 35M req/sec |
| **In-memory graph** | Full road network in RAM | Disk-based routing 100× too slow |
| **CH preprocessing** | 2–4 hours offline per rebuild | Enables < 5ms online queries (1000× vs Dijkstra) |
| **Multi-region deployment** | Edge nodes within 50ms of every user | Tokyo users cannot wait for US-origin responses |
| **Offline-first navigation** | Full routing without network | Tunnels, rural areas, developing regions |
| **Geopolitical compliance** | Per-country border variants | Legal requirement; wrong borders → diplomatic incidents |
| **Probe data sovereignty** | GPS traces processed and deleted per jurisdiction | GDPR, CCPA, China cybersecurity law |

---

## Growth Projections (2026–2028)

| Metric | 2026 Baseline | 2027 Projected | 2028 Projected | Growth Driver |
|---|---|---|---|---|
| DAU | 1B | 1.15B | 1.3B | Emerging market smartphone penetration |
| Tile req/day | 300B | 370B | 450B | Higher zoom usage (3D, AR navigation) |
| Routing req/day | 1B | 1.3B | 1.7B | EV routing, multi-modal transit growth |
| Probe vehicles | 100M active | 130M | 170M | Connected vehicle OEM integrations |
| Offline downloads/day | 5M | 8M | 12M | Rural connectivity programs, travel growth |
| EV-specific routes/day | 50M | 120M | 250M | EV adoption curve (charging stop optimization) |

---

## Surge Event Capacity Planning

| Event Type | Traffic Multiplier | Affected Subsystems | Pre-Scaling Strategy |
|---|---|---|---|
| **New Year's Eve** (global) | 3–5× tile + navigation | CDN, Route Service, Navigation | Pre-warm city tiles; 3× Route Service instances 6h prior |
| **Major sports event** (city) | 10× tile for event area | CDN, Tile Origin | Pre-generate zoom 13–18 tiles for venue + 5km radius |
| **Natural disaster** (region) | 5–8× routing in affected area | Route Service, Navigation | Auto-scale; serve cached routes if origin overloaded |
| **Holiday travel** (national) | 2–3× routing, highway traffic | Route Service, Traffic Pipeline | Scale traffic pipeline 2× for 48h window |
| **Map data update** (global) | 50× tile generation burst | Tile Pipeline, Object Storage | Stagger tile regeneration; prioritize popular regions |

---

## Cost Estimation (Annual, Google-Scale Platform)

| Component | Cost Driver | Annual Estimate |
|---|---|---|
| CDN egress | 4.5PB/day tile serving | ~$60M |
| Compute (Route Service) | 50 high-memory machines × 3 regions | ~$8M |
| Compute (Traffic Pipeline) | 160 machines × 3 regions | ~$12M |
| Compute (Tile Generation) | 80 machines × 3 regions | ~$6M |
| Object Storage (tiles) | ~200TB vector tiles | ~$4M |
| Redis Cluster (traffic) | 64 shards × 3 regions with replicas | ~$5M |
| Kafka Cluster | 128 partitions, 3-day retention | ~$3M |
| Satellite Imagery | Licensing + processing | ~$20M |
| Map Data Licensing | OSM, government datasets, commercial | ~$15M |
| **Total** | | **~$133M/year** |

*Note: CDN egress dominates costs. Vector tile migration from raster saves ~$40M/year in bandwidth.*

---

## SLO Error Budget Allocation

| SLO | Monthly Budget | Allocation |
|---|---|---|
| Tile availability 99.99% | 4.3 min downtime | 2 min planned maintenance + 2.3 min unplanned |
| Route availability 99.95% | 21.6 min downtime | 10 min deploy windows + 11.6 min unplanned |
| Route latency p99 < 2s | 0.5% requests over budget | 0.2% deploy-related + 0.3% traffic spikes |
| Traffic freshness < 5 min | 5% time over budget | 3% pipeline deploys + 2% Kafka rebalances |
| Geocoding p99 < 200ms | 0.5% requests over budget | 0.3% index rebuilds + 0.2% replica lag |

---

## Document Type Distribution

| Road Class | Edge Count | % of Graph | Routing Importance |
|---|---|---|---|
| Motorway / Trunk | ~15M | 1% | Backbone of long-distance routing; always in CH upper hierarchy |
| Primary / Secondary | ~100M | 6.7% | Key connector roads; medium CH rank |
| Tertiary | ~200M | 13.3% | Local connectors; lower CH rank |
| Residential / Service | ~1.18B | 79% | Last-mile; lowest CH rank, rarely in long-route queries |

*This distribution explains why CH is so effective: 99% of long routes use only the top ~7% of edges.*

---

## Network Topology Requirements

| Path | Protocol | Latency Requirement | Bandwidth |
|---|---|---|---|
| Client → CDN Edge | HTTPS (TLS 1.3) | < 50ms (geographic proximity) | 4.5PB/day egress |
| CDN Edge → Tile Origin | HTTPS (origin pull) | < 200ms | ~50TB/day (< 1% miss) |
| Client → API Gateway | HTTPS (TLS 1.3) | < 100ms | ~1TB/day (route + geocode + traffic) |
| API Gateway → Route Service | gRPC (mTLS) | < 5ms (same region) | ~50GB/day |
| Traffic Pipeline → Kafka | TCP (TLS) | < 10ms | 660MB/sec ingest |
| Kafka → Map Matching | TCP (TLS) | Variable (consumer lag) | 660MB/sec consume |
| Route Service → Redis | TCP (mTLS) | < 2ms (same AZ) | ~100GB/day reads |

---

## EV Routing Requirements (2026 Addition)

| Requirement | Target | Rationale |
|---|---|---|
| Charging station coverage | 95% of charging networks indexed | EV users expect reliable charger availability |
| Route with charging stops | p99 < 5s (adds constraint optimization) | More complex than standard routing |
| Battery consumption model | ±10% accuracy per edge | Factors: elevation, speed, temperature, payload |
| Charger availability freshness | < 15 min real-time occupancy | Stale data leads to users arriving at occupied chargers |
| Range anxiety buffer | Default 10–15% minimum SoC at each stop | Safety margin for unexpected consumption |

---

## Multi-Modal Routing Complexity

| Travel Mode | Graph Representation | Unique Challenges |
|---|---|---|
| **Driving** | Road network with speed limits, one-way, turn restrictions | Traffic-aware; tolls; vehicle type restrictions |
| **Walking** | Pedestrian paths, crosswalks, stairs, park trails | Elevation matters; stairs impassable for wheelchair |
| **Cycling** | Bike lanes, shared roads, trails | Surface type preference; elevation avoidance; safety scoring |
| **Transit** | Schedule-based (GTFS); stops + routes + transfers | Time-dependent edges; real-time delay feeds; fare zones |
| **Multi-modal** | Combined graph with transfer nodes | Walk to bus stop → bus → walk to train → train → walk; explosion of transfer combinations |

*Transit adds an order of magnitude more complexity because edge weights are time-dependent — a bus route at 8:00 AM has different weight than at 11:30 PM.*

---

## Offline Package Size Estimation

| Region Scope | Vector Tiles | Road Graph (CH) | Geocoding Index | POI Data | Total |
|---|---|---|---|---|---|
| City (e.g., Manhattan) | ~30MB | ~10MB | ~8MB | ~5MB | ~53MB |
| Metro area (e.g., Greater London) | ~80MB | ~25MB | ~20MB | ~15MB | ~140MB |
| State/Province (e.g., California) | ~150MB | ~60MB | ~40MB | ~30MB | ~280MB |
| Country (e.g., Germany) | ~400MB | ~120MB | ~80MB | ~60MB | ~660MB |
| Country (e.g., India) | ~600MB | ~200MB | ~150MB | ~100MB | ~1.05GB |
| Continent (e.g., Europe) | ~2GB | ~500MB | ~400MB | ~300MB | ~3.2GB |

*Delta updates after initial download typically reduce sync bandwidth by 90–95%.*
