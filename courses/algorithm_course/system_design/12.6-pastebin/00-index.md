# 12.6 Pastebin

## System Overview

A Pastebin is a content-addressed text storage and sharing platform that allows users to store plain text or code snippets and share them via short, unique URLs. At its core, it is a write-once-read-many system with time-bounded storage semantics—pastes are created with an optional expiration policy (from minutes to "never expires"), served with syntax highlighting for 200+ programming languages, and accessed primarily through direct URL sharing rather than search or discovery. Modern pastebin systems at scale handle millions of daily paste creations, serve billions of read requests through aggressive CDN caching, implement content-addressable storage for deduplication, enforce abuse detection pipelines to prevent malware hosting and sensitive data leaks, and support both anonymous and authenticated workflows with granular access controls (public, unlisted, private). The simplicity of the user-facing interface belies the engineering challenges underneath: efficient key generation with collision avoidance, storage tiering between hot metadata and cold content, expiration enforcement across billions of records without database degradation, and rendering syntax-highlighted output at scale without excessive server-side compute.

---

## Key Characteristics

| Characteristic | Description |
|---|---|
| **Architecture Style** | Microservices with separated metadata and content stores, CDN-fronted read path, async cleanup workers |
| **Core Abstraction** | Paste as an immutable content blob with mutable metadata (view count, expiration state, access control) |
| **Processing Model** | Synchronous write path (create paste → generate key → store content → return URL); asynchronous expiration and cleanup |
| **Data Model** | Content-addressed storage (hash-based deduplication) with relational metadata and object storage for content |
| **Read:Write Ratio** | ~5:1 to 10:1 — pastes are created once but read multiple times via shared URLs |
| **Consistency Model** | Strong consistency for writes (paste must be readable immediately after creation); eventual consistency acceptable for view counts and analytics |
| **Availability Target** | 99.9% for write path; 99.95% for read path (CDN-backed) |
| **Latency Targets** | Write: <500ms (including key generation and storage); Read: <100ms (cache hit), <300ms (cache miss with syntax highlighting) |
| **Scalability Model** | Horizontal scaling of stateless API servers; sharded metadata store; object storage for content with CDN edge caching |

---

## Quick Navigation

| Document | Focus Area |
|---|---|
| [01 - Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning, SLOs |
| [02 - High-Level Design](./02-high-level-design.md) | Architecture diagrams, write/read data flows, key decisions |
| [03 - Low-Level Design](./03-low-level-design.md) | Data models, API design, key generation algorithms, Step-by-step plan in plain English |
| [04 - Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Content storage engine, expiration pipeline, syntax highlighting |
| [05 - Scalability & Reliability](./05-scalability-and-reliability.md) | Horizontal scaling, caching layers, fault tolerance, disaster recovery |
| [06 - Security & Compliance](./06-security-and-compliance.md) | Access control, abuse detection, threat model, GDPR/DMCA |
| [07 - Observability](./07-observability.md) | Metrics, logging, tracing, alerting, dashboards |
| [08 - Interview Guide](./08-interview-guide.md) | 45-minute pacing, trade-offs, trap questions, quick reference |
| [09 - Insights](./09-insights.md) | Key architectural insights and cross-cutting patterns |

---

## What Differentiates This System

| Dimension | Naive Pastebin | Production Pastebin |
|---|---|---|
| **Storage** | Single database storing both metadata and content | Separated metadata (relational DB) and content (object storage) with content-addressable deduplication |
| **Key Generation** | Auto-increment ID or random UUID | Pre-generated key pool with collision-free distribution via key generation service |
| **Expiration** | Cron job scanning entire table | Tiered expiration: TTL indexes for short-lived pastes, lazy deletion on read for long-lived, async sweep for bulk cleanup |
| **Read Performance** | Direct database reads on every request | Multi-layer caching: CDN edge → reverse proxy → application cache → database; bloom filters to avoid cache thrashing |
| **Syntax Highlighting** | Server-side rendering on every request | Client-side rendering with pre-tokenized hints; server-side only for raw/embed views; cached rendered output |
| **Abuse Prevention** | None or basic rate limiting | ML-based content scanning, rate limiting per IP/user/API key, CAPTCHA triggers, automated DMCA workflows |
| **Access Control** | Public only | Public, unlisted (accessible via URL only), private (authenticated access), password-protected, team-shared |
| **Scale** | Single server, hundreds of pastes/day | Distributed across regions, millions of pastes/day, billions of reads via CDN |

---

## What Makes This System Unique

### 1. Write-Once-Read-Many with Immutable Content

Unlike most CRUD applications, paste content is almost never updated after creation. This immutability enables aggressive caching strategies—once a paste is created and its content hash computed, the content can be cached at every layer (CDN, reverse proxy, application cache) with infinite TTL, invalidated only by deletion or expiration. This single property transforms what could be a complex cache coherence problem into a simple "cache everything, evict on delete" model.

### 2. The Expiration Problem at Scale

Expiration seems trivial until you have billions of pastes. You cannot scan the entire metadata table looking for expired records—this would lock the database and degrade the service. The solution requires a combination of strategies: TTL indexes in the metadata store for automatic cleanup, lazy deletion (check expiration on read and return 404 if expired), and background sweep workers that process expired records in batches during off-peak hours. The interplay between these three mechanisms—and the edge cases they create (e.g., a paste that expired but hasn't been cleaned up yet appearing in storage metrics)—is a rich area for interview discussion.

### 3. Content-Addressable Storage Creates a Natural Deduplication Layer

Many pastes contain identical content (default templates, common error logs, test data). By computing a hash of the paste content before storing, the system can detect duplicates and store only one copy of the content while creating multiple metadata entries pointing to the same content blob. This deduplication can achieve 15-30% storage savings in practice. However, it introduces complexity: when deleting a paste, the system must check if other pastes reference the same content hash before deleting the underlying blob—a reference counting problem.

### 4. Syntax Highlighting Is a Rendering Problem, Not a Storage Problem

The decision of where and when to perform syntax highlighting has significant architectural implications. Server-side highlighting consumes CPU and increases response latency. Client-side highlighting shifts compute to the browser but requires shipping a highlighting library (200-500KB). The optimal approach is a hybrid: store raw text, serve it with a language hint, let the client render syntax highlighting for interactive views, and pre-render highlighted HTML only for embed/iframe views and search engine crawlers. This separation between storage format and presentation format is a key architectural principle.

---

## Related Patterns

| System | Relationship | Shared Insight |
|---|---|---|
| [1.7 — Distributed Unique ID Generator](../1.7-distributed-unique-id-generator/) | **Key generation** — The KGS pre-generates collision-free slugs using the same distributed uniqueness guarantees | Both solve the "generate globally unique identifier without coordination" problem; Pastebin's KGS adds the constraint that slugs must be short and URL-safe |
| [12.5 — URL Shortener](../12.5-url-shortener/) | **Short URL generation** — Nearly identical key generation and read-heavy architecture | Both are write-once-read-many systems with CDN-fronted read paths; Pastebin adds content storage, syntax highlighting, and expiration management |
| [1.12 — Blob Storage System](../1.12-blob-storage-system/) | **Content storage** — Paste content stored as blobs with content-addressable deduplication | Both use content hashing for deduplication; Pastebin's content is smaller (KB vs GB) but has expiration semantics that blob storage typically lacks |
| [1.15 — Content Delivery Network (CDN)](../1.15-content-delivery-network/) | **Read path acceleration** — CDN edge caching serves 80%+ of read traffic | Both leverage immutable content for aggressive caching; Pastebin's expiration and deletion create cache invalidation events that pure CDN doesn't handle |
| [12.17 — Content Moderation System](../12.17-content-moderation-system/) | **Abuse detection** — Content scanning pipeline prevents malware hosting and sensitive data leaks | Both perform real-time content analysis at ingest; Pastebin's abuse surface includes encoded payloads and credential leaks specific to code-sharing platforms |
| [1.4 — Distributed LRU Cache](../1.4-distributed-lru-cache/) | **Caching layer** — Multi-tier cache hierarchy with LRU eviction for hot pastes | Both solve cache sizing and eviction; Pastebin's immutable content simplifies invalidation to deletion-only events |

---

## Scale Reference Points

| Metric | Small Scale | Medium Scale | Large Scale |
|---|---|---|---|
| **Daily Active Users** | 10K | 500K | 5M |
| **Pastes Created/Day** | 50K | 1M | 10M |
| **Paste Reads/Day** | 250K | 10M | 100M |
| **Average Paste Size** | 2 KB | 5 KB | 10 KB |
| **Storage Growth/Year** | 36 GB | 1.8 TB | 36 TB |
| **Peak Write QPS** | 2 | 35 | 350 |
| **Peak Read QPS** | 10 | 350 | 3,500 |
| **CDN Hit Rate** | 60% | 80% | 90%+ |
| **Metadata Records** | 18M | 365M | 3.6B |

---

## Complexity Rating

| Dimension | Rating | Notes |
|---|---|---|
| **Latency Sensitivity** | ★★☆☆☆ | Sub-second writes acceptable; reads accelerated by CDN caching |
| **Scale (QPS)** | ★★☆☆☆ | Moderate QPS; CDN absorbs majority of read traffic |
| **Data Model Complexity** | ★★☆☆☆ | Simple metadata + content blob; complexity in deduplication and access control |
| **Algorithmic Depth** | ★★★☆☆ | Key generation, content hashing, expiration scheduling, abuse detection |
| **Consistency Challenges** | ★★☆☆☆ | Strong consistency for writes; eventual for analytics; reference counting for dedup |
| **Operational Complexity** | ★★★☆☆ | Expiration cleanup, abuse pipeline, storage tiering, CDN cache invalidation |
| **Interview Frequency** | ★★★★★ | One of the most common system design interview questions; tests fundamentals |

---

## Key Terminology

| Term | Definition |
|---|---|
| **Paste** | A discrete unit of text content stored with metadata (title, language, expiration, visibility) |
| **Slug** | The unique identifier in the paste URL (e.g., `abc12XYz` in `pastebin.example.com/abc12XYz`) |
| **Content Hash** | A cryptographic or fast hash (e.g., SHA-256 or xxHash) of the paste content used for deduplication |
| **Expiration Policy** | Rules governing when a paste is automatically deleted: never, 10 minutes, 1 hour, 1 day, 1 week, 1 month, 6 months, 1 year |
| **Visibility** | Access control level: public (listed and searchable), unlisted (accessible via URL only, not searchable), private (requires authentication) |
| **Syntax Highlighting** | Rendering source code with color-coded tokens based on language grammar (keywords, strings, comments, etc.) |
| **KGS** | Key Generation Service — pre-generates unique slugs to avoid collision checks at write time |
| **Content-Addressable Storage** | Storage where the address (key) is derived from the content itself (typically a hash), enabling automatic deduplication |
| **Lazy Deletion** | Checking expiration status at read time rather than proactively deleting expired records |
| **TTL Index** | A database index that automatically removes documents after a specified time-to-live period |
| **Burn After Reading** | A paste that is automatically deleted after being viewed once |
| **Raw View** | Serving paste content as plain text without HTML wrapping or syntax highlighting (Content-Type: text/plain) |

---

## Core Architectural Challenges

| Challenge | Difficulty | Why It's Hard |
|---|---|---|
| **Expiration at billion-record scale** | Medium-High | Cannot scan entire metadata table; requires three-tier approach (lazy deletion, TTL indexes, background sweep) that must coordinate without causing database contention |
| **Content-addressable deduplication with reference counting** | Medium | Reference counts drift due to concurrent operations, transaction rollbacks, and crash recovery; requires periodic reconciliation |
| **Abuse detection without blocking the write path** | Medium | Content scanning must complete fast enough to stay within write SLO; ML models for malware/PII detection add variable latency |
| **CDN cache invalidation for deleted/expired pastes** | Medium | Balancing cache hit rate (long TTL) against correctness (deleted pastes remain accessible until TTL expires); purge APIs add operational cost |
| **Burn-after-reading atomicity** | Low-Medium | Transforms a stateless read into a stateful mutation requiring compare-and-swap semantics; CDN caching must be bypassed entirely |
| **Rate limiting anonymous users** | Low-Medium | IP-based identity is unreliable (shared NATs, VPNs); multi-signal fingerprinting needed without adding friction for legitimate users |
| **Syntax highlighting at scale** | Low | Server-side rendering consumes CPU per request; client-side offloads compute but requires shipping a 200-500KB highlighting library |

---

## Sources

- Content-addressable storage design patterns
- CDN cache invalidation strategies for mutable state
- Distributed key generation with collision avoidance
- Rate limiting for anonymous-first services
