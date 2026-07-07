# 02 - High-Level Design

## System Architecture

```mermaid
%%{init: {'theme': 'neutral', 'look': 'neo'}}%%
flowchart TB
    subgraph Clients["Client Layer"]
        direction LR
        MobileApp[Mobile App<br/>iOS / Android]
        WebApp[Web App<br/>SPA]
        SmartSpeaker[Smart Speaker<br/>Alexa / Google]
        CarPlay[CarPlay /<br/>Android Auto]
    end

    subgraph Edge["Edge & CDN"]
        LB[Load Balancer<br/>L7]
        CDN[Audio CDN<br/>Global PoPs]
        DAIS[DAI Stitching<br/>Servers]
    end

    subgraph Gateway["API Gateway"]
        AG[API Gateway<br/>Auth / Rate Limit / Routing]
    end

    subgraph CoreServices["Core Platform Services"]
        direction TB
        CatalogSvc[Catalog<br/>Service]
        SearchSvc[Search<br/>Service]
        RecoSvc[Recommendation<br/>Service]
        UserSvc[User<br/>Service]
        SubSvc[Subscription<br/>Service]
        PlaybackSvc[Playback Sync<br/>Service]
        AdSvc[Ad Decision<br/>Service]
        AnalyticsSvc[Analytics<br/>Service]
    end

    subgraph Ingestion["Ingestion Pipeline"]
        FeedCrawler[Feed Crawler<br/>Cluster]
        WebSubHub[WebSub / Podping<br/>Listener]
        FeedParser[Feed Parser<br/>& Normalizer]
        TranscodePipeline[Transcoding<br/>Pipeline]
        TranscriptionSvc[AI Transcription<br/>Service]
    end

    subgraph DataStores["Data Layer"]
        PrimaryDB[(Primary DB<br/>PostgreSQL)]
        SearchIdx[(Search Index<br/>Inverted + Vector)]
        CacheLayer[(Cache Layer<br/>Redis Cluster)]
        TimeSeries[(Time-Series DB<br/>Analytics)]
        GraphDB[(Graph Store<br/>Recommendations)]
    end

    subgraph Storage["Object Storage"]
        AudioStore[(Audio Object<br/>Storage)]
        TranscriptStore[(Transcript<br/>Storage)]
    end

    subgraph Async["Async Processing"]
        MQ[Message Queue<br/>/ Event Bus]
        Workers[Background<br/>Workers]
    end

    Clients --> LB --> AG
    Clients --> CDN
    Clients --> DAIS

    AG --> CatalogSvc & SearchSvc & RecoSvc
    AG --> UserSvc & SubSvc & PlaybackSvc
    AG --> AnalyticsSvc

    DAIS --> AdSvc
    DAIS --> CDN

    FeedCrawler --> FeedParser
    WebSubHub --> FeedParser
    FeedParser --> MQ
    MQ --> CatalogSvc
    MQ --> TranscodePipeline
    MQ --> TranscriptionSvc
    MQ --> Workers

    TranscodePipeline --> AudioStore
    TranscriptionSvc --> TranscriptStore
    AudioStore --> CDN

    CatalogSvc --> PrimaryDB
    SearchSvc --> SearchIdx
    RecoSvc --> GraphDB
    UserSvc --> PrimaryDB
    PlaybackSvc --> CacheLayer
    AnalyticsSvc --> TimeSeries
    CatalogSvc --> CacheLayer

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef edge fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef ingestion fill:#fce4ec,stroke:#c62828,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef storage fill:#e0f2f1,stroke:#004d40,stroke-width:2px
    classDef async fill:#e0f7fa,stroke:#00695c,stroke-width:2px

    class MobileApp,WebApp,SmartSpeaker,CarPlay client
    class LB,CDN,DAIS edge
    class AG gateway
    class CatalogSvc,SearchSvc,RecoSvc,UserSvc,SubSvc,PlaybackSvc,AdSvc,AnalyticsSvc service
    class FeedCrawler,WebSubHub,FeedParser,TranscodePipeline,TranscriptionSvc ingestion
    class PrimaryDB,SearchIdx,CacheLayer,TimeSeries,GraphDB data
    class AudioStore,TranscriptStore storage
    class MQ,Workers async
```

---

## Data Flow: Key Paths

### Path 1: New Episode Published (Write Path)

```mermaid
%%{init: {'theme': 'neutral', 'look': 'neo'}}%%
sequenceDiagram
    participant Host as Podcast Host
    participant Hub as WebSub Hub
    participant Crawler as Feed Crawler
    participant Parser as Feed Parser
    participant Queue as Message Queue
    participant Catalog as Catalog Service
    participant Transcode as Transcoding Pipeline
    participant AI as Transcription Service
    participant Store as Object Storage
    participant CDN as Audio CDN
    participant Push as Push Notification

    Host->>Hub: Notify: new episode published
    Hub->>Crawler: Push notification
    Note over Crawler: Or: adaptive polling detects change

    Crawler->>Host: GET RSS feed (If-None-Match / ETag)
    Host-->>Crawler: 200 OK (updated feed XML)

    Crawler->>Parser: Raw RSS XML
    Parser->>Parser: Validate, normalize, extract metadata
    Parser->>Queue: NewEpisodeEvent

    par Parallel Processing
        Queue->>Catalog: Update catalog metadata
        Catalog->>Catalog: Deduplicate, enrich
        and
        Queue->>Transcode: Transcode audio
        Transcode->>Store: Fetch original audio from host
        Transcode->>Transcode: MP3-128, AAC-64, Opus-48
        Transcode->>Store: Store transcoded variants
        Store->>CDN: Prefetch to edge PoPs
        and
        Queue->>AI: Generate transcript
        AI->>AI: Whisper ASR + diarization
        AI->>Store: Store transcript + chapters
        AI->>Catalog: Update search index
    end

    Catalog->>Push: Notify subscribers
    Push->>Push: Fan-out to subscribed users
```

### Path 2: Listener Streams Episode (Read Path)

```mermaid
%%{init: {'theme': 'neutral', 'look': 'neo'}}%%
sequenceDiagram
    participant App as Mobile App
    participant AG as API Gateway
    participant Catalog as Catalog Service
    participant Cache as Cache
    participant DAI as DAI Server
    participant AdSvc as Ad Decision Service
    participant CDN as Audio CDN
    participant Analytics as Analytics Service
    participant Playback as Playback Sync

    App->>AG: GET /episodes/{id}/play
    AG->>Catalog: Fetch episode metadata
    Catalog->>Cache: Check cache
    Cache-->>Catalog: Cache hit
    Catalog-->>AG: Episode metadata + audio URL

    AG-->>App: Episode manifest (DAI-enabled URL)

    App->>DAI: Request audio stream
    DAI->>AdSvc: Get ads for this user/episode
    AdSvc->>AdSvc: Targeting, frequency cap, bid
    AdSvc-->>DAI: Ad creatives + insertion points

    DAI->>CDN: Fetch episode audio segments
    CDN-->>DAI: Audio segments
    DAI->>DAI: Stitch ads into pre/mid/post positions
    DAI-->>App: Stitched audio stream

    loop Every 30 seconds during playback
        App->>Analytics: Playback event (position, duration)
        App->>Playback: Sync playback position
    end

    App->>Analytics: Episode completion event
    Analytics->>Analytics: IAB 2.2 processing
```

### Path 3: Episode Discovery (Search + Recommendation)

```mermaid
%%{init: {'theme': 'neutral', 'look': 'neo'}}%%
sequenceDiagram
    participant App as Mobile App
    participant AG as API Gateway
    participant Search as Search Service
    participant Reco as Recommendation Service
    participant Graph as Graph Store
    participant Cache as Cache
    participant Catalog as Catalog Service

    App->>AG: GET /discover?user_id=123

    par Parallel Fetch
        AG->>Reco: Get personalized recommendations
        Reco->>Graph: Traverse user-podcast graph
        Reco->>Cache: Get trending episodes
        Reco->>Reco: Blend collaborative + content-based
        Reco-->>AG: Ranked show/episode list
        and
        AG->>Catalog: Get new episodes from subscriptions
        Catalog->>Cache: Check subscription cache
        Catalog-->>AG: Subscription feed
    end

    AG-->>App: Discovery feed (reco + subscriptions + trending)

    Note over App: User searches for topic

    App->>AG: GET /search?q="machine learning"
    AG->>Search: Full-text + semantic search
    Search->>Search: Query inverted index + vector embeddings
    Search->>Search: Rank by relevance + popularity + freshness
    Search-->>AG: Search results (shows + episodes + transcript matches)
    AG-->>App: Search results
```

---

## Key Architectural Decisions

### 1. Monolith vs Microservices

**Decision: Microservices** with domain-oriented ownership.

| Justification | Detail |
|--------------|--------|
| Independent scaling | Feed ingestion scales differently from streaming |
| Team autonomy | Separate teams for ingestion, streaming, ads, ML |
| Failure isolation | Feed crawler outage shouldn't affect playback |
| Technology diversity | Graph DB for reco, time-series for analytics, search index for discovery |

### 2. Synchronous vs Asynchronous Communication

| Communication | Pattern | Where |
|---------------|---------|-------|
| Synchronous (gRPC) | Request-response | Client → API Gateway → Services |
| Asynchronous (events) | Event-driven | Feed ingestion → transcoding → indexing |
| Hybrid | Request + async processing | Playback → sync event fire-and-forget |

**Decision:** Event-driven for the ingestion pipeline (RSS → parse → transcode → index). Synchronous gRPC for real-time client-facing APIs. Fire-and-forget for analytics events.

### 3. Database Choices (Polyglot Persistence)

| Data | Store | Justification |
|------|-------|---------------|
| Podcast/Episode catalog | PostgreSQL (sharded) | Relational integrity, complex queries |
| User profiles & subscriptions | PostgreSQL | Transactional consistency |
| Playback positions | Redis Cluster | Low-latency read/write, ephemeral |
| Search index | Search engine (inverted + vector) | Full-text + semantic search |
| Recommendations graph | Graph database | Traversal for collaborative filtering |
| Analytics events | Time-series DB + data warehouse | High-write throughput, aggregations |
| Audio files | Object storage | Durable, cheap, CDN-integrated |
| Transcripts | Object storage + search index | Large text, searchable |

### 4. Caching Strategy

```
┌─────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Client      │    │  CDN Edge    │    │  Redis       │    │  Database    │
│  Cache       │ →  │  Cache       │ →  │  Cache       │ →  │  (Origin)    │
│  (episodes)  │    │  (audio)     │    │  (metadata)  │    │              │
└─────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
   L1: Device         L2: Edge           L3: App            L4: Persistent
   TTL: ∞ offline     TTL: 24h           TTL: 15 min        Source of truth
```

| Layer | What's Cached | TTL | Eviction |
|-------|---------------|-----|----------|
| L1 (Client) | Downloaded episodes, metadata | Until deleted | User-managed + auto-cleanup |
| L2 (CDN Edge) | Audio files, cover art | 24 hours | LRU per PoP |
| L3 (Redis) | Episode metadata, user subs, playback pos | 15 min (metadata), 24h (subs) | LRU |
| L4 (DB) | Full catalog, user data | Persistent | N/A |

### 5. Message Queue Usage

| Queue/Topic | Producer | Consumer | Purpose |
|-------------|----------|----------|---------|
| `feed.updated` | Feed Crawler | Feed Parser | Raw feed XML for parsing |
| `episode.new` | Feed Parser | Catalog, Transcoder, Transcription | Fan-out new episode processing |
| `episode.transcoded` | Transcoder | Catalog, CDN Prefetch | Audio ready for delivery |
| `playback.events` | Client SDK | Analytics Service | IAB 2.2 event processing |
| `ad.impressions` | DAI Server | Analytics, Billing | Ad delivery confirmation |
| `subscription.changed` | User Service | Notification, Feed Priority | Update feed polling priority |

### 6. Video Podcast Architecture (2025+)

YouTube becoming the #1 podcast platform (39% share) has made video podcast support a competitive necessity. The architecture must handle dual-track delivery:

```mermaid
%%{init: {'theme': 'neutral', 'look': 'neo'}}%%
flowchart TB
    subgraph Upload["Creator Upload"]
        VU[Video Upload<br/>MP4/MOV]
        AU[Audio-Only<br/>Upload]
    end

    subgraph Processing["Transcoding Pipeline"]
        VP[Video<br/>Transcoder]
        AP[Audio<br/>Extractor]
        AT[Audio<br/>Transcoder]
        TH[Thumbnail<br/>Generator]
    end

    subgraph Variants["Output Variants"]
        V1[1080p / 720p / 480p<br/>Adaptive Bitrate]
        A1[MP3-128 / AAC-64<br/>Audio-Only]
        T1[Thumbnails<br/>Timeline Sprites]
    end

    subgraph Delivery["Delivery"]
        VCDN[Video CDN<br/>HLS/DASH]
        ACDN[Audio CDN<br/>Progressive DL]
    end

    VU --> VP --> V1 --> VCDN
    VU --> AP --> AT --> A1 --> ACDN
    AU --> AT
    VP --> TH --> T1 --> VCDN

    classDef upload fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef process fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef variant fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef cdn fill:#fffde7,stroke:#f57f17,stroke-width:2px

    class VU,AU upload
    class VP,AP,AT,TH process
    class V1,A1,T1 variant
    class VCDN,ACDN cdn
```

**Key design decisions:**
- **Audio-first principle**: Always extract and serve an audio-only track — many listeners consume via car/headphones
- **Bandwidth-aware delivery**: Clients negotiate video vs audio-only based on connection quality and user preference
- **DAI for video**: Video ad insertion is significantly more complex (visual + audio sync); use VAST/VPAID standards alongside audio SSAI
- **Storage implications**: Video episodes are 10-50× larger than audio-only (500MB-2GB vs 50MB)

### 7. AI-Generated Podcast Pipeline

```
Text-to-Podcast flow:
├── Input: article URL, PDF, or raw text (max 50K tokens)
├── Content Analysis: extract key topics, entities, arguments
├── Script Generation: LLM creates multi-speaker conversational script
│   ├── Host + Guest format with natural turn-taking
│   ├── Summarization with depth control (5/15/30 min target)
│   └── Fact-checking pass against source material
├── Speech Synthesis: neural TTS with distinct speaker voices
│   ├── Prosody control: emphasis, pacing, emotion
│   ├── Filler injection: "um", "you know" for naturalness
│   └── Cross-talk simulation for realism
├── Audio Post-Processing: normalization, noise floor, mastering
└── Output: standard podcast episode published to RSS

Safety controls:
├── Source attribution: always disclose AI-generated status in RSS metadata
├── Voice consent: only use licensed/synthetic voice models
├── Content guardrails: reject harmful topics, misinformation
└── Rate limiting: max 10 generated episodes/day per creator
```

### 8. Monetization Architecture

| Model | Revenue Split | Implementation |
|-------|--------------|----------------|
| **DAI (programmatic ads)** | Creator 70% / Platform 30% | SSAI with real-time bidding |
| **Host-read ads** | Creator 100% (platform fee) | Marked in RSS; no dynamic insertion |
| **Premium subscriptions** | Creator 85% / Platform 15% | Per-show or bundle; ad-free delivery |
| **Value4Value (Podcast 2.0)** | Creator 99% / Platform 1% | Lightning Network micropayments via `<podcast:value>` tag |
| **Tip jar** | Creator 95% / Platform 5% | One-time donations |

### 9. RSS Ingestion: Poll vs Push

**Decision: Hybrid approach** — Push-first (WebSub/Podping) with adaptive polling fallback.

| Method | Coverage | Latency | Complexity |
|--------|----------|---------|------------|
| WebSub | ~30% of feeds | Real-time (seconds) | Medium (hub management) |
| Podping | ~15% of feeds (growing) | Near-real-time | Low (subscribe to bus) |
| Adaptive Polling | 100% of feeds | 2 min – 6 hours | High (scheduler) |

The adaptive polling interval is based on:
- **Update frequency** — Feeds that update daily get polled every 30 min; weekly feeds every 6 hours
- **Popularity** — Top 10K shows polled every 2-3 minutes
- **Last-Modified / ETag** — Skip full download if unchanged (HTTP 304)
- **WebSub registered** — Reduce polling for push-enabled feeds

---

### 10. Podcast 2.0 Namespace Support

The Podcast 2.0 initiative extends RSS with new namespace tags that affect platform architecture:

| Tag | Purpose | Platform Impact |
|-----|---------|----------------|
| `<podcast:transcript>` | Link to transcript file (SRT/JSON) | Ingest and index external transcripts; reduce transcription costs |
| `<podcast:chapters>` | Structured chapters with images | Display chapter navigation; enhance search with chapter titles |
| `<podcast:value>` | Value4Value payment config | Integrate Lightning Network payments; stream sats during playback |
| `<podcast:liveItem>` | Live streaming support | Real-time audio delivery; different architecture than on-demand |
| `<podcast:person>` | Structured person metadata | Build contributor graph; improve cross-show discovery |
| `<podcast:soundbite>` | Highlight clips (start/duration) | Generate shareable clips; social media previews |
| `<podcast:txt>` | Machine-readable metadata | Enhanced content classification; better ad targeting |

```
Podcast 2.0 tag processing pipeline:
├── Feed parser extracts Podcast 2.0 namespace tags
├── Tags mapped to internal data model extensions
├── transcript tag → download and index external transcript (skip GPU transcription)
├── chapters tag → import chapter markers (prefer creator-authored over AI-generated)
├── value tag → register payment split config with Lightning payment service
├── liveItem tag → register live event; different delivery path (WebSocket/HLS live)
└── person tag → upsert contributor entity; link to contributor graph
```

---

## Architecture Pattern Checklist

- [x] **Sync vs Async:** Sync for client APIs, async for ingestion pipeline
- [x] **Event-driven vs Request-response:** Event-driven ingestion, request-response for streaming
- [x] **Push vs Pull:** Hybrid RSS ingestion (WebSub push + adaptive polling)
- [x] **Stateless vs Stateful:** All services stateless; state in Redis/DB
- [x] **Read-heavy optimization:** Multi-layer caching, CDN, read replicas
- [x] **Real-time vs Batch:** Real-time streaming + batch analytics aggregation
- [x] **Edge vs Origin:** Audio served from CDN edge; DAI at edge or regional PoPs

---

## Component Responsibilities

| Component | Responsibility | Scale Factor |
|-----------|---------------|--------------|
| **Feed Crawler** | Poll RSS feeds, detect changes, respect robots.txt | # of feeds × poll frequency |
| **Feed Parser** | Parse XML, normalize metadata, detect duplicates | # of feed updates/day |
| **Catalog Service** | Source of truth for shows/episodes, CRUD | # of episodes × read QPS |
| **Transcoding Pipeline** | Convert audio to multi-format (MP3, AAC, Opus) | # of new episodes/day |
| **Transcription Service** | Speech-to-text, chapter detection, keyword extraction | # of new episodes/day |
| **Search Service** | Inverted index + vector search for discovery | Search QPS |
| **Recommendation Service** | Graph-based collaborative + content-based filtering | DAU × page loads |
| **Playback Sync** | Cross-device position persistence | DAU × 3 syncs/session |
| **DAI Server** | Ad stitching into audio stream | Streaming QPS |
| **Ad Decision Service** | Targeting, bidding, frequency capping | Streaming QPS |
| **Analytics Service** | IAB 2.2 event processing, bot filtering | Events/day (500M+) |
| **Audio CDN** | Edge caching and delivery of audio files | Egress bandwidth |
| **Video CDN** | HLS/DASH adaptive bitrate video delivery | Video streaming QPS |
| **Content Moderation** | AI-based deepfake detection, copyright fingerprinting | New episodes/day |
| **Payment Service** | Value4Value Lightning payments, premium subscriptions | Transactions/day |

---

## Technology Choices & Rationale

| Component | Technology | Why This Choice | Alternative Considered |
|-----------|-----------|-----------------|----------------------|
| Primary DB | PostgreSQL (sharded) | Strong consistency for catalog + subscriptions; mature ecosystem | CockroachDB (simpler sharding but higher latency) |
| Cache | Redis Cluster | Sub-ms latency for playback positions; atomic operations | Memcached (no persistence; no pub/sub) |
| Search | Search engine (inverted + vector) | Full-text for metadata + vector for semantic/transcript search | PostgreSQL FTS (insufficient for vector embeddings) |
| Message Queue | Event streaming platform | High-throughput event ingestion; consumer groups for fan-out | RabbitMQ (lower throughput; no log semantics) |
| Object Storage | Managed object storage | 11-nines durability for audio; CDN integration | Self-hosted (no cost advantage at this scale) |
| Transcription | Whisper-based ASR | State-of-art accuracy; 99 language support; open model | Cloud speech APIs (higher per-minute cost at scale) |
| CDN | Multi-CDN (3 providers) | Geographic optimization + failover + cost competition | Single CDN (vendor lock-in; no failover) |
| Graph DB | Graph database | Natural model for podcast-listener-topic relationships | PostgreSQL recursive CTEs (poor performance at depth > 3) |
| Time-Series DB | Time-series database | Optimized for high-write analytics events; efficient aggregations | PostgreSQL partitioned tables (works but less efficient) |
| TTS (AI podcasts) | Neural TTS service | Multi-speaker, prosody control, natural-sounding output | Open-source models (lower quality; more GPU needed) |
