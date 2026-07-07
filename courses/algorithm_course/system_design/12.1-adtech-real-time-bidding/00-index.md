# 12.1 AdTech: Real-Time Bidding (RTB) System

## System Overview

A Real-Time Bidding (RTB) system is the auction-driven backbone of programmatic advertising, executing per-impression auctions in under 100 milliseconds as users load web pages, open mobile apps, or stream content. When a publisher's page begins loading, the Supply-Side Platform (SSP) broadcasts a bid request containing impression context (page URL, ad placement dimensions, device type, geographic signals) to dozens of Demand-Side Platforms (DSPs) simultaneously. Each DSP evaluates the impression against thousands of active campaigns—checking targeting criteria, predicting click-through and conversion rates via ML models, computing optimal bid prices using budget pacing algorithms, and returning a bid response—all within a 50–80ms window. The Ad Exchange conducts the auction (typically first-price), selects the winner, returns the creative markup to the publisher's page, and fires impression/click tracking pixels that feed back into billing, attribution, and model training pipelines. Modern RTB platforms at scale process 10–15 million bid requests per second at peak, maintain sub-100ms end-to-end latency from bid request to ad render, serve billions of impressions daily across display, video, native, and Connected TV (CTV) formats, and support the OpenRTB 2.6 protocol standard with extensions for privacy-preserving signals (Topics API, Protected Audience API) as the industry transitions away from third-party cookie dependence.

---

## Key Characteristics

| Characteristic | Description |
|---|---|
| **Architecture Style** | Distributed microservices with edge-deployed bidder nodes, event-driven impression pipeline, and batch analytics layer |
| **Core Abstraction** | Bid request as a time-bounded auction event flowing through evaluation → bidding → auction → rendering → tracking lifecycle |
| **Processing Model** | Ultra-low-latency synchronous path for bid request/response; asynchronous event streaming for impression tracking, attribution, and budget reconciliation |
| **Protocol Stack** | OpenRTB 2.6 over HTTP/2 for bid exchange; VAST/VPAID for video creatives; MRAID for rich media; protobuf for internal service communication |
| **Auction Mechanism** | First-price auction (industry standard since 2019); bid shading algorithms on DSP side to avoid overpayment; floor price optimization on SSP side |
| **Latency Budget** | <100ms end-to-end (SSP timeout); DSP internal budget: ~10ms feature lookup, ~15ms model inference, ~5ms bid calculation, ~20ms network round-trip |
| **Data Consistency** | Eventual consistency for budget tracking with periodic reconciliation; strong consistency for billing events; approximate consistency for frequency capping |
| **Availability Target** | 99.95% for bid serving path; 99.99% for impression/click tracking (revenue-critical); 99.9% for reporting and analytics |
| **Scale Profile** | 10M+ QPS peak bid requests; billions of impressions/day; petabytes of log data monthly; thousands of concurrent campaigns |
| **Privacy Framework** | Topics API integration, Protected Audience API for remarketing, contextual targeting as cookie-less fallback, consent management per GDPR/CCPA |

---

## Quick Navigation

| Document | Focus Area |
|---|---|
| [01 - Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning with RTB-specific math |
| [02 - High-Level Design](./02-high-level-design.md) | Architecture diagrams, bid request lifecycle, Publisher → SSP → Exchange → DSP flow |
| [03 - Low-Level Design](./03-low-level-design.md) | OpenRTB schema, data models, auction algorithms, budget pacing Step-by-step plan in plain English |
| [04 - Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Auction engine internals, budget pacing, fraud detection, race condition analysis |
| [05 - Scalability & Reliability](./05-scalability-and-reliability.md) | Geo-distributed bidding, edge deployment, feature cache warming, multi-region failover |
| [06 - Security & Compliance](./06-security-and-compliance.md) | Ad fraud prevention (IVT), privacy regulations, supply chain integrity, brand safety |
| [07 - Observability](./07-observability.md) | Bid/win/loss metrics, latency histograms, revenue dashboards, discrepancy detection |
| [08 - Interview Guide](./08-interview-guide.md) | 45-minute pacing strategy, RTB-specific trap questions, trade-off discussions |
| [09 - Insights](./09-insights.md) | Key architectural insights and cross-cutting patterns |

---

## What Differentiates This System

| Dimension | Basic Ad Server | Production RTB Platform |
|---|---|---|
| **Auction Model** | Static CPM waterfall with priority tiers | Real-time first-price auction across dozens of DSPs with bid shading and floor optimization |
| **Latency Constraint** | Seconds-tolerable page load | Sub-100ms hard deadline; every millisecond of DSP processing reduces win rate |
| **Targeting** | Basic demographic and contextual | Real-time feature lookup combining user signals, contextual data, campaign rules, and ML predictions |
| **Budget Management** | Daily cap with hard cutoff | Continuous budget pacing via PID controllers with spend velocity matching and dayparting |
| **Fraud Prevention** | Basic IP blocklists | Multi-layer IVT detection: pre-bid filtering, real-time behavioral analysis, post-bid forensics |
| **Scale** | Thousands of requests/sec | Millions of requests/sec with geo-distributed edge bidding and feature caching |
| **Privacy** | Cookie-based tracking | Privacy-preserving signals (Topics API, contextual enrichment), consent management, data clean rooms |
| **Revenue Tracking** | Simple impression counts | Multi-party reconciliation across SSP/DSP/advertiser with discrepancy detection and resolution |

---

## Complexity Rating

| Dimension | Rating | Notes |
|---|---|---|
| **Latency Sensitivity** | ★★★★★ | Hardest real-time constraint in system design—100ms total budget with network overhead |
| **Scale (QPS)** | ★★★★★ | 10M+ QPS peak; among the highest throughput systems outside of CDN/DNS |
| **Data Model Complexity** | ★★★★☆ | OpenRTB protocol, campaign hierarchies, targeting rules, creative variants |
| **Algorithmic Depth** | ★★★★★ | ML bid optimization, PID budget pacing, auction theory, fraud detection models |
| **Consistency Challenges** | ★★★★☆ | Budget atomicity across distributed bidders, frequency cap accuracy, billing reconciliation |
| **Operational Complexity** | ★★★★☆ | Multi-party ecosystem (SSPs, DSPs, exchanges), supply chain verification, regulatory compliance |
| **Interview Frequency** | ★★★★☆ | Common at ad-tech companies; tests real-time systems, distributed systems, and ML integration |

---

## Key Terminology

| Term | Definition |
|---|---|
| **SSP** | Supply-Side Platform — technology used by publishers to manage and sell their ad inventory |
| **DSP** | Demand-Side Platform — technology used by advertisers to buy ad impressions programmatically |
| **Ad Exchange** | Marketplace where SSPs and DSPs transact; conducts the auction |
| **OpenRTB** | IAB standard protocol for real-time bidding communication between exchanges and bidders |
| **Bid Request** | JSON/protobuf message describing an available impression, sent from exchange to DSPs |
| **Bid Response** | DSP's reply containing bid price, creative markup, and targeting metadata |
| **Impression (Imp)** | A single opportunity to display an ad to a user |
| **CPM** | Cost Per Mille — price per 1,000 impressions; standard pricing unit |
| **Floor Price** | Minimum bid the SSP will accept for an impression |
| **Bid Shading** | Algorithm that reduces first-price bids toward estimated second-price to avoid overpayment |
| **Win Notice** | HTTP callback from exchange to winning DSP confirming auction win and final price |
| **IVT** | Invalid Traffic — non-human impressions (bots, crawlers, fraud) |
| **GIVT/SIVT** | General IVT (easily detected) vs Sophisticated IVT (requires advanced analysis) |
| **Frequency Capping** | Limiting how many times a user sees the same ad within a time window |
| **Budget Pacing** | Algorithm distributing campaign budget evenly across the flight period |
| **ads.txt** | Publisher file declaring authorized sellers of their inventory |
| **sellers.json** | Exchange file listing authorized sellers on their platform |
| **DCO** | Dynamic Creative Optimization — assembling personalized ad creatives from component assets in real-time |
| **Topics API** | Privacy-preserving interest-based targeting API that provides coarse-grained interest categories without cross-site tracking |
| **Protected Audience** | Browser-based auction API for remarketing use cases that keeps user data on-device |
| **Data Clean Room** | Privacy-preserving environment where multiple parties can jointly analyze data without exposing raw records |
| **CTV** | Connected TV — internet-connected television devices (smart TVs, streaming boxes) with programmatic ad inventory |
| **VAST** | Video Ad Serving Template — IAB standard XML for serving video ads across players |
| **Header Bidding** | Technique where publishers simultaneously offer inventory to multiple exchanges before calling their primary ad server |
| **SupplyChain (schain)** | OpenRTB object creating an auditable chain of custody from publisher through all intermediaries to the final exchange |
| **Win Rate** | Fraction of submitted bids that win the auction; key signal for bid shading calibration |
| **Bid Rate** | Fraction of received bid requests on which the DSP submits a bid; controlled by targeting rules and budget pacing |
| **PID Controller** | Proportional-Integral-Derivative feedback controller used for budget pacing to distribute spend evenly over time |
| **SSAI** | Server-Side Ad Insertion — ad stitching technique for CTV/video where ads are inserted into the content stream server-side |
| **Attribution Window** | Time period after ad exposure during which conversions are credited to the ad (e.g., 30-day click-through, 1-day view-through) |
| **Seat** | Buyer account within a DSP; corresponds to an advertiser or agency with billing relationship |

---

## Related Patterns

| Pattern | Relevance to RTB |
|---|---|
| **Circuit Breaker** | Protects bidder nodes from cascading failures when external services (feature store, ML inference, budget pacer) degrade; triggers graceful fallback to simpler bidding logic |
| **Bulkhead** | Isolates high-value deal traffic from open exchange traffic to prevent low-priority request surges from starving premium campaign delivery |
| **Competing Consumers** | Bid request processing across the bidder fleet follows the competing consumers pattern—each node independently processes requests from the exchange with no coordination required |
| **CQRS** | Write path (impression events, budget transactions) and read path (dashboards, reports, campaign analytics) are fundamentally separated with different latency, consistency, and scaling characteristics |
| **Event Sourcing** | Impression, click, and conversion events form an append-only log that serves as the system's source of truth for billing, ML training, and reconciliation |
| **Materialized View** | Real-time dashboards, campaign performance summaries, and publisher reports are pre-computed materialized views over the event stream, not live queries |
| **Sidecar / Ambassador** | Feature store cache warming, model loading, and ads.txt cache refresh run as sidecar processes alongside bidder nodes to avoid polluting the hot bid path |
| **Saga** | Multi-step campaign lifecycle (create → review creative → activate → pace budget → reconcile billing → close) follows the saga pattern with compensating actions for each step |
| **Write-Ahead Log** | Impression pixel server uses WAL to ensure no tracking events are lost during ingestion spikes or downstream failures |
| **Throttle / Rate Limiter** | Exchange-side per-DSP QPS limits prevent slow DSPs from consuming disproportionate auction resources; DSP-side bid rate control prevents budget waste on low-value traffic |

---

## Related Designs

| System | Relationship |
|---|---|
| [12.15 Customer Data Platform](../12.15-customer-data-platform/00-index.md) | CDP identity graphs and audience segments feed the RTB feature store; cookie sync and data clean room integration |
| [12.14 A/B Testing Platform](../12.14-ab-testing-platform/00-index.md) | Creative A/B testing and bid strategy experimentation share the same deterministic hashing and traffic splitting infrastructure |
| [12.13 Bot Detection System](../12.13-bot-detection-system/00-index.md) | Pre-bid IVT filtering directly depends on bot detection signals; shared IP reputation and behavioral analysis infrastructure |
| [12.16 Product Analytics Platform](../12.16-product-analytics-platform/00-index.md) | Post-click conversion attribution and funnel analysis depend on the same event streaming and identity stitching patterns |
| [12.5 URL Shortener](../12.5-url-shortener/00-index.md) | Click tracking redirect chain shares architectural similarity with URL shortener redirect; both require sub-10ms global latency |
| [9.10 Business Intelligence Platform](../9.10-business-intelligence-platform/00-index.md) | Campaign reporting dashboards share BI platform patterns: semantic layer, query caching, materialized aggregations |
| [1.1 Distributed Rate Limiter](../1.1-distributed-rate-limiter/00-index.md) | Budget pacing and QPS throttling use distributed rate limiting patterns; sliding window counters for frequency capping |
| [12.8 WebRTC Infrastructure](../12.8-webrtc-infrastructure/00-index.md) | CTV and in-stream video ad delivery shares real-time media delivery patterns and edge infrastructure concerns |
| [12.18 Marketplace Platform](../12.18-marketplace-platform/00-index.md) | Ad marketplace shares core marketplace patterns: auction mechanics, trust scoring, fraud prevention, and multi-party reconciliation |

---

## Industry Evolution Context

| Era | Characteristic | Architectural Impact |
|---|---|---|
| **Pre-2015** | Waterfall ad serving; direct deals dominant | Simple priority queues; minimal real-time requirements |
| **2015-2018** | Header bidding; second-price auctions | Parallel auction architecture; truthful bidding — no shading needed |
| **2019-2021** | First-price auction transition; ads.txt adoption | Bid shading subsystems; supply chain verification caches |
| **2022-2024** | Privacy sandbox rollout; Topics API; CTV growth | Dual-pipeline architecture; contextual ML models; video/CTV extensions |
| **2025+** | Cookieless default; AI-generated creatives; on-device auctions | Browser-side auction logic; server-side creative assembly; agentic campaign optimization |
