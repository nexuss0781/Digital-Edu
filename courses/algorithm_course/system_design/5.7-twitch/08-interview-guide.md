# Interview Guide

## 1. Interview Pacing (45-Minute Format)

| Time | Phase | Focus | Key Actions |
|------|-------|-------|-------------|
| 0-5 min | **Clarify** | Scope the problem | Ask: "Are we designing the live video pipeline, chat, or the full platform?" Confirm scale (millions of concurrent viewers). Clarify: "Should I focus on the streamer-to-viewer latency or the monetization system?" |
| 5-15 min | **High-Level Design** | Core components, data flow | Draw: Ingest (PoP) → Transcoding (Origin) → CDN (Replication Tree) → Player. Add Chat (Edge + PubSub). Mention key decisions: RTMP ingest, HLS delivery, custom transcoder. |
| 15-30 min | **Deep Dive** | 1-2 critical components | Pick based on interviewer interest: (a) Ingest routing (Intelligest), (b) Real-time transcoding pipeline, or (c) Chat fanout system. Go deep on failure modes and scaling. |
| 30-40 min | **Scale & Trade-offs** | Bottlenecks, failure scenarios | Discuss: transcoding compute at peak, chat fanout for mega-channels, CDN propagation latency. Compare Enhanced Broadcasting vs server-side transcoding. |
| 40-45 min | **Wrap Up** | Summary, handle follow-ups | Summarize key decisions. Address any remaining questions. Mention: observability, security, and multi-region considerations. |

---

## 2. Meta-Commentary

### What Makes This System Unique/Challenging

1. **Real-time constraint is non-negotiable** — Unlike YouTube (upload → process → serve), Twitch must transcode faster than real-time. Any processing delay directly impacts viewer experience. This is the fundamental tension: compute-intensive work (transcoding) with a hard real-time deadline.

2. **Three coupled systems at massive scale** — Video (100K+ concurrent streams), Chat (hundreds of billions of messages/day), and Commerce (40+ microservices). Each is independently complex; they're also tightly coupled (a Bits cheer triggers chat animation + payment + streamer notification simultaneously).

3. **Power-law traffic distribution** — The top 100 channels have 500K+ viewers while the bottom 90% have < 10. Your system must handle both extremes efficiently. Mega-channels stress chat fanout and CDN caching; many small channels stress transcoding allocation.

4. **Client heterogeneity** — Streamers send wildly different inputs (720p30 webcam to 4K60 with AV1). Viewers consume on everything from 4K monitors to mobile on 3G. The system must handle this variance gracefully.

### Where to Spend Most Time

| Priority | Component | Why |
|----------|-----------|-----|
| **1st** | Video Ingest + Transcoding | This is what makes it "Twitch" — the real-time video pipeline is the core differentiator |
| **2nd** | Chat Architecture | Demonstrates understanding of pub/sub, fanout, real-time messaging at scale |
| **3rd** | CDN / Replication Tree | Shows knowledge of content delivery, caching, edge computing |
| **4th** | Commerce / Subscriptions | Only if time permits or interviewer asks — standard payment processing patterns |

### How to Approach This Problem

```
Start broad, go deep on video:

1. "This is a live streaming platform with three main subsystems:
    live video delivery, real-time chat, and creator monetization."

2. "The most critical challenge is the video pipeline because
    it's compute-intensive (transcoding) with a real-time deadline
    (must be faster than the video frame rate)."

3. "Let me walk through the data flow from streamer to viewer..."
    → RTMP ingest → routing → transcoding → CDN → player

4. "For chat, the key insight is hierarchical fanout..."
    → Edge nodes (per-viewer) ← PubSub (per-edge) ← sender

5. "For commerce, it's standard distributed payments..."
    → Idempotent purchases, eventual consistency for entitlements
```

---

## 3. Trade-offs Discussion

### Trade-off #1: Server-Side vs Client-Side Transcoding

| Dimension | Server-Side Transcoding | Enhanced Broadcasting (Client-Side) |
|-----------|------------------------|--------------------------------------|
| **Pros** | Universal — works for all streamers regardless of hardware; consistent quality; Twitch controls the pipeline | 10x compute reduction; lower glass-to-glass latency; supports new codecs (AV1) from client; dual-format streaming |
| **Cons** | Enormous compute cost (500K+ vCPUs); transcoding adds 1-2s latency; scaling is capital-intensive | Requires powerful GPU (NVIDIA NVENC); increases streamer's upload bandwidth 3x; not all streamers can use it |
| **Recommendation** | **Hybrid approach** — Use Enhanced Broadcasting where available; fall back to server-side for streamers without capable hardware. This mirrors Twitch's actual strategy. |

### Trade-off #2: Exact vs Approximate Viewer Counts

| Dimension | Exact Counts (Strongly Consistent) | Approximate Counts (Eventually Consistent) |
|-----------|-------------------------------------|---------------------------------------------|
| **Pros** | Accurate for business decisions; viewers see real numbers | Much simpler; no global coordination; 15-second staleness is invisible |
| **Cons** | Requires global consensus on every connect/disconnect; expensive at 2.5M concurrent viewers; single Slowest part of the process | Off by ±5%; could be gamed more easily |
| **Recommendation** | **Approximate for display, exact for analytics.** Live viewer counts are updated every 15 seconds with local aggregation. Post-hoc analytics compute exact numbers from event logs. |

### Trade-off #3: Chat — Deliver Every Message vs Message Sampling

| Dimension | Deliver Every Message | Message Sampling (Ultra-Popular Channels) |
|-----------|----------------------|-------------------------------------------|
| **Pros** | Complete experience; no messages lost; fair to all users | Manageable fanout even at 500K+ viewers; reduces bandwidth; maintains chat readability |
| **Cons** | At 500K viewers × 100 msg/s = 50M deliveries/s for ONE channel; unreadable anyway (chat scrolls too fast) | Some messages invisible to some viewers; complexity in sampling logic; potential fairness issues |
| **Recommendation** | **Tiered delivery.** Subscriber/moderator/highlighted messages always delivered. Regular messages sampled based on channel size. At >100K viewers, chat is already unreadable — sampling doesn't degrade perceived experience. |

### Trade-off #4: HLS vs WebRTC for Video Delivery

| Dimension | HLS (HTTP Live Streaming) | WebRTC (Real-Time Communication) |
|-----------|---------------------------|----------------------------------|
| **Pros** | CDN-cacheable (massive scale); adaptive bitrate; universal browser support; fault-tolerant | Sub-500ms latency; bidirectional; true real-time |
| **Cons** | 2-4 second latency (even with LL-HLS); segment-based introduces inherent delay | Not CDN-cacheable; P2P doesn't scale to 100K+ viewers; higher server cost; browser inconsistencies |
| **Recommendation** | **HLS for broadcast, WebRTC for ingest.** This is Twitch's approach — WebRTC for streamer→PoP (low latency ingest), HLS for PoP→viewer (scalable delivery). Low-Latency HLS reduced latency from 6s to ~2s, which is "good enough" for chat interaction. |

### Trade-off #5: Monolithic vs Per-Channel Chat Rooms

| Dimension | Shared Chat Cluster | Per-Channel Chat Rooms (Isolated) |
|-----------|--------------------|------------------------------------|
| **Pros** | Resource efficient; viewers watching multiple channels share connections | Fault isolation; mega-channel issues don't affect small channels; easier to scale independently |
| **Cons** | Noisy neighbor problem; one mega-channel can degrade service for others | Resource overhead; more complex routing; connection management harder |
| **Recommendation** | **Tiered isolation.** Partner channels with >50K average viewers get dedicated Chat Edge capacity (bulkhead pattern). Smaller channels share pooled capacity. This prevents "noisy neighbor" while keeping resource efficiency for the long tail. |

---

## 4. Trap Questions & How to Handle

| # | Trap Question | What Interviewer Wants | Best Answer |
|---|---------------|------------------------|-------------|
| 1 | "Why not just use WebRTC for everything?" | Understand trade-off between latency and scalability | "WebRTC gives sub-500ms latency, but it's not CDN-cacheable. For 1-to-many broadcasting with millions of viewers, HLS over a Replication Tree is the only way to scale. Twitch uses WebRTC for the ingest side (streamer→server) where latency matters most, and HLS for delivery where scale matters most." |
| 2 | "Can't you just use FFmpeg for transcoding?" | Understand custom vs off-the-shelf trade-offs | "FFmpeg works for small scale, but it has critical limitations at Twitch's scale: IDR frame misalignment across variants breaks ABR switching (Chromecast issue), no shared decoder means 5x redundant decoding, and no custom metadata injection for Twitch-specific player features. The custom transcoder solves all three while also enabling ASIC offloading." |
| 3 | "What if a streamer with 1M viewers goes live suddenly?" | Test surge handling | "The Replication Tree handles this through demand-based replication — edges only cache segments when viewers request them. On initial surge, there's a brief cache-miss storm that hits origin, but within 2-3 segments (~4-6 seconds) the edge caches warm up and absorb 90%+ of requests. We also stagger go-live notifications to avoid a thundering herd." |
| 4 | "How do you ensure chat messages are in order?" | Test consistency model understanding | "We don't guarantee strict ordering — and that's by design. Chat is eventually consistent. Messages may arrive slightly out of order across different Edge nodes due to PubSub propagation delays. This is acceptable because: (1) at high volume, users can't perceive 100ms ordering differences, (2) strict ordering would require consensus (Paxos/Raft) which is too expensive at 200K msg/s, and (3) the IRC protocol itself doesn't guarantee ordering." |
| 5 | "What happens if a transcoding origin goes down mid-stream?" | Test failure recovery thinking | "IRS detects the capacity loss via Capacitor within 5 seconds. For in-flight streams: the PoP re-routes to an alternate origin using IRS. The new origin starts transcoding from the current point — there's a 3-5 second gap where viewers see a brief freeze (their player buffers cover part of this). The stream key session is maintained at the PoP level, so the streamer doesn't need to reconnect." |
| 6 | "Why not use a message broker like Kafka for chat instead of custom PubSub?" | Understand domain-specific design | "Kafka is designed for durable, ordered event streams with at-least-once delivery. Chat messages are ephemeral — we don't need durability or ordering guarantees for real-time delivery. A lightweight custom PubSub optimized for fan-out gives us sub-100ms internal distribution. Chat messages are separately logged to Kafka for analytics, but the real-time delivery path skips it." |
| 7 | "How do you prevent viewbotting?" | Test fraud detection thinking | "Multi-layered: (1) Behavioral analysis — bots don't interact with chat or change video quality, (2) Device fingerprinting — detect duplicate browser fingerprints, (3) IP analysis — flag suspicious patterns like 1000 viewers from one IP/subnet, (4) Engagement signals — real viewers cause measurable CDN load, chat activity, and session duration variance that bots don't replicate." |

---

## 5. Common Mistakes to Avoid

| # | Mistake | Why It's Wrong | Better Approach |
|---|---------|---------------|-----------------|
| 1 | Treating Twitch like YouTube | YouTube is upload→process→serve (offline). Twitch is real-time — fundamentally different architecture | Start by emphasizing the real-time constraint: transcoding must be faster than the video frame rate |
| 2 | Using a single CDN for delivery | Single CDN can't handle Twitch's scale or provide sub-2s latency | Describe the Replication Tree — a custom multi-tier CDN hierarchy with demand-based replication |
| 3 | Ignoring chat as a secondary feature | Chat IS the product — it's what makes Twitch different from watching a YouTube video | Give chat architecture equal weight; discuss the Edge + PubSub hierarchical fanout pattern |
| 4 | Using WebRTC for viewer delivery | WebRTC doesn't scale to millions of viewers | Explain why HLS with edge caching is the right choice for 1-to-many broadcast |
| 5 | Designing for exact viewer counts | Exact counts require global consensus — too expensive | Use approximate counting with periodic reconciliation |
| 6 | Ignoring the power-law distribution | Most channels have <10 viewers; a few have 500K+ | Design for both extremes: efficient resource allocation for small channels + dedicated capacity for mega-channels |
| 7 | Not discussing Enhanced Broadcasting | Modern Twitch interview expects knowledge of client-side transcoding | Mention ERTMP and how it offloads transcoding to the streamer's GPU |

---

## 6. Questions to Ask the Interviewer

| # | Question | Why It Matters |
|---|----------|---------------|
| 1 | "What's the expected peak concurrent viewership? Are we designing for 1M or 10M?" | Determines CDN and transcoding scale |
| 2 | "Should I focus on the video pipeline, chat system, or full platform?" | Scopes the deep dive |
| 3 | "What's the acceptable glass-to-glass latency? Sub-second or 2-4 seconds?" | Determines HLS vs WebRTC vs LL-HLS |
| 4 | "Do we need to support VOD/clips, or just live streaming?" | Scopes storage and processing requirements |
| 5 | "Is monetization (subscriptions, bits) in scope?" | Determines if commerce system needs design |
| 6 | "What consistency guarantees do we need for viewer counts?" | Drives the consistency model discussion |
| 7 | "Are we supporting mobile, web, and TV, or just one platform?" | Affects CDN and adaptive bitrate strategy |

---

## 7. Quick Reference Card

```
┌──────────────────────────────────────────────────────┐
│             TWITCH SYSTEM DESIGN CHEAT SHEET          │
├──────────────────────────────────────────────────────┤
│                                                      │
│  SCALE: 2.5M concurrent viewers, 100K live streams   │
│  LATENCY: ~2s glass-to-glass (Low-Latency HLS)      │
│  CHAT: Hundreds of billions messages/day             │
│                                                      │
│  INGEST: RTMP/ERTMP → ~100 PoPs → Intelligest       │
│    - IRS: Randomized greedy routing algorithm         │
│    - Capacitor (compute) + Well (network) monitoring │
│                                                      │
│  TRANSCODE: Custom transcoder (NOT FFmpeg)           │
│    - Shared decoder, IDR alignment, metadata inject  │
│    - Enhanced Broadcasting: client-side (10x savings)│
│    - ASIC-based: 10x density vs CPU                  │
│                                                      │
│  DELIVERY: Replication Tree (directed graph CDN)     │
│    - Origin → Mid-Tier → Edge (demand-based)         │
│    - HLS segments (~2s each)                         │
│    - ABR: 5 quality variants (160p → 1080p60)        │
│                                                      │
│  CHAT: Go-based Edge + PubSub (hierarchical fanout)  │
│    - Edge: IRC/WebSocket, ~50K conns/node            │
│    - PubSub: internal distribution to Edge nodes     │
│    - Clue: moderation (bans, AutoMod, spam filter)   │
│                                                      │
│  DATABASE: PostgreSQL (94%), Redis, OpenSearch        │
│    - 125+ DB hosts, 300K+ TPS on largest cluster     │
│                                                      │
│  KEY TRADE-OFFS:                                     │
│    - HLS vs WebRTC → HLS for scale, WebRTC for       │
│      ingest                                          │
│    - Server vs Client transcode → Hybrid (Enhanced   │
│      Broadcasting where hardware allows)              │
│    - Exact vs Approximate viewer counts → Approx     │
│      for display, exact for analytics                 │
│                                                      │
│  NUMBERS TO REMEMBER:                                │
│    - 3M events/sec → data lake (Spade)               │
│    - 100+ PB stored (Tahoe platform)                 │
│    - 40+ commerce microservices                      │
│    - 2,000+ cloud accounts                           │
│    - 25K+ 3rd-party API apps                         │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## 8. Difficulty Variants

### Simplified Version (30 min / Junior)

Focus only on:
1. Live video flow: RTMP → Transcode → HLS → CDN → Viewer
2. Basic chat: WebSocket connections with simple pub/sub
3. Skip: Enhanced Broadcasting, Intelligest routing, commerce system

### Full Version (45 min / Senior)

As described in this document — cover video pipeline, chat architecture, and scaling trade-offs.

### Extended Version (60 min / Staff+)

Add:
1. **Enhanced Broadcasting protocol design** — How ERTMP extends RTMP for multi-track
2. **ASIC vs GPU vs CPU transcoding** — Cost/quality/latency trade-offs at different scales
3. **Cross-region consistency** — How chat state is synchronized across regions
4. **ML-based content moderation** — AutoMod architecture, false positive handling
5. **Creator economy design** — Subscription lifecycle, Bits ledger, ad insertion system

---

## 9. System Comparison Matrix

| Dimension | Twitch | YouTube Live | Kick | Facebook Live |
|-----------|--------|-------------|------|---------------|
| **Primary use** | Gaming/esports live streaming | General-purpose live + VOD | Gaming live streaming | Social live streaming |
| **Glass-to-glass latency** | ~2-4s (LL-HLS) | ~3-6s (LL-HLS/LL-DASH) | ~2-4s | ~5-10s |
| **Transcoding** | Custom transcoder + ERTMP | Cloud-based (massive scale) | Third-party | Server-side |
| **Chat protocol** | IRC over WebSocket | Proprietary WebSocket | WebSocket | Proprietary |
| **Chat scale** | 500K+ per channel | Millions per stream | 100K+ per channel | Millions per stream |
| **Monetization** | Subscriptions, Bits, ads | Super Chat, memberships, ads | Subscriptions, tips | Stars, subscriptions |
| **CDN** | Custom Replication Tree | Google's global CDN | Third-party CDN | Facebook's CDN |
| **Unique strength** | Low latency + interactive chat | Massive scale + VOD integration | Low fees for creators | Social graph integration |

---

## 10. Architecture Decision Records (ADR Summary)

| # | Decision | Choice | Alternatives Considered | Rationale |
|---|----------|--------|------------------------|-----------|
| 1 | **Transcoding engine** | Custom C/C++ transcoder | FFmpeg, cloud transcoding services | IDR alignment, shared decoder, metadata injection — impossible with FFmpeg architecture |
| 2 | **Chat backend language** | Go | Java, Rust, Node.js | Goroutines enable 50K connections/node; simple deployment; good concurrency primitives |
| 3 | **Chat protocol** | IRC over WebSocket | Custom binary protocol, gRPC-Web | IRC backward compatibility with 25K+ third-party apps; well-understood protocol |
| 4 | **Video delivery** | Custom Replication Tree (HLS) | Standard CDN, WebRTC, MPEG-DASH | Demand-based replication + push-based propagation; HLS for broad device support |
| 5 | **Ingest routing** | Intelligest (custom) | HAProxy, DNS-based routing | Randomized greedy with real-time capacity monitoring; HAProxy couldn't balance across origins |
| 6 | **Primary database** | PostgreSQL | MySQL, CockroachDB, DynamoDB | 300K+ TPS proven; deep operational expertise; well-understood scaling path |
| 7 | **Monolith strategy** | Strangler fig migration to Go | Big-bang rewrite, keep monolith | Gradual risk reduction; commerce extracted first for revenue protection |
| 8 | **Client-side encoding** | ERTMP (Enhanced Broadcasting) | Server-only transcoding, SRT | 90% compute reduction for capable streamers; NVENC widely available |

---

## 11. Whiteboard Drawing Guide

### Phase 1: Core Video Pipeline (5-7 min)

```
Draw this first — the video path is the skeleton:

  Streamer                    Origin DC                         Viewer
  ┌──────┐    RTMP     ┌──────────────────┐    HLS      ┌──────┐
  │ OBS  ├────────────►│ PoP → Transcoder ├───────────►│Player│
  └──────┘             │      ↓           │             └──────┘
                       │  5 quality       │
                       │  variants        │
                       │      ↓           │
                       │  Replication     │
                       │  Tree (CDN)      │
                       └──────────────────┘

Key labels:
  - "RTMP in, HLS out" (protocol transformation)
  - "2s segments" on HLS output
  - "~100 PoPs" on ingest
  - "Custom transcoder (not FFmpeg)" — shows depth
```

### Phase 2: Chat System (3-5 min)

```
Add chat alongside video:

  Viewer                      Chat Layer
  ┌──────┐   WebSocket   ┌──────────────────────┐
  │Player ├──────────────►│ Edge Node (Go)       │
  │+ Chat │               │   ↓                  │
  └──────┘               │ Moderation (Clue)    │
                          │   ↓                  │
                          │ PubSub → Other Edges │
                          └──────────────────────┘

Key labels:
  - "IRC protocol" on WebSocket
  - "50K conn/node" on Edge
  - "Hierarchical fanout" — PubSub to Edges, Edges to viewers
```

### Phase 3: Scale & Hot Spots (5-8 min)

```
Add scaling annotations:

  100K concurrent streams
  2.5M concurrent viewers
  Power-law: top 0.5% streams use 40% resources

  Key scaling decisions:
  ┌─────────────────────────────────────────┐
  │ Mega-streamer goes live (500K followers) │
  │                                          │
  │ 1. IRS routes to origin with capacity    │
  │ 2. Transcoder: 5 variants × N Mbps      │
  │ 3. Replication Tree pushes to edges      │
  │ 4. Chat: 8+ Edge nodes, PubSub cluster   │
  │ 5. Slow mode + subscriber priority       │
  │ 6. Viewer count: approximate (±5%)       │
  └─────────────────────────────────────────┘
```

---

## 12. Follow-Up Deep Dive Questions

### Thread 1: "How would you handle a 10M viewer esports final?"

| Challenge | Solution |
|-----------|----------|
| **Ingest** | Dedicated origin DC for the event; redundant ingest paths from venue |
| **Transcoding** | Pre-reserved compute; ASIC-based encoding; enhanced quality ladder (1080p60 + 4K) |
| **CDN** | Pre-warm all global edges; push-based segment delivery; origin-level request coalescing |
| **Chat** | Subscriber-only mode default; message sampling at 1/10 for non-subs; dedicated PubSub partition |
| **Commerce** | Pre-scale payment systems; Bits balance pre-loaded; subscription surge handling |
| **Monitoring** | Dedicated war room; 1-minute alert thresholds; pre-authorized scaling decisions |

### Thread 2: "How does Enhanced Broadcasting (ERTMP) actually work?"

1. **Streamer's GPU** encodes 3 variants simultaneously using NVENC (hardware encoder)
2. **OBS/streaming software** multiplexes variants into single ERTMP connection
3. **ERTMP** extends RTMP with multi-track support (backward-compatible)
4. **Origin** receives pre-encoded variants; only needs to package into HLS segments
5. **Fallback**: If streamer's GPU can't handle multi-encode, origin falls back to server-side transcoding
6. **Result**: 90% reduction in server compute for participating streamers

### Thread 3: "What's the hardest part of chat at this scale?"

The hardest part is the **intersection of moderation and latency**:
- Every message must be moderated before delivery (legal requirement in many jurisdictions)
- Moderation adds 10-50ms latency on the critical path
- At 5K messages/s in a mega-channel, even 10ms per message means the moderation pipeline must process 50 concurrent evaluations
- False positives (blocking legitimate messages) create user frustration
- False negatives (allowing harmful content) create legal and brand risk
- The circuit breaker pattern (allow through if moderation is slow, moderate retroactively) is the pragmatic solution, but it means harmful content may briefly appear
