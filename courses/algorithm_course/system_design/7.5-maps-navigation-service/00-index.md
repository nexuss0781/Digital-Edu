# Maps & Navigation Service

## System Overview

A Maps & Navigation Service is a globally distributed platform that renders interactive maps, computes optimal routes, provides real-time traffic information, and delivers turn-by-turn navigation guidance. Think Google Maps, Apple Maps, or OpenStreetMap-powered services.

What makes maps architecturally unique is the convergence of **massive geometric data** (the entire planet's road network), **graph-theoretic algorithms** (shortest path with billions of nodes), **real-time streaming** (millions of probe vehicles reporting GPS traces), and **extreme read amplification** (a single map view triggers 20–40 tile fetches). The system must serve billions of tile requests per day at sub-100ms latency while simultaneously ingesting live traffic data and computing routes across continental-scale road networks.

---

## Key Characteristics

| Characteristic | Details |
|---|---|
| **Read/Write Ratio** | Extremely read-heavy (~99.9% reads for tiles); write-heavy for traffic ingestion |
| **Scale** | 1B+ DAU, 300B+ tile requests/day, 700M+ road network nodes |
| **Latency** | Tiles: p99 < 100ms (CDN); Routes: p99 < 2s city-level; Geocoding: p99 < 200ms |
| **Data Volume** | Road graph ~50GB compressed; all zoom-level tiles ~100s of TB in vector format |
| **Freshness** | Traffic: < 5 min lag; Road changes: < 24 hours |
| **Complexity Rating** | Very High — geometric data, graph algorithms, real-time streaming, global CDN |

---

## Key Architectural Themes

1. **Tile Serving at CDN Scale** — Pre-generated and on-demand vector tiles served from global CDN edge nodes with 99%+ cache hit rates
2. **Graph-Based Routing with Contraction Hierarchies** — Preprocessing the road network into a hierarchy enabling millisecond-level cross-country route queries
3. **Real-Time Traffic Ingestion** — Millions of probe vehicles stream GPS traces through Kafka into a map-matching and speed-aggregation pipeline
4. **Geocoding & Spatial Indexing** — Address-to-coordinate resolution using text normalization, fuzzy matching, and geohash-based spatial indexes
5. **Navigation Session Management** — Stateful turn-by-turn guidance with live rerouting on traffic changes or missed turns

---

## Quick Navigation

| # | Document | Description |
|---|---|---|
| 01 | [Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity math |
| 02 | [High-Level Design](./02-high-level-design.md) | Architecture diagram, data flows, key decisions |
| 03 | [Low-Level Design](./03-low-level-design.md) | Data models, APIs, core algorithms (Step-by-step plan in plain English) |
| 04 | [Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Tile system, traffic pipeline, geocoding at scale |
| 05 | [Scalability & Reliability](./05-scalability-and-reliability.md) | CDN strategy, graph partitioning, offline maps |
| 06 | [Security & Compliance](./06-security-and-compliance.md) | Rate limiting, privacy, geopolitical compliance |
| 07 | [Observability](./07-observability.md) | Metrics, alerts, distributed tracing |
| 08 | [Interview Guide](./08-interview-guide.md) | 45-minute pacing, trade-offs, trap questions |
| 09 | [Key Insights](./09-insights.md) | 14 architectural insights for interviews |

---

## Core Components at a Glance

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENT APPS                          │
│              (Web, iOS, Android)                        │
├─────────────────────────────────────────────────────────┤
│                 CDN EDGE NODES                          │
│          (99%+ tile cache hit rate)                     │
├──────────┬──────────┬──────────┬────────┬──────────────┤
│ Tile API │Route API │Geocode   │Search  │Traffic API   │
│          │          │API       │API     │              │
├──────────┴──────────┴──────────┴────────┴──────────────┤
│              BACKEND SERVICES                           │
│  Tile Server │ Route Service │ Geocoding │ Traffic      │
│              │ (CH Engine)   │ Service   │ Processor    │
├─────────────────────────────────────────────────────────┤
│                 DATA LAYER                              │
│  Object Storage │ Graph Store │ Spatial DB │ Redis      │
│  (tiles)        │ (in-memory) │ (geocoding)│ (traffic)  │
├─────────────────────────────────────────────────────────┤
│              DATA PIPELINE                              │
│  OSM Ingest → Graph Builder → Tile Generator            │
│  Probe GPS → Map Matching → Speed Aggregation           │
└─────────────────────────────────────────────────────────┘
```

---

## What Makes This System Uniquely Hard

- **Planetary-scale graph** — The entire road network (700M nodes, 1.5B edges) must fit in memory for fast routing
- **Geometric complexity** — Coordinate projections, tile pyramids, spatial indexing across 23 zoom levels
- **Algorithm depth** — Contraction Hierarchies is a research-level optimization (1000× faster than naive Dijkstra)
- **Freshness vs performance** — Pre-generating tiles for speed vs reflecting road changes within hours
- **Multi-modal routing** — Driving, walking, cycling, and transit each require different graph representations
- **Geopolitical sensitivity** — Disputed territories must render differently based on user's country

---

## Related Patterns

| Pattern | System | Relevance |
|---|---|---|
| CDN-first serving | [Content Delivery Network](../2.5-content-delivery-network/00-index.md) | Tile serving is one of the most extreme CDN-dependency architectures |
| Real-time stream processing | [Notification Service](../1.14-notification-service/00-index.md) | Traffic probe ingestion parallels high-throughput event streaming |
| Spatial indexing (S2/Geohash) | [Proximity Service](../7.1-proximity-service/00-index.md) | Same spatial decomposition for location-based queries |
| Graph algorithms at scale | [Social Graph Service](../4.6-social-graph-service/00-index.md) | Both require in-memory graph traversal on billion-edge networks |
| Time-series data pipeline | [Time-Series Database](../16.2-time-series-database/00-index.md) | Traffic speed history uses identical time-bucketed aggregation |
| Offline-first architecture | [Chat Application](../11.1-chat-application/00-index.md) | Same pattern of local-first with sync-when-connected |
| Search with fuzzy matching | [Text Search Engine](../16.3-text-search-engine/00-index.md) | Geocoding uses inverted indexes, n-gram tokenization, fuzzy scoring |
| Multi-region deployment | [Distributed Tracing](../15.2-distributed-tracing-system/00-index.md) | Both require low-latency reads from geographically closest replica |

---

## Technical Complexity Radar

| Dimension | Complexity | Key Challenge |
|---|---|---|
| **Algorithms** | Very High | Contraction Hierarchies, HMM map matching, Viterbi decoding |
| **Data Volume** | Very High | 300B tile req/day, 3.3M probe updates/sec, 100s TB tile storage |
| **Latency** | Very High | p99 < 100ms tiles, < 5ms CH query, < 200ms geocoding |
| **Freshness** | High | Traffic < 5 min, road changes < 24h |
| **Privacy** | High | GPS traces reveal precise movement patterns |
| **Geopolitical** | High | Disputed borders require per-country tile variants |
| **Geometric** | High | Web Mercator projections, quadtree decomposition, coordinate transforms |
| **Client Complexity** | High | GPU-accelerated vector tile rendering, on-device routing |

---

## Case Studies

| Case Study | Year | Key Lesson |
|---|---|---|
| Global navigation outage due to CH graph corruption during blue-green deploy | 2024 | Graph integrity checksums needed; canary routing test before full traffic switch |
| Traffic data poisoning via coordinated GPS spoofing (99 phones in a wagon) | 2020 | Physics-based probe validation; cross-source corroboration for speed data |
| Disputed territory rendering incident causing diplomatic escalation | 2024 | Automated compliance testing per jurisdiction; A/B tile variant QA pipeline |
| Major event surge (New Year's Eve) overwhelms tile origin servers | 2025 | Pre-warming CDN with event-radius tiles; predictive scaling calendar |
| Overture Maps Foundation open data release challenging proprietary datasets | 2024–2025 | Open data + enrichment model gaining ground; schema interoperability critical |

---

## Evolution Trajectory

| Phase | Era | Architecture |
|---|---|---|
| **Phase 1** | 2005–2010 | Raster tiles, server-side rendering, simple A* routing |
| **Phase 2** | 2010–2015 | Vector tiles, Contraction Hierarchies, crowdsourced traffic probes |
| **Phase 3** | 2015–2020 | ML-based ETA prediction, 3D buildings, indoor mapping |
| **Phase 4** | 2020–2025 | AR navigation, EV-aware routing, Overture Maps open data, WebGPU rendering |
| **Phase 5** | 2025+ | Foundation models for geospatial AI, autonomous vehicle HD maps, on-device ML routing, post-quantum tile signing |

---

## Sources

- Google Maps Platform Architecture Documentation
- Mapbox Vector Tile Specification and Tiling Service
- Geisberger et al., "Contraction Hierarchies: Faster and Simpler Hierarchical Routing in Road Networks"
- OpenStreetMap Wiki — Map Data Pipeline and Rendering Architecture
- Nominatim Geocoding Architecture Documentation
- Overture Maps Foundation Schema Documentation
- Newson & Krumm, "Hidden Markov Map Matching Through Noise and Sparseness" (Microsoft Research)
