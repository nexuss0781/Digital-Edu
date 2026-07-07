# Interview Guide — Web Crawlers

## Interview Pacing (45-min format)

| Time | Phase | Focus |
|------|-------|-------|
| 0-5 min | Clarify | Scope: scale (how many pages/day?), coverage vs. freshness priority, robots.txt compliance, content types (HTML only or also JS-rendered?), single vs. multi-datacenter |
| 5-15 min | High-Level | Crawl pipeline (frontier → fetcher → parser → dedup → store), URL frontier concept (front queues + back queues), feedback loop (discovered URLs → frontier) |
| 15-30 min | Deep Dive | Pick 1-2: URL frontier architecture (Mercator), politeness engine, content deduplication (Bloom + SimHash), or spider trap detection |
| 30-40 min | Scale & Trade-offs | Frontier partitioning, distributed fetcher fleet, coverage vs. freshness trade-off, DNS Slowest part of the process, Bloom filter sizing |
| 40-45 min | Wrap Up | Summarize key design decisions, acknowledge trade-offs, mention observability and compliance |

---

## Meta-Commentary

### What Makes This System Unique/Challenging

1. **Politeness is a hard constraint, not a soft guideline:** Unlike most systems where the goal is to maximize throughput, a web crawler must deliberately throttle itself. You cannot make a single host faster by adding more fetchers — the per-host rate limit is inviolable. This inverts the normal scaling paradigm: adding more hardware enables crawling more hosts in parallel, not crawling individual hosts faster. Candidates who propose "just add more machines" without understanding the per-host Slowest part of the process have missed the fundamental constraint.

2. **The frontier is the most interesting data structure in the system:** The URL frontier is not a simple queue — it is simultaneously a priority queue (scheduling by importance), a rate limiter (per-host politeness), and a deduplication filter (Bloom filter). The Mercator two-queue architecture (front queues for priority + back queues for politeness) is the canonical solution. Candidates who describe the frontier as "just a queue" are missing the core design challenge.

3. **Deduplication operates at three levels, each with different accuracy-cost trade-offs:** URL normalization (cheap, catches ~60% of dupes), exact content hashing (moderate, catches ~30% more), and near-duplicate detection via SimHash (expensive, catches the remaining ~10%). Each level has failure modes that the next level catches. Mentioning all three demonstrates depth.

4. **The web is adversarial:** Spider traps, cloaking (serving different content to crawlers vs. browsers), redirect bombs, and deliberate attempt to exhaust crawl budget are all real. The crawler must be defensive without being paranoid — blocking too aggressively means losing coverage.

5. **Coverage, freshness, and politeness form an impossible triangle:** You cannot maximize all three simultaneously. More coverage means less time for recrawling (worse freshness). More frequent recrawling means less time for new discovery (worse coverage). And politeness constrains both. Demonstrating awareness of this trade-off triangle is a strong signal.

### Where to Spend Most Time

- **Deep Dive (15-30 min):** The URL frontier (Mercator architecture) and politeness engine are the two most interview-differentiating components. The frontier demonstrates knowledge of priority scheduling, per-host rate limiting, and the front-queue/back-queue pattern. The politeness engine shows awareness of robots.txt, adaptive rate limiting, and the coverage-freshness-politeness trade-off.

- **Don't spend time on:** HTML parsing implementation details, specific HTTP client configurations, content rendering (headless browsers), or search ranking algorithms. These are downstream concerns that don't differentiate a web crawler design.

---

## Trade-offs Discussion

### Trade-off 1: Breadth-First vs. Best-First Crawling

| Decision | Breadth-First | Best-First (Chosen) |
|----------|---------------|---------------------|
| | **Pros:** Simple implementation; discovers all pages at each depth before going deeper; good for comprehensive coverage | **Pros:** Prioritizes high-value pages; maximizes value of limited crawl budget; adapts to page importance |
| | **Cons:** Treats all pages as equally important; wastes budget on low-value pages; no notion of page importance | **Cons:** Requires importance signals (may be inaccurate); can miss valuable deep pages if importance heuristics are wrong; more complex frontier |
| **Recommendation** | Best-first with priority queues in the frontier; bias toward high-importance pages but never completely starve low-priority discovery |

### Trade-off 2: In-Memory Frontier vs. Disk-Backed Frontier

| Decision | In-Memory Frontier | Disk-Backed Frontier (Chosen) |
|----------|-------------------|-------------------------------|
| | **Pros:** Extremely fast dequeue (sub-millisecond); simple implementation | **Pros:** Handles billions of URLs; survives process restarts; bounded memory |
| | **Cons:** Cannot hold billions of URLs (>100 GB at 10B URLs); lost on crash; expensive memory cost | **Cons:** Disk I/O adds latency (~5-50ms per operation); more complex with hot/cold partitioning |
| **Recommendation** | Hybrid: hot front of queues in memory (~100M URLs), cold tail on disk; dequeue operates from memory; background process refills memory from disk |

### Trade-off 3: Aggressive Deduplication vs. Loose Deduplication

| Decision | Aggressive (Bloom + SimHash + URL normalization) (Chosen) | Loose (URL normalization only) |
|----------|----------------------------------------------------------|-------------------------------|
| | **Pros:** Minimizes wasted bandwidth; reduces storage costs; improves crawl efficiency | **Pros:** Simple; fast; no false positives from Bloom filter |
| | **Cons:** SimHash adds processing overhead per page; Bloom filter false positives cause missed URLs (~1%); three-stage pipeline is complex | **Cons:** 30-40% of fetches are duplicate content from different URLs; massive storage waste |
| **Recommendation** | Aggressive dedup — at 1B pages/day, even 10% duplicate reduction saves 5 TB/day of bandwidth and storage |

### Trade-off 4: Centralized URL Database vs. Embedded Frontier State

| Decision | Centralized URL DB (Chosen) | Frontier-Embedded State |
|----------|----------------------------|------------------------|
| | **Pros:** Global view of all URLs; supports complex queries (freshness analytics, coverage reports); single source of truth | **Pros:** No external dependency; faster (no network roundtrip); simpler deployment |
| | **Cons:** Database becomes a Slowest part of the process at high write rates; adds latency to enqueue/dequeue path | **Cons:** No global visibility; hard to compute coverage/freshness metrics; frontier partition loss = data loss |
| **Recommendation** | Centralized URL DB for metadata and analytics, with frontier partitions maintaining their own local queues for fast dequeue; async sync between frontier and DB |

### Trade-off 5: Fixed Recrawl Interval vs. Adaptive Recrawl

| Decision | Fixed Interval | Adaptive (Chosen) |
|----------|---------------|-------------------|
| | **Pros:** Simple; predictable resource usage; easy to reason about coverage | **Pros:** Allocates recrawl budget to pages that actually change; avoids wasting bandwidth on static pages |
| | **Cons:** Wastes bandwidth recrawling pages that never change; misses rapidly-changing pages between intervals | **Cons:** Requires historical change data (cold-start problem for new pages); change frequency estimation can be wrong |
| **Recommendation** | Adaptive with exponential backoff/speedup; newly discovered pages get an aggressive initial interval (e.g., 24h) which adapts based on observed changes |

---

## Trap Questions & How to Handle

| Trap Question | What Interviewer Wants | Best Answer |
|---------------|------------------------|-------------|
| "Why not just use a simple FIFO (First-In-First-Out, like a line at a store) queue for the frontier?" | Understand priority + politeness separation | "A FIFO (First-In-First-Out, like a line at a store) queue ignores two critical dimensions: page importance (a news homepage should be crawled before a 10-year-old blog post) and per-host politeness (consecutive URLs from the same host would violate rate limits). The Mercator two-queue architecture separates priority (front queues) from politeness (back queues), solving both problems." |
| "How do you handle a host that returns 5xx for robots.txt?" | Test defensive design thinking | "Conservative approach: assume all URLs are disallowed until we can successfully fetch robots.txt. Retry with exponential backoff. If the host is consistently returning 5xx, it's likely having issues — our politeness policy should avoid adding load to a struggling host anyway." |
| "What if you discover a new URL that's on a host you've never seen?" | Test understanding of the cold-start problem | "The host needs a robots.txt fetch before any page can be crawled. We enqueue the URL, trigger a robots.txt pre-fetch for the new host, and the URL waits in the back queue until robots.txt is resolved. For host importance signals (PageRank, authority), we use defaults until data accumulates." |
| "Why not just use a distributed hash table for URL dedup instead of Bloom filters?" | Understand probabilistic vs. exact trade-offs at scale | "A DHT gives exact answers but requires network roundtrips per lookup (10B URLs x 11,500 checks/sec = massive network load). A Bloom filter gives probabilistic answers with 1% false positives but operates in-memory at sub-millisecond latency. The false positives cost us ~1% of potential new URLs — a tiny price for avoiding network-dependent dedup." |
| "What happens at 100x your current scale?" | Forward-thinking architectural changes | "At 100B pages, the primary changes are: (1) frontier partitions increase from 256 to ~2,500, (2) Bloom filter grows to ~120 GB (needs distributed approach), (3) content store grows to ~1.8 EB/year (requires aggressive retention policies and compression), (4) fetcher fleet grows to ~50,000 workers across more data centers. The architecture (partitioned frontier, distributed fetchers, multi-level dedup) scales linearly — no fundamental redesign needed." |
| "Can you just crawl the entire web and be done?" | Test understanding of web dynamism | "The web changes continuously. About 30-40% of pages change within a week. 'Being done' is impossible — the crawl is perpetual. The real challenge is recrawl scheduling: deciding which pages to revisit and how often, given finite bandwidth." |

---

## Common Mistakes to Avoid

1. **Treating the frontier as a simple queue** — The frontier is the most complex component; failing to discuss priority scheduling and per-host politeness is a major miss
2. **Ignoring politeness entirely** — Proposing to "fetch as fast as possible" shows a lack of real-world understanding; politeness is the defining constraint
3. **Forgetting about DNS** — At web scale, DNS resolution is a serious Slowest part of the process; not mentioning DNS caching suggests inexperience with distributed systems
4. **Only discussing URL-level dedup** — Content-level dedup (exact hash + SimHash) catches a large percentage of duplicates that URL normalization misses
5. **Proposing a single-machine design** — Even as a starting point, a single-machine crawler cannot handle web-scale requirements; start distributed
6. **Not discussing the coverage-freshness trade-off** — This is the central resource allocation question; ignoring it means ignoring the system's primary optimization problem
7. **Over-engineering the parsing/indexing pipeline** — The interviewer asked about the crawler, not the search engine; stay focused on fetching and scheduling
8. **Ignoring failure modes** — What happens when a fetcher crashes mid-crawl? When a frontier partition fails? When DNS resolvers go down?

---

## Questions to Ask Interviewer

| Question | Why It Matters |
|----------|---------------|
| What's the target scale — millions or billions of pages per day? | Determines whether frontier fits in memory or needs disk-backed design |
| Do we need to handle JavaScript-rendered pages? | Adds a headless browser rendering farm (significant complexity) |
| What's the priority — coverage (new pages) or freshness (recrawling)? | Determines frontier priority allocation strategy |
| Are we crawling the open web or a specific set of domains? | Domain-specific crawlers have simpler politeness and discovery |
| What consistency guarantees does the downstream indexer need? | Determines whether content store needs strong consistency or eventual is fine |
| Is there an existing search index we're refreshing, or building from scratch? | Cold start (no priority signals) vs. warm start (PageRank data available) |
| How important is geographical distribution of fetchers? | Determines whether we need multi-region fetcher deployment |
| What's the budget constraint — bandwidth, storage, or compute? | Helps prioritize optimization efforts |

---

## Scoring Rubric

### What Interviewers Are Testing

| Signal | What Strong Candidates Demonstrate | What Weak Candidates Do |
|--------|-----------------------------------|------------------------|
| **Frontier design** | Describe Mercator two-queue architecture; explain why front/back queue separation is necessary; discuss priority vs. politeness as orthogonal dimensions | Propose a single FIFO (First-In-First-Out, like a line at a store) queue or priority queue without addressing politeness |
| **Politeness understanding** | Explain that adding machines does not make per-host crawling faster; discuss robots.txt compliance as a hard constraint; mention adaptive backoff | Ignore politeness entirely or treat it as optional |
| **Deduplication depth** | Describe all three levels (URL normalization, exact hash, SimHash); discuss false positive rates and trade-offs; mention Bloom filter sizing | Only mention URL-level dedup; miss content-level deduplication |
| **Scale awareness** | Quantify: 10B URLs, 1B pages/day, 11.5K pages/sec, 50 TB/day bandwidth; reason about frontier partitioning and Bloom filter memory | Vague about scale; cannot do back-of-envelope math |
| **Trade-off articulation** | Explicitly identify the coverage-freshness-politeness triangle; discuss how crawl budget is allocated | Ignore trade-offs; propose maximizing everything simultaneously |
| **Failure mode reasoning** | Discuss fetcher failure, frontier partition loss, DNS outage, spider traps; explain recovery mechanisms | Only discuss the happy path |
| **DNS awareness** | Identify DNS as a Slowest part of the process; mention caching strategy, TTL management, pre-resolution | Forget about DNS entirely |

### Scoring Levels

| Level | Description | Key Indicators |
|-------|-------------|----------------|
| **L3 (Junior)** | Basic pipeline understanding | Describes fetch → parse → store flow; mentions robots.txt; proposes a simple queue |
| **L4 (Mid)** | Working knowledge | Mercator frontier; Bloom filter for dedup; politeness as constraint; back-of-envelope math |
| **L5 (Senior)** | Production depth | Three-level dedup with SimHash; adaptive recrawl scheduling; frontier partitioning with consistent hashing; DNS caching strategy; failure modes and recovery |
| **L6+ (Staff)** | Architectural mastery | Coverage-freshness-politeness trade-off analysis; crawl budget allocation as optimization problem; multi-region deployment; connection pool management; IP-based throttling for shared hosting; content-addressed storage insight |

---

## Additional Trap Questions

| Trap Question | What Interviewer Wants | Best Answer |
|---------------|------------------------|-------------|
| "Why not use MapReduce for URL deduplication?" | Test understanding of real-time vs. batch trade-offs | "MapReduce is batch-oriented — it processes a complete dataset and produces a result. URL dedup must happen at enqueue time (real-time, in the critical path). A Bloom filter provides sub-millisecond in-memory lookups, while MapReduce would add minutes to hours of latency. MapReduce could be used for periodic Bloom filter reconstruction, but not for real-time dedup." |
| "What if a country blocks your crawler's IP range?" | Test awareness of geographic and political constraints | "Geographic IP blocking is a real operational challenge. Mitigation: deploy fetcher workers in multiple countries; route crawl requests through the fetcher region closest to the target; if a country blocks our primary IP range, fall back to fetcher workers in adjacent regions. For compliance with country-specific blocking, respect the intent — if a country blocks our crawler, treat it as a legal constraint, not a technical problem to route around." |
| "How do you handle a site that changes its content based on User-Agent?" | Test understanding of cloaking | "This is 'cloaking' — serving different content to crawlers vs. browsers. Detection: periodically fetch the same URL with a browser User-Agent and a crawler User-Agent; compare content hashes. If they differ significantly, the site is cloaking. Response: flag the site for quality review; the content served to crawlers may be SEO spam while the real content is behind JavaScript rendering. For known cloaking sites, consider using a headless browser for fetching." |

---

## Discussion Talking Points

### 1. When NOT to Build a Custom Crawler

**Context for interviewer:** Tests whether the candidate understands that a custom web-scale crawler is one of the most expensive systems to build and maintain.

**Expected response:** "A custom crawler only makes sense at search engine scale (billions of pages). For domain-specific crawling (10K-1M pages), open-source frameworks are sufficient. For monitoring a few hundred competitors' websites, a commercial service is cheaper. The decision should be driven by scale, customization needs, and the team's operational capacity to run a distributed system 24/7."

### 2. The Rendering Problem

**Context for interviewer:** Over 60% of the modern web relies on JavaScript rendering. Tests whether the candidate has thought about the boundary between crawling and rendering.

**Expected response:** "The base crawler should focus on fetching static HTML efficiently. JavaScript-rendered pages require a separate rendering pipeline: a pool of headless browser instances that receive fetched pages, execute JavaScript, wait for DOM stabilization, and return the rendered HTML back to the parsing pipeline. This is 10-50x more expensive per page than static fetching (3-5 seconds vs. 200ms), so it should only be applied to pages that are detected as JS-dependent (empty or minimal DOM in the static HTML)."

### 3. Crawling in the Age of AI

**Context for interviewer:** A 2025-relevant topic. Tests whether the candidate is aware of the changing relationship between web publishers and crawlers.

**Expected response:** "The AI training boom has created a new tension: publishers want their content indexed for search (which drives traffic to them) but may not want it used for AI model training (which does not). New standards like `ai.txt`, AI-specific robots.txt user agents (`GPTBot`, `CCBot`), and EU TDM reservation headers allow publishers to express these preferences. A production crawler must distinguish between its different downstream uses (search indexing vs. AI training) and enforce publisher preferences per use case."

---

## 15-Minute Speed Round Format

For time-constrained interviews or follow-up rounds:

| # | Question | Expected Time | Key Signal |
|---|----------|--------------|------------|
| 1 | "Sketch the high-level architecture of a web crawler" | 3 min | Pipeline: frontier → fetcher → parser → dedup → store → feedback loop |
| 2 | "How does the URL frontier work?" | 3 min | Mercator two-queue architecture; front queues (priority) + back queues (politeness) |
| 3 | "How do you handle deduplication at 10B URLs?" | 3 min | Bloom filter sizing; 12 GB for 1% FPR; content-level dedup with SimHash |
| 4 | "What happens when 50% of your fetcher workers crash?" | 3 min | Leased URLs re-enqueued after timeout; auto-scaler launches replacements; graceful degradation |
| 5 | "How do you decide when to recrawl a page?" | 3 min | Adaptive scheduling based on observed change frequency; exploration-exploitation trade-off |

---

## Red Flags Table

| Red Flag | Why It's Concerning | Better Answer |
|----------|--------------------|----|
| "We can just increase the crawl rate to improve freshness" | Ignores politeness constraint — per-host rate is fixed | "We can improve freshness by optimizing recrawl scheduling to prioritize pages that actually change frequently" |
| "Use a relational database for the frontier" | Does not scale to billions of URLs; frontier needs specialized priority/politeness semantics | "The frontier is a custom data structure combining priority queues with per-host rate limiting" |
| "Dedup is solved by normalizing URLs" | Misses that 30-40% of duplicate content has distinct URLs | "URL normalization catches ~60%; content hashing catches ~30% more; SimHash catches the remaining ~10%" |
| "Store all pages in a single database" | Ignores petabyte-scale storage requirements | "Content in object storage (cheap, scalable); metadata in a wide-column store (queryable)" |
| "Use consistent hashing for URL assignment to fetchers" | Conflates frontier partitioning (by host) with fetcher assignment (by geography) | "Consistent hashing partitions the frontier by host; fetchers are assigned to partitions by geographic proximity" |
| "We don't need DNS caching — DNS is fast" | Ignores that DNS is in the critical path of every fetch; 5% miss rate × 11.5K QPS = 575 upstream queries/sec | "DNS caching is critical — a 95% hit rate still means hundreds of upstream queries per second" |
| "Just download everything and sort it out later" | Ignores robots.txt compliance, politeness, and budget constraints | "The crawler must be selective — politeness and budget constraints make prioritization essential" |

---

## Deep Dive Prompts (for Senior/Staff Candidates)

### Prompt 1: Frontier Partition Rebalancing

**Question:** "We need to add 64 new frontier partitions to our existing 256. How do we redistribute hosts without losing coverage or violating politeness?"

**What a strong answer covers:**
- Consistent hashing with virtual nodes minimizes host movement (~20% of hosts move to new partitions)
- Two-phase migration: (1) freeze affected hosts (no new fetches), (2) migrate queue state and Bloom filter entries, (3) unfreeze on new partition
- During migration, in-flight URLs (already leased to fetchers) complete on the old partition; new dequeues route to the new partition
- Bloom filter entries for migrated hosts must be inserted into the new partition's filter — but cannot be removed from the old partition's filter (Bloom filters don't support deletion); old partition's filter has elevated false positive rate until next rebuild
- Total migration downtime per host: <10 minutes; no global crawl pause required

### Prompt 2: Handling a Massive Domain

**Question:** "Wikipedia has 60+ million pages across 300+ language editions. How does the crawler handle this single domain without starving the rest of the web?"

**What a strong answer covers:**
- Wikipedia's robots.txt allows crawling with a reasonable delay; but 60M pages at 1 req/s = ~700 days to crawl everything once
- Multi-subdomain treatment: each language edition (`en.wikipedia.org`, `fr.wikipedia.org`) has its own back queue — enabling parallel crawling across editions
- Priority stratification within Wikipedia: featured articles and recent edits get highest priority; deep talk pages and user pages get lowest
- Dedicated recrawl pool: Wikipedia articles change frequently (edit frequency data is publicly available via API); use edit frequency as a direct recrawl signal
- URL budget: 60M URLs is within the legitimate large site range; trap detector must have Wikipedia on its allowlist
- Content dedup: different Wikipedia language editions often share images and templates; SimHash catches cross-edition content overlap

### Prompt 3: Designing the Crawl Budget Allocator

**Question:** "You have exactly 1 billion fetches per day. Design the system that decides how to allocate those fetches across recrawling existing pages and discovering new ones."

**What a strong answer covers:**
- Frame as a constrained optimization problem: maximize aggregate freshness (weighted by page importance) plus coverage (new unique pages discovered) subject to budget constraint (1B fetches) and politeness constraints (per-host rate limits)
- Practical allocation: 60% recrawls (600M), 35% new discovery (350M), 5% overhead (robots.txt, sitemaps, DNS)
- Within recrawls: tier by importance — top 1M at 4-hour intervals (~6M fetches/day), next 100M at 7-day intervals (~14M fetches/day), remaining at 30-day intervals (~580M fetches/day)
- Dynamic adjustment: if discovery rate is high (many new URLs found per fetch), shift allocation toward discovery; if recrawl change rate drops (pages aren't changing), shift toward discovery
- Feedback loop: measure recrawl "ROI" (fraction of recrawls that found changed content) and discovery "ROI" (fraction of discoveries that yielded unique, high-quality content); optimize allocation to maximize aggregate ROI

---

## Interviewer Preparation Notes

### Setting Up the Problem

**Opening statement for the candidate:** "Design a web crawler that fetches 1 billion pages per day from the public web. Focus on the crawl infrastructure — how URLs are scheduled, fetched, and deduplicated — not on search ranking or indexing."

**Key scope decisions to establish early:**
- Scale: 10 billion known URLs; 1 billion fetches per day
- Content types: HTML only (no JS rendering — acknowledge it as a separate concern)
- Multi-datacenter: yes (fetchers distributed globally)
- robots.txt: hard requirement (no exceptions)

### What to Push On

| Candidate Level | Where to Push | What You're Looking For |
|-----------------|--------------|------------------------|
| L3-L4 | "How does your queue ensure politeness?" | The frontier is not a simple queue; per-host scheduling is essential |
| L4-L5 | "What happens when the Bloom filter has a 5% false positive rate?" | Understanding that false positives mean lost coverage, not just wasted work |
| L5-L6 | "How do you decide which pages to recrawl vs. discover new ones?" | Trade-off analysis; budget allocation as optimization problem |
| L6+ | "What does your monitoring tell you about crawl quality?" | Freshness heatmaps; recrawl ROI; coverage gaps; crawl budget accounting |

---

## Candidate Self-Assessment Checklist

Use this checklist to evaluate readiness for a web crawler system design interview:

| Concept | Can You Explain? | Can You Draw It? | Can You Quantify It? |
|---------|-----------------|------------------|---------------------|
| Mercator frontier architecture | Front queues + back queues + biased selector | Architecture diagram with data flow | Queue sizes, heap operations complexity |
| Bloom filter for URL dedup | Probabilistic membership test; false positives | Bit array with hash functions | 12 GB for 10B URLs at 1% FPR; 7 hash functions |
| SimHash for near-duplicate detection | Locality-sensitive hashing; Hamming distance | Fingerprint computation flow | 64-bit fingerprints; threshold of 3 bits |
| Politeness enforcement | Per-host rate limiting; robots.txt; adaptive delay | Back queue heap with timing | 1 req/sec per host; 500M hosts × 2s avg delay |
| Recrawl scheduling | Adaptive intervals; exploration-exploitation | Scheduling decision tree | 1B daily budget allocation: 60% recrawl, 35% discovery |
| DNS caching strategy | Multi-tier cache; TTL management; pre-resolution | Cache hierarchy diagram | 95% hit rate; 575 upstream QPS at 5% miss |
| Spider trap detection | Multi-signal scoring; content uniqueness | Detection pipeline | URL depth limits; uniqueness ratio thresholds |
| Content-addressed storage | Hash as key; idempotent writes; natural dedup | Storage architecture | 50 TB/day; 18 PB/year |
| Frontier partitioning | Consistent hashing by host; independent partitions | Partition assignment diagram | 256 partitions; ~2M hosts each |
| Coverage-freshness trade-off | Zero-sum budget allocation; impossible triangle | Trade-off analysis framework | Top-1M at 4h; all pages at 30d; 1B daily budget |
