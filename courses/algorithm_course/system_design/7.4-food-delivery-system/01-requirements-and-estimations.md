# Requirements & Estimations

## 1. Functional Requirements

### 1.1 Customer-Facing

| Requirement | Description |
|------------|-------------|
| **Restaurant Discovery** | Browse, search, and filter restaurants by cuisine, rating, delivery time, distance, price range, and dietary preferences |
| **Menu Browsing** | View restaurant menu with items, descriptions, prices, images, categories, and modifiers (size, toppings, spice level) |
| **Cart Management** | Add/remove items, apply promo codes, select delivery address, view itemized cost breakdown (subtotal, delivery fee, service fee, tip, taxes) |
| **Order Placement** | Place order with payment authorization, receive order confirmation with initial ETA |
| **Real-Time Tracking** | Track order through all lifecycle stages; see driver location on map after pickup; receive push notifications at state transitions |
| **Rating & Reviews** | Rate restaurant (food quality, accuracy) and driver (delivery experience) on 1-5 scale with optional text review |
| **Order History** | View past orders with re-order capability |
| **Scheduled Orders** | Place orders for future delivery (up to 7 days ahead) |

### 1.2 Restaurant-Facing

| Requirement | Description |
|------------|-------------|
| **Order Reception** | Receive new orders on tablet with audio alert; accept or reject within configurable timeout (default: 3 min) |
| **Preparation Status** | Mark order as "preparing" and "ready for pickup" to trigger driver dispatch timing |
| **Menu Management** | Update menu items, prices, availability, prep time estimates; bulk enable/disable items; set restaurant hours |
| **Inventory Control** | Mark items as out-of-stock in real-time (propagates to customer app within seconds) |
| **Order History & Analytics** | View order history, average prep times, ratings, revenue summary |
| **Pause/Resume Orders** | Temporarily stop accepting new orders during kitchen overload |

### 1.3 Driver-Facing

| Requirement | Description |
|------------|-------------|
| **Delivery Offers** | Receive delivery assignment offers with restaurant name, pickup distance, delivery distance, estimated pay; accept/decline within timeout (30-60s) |
| **Navigation** | Turn-by-turn navigation to restaurant and then to customer, with map integration |
| **Status Updates** | Mark "arrived at restaurant," "picked up order," "arrived at customer," "delivered"; each triggers state transition and customer notification |
| **Earnings Dashboard** | View current shift earnings, delivery history, tips, incentive bonuses |
| **Availability Toggle** | Go online/offline; set vehicle type and delivery preferences |
| **Stacked Orders** | Accept multiple orders for batched delivery; view optimized route |

### 1.4 Platform / System

| Requirement | Description |
|------------|-------------|
| **Dispatch & Matching** | Automatically assign the optimal driver to each order based on proximity, ETA, acceptance probability, and current load |
| **ETA Prediction** | Compute and continuously update delivery ETA combining prep time, driver travel, and traffic conditions |
| **Dynamic Pricing** | Adjust delivery fees based on supply-demand ratio per geographic zone, time of day, and weather |
| **Payment Processing** | Authorize payment at order placement; capture after delivery; handle tips, refunds, splits |
| **Fraud Detection** | Detect fraudulent orders (stolen cards, fake delivery confirmations, GPS spoofing) |
| **Promotions Engine** | Apply promo codes, first-order discounts, loyalty rewards, restaurant-funded deals |
| **Cancellations & Refunds** | Handle cancellations at any order stage with appropriate refund logic |

---

## 2. Order Lifecycle State Machine

```
PLACED → CONFIRMED → PREPARING → READY_FOR_PICKUP → DRIVER_ASSIGNED →
DRIVER_AT_RESTAURANT → PICKED_UP → DRIVER_EN_ROUTE → DELIVERED

Branching paths:
  PLACED → CANCELLED_BY_CUSTOMER (before restaurant confirms)
  CONFIRMED → REJECTED_BY_RESTAURANT
  Any pre-pickup state → CANCELLED_BY_CUSTOMER (with partial/full refund)
  PICKED_UP → DELIVERY_FAILED → REFUNDED
  DELIVERED → REFUND_REQUESTED → REFUNDED | REFUND_DENIED
```

---

## 3. Non-Functional Requirements

| Requirement | Target | Rationale |
|-------------|--------|-----------|
| **Driver Assignment Latency** | <30 seconds from order placement | Customers expect near-instant confirmation that a driver is on the way |
| **ETA Accuracy** | Within ±5 min for 80% of orders | Primary customer satisfaction metric; drives re-order rates |
| **Location Update Freshness** | <2 seconds from driver phone to tracking map | Real-time tracking is a core UX feature |
| **Order Placement Latency** | <500ms (API response) | Cart-to-confirmation must feel instant |
| **System Availability** | 99.99% during meal peaks (11am-2pm, 5pm-9pm) | Revenue loss during peak hours is 10× off-peak |
| **Menu Update Propagation** | <5 seconds from restaurant update to customer app | Out-of-stock items must disappear quickly to prevent failed orders |
| **Notification Delivery** | <3 seconds from state transition to push notification | Customers track orders via push notifications |
| **Data Durability** | Zero order loss | Every placed order must be persisted before acknowledgment |
| **Payment Consistency** | Strong consistency (no double-charge, no missed capture) | Financial accuracy is non-negotiable |
| **Geographic Coverage** | Support 30+ countries with regional data sovereignty | GDPR, local payment regulations, language support |

---

## 4. Capacity Estimations

### 4.1 Order Volume

```
Daily orders:           5,000,000
Seconds per day:        86,400

Average order rate:     5,000,000 / 86,400 ≈ 58 orders/sec

Peak hours (4h lunch + 4h dinner = 8h):
  ~70% of daily orders during 8 peak hours
  Peak orders = 5,000,000 × 0.70 = 3,500,000 in 28,800 seconds
  Peak order rate = 3,500,000 / 28,800 ≈ 122 orders/sec

  Burst factor (15-min spike within peak): 5×
  Burst order rate = 122 × 5 ≈ 610 orders/sec
```

### 4.2 Driver Location Updates

```
Active drivers (peak):         500,000
Location update interval:      every 5 seconds
Location writes per second:    500,000 / 5 = 100,000 writes/sec

Each update payload:           ~200 bytes (driver_id, lat, lng, heading, speed, timestamp)
Location bandwidth:            100,000 × 200 bytes = 20 MB/sec = 160 Mbps

Daily location updates:        100,000 × 86,400 = 8.64 billion (peak assumes 24h; realistically ~12h active)
Realistic daily updates:       ~4.3 billion
```

### 4.3 Restaurant & Menu Data

```
Active restaurants:            800,000
Average menu items/restaurant: 120
Total menu items:              800,000 × 120 = 96,000,000 ≈ 100M items

Menu read QPS:
  Each order involves ~5 menu views (browsing)
  Menu read QPS = 58 × 5 = 290 reads/sec (average)
  Peak menu read QPS = 610 × 5 = 3,050 reads/sec
  With browsing-without-ordering (10× conversion rate):
  Peak browsing QPS = 3,050 × 10 = 30,500 reads/sec

Menu write QPS:
  ~1% of restaurants update menu per hour
  8,000 updates/hour = ~2.2 writes/sec
  Read:Write ratio = ~14,000:1 → extremely read-heavy → aggressive caching
```

### 4.4 Real-Time Tracking

```
Active orders being tracked:   ~200,000 concurrent (during peak)
Tracking update frequency:     every 5 seconds (piggybacks on driver location)
Tracking reads per second:     200,000 / 5 = 40,000 reads/sec (customer polling)
  OR with WebSocket: 100,000 push events/sec (matches location write rate)

WebSocket connections (peak):  200,000 (customers) + 500,000 (drivers) = 700,000 concurrent
```

### 4.5 Storage Estimates

```
Orders:
  5M orders/day × 2 KB per order = 10 GB/day
  Yearly: 10 GB × 365 = 3.65 TB/year
  Retain 3 years: ~11 TB

Driver Location History:
  4.3B updates/day × 40 bytes each = 172 GB/day
  Retain 7 days (hot): 1.2 TB
  Retain 90 days (warm, aggregated): ~5 TB
  Archive 1 year (cold, sampled): ~2 TB

Menu Data:
  100M items × 1 KB avg = 100 GB (relatively static)
  With images (CDN): 100M × 200 KB avg = 20 TB on object storage

User Profiles:
  50M customers × 1 KB = 50 GB
  1M drivers × 2 KB = 2 GB
  800K restaurants × 5 KB = 4 GB

Ratings:
  5M ratings/day × 500 bytes = 2.5 GB/day → ~900 GB/year
```

### 4.6 Network & Bandwidth

```
API Gateway throughput (peak):
  Orders: 610 req/sec × 5 KB avg = 3 MB/sec
  Menu browsing: 30,500 req/sec × 10 KB avg = 305 MB/sec
  Location updates: 100,000 req/sec × 200 bytes = 20 MB/sec
  Tracking: 40,000 req/sec × 500 bytes = 20 MB/sec
  Total: ~350 MB/sec ≈ 2.8 Gbps
```

---

## 5. SLOs / SLAs

| Service | SLO | Measurement | Consequence of Breach |
|---------|-----|-------------|----------------------|
| **Order Placement** | p99 < 500ms | API response time from submit to confirmation | Customer drops cart; lost revenue |
| **Driver Assignment** | p90 < 30s, p99 < 60s | Time from order confirmation to driver notification | Customer sees "finding driver" too long; cancellation risk |
| **ETA Accuracy** | 80% within ±5 min | Absolute error between initial ETA and actual delivery | Customer dissatisfaction; low reorder rate |
| **Location Update Lag** | p99 < 2s | Time from driver GPS reading to customer map update | Tracking feels "laggy" or "jumpy" |
| **System Availability** | 99.99% during peak hours | Uptime of order placement + tracking endpoints | Revenue loss: ~$58K/minute during peak |
| **Menu Freshness** | p99 < 5s | Time from restaurant menu edit to customer-visible update | Out-of-stock items ordered → cancellations |
| **Notification Delivery** | p95 < 3s | Time from state transition to push notification receipt | Customer misses driver arrival |
| **Payment Processing** | 99.99% success rate | Payment authorization + capture success | Orders stuck in limbo; customer charged without delivery |
| **Search Latency** | p95 < 200ms | Restaurant discovery search response time | Slow browsing → lower conversion |
| **Dispatch Throughput** | Handle 700+ orders/sec | Sustained throughput of dispatch service during peak | Orders queue up; assignment delays cascade |

---

## 6. Autonomous & Mixed-Fleet Requirements (2025+)

| Requirement | Description |
|------------|-------------|
| **Robot Dispatch** | Dispatch engine must support sidewalk delivery robots (speed: 6 kph, range: 5 km) alongside human drivers; separate scoring model for robot eligibility |
| **Drone Flight Plan** | For drone-eligible orders: generate flight path, check airspace restrictions, verify landing zone; integrate with UTM (Unmanned Traffic Management) |
| **Fleet Mode Selection** | Determine optimal delivery mode (human, robot, drone) based on distance, order weight, weather, time-of-day, and zone regulations |
| **Ghost Kitchen Brand Mapping** | Map virtual restaurant brands to physical kitchen locations; single kitchen may operate 5-10 brands with different menus |
| **Ultrafast Fulfillment** | Support 15-minute delivery SLA for micro-fulfillment center orders; requires pre-staged inventory and sub-1-minute dispatch |

---

## 7. Critical Estimation Summary

| Metric | Average | Peak | Burst |
|--------|---------|------|-------|
| Order rate | 58/sec | 122/sec | 610/sec |
| Driver location writes | 60K/sec | 100K/sec | 130K/sec |
| Menu read QPS | 10K/sec | 30.5K/sec | 50K/sec |
| Tracking updates | 25K/sec | 40K/sec | 60K/sec |
| WebSocket connections | 400K | 700K | 900K |
| API gateway bandwidth | ~1 Gbps | ~2.8 Gbps | ~4 Gbps |
| Robot telemetry updates | 2K/sec | 5K/sec | 8K/sec |
| Ghost kitchen brand lookups | 3K/sec | 10K/sec | 15K/sec |

---

## 8. Cost Estimation Model

| Cost Component | Formula | Monthly Estimate (at 5M orders/day) |
|---------------|---------|--------------------------------------|
| **Compute (API + services)** | ~200 pods × $0.05/pod-hour × 730h | ~$730K |
| **Redis Cluster** | ~50 nodes × $0.10/node-hour × 730h | ~$365K |
| **PostgreSQL** | 16 shards × 2 replicas × $0.15/hour × 730h | ~$350K |
| **Kafka** | 30 brokers × $0.08/broker-hour × 730h | ~$175K |
| **Object Storage (images)** | 20 TB × $0.023/GB | ~$460 |
| **CDN (menu images + static)** | ~500 TB transfer/month × $0.085/GB | ~$42.5K |
| **WebSocket Gateway** | 20 instances × $0.12/hour × 730h | ~$175K |
| **ML Model Serving (ETA)** | 40 GPU instances × $0.50/hour × 730h | ~$1.46M |
| **Total estimated infrastructure** | | **~$3.3M/month** |

*Note: These are order-of-magnitude estimates. Actual costs vary significantly by provider negotiation, reserved instances, and regional pricing.*

---

## 9. Capacity Planning Decision Matrix

| Growth Scenario | Trigger Metric | Action Required | Lead Time |
|----------------|---------------|-----------------|-----------|
| **New city launch** | Business decision | Deploy city shard (Redis, Kafka partitions, DB shard); configure geo-router; seed restaurant catalog | 2-4 weeks |
| **City doubles order volume** | Sustained peak > 80% capacity for 3 days | Add PostgreSQL read replicas, Kafka partitions, Dispatch optimizer instances | 1-2 days (auto-scale handles most) |
| **10× global growth** | Total orders > 50M/day | Re-architecture: sub-city sharding, dedicated ML inference cluster, dedicated WebSocket fleet per region | 3-6 months |
| **Autonomous fleet integration** | Robot/drone delivery >5% of orders | New dispatch mode, telemetry pipeline, regulatory compliance layer | 6-12 months |
| **Holiday/event spike** | Event calendar + ML prediction | Pre-scale 2× across all services 30 min before predicted spike; activate surge preemptively | Automated (30 min) |

---

## 10. Latency Budget Breakdown

End-to-end latency must be allocated carefully across the order placement path:

| Step | Budget | Component | Notes |
|------|--------|-----------|-------|
| **Client → API Gateway** | 30ms | Network (CDN/edge) | Varies by geography; 10ms in-city, 50ms cross-continent |
| **API Gateway auth + routing** | 10ms | Gateway | JWT validation, rate check, route selection |
| **Order validation** | 20ms | Order Service | Item existence, price verification, restaurant open check |
| **Menu price check** | 5ms | Redis cache hit | Cache miss adds 50ms (rare: 0.1% miss rate) |
| **Payment authorization** | 200ms | Payment processor (external) | The dominant latency component; processor SLA is p99 < 500ms |
| **Order persistence** | 15ms | PostgreSQL (synchronous write) | Includes synchronous replication to standby |
| **Kafka event publish** | 5ms | Kafka ack (acks=1) | Async; customer doesn't wait for downstream processing |
| **Response serialization** | 5ms | Order Service → Gateway | Serialize order confirmation with ETA |
| **Gateway → Client** | 30ms | Network | Return path |
| **Total budget** | **~320ms** | | Leaves 180ms headroom within 500ms SLO |

The payment authorization step is the Slowest part of the process. Circuit breaker on the payment processor opens if p99 exceeds 500ms, falling back to "payment pending" mode where the order is placed but capture is retried asynchronously.

---

## 11. Geographic Distribution of Load

Order volume is not evenly distributed across hours or cities:

| Time Window | % of Daily Orders | Peak Cities | Notes |
|-------------|------------------|-------------|-------|
| **11:00-13:00** (lunch) | ~25% | Business districts: Manhattan, SF, Chicago Loop | Corporate lunch orders dominate |
| **17:00-21:00** (dinner) | ~45% | Residential areas: suburbs, college towns | Highest order values; family-sized orders |
| **21:00-01:00** (late night) | ~15% | Entertainment districts, university campuses | Smaller orders; limited restaurant availability |
| **01:00-11:00** (off-peak) | ~15% | Global off-peak distributed | Lowest load; scale-down opportunity |

This temporal distribution drives predictive auto-scaling: dinner prep starts at 16:30 (scale up), peaks 18:00-20:00, and winds down by 21:30 (gradual scale-down).
