# 01 - Requirements & Estimations

## Functional Requirements

### Core Features (In Scope)

| # | Feature | Description |
|---|---------|-------------|
| F1 | **RSS Feed Ingestion** | Crawl, parse, and normalize 4.5M+ podcast RSS feeds with adaptive polling |
| F2 | **Audio Upload & Transcoding** | Creators upload audio; system transcodes to multiple formats/bitrates |
| F3 | **Episode Streaming & Download** | Progressive download and adaptive streaming with resume support |
| F4 | **Catalog & Search** | Full-text and semantic search across shows, episodes, and transcripts |
| F5 | **Personalized Discovery** | ML-powered recommendations, trending, curated playlists |
| F6 | **Subscription & Library** | Subscribe to shows, auto-download new episodes, manage library |
| F7 | **Playback Sync** | Cross-device playback position synchronization |
| F8 | **Analytics (IAB 2.2)** | Compliant download/listen measurement, bot filtering, attribution |
| F9 | **Dynamic Ad Insertion** | Server-side ad stitching with targeting, frequency capping |
| F10 | **Creator Dashboard** | Upload, scheduling, analytics, monetization controls |
| F11 | **AI Transcription & Chapters** | Auto-generated transcripts, chapter markers, show notes |
| F12 | **Offline Playback** | Download episodes for offline listening with storage management |

### Extended Features (2025-2026)

| # | Feature | Description |
|---|---------|-------------|
| F13 | **Video Podcast Support** | Dual-track audio+video delivery; adaptive bitrate video streaming; audio-only fallback for bandwidth-constrained clients |
| F14 | **AI-Generated Podcasts** | Text-to-podcast pipeline: ingest articles/documents → generate multi-speaker conversational audio via TTS models (NotebookLM-style) |
| F15 | **Podcast 2.0 Namespace** | Support enhanced RSS tags: `<podcast:transcript>`, `<podcast:chapters>`, `<podcast:value>` (value4value payments), `<podcast:liveItem>` |
| F16 | **Creator Monetization** | Premium subscriptions (per-show), listener donations (value4value via Lightning Network), tiered ad revenue sharing |
| F17 | **AI Content Moderation** | Deepfake audio detection, copyright audio fingerprinting, hate speech classification, NSFW content flagging |
| F18 | **Privacy-Preserving Analytics** | Cohort-based measurement (no individual tracking), differential privacy for aggregate reporting, cookieless attribution |

### Feature Prioritization

| Priority | Features | Rationale |
|----------|----------|-----------|
| **P0 — Must Have** | F1 (RSS Ingestion), F2 (Upload), F3 (Streaming), F4 (Search), F8 (Analytics) | Core platform loop; non-functional without these |
| **P1 — Should Have** | F5 (Discovery), F6 (Subscriptions), F7 (Sync), F9 (DAI), F12 (Offline) | Expected user experience; revenue-enabling |
| **P2 — Nice to Have** | F10 (Creator Dashboard), F11 (Transcription), F13 (Video), F16 (Monetization) | Competitive differentiation; creator retention |
| **P3 — Future** | F14 (AI Generation), F15 (Podcast 2.0), F17 (AI Moderation), F18 (Privacy Analytics) | Emerging; competitive moat for 2025-2026 |

### Out of Scope

- Live podcast streaming (covered in Twitch 5.7)
- Social features (comments, community) — minimal, not core
- Music licensing / music streaming
- Podcast hosting infrastructure (we are the consumer platform, not the host)

---

## Non-Functional Requirements

### CAP Theorem Choice

**AP (Availability + Partition Tolerance)** with eventual consistency for most services.

| Service | Consistency Model | Justification |
|---------|-------------------|---------------|
| Feed Catalog | Eventual (15 min) | RSS is inherently eventually consistent |
| Playback Position | Eventual (5s) | Last-write-wins across devices |
| Analytics Events | Eventual (minutes) | Batch processing acceptable |
| Subscription State | Strong (per-user) | User expects immediate feedback |
| Ad Decisioning | Strong (per-request) | Frequency caps must be accurate |
| Creator Uploads | Strong | Must confirm upload success |

### Availability Target

| Tier | Target | Applies To |
|------|--------|------------|
| Tier 0 | 99.99% (52 min/year) | Audio streaming / CDN |
| Tier 1 | 99.95% (4.4 hr/year) | Search, recommendations, playback sync |
| Tier 2 | 99.9% (8.7 hr/year) | Creator dashboard, analytics |
| Tier 3 | 99.5% | Feed ingestion pipeline (can catch up) |

### Latency Targets

| Operation | p50 | p95 | p99 |
|-----------|-----|-----|-----|
| Episode playback start | < 500ms | < 1.5s | < 3s |
| Search results | < 200ms | < 500ms | < 1s |
| Feed discovery page | < 300ms | < 800ms | < 1.5s |
| Playback position sync | < 1s | < 3s | < 5s |
| Ad decision + stitch | < 100ms | < 250ms | < 500ms |
| Feed ingestion (new episode available) | < 15 min | < 30 min | < 60 min |

### Durability Guarantees

| Data Type | Durability | Mechanism |
|-----------|------------|-----------|
| Audio files | 99.999999999% (11 nines) | Object storage with cross-region replication |
| User data | 99.9999% | Replicated databases with point-in-time recovery |
| Analytics events | 99.99% | Write-ahead log + async replication |
| Transcripts | 99.999% | Object storage (regeneratable) |

---

## Capacity Estimations (Back-of-Envelope)

### Assumptions

- 600M global podcast listeners (2026 projection)
- 20% are on our platform = **120M MAU**
- 40% DAU ratio = **48M DAU**
- Average session: 35 minutes, 1.5 episodes
- Average episode: 40 minutes, 50MB (128kbps MP3)
- 4.5M podcasts, 200M total episodes
- 50K new episodes published daily

### Traffic Estimations

| Metric | Estimation | Calculation |
|--------|------------|-------------|
| MAU | 120M | 600M × 20% platform share |
| DAU | 48M | 120M × 40% DAU ratio |
| Read:Write Ratio | ~200:1 | Streaming vs publishing |
| Episodes streamed/day | 72M | 48M DAU × 1.5 episodes |
| QPS (streaming, avg) | 833 req/s | 72M / 86,400s |
| QPS (streaming, peak) | 4,200 req/s | 5× avg (morning/evening commute) |
| QPS (search, avg) | 280 req/s | ~24M searches/day |
| QPS (feed poll, avg) | 520 req/s | 4.5M feeds / (avg 2.4hr interval) |
| New episodes/day | 50K | Industry data |
| Playback sync events/day | 144M | 48M × 3 position saves/session |

### Storage Estimations

| Metric | Estimation | Calculation |
|--------|------------|-------------|
| Total audio catalog | 10 PB | 200M episodes × 50MB avg |
| Annual audio growth | 912 TB/yr | 50K episodes/day × 50MB × 365 |
| Transcoded variants | 30 PB | 3 formats × 10 PB |
| Transcripts | 200 TB | 200M episodes × 1MB avg text |
| Metadata DB | 500 GB | 200M episodes × 2.5KB |
| User data (profiles, subs) | 1.2 TB | 120M users × 10KB |
| Analytics events/day | 5 TB | 500M events × 10KB |
| Analytics (Year 1) | 1.8 PB | 5 TB/day × 365 |
| Cache (hot episodes) | 50 TB | Top 1% of catalog |

### Bandwidth Estimations

| Metric | Estimation | Calculation |
|--------|------------|-------------|
| Egress (avg) | 28 Gbps | 72M × 50MB / 86,400s × 8 bits |
| Egress (peak) | 140 Gbps | 5× average |
| Ingress (uploads) | 200 Mbps | 50K × 50MB / 86,400s × 8 bits |
| CDN edge traffic | 120 Gbps | 85% served from edge cache |

---

## SLOs / SLAs

| Metric | SLO Target | SLA (External) | Measurement |
|--------|------------|-----------------|-------------|
| Availability (streaming) | 99.99% | 99.95% | Synthetic probes + real user monitoring |
| Playback start latency (p99) | < 3s | < 5s | Client-side telemetry |
| Search latency (p99) | < 1s | < 2s | Server-side instrumentation |
| Feed freshness | < 15 min | < 60 min | Feed ingestion lag metric |
| Ad decision latency (p99) | < 500ms | < 1s | DAI pipeline instrumentation |
| Error rate (streaming) | < 0.01% | < 0.1% | 5xx responses / total requests |
| Analytics accuracy | IAB 2.2 compliant | Certified | Annual IAB audit |
| Data durability | 99.999999999% | 99.9999% | Object storage SLA |

### Error Budget Policy

| SLO | Monthly Budget | Burn Rate Alert |
|-----|---------------|-----------------|
| Streaming 99.99% | 4.3 min downtime | Alert at 50% burn in first 25% of window |
| Search 99.95% | 21.6 min downtime | Alert at 50% burn in first 25% of window |
| Feed freshness | 15 min p99 lag | Alert when p99 > 20 min |
| DAI fill rate > 70% | N/A (business metric) | Alert when < 65% for 30 min |
| Transcription queue < 5K | N/A (operational) | Alert when > 8K for 1 hour |

### Video Podcast Storage Impact

```
Video episode sizing (40-minute episode):
├── 1080p / 30fps / h264:  ~1.2 GB
├── 720p / 30fps / h264:   ~600 MB
├── 480p / 30fps / h264:   ~250 MB
├── Audio-only (MP3-128):  ~50 MB
└── Total per video episode: ~2.1 GB (vs 50 MB audio-only = 42× increase)

If 10% of catalog adds video (20M episodes):
├── Video storage: 20M × 2.1 GB = 42 PB additional
├── CDN impact: video episodes have 5× higher per-stream egress
├── Transcoding: video is 20× more compute-intensive than audio
└── Cost impact: ~$3M/year additional storage + $1M/year CDN
```

---

## Annual Cost Model

```
--- Compute & Infrastructure ---
API servers (20 instances × $0.12/hr × 24h × 365):       $21K
Feed crawler cluster (30 workers × $0.08/hr × 24h × 365): $21K
Transcoding pipeline (10 GPU × $0.40/hr × 24h × 365):    $35K
Transcription pipeline (8 GPU × $1.20/hr × 24h × 365):   $84K
Redis cluster (6 nodes × $0.20/hr × 24h × 365):          $10.5K
PostgreSQL (primary + shards + replicas):                  $120K
Search cluster (12 nodes):                                 $52K
Message queue cluster (6 brokers):                         $32K
DAI stitching servers (50 instances):                      $53K
Monitoring, logging, tracing:                              $45K
Subtotal compute:                                          ~$474K/year

--- Storage ---
Audio object storage (30 PB):                              $540K/year
Transcript storage (200 TB):                               $4K/year
CDN egress (120 Gbps avg):                                 $3.8M/year
Subtotal storage + delivery:                               ~$4.3M/year

--- Total Annual Cost ---
Total:                                                     ~$4.8M/year
Cost per MAU:                                              ~$0.04/month
Cost per stream:                                           ~$0.000066

Revenue per 1000 ad impressions (CPM):                     $18-25
Daily ad impressions (at 78% fill × 72M streams × 2.5 ads): ~140M
Annual ad revenue:                                         ~$920M (at $18 CPM)
Platform take rate (30%):                                  ~$276M
Gross margin:                                              ~98%
```

### Key Cost Optimization Levers

| Lever | Savings Potential | Trade-off |
|-------|-------------------|-----------|
| Increase CDN cache hit rate from 94% to 97% | ~$1.1M/year in egress | Higher edge storage; slightly staler content |
| Lazy transcoding for long-tail (bottom 80%) | ~$25K/year in GPU costs | First-play latency for cold episodes |
| Tiered transcription (premium shows first) | ~$40K/year | Delayed transcripts for less popular shows |
| Multi-CDN bidding (cost-based routing) | ~$500K/year | More complex routing; potential latency variance |

---

### Key Cost Insight

CDN egress is 79% of total cost. Every percentage point of cache hit rate improvement saves ~$40K/year. This makes cache strategy the single most impactful cost lever — more important than compute optimization.

---

## Key Estimation Insights

1. **CDN egress dominates cost**: At $3.8M/year for 120 Gbps average egress, CDN is 79% of total infrastructure cost. Every 1% improvement in cache hit rate saves ~$40K/year. This makes multi-CDN cost optimization the most impactful engineering investment.

2. **Long-tail storage economics**: 99% of audio is accessed by < 1% of listeners. Tiering to cold storage after 2 years of inactivity could save ~$200K/year, but complicates the CDN warming strategy for rediscovered content.

3. **Transcription GPU cost is manageable**: At 50K new episodes/day and ~2 minutes GPU time per 40-minute episode, total GPU-hours needed are ~1,667/day. At $1.20/GPU-hour, this is ~$730K/year — a modest cost for a transformative feature (searchable audio).

4. **Analytics ingestion scales linearly**: 500M events/day at 10KB each = 5 TB/day of raw analytics. This is the single largest write workload and drives the choice of time-series DB with aggressive roll-up (raw → hourly → daily).

5. **Video podcasting 10× storage impact**: A 40-minute video episode at 1080p is ~500MB-1GB (vs 50MB audio). If 10% of catalog adds video, storage grows from 30 PB to 50 PB, requiring a reassessment of transcoding strategy (lazy for long-tail, eager for top 10%).

---

## SLO Error Budget Example

```
Streaming availability: 99.99% SLO over 30-day rolling window

Total minutes in 30 days:   30 × 24 × 60 = 43,200 minutes
Error budget:               43,200 × 0.01% = 4.32 minutes of allowed downtime
Measurement:                % of streaming requests returning non-error response

Scenario A — CDN PoP failure (2 minutes, automatic failover):
├── Budget consumed: 2 / 4.32 = 46.3%
├── Remaining budget: 2.32 minutes (53.7%)
└── Action: Post-mortem required, but no deployment freeze

Scenario B — DAI service deployment causes 6 minutes of errors:
├── Budget consumed: 6 / 4.32 = 138.9% (BUDGET EXHAUSTED)
├── Action: Deployment freeze; all engineering on reliability
└── Resume: Only after root cause fixed and budget replenished to > 20%

Feed freshness: 15 min p99 SLO over 7-day rolling window
├── Budget: Measured as % of poll cycles where freshness > 15 min
├── If crawler backlog causes p99 > 20 min for 2 hours:
│   Budget consumed: based on # of affected feeds × delay
└── Action: Scale up crawlers; prioritize push-enabled feeds
```

---

## Key Differences from Other Media Platforms

| Aspect | Podcast Platform | Video Platform (YouTube) | Music Platform (Spotify) |
|--------|-----------------|-------------------------|-------------------------|
| Content Source | RSS federation + direct upload | Direct upload only | Licensed catalog |
| File Size | 20-150MB per episode | 100MB-10GB per video | 3-10MB per track |
| Consumption | Sequential, long-form (30-90 min) | Variable, visual attention | Short tracks, shuffled |
| Discovery | Less algorithm-dependent, word-of-mouth heavy | Algorithm-dominated | Playlist-dominated |
| Measurement | IAB 2.2 standard (industry-specific) | View count heuristics | Stream count |
| Monetization | DAI + host-read ads + subscriptions | Pre-roll/mid-roll video ads | Subscription + free tier ads |
| Transcoding | Audio-only, fewer variants (video emerging) | Video + audio, many variants | Audio-only, DRM-heavy |
| Federation | Open RSS protocol | Closed platform | Closed platform |
| Offline | Core feature (heavy offline consumption) | Premium only | Premium only |
| AI Content | AI-generated podcasts emerging (text-to-podcast) | Minimal AI generation | AI playlists only |
