# Key Insights: Content Delivery Network (CDN)

[← Back to Index](./00-index.md)

---

## Insight 1: Surrogate Keys Transform Cache Invalidation from O(n) URL Scanning to O(1) Tag Lookup

**Category:** Data Structures
**One-liner:** Instead of purging individual URLs or scanning the entire cache with wildcard patterns, surrogate keys maintain an inverted index mapping tags to cache entries, enabling instant group invalidation.
**Why it matters:** URL-based purge requires knowing every affected URL. Wildcard purge requires scanning all cache entries with regex matching -- an O(n) operation that can take seconds on a PoP with millions of cached objects. Surrogate key purge (Fastly's innovation) attaches tags to responses at origin (e.g., "product-123"), and each edge node maintains an inverted index from tag to cache keys. Purging "product-123" instantly resolves to the 50 cached variants (different sizes, formats, languages) without any scanning. The overhead is maintaining the inverted index in memory, but this is negligible compared to the operational benefit of being able to atomically invalidate all content related to a single entity.

---

## Insight 2: Request Collapsing at Origin Shield Converts N Concurrent Cache Misses into 1 Origin Request

**Category:** Contention
**One-liner:** When a popular URL expires across 200 edge PoPs simultaneously, the origin shield collapses all concurrent fetches into a single origin request and fans the response out to all waiters.
**Why it matters:** Without request collapsing, a TTL expiration on viral content generates 200+ simultaneous origin requests (one per PoP), creating a thundering herd that can overwhelm the origin. The origin shield maintains a map of in-flight fetch keys; the first request for a key initiates the origin fetch, and subsequent requests for the same key are added to a waiters list. When the origin responds, the shield stores the response in cache and notifies all waiters in parallel. This pattern reduces origin load from O(PoP count) to O(1) per unique URL per TTL cycle. The coalescing window (how long to wait for additional requests before fetching) creates a latency-vs-efficiency tradeoff -- a 5-second window during overload dramatically reduces origin traffic at the cost of added latency for the first requester's waiters.

---

## Insight 3: Anycast BGP Routing Provides Automatic Failover but Breaks TCP Session Persistence

**Category:** Edge Computing
**One-liner:** All PoPs announcing the same IP address via BGP gives users the topologically closest server and automatic failover on PoP failure, but BGP reconvergence can route mid-connection TCP packets to a different PoP.
**Why it matters:** Anycast is elegant: no DNS TTL delays, no client-side logic, and natural DDoS absorption (attack traffic distributes across all PoPs). However, BGP convergence takes 10-90 seconds, and during convergence, subsequent packets in a TCP connection may route to a different PoP that has no state for that connection. For stateless content serving (HTTP GET with no session), this is acceptable -- the client retries and reaches the new PoP. For stateful connections (WebSocket, HTTP/2 with multiple streams), this causes connection drops. The mitigation is proactive health-based BGP withdrawal: monitoring PoP health and withdrawing routes before failure (within 1 second), giving BGP time to converge before the PoP actually goes down.

---

## Insight 4: Soft Purge (Stale-While-Revalidate) Eliminates Purge-Induced Cache Misses

**Category:** Caching
**One-liner:** Marking content as stale instead of deleting it means the next request serves the stale version instantly while asynchronously revalidating with origin, avoiding any cache-miss latency spike.
**Why it matters:** Hard purge (delete from cache) means the next request for that content is a guaranteed cache miss, hitting the origin. At scale, purging popular content creates a latency spike for the first visitor after purge. Soft purge marks the entry as stale but keeps it in cache. The next request serves the stale content immediately (zero latency impact to the user) and triggers an asynchronous revalidation with origin. If the origin confirms the content hasn't changed (304 Not Modified), the cache entry is refreshed with minimal network transfer. This pattern -- combined with stale-if-error (serve stale when origin is unreachable) -- means the CDN can maintain availability even during origin outages, trading freshness for availability in a controlled way.

---

## Insight 5: Live Streaming Manifests Require Different TTLs Than Segments

**Category:** Caching
**One-liner:** HLS manifests (.m3u8) need 2-10 second TTLs to advertise new segments promptly, while segments (.ts) are immutable and can be cached for 24+ hours -- conflating the two causes either stale playlists or cache thrashing.
**Why it matters:** Live streaming creates a two-part caching problem. The manifest file is a dynamic list that updates every few seconds as new segments are encoded, so it needs very short TTLs. But each segment referenced by the manifest is an immutable chunk of video that never changes once created. Caching both with the same TTL either makes segments expire unnecessarily (wasting bandwidth re-fetching identical content) or keeps manifests stale (viewers don't see new segments, causing buffering). The CDN must treat these as fundamentally different content types with different caching policies, and the "first viewer triggers cache fill" pattern for new segments means there is an inherent cold-start latency for the very first viewer of each new segment at each PoP.

---

## Insight 6: Regional Fanout with Persistent Connections Achieves Sub-200ms Global Purge

**Category:** Edge Computing
**One-liner:** Fastly's ~150ms global purge works by maintaining persistent WebSocket connections from all PoPs to 5 regional hubs, enabling fire-and-forget broadcast without connection setup delay.
**Why it matters:** Purging content across 200+ globally distributed PoPs within 200ms requires solving three problems: connection latency (eliminated by persistent WebSockets), fanout latency (reduced by 5 regional hubs that fan out in parallel within their region), and acknowledgment latency (solved by async fire-and-forget with background confirmation). The 95% completion threshold (consider purge successful when 95% of PoPs acknowledge) handles the long tail of slow or temporarily unreachable nodes. For PoPs that are unreachable during purge (network partition), a durable queue stores pending purge events that are replayed on reconnection, ensuring eventual consistency of cache state.

---

## Insight 7: BGP MED-Based Traffic Steering Enables Graceful PoP Degradation Under Load

**Category:** Traffic Shaping
**One-liner:** Increasing the BGP Multi-Exit Discriminator (MED) value based on PoP load makes the overloaded PoP less preferred in BGP route selection, causing traffic to shift to nearby PoPs without any client-side changes.
**Why it matters:** When a PoP approaches capacity (CPU > 90%, bandwidth saturation, high error rate), the options are load shedding (rejecting requests) or traffic steering (redirecting traffic). MED-based steering is elegant because it operates at the routing layer: increasing MED from 50 (healthy) to 200 (overloaded) causes BGP routers to prefer other PoPs that advertise lower MED values for the same anycast IP. Traffic shifts gradually as BGP reconverges, avoiding the cliff-edge of binary load shedding. This creates a self-healing feedback loop: load increases, MED increases, traffic shifts away, load decreases, MED decreases, traffic returns -- all without any application-layer intervention.

---

## Insight 8: Origin Shield Circuit Breaker with Stale-If-Error Creates a Multi-Layer Resilience Stack

**Category:** Resilience
**One-liner:** When the origin is failing, the shield's circuit breaker stops sending requests (preventing origin overload), while stale-if-error serves cached content that would normally be expired -- together they maintain availability during origin outages.
**Why it matters:** The origin shield has three ordered fallback strategies: (1) serve fresh cached content, (2) serve stale content while asynchronously revalidating (stale-while-revalidate), (3) if origin fails, serve stale content up to a configured duration (stale-if-error, typically 1 hour, extended to 5 minutes during known events). The circuit breaker prevents the shield from hammering a failing origin, which would both slow down shield responses (waiting for timeouts) and prevent origin recovery (overload). During overload conditions, the shield can also extend cache TTLs temporarily (2x multiplier), increase the coalescing window, and reduce origin fetch parallelism. This multi-layer defense means the CDN can survive extended origin outages with degraded freshness but maintained availability.

---

## Insight 9: WebAssembly at the Edge Transforms CDNs from Cache Layers into Distributed Application Platforms

**Category:** Architecture Evolution
**One-liner:** By running WebAssembly modules at edge PoPs with sub-millisecond cold starts, CDNs evolve from passive cache-and-forward networks into globally distributed compute platforms capable of executing custom business logic at the network edge.

**Why it matters:** Traditional CDNs make a binary decision per request: serve from cache or forward to origin. Edge compute via WebAssembly (Wasm) adds a third option: execute application logic at the PoP itself. Wasm provides near-native execution speed, memory-safe sandboxing, and language-agnostic deployment (Rust, Go, C++, Python all compile to Wasm). The critical architectural shift is that cold start times drop from 5-50ms (container-based functions) to under 0.5ms (Wasm-based), making per-request compute economically viable even for latency-sensitive paths. This enables use cases that were previously impossible at the edge: A/B testing with server-side rendering, authentication token validation without origin round-trips, real-time content personalization, and request transformation. The CDN's global PoP network -- originally built for cache proximity -- becomes a distributed compute mesh. The constraint is state management: edge functions must be stateless or use distributed key-value stores co-located at PoPs, which introduces consistency challenges identical to those in distributed databases.

---

## Insight 10: Semantic Caching Extends CDN Cache Principles to AI API Acceleration

**Category:** Caching
**One-liner:** Instead of matching cache keys by exact URL, semantic caching uses vector embeddings to find "similar enough" requests, achieving 40-70% hit rates on AI API traffic versus 10-15% with traditional exact-match caching.

**Why it matters:** Traditional CDN caching is exact-match: the cache key (URL + headers + query parameters) must match precisely, or it is a miss. This works well for static content where the same URL returns the same response. But AI API traffic (LLM inference requests) exhibits a different pattern: many users ask semantically similar questions with different phrasing. Semantic caching computes a vector embedding of each request, searches for cached responses within a cosine similarity threshold (typically 85-95%), and returns the cached response if a sufficiently similar request was previously served. At the edge, this means a CDN PoP can intercept AI API calls and serve cached responses for semantically equivalent queries without forwarding to the inference backend -- reducing API costs by up to 73% and latency by 10-15x. The trade-off is the embedding computation cost (must be fast enough to justify the cache lookup) and the similarity threshold tuning: too aggressive (low threshold) serves incorrect answers, too conservative (high threshold) rarely hits. This represents a fundamental evolution in CDN cache key design -- from deterministic string matching to probabilistic similarity matching.

---

## Insight 11: QUIC/HTTP/3 Eliminates Head-of-Line Blocking but Introduces Connection Migration Challenges for Anycast CDNs

**Category:** Edge Computing
**One-liner:** HTTP/3's independent stream multiplexing over QUIC eliminates TCP's head-of-line blocking problem (where one lost packet stalls all streams), but QUIC's connection IDs create a new challenge when anycast BGP reroutes packets to a different PoP mid-connection.

**Why it matters:** TCP multiplexing (HTTP/2) has a fundamental flaw: because all streams share a single TCP connection, a lost packet in one stream blocks all streams until retransmission completes. HTTP/3 solves this by running each stream as an independent QUIC stream -- a lost packet in stream 5 only blocks stream 5, while streams 1-4 continue unaffected. For CDNs serving multiple resources (HTML, CSS, JS, images) over a single connection, this eliminates the latency spikes caused by packet loss on congested links. Additionally, QUIC's 0-RTT connection resumption eliminates a full round-trip on reconnection, critical for mobile users switching between Wi-Fi and cellular. However, QUIC connections are identified by a 64-bit connection ID rather than the IP 4-tuple. When anycast BGP reroutes traffic to a different PoP (due to PoP failure or BGP reconvergence), the new PoP has no state for that connection ID. The mitigation requires either connection ID-aware routing (ensuring related packets reach the same PoP) or stateless connection migration protocols that can reconstruct session state from encrypted tokens.

---

## Insight 12: AI-Driven Traffic Classification Shifts CDN Security from Rule-Based Filtering to Predictive Threat Mitigation

**Category:** Resilience
**One-liner:** Machine learning models trained on CDN traffic patterns can distinguish legitimate traffic spikes (viral content) from DDoS attacks within seconds, replacing static rate-limiting rules that either over-block legitimate users or under-block sophisticated attacks.

**Why it matters:** Traditional CDN DDoS mitigation relies on static rules: rate limits per IP, geo-blocking, challenge pages triggered by request volume thresholds. These rules create a false-positive/false-negative trade-off -- aggressive thresholds block legitimate users during flash crowds (a product launch, a news event), while conservative thresholds let sophisticated low-and-slow attacks through. With DDoS attack volume increasing 47% year-over-year and attack sophistication evolving (application-layer attacks that mimic legitimate browsing patterns), static rules are increasingly inadequate. AI-driven traffic classification operates on multiple signal dimensions simultaneously: request timing patterns, header fingerprints, geographic distribution anomalies, session behavior analysis, and historical baseline deviation. The model distinguishes between "10x traffic spike because a celebrity linked to this page" and "10x traffic spike because a botnet is attacking" based on behavioral signatures rather than volume alone. The architectural challenge is inference latency: the classification decision must be made within the request processing path (sub-millisecond), requiring lightweight models deployed at every PoP rather than centralized ML infrastructure. This shifts the CDN's security posture from "react to known attack patterns" to "predict and preempt anomalous behavior."
