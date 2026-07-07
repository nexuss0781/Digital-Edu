# 08 - Interview Guide

## Interview Pacing (45-min Format)

| Time | Phase | Focus | Key Points |
|------|-------|-------|------------|
| 0-5 min | **Clarify** | Scope the problem | RSS ingestion or just direct upload? Ad-supported? Scale expectations? |
| 5-12 min | **High-Level** | Core architecture | Ingestion pipeline, streaming path, CDN, catalog service |
| 12-25 min | **Deep Dive** | 1-2 critical components | RSS crawler design, DAI pipeline, OR recommendation system |
| 25-35 min | **Scale & Trade-offs** | Bottlenecks, failures | Feed polling at scale, CDN hot spots, DAI latency |
| 35-42 min | **Extensions** | Advanced features | Analytics (IAB 2.2), transcription/search, monetization |
| 42-45 min | **Wrap Up** | Summary + Q&A | Recap key decisions, handle follow-ups |

---

## Meta-Commentary

### What Makes This System Unique

1. **Open Protocol Federation** — Unlike YouTube or Spotify (walled gardens), podcasting is built on RSS. You must design for ingesting content from millions of independent sources you don't control. This fundamentally changes the architecture.

2. **Measurement Complexity** — "Download" in podcasting doesn't mean "listened." The IAB 2.2 standard defines specific rules for counting downloads (byte-range accumulation, bot filtering, deduplication window). This is a differentiated topic worth deep-diving on.

3. **Server-Side Ad Insertion** — DAI sits in the critical playback path and must make ad decisions + stitch audio in < 200ms. This is a real-time system within a batch-oriented content platform.

4. **Long-Tail Content** — Unlike music (top 1% of tracks = 90% of plays), podcasts have a very long tail. Your caching and CDN strategy must handle both viral episodes and niche shows with 50 listeners.

### Where to Spend Most Time

| Priority | Topic | Why |
|----------|-------|-----|
| **1** | RSS Feed Ingestion | Unique to podcasting; shows distributed systems thinking |
| **2** | DAI Pipeline | Revenue-critical; real-time system design |
| **3** | Audio CDN Strategy | Shows understanding of content delivery at scale |
| **4** | Analytics (IAB 2.2) | Industry-specific; differentiates from generic streaming |

### What NOT to Over-Invest In

- Don't spend 10 minutes on user authentication — it's standard OAuth
- Don't over-design the creator upload flow — it's a standard file upload pipeline
- Don't deep-dive into the recommendation algorithm math — focus on the system architecture around it
- Don't design a live streaming system — that's a different problem (Twitch)

---

## Trade-offs Discussion

### Trade-off 1: RSS Polling vs Push-Based Ingestion

| | Polling (Traditional) | WebSub/Podping (Push) |
|--|---------------------|----------------------|
| **Pros** | Universal (works with all feeds); no host cooperation needed; simple to implement | Near-real-time updates; less bandwidth wasted; lower load on hosts |
| **Cons** | High bandwidth waste (70%+ polls find no changes); delayed discovery; load on hosts | Requires host support (only ~30% of feeds); hub infrastructure; missed notifications possible |
| **Recommendation** | Hybrid: Push-first with adaptive polling fallback. Poll less frequently for push-enabled feeds. |

### Trade-off 2: Server-Side vs Client-Side Ad Insertion

| | SSAI (Server-Side) | CSAI (Client-Side) |
|--|-------------------|-------------------|
| **Pros** | Ad-blocker resistant; seamless audio; simpler client SDK; better measurement | Lower server cost; no stitching latency; easier to update ads |
| **Cons** | Server in critical path; stitching compute cost; CDN cache fragmentation | Ad-blockable; audio gaps at transitions; complex client; measurement challenges |
| **Recommendation** | SSAI for primary delivery. Gives better ad delivery guarantees and user experience. |

### Trade-off 3: Transcode on Ingestion vs Transcode on Demand

| | On Ingestion (Eager) | On Demand (Lazy) |
|--|---------------------|------------------|
| **Pros** | Instant playback for all formats; predictable latency; CDN-friendly | Storage savings (only popular episodes transcoded); lower compute cost |
| **Cons** | Storage cost (3× per episode); wasted compute on unplayed episodes | First-play latency; complex caching; cold start problem |
| **Recommendation** | Eager for popular shows (top 10%); lazy with caching for long tail. Pre-transcode to MP3-128 always (universal compatibility). |

### Trade-off 4: Pull RSS Audio vs Cache Locally

| | Pull from Host (Proxy) | Cache in Our Storage |
|--|----------------------|---------------------|
| **Pros** | No storage cost; always latest version; respects host bandwidth | Reliable delivery; CDN-optimized; survives host outage; DAI-friendly |
| **Cons** | Dependent on host uptime; can't guarantee latency; DDoS risk to hosts | Storage cost (PBs); stale content possible; legal considerations |
| **Recommendation** | Cache locally for all active episodes. Required for DAI (need to split/stitch audio). Only proxy for very long-tail or on-demand. |

### Trade-off 5: Transcript-Based Search vs Metadata-Only Search

| | Metadata Only | Full Transcript Search |
|--|--------------|----------------------|
| **Pros** | Simple; fast index; low compute cost | Find specific moments; semantic search; better discovery |
| **Cons** | Can't search episode content; miss relevant results | GPU-intensive transcription; larger index; transcription errors |
| **Recommendation** | Full transcript search — differentiating feature. GPU cost offset by better engagement and ad targeting. |

### Trade-off 6: Download Count vs Listen-Through Measurement

| | Download Count (Simple) | Listen-Through (Detailed) |
|--|------------------------|-------------------------|
| **Pros** | Simple to implement; industry standard (IAB 2.2); works offline | True engagement metric; better for advertisers; quality signal |
| **Cons** | Download ≠ listen; inflated numbers; limited ad attribution | Requires client-side tracking; privacy concerns; doesn't work offline |
| **Recommendation** | Both: IAB 2.2 downloads for industry compatibility + client-side listen-through for internal analytics and ad attribution. |

---

## Trap Questions & How to Handle

| Trap Question | What Interviewer Wants | Best Answer |
|---------------|------------------------|-------------|
| "Why not just let clients fetch directly from the podcast host?" | Understand CDN value + DAI requirement | Works for basic apps but: (1) can't do DAI without proxying audio, (2) host reliability varies, (3) can't measure consistently, (4) CDN gives better latency globally |
| "RSS is just XML parsing — what's hard about it?" | Show understanding of scale challenges | At 4.5M feeds: scheduling, prioritization, politeness (not DDoSing hosts), handling malformed XML, deduplication, bandwidth optimization with conditional requests, and real-time notification via WebSub/Podping |
| "Why not use YouTube's architecture?" | Understand domain differences | Podcasting has unique constraints: RSS federation (not direct upload only), IAB measurement standards (not view counts), audio-only (simpler transcoding but DAI is harder than video ads), and open ecosystem interoperability |
| "What happens if your ad service goes down?" | Test failure thinking + revenue awareness | Never block playback for ads. Graceful degradation: serve episode ad-free, log the missed impression, use circuit breaker to avoid cascading failures, backfill with house ads from local cache |
| "How do you handle a podcast going viral?" | Test scaling under sudden load | CDN pre-warming for trending episodes, auto-scaling DAI servers, origin shield to protect backend, rate limiting on non-critical paths, degrade gracefully (disable transcription, skip recommendations) |
| "Can't you just store everything in a single database?" | Test data modeling sophistication | Different access patterns need different stores: relational for catalog, Redis for playback positions (low-latency), search index for discovery, time-series for analytics, object storage for audio. Polyglot persistence matches workloads to storage engines |
| "How accurate are your download numbers?" | IAB knowledge + measurement sophistication | IAB 2.2 defines strict rules: deduplicate by IP+UA within 24h window, filter bots using IAB list + behavioral detection, require minimum byte download threshold, handle byte-range requests properly. We publish a Description of Methodology and undergo annual audit |

---

## Trade-Off Deep Dives

### Deep Dive 1: Video Podcasting — Bolt-On vs Native

| Dimension | Bolt-On (Audio-First + Video Add-On) | Native Video Platform |
|-----------|-------------------------------------|----------------------|
| **Architecture** | Separate video pipeline; audio remains primary path | Unified media pipeline; video is first-class |
| **Storage cost** | +300% (video variants alongside audio) | Same, but justified by feature parity |
| **DAI complexity** | Must maintain separate SSAI (audio) + VAST (video) | Unified ad pipeline with format negotiation |
| **User experience** | "Video if available" badge; inconsistent | Always know what to expect |
| **Migration risk** | Low (additive, doesn't change core) | High (fundamental architecture change) |
| **Recommendation** | **Bolt-on** — podcasting is still audio-first; don't let video requirements complicate the 98% case |

### Deep Dive 2: AI Transcription — Real-Time vs Batch

| Dimension | Real-Time (During Upload) | Batch (Background Queue) |
|-----------|--------------------------|-------------------------|
| **Latency** | Transcript available immediately | Available 5-60 min after publish |
| **GPU cost** | Requires always-on GPU capacity | Cheaper spot/preemptible instances |
| **Error handling** | Failed transcription blocks publishing | Publish immediately; transcript is enhancement |
| **Quality** | Single-pass only (latency constraint) | Multi-pass with quality checks |
| **Recommendation** | **Batch** — transcripts are a discovery enhancement, not a publishing prerequisite. Episode should be playable without transcript. |

### Deep Dive 3: Feed Ownership Verification

When a creator claims an RSS feed URL, how do you verify they own it?

| Method | Security | UX Friction | Coverage |
|--------|----------|-------------|----------|
| DNS TXT record | High | High (requires DNS access) | Hosting platforms only |
| Feed XML injection (`<podcast:verify>`) | Medium | Medium (edit RSS) | Self-hosted creators |
| Email to feed's `<itunes:owner>` | Medium | Low | Most feeds have this |
| Redirect from feed URL to platform | Medium | Medium | Requires server control |
| **Recommendation** | Email-first (lowest friction) with DNS TXT as elevated verification for monetization access |

---

## Scenario-Based Questions

### Scenario 1: "A podcast with 50M subscribers releases a new episode. How do you handle it?"

```
Expected answer structure:
1. Pre-warming: Popular shows (top 1K) have CDN pre-warming on detection
   ├── WebSub/Podping delivers notification in seconds
   ├── Immediately push to all edge PoPs (before first listener request)
   └── Pre-compute DAI manifests for common ad targeting segments

2. Fan-out notification: 50M subscribers
   ├── Don't fan-out 50M push notifications simultaneously
   ├── Batch in cohorts of 1M with 30s spacing (25 minutes total)
   ├── Prioritize: premium users first, then by timezone (serve active users)
   └── Use notification service with rate-limiting per push provider

3. Traffic spike: Expect 5-10M streams in first hour
   ├── CDN handles 95%+ from edge cache (pre-warmed)
   ├── Auto-scale DAI stitching servers (CPU trigger at 50%)
   ├── Load shed non-critical paths (analytics ingestion, transcription)
   └── Monitor CDN egress and failover to secondary CDN if needed

4. Analytics: 5-10M near-simultaneous download events
   ├── Buffer on client, batch submit every 30s
   ├── Analytics pipeline uses dedicated topic/partition
   └── Accept 5-10 min lag in creator dashboard during spike
```

### Scenario 2: "A major podcast host goes down. 500K feeds become unreachable."

```
Expected answer:
1. Detection: Crawler detects spike in 5xx/timeout errors for feeds on that host
2. Backoff: Exponential backoff per host (not per feed); avoid amplifying the problem
3. Serve cached: All episodes already transcoded and in our CDN — playback unaffected
4. Metadata freshness: Use last-cached feed metadata; mark as "stale" in UI if > 24h
5. Alert creators: Notify affected creators; suggest temporary redirect of RSS URL
6. Recovery: When host recovers, prioritize re-crawling affected feeds
```

### Scenario 3: "An advertiser complains their ads are being served with hate speech content"

```
Expected answer:
1. Immediate: Pull ad campaign from affected shows (circuit breaker)
2. Investigate: Review AI moderation pipeline — was the content flagged?
3. Root cause: Either (a) moderation missed it (model gap) or (b) content changed after approval
4. Fix: Retrain content classifier with new negative examples; add post-publish monitoring
5. Prevention: Implement advertiser brand-safety categories (blocklist topics/shows)
6. Transparency: Provide advertiser with incident report and prevention measures
```

---

## Whiteboard Walkthrough Checklist

Use this as a self-check during the interview:

```
□ RSS ingestion: Did I explain adaptive polling + push (WebSub/Podping)?
□ Deduplication: Did I explain GUID-based dedup for episodes?
□ Transcoding: Did I address multiple formats and eager vs lazy?
□ CDN: Did I explain edge caching, pre-warming, and multi-CDN?
□ DAI: Did I explain SSAI, latency budget, and graceful fallback?
□ Analytics: Did I distinguish downloads from listens (IAB 2.2)?
□ Search: Did I mention transcript-based search + embeddings?
□ Sync: Did I explain cross-device playback position sync?
□ Data model: Did I address sharding strategy for high-write tables?
□ Failure: Did I identify SPOFs and explain degradation strategy?
```

---

## Common Mistakes to Avoid

| Mistake | Why It's Wrong | Better Approach |
|---------|---------------|-----------------|
| Ignoring RSS as the primary content source | Treating it like a direct-upload platform | Design the ingestion pipeline first — it's the most unique aspect |
| Designing for video | Adding unnecessary video transcoding complexity | Focus on audio-only; much simpler transcoding but unique DAI challenges |
| Treating downloads as listens | Misunderstanding podcast measurement | Implement IAB 2.2 compliant measurement; explain the difference |
| Putting DAI inline without fallback | Creating a SPOF for playback | Always serve content without ads if ad service fails |
| Polling all feeds at the same interval | Wasting resources on inactive feeds | Adaptive polling based on frequency + popularity + push-enablement |
| Ignoring the open ecosystem | Building a walled garden | Design for RSS interoperability; feeds must work with all podcast apps |
| Over-engineering the recommendation engine | Spending too much time on ML algorithms | Focus on the system architecture; mention collaborative filtering + content-based signals briefly |
| Not considering offline playback | Podcasts are heavily consumed offline | Design download management, sync protocol, and storage limits |

---

## Questions to Ask Interviewer

| Question | Why It Matters |
|----------|---------------|
| Are we building a podcast player app, a hosting platform, or both? | Scope definition — player ingests RSS; host generates RSS |
| What's the expected scale? (users, podcasts, episodes) | Determines DB strategy, CDN investment, team size |
| Is monetization (ads) in scope? | DAI is a major subsystem worth its own deep dive |
| Do we need to support the open RSS ecosystem or is this a walled garden? | Fundamentally changes architecture (ingestion vs upload-only) |
| Latency requirements for new episode discovery? | Determines polling strategy and push infrastructure investment |
| Is AI-powered transcription/search in scope? | Adds GPU infrastructure, search index, and significant processing pipeline |
| Geographic distribution of listeners? | Multi-region CDN strategy, data residency requirements |
| Premium (ad-free) tier or purely ad-supported? | Affects DAI architecture (can skip DAI for premium users) |

---

## Quick Reference Card

### Quick Numbers Table

| Resource | Value | Context |
|----------|-------|---------|
| RSS feeds to crawl | 4.5M+ | Adaptive polling + push (WebSub/Podping) |
| New episodes/day | 50K | Drives transcoding + transcription pipeline |
| Streaming QPS (peak) | 4,200 | 5× average; morning/evening commute driven |
| CDN egress (avg) | 120 Gbps | 79% of total infrastructure cost |
| IAB dedup window | 24 hours | Same IP + User-Agent + Episode = 1 download |
| DAI latency budget | < 200ms | Ad decision + audio stitching combined |
| Transcription per episode | ~2 min GPU | Whisper-based ASR for 40-min episode |
| Cache hit target | > 94% | Top 1% of episodes in edge cache |
| Annual cost | ~$4.8M | CDN egress dominates at $3.8M |
| Ad revenue potential | ~$920M | At $18 CPM across 140M daily impressions |

### 5 Key Numbers to Remember

| Metric | Number | Context |
|--------|--------|---------|
| Global podcast listeners | ~600M (2026) | Growing ~7% YoY |
| Active podcast feeds | 4.5M+ | ~50K new episodes/day |
| Average episode size | 50MB (128kbps, 40 min) | Smaller than video, larger than music |
| IAB dedup window | 24 hours | Same IP+UA+Episode = 1 download |
| DAI latency budget | < 200ms | Ad decision + audio stitching |

### Architecture Mnemonic: "FIRST"

- **F**eed Ingestion (RSS crawler + WebSub + Podping)
- **I**ndexing & Discovery (search + recommendations + transcription)
- **R**eliable Streaming (CDN + progressive download + offline)
- **S**titched Ads (DAI pipeline + frequency caps + attribution)
- **T**racking & Analytics (IAB 2.2 + playback sync + creator dashboard)

### Key Differentiators from Other Streaming Systems

```
┌──────────────────────────────────────────────────────────────┐
│                    PODCAST vs OTHER MEDIA                     │
├──────────────┬──────────────┬──────────────┬────────────────┤
│              │   Podcast    │    Video     │    Music       │
├──────────────┼──────────────┼──────────────┼────────────────┤
│ Source       │ RSS (open)   │ Upload only  │ Licensed       │
│ File Size    │ 20-150 MB    │ 100MB-10GB   │ 3-10 MB        │
│ Consumption  │ Long-form    │ Variable     │ Short tracks   │
│ Measurement  │ IAB 2.2      │ View count   │ Stream count   │
│ Ads          │ DAI/host-read│ Pre/mid-roll │ Audio ads      │
│ Offline      │ Very common  │ Less common  │ Premium only   │
│ Discovery    │ Word-of-mouth│ Algorithm    │ Playlist       │
│ Federation   │ Open RSS     │ Closed       │ Closed         │
└──────────────┴──────────────┴──────────────┴────────────────┘
```

---

## ADR Template: Key Decision Record

```
ADR-001: Server-Side Ad Insertion over Client-Side

Status: Accepted
Date: 2026-01-15

Context:
  Podcast monetization requires ad insertion. Two approaches exist:
  SSAI (server stitches ads into audio) vs CSAI (client fetches ads separately).

Decision:
  Use SSAI for all ad-supported playback.

Rationale:
  - Ad-blocker resistance (80%+ of users have ad blockers on web)
  - Seamless audio experience (no gaps or buffering at ad boundaries)
  - Consistent measurement (server knows exactly what was delivered)
  - IAB 2.2 compliance easier (server controls measurement point)

Trade-offs accepted:
  - SSAI servers are in the critical playback path (mitigated: graceful fallback)
  - CDN cache fragmentation (each user gets different stitched audio)
  - Higher server cost (~$53K/year for stitching compute)

Alternatives considered:
  - CSAI: Lower server cost but ad-blockable and measurement gaps
  - Hybrid: SSAI for mobile, CSAI for web — too complex for marginal benefit
```

## Follow-Up Deep Dive Topics

If the interviewer wants to go deeper, be ready to discuss:

1. **Podping vs WebSub** — How Podping uses a blockchain-based notification bus vs WebSub's hub-subscriber model; trade-offs of decentralization
2. **Audio Fingerprinting** — Detecting duplicate/pirated content across feeds using acoustic fingerprints
3. **Cross-Device Sync** — Conflict resolution strategies for playback position across phone, car, smart speaker
4. **Podcast 2.0 Namespace** — New RSS tags (chapters, transcripts, value, soundbite) and how they affect platform design
5. **Privacy-Preserving Analytics** — How to measure without tracking individual listeners (cohort-based, differential privacy)
6. **Multi-CDN Strategy** — Failover, cost optimization, and performance-based routing across CDN providers
7. **AI-Generated Content Detection** — Deepfake audio detection pipeline; disclosure requirements; voice consent
8. **Video Podcast Architecture** — Dual-track audio+video delivery; bandwidth-aware client negotiation; video DAI (VAST/VPAID)
9. **Value4Value Payments** — Lightning Network micropayments; streaming sats during playback; payment splits per `<podcast:value>` tag
10. **Podcast 2.0 Namespace** — Enhanced RSS tags for transcripts, chapters, persons, soundbites; backward compatibility with legacy clients

---

## Key Principles to Demonstrate

| Principle | How to Show It |
|-----------|---------------|
| **Federation awareness** | Design for RSS as the primary content source, not just direct upload |
| **Measurement precision** | Distinguish downloads from listens; explain IAB 2.2 rules |
| **Revenue protection** | DAI graceful fallback (availability > monetization) |
| **Long-tail handling** | Different caching/transcoding strategies for popular vs niche content |
| **Open ecosystem respect** | Design for interoperability with all podcast apps, not a walled garden |
| **Privacy by design** | Cohort-based analytics, IP hashing, on-device processing from the start |
| **AI-aware architecture** | Deepfake detection, AI-generated content disclosure, text-to-podcast pipeline |
