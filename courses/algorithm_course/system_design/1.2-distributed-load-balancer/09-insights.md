# Key Insights: Distributed Load Balancer

## Insight 1: Maglev Hashing Achieves Near-Minimal Disruption Through Permutation Tables

**Category:** Data Structures
**One-liner:** Maglev's permutation-based lookup table ensures O(1) routing decisions while limiting key redistribution to approximately 1/N keys when backends change -- far better than modular hashing's complete reshuffling.

**Why it matters:** Traditional mod-based hashing (hash % N) redistributes nearly all keys when N changes by even one. Standard consistent hashing with virtual nodes still requires traversing the ring. Maglev takes a fundamentally different approach: each backend generates a deterministic permutation of table indices using two hash functions (offset and skip), then backends take turns claiming empty slots in a round-robin fashion. The resulting lookup table gives O(1) routing (just table[hash(key) % M]) while achieving near-theoretical-minimum disruption on membership changes. Google uses M=65537 (a prime), which keeps each table to ~65KB and achieves distribution uniformity within a few percent. The permutation-claiming algorithm is elegant: it inherently produces even distribution because each backend's permutation visits every slot exactly once.

---

## Insight 2: Two-Tier L4/L7 Architecture Separates Throughput from Intelligence

**Category:** Scaling
**One-liner:** Placing a stateless L4 layer (packet forwarding at microsecond latency) in front of an L7 layer (content-aware routing at millisecond latency) lets each tier scale independently for its specific Slowest part of the process.

**Why it matters:** L4 and L7 load balancers have fundamentally different resource profiles. L4 does simple 5-tuple hashing and packet forwarding -- its Slowest part of the process is packet rate and NIC throughput. L7 terminates TLS, inspects HTTP headers, applies routing rules, and manages connection pools -- its Slowest part of the process is CPU and memory. Combining them forces you to scale both dimensions together. The two-tier pattern (Internet -> Anycast VIP -> L4 pool -> L7 pool -> backends) lets you independently scale L4 for raw packet throughput and L7 for content routing complexity. Google's production architecture (Maglev at L4, GFE at L7) and Meta's (Katran at L4, Proxygen at L7) both follow this pattern. The L4 tier also provides a natural place for DDoS absorption since it operates at wire speed.

---

## Insight 3: Kernel Bypass (DPDK/XDP) Provides 10x Throughput by Eliminating the OS Network Stack

**Category:** Scaling
**One-liner:** Moving packet processing from the kernel's TCP/IP stack to user-space poll-mode drivers eliminates context switches, interrupts, and memory copies, achieving 10x+ packet rate improvement.

**Why it matters:** The traditional packet path (NIC -> kernel interrupt -> kernel driver -> TCP stack -> context switch -> user space -> context switch -> kernel -> send) involves multiple memory copies and at least two context switches per packet. At millions of packets per second, these context switches alone consume significant CPU. DPDK (Data Plane Development Kit) and eBPF/XDP bypass this entirely: the NIC delivers packets directly to user-space memory via poll-mode drivers, and the load balancing logic runs without ever entering the kernel. Meta's Katran uses XDP to process packets at the NIC driver level before they even enter the kernel stack. This is why software L4 load balancers at Google and Meta can match or exceed hardware load balancer throughput. The trade-off is dedicating CPU cores exclusively to packet processing (poll mode wastes CPU when idle), but at scale the throughput gain far outweighs the cost.

---

## Insight 4: Shallow Health Checks for Routing, Deep Health Checks for Alerting

**Category:** Resilience
**One-liner:** Use fast shallow checks (port open, process alive) to make routing decisions, and slow deep checks (database connectivity, dependency health) only for operational alerting -- never for traffic routing.

**Why it matters:** Deep health checks that verify database connectivity, cache reachability, and downstream API health seem more thorough, but they create a dangerous failure mode: if the database has a brief hiccup, deep health checks mark all backends as unhealthy simultaneously, causing a total traffic blackout even though the backends themselves are perfectly capable of serving cached data or gracefully degrading. Shallow checks (TCP connect or simple HTTP 200 from the process) confirm the backend can accept connections, which is all the load balancer needs to know. Deep checks are valuable for alerting engineers to dependency issues, but they should never drive routing decisions. The formula for detection time (unhealthy_threshold x check_interval + timeout) with recommended values (3 x 5s + 2s = 17s) balances detection speed against flapping risk.

---

## Insight 5: Copy-on-Write Backend Lists Eliminate the Health-Check-vs-Selection Race Condition

**Category:** Contention
**One-liner:** When a health checker updates a backend's status while the selection algorithm is iterating the backend list, an atomic pointer swap of a copy-on-write list ensures readers never see partially updated state.

**Why it matters:** Load balancers have two concurrent hot paths: the selection path (choosing a backend for each incoming request, potentially millions per second) and the health check path (updating backend status every few seconds). Without careful synchronization, the selection thread can read a backend list where some entries reflect the old state and some the new. Mutex locks on the backend list would serialize all request routing behind health check updates -- unacceptable at high throughput. The copy-on-write pattern solves this elegantly: the health checker creates a complete copy of the backend list, modifies the copy, then atomically swaps the pointer. All in-flight selections complete on the old list; new selections use the new list. No locks, no contention, no partial reads. This is the same pattern used by Linux kernel's RCU (Read-Copy-Update) for similar reasons.

---

## Insight 6: TLS Session Resumption Converts a 25-Core Problem into a 2-Core Problem

**Category:** Cost Optimization
**One-liner:** Without session resumption, RSA-2048 TLS handshakes consume ~400 handshakes/core/sec; with ECDSA + session tickets, the same core handles 10,000+ operations/sec -- a 25x improvement.

**Why it matters:** TLS termination is the single largest CPU consumer in an L7 load balancer. A full RSA-2048 handshake costs thousands of CPU cycles; at 10,000 new connections per second, that requires 25 dedicated cores. Session resumption (TLS session tickets or session IDs) allows subsequent connections from the same client to skip the expensive key exchange, reducing the handshake to a symmetric cipher operation. Combined with ECDSA-P256 (3x faster than RSA for the initial handshake) and TLS 1.3 (reduces handshake from 2 RTTs to 1 RTT), the CPU requirement drops by over an order of magnitude. The trade-off is ticket key management: session ticket keys must be rotated and distributed across all LB nodes, and compromise of a ticket key enables decryption of past sessions (forward secrecy is weakened). Using short-lived ticket keys (hours, not days) mitigates this.

---

## Insight 7: Connection Draining is the Difference Between Graceful and Chaotic Deployments

**Category:** Resilience
**One-liner:** Removing a backend from the load balancer pool without draining active connections causes in-flight requests to fail, turning routine deployments into user-visible errors.

**Why it matters:** During rolling deployments, backends must be removed one at a time. Without connection draining, removing a backend immediately terminates all active connections -- long-running requests (file uploads, streaming responses, WebSocket sessions) are killed mid-flight. Connection draining transitions the backend to a DRAINING state: new requests are routed elsewhere, but existing connections are allowed to complete up to a configurable timeout. The drain timeout must balance two concerns: too short (seconds) and long requests are still killed; too long (minutes) and deployments become painfully slow. A 30-second default with force-close on timeout is the common compromise. This pattern is critical for any stateful proxy and explains why health check removal and deployment removal are separate operations -- a backend can be healthy but draining.

---

## Insight 8: Power of Two Choices Achieves Near-Optimal Load Distribution with O(1) State

**Category:** Data Structures
**One-liner:** Instead of tracking connection counts across all N backends (O(N) per decision), randomly sample just two backends and pick the less loaded one -- this achieves exponentially better distribution than random selection with minimal overhead.

**Why it matters:** Least-connections is the ideal algorithm for variable-duration requests, but it requires O(N) state and comparison on every routing decision. Pure random selection is O(1) but creates statistical imbalances. The "power of two choices" algorithm occupies a sweet spot: pick two backends at random, compare their load, and route to the lighter one. This mathematically provably reduces maximum load from O(log N / log log N) to O(log log N) -- an exponential improvement over single random choice. Netflix uses this approach with server utilization scoring. The elegance is that the algorithm requires only two lookups regardless of pool size and no global state synchronization. It naturally adapts to heterogeneous backends and works well in distributed settings where exact global load counts are unavailable.

---

## Insight 9: Anycast Eliminates VIP as Single Point of Failure Through BGP Routing

**Category:** Resilience
**One-liner:** By advertising the same IP address from multiple geographic points of presence via BGP, Anycast lets the network's own routing protocols handle failover without any application-level coordination.

**Why it matters:** Traditional VIP failover (VRRP/Keepalived) uses an active-passive pair where 50% of capacity sits idle, and failover takes seconds during which traffic is dropped. DNS-based failover depends on client-side DNS caching, meaning stale records can route traffic to dead nodes for minutes. Anycast takes a fundamentally different approach: the same VIP is announced from every PoP (point of presence) via BGP. The internet's routing infrastructure naturally directs each client to the nearest healthy PoP. If a PoP goes down, BGP route withdrawal redirects traffic to the next-nearest PoP within seconds, with zero application-level coordination. The trade-off is operational complexity (BGP configuration, AS relationships) and the fact that "nearest" is determined by network hops, not geographic distance, so routing can occasionally be suboptimal.

---

## Insight 10: DSR Converts a Bandwidth Problem into a Routing Problem

**Category:** Scaling
**One-liner:** Direct Server Return eliminates the load balancer from the response path, reducing LB bandwidth requirements by 10x or more for asymmetric workloads where responses are far larger than requests.

**Why it matters:** In most web workloads, responses are 5-20x larger than requests (a 2 KB API request returns a 20 KB JSON response; a video chunk request returns a 2 MB segment). In full-proxy mode, the LB handles both request and response traffic, making the response path the bandwidth Slowest part of the process. DSR eliminates this: the LB rewrites only the Layer 2 MAC address (not the IP) of incoming packets to direct them to the selected backend, which has the VIP configured on its loopback interface. The backend processes the request and responds directly to the client using the VIP as the source IP—the response never traverses the LB. For a 290K QPS workload with 10:1 response-to-request ratio, this reduces LB bandwidth from 6.4 Gbps to 580 Mbps. The constraint is that DSR requires the LB and backends to be on the same Layer 2 network (or use IP tunneling for cross-subnet), and the LB cannot inspect or modify responses (no response headers, no response logging). This makes DSR ideal for L4 tiers that don't need response awareness.

---

## Insight 11: The Load Balancer's Availability Is More Important Than Any Backend's Availability

**Category:** Resilience
**One-liner:** A load balancer failure has a blast radius equal to the sum of all backends it fronts, making the LB the single highest-leverage availability investment in the entire infrastructure stack.

**Why it matters:** When a single backend fails, one fraction of traffic is affected. When the load balancer fails, ALL traffic is affected—every backend behind it becomes unreachable. This inverted failure amplification means the LB must be more available than any individual backend it serves. If your backends target 99.9% availability each, the LB must target 99.99% or higher; otherwise, the LB itself becomes the availability Slowest part of the process. This is why production architectures invest heavily in LB redundancy: Anycast with multiple nodes (no single node matters), ECMP distribution (the network itself handles LB-to-LB failover), and Maglev consistent hashing (surviving nodes absorb connections with minimal disruption). The stateless design of L4 LBs is a deliberate architectural choice driven by this requirement: statelessness means any node can serve any connection, eliminating the state synchronization problem that would make high availability more difficult. The broader lesson applies to any infrastructure component that sits on a shared critical path: the more services depend on it, the more its availability target must exceed each individual service's target.

---

## Insight 12: HTTP/2 Breaks L4 Load Balancing Because Multiplexing Collapses Requests into Connections

**Category:** System Modeling
**One-liner:** HTTP/2's stream multiplexing means a single TCP connection carries hundreds of concurrent requests, so an L4 LB that routes by connection sends all of a client's requests to a single backend—defeating the purpose of load balancing.

**Why it matters:** L4 load balancers route at the connection level: once a TCP connection is established to a backend, all data on that connection goes to that backend. With HTTP/1.1, clients typically open multiple connections (6 per domain by default), providing natural distribution. HTTP/2 inverts this: the protocol is specifically designed to use a single multiplexed connection per origin, sending all requests as independent streams within that one connection. If an L4 LB assigns this connection to Backend A, then Backend A receives 100% of that client's requests while other backends sit idle. The problem compounds with long-lived gRPC connections (which use HTTP/2 exclusively)—a gRPC client may maintain a single connection for hours, sending thousands of RPCs to one backend. The solution is L7 load balancing that understands HTTP/2 framing and can demultiplex streams, routing each stream independently. This is a concrete example of why the two-tier architecture exists: L4 distributes connections to L7 nodes, and L7 nodes distribute individual requests to backends.
