# 14.12 AI-Native Field Service Management for SMEs — Requirements & Estimations

## Functional Requirements

| ID | Requirement | Description | Notes |
|---|---|---|---|
| **FR-01** | **AI Job Scheduling** | System automatically assigns incoming service requests to optimal technicians based on skills, location, availability, vehicle inventory, SLA urgency, and customer preferences; re-optimizes incrementally on every schedule disruption | Must produce assignment within 5 seconds; supports manual override by dispatcher |
| **FR-02** | **Route Optimization** | Compute Pareto-optimal routes for each technician considering time windows, real-time traffic, break requirements, and emergency slack; re-route dynamically when schedule changes | Vehicle Routing Problem with Time Windows (VRPTW); 15-minute re-optimization cycles |
| **FR-03** | **Work Order Management** | Full lifecycle management of service requests: creation (manual, IoT-triggered, recurring), assignment, dispatch, execution (status tracking, notes, photos), completion, and invoicing | Support for parent-child work orders (multi-visit jobs), templates per service type |
| **FR-04** | **Offline-First Mobile App** | Technicians can view jobs, update status, capture photos/signatures, generate invoices, and collect payments entirely offline; data syncs automatically when connectivity resumes | CRDT-based conflict resolution; delta sync protocol; embedded local database |
| **FR-05** | **Customer Communication** | Automated notifications across the service lifecycle: booking confirmation, day-before reminders, real-time ETA updates (GPS-driven), technician arrival alerts, post-service summaries, and feedback requests | Multi-channel: SMS, WhatsApp, email; merchant-customizable templates |
| **FR-06** | **Invoice Generation** | On-device invoice creation with complex pricing: flat-rate service books, time-and-materials calculation, warranty coverage verification, membership discounts, tax computation; digital signature capture | Deterministic pricing engine with versioned price books; PDF generation offline |
| **FR-07** | **Payment Collection** | Accept payments on-site via mobile POS (card tap/swipe/insert), UPI, bank transfer, or cash with receipt generation; automatic reconciliation with accounting systems | Offline payment queuing for card transactions; real-time UPI verification when online |
| **FR-08** | **IoT Predictive Maintenance** | Ingest sensor telemetry from connected equipment (HVAC, plumbing, electrical); detect anomalies; estimate remaining useful life; auto-generate preventive work orders when failure probability exceeds threshold | Support for multiple sensor types: vibration, temperature, pressure, power draw |
| **FR-09** | **Vehicle Inventory Tracking** | Real-time visibility into parts and materials on each technician's vehicle; automatic replenishment order generation; parts transfer suggestions between nearby technicians | Barcode/QR scanning for parts check-in/check-out; integration with supplier catalogs |
| **FR-10** | **Customer Equipment Profiles** | Maintain detailed equipment records per customer location: make, model, serial number, installation date, service history, warranty status, connected IoT sensors, and maintenance schedule | Equipment hierarchy (site → system → unit → component); QR code tagging |
| **FR-11** | **Technician Skill Management** | Track certifications, skill levels, training history, and specializations per technician; auto-filter assignments based on job skill requirements; alert on expiring certifications | Skill-to-job-type matching matrix; certification renewal workflow |
| **FR-12** | **Reporting & Analytics** | Dashboard showing fleet utilization, first-time-fix rate, average response time, revenue per technician, customer satisfaction scores, and AI scheduling effectiveness metrics | Daily AI-generated operational briefing; trend analysis; anomaly detection |

---

## Out of Scope

- **Equipment sales and e-commerce**: Platform manages service operations only, not product retail
- **Apprenticeship and training content delivery**: Skill tracking but not learning management
- **Full ERP/accounting**: Integration with external accounting systems, not replacement
- **Building/facility management**: Focus on dispatched field service, not fixed-site facility operations
- **Customer self-service portals for complex configuration**: Customers can book service and view history, not configure system parameters

---

## Non-Functional Requirements

### Performance SLOs

| Operation | Target | P99 Target | Measurement |
|---|---|---|---|
| Schedule optimization (single job insertion) | < 3 seconds | < 5 seconds | Time from new job creation to technician assignment |
| Full schedule re-optimization (50-tech fleet) | < 10 seconds | < 20 seconds | Time to re-solve after major disruption |
| Mobile app job list load (offline) | < 200 ms | < 500 ms | Local database query time on technician device |
| Mobile app sync (delta) | < 5 seconds | < 15 seconds | Time to sync changes when connectivity resumes |
| ETA calculation update | < 2 seconds | < 5 seconds | GPS position to customer-facing ETA |
| Invoice generation (on-device) | < 3 seconds | < 5 seconds | From "generate invoice" tap to PDF preview |
| IoT telemetry ingestion | < 30 seconds | < 60 seconds | Sensor reading to anomaly detection evaluation |
| Customer notification delivery | < 30 seconds | < 60 seconds | From trigger event to SMS/WhatsApp delivery |
| API response (CRUD operations) | < 200 ms | < 500 ms | Server-side processing time |
| Search (customer/job lookup) | < 300 ms | < 800 ms | Full-text search across customer and job records |

### Reliability & Availability

| Requirement | Target | Notes |
|---|---|---|
| Overall platform availability | 99.9% (8.76 hrs downtime/year) | Excludes planned maintenance windows |
| Scheduling engine availability | 99.95% | Critical path — manual fallback if down |
| Mobile app offline capability | 100% core workflows | Job view, status update, photo, signature, invoice must work fully offline |
| Data durability | 99.999999% (8 nines) | All job records, invoices, customer data |
| Sync reliability | 99.99% | No data loss during offline-to-online sync |
| IoT pipeline availability | 99.5% | Degraded mode acceptable; batch catch-up on recovery |
| Payment processing uptime | 99.95% | Fallback to offline queuing when payment gateway unavailable |
| RTO (Recovery Time Objective) | < 30 minutes | Full service restoration after infrastructure failure |
| RPO (Recovery Point Objective) | < 1 minute | Maximum data loss window |

---

## Critical Constraints and Assumptions

| Constraint | Value | Impact on Architecture |
|---|---|---|
| **Max fleet size per SME** | 100 technicians | Determines scheduling engine per-tenant memory cap; fleets >100 require dedicated engine instance |
| **Offline duration tolerance** | Up to 8 hours continuous | CRDT change accumulation buffer on device; sync payload may reach 500+ changes |
| **IoT sensor sampling rate** | 1 reading/hour per metric (configurable up to 1/minute) | Pipeline throughput at default rate: 48M/day; at max rate: 2.88B/day (requires tier upgrade) |
| **Pricing change frequency** | Average 2-3 updates per month per tenant | 24-hour pricing tolerance window covers 99.7% of offline invoicing windows without flags |
| **Customer time window granularity** | 2-hour windows (standard), 1-hour (premium) | Tighter windows constrain scheduling feasibility; impacts ALNS search space |
| **Minimum scheduling window** | 45 minutes (job duration + travel) | Jobs shorter than 45 min combined don't justify a separate visit; batched with adjacent jobs |
| **Maps API budget** | $15K/month (~3M calls/month) | Forces aggressive caching; real-time API calls limited to top-5 candidates per optimization |
| **Mobile app storage budget** | < 150 MB per device | Constrains local database size, model size, and photo cache; aggressive Cutting off unnecessary steps required |

---

## Capacity Estimations

### User Scale

| Parameter | Value | Basis |
|---|---|---|
| Target SME customers (businesses) | 50,000 | SMEs with 5-50 field technicians |
| Average technicians per SME | 12 | Mix of small (5-tech) and medium (50-tech) businesses |
| Total technicians on platform | 600,000 | 50,000 × 12 |
| Total dispatchers/office staff | 100,000 | ~2 per SME average |
| End customers (service recipients) | 25,000,000 | Average 500 customers per SME |
| Connected IoT devices | 2,000,000 | ~40 per SME average (connected equipment) |

### Traffic Scale

| Parameter | Calculation | Daily Volume |
|---|---|---|
| Jobs created per day | 600,000 technicians × 4 jobs/day | 2,400,000 |
| Schedule optimization requests | 2,400,000 jobs + 20% re-optimizations | 2,880,000 |
| GPS location updates | 600,000 techs × 8 hrs × 12/hr | 57,600,000 |
| Mobile app sync events | 600,000 techs × 20 syncs/day | 12,000,000 |
| IoT telemetry data points | 2,000,000 devices × 24 readings/day | 48,000,000 |
| Customer notifications | 2,400,000 jobs × 4 notifications/job | 9,600,000 |
| Invoice generations | 2,400,000 jobs × 85% completion rate | 2,040,000 |
| Photo uploads | 2,400,000 jobs × 3 photos/job | 7,200,000 |
| API calls (total) | Sum of all interactions | ~150,000,000 |
| Peak QPS (API) | 150M / 86,400 × 3 (peak factor) | ~5,200 QPS |

### Storage Estimates

| Data Type | Calculation | Annual Volume |
|---|---|---|
| Job records | 2,400,000/day × 5 KB × 365 | ~4.4 TB/year |
| GPS traces | 57,600,000/day × 100 B × 365 | ~2.1 TB/year |
| IoT telemetry | 48,000,000/day × 200 B × 365 | ~3.5 TB/year |
| Photos | 7,200,000/day × 500 KB × 365 | ~1.3 PB/year |
| Invoices (PDF) | 2,040,000/day × 200 KB × 365 | ~149 TB/year |
| Customer records | 25,000,000 × 10 KB | ~250 GB (growing) |
| Equipment profiles | 25,000,000 × 50 equip × 5 KB | ~6.25 TB |
| **Total (Year 1)** | | **~1.5 PB** |

### Compute Estimates

| Component | Requirement | Basis |
|---|---|---|
| Scheduling engine | 200 cores, 800 GB RAM | In-memory schedule graph for 50K SMEs; parallel optimization |
| Route optimization | 100 cores | Distance matrix computation, VRPTW solving |
| IoT pipeline | 50 cores, 200 GB RAM | Stream processing for 48M data points/day |
| API servers | 150 cores | 5,200 peak QPS with headroom |
| ML inference (predictive maintenance) | 40 cores + 8 GPUs | Anomaly detection, RUL estimation models |
| Notification service | 30 cores | 9.6M notifications/day with template rendering |
| Sync service | 80 cores | 12M sync events/day with conflict resolution |

### Cost Drivers

| Driver | Monthly Estimate | Notes |
|---|---|---|
| Compute (managed Kubernetes) | $45,000 | Auto-scaling; spot instances for batch workloads |
| Object storage (photos, PDFs) | $30,000 | Tiered storage; lifecycle policies for older data |
| Database (relational + document) | $25,000 | Multi-region replicas; read replicas for analytics |
| Message queue / streaming | $8,000 | Event bus for job lifecycle, IoT pipeline |
| Maps / geocoding API | $15,000 | Distance matrix, geocoding, traffic data |
| SMS / WhatsApp notifications | $35,000 | 9.6M/day at blended rate; WhatsApp Business API |
| IoT ingestion infrastructure | $10,000 | Time-series database, stream processing |
| CDN and bandwidth | $12,000 | Photo delivery, app updates |
| ML training and inference | $8,000 | Model retraining, GPU inference |
| **Total monthly** | **~$188,000** | **$3.76/SME/month infrastructure cost** |

---

## SLO Error Budgets

| SLO | Target | Monthly Budget | Burn-Rate Alert |
|---|---|---|---|
| Platform availability | 99.9% | 43.8 min downtime | 1-hour burn >3× → page on-call; 6-hour burn >1.5× → Slack alert |
| Scheduling engine availability | 99.95% | 21.9 min downtime | 30-min burn >5× → page immediately; 1-hour burn >2× → Slack |
| Job assignment latency P95 | < 3 seconds | 5% of assignments >3s (~144K/month) | 15-min window: >8% → P2; >15% → P1 |
| Mobile sync success rate | 99.99% | 1,200 failed syncs/month | Hourly rate >0.03% → investigate; >0.1% → page |
| Invoice accuracy | 99.9% | 2,040 mismatches/month | Daily rate >0.3% → P3; >1% → P2 |
| ETA accuracy (±10 min) | 90% | 10% outside window (~240K jobs/month) | Daily average <85% → P3; <80% → P2 |
| IoT anomaly detection latency P95 | < 60 seconds | 5% of detections >60s | 15-min window: P95 >90s → P3; >120s → P2 |
| Notification delivery | 99.5% | 0.5% undelivered (~48K/month) | Hourly rate <98% → investigate provider; <95% → switch fallback |

**Error budget policy:** When >50% of monthly error budget consumed in first 10 days, freeze non-critical deployments and conduct architecture review. When >80% consumed, freeze all changes except bug fixes and reliability improvements.

---

## Hardware and Cost Estimations

### Compute Instance Sizing

| Component | Instance Profile | Quantity | Rationale |
|---|---|---|---|
| Scheduling Engine | 8 vCPU, 32 GB RAM, high-memory | 25-30 instances | In-memory schedule for ~1,700 tenants/instance; CPU-bound during ALNS |
| API Gateway | 4 vCPU, 8 GB RAM, network-optimized | 10-20 instances | 5,200 peak QPS; SSL termination; auth validation |
| Job Service | 4 vCPU, 16 GB RAM | 8-15 instances | Event sourcing write path; high I/O |
| Sync Service | 4 vCPU, 16 GB RAM, network-optimized | 15-30 instances | 12M sync events/day; CRDT merge computation |
| IoT Pipeline | 4 vCPU, 16 GB RAM | 8-12 instances | Stream processing; anomaly model inference |
| ML Inference (Predictive Maintenance) | 4 vCPU, 16 GB RAM, 1 GPU each | 8 instances | Anomaly detection + RUL estimation models |
| Notification Service | 2 vCPU, 8 GB RAM | 6-10 instances | Template rendering; provider API calls |
| Invoice/Payment Service | 4 vCPU, 8 GB RAM | 4-8 instances | Pricing computation; PDF generation |

### Storage Breakdown

| Storage Type | Size (Year 1) | Growth Rate | Cost Driver |
|---|---|---|---|
| Relational DB (jobs, customers, invoices) | ~5 TB | ~4 TB/year | IOPS for scheduling queries; replication overhead |
| Time-Series DB (IoT, GPS) | ~6 TB | ~5 TB/year | Ingestion throughput; retention tiering |
| Object Storage (photos) | ~1.3 PB | ~1.3 PB/year | By far the largest; lifecycle policies critical |
| Object Storage (PDFs) | ~150 TB | ~150 TB/year | Invoice archive; 7-year regulatory retention |
| Cache (schedules, ETAs, distance matrix) | ~200 GB | ~50 GB/year | Fast read path; memory cost |
| Event Store (job lifecycle events) | ~2 TB | ~2 TB/year | Immutable append-only; powers audit and projections |

### Network Bandwidth

| Traffic Type | Peak Bandwidth | Daily Volume | Notes |
|---|---|---|---|
| Photo uploads (technician → cloud) | ~250 Mbps | ~3.6 TB/day | Compressed JPEG; batched during sync |
| Sync traffic (mobile ↔ server) | ~150 Mbps | ~1.2 TB/day | Delta encoding; gzip compressed |
| IoT telemetry ingestion | ~20 Mbps | ~9.6 GB/day | Small payloads; high message count |
| GPS location updates | ~10 Mbps | ~5.8 GB/day | 100 bytes × 57.6M updates |
| Notification API calls (outbound) | ~5 Mbps | ~2 GB/day | SMS/WhatsApp provider API calls |
| Maps API calls (outbound) | ~3 Mbps | ~1 GB/day | Distance matrix + geocoding requests |

---

## 3-Year Growth Projections

| Parameter | Year 1 | Year 2 | Year 3 | Growth Assumptions |
|---|---|---|---|---|
| SME tenants | 50,000 | 85,000 | 130,000 | 70% Y1→Y2 growth (market entry), 53% Y2→Y3 |
| Total technicians | 600,000 | 1,020,000 | 1,560,000 | Proportional to tenant count |
| Daily jobs | 2.4M | 4.1M | 6.2M | +growing jobs/tech as platform drives utilization |
| IoT devices | 2M | 5M | 12M | IoT adoption accelerating faster than tenant growth |
| Daily API calls | 150M | 280M | 450M | Growing per-tenant usage as features expand |
| Storage (cumulative) | 1.5 PB | 4.5 PB | 9 PB | Dominated by photos; lifecycle policies critical |
| Monthly infrastructure cost | $188K | $340K | $520K | Sublinear scaling via optimization; unit cost drops |
| Cost per SME/month | $3.76 | $4.00 | $4.00 | Stable as scale efficiencies offset growth |

---

## Scope Boundaries and Rationale

| Boundary | In Scope | Out of Scope | Rationale |
|---|---|---|---|
| **Scheduling** | AI-optimized assignment, route optimization, real-time re-scheduling | Customer self-scheduling (beyond time window preference) | SME dispatchers need control; customer self-scheduling creates constraint explosion |
| **IoT** | Ingest, anomaly detection, RUL, auto work-order creation | IoT device provisioning, firmware management | Device lifecycle is a separate domain; FSM focuses on the data, not the hardware |
| **Invoicing** | On-device generation, versioned pricing, multi-method payment | Full accounts receivable, collections, credit management | AR/collections is an accounting domain; FSM hands off to accounting system after payment |
| **Mobile** | Offline-first job workflow, photos, signatures, invoicing | Technician training content, video conferencing, social features | Mobile app is a productivity tool, not a learning or communication platform |
| **Analytics** | Fleet utilization, first-fix rate, revenue per tech, AI effectiveness | Customer churn prediction, market expansion analysis | Operational analytics in scope; strategic analytics belongs in business intelligence tooling |
| **Customer Portal** | Service booking, status tracking, invoice viewing, feedback | Complex equipment configuration, warranty claims processing | Simple customer interaction; complex warranty workflows belong in dedicated claims systems |

---

## SLO Summary Dashboard

| SLO | Target | Measurement Method | Alert Threshold |
|---|---|---|---|
| Job assignment latency | P95 < 3s | Timer from job creation to assignment event | P95 > 4s for 5 min |
| Schedule re-optimization time | P95 < 10s | Timer from disruption event to new schedule | P95 > 15s for 5 min |
| Mobile sync success rate | 99.99% | Successful syncs / total sync attempts | < 99.95% over 1 hr |
| Offline workflow completion | 100% | Core workflows executable without connectivity | Any offline failure |
| ETA accuracy | ±10 min for 90% of jobs | Predicted ETA vs. actual arrival time | < 85% accuracy over 1 day |
| First-time-fix rate (AI-assisted) | > 88% | Jobs completed without follow-up visit | < 85% over 1 week |
| Invoice accuracy | 99.9% | Invoices without manual correction | < 99.5% over 1 day |
| Customer notification delivery | 99.5% | Delivered notifications / triggered notifications | < 99% over 1 hr |
| IoT anomaly detection latency | P95 < 60s | Sensor reading to anomaly alert | P95 > 120s for 15 min |
| Platform availability | 99.9% | Uptime monitoring across all services | Any service < 99.5% over 1 hr |
