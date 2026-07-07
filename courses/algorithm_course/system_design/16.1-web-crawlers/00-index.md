# 16.1 Web Crawlers

## Overview

A Web Crawler (also called a spider or bot) systematically traverses the World Wide Web, discovering and fetching pages to build an index for a search engine. The crawler manages a URL Frontier — a priority-ordered, politeness-aware queue of billions of URLs — and coordinates thousands of distributed fetcher workers that download pages, extract links, detect duplicates, and feed discovered URLs back into the frontier. The core challenge is maximizing coverage and freshness of a multi-trillion-page web while respecting per-host rate limits (politeness), avoiding spider traps, deduplicating content at massive scale, and operating within finite bandwidth and storage budgets.

## Key Characteristics

| Characteristic | Description |
|----------------|-------------|
| **Write-heavy, read-heavy** | The crawler both writes (stores fetched pages, updates URL metadata) and reads (resolves URLs, checks deduplication, queries the frontier) at extreme volume — billions of operations per day |
| **Bandwidth-bound** | Network bandwidth, not CPU or disk, is the primary Slowest part of the process; the system must maximize useful bytes fetched per second across thousands of connections |
| **Politeness-constrained** | Even with infinite bandwidth, the crawler cannot fetch faster than individual web servers allow; per-host rate limiting is a hard architectural constraint, not a nice-to-have |
| **Distributed execution** | Fetcher workers run across hundreds to thousands of machines in multiple data centers worldwide to minimize network latency to target hosts |
| **Freshness-sensitive** | A stale index degrades search quality; the crawler must continuously recrawl high-value pages while still discovering new content — a fundamental resource allocation tension |

## Complexity Rating: **Very High**

The combination of managing a frontier of billions of URLs with per-host politeness constraints, distributed fetching across thousands of workers with DNS resolution caching, multi-level deduplication (URL normalization + content fingerprinting + near-duplicate detection via SimHash), spider trap detection, adaptive recrawl scheduling based on page change frequency, and the fundamental tension between coverage, freshness, and politeness makes this one of the most architecturally demanding distributed systems.

## Quick Links

| # | Section | Description |
|---|---------|-------------|
| 01 | [Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning, SLOs |
| 02 | [High-Level Design](./02-high-level-design.md) | Architecture diagrams, data flow, key decisions |
| 03 | [Low-Level Design](./03-low-level-design.md) | Data model, API design, core algorithms (Step-by-step plan in plain English) |
| 04 | [Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | URL Frontier, politeness engine, deduplication, spider traps |
| 05 | [Scalability & Reliability](./05-scalability-and-reliability.md) | Scaling fetchers, frontier partitioning, disaster recovery |
| 06 | [Security & Compliance](./06-security-and-compliance.md) | Robots.txt, content safety, crawler abuse prevention |
| 07 | [Observability](./07-observability.md) | Crawl metrics, freshness dashboards, alerting |
| 08 | [Interview Guide](./08-interview-guide.md) | 45-min pacing, trap questions, trade-off frameworks |
| 09 | [Insights](./09-insights.md) | Key architectural insights and non-obvious lessons |

## Technology Landscape

| Layer | Representative Tools | Role |
|-------|---------------------|------|
| URL Frontier | Custom (Mercator-style), distributed queues | Priority scheduling, politeness enforcement, URL deduplication |
| Distributed Fetching | Custom HTTP clients, headless browsers | Page download with connection pooling, redirect following, rendering |
| Content Processing | Custom parsers, link extractors | HTML parsing, link extraction, content fingerprinting |
| Deduplication | Bloom filters, SimHash/MinHash | URL-level and content-level duplicate detection |
| DNS Resolution | Local caching resolvers | High-throughput DNS lookup with TTL-aware caching |
| Storage | Distributed file systems, columnar stores | Raw page storage, URL metadata, crawl history |
| Coordination | ZooKeeper, etcd | Worker assignment, partition management, leader election |

## Key Web Crawler Concepts Referenced

- **URL Frontier** — A data structure combining priority queues (front queues) for importance-based scheduling with per-host queues (back queues) for politeness enforcement
- **Politeness Policy** — Rules governing how frequently and aggressively the crawler fetches from a single host, derived from robots.txt directives and adaptive rate limiting
- **Crawl Budget** — The finite resources (bandwidth, time, storage) allocated to crawling, requiring careful prioritization of which URLs to fetch
- **Content Fingerprinting** — Techniques (MD5/SHA for exact duplicates, SimHash for near-duplicates) to detect pages with identical or substantially similar content
- **Spider Trap** — A set of URLs that cause the crawler to generate infinite requests (calendar pages, session IDs in URLs, infinitely deep directory structures)
- **Recrawl Scheduling** — Algorithms that determine when to revisit previously crawled pages based on their historical change frequency and importance
- **URL Normalization** — Canonicalization rules that reduce syntactically different URLs to a single canonical form (lowercasing, removing fragments, resolving relative paths)
- **Mercator Architecture** — The seminal web crawler design from Compaq/DEC that introduced the front-queue/back-queue frontier architecture

---

## Core Architectural Challenges

| Challenge | Why It's Hard | Where Addressed |
|-----------|--------------|-----------------|
| Coverage vs. freshness vs. politeness triangle | Fixed crawl budget forces zero-sum allocation between discovering new pages, recrawling known pages, and respecting host rate limits | 01, 04, 09 |
| Frontier as a two-dimensional scheduler | Must simultaneously schedule by priority (what to crawl) and by politeness (when to crawl it) — two orthogonal dimensions in a single data structure | 02, 03, 04 |
| Bloom filter false positives at 10B scale | 1% FPR means 100M genuine URLs incorrectly rejected; systematic blind spots possible | 03, 04, 09 |
| DNS as a hidden Slowest part of the process | Every fetch requires DNS; 5% cache miss rate at 11.5K QPS generates 575 upstream queries/sec | 03, 05, 09 |
| Spider trap vs. legitimate large site | Both produce millions of URLs; distinguishing requires content uniqueness analysis | 04, 09 |
| robots.txt 5xx ambiguity | Server error on robots.txt forces choice between lost coverage (assume disallow) or compliance risk (assume allow) | 04, 06, 09 |
| Shared hosting IP rate limiting | Multiple hosts on same IP share a rate limit; per-host politeness is insufficient | 03, 04 |
| Multi-region fetcher coordination | Fetchers distributed globally; frontier centralized; cross-region latency affects dequeue performance | 05 |

---

## Emerging Trends (2025-2026)

| Trend | Impact on Architecture |
|-------|----------------------|
| AI training opt-out standards (ai.txt, GPTBot, TDM headers) | Crawler must distinguish downstream use cases (search vs. AI training); enforce per-use publisher preferences |
| JavaScript-heavy SPAs as majority of web | Rendering farm becomes essential, not optional; 10-50x cost increase per rendered page vs. static HTML |
| EU AI Act training data documentation | Crawl provenance logging becomes mandatory; must track every page's source, timestamp, and opt-out status |
| Web3/decentralized content (IPFS, Arweave) | New content addressing schemes; content may not have traditional hostnames or URLs |
| Synthetic content proliferation | AI-generated pages at scale; content quality detection needed to avoid indexing SEO spam farms |
| Anti-bot sophistication | Browser fingerprinting, ML-based bot detection; simple HTTP requests increasingly blocked by major sites |

---

## Related Patterns

| Pattern | Relationship | Topic |
|---------|-------------|-------|
| Bloom Filter | URL deduplication at scale with probabilistic guarantees | Core to frontier design |
| SimHash / LSH | Near-duplicate content detection across billions of pages | 16.3 Text Search Engine |
| Consistent Hashing | Frontier partition assignment for host-based sharding | 1.x Distributed Systems |
| Circuit Breaker | Per-host error isolation to prevent cascade failure | Reliability pattern |
| Back-Pressure | Flow control from downstream (content store) to upstream (fetchers) | Distributed Systems pattern |
| Multi-Armed Bandit | Recrawl scheduling as exploration-exploitation trade-off | ML/Optimization pattern |
| Content-Addressed Storage | Idempotent page storage using content hash as key | Storage pattern |

---

## What Differentiates Naive vs. Production

| Dimension | Naive Approach | Production Reality |
|-----------|---------------|-------------------|
| **Frontier** | Simple FIFO (First-In-First-Out, like a line at a store) queue | Mercator two-queue architecture with priority-based front queues, per-host back queues, and min-heap scheduling |
| **Deduplication** | URL string comparison | Three-level dedup: URL normalization → Bloom filter → content hash → SimHash near-duplicate detection |
| **Politeness** | Global rate limit | Per-host rate limiting from robots.txt + adaptive delay based on response time and error rate + IP-based throttling for shared hosting |
| **Recrawl** | Fixed interval for all pages | Adaptive scheduling with exponential backoff/speedup based on observed change frequency, weighted by page importance |
| **DNS** | System DNS resolver | Multi-tier caching (per-worker, per-region) with TTL management, pre-resolution for queued URLs, and fallback to backup resolvers |
| **Spider traps** | No detection | Multi-signal detection: URL depth, repeating segments, URL length, content uniqueness ratio, parameter explosion |
| **Storage** | All pages in one database | Content-addressed object storage for pages; wide-column store for URL metadata; tiered retention policies |
| **Failure handling** | Crash and restart | Lease-based URL checkout, frontier standby failover, per-host circuit breakers, graceful degradation across all components |

---

## When to Choose This Architecture

| Scenario | Recommendation |
|----------|---------------|
| General web search engine (>1B pages/day) | Full architecture as described — no shortcuts |
| Focused domain crawler (10K-1M pages) | Simplified: single-machine frontier, no SimHash, basic politeness |
| Price monitoring / competitive intelligence | Focused crawler with rendering farm; site-specific extractors; tight freshness SLOs |
| Research / academic crawling | Full architecture with emphasis on coverage over freshness; longer recrawl intervals |
| Compliance / regulatory crawling | Focused crawler with audit trail; emphasis on completeness over efficiency |
| < 10,000 pages, single domain | Over-engineered — use an open-source crawler or commercial service |

---

## System Characteristics Summary

| Metric | Value |
|--------|-------|
| **Data volume** | 50 TB/day ingest; 18 PB/year storage |
| **Throughput** | 11,500 pages/sec average; 25,000 pages/sec peak |
| **Latency (end-to-end fetch)** | ~290ms p50; ~3s p99 (warm path) |
| **Known URLs** | 10 billion |
| **Active hosts** | 500 million |
| **Frontier partitions** | 256 |
| **Fetcher workers** | 5,000 across 4 regions |
| **Concurrent TCP connections** | ~1 million |
| **Bloom filter memory** | 12 GB (1% FPR at 10B URLs) |
| **Estimated monthly cost** | ~$715K |
