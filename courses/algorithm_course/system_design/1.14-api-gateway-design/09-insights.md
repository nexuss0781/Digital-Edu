# Key Insights: API Gateway Design

[← Back to Index](./00-index.md)

---

## Insight 1: The Trie-Based Router with LRU Cache Achieves O(1) Amortized Routing at 100K+ RPS

**Category:** Data Structures
**One-liner:** A radix trie handles O(k) path matching (k = path depth), but an LRU route cache with 80-95% hit rate converts most lookups to O(1) since traffic follows a Zipfian distribution.
**Why it matters:** At 100K+ requests per second, even O(k) per request adds up. The insight is that real API traffic is heavily skewed -- a small number of routes handle the vast majority of requests. A 10,000-entry LRU cache with 5-minute TTL captures the top routes by frequency, and the cache key (method + host + path) ensures that the most common request patterns are resolved from memory without trie traversal. Cache invalidation triggers on route CRUD, config reload, and TTL expiration keep the cache consistent. The trie itself uses a priority system where exact matches beat parameter matches and longer paths beat shorter paths, with stable sorting for deterministic behavior.

---

## Insight 2: Hybrid Local + Global Rate Limiting Balances Accuracy Against Latency

**Category:** Traffic Shaping
**One-liner:** Local-only rate limiting across N gateway nodes allows N times the intended limit; synchronous Redis on every request adds 2ms latency; the hybrid approach achieves ~98% accuracy at 0.5ms overhead.
**Why it matters:** Distributed rate limiting is fundamentally a distributed state problem. With 3 gateway nodes and a 100 req/sec limit, local-only limiting allows 300 req/sec (each node thinks it has the full budget). Synchronous Redis check on every request is accurate but adds a network hop to the hot path. The hybrid design gives each node a "fair share" local token bucket (limit / numNodes) for fast rejection, then asynchronously batches checks against a global Redis counter. Requests clearly over the local limit are rejected immediately (0ms), borderline requests are checked globally (~0.5ms), and the Redis Lua script uses atomic INCR with rollback on overflow to prevent the read-then-write race condition.

---

## Insight 3: JWK Caching with Circuit Breaker Prevents IdP Outages from Cascading to All API Traffic

**Category:** Resilience
**One-liner:** Caching JWK key sets with stale-on-error fallback and circuit-breaker-protected refresh means the gateway can validate tokens for hours even if the identity provider is completely down.
**Why it matters:** JWT validation requires the public key from the identity provider's JWKS endpoint. If the gateway fetches this key on every request, an IdP outage blocks all authenticated traffic. Caching the JWK set with a 1-hour TTL, background refresh 10 minutes before expiry, and circuit-breaker-protected fetches means the gateway is resilient to IdP failures. The critical design choice is falling back to stale cache entries when the circuit breaker is open rather than failing authentication. This trades theoretical security (a revoked key might be used during the staleness window) for practical availability (the entire API continues working). The hybrid token revocation approach -- short-lived tokens (15 min) + Redis blacklist for emergencies -- limits the blast radius of this tradeoff.

---

## Insight 4: Config Snapshot Per Request Eliminates the Config-Reload Race Condition

**Category:** Atomicity
**One-liner:** Capturing an immutable configuration snapshot at request start ensures the entire request lifecycle uses a consistent view, even if config changes mid-request.
**Why it matters:** Without config snapshots, a request that starts with route R1 version 1 might find that R1's plugin configuration has changed between the routing phase and the plugin execution phase. The fix is simple but its absence causes subtle bugs: at request start, capture configStore.snapshot() and use that immutable snapshot for all decisions (route matching, plugin loading, upstream selection). This pattern must be combined with canary config deployments and gradual rollout (10% to 50% to 100%) because even with snapshots, different gateway nodes may temporarily have different configs during propagation, leading to inconsistent routing across the fleet for ~150ms.

---

## Insight 5: Circuit Breaker State Transitions Must Use Compare-and-Swap to Prevent Duplicate Opens

**Category:** Contention
**One-liner:** When multiple threads simultaneously detect failure threshold breach, naive state transition logic opens the circuit multiple times; CAS ensures exactly-once state change.
**Why it matters:** The circuit breaker pattern protects upstreams from cascading failures, but its own state machine has a race condition. When error count hits 5 (threshold), multiple request threads may simultaneously try to transition CLOSED to OPEN. Without atomic compare-and-swap, the circuit opens multiple times, potentially resetting the recovery timer incorrectly. The CAS loop -- read current state, check if still CLOSED, atomically swap to OPEN, retry if CAS fails -- ensures exactly one thread performs the transition. This is a textbook example of how shared mutable state in concurrent systems requires lock-free synchronization even for simple boolean state machines.

---

## Insight 6: Plugin Chain Latency Budget Forces Architectural Tradeoffs Between Features and Performance

**Category:** Scaling
**One-liner:** With a 5ms total gateway overhead budget, each plugin in a 10-plugin chain gets only 500 microseconds -- forcing async execution for non-critical plugins and strict per-plugin timeouts.
**Why it matters:** The API gateway sits on the hot path of every request, and its value proposition (centralized cross-cutting concerns) directly conflicts with its performance requirement (minimal overhead). The plugin chain architecture means latency is additive: Auth (1.5ms) + Rate Limit (0.5ms) + Transform (0.2ms) + Custom Plugins (0.6ms) + Routing (0.2ms) = 3ms minimum. Adding just two more plugins can exceed the 5ms budget. This forces three design decisions: logging and analytics plugins must execute asynchronously (fire-and-forget), optional plugins must fail open (skip on timeout rather than block), and plugin results must be cached where possible (route cache, auth token cache). The tension between "add one more plugin" and "stay under 5ms" is the defining architectural constraint.

---

## Insight 7: WebSocket JWT Expiry Creates a Long-Lived Connection Authentication Gap

**Category:** Security
**One-liner:** A JWT validated during WebSocket upgrade can expire during a connection that lasts hours, creating an authentication gap that REST APIs never face.
**Why it matters:** REST APIs validate tokens per request, so expiry is naturally enforced. WebSocket connections persist across token lifetimes, meaning a user whose access has been revoked can continue using an established WebSocket connection until it disconnects. The solution requires periodic token expiry checks on active connections: send a "token_refresh_required" message when expiry approaches, and force-close with code 4001 when the token actually expires. This introduces WebSocket-specific complexity (connection metadata tracking, periodic sweep, custom close codes) that does not exist in request-response protocols and is frequently overlooked in gateway designs.

---

## Insight 8: Streaming Large Bodies Avoids the Memory-Explosion Trap of Request Buffering

**Category:** Scaling
**One-liner:** Buffering a 100 MB request body in gateway memory before forwarding to upstream multiplies memory usage by concurrent request count; streaming directly to upstream uses constant memory.
**Why it matters:** The default behavior of many gateways is to fully buffer request and response bodies for transformation. At 1,000 concurrent requests with 100 MB bodies, this requires 100 GB of gateway memory. The solution is a size-based threshold: bodies below a buffer threshold (e.g., 1 MB) are buffered for transformation, while larger bodies are streamed pipe-style directly to upstream. This means body transformation plugins cannot operate on streamed requests, creating a feature tradeoff. The 413 Payload Too Large response at the gateway layer provides a hard upper bound, but the streaming threshold is the non-obvious knob that prevents memory exhaustion under normal operation.

---

## Insight 9: WebAssembly Plugin Isolation Solves the Extensibility-vs-Security Trilemma

**Category:** Security
**One-liner:** In-process Lua plugins are fast but unconfined; external service plugins are isolated but add network latency; WASM plugins achieve both sub-millisecond execution and memory-safe sandboxing.
**Why it matters:** API gateways face a fundamental tension: custom plugins must execute on the hot path (ruling out external service calls at 100K+ RPS), but arbitrary code in the gateway process is a security and stability risk (a crashing Lua plugin can take down the entire gateway). WebAssembly resolves this by providing a sandboxed execution environment with predictable memory bounds, no file system or network access unless explicitly granted, and near-native execution speed (within 10-20% of native code). The key architectural decision is the host-guest interface: the gateway exposes specific capabilities (read headers, set response, log) through a narrow API, and the WASM module can only interact through that interface. This capability-based security model means a misbehaving plugin cannot read other requests, exhaust memory beyond its allocation, or call unauthorized upstream services. The tradeoff is ecosystem maturity — WASM component model standardization (2025) finally enables multi-language plugin authoring without the friction of early Proxy-WASM implementations.

---

## Insight 10: AI Gateway Pattern — LLM-Aware Rate Limiting Requires Token Budgeting, Not Request Counting

**Category:** Traffic Shaping
**One-liner:** Traditional request-per-second rate limiting is meaningless for LLM APIs where a single request can consume 100K tokens and $0.50; token-budget rate limiting ties quotas to actual resource consumption.
**Why it matters:** The rise of LLM-backed APIs (2024-2026) broke a fundamental assumption of API gateway rate limiting: that requests are roughly uniform in cost. A GET /users request and a POST /chat/completions with a 50K-token prompt differ by 1000x in compute cost, latency (50ms vs 30s), and dollar cost. Token-budget rate limiting assigns each consumer a token budget (input + output tokens per minute) rather than a request count, using a weighted token bucket where the cost is extracted from the request payload (prompt length estimate) before forwarding and reconciled against actual usage from the response (actual token count). This requires the gateway to understand LLM-specific semantics — parsing model parameters, estimating token counts from character length, and tracking streaming SSE responses where the final token count is only known at stream completion. The architectural impact is significant: the gateway must maintain per-consumer token ledgers, support mid-stream accounting, and provide cost-aware routing to direct requests to the most cost-effective model endpoint.

---

## Insight 11: eBPF Packet Filtering Moves Gateway Rejection to Kernel Space — 10x Throughput for Deny-Listed Traffic

**Category:** Scaling
**One-liner:** Rejecting blocked IPs or expired API keys in userspace wastes a full HTTP parse and context switch; eBPF programs attached to the network socket reject packets before they reach the gateway process.
**Why it matters:** At high RPS, a significant fraction of traffic may be deny-listed IPs, known-bad API keys, or rate-limited consumers that will be rejected anyway. Processing these requests through the full gateway pipeline (TLS termination → HTTP parse → auth check → rejection) wastes CPU and connection slots. eBPF (extended Berkeley Packet Filter) programs can be attached to the socket layer (XDP or TC hook points) to inspect packet headers and reject traffic before it enters userspace. A Bloom filter loaded with blocked IP ranges and a hash map of rate-limited consumer keys enable O(1) rejection at line rate. The gateway periodically syncs the eBPF maps from its rate limiting and blocklist state. The tradeoff is operational complexity — eBPF programs run in kernel space with strict verification requirements, limited debugging tools, and kernel version dependencies. This pattern is most valuable for DDoS mitigation and high-volume API platforms where 10-30% of traffic is immediately rejectable, reclaiming those connection slots and CPU cycles for legitimate requests.

---

## Insight 12: HTTP/3 QUIC Migration Creates a Dual-Stack Gateway That Must Maintain Two Connection Models Simultaneously

**Category:** Resilience
**One-liner:** HTTP/3 over QUIC eliminates head-of-line blocking and enables 0-RTT connection resumption, but gateways must run TCP and UDP stacks in parallel for years because QUIC adoption is incremental.
**Why it matters:** HTTP/3 (standardized 2022, widespread adoption 2024-2026) fundamentally changes the gateway's connection model. QUIC uses UDP instead of TCP, handles TLS within the protocol (no separate TLS handshake), and provides stream-level flow control (no head-of-line blocking). For the gateway, this means 0-RTT connection resumption eliminates the cold-start penalty for returning clients, connection migration survives network changes (critical for mobile clients switching between WiFi and cellular), and multiplexed streams improve throughput for concurrent API calls. However, the migration period creates operational complexity: the gateway must listen on both TCP (HTTP/1.1, HTTP/2) and UDP (HTTP/3) simultaneously, maintain separate connection pools and metrics for each protocol, handle Alt-Svc header negotiation to advertise HTTP/3 support, and deal with middleboxes and firewalls that block UDP (requiring graceful TCP fallback). The non-obvious insight is that HTTP/3's connection migration means the gateway can no longer rely on source IP for client identification (the connection ID changes), requiring token-based client tracking for rate limiting and analytics.
