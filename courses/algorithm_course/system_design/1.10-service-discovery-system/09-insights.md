# Key Insights: Service Discovery System

## Insight 1: AP Beats CP for Discovery, CP Beats AP for Configuration

**Category:** Consistency
**One-liner:** Service discovery should be AP (always return something, even if stale) because routing to a slightly outdated instance list is vastly better than returning nothing during a partition.

**Why it matters:** During a network partition, a CP registry (etcd, ZooKeeper) on the minority side rejects all reads and writes -- meaning services on that side cannot discover any peers, causing a complete local outage even though the services themselves are healthy. An AP registry (Eureka, Consul gossip) continues serving its last known instance list, which may be slightly stale but is overwhelmingly likely to be mostly correct. Routing to 9 out of 10 actual instances with 1 stale entry is far better than routing to nothing. However, for configuration data (feature flags, routing rules, ACLs), consistency matters more: a stale config could enable a disabled feature or apply wrong rate limits. The pragmatic architecture uses AP for service discovery and CP for configuration -- Consul does exactly this with gossip-based membership (AP) and Raft-based KV store (CP) in the same system.

---

## Insight 2: Self-Preservation Mode Prevents the Eviction Death Spiral

**Category:** Resilience
**One-liner:** When the registry detects that more than 15% of expected heartbeats are missing, it stops evicting instances entirely -- trading stale data for system survival.

**Why it matters:** During a network partition between the registry and a fleet of instances, the registry stops receiving heartbeats. Without self-preservation, it interprets every missed heartbeat as a dead instance and evicts them all. The result: the registry tells all clients that zero instances exist, causing a complete system outage even though every instance is running perfectly. Self-preservation (pioneered by Netflix Eureka) uses a simple Practical rule of thumb: if the renewal ratio drops below 85% (threshold), the problem is likely the registry's network, not 15% of instances simultaneously dying. The registry enters a mode where it stops evicting and continues serving the last known instance list. The trade-off is that genuinely dead instances remain in the registry for longer -- but this is always preferable to mass eviction. The threshold (85%) is tuned to distinguish between "a few instances died" (normal, evict them) and "the registry lost connectivity" (abnormal, preserve everything).

---

## Insight 3: Client-Side Caching Reduces Registry Load by 3000x

**Category:** Caching
**One-liner:** With 1,000 services each querying the registry 100 times per second, a 30-second TTL cache reduces registry load from 100K requests/sec to 33 requests/sec.

**Why it matters:** Without caching, the service registry sits on the critical path of every single inter-service call, making it both a latency Slowest part of the process (network round-trip for every call) and a availability risk (registry down = all calls fail). A simple TTL cache eliminates both problems: each service fetches the instance list once per TTL period, and subsequent calls use the local cache with sub-microsecond lookup. The risk is stale data during the TTL window. Watch-based invalidation eliminates this by pushing changes to clients in real-time, but adds the complexity of maintaining long-lived connections. The hybrid approach (TTL cache as fallback + watch for real-time updates) is the production standard: watches provide freshness during normal operation, TTL provides resilience when the watch connection drops. This pattern -- cache with watch invalidation, fall back to TTL -- appears everywhere from DNS to CDNs to database query caches.

---

## Insight 4: Health Checks Must Distinguish Liveness from Readiness

**Category:** Resilience
**One-liner:** A service can be alive (process running, TCP port open) but not ready (database connection lost, warming up cache), and routing traffic to it in this state causes user-facing errors.

**Why it matters:** A single health endpoint that returns 200 OK when the process is running gives no signal about whether the service can actually handle requests. Kubernetes formalized this distinction: liveness probes determine if the process should be restarted (is it deadlocked?), while readiness probes determine if it should receive traffic (has it finished initialization? can it reach its dependencies?). An instance that fails readiness but passes liveness should be removed from the load balancer but not restarted -- it may be waiting for a database to recover. Consul's hybrid model extends this further: heartbeats (push) prove liveness, while HTTP health checks (pull) verify readiness. The health check endpoint itself must test actual functionality (can I query the database? can I reach the cache?) rather than just returning a static 200 -- otherwise it becomes a false negative factory.

---

## Insight 5: DNS-Based Discovery Is Universal but Fundamentally Stale

**Category:** Caching
**One-liner:** DNS TTL caching means that after a service instance dies, clients continue sending traffic to its IP for the entire TTL duration -- and many DNS clients ignore low TTLs entirely.

**Why it matters:** DNS is the most universally compatible discovery mechanism: every language, framework, and operating system knows how to resolve DNS names. But DNS was designed for slowly-changing mappings (domain to IP), not for dynamic service discovery where instances come and go every few seconds. A TTL of 30 seconds means up to 30 seconds of traffic to a dead instance after it deregisters. Worse, many DNS clients (Java's default resolver, some OS-level resolvers) cache aggressively and may ignore TTLs below 30 seconds. CoreDNS with Kubernetes mitigates this by serving from the live service registry, but the client-side caching problem remains. For rapidly changing services (auto-scaled containers), DNS-based discovery should be combined with client-side health checking (retry on failure, mark instance as bad) to compensate for the inherent staleness.

---

## Insight 6: Multi-DC Discovery Requires Local-First with Explicit Fallback

**Category:** Partitioning
**One-liner:** Cross-datacenter discovery queries add 100-300ms of latency per call; the solution is local-first routing with fallback to remote DCs only when local capacity is insufficient.

**Why it matters:** A naive "single global registry" approach means every discovery query potentially crosses a WAN link, adding 100-300ms of latency to every inter-service call. Regional registries eliminate this: each DC has its own registry cluster, services register locally, and discovery queries are answered from the local registry with sub-10ms latency. Cross-DC data is replicated asynchronously (Consul's WAN gossip, Eureka's zone awareness) for disaster recovery. The critical design decision is the fallback trigger: when should a client look beyond its local DC? A simple approach is a minimum healthy threshold -- if the local registry has fewer than N healthy instances of a service, include remote DC instances in the response. Consul's approach of not replicating health status across WAN (too expensive) and instead probing health on-demand for cross-DC queries is a pragmatic bandwidth optimization.

---

## Insight 7: The Watch Storm Is the Service Discovery Thundering Herd

**Category:** Scaling
**One-liner:** When 10,000 clients watch a popular service and one instance changes, the registry must push 10,000 notifications simultaneously, saturating its network and CPU.

**Why it matters:** Watch-based invalidation provides real-time freshness but creates a fan-out amplification problem: a single event (instance registers, health changes) generates N notifications where N is the number of watchers. For a core service (authentication, configuration) watched by every other service in the fleet, N can be tens of thousands. Mitigations include batching notifications (aggregate changes over a 100ms window, send one update), intermediary aggregators (a tree of relay nodes that absorb the fan-out), and rate-limiting notifications per service (cap at 100 updates/sec, excess queued). The watch storm is architecturally identical to the ZooKeeper herd effect and the CDN origin thundering herd -- the solution in all cases is to interpose a buffering or aggregation layer between the event source and the mass of consumers.

---

## Insight 8: The Sidecar Pattern Makes Discovery Language-Agnostic at the Cost of Per-Pod Overhead

**Category:** Edge Computing
**One-liner:** A service mesh sidecar (Envoy, Linkerd) handles all discovery, health checking, and load balancing in a separate process, so the application needs zero discovery logic -- but every pod pays the memory and CPU cost.

**Why it matters:** Client-side discovery requires a discovery library in every language your organization uses (Java, Go, Python, Node.js), each with its own bugs, update cycles, and behavioral quirks. The sidecar pattern moves all discovery logic into a standard proxy process that runs alongside each application container. The application simply calls localhost and the sidecar handles routing, retries, circuit breaking, and mTLS. The cost is real: each sidecar consumes 50-100MB of memory and 0.1-0.5 CPU cores, which at 1,000 pods is 50-100GB of aggregate memory. For large polyglot organizations (Uber, Airbnb), this cost is worth the operational simplicity. For smaller deployments or resource-constrained environments, a shared client library or DNS-based discovery is more efficient. The choice is between per-language client libraries (cheap but inconsistent) and per-pod sidecars (expensive but uniform).

---

## Insight 9: Registration Must Be Idempotent and Deregistration Must Be Graceful

**Category:** Atomicity
**One-liner:** A service that registers on startup, crashes, restarts, and registers again must not create a duplicate entry -- and a service that shuts down gracefully must deregister before closing its port.

**Why it matters:** Without idempotent registration, a crashed-and-restarted service creates a second registry entry alongside the stale one from the previous incarnation. Clients may receive both entries and try to connect to the old IP/port (now either dead or assigned to something else). The registry must use a unique instance ID (hostname + port + process start time) and treat re-registration as an update, not a creation. On the shutdown side, a service that closes its port before deregistering creates a window where the registry still advertises it as healthy but connections fail. The correct shutdown sequence is: deregister (or mark unhealthy) -> wait for in-flight requests to drain -> close port -> exit. Kubernetes implements this with a pre-stop hook and a configurable termination grace period (default 30 seconds), giving the pod time to deregister and drain.

---

## Insight 10: Ambient Mesh Eliminates the Sidecar Tax While Preserving Discovery Transparency

**Category:** Edge Computing
**One-liner:** Moving from per-pod sidecar proxies to a shared per-node ztunnel reduces service discovery's memory overhead by 10-50x while maintaining transparent endpoint resolution and mTLS.

**Why it matters:** The sidecar model (Insight 8) solved the polyglot discovery problem but imposed a non-trivial resource tax: 50-100MB of memory and 0.1-0.5 CPU cores per pod, multiplied across thousands of pods. Ambient mesh architectures restructure this by deploying a lightweight L4 proxy (ztunnel) as a DaemonSet — one per node rather than one per pod. The ztunnel handles mTLS termination and basic service discovery (resolving virtual IPs to backend endpoints) at the node level, using eBPF or iptables to transparently intercept traffic. For services requiring L7 features (header-based routing, request-level load balancing), optional waypoint proxies are deployed per-service or per-namespace rather than per-pod. This tiered approach means most services pay only the ztunnel's shared cost (~50MB per node, amortized across all pods on that node), with L7 overhead only where needed. The architectural insight is that L4 discovery and mTLS are universal requirements deserving shared infrastructure, while L7 features are opt-in specializations. This mirrors how operating systems provide shared networking (kernel TCP stack) rather than bundling a network library per process.

---

## Insight 11: eBPF Moves Service Discovery into the Kernel, Eliminating Proxy Hops Entirely

**Category:** Performance
**One-liner:** By attaching service resolution logic to the kernel's socket connect path via eBPF, service discovery achieves sub-microsecond overhead — 1000x faster than sidecar proxies — with zero application changes.

**Why it matters:** Traditional service discovery adds latency at the application layer: the client resolves a service name to endpoints (microseconds if cached, milliseconds if not), then connects to a selected backend. Sidecar proxies add 0.5-2ms per hop for L7 inspection. eBPF-based service discovery short-circuits this entire chain by intercepting the `connect()` syscall in the kernel. When an application connects to a ClusterIP or service DNS name, an eBPF program attached to the socket layer performs the endpoint lookup and rewrites the destination address in-kernel — the application's TCP connection is established directly to the backend pod with no userspace proxy involved. The endpoint table (mapping service VIPs to healthy pod IPs) is maintained in eBPF maps that the control plane updates via the BPF syscall. Health information flows from the control plane (which aggregates health check results) into these maps, removing unhealthy backends without any notification to the application. The fundamental shift is from "discovery as a library or proxy" to "discovery as an OS capability" — similar to how virtual memory made physical address management transparent to applications, eBPF makes service endpoint management transparent to the network stack. The trade-off is kernel dependency: eBPF programs require Linux kernel 5.10+ and are not portable to non-Linux platforms.

---

## Insight 12: Registry Poisoning Is Service Discovery's SQL Injection — The Attack Surface Most Teams Ignore

**Category:** Security
**One-liner:** An attacker who can register a fake instance for a payment service can redirect live traffic carrying credit card data to a malicious endpoint — and most registries default to open registration with no identity verification.

**Why it matters:** Service discovery registries are implicitly trusted by every service in the fleet: when the registry says "payment-service is at 10.0.1.5:8080," clients connect without question. This makes the registry a high-value attack target with blast radius proportional to the number of services trusting it. Yet many deployments run registries with default-allow policies, no authentication for registration, and no validation that the registering entity is actually the claimed service. The mitigation stack has three layers: (1) authentication — every registration request must carry a verified identity (mTLS certificate, SPIFFE SVID); (2) authorization — the identity must be permitted to register as that specific service (ACL: "only spiffe://cluster/payment-service can register service 'payment'"); (3) attestation — the workload's identity must be cryptographically bound to its execution environment (SPIRE node attestation verifies the pod is running on an authorized node with the correct container image hash). Without all three layers, a compromised pod can register itself as any service and intercept traffic. The parallel to SQL injection is apt: just as SQL injection exploits implicit trust in user input, registry poisoning exploits implicit trust in registration requests. And just as parameterized queries solved SQL injection, identity-bound registration (where the registry verifies the caller's cryptographic identity matches the service being registered) solves registry poisoning.

