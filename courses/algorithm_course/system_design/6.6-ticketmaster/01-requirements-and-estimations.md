# Requirements & Capacity Estimations

## 1. Functional Requirements

### Core Features (In Scope)

| # | Feature | Description |
|---|---------|-------------|
| F1 | **Event Discovery** | Search and browse events by artist, venue, location, date, genre |
| F2 | **Interactive Seat Map** | Real-time venue map showing available/held/sold seats with pricing |
| F3 | **Virtual Waiting Room** | Fair queuing system for high-demand on-sales with bot detection |
| F4 | **Seat Selection & Hold** | Temporarily reserve seats (5-10 min TTL) while user completes checkout |
| F5 | **Checkout & Payment** | Complete purchase with payment processing, order confirmation |
| F6 | **Ticket Delivery** | Digital tickets with rotating barcodes, mobile-first delivery |
| F7 | **Event Management** | Venue configuration, pricing tiers, sale windows, inventory allocation |
| F8 | **Resale Marketplace** | Fan-to-fan ticket resale with price caps and verification |

### Out of Scope

- Artist/promoter relationship management (CRM)
- Venue physical operations (entry scanning hardware)
- Marketing campaign management
- Financial settlement/reconciliation with venues
- Social features (reviews, fan communities)

---

## 2. Non-Functional Requirements

### CAP Theorem Choice

**CP (Consistency + Partition Tolerance)** for seat inventory -- a seat must never be double-sold, even if it means temporarily rejecting requests during network partitions. For read-heavy paths (event browsing, search), eventual consistency is acceptable.

### Consistency Model

| Component | Consistency Model | Justification |
|-----------|-------------------|---------------|
| Seat Inventory | **Strong (Linearizable)** | No double-selling; seat state must be authoritative |
| Queue Position | **Strong** | Fairness requires accurate ordering |
| Event Catalog | **Eventual** | Brief staleness acceptable for search results |
| User Profiles | **Eventual** | Not time-critical |
| Pricing | **Read-your-writes** | Prices must reflect current state during checkout |

### Availability Targets

| Component | Target | Justification |
|-----------|--------|---------------|
| Event browsing/search | 99.99% | Revenue-critical, always-on |
| On-sale checkout | 99.9% | Acceptable brief degradation under extreme load |
| Seat map rendering | 99.95% | Can degrade to list view |
| Payment processing | 99.95% | Depends on external payment processors |
| Virtual queue | 99.99% | Queue failure = complete on-sale failure |

### Latency Targets

| Operation | p50 | p95 | p99 |
|-----------|-----|-----|-----|
| Event search | 100ms | 250ms | 500ms |
| Seat map load | 200ms | 500ms | 1s |
| Seat hold (SETNX) | 5ms | 15ms | 50ms |
| Queue position update | 100ms | 300ms | 500ms |
| Checkout completion | 1s | 3s | 5s |
| Ticket delivery | 2s | 5s | 10s |

### Durability Guarantees

- **Completed orders**: 99.999999999% (11 nines) -- replicated across 3+ zones
- **Payment records**: Immutable audit trail, 7-year retention
- **Seat holds**: Ephemeral (Redis with TTL), acceptable loss on failure (auto-releases)
- **Queue state**: Durable during on-sale window, can be rebuilt from checkpoints

---

## 3. Capacity Estimations (Back-of-Envelope)

### Assumptions

- 80M monthly active users (MAU) globally
- 20M daily active users (DAU) on average
- 500M tickets sold annually
- Average event: 10,000 seats
- High-demand events: 50,000-80,000 seats (stadiums)
- Mega on-sales: up to 14M concurrent users for a single event
- Average user browses 5 events, views 2 seat maps per session

### Traffic Estimations

| Metric | Estimation | Calculation |
|--------|------------|-------------|
| DAU | 20M | 80M MAU x 0.25 daily ratio |
| Read QPS (avg) | ~12,000 | 20M users x 50 reads / 86,400s |
| Read QPS (peak) | ~120,000 | 10x average during evenings |
| Write QPS (avg) | ~120 | 500M tickets / 365 days / 86,400s |
| Write QPS (peak on-sale) | ~500,000 | 14M users x 3 attempts / 85s burst window |
| Seat hold QPS (mega event) | ~1,000,000 | Millions of concurrent SETNX attempts |
| Queue join QPS (mega event) | ~2,000,000 | 14M users joining in 10-minute window |

### Storage Estimations

| Data Type | Size per Record | Annual Volume | Annual Storage |
|-----------|-----------------|---------------|----------------|
| Events | ~2 KB | 500K events | ~1 GB |
| Venues + Seat Maps | ~500 KB/venue | 50K venues | ~25 GB |
| Tickets | ~200 bytes | 500M | ~100 GB |
| Orders | ~500 bytes | 200M orders | ~100 GB |
| User Profiles | ~1 KB | 80M users | ~80 GB |
| User Activity Logs | ~200 bytes | 10B events/year | ~2 TB |
| Payment Records | ~1 KB | 200M | ~200 GB |
| **Total (Year 1)** | | | **~2.5 TB** |
| **Total (Year 5)** | | | **~12 TB** |

### Bandwidth Estimations

| Scenario | Calculation | Bandwidth |
|----------|-------------|-----------|
| Normal browsing | 120K QPS x 5 KB avg response | ~600 MB/s |
| Seat map rendering | 50K QPS x 50 KB (SVG + data) | ~2.5 GB/s |
| Mega on-sale (inbound) | 2M QPS x 1 KB request | ~2 GB/s |
| Mega on-sale (outbound) | 2M QPS x 2 KB response | ~4 GB/s |
| CDN-served (static) | 90% cache hit ratio | Offloaded to CDN edge |

### Cache Estimations

| Cache Layer | Purpose | Size |
|-------------|---------|------|
| CDN Edge | Static assets, event pages, venue maps | ~500 GB globally |
| Application Cache (Redis) | Active seat maps, holds, session state | ~50 GB per region |
| Queue State (Redis/DynamoDB) | Active queue positions, tokens | ~10 GB per mega on-sale |
| Search Index | Event catalog, full-text search | ~20 GB |

---

## 4. SLOs / SLAs

| Metric | Target | Measurement |
|--------|--------|-------------|
| Availability (browsing) | 99.99% | Synthetic monitors, real-user monitoring |
| Availability (on-sale) | 99.9% | Success rate of checkout completions |
| Seat hold latency (p99) | < 50ms | Redis SETNX operation timing |
| Checkout completion (p99) | < 5s | End-to-end from cart to confirmation |
| Queue fairness | 99.5% FIFO (First-In-First-Out, like a line at a store) ordering | Position inversions < 0.5% |
| Double-sell rate | 0.000% | Zero tolerance -- strong consistency |
| Bot detection rate | > 99% | Blocked vs. total bot attempts |
| Ticket delivery (p99) | < 10s | Time from payment to ticket in app |
| Error rate (on-sale) | < 1% | HTTP 5xx / total requests |
| Queue throughput | 5,000 users/min into protected zone | Leaky bucket drain rate per event |

---

## 5. Key Design Constraints

| Constraint | Impact |
|------------|--------|
| **Finite inventory** | Cannot "add more" -- each seat is unique and non-fungible |
| **Time-bounded sales** | On-sales have precise start times creating instant traffic spikes |
| **Fairness requirements** | Users expect FIFO (First-In-First-Out, like a line at a store) ordering; perceived unfairness causes brand damage |
| **Payment processor latency** | External dependency (3-5s) during highest-contention window |
| **Regulatory compliance** | BOTS Act (US), consumer protection laws, ADA accessibility |
| **Multi-tenant venues** | Same venue hosts different events with different configurations |
| **Legacy systems** | 4.5M+ lines across 13 platforms; C++ Inventory Core with assembly |

---

## 6. Latency Budget Breakdown

End-to-end latency for the critical seat hold path:

| Step | Budget | Component | Notes |
|------|--------|-----------|-------|
| **Client → CDN** | 5ms | Network | Edge PoP within 50ms of user |
| **CDN → Edge Worker** | 2ms | Edge compute | JWT validation, bot pre-screening |
| **Edge → API Gateway** | 10ms | Network + TLS | Internal network hop to origin |
| **Auth + rate limiting** | 3ms | Gateway | Token validation + bucket check |
| **Queue access validation** | 2ms | Gateway | Verify access token + event scope |
| **Seat hold (SETNX pipeline)** | 5ms | Redis | Pipeline: N SETNXs + N EXPIREs |
| **Rollback if partial failure** | 3ms | Redis | Lua CAS-delete for acquired seats |
| **Hold persistence (async)** | 0ms | Event queue | Fire-and-forget; not on response path |
| **Response serialization** | 2ms | App server | Hold ID + expiry + pricing |
| **Origin → CDN → Client** | 15ms | Network | Return path |
| **Total budget** | **~47ms** | | Well within 50ms p99 target |

The dominant contributor is network latency (32ms round-trip). The Redis SETNX itself takes <1ms. For checkout, add 3-5 seconds for payment gateway roundtrip.

---

## 7. Capacity Planning Decision Matrix

| Growth Scenario | Trigger Metric | Action Required | Lead Time |
|----------------|---------------|-----------------|-----------|
| **2x MAU** | Monthly active users > 160M | Scale search, event DB read replicas; expand CDN capacity | 2-4 weeks |
| **Mega on-sale (Taylor Swift scale)** | Expected demand > 5M concurrent | Dedicated event cluster: isolated Redis + app pool + payment routing | 5-7 days pre-event |
| **Peak hold QPS doubles** | Sustained SETNX > 2M/sec | Add Redis shards (20 → 40); pre-shard seat keys by section | 1-2 days |
| **New geographic region** | Business expansion to Asia/EU | CDN PoPs, regional queue infrastructure, data residency compliance | 4-8 weeks |
| **Payment gateway at limit** | Total gateway TPS < 80% of checkout demand | Onboard additional payment gateway; update circuit breaker config | 2-4 weeks |
| **WebSocket connection ceiling** | Concurrent WS connections > 80% of server capacity | Add WS gateway instances; implement SSE fallback tier | 1-2 days (auto-scale) |
| **10x scale** | >5B tickets/year or >50M concurrent queue users | Event-level cluster isolation; edge-computed queue; lottery for extreme demand | 6-12 months |

---

## 8. Cost Estimation Model

| Cost Component | Formula | Monthly Estimate (at current scale) |
|---------------|---------|--------------------------------------|
| **CDN (Fastly)** | ~100 TB/month bandwidth + edge compute | ~$150K |
| **Compute (app services)** | ~100 pods avg, 300 peak × $0.05/pod-hour × 730h | ~$110K |
| **Redis Cluster** | 20 nodes × $0.12/node-hour × 730h | ~$175K |
| **PostgreSQL (primary + replicas)** | 4 shards × 3 replicas × $0.15/hour × 730h | ~$131K |
| **NoSQL (queue state)** | On-demand scaling, ~50M WCU/month | ~$65K |
| **WebSocket infrastructure** | 150 servers peak × $0.08/hour × 200h/month (event hours) | ~$24K |
| **Payment gateway fees** | 500M tickets × $2.50 avg × 2.9% + $0.30 | ~$40M (pass-through to customer) |
| **Search infrastructure** | 6 nodes × $0.10/hour × 730h | ~$44K |
| **Bot detection / WAF** | Enterprise tier | ~$80K |
| **Object storage + backups** | ~50 TB × $0.023/GB | ~$1.2K |
| **Total infrastructure** | | **~$780K/month** |

*Note: Payment processing fees ($40M/month) are pass-through fees charged to customers as service fees. Infrastructure costs are dominated by CDN and Redis -- the two components that absorb the thundering herd.*

---

## 9. Event-Level Resource Allocation

Different events require different resource profiles. Pre-allocation is based on demand prediction:

| Event Tier | Example | Queue Capacity | Redis Nodes | App Instances | WS Servers | Payment TPS |
|-----------|---------|---------------|-------------|---------------|------------|-------------|
| **Tier 1 (Mega)** | Taylor Swift, BTS | 15M+ | 20 dedicated | 200+ | 150 | 500+ (multi-gateway) |
| **Tier 2 (High)** | Drake, Coldplay | 1-5M | 10 shared | 50-100 | 50 | 200 |
| **Tier 3 (Standard)** | Regional artists, theater | 50K-500K | Shared cluster | 10-20 | 10 | 50 |
| **Tier 4 (Low)** | Local events, comedy clubs | <50K | Shared cluster | Shared pool | Shared | Shared |

Tier classification is automated using a demand prediction model based on: artist social media followers, historical ticket sales, venue capacity, pre-registration count, and market signals.

---

## 10. Geographic Traffic Distribution

| Region | % of Annual Tickets | Peak Driver | Infrastructure |
|--------|-------------------|-------------|---------------|
| **North America** | ~55% | NFL, NBA, major concerts | Primary region (US-East); CDN PoPs in 50+ cities |
| **Europe (UK/EU)** | ~25% | Premier League, festivals, theater | EU region (London/Frankfurt); GDPR-compliant data residency |
| **Latin America** | ~10% | Latin pop, soccer | Served from US-South region; CDN PoPs in 10+ cities |
| **Asia-Pacific** | ~7% | K-pop, cricket (India/AU) | AP region planned; currently served from US-West |
| **Rest of World** | ~3% | Distributed across markets | CDN coverage only; routed to nearest primary region |

Traffic patterns follow entertainment schedules: concerts peak Thursday-Saturday evenings, sports follow league calendars, and theater maintains steady weekday demand. The most dangerous pattern is a global artist with simultaneous worldwide on-sale (e.g., BTS world tour), requiring multi-region queue coordination.

---

## 11. Key Estimation Insights

1. **Reads collapse during on-sale, writes explode**: Normal operation is 100:1 read:write ratio. During an on-sale, the seat hold path inverts this to ~1:1 as every user action creates a Redis write (SETNX attempt). The system must handle both extremes with different infrastructure -- CDN/cache-heavy for reads, Redis-heavy for writes.

2. **The CDN is the largest capacity absorber**: At 90-95% cache hit ratio, the CDN handles 90% of all requests during on-sales (static waiting room pages, venue SVGs, JS/CSS). Without CDN edge absorption, origin infrastructure costs would be 10x higher.

3. **Payment gateway is the throughput ceiling**: Internal infrastructure can scale to millions of ops/sec, but external payment gateways cap at 100-500 TPS per merchant. The leaky bucket drain rate should be calibrated to total payment gateway capacity, not internal system capacity.

4. **Queue state is the least storage-intensive but most write-intensive component**: 14M queue entries at ~200 bytes each = ~2.8 GB total -- trivial storage. But writing 14M entries in a 10-minute window = ~23,300 writes/sec sustained. A NoSQL store with auto-scaling write capacity handles this naturally.

5. **Event-level isolation prevents noisy neighbor effects**: A mega event's resource requirements exceed the shared pool's capacity. Without event-level isolation, a Taylor Swift on-sale would degrade service for all other concurrent events on the platform.
