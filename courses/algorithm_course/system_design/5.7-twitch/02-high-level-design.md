# High-Level Design

## 1. System Architecture Diagram

```mermaid
%%{init: {'theme': 'neutral', 'look': 'neo'}}%%
flowchart TB
    subgraph Streamers["Streamer Layer"]
        S1["Streaming Software<br/>(OBS / Twitch Studio)"]
        S2["Enhanced Broadcasting<br/>(ERTMP Multi-Encode)"]
    end

    subgraph IngestLayer["Ingest Layer (~100 Global PoPs)"]
        MP["Intelligest<br/>Media Proxy"]
        IRS["Intelligest Routing<br/>Service (IRS)"]
        CAP["Capacitor<br/>(Compute Monitor)"]
        WELL["The Well<br/>(Network Monitor)"]
    end

    subgraph ProcessingLayer["Processing Layer (Origin Data Centers)"]
        TC["Custom Transcoder<br/>(RTMP → HLS)"]
        SEG["Segment Packager<br/>(HLS Segments + Manifest)"]
        CLIP["Clip Generator"]
        VOD["VOD Archiver"]
    end

    subgraph DistributionLayer["Distribution Layer (Replication Tree)"]
        MID["Mid-Tier Cache<br/>Nodes"]
        EDGE["Edge Cache<br/>Nodes"]
    end

    subgraph ChatLayer["Chat Infrastructure"]
        CE["Chat Edge<br/>(IRC / WebSocket)"]
        PS["PubSub Service<br/>(Internal Fanout)"]
        CLUE["Clue Service<br/>(Moderation / Rules)"]
        ROOM["Room Service<br/>(Channel State)"]
    end

    subgraph AppLayer["Application Services"]
        API["API Gateway<br/>(Helix API)"]
        AUTH["Auth Service<br/>(OAuth 2.0)"]
        DISC["Discovery Service<br/>(Browse / Search)"]
        REC["Recommendation<br/>Engine"]
        NOTIFY["Notification<br/>Service"]
    end

    subgraph CommerceLayer["Commerce Layer (40+ Microservices)"]
        SUB["Subscription<br/>Service"]
        BITS["Bits / Cheering<br/>Engine"]
        ADS["Ad Insertion<br/>Service"]
        PAY["Payment<br/>Orchestration"]
    end

    subgraph DataLayer["Data & Storage Layer"]
        PG[("PostgreSQL<br/>(Primary OLTP)")]
        REDIS[("Redis<br/>(Session / Cache)")]
        OS[("OpenSearch<br/>(Full-Text Search)")]
        S3[("Object Storage<br/>(VOD / Clips)")]
        KAFKA["Event Bus<br/>(Streaming Events)"]
        DL[("Data Lake<br/>(100+ PB)")]
    end

    subgraph ViewerLayer["Viewer Layer"]
        WEB["Web Player<br/>(React / TypeScript)"]
        MOB["Mobile App<br/>(iOS Swift / Android Kotlin)"]
        TV["Living Room<br/>(Smart TV / Console)"]
    end

    S1 -->|"RTMP"| MP
    S2 -->|"ERTMP<br/>(Multi-Track)"| MP
    MP -->|"Route Query"| IRS
    IRS --> CAP
    IRS --> WELL
    MP -->|"Canonical Protocol"| TC
    TC --> SEG
    TC --> VOD
    SEG --> MID
    MID --> EDGE
    SEG --> CLIP

    EDGE -->|"HLS Adaptive<br/>Bitrate"| WEB
    EDGE --> MOB
    EDGE --> TV

    WEB <-->|"WebSocket"| CE
    MOB <-->|"WebSocket"| CE
    CE <--> PS
    CE --> CLUE
    CLUE --> ROOM

    WEB --> API
    API --> AUTH
    API --> DISC
    API --> SUB
    API --> BITS
    DISC --> REC
    DISC --> OS

    SUB --> PAY
    BITS --> PAY
    ADS --> EDGE

    TC --> KAFKA
    PS --> KAFKA
    PAY --> KAFKA
    KAFKA --> DL

    SUB --> PG
    BITS --> PG
    ROOM --> REDIS
    DISC --> PG
    VOD --> S3
    CLIP --> S3

    NOTIFY --> MOB
    NOTIFY --> WEB

    classDef streamer fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef ingest fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef process fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef dist fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef chat fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef app fill:#e0f7fa,stroke:#00695c,stroke-width:2px
    classDef commerce fill:#fce4ec,stroke:#c62828,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef viewer fill:#e1f5fe,stroke:#01579b,stroke-width:2px

    class S1,S2 streamer
    class MP,IRS,CAP,WELL ingest
    class TC,SEG,CLIP,VOD process
    class MID,EDGE dist
    class CE,PS,CLUE,ROOM chat
    class API,AUTH,DISC,REC,NOTIFY app
    class SUB,BITS,ADS,PAY commerce
    class PG,REDIS,OS,S3,KAFKA,DL data
    class WEB,MOB,TV viewer
```

---

## 2. Data Flow

### 2.1 Live Video — Write Path (Streamer → Viewer)

```mermaid
%%{init: {'theme': 'neutral', 'look': 'neo'}}%%
sequenceDiagram
    participant Streamer as Streamer (OBS)
    participant PoP as PoP (Intelligest Proxy)
    participant IRS as Intelligest Routing Service
    participant Origin as Origin (Transcoder)
    participant RepTree as Replication Tree
    participant Edge as Edge Cache
    participant Viewer as Viewer Player

    Streamer->>PoP: 1. RTMP Connect (stream key auth)
    PoP->>IRS: 2. Route query (stream properties, codec, bitrate)
    IRS-->>PoP: 3. Assigned origin DC (randomized greedy)
    PoP->>Origin: 4. Forward stream (canonical protocol)

    loop Every 2 seconds
        Origin->>Origin: 5. Transcode → 5 HLS variants
        Origin->>RepTree: 6. Push HLS segments + manifest
        RepTree->>Edge: 7. Replicate based on demand
    end

    Viewer->>Edge: 8. Request HLS manifest
    Edge-->>Viewer: 9. Return manifest (quality options)
    loop Continuous playback
        Viewer->>Edge: 10. Fetch next segment
        Edge-->>Viewer: 11. Return segment (cache hit)
        Note over Edge,Viewer: ABR: Player switches quality<br/>based on bandwidth
    end
```

### 2.2 Chat — Message Flow

```mermaid
%%{init: {'theme': 'neutral', 'look': 'neo'}}%%
sequenceDiagram
    participant Sender as Viewer (Sender)
    participant ChatEdge as Chat Edge Node
    participant Clue as Clue (Moderation)
    participant PubSub as PubSub Cluster
    participant OtherEdge as Other Chat Edge Nodes
    participant Recipients as Viewers (Recipients)

    Sender->>ChatEdge: 1. IRC PRIVMSG (WebSocket)
    ChatEdge->>Clue: 2. Evaluate message rules
    Note over Clue: Check: banned? subscriber?<br/>spam? AutoMod filter?
    Clue-->>ChatEdge: 3. Allow / Deny / Hold

    alt Message Allowed
        ChatEdge->>PubSub: 4. Publish to channel topic
        PubSub->>OtherEdge: 5. Fan out to all Edge nodes<br/>with subscribers for this channel
        OtherEdge->>Recipients: 6. Deliver to connected viewers
        ChatEdge->>Sender: 7. Echo back (confirmation)
    else Message Denied
        ChatEdge->>Sender: 7b. Error / silent drop
    end
```

### 2.3 Enhanced Broadcasting — Multi-Encode Path

```mermaid
%%{init: {'theme': 'neutral', 'look': 'neo'}}%%
sequenceDiagram
    participant Streamer as Streamer (NVIDIA GPU)
    participant OBS as OBS Studio
    participant PoP as PoP (Intelligest)
    participant Origin as Origin DC

    Note over Streamer,OBS: NVENC encodes 3 variants<br/>simultaneously on GPU
    OBS->>OBS: Encode: 1080p60, 720p30, 480p30
    OBS->>PoP: ERTMP stream (3 video tracks in 1 connection)
    PoP->>Origin: Forward multi-track stream
    Note over Origin: Bypass transcoding!<br/>Only segment packaging needed
    Origin->>Origin: Package HLS segments per track
```

---

## 3. Key Architectural Decisions

### 3.1 Architecture Pattern Checklist

| Decision | Choice | Justification |
|----------|--------|---------------|
| **Sync vs Async** | Async (video pipeline), Sync (API) | Video is a continuous pipeline; user-facing APIs need immediate response |
| **Event-driven vs Request-response** | Event-driven (video, chat, commerce events) | Decouples producers/consumers; enables analytics pipeline |
| **Push vs Pull** | Push (chat), Pull (HLS segments) | Chat needs real-time push; HLS is client-pull by design |
| **Stateless vs Stateful** | Stateful (chat edges, ingest proxies), Stateless (API services) | Chat and ingest require persistent connections; API services scale horizontally |
| **Read-heavy vs Write-heavy** | Read-heavy (25:1 viewer:streamer) | CDN caching is critical; edge nodes serve cached segments |
| **Real-time vs Batch** | Real-time (video, chat), Batch (analytics, VOD processing) | Core experience is live; analytics can be delayed |
| **Edge vs Origin** | Edge-heavy (CDN), Origin for transcoding | Segments cached at edge; compute-intensive transcoding stays at origin |

### 3.2 Microservices vs Monolith

**Choice: Microservices** (evolved from Ruby on Rails monolith)

Twitch's original Rails monolith became untenable as the platform scaled. The migration to microservices was driven by:

1. **Independent scaling** — Chat, video, and commerce have vastly different scaling profiles
2. **Technology diversity** — Go for chat (concurrency), custom C/C++ for transcoder, TypeScript for frontend
3. **Team autonomy** — 8 engineering organizations with independent deployment cycles
4. **Fault isolation** — Chat outage shouldn't affect video delivery

### 3.3 Database Choices (Polyglot Persistence)

| Database | Use Case | Justification |
|----------|----------|---------------|
| **PostgreSQL** (~94% of DB hosts) | User profiles, subscriptions, channel metadata, payments | ACID compliance, mature ecosystem, strong consistency |
| **Redis** | Chat room state, session cache, hot segment cache, rate limiting | Sub-millisecond reads, pub/sub support, TTL for ephemeral data |
| **OpenSearch** | Stream/channel search, content discovery | Full-text search with ML-based ranking |
| **Object Storage** | VODs, clips, thumbnails, emotes | Cost-effective for large binary blobs; 11-nines durability |
| **Time-Series Store** | Video quality metrics, viewer analytics | Efficient for append-only time-stamped data |
| **Data Lake (Redshift + S3)** | Historical analytics, ML training | 100+ PB of data; columnar for OLAP workloads |

### 3.4 Caching Strategy

```
┌─────────────────────────────────────────────┐
│ L1: In-Process Cache (per service instance) │
│  - Stream metadata, user sessions           │
│  - TTL: 10-30 seconds                       │
├─────────────────────────────────────────────┤
│ L2: Distributed Cache (Redis Cluster)       │
│  - Chat room state, subscriber lists        │
│  - Viewer counts, emote metadata            │
│  - TTL: 1-5 minutes                         │
├─────────────────────────────────────────────┤
│ L3: Edge Cache (Replication Tree Nodes)     │
│  - HLS segments (2-second segments)         │
│  - Manifest files (very short TTL)          │
│  - TTL: segment duration (~2s for live)     │
├─────────────────────────────────────────────┤
│ L4: Client-Side Cache (Player Buffer)       │
│  - Pre-fetched segments (2-6 seconds ahead) │
│  - Adaptive bitrate history                 │
└─────────────────────────────────────────────┘
```

### 3.5 Message Queue / Event Bus Usage

| Queue/Topic | Producer | Consumer | Pattern |
|-------------|----------|----------|---------|
| `stream.go-live` | Ingest Service | Notification, Discovery, Analytics | Fan-out |
| `stream.offline` | Ingest Service | VOD Archiver, Cleanup | Fan-out |
| `chat.message` | Chat Edge | Analytics, Moderation ML | Streaming |
| `commerce.purchase` | Payment Service | Fulfillment, Ledger, Analytics | Exactly-once |
| `commerce.subscription` | Sub Service | Entitlement, Notification | Exactly-once |
| `video.segment` | Transcoder | Replication Tree, Clip Service | Streaming |
| `user.action` | All Services | Data Lake (3M events/s) | Streaming |

---

## 4. Technology Stack Summary

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Frontend (Web)** | TypeScript, React (Twilight) | ~80 pages, ~140 monthly contributors |
| **Frontend (Mobile)** | Swift (iOS), Kotlin (Android) | Custom native UI libraries |
| **Frontend (TV)** | Starshot Platform | Samsung, LG, Nintendo Switch |
| **Backend Services** | Go (primary) | Migrated from Ruby; chosen for concurrency |
| **Video Transcoder** | Custom C/C++ | Purpose-built, not FFmpeg |
| **API** | REST (Helix API) | 25K+ third-party apps |
| **Chat Protocol** | IRC over WebSocket | Backward-compatible with IRC clients |
| **Event Streaming** | Event Bus (Kafka-like) | 3M events/second to data lake |
| **Primary Database** | PostgreSQL | ~125 DB hosts, 300K+ TPS on largest cluster |
| **Search** | OpenSearch | ML-based ranking since 2019 rebuild |
| **Caching** | Redis | Session, state, hot data |
| **Object Storage** | Cloud Object Storage | VODs, clips, assets |
| **Data Warehouse** | Redshift + S3 | 100+ self-serve clusters |
| **Infrastructure** | Cloud-hosted | 2,000+ cloud accounts |

---

## 5. Service Interaction Matrix

| Source → Destination | Protocol | Data | Frequency | Failure Handling |
|---------------------|----------|------|-----------|-----------------|
| **Streamer → PoP** | RTMP/RTMPS/ERTMP | Raw video + audio stream | Continuous (5 Mbps) | Client auto-reconnect to next-closest PoP |
| **PoP → IRS** | gRPC | Routing request (stream metadata) | Per stream start | IRS returns fallback list; PoP tries next |
| **PoP → Origin** | RTMP relay | Proxied stream | Continuous | IRS reroutes to different origin |
| **Origin → Transcoder** | Internal pipe | Decoded frames | Continuous | Queue overflow → drop oldest frames |
| **Transcoder → Replication Tree** | HLS push | 2-second HLS segments | Every 2s per variant | Segment retransmit; edge re-requests |
| **Chat Client → Edge** | WebSocket (IRC) | Chat messages | Per message | Client reconnects to different Edge |
| **Edge → PubSub** | gRPC streaming | Validated messages | Per message | Circuit breaker; local delivery continues |
| **PubSub → Edge (fanout)** | gRPC streaming | Broadcast messages | Per message per Edge | Best-effort; viewer sees gap |
| **Commerce → Payment Gateway** | REST (TLS) | Transaction requests | Per purchase | Retry with idempotency key; fallback gateway |
| **All Services → Spade** | Event bus | Structured events | 3M events/s total | Client-side buffer; at-least-once delivery |

---

## 6. Video Delivery Architecture Deep Dive

### HLS Segment Lifecycle

```
Segment Lifecycle (from encoder output to viewer playback):

  Transcoder Output
       │
       ▼
  HLS Packager (at origin)
       │ Create: segment_001.ts + playlist update
       │ Duration: 2 seconds (Low-Latency: partial CMAF chunks)
       ▼
  Replication Tree Push
       │ Push to edges with active viewers for this stream
       │ Demand-based: only edges with viewers get segments
       ▼
  Edge Cache (RAM for hot streams)
       │ Serve to connected viewers
       │ TTL: segment duration (~2s for live, longer for VOD)
       ▼
  Viewer Player
       │ Maintain 2-6 second buffer
       │ ABR algorithm selects quality based on bandwidth + buffer level
       ▼
  Playback
```

### Low-Latency HLS (LL-HLS) Optimization

| Technique | Latency Reduction | How It Works |
|-----------|-------------------|-------------|
| **Partial CMAF segments** | -2s | Deliver sub-segments (0.33s chunks) before full 2s segment is complete |
| **Push-based delivery** | -1s | Origin pushes segments to edges (no pull latency) |
| **Segment pipelining** | -0.5s | Begin encoding next segment while current is being delivered |
| **Edge RAM caching** | -0.2s | Hot stream segments served from RAM (100x faster than disk) |
| **Preload hints** | -0.3s | Manifest tells player about next segment before it exists |
| **Combined effect** | ~4s total glass-to-glass | Down from ~6-8s with standard HLS |

### Adaptive Bitrate (ABR) Decision Flow

```mermaid
flowchart TB
    Start["Player Requests\nNext Segment"]
    Start --> Buffer{"Buffer Level?"}
    Buffer -->|"< 2s (critical)"| Lowest["Select Lowest\nQuality"]
    Buffer -->|"2-4s (low)"| Down["Step Down\nOne Quality Level"]
    Buffer -->|"4-6s (healthy)"| BW{"Estimated\nBandwidth?"}
    Buffer -->|"> 6s (full)"| Up["Step Up\nOne Quality Level"]
    BW -->|"> variant bitrate × 1.5"| Up
    BW -->|"≈ variant bitrate"| Same["Keep Current\nQuality"]
    BW -->|"< variant bitrate × 0.8"| Down

    classDef critical fill:#ffebee,stroke:#c62828,stroke-width:2px
    classDef normal fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef check fill:#e1f5fe,stroke:#01579b,stroke-width:2px

    class Lowest critical
    class Same,Up normal
    class Start,Buffer,BW,Down check
```

---

## 7. Chat Architecture Deep Dive

### Message Flow Through the Chat Stack

```mermaid
sequenceDiagram
    participant S as Sender
    participant E1 as Edge Node A
    participant Mod as Moderation (Clue)
    participant PS as PubSub Cluster
    participant E2 as Edge Node B
    participant E3 as Edge Node C
    participant V as Viewers

    S->>E1: PRIVMSG #channel :message
    E1->>E1: Rate limit check
    E1->>E1: Channel permission check
    E1->>Mod: Evaluate message (async)
    Note over E1,Mod: Circuit breaker: if Clue slow,<br/>allow message + async check
    Mod-->>E1: ALLOW / DENY
    alt Message allowed
        E1->>PS: Publish to channel topic
        PS->>E2: Fanout to Edge B
        PS->>E3: Fanout to Edge C
        E2->>V: Deliver to local viewers
        E3->>V: Deliver to local viewers
        E1->>V: Deliver to local viewers on Edge A
    else Message denied
        E1->>S: NOTICE: message blocked
    end
```

### Chat Scale Tiers

| Channel Size | Viewers | Messages/s | Architecture | Notes |
|-------------|---------|-----------|-------------|-------|
| **Small** | <100 | <5 | Single Edge node | All viewers on one node; no PubSub needed |
| **Medium** | 100-10K | 5-100 | 1-2 Edge nodes + PubSub | Normal fanout |
| **Large** | 10K-100K | 100-1K | 4+ Edge nodes + PubSub | Message batching enabled |
| **Mega** | 100K-500K | 1K-5K | 8+ Edge nodes + PubSub | Slow mode + subscriber-only + sampling |
| **Ultra** | 500K+ | 5K+ | Dedicated PubSub partition | Aggressive sampling; priority delivery |

---

## 8. Commerce Architecture Overview

### Subscription and Monetization Flow

```mermaid
flowchart TB
    subgraph Viewer["Viewer Actions"]
        Sub["Subscribe"]
        Bits["Buy Bits"]
        Gift["Gift Sub"]
    end

    subgraph PaymentGW["Payment Gateway"]
        Stripe["Primary Gateway"]
        Backup["Backup Gateway"]
        FraudCheck["Fraud Detection"]
    end

    subgraph Commerce["Commerce Services (40+)"]
        SubSvc["Subscription\nService"]
        BitsSvc["Bits\nService"]
        GiftSvc["Gift\nService"]
        Entitle["Entitlement\nService"]
        Ledger["Financial\nLedger"]
    end

    subgraph Creator["Creator Payout"]
        Revenue["Revenue\nCalculation"]
        Payout["Payout\nService"]
    end

    Sub --> FraudCheck --> Stripe --> SubSvc
    Bits --> FraudCheck --> Stripe --> BitsSvc
    Gift --> FraudCheck --> Stripe --> GiftSvc

    SubSvc --> Entitle
    BitsSvc --> Entitle
    GiftSvc --> Entitle

    SubSvc --> Ledger
    BitsSvc --> Ledger
    GiftSvc --> Ledger

    Ledger --> Revenue --> Payout

    classDef viewer fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef payment fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef commerce fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef payout fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class Sub,Bits,Gift viewer
    class Stripe,Backup,FraudCheck payment
    class SubSvc,BitsSvc,GiftSvc,Entitle,Ledger commerce
    class Revenue,Payout payout
```

### Revenue Split Model

| Revenue Source | Platform Share | Creator Share | Processing |
|---------------|--------------|--------------|------------|
| **Tier 1 subscription** ($4.99) | 50% | 50% | Recurring monthly billing |
| **Tier 2 subscription** ($9.99) | 50% | 50% | Recurring monthly billing |
| **Tier 3 subscription** ($24.99) | 50% | 50% | Recurring monthly billing |
| **Bits (cheering)** | ~30% | ~70% (1 Bit = $0.01 to creator) | Pre-purchased virtual currency |
| **Ads** | 45% | 55% | Per-impression; mid-roll and pre-roll |
| **Gift subscriptions** | 50% | 50% | One-time purchase; random or targeted recipient |
