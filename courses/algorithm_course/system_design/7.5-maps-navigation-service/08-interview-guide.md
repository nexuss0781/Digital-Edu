# Interview Guide — Maps & Navigation Service

## 45-Minute Pacing

| Time | Phase | Focus |
|---|---|---|
| 0–5 min | **Clarify Scope** | What aspects? (tile serving + routing + geocoding? all three? focus area?) What scale? Mobile-first or API platform? |
| 5–15 min | **High-Level Architecture** | Tile system + routing system + traffic pipeline. Draw the CDN → origin → object storage flow. Show Route Service with in-memory graph. |
| 15–28 min | **Deep Dive: Routing Algorithm** | This is the key differentiator. Explain Dijkstra limitations → A* improvement → Contraction Hierarchies breakthrough. Walk through preprocessing + bidirectional query. |
| 28–38 min | **Tile System + Traffic** | CDN-first architecture, vector vs raster, tile pyramid. Traffic probe ingestion via message queue → map matching → speed aggregation. |
| 38–43 min | **Scalability & Trade-offs** | Graph partitioning, offline maps, geocoding scaling. Discuss key trade-offs. |
| 43–45 min | **Wrap-up** | Summarize decisions, mention areas for further exploration (ETA ML models, 3D tiles, transit routing). |

---

## Opening: Scope Clarification Questions

Ask these before designing:

1. **"Which aspects should I focus on?"** — Full maps platform or specific subsystem (routing only, tile serving only)?
2. **"What travel modes?"** — Driving only, or also walking/cycling/transit? (Transit adds massive complexity)
3. **"What scale?"** — City-level service or global (Google Maps scale)?
4. **"Real-time traffic required?"** — Dramatically changes routing architecture
5. **"Offline support needed?"** — Adds on-device routing and tile packaging
6. **"API platform or consumer app?"** — B2B (API keys, rate limits) vs B2C (user accounts, history)

---

## What Makes Maps Uniquely Hard

Present these to the interviewer to demonstrate depth:

### 1. The Routing Algorithm is a Real Computer Science Problem
- Dijkstra on 700M nodes: **minutes** per query
- A*: **10–30 seconds** (with good Practical rule of thumb)
- Contraction Hierarchies: **< 5 milliseconds** (with hours of preprocessing)
- This is not just "use a graph database" — it requires understanding preprocessing-based speedup techniques

### 2. The Tile System Inverts Traditional Architecture
- At 35M req/sec, the CDN is not a cache — it IS the serving infrastructure
- Origin handles < 1% of traffic
- This is one of the most extreme CDN-dependency architectures in any system

### 3. Geometric Complexity
- Web Mercator projection distorts distances near poles
- Tile coordinates follow a quadtree decomposition (not simple grid)
- Spatial indexing (S2 cells, geohash) is fundamental to every subsystem

### 4. Data Freshness vs Serving Performance
- Pre-generating tiles is fast to serve but slow to update
- On-demand generation is always fresh but adds latency
- Hybrid approach (pre-gen low zoom, on-demand high zoom) balances both

### 5. Multi-Modal Routing
- Driving: road graph with speed limits, one-way streets, turn restrictions
- Walking: pedestrian paths, crosswalks, stairs, elevation
- Cycling: bike lanes, elevation preference, surface type
- Transit: schedule-based, transfers, real-time delays
- Each mode needs a **different graph representation**

---

## Key Trade-Offs Table

| Decision | Option A | Option B | Recommendation | Why |
|---|---|---|---|---|
| Tile format | Raster PNG | Vector tiles (MVT) | **Vector** | 60–75% smaller; client-side rendering enables customization, rotation, retina |
| Routing algorithm | Dijkstra / A* | Contraction Hierarchies | **CH** | 1000× faster for long routes; sub-5ms vs minutes |
| Traffic data source | Fixed sensors only | Probe vehicles (crowdsourced) | **Probe vehicles** | Scale with users; no per-road infrastructure; global coverage |
| Tile generation | All tiles pre-generated | On-demand + cache | **Hybrid** | Pre-gen zoom 0–12; on-demand 13+. Balances freshness + latency |
| Graph storage | Disk-based with indexing | In-memory adjacency list | **In-memory** | Disk seek latency makes routing 100× slower; 50GB fits in modern servers |
| Graph scope | Full planet per instance | Regional partitions | **Depends on scale** | Full planet simpler but needs 128GB+ RAM; partitions for cost efficiency |
| Geocoding index | Relational DB + spatial | Full-text search engine | **Full-text search** | Better fuzzy matching, faster prefix search, built-in relevance scoring |
| Offline maps | No offline support | Region download packages | **Region packages** | Critical for tunnels, rural areas; delta updates keep size manageable |
| Traffic model | Real-time only | Historical + real-time blend | **Blend** | Historical handles low-probe areas; real-time catches anomalies |
| Map data source | Proprietary surveying only | OpenStreetMap + enrichment | **OSM + enrichment** | OSM has global coverage; enrich with commercial data for POI, imagery |

---

## Algorithm Deep Dive — How to Explain Contraction Hierarchies

### Step 1: Start with the Problem
> "Running Dijkstra on the planet's road network — 700 million nodes, 1.5 billion edges — takes minutes per query. We need sub-second routing. How?"

### Step 2: Intuition
> "Key insight: most long-distance routes use highways. If you're going from Paris to Berlin, you don't need to consider every residential street in Belgium. Contraction Hierarchies formalizes this by creating a node importance hierarchy."

### Step 3: Preprocessing (Offline)
> "We rank every node by importance — highway intersections rank high, dead-end residential streets rank low. Then we iteratively contract the least important node by adding shortcut edges that bypass it. A shortcut from A to C (bypassing B) means 'the shortest path from A to C through B has this weight.' After contracting all nodes, we have a hierarchical graph with shortcut edges."

### Step 4: Query (Online)
> "For a query from source S to target T, we run bidirectional Dijkstra — but with a twist: each search only goes upward in the hierarchy (toward more important nodes). The forward search from S climbs up; the backward search from T climbs up. They meet at a high-importance node (typically a highway). Because both searches only explore upward, the search space is tiny — typically a few thousand nodes instead of hundreds of millions."

### Step 5: Performance Numbers
> "Preprocessing takes 2–4 hours for the planet. But queries take < 5ms, even for transcontinental routes. That's a 1000× improvement over Dijkstra. The trade-off is clear: invest offline hours to save online milliseconds."

---

## Trap Questions and Strong Answers

### "Why not just run Dijkstra?"

**Weak answer**: "Dijkstra is too slow."

**Strong answer**: "Dijkstra explores nodes in order of distance from the source. On a 700M-node graph, even with a priority queue, it explores millions of nodes before reaching a distant target — taking minutes per query. At 58K route req/sec peak, that's computationally impossible. Contraction Hierarchies preprocesses the graph offline (hours) so that online queries explore only thousands of nodes (milliseconds). It's the same idea as precomputing an index for a database — invest in preprocessing to accelerate queries."

### "How do you keep tiles fresh when roads change?"

**Weak answer**: "Regenerate all tiles when data changes."

**Strong answer**: "We use delta invalidation. When a road changes, we compute its geographic bounding box, determine which tiles at each zoom level overlap that box, and invalidate only those specific tiles in CDN and object storage. For a single road change in Manhattan, this might invalidate a few hundred tiles out of billions. Next request triggers on-demand regeneration. Low-zoom tiles (zoom 0–12) are fully pre-generated nightly. Tiles carry ETags so clients can do conditional requests (304 Not Modified) to avoid re-downloading unchanged tiles."

### "How does offline navigation work?"

**Weak answer**: "Download the whole map to the device."

**Strong answer**: "Users download a region package — say, a city or country. The package contains: (1) vector tiles for that region at zoom 0–16, (2) an extracted subgraph of the road network with CH preprocessing, (3) a subset of the geocoding index for local addresses, and (4) POI data. The package for a city like London is ~100MB. Routing runs entirely on-device using the local CH graph — same algorithm, just smaller graph. Delta updates sync only changed data since the last download, reducing bandwidth by 90%+. The key limitation: no real-time traffic in offline mode, so ETAs use historical baselines."

### "How do you handle traffic from millions of vehicles?"

**Weak answer**: "Process each GPS point as it comes in."

**Strong answer**: "GPS traces flow into a message queue partitioned by geographic region. Consumer groups run map matching (HMM-based Viterbi algorithm) to snap noisy GPS points to road segments. Per segment, we compute traversal speed and update a rolling 5-minute weighted average in Redis. The system processes 3.3M updates/sec. We blend real-time speeds with historical 24h × 7day profiles — real-time for roads with many probes, historical baseline for sparse areas. Confidence weighting ensures low-sample segments don't produce noisy speed estimates."

### "Why vector tiles instead of raster?"

**Weak answer**: "They're smaller."

**Strong answer**: "Vector tiles encode geometric primitives (roads as lines, buildings as polygons) rather than pre-rendered pixels. This gives us five advantages: (1) 60–75% size reduction per tile; (2) client-side rendering enables runtime style customization (day/night mode, accessibility themes); (3) smooth rotation and tilt (raster pixelates); (4) native retina resolution without 2× tiles; (5) interactive features — hovering over a building shows its metadata because the data is structured, not pixels. The trade-off is higher client GPU usage, but modern mobile devices handle this easily."

---

## Scoring Rubric — What Interviewers Look For

| Dimension | Junior | Mid | Senior/Staff |
|---|---|---|---|
| **Scale understanding** | "Use a graph database" | "In-memory graph, needs lots of RAM" | "120GB in-memory; CH preprocessing; regional partitions for cost; full planet for simplicity" |
| **Tile system** | "Serve map images" | "CDN caching, pre-generate tiles" | "Vector tiles, quadtree pyramid, hybrid pre-gen/on-demand, delta invalidation, multi-CDN" |
| **Routing depth** | "Use shortest path algorithm" | "A* with Practical rule of thumb" | "Contraction Hierarchies: preprocessing, bidirectional upward search, shortcut expansion, 1000× speedup" |
| **Traffic system** | "Get traffic data from sensors" | "Crowdsourced from phones" | "Kafka-based probe ingestion, HMM map matching, 5-min rolling aggregation, historical+real-time blend" |
| **Trade-off discussion** | Lists one option | Compares two options | Explains why, quantifies impact, discusses when each is appropriate |

---

## Common Mistakes to Avoid

1. **Ignoring the CDN** — You cannot serve 35M tile req/sec from application servers. The CDN is the system.
2. **Treating routing as a simple BFS/DFS** — Planet-scale routing is a hard algorithmic problem. Mention CH or at minimum A*.
3. **Forgetting offline mode** — Navigation must work in tunnels and areas with no connectivity.
4. **Mixing up forward/reverse geocoding** — Forward = address → coordinates; Reverse = coordinates → address.
5. **Ignoring geopolitical issues** — Maps are politically sensitive. Disputed borders must be handled per-country.
6. **Treating traffic as a simple lookup** — Map matching, aggregation, confidence weighting, and historical blending are all necessary.
7. **Not quantifying** — "Lots of tiles" is weak. "300B tiles/day, 35M/sec peak, 99%+ from CDN" is strong.

---

## Additional Trade-Offs

### Trade-off 4: Full Planet Graph vs Regional Partitioning

| Approach | Pros | Cons | When to Use |
|---|---|---|---|
| **Full planet per instance** | Simple routing — any instance handles any query; no cross-region stitching | 128GB+ RAM per instance; expensive; slower cold start | Smaller deployments; simplicity is priority |
| **Regional partitions** | 15–30GB per instance; cheaper; faster cold start | Cross-region routes need stitching through border nodes; complex request routing | Large-scale production; cost-sensitive |

**Recommendation**: Start with full planet for simplicity. Partition when the cost of 128GB machines across 50+ instances becomes prohibitive, or when cold-start time (loading 120GB graph) exceeds deploy SLOs.

### Trade-off 5: Pre-Generate All Tiles vs Fully On-Demand

| Approach | Pros | Cons | When to Use |
|---|---|---|---|
| **Pre-generate all zoom levels** | Zero latency for any tile request; no origin compute at serve time | Petabytes of storage; days to regenerate; 99% of high-zoom tiles never requested | If storage is cheap and generation pipeline has excess capacity |
| **Fully on-demand + cache** | Only generates tiles that are actually requested; minimal storage waste | First request for any tile incurs 200ms generation latency; CDN miss storm during updates | If storage costs dominate |
| **Hybrid (recommended)** | Pre-gen zoom 0–12 (fast first load); on-demand 13+ (lazy evaluation) | Slightly more complex invalidation logic | Almost always the right choice |

---

## Additional Questions

### Q6: "How would you add EV routing?"

**Strong answer**: "EV routing transforms shortest-path into constrained optimization. The Route Service needs a vehicle energy model that factors in distance, elevation change, speed, temperature, and payload to compute energy consumption per edge. When projected state-of-charge drops below a safe buffer (10–15%), the algorithm inserts charging stops at compatible stations. The optimization target changes from minimize(driving_time) to minimize(driving_time + charging_time). This adds a state dimension to CH queries — you can't just preprocess edge weights because the 'cost' of an edge depends on current battery level. Solutions include multi-criteria CH or a two-phase approach: compute unconstrained route first, then insert optimal charging stops."

### Q7: "What happens during a CDN provider outage?"

**Strong answer**: "We use a multi-CDN strategy — tiles served from two CDN providers simultaneously. DNS-based health checks detect when a CDN provider becomes unhealthy and shift traffic to the backup within 30 seconds. During failover, the backup CDN's cache may be partially cold (different edge locations), so origin traffic spikes temporarily. The origin has back-pressure mechanisms: serve stale tiles from object storage rather than regenerating, shed ultra-high-zoom requests first. Because tiles have 12-hour cache TTL and ETags for validation, most users never notice the switch."

### Q8: "How do you ensure map data accuracy?"

**Strong answer**: "Multi-layer validation pipeline. Data ingested from multiple sources (open data, survey data, commercial partners, user reports) goes through: (1) schema validation — required fields, coordinate bounds, topology checks. (2) Conflict resolution — when sources disagree, use freshness + source reliability ranking. (3) Topology validation — no disconnected road segments, no impossible geometries. (4) Regression testing — run standard routing queries against new data; flag significant route changes. (5) Community review — crowdsourced edits go through automated checks + manual review for high-impact changes. The graph build pipeline computes checksums and runs smoke tests before deploying to Route Service instances."

---

## Architectural Decision Justification Cheat Sheet

| Decision | One-Line Justification |
|---|---|
| Vector tiles over raster | 60–75% smaller + client-side rendering enables runtime customization |
| Contraction Hierarchies over A* | 1000× faster queries; preprocessing cost amortized across billions of queries/day |
| CDN as primary serving tier | 35M req/sec impossible from origin; CDN IS the system, not a cache layer |
| In-memory graph over disk | Random-access graph traversal needs nanosecond latency; disk is 100× too slow |
| HMM map matching over nearest-road | Nearest-road fails at intersections and parallel roads; HMM uses route continuity |
| Historical + real-time traffic blend | Historical handles sparse probe areas; real-time catches anomalies; confidence-weighted |
| Hybrid tile generation | Pre-gen low zoom (always needed) + on-demand high zoom (most never requested) |
| Kafka for probe ingestion | 3.3M updates/sec needs distributed log; Kafka's partitioning enables geographic parallelism |

---

## Common Mistakes Table

| # | Mistake | Why It's Wrong | Better Approach |
|---|---|---|---|
| 1 | "Use a graph database for routing" | Graph DBs are general-purpose; too slow for 700M-node shortest path | In-memory adjacency list with Contraction Hierarchies |
| 2 | "Generate all tiles upfront" | 17.6T tiles at zoom 22 — impossible to pre-generate | Hybrid: pre-gen zoom 0–12; on-demand 13+ |
| 3 | "Just use Dijkstra" | Minutes per query on planet-scale graph | CH: 1000× faster after preprocessing |
| 4 | "Snap GPS to nearest road" | Fails at intersections, parallel roads, overpasses | HMM-based map matching (Viterbi algorithm) |
| 5 | "Traffic from road sensors only" | Requires physical infrastructure on every road | Crowdsourced probe vehicles scale with users |
| 6 | "One global tile cache" | Users in Tokyo can't wait for tiles from US CDN edge | Multi-CDN with globally distributed edge nodes |
| 7 | "Store raw GPS traces long-term" | Privacy violation; reveals movement patterns | Aggregate to per-segment speeds; delete raw within 24h |
| 8 | "Same map for all countries" | Disputed borders shown wrong → diplomatic incidents | Per-country tile variants for disputed areas |

---

## Quick Whiteboard Sketch Sequence

1. **Minute 0–3**: Draw CDN → Origin → Object Storage for tile serving. Label "99%+ from CDN"
2. **Minute 3–8**: Add Route Service box with "CH Engine" label. Show in-memory graph. Connect to Redis for traffic weights
3. **Minute 8–12**: Draw traffic pipeline: Probe → Kafka → Map Matching → Speed Aggregation → Redis
4. **Minute 12–15**: Add Geocoding with spatial DB and prefix trie. Connect Navigation Session to Route Service + ETA

---

## System Comparison Guide

| System | How Maps Differs |
|---|---|
| **CDN/Static Assets** | Maps CDN handles 35M req/sec with per-tile invalidation; static CDN has simpler invalidation |
| **Social Graph** | Both are large-scale graphs, but maps graph has geometric properties and requires spatial queries |
| **Real-time Analytics** | Traffic pipeline is similar (stream → aggregate → serve) but with spatial map matching step |
| **Search Engine** | Geocoding uses similar inverted index + fuzzy matching, but adds spatial ranking dimension |
| **Ride-sharing** | Both use routing, but ride-sharing adds supply-demand matching on top of pathfinding |

---

## Extension Topics (If Time Allows)

| Topic | Key Point |
|---|---|
| **ETA with ML** | Train model on historical trips; features include time-of-day, weather, events, road type; graph neural networks for segment-level prediction |
| **3D Tiles** | Photorealistic 3D buildings; 3D Tiles format (OGC standard); progressive LoD (level of detail); WebGPU rendering |
| **Transit routing** | Schedule-based graph (GTFS data); time-dependent edge weights; multi-modal transfer penalties; real-time delay feeds |
| **Indoor maps** | Floor plans for airports, malls; separate tile set per floor; indoor positioning (Wi-Fi, BLE beacons) |
| **Autonomous vehicle maps** | HD maps with lane-level precision; centimeter accuracy; real-time updates for construction; sensor fusion |
| **Map editing/crowdsourcing** | User-reported road changes → validation pipeline → map update → tile regeneration |
| **AR navigation** | Camera + GPS + IMU fusion; overlay turn arrows on real-world view; requires precise positioning |
| **Overture Maps** | Open data initiative (Linux Foundation); standardized schema; challenging proprietary map data monopolies |

---

## Deep Dive Selection Strategy

| If Interviewer Asks About... | Dive Into | Key Numbers to Cite |
|---|---|---|
| "Scale" or "performance" | CDN-first tile serving + CH routing algorithm | 35M req/sec tiles, 99%+ CDN hit, < 5ms CH query, 1000× over Dijkstra |
| "Algorithms" | Contraction Hierarchies + HMM map matching | 700M nodes, 1.5B edges, 500M shortcuts, Viterbi decoding |
| "Real-time" | Traffic probe pipeline | 3.3M updates/sec, Kafka 128 partitions, 5-min rolling aggregation |
| "Data" | Tile pyramid + road network data model | 23 zoom levels, 17.6T max tiles, 120GB graph in memory |
| "Reliability" | Multi-CDN failover + offline navigation | 30s DNS failover, 50–100MB city offline package, delta updates |
| "Privacy" | Probe data anonymization pipeline | Strip user ID, truncate endpoints 200m, temporal fuzzing, 24h raw deletion |

---

## Red Flags Table

| Red Flag (Candidate Says) | Why It's Concerning | Better Answer Direction |
|---|---|---|
| "Store routes in a database" | Routes are computed, not stored; caching is short-lived | In-memory CH graph; compute on-the-fly |
| "Use one big server for the graph" | Single point of failure; no horizontal scaling | Regional partitions or replicated full-planet instances |
| "Cache all routes" | Routes depend on live traffic; stale routes are dangerous | Very short TTL (5 min) for popular O-D pairs only |
| "Process each GPS point independently" | Loses track context; wrong road assignment at intersections | HMM with Viterbi for sequence-aware matching |
| "Real-time traffic everywhere" | Rural areas have too few probes for real-time | Historical baseline + real-time blend with confidence weighting |

---

## Scoring Dimensions (Extended)

| Dimension | What Gets Full Marks |
|---|---|
| **CDN architecture** | Explains CDN as primary tier (not cache); quantifies 35M req/sec; discusses multi-CDN failover |
| **Algorithm depth** | Walks through CH preprocessing + bidirectional upward search; mentions shortcut expansion |
| **Traffic pipeline** | End-to-end: probe → Kafka → HMM map matching → speed aggregation → Redis → routing |
| **Data freshness trade-offs** | Pre-gen vs on-demand tiles; historical + real-time traffic blend; graph update frequency |
| **Offline mode** | Region packages with on-device CH routing; delta updates; historical ETA fallback |
| **Privacy & geopolitics** | Probe anonymization pipeline; per-country border variants; data sovereignty requirements |

---

## Five-Minute Elevator Pitch

> "A Maps & Navigation platform is a CDN-first architecture serving 300 billion tile requests per day. The CDN IS the system — origin handles less than 1%. Tiles use vector format (MVT) for 60–75% size reduction and client-side GPU rendering. Routing runs Contraction Hierarchies on the planet's 700M-node road graph held entirely in memory (~120GB), achieving sub-5ms query times — a 1000× speedup over Dijkstra. Real-time traffic comes from 100M+ probe vehicles: GPS traces flow through Kafka, get map-matched to road segments via HMM/Viterbi, and aggregate into 5-minute speed buckets in Redis, blended with historical 24h×7day profiles. Geocoding combines full-text fuzzy search with spatial indexing across dozens of country-specific address formats. The system must handle geopolitical sensitivity (per-country border rendering), offline navigation (on-device CH routing), and EV-aware routing (range-constrained optimization). Key trade-offs: pre-gen vs on-demand tiles, full-planet vs regional graph partitioning, real-time vs historical traffic blend weights."
