# Key Insights: High-Performance Reverse Proxy

[← Back to Index](./00-index.md)

---

## Insight 1: Event-Driven Architecture Reduces Per-Connection Memory by 100x

**Category:** Scaling
**One-liner:** At 100K concurrent connections, thread-per-connection uses ~100 GB for stacks alone, while event-driven uses ~1 GB total with kilobytes per connection.
**Why it matters:** The fundamental scaling limit of a reverse proxy is memory per connection. Each thread requires a 1 MB stack, making 100K threads physically impossible on most servers. Event-driven models (epoll/kqueue) handle all connections in a single thread using non-blocking I/O, reducing per-connection overhead to ~10 KB (connection struct + read/write buffers + TLS state). This 100x memory reduction is not an optimization -- it is the architectural decision that makes high-connection-count proxying possible. HTTP/2 adds complexity (10 KB base + 1 KB per stream), meaning a connection with 100 concurrent streams costs 120 KB, which is still 10x cheaper than a single thread.

---

## Insight 2: Edge-Triggered epoll Trades Programming Safety for Syscall Reduction

**Category:** Data Structures
**One-liner:** Edge-triggered mode fires events only on state changes (requiring complete buffer draining), while level-triggered fires as long as data exists -- fewer syscalls versus simpler correctness.
**Why it matters:** Level-triggered epoll will re-notify on every epoll_wait call as long as data remains in the buffer, which is forgiving of partial reads but generates redundant notifications. Edge-triggered mode fires once per state transition, meaning the application must read until EAGAIN on every notification or risk missing data permanently. High-performance proxies choose edge-triggered because at 100K connections, the reduction in epoll_wait syscalls is significant. However, the correctness requirement -- always drain fully -- is a source of subtle bugs. Cloudflare's move to Pingora (Rust) was partly motivated by the difficulty of getting edge-triggered I/O right in C without memory safety guarantees.

---

## Insight 3: Connection Pooling Eliminates 70ms of Overhead Per Request

**Category:** Caching
**One-liner:** Without upstream connection pooling, every request pays ~1ms TCP handshake + ~50ms TLS handshake + ~20ms DNS resolution; with pooling, this drops to ~0.1ms.
**Why it matters:** The proxy sits on the critical path of every request, and upstream connection establishment is the largest latency contributor it can eliminate. Connection pooling turns a 70ms per-request overhead into a one-time cost amortized across thousands of requests. The pool lifecycle management -- validation via non-blocking peek/getsockopt, age-based eviction, idle timeout, and TLS session resumption for new connections -- is deceptively complex. Pool sizing follows the formula max_per_server = peak_requests * 1.5 / server_count, and the total memory cost (servers * max_per_server * 10KB) is usually trivial compared to the latency savings.

---

## Insight 4: Reference-Counted Configuration Prevents Use-After-Free During Hot Reload

**Category:** Atomicity
**One-liner:** Each request acquires a reference to the current configuration snapshot at start; old configurations are only freed when their reference count drops to zero and they are no longer current.
**Why it matters:** Configuration hot reload is essential for zero-downtime operation, but it creates a classic use-after-free race: a request starts processing with route config version 1, an admin reloads config, the route is deleted in version 2, and the request tries to access a freed resource. Reference counting on the configuration object ensures old configs remain valid as long as any request holds a reference. This pattern -- immutable config snapshots with reference counting -- appears in NGINX (generations), Envoy (thread-local config), and Pingora, and is one of the primary motivations for using memory-safe languages (Rust) in modern proxy implementations.

---

## Insight 5: Slowloris Attacks Exploit the Gap Between Connection Acceptance and Request Completion

**Category:** Security
**One-liner:** An attacker sending HTTP headers at 1 byte per second holds a connection open indefinitely, exhausting server resources without ever completing a request.
**Why it matters:** Slowloris is effective because most connection timeout mechanisms measure time since the last byte received, not time since the connection was established. A properly defended proxy must implement two distinct protections: an absolute header timeout (time from connection to complete headers) and a minimum throughput check (bytes_received / elapsed < min_threshold). The minimum throughput check is the non-obvious one -- it prevents an attacker from sending just enough data to reset per-byte timers while never completing the request. This defense must be applied at the proxy layer because application servers behind it are even more vulnerable.

---

## Insight 6: Upstream Connection Storms Require Semaphore-Gated Connection Creation

**Category:** Traffic Shaping
**One-liner:** When the connection pool is exhausted and a burst arrives, uncontrolled connection creation causes a thundering herd to upstream servers -- a semaphore limiting concurrent creation prevents the stampede.
**Why it matters:** When all pooled connections are in use, each new request tries to create a new upstream connection simultaneously. With 1,000 requests arriving in the same millisecond, this creates 1,000 TCP handshakes to the upstream, potentially overwhelming it. A semaphore (or bounded channel) on pending connection creation limits the number of connections being established concurrently. Requests that cannot acquire the semaphore within a timeout receive a "pool exhausted" error rather than contributing to the stampede. This is a specific instance of the broader pattern: admission control at the source is cheaper than overload handling at the destination.

---

## Insight 7: HTTP/2 Stream Exhaustion Is a Resource Attack That Bypasses Connection Limits

**Category:** Resilience
**One-liner:** A client opening maximum HTTP/2 streams and sending requests without reading responses creates backpressure that blocks the entire connection while consuming only one file descriptor.
**Why it matters:** Connection limits protect against clients opening too many TCP connections, but HTTP/2 multiplexes many streams over a single connection. An attacker can open 100 streams, send requests, and ignore responses -- the proxy accumulates pending response data (up to 16 MB per connection) while the client holds the connection open with minimal resources. Defense requires both a max_concurrent_streams limit and a max_pending_data limit with backpressure: when pending data exceeds the threshold, the proxy sends a GOAWAY frame with ENHANCE_YOUR_CALM error code and stops accepting new streams. This is a protocol-level attack that does not exist in HTTP/1.1.

---

## Insight 8: TLS Session Resumption Converts a 2-RTT Handshake to 0-RTT

**Category:** Caching
**One-liner:** TLS 1.3 with 0-RTT resumption allows the client to send application data in the very first packet, eliminating the handshake entirely for returning connections.
**Why it matters:** At 10,000 new connections per second, TLS handshakes consume significant CPU (1ms for ECDHE key exchange per handshake). Session tickets enable stateless resumption where the client presents a previously issued ticket instead of performing a full key exchange. TLS 1.3 goes further with 0-RTT, where early data is sent before the handshake completes. However, 0-RTT data is replayable -- an attacker can capture and replay the first flight. This means 0-RTT should only be used for idempotent requests (GET), and the proxy must implement anti-replay mechanisms for non-idempotent operations. The performance-security tradeoff of 0-RTT is one of the most important decisions in proxy configuration.

---

## Insight 9: io_uring Replaces Syscall-Per-Operation with Shared-Memory Submission Queues

**Category:** Scaling
**One-liner:** Instead of one syscall per I/O operation (read, write, accept), io_uring batches submissions and completions through kernel-shared ring buffers, reducing syscall overhead by 5-10x at high connection counts.
**Why it matters:** Traditional event-driven proxies using epoll still make one syscall per I/O operation: epoll_wait returns readiness, then read/write/accept each require a separate kernel transition. At 100K+ concurrent connections processing millions of operations per second, syscall overhead becomes the dominant CPU cost -- each transition costs ~100-200ns for the context switch plus cache pollution. io_uring eliminates this by using two lock-free ring buffers in shared memory: the submission queue (application writes I/O requests) and the completion queue (kernel writes results). The application can batch dozens of operations into a single io_uring_enter syscall, or with SQPOLL mode, eliminate syscalls entirely by having a kernel thread poll the submission queue. Envoy's io_uring backend shows 10% improvement in both bandwidth and latency. The catch is complexity: io_uring's asynchronous completion model requires fundamentally different buffer management than epoll's readiness model, and the kernel attack surface is larger (io_uring has been disabled in some hardened environments). For proxies where every microsecond matters, io_uring is the next evolution beyond epoll -- not a replacement, but a faster path for the hottest I/O loops.

---

## Insight 10: Rust Memory Safety Eliminates Entire CVE Classes Without Runtime Performance Cost

**Category:** Security
**One-liner:** Moving from C/C++ to Rust eliminates use-after-free, buffer overflow, and double-free vulnerabilities at compile time -- the exact vulnerability classes responsible for 70%+ of proxy CVEs -- with zero garbage collection overhead.
**Why it matters:** Reverse proxies are among the most security-critical infrastructure components: they parse untrusted input (HTTP headers, TLS handshakes, WebSocket frames) from the open internet at millions of requests per second. Historically, the majority of critical proxy CVEs have been memory safety bugs in C/C++ code -- buffer overflows in header parsing, use-after-free in connection state machines, and double-free during error handling. Cloudflare's migration from NGINX (C) to Pingora (Rust) was explicitly motivated by this: Rust's ownership system prevents these bug classes at compile time without runtime overhead (no garbage collector, no reference counting on the hot path). The results are measurable: Pingora achieved 70% less CPU usage and 79% less memory than NGINX while simultaneously eliminating the memory safety CVE surface. The key insight is that for infrastructure handling adversarial input, the language choice is a security architecture decision, not merely a developer productivity choice. The trade-off is ecosystem maturity and hiring -- C/C++ proxy engineers vastly outnumber Rust engineers -- but the security calculus increasingly favors memory-safe languages for internet-facing infrastructure.

---

## Insight 11: eBPF Kernel Datapath Bypasses Userspace Proxying for L4 Traffic

**Category:** Performance
**One-liner:** eBPF programs attached to socket hooks can redirect L4 (TCP/UDP) traffic directly in the kernel, eliminating the two userspace context switches that traditional proxy architectures require per packet.
**Why it matters:** In a traditional proxy architecture, every packet traverses: NIC → kernel → userspace proxy → kernel → upstream socket. Each kernel-userspace transition costs ~1-2μs, and for simple L4 forwarding (no header inspection, no payload modification), this overhead is pure waste. eBPF socket-level programs (sockmap, sk_redirect) can short-circuit this path entirely: packets arriving on a downstream socket are redirected to an upstream socket without ever leaving the kernel. This is not theoretical -- Cilium's eBPF datapath replaces kube-proxy's iptables rules (which were O(n) in service count) with O(1) eBPF map lookups, and Istio Ambient Mode's ztunnel uses eBPF for transparent L4 interception. The measured impact is significant: eBPF-based L4 forwarding achieves 2-5x the throughput of userspace proxying with sub-100μs latency. The architectural implication is a split proxy model: L4 decisions (connection routing, mTLS termination) happen in the kernel via eBPF, while L7 decisions (header-based routing, request transformation) remain in userspace. This separation acknowledges that most proxy traffic does not need L7 inspection, and paying the userspace penalty for every packet is an architectural mistake that eBPF corrects.

---

## Insight 12: Sidecarless Ambient Mesh Replaces Per-Pod Proxies with Shared Node-Level Infrastructure

**Category:** Architecture
**One-liner:** Instead of injecting a full L7 proxy sidecar into every pod (doubling memory and adding 2-3ms latency), ambient mesh deploys a shared per-node L4 proxy (ztunnel) and instantiates L7 proxies (waypoints) only for traffic that needs header inspection.
**Why it matters:** The sidecar proxy model (one Envoy per pod) was the foundational architecture of service meshes, but it has proven operationally expensive at scale: each sidecar consumes 50-100MB of memory and 0.1-0.5 CPU cores, multiplied by thousands of pods. For a 5,000-pod cluster, sidecars alone consume 250-500GB of memory. Ambient mesh (Istio Ambient Mode, GA 2024) inverts this by deploying a single ztunnel DaemonSet per node that handles L4 concerns (mTLS, connection routing, telemetry) for all pods on that node via eBPF transparent interception. L7 processing (header-based routing, retries, fault injection) is handled by optional waypoint proxies deployed only for services that need them. The result is dramatic: 90%+ reduction in proxy memory overhead for services that only need mTLS and basic routing, with full L7 capability available on-demand. The architectural insight is that the sidecar model over-provisioned L7 capability for every connection when most traffic only needed L4 -- ambient mesh matches proxy capability to actual traffic requirements, applying the principle of least privilege to infrastructure resource allocation.
