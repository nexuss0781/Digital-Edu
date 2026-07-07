# Requirements & Capacity Estimations

## Functional Requirements

### Core CRM

| # | Requirement | Description |
|---|---|---|
| FR-1 | **Object Management** | CRUD operations on Contacts, Companies, Deals, Tickets, and 38+ standard object types |
| FR-2 | **Custom Objects** | User-defined object types with custom properties, supporting many-to-many associations |
| FR-3 | **Associations** | Bidirectional, labeled relationships between any object types (Contact ↔ Company ↔ Deal) |
| FR-4 | **Properties System** | Flexible schema — text, number, date, dropdown, boolean, calculated fields per object |
| FR-5 | **Timeline / Activity Feed** | Append-only activity log per record (emails, calls, meetings, notes, page views) |
| FR-6 | **Search & Filtering** | Property-based search across all objects with compound filters and sorting |
| FR-7 | **Lists & Segmentation** | Static and dynamic contact lists based on property/behavior criteria |

### Marketing Automation

| # | Requirement | Description |
|---|---|---|
| FR-8 | **Workflow Engine** | Visual DAG-based automation — triggers, conditions, branches, delays, actions |
| FR-9 | **Email Marketing** | Template design, personalization (merge fields, dynamic content), scheduling, A/B testing |
| FR-10 | **Email Delivery** | High-volume SMTP delivery with deliverability management (SPF/DKIM/DMARC, IP warming) |
| FR-11 | **Lead Scoring** | Rule-based + AI-powered scoring combining behavioral and demographic signals |
| FR-12 | **Forms & Landing Pages** | Form builder, submission tracking, progressive profiling |
| FR-13 | **Campaign Attribution** | Multi-touch attribution across channels (first-touch, last-touch, linear, U-shaped) |

### Platform

| # | Requirement | Description |
|---|---|---|
| FR-14 | **Multi-Hub Integration** | Marketing, Sales, Service, CMS, Commerce — unified data model across products |
| FR-15 | **API & Webhooks** | REST/GraphQL APIs for all objects; webhook subscriptions for real-time events |
| FR-16 | **App Marketplace** | OAuth-based third-party app ecosystem with scoped permissions |
| FR-17 | **Analytics & Reporting** | Dashboards, funnels, attribution reports, custom report builder |
| FR-18 | **Bi-directional Sync** | Native sync with Salesforce, external CRMs, and custom integrations |

### Scalability Requirements

| Dimension | Requirement |
|-----------|------------|
| Horizontal CRM scaling | Support 10x current QPS (15M peak) without architectural changes |
| Hublet provisioning | New Hublet operational within 2 weeks |
| Service deployment | Zero-downtime rolling deploys for all 3,000+ services |
| Data migration | Cross-Hublet customer migration without downtime |
| Email scaling | Support 2x current volume (800M/month) with linear cost scaling |

### Out of Scope

- CMS page rendering / website hosting
- Social media management
- Live chat / chatbot engine (separate design)
- Payment processing internals
- Ad management / retargeting pixel infrastructure

---

## Non-Functional Requirements

### CAP Theorem Choice

**AP with tunable consistency** — Availability and Partition Tolerance prioritized for most operations:

| Operation | Consistency Model | Justification |
|---|---|---|
| CRM reads/writes | Strong (per-Hublet) | Users expect immediate visibility of their edits |
| Workflow execution | Eventual (at-least-once) | Actions are idempotent; seconds of delay is acceptable |
| Email analytics | Eventual | Analytics dashboards tolerate minutes of lag |
| Search indexing | Eventual | Search index refresh within seconds is sufficient |
| Cross-region reads | Eventual | EU data replicated from NA primary with seconds of lag |

### Availability Target

| Tier | Target | Scope |
|---|---|---|
| CRM API | 99.95% | ~22 minutes downtime/month |
| Workflow Engine | 99.9% | ~44 minutes downtime/month |
| Email Delivery | 99.9% | Queued and retried on failure |
| Analytics | 99.5% | Non-critical, graceful degradation |

### Latency Targets

| Operation | p50 | p95 | p99 |
|---|---|---|---|
| CRM single-record read | 15ms | 50ms | 100ms |
| CRM search/filter | 50ms | 200ms | 500ms |
| Workflow action execution | 500ms | 2s | 5s |
| Email send (queued) | 100ms | 500ms | 1s |
| Dashboard load | 500ms | 2s | 5s |
| API response | 50ms | 200ms | 500ms |

### Durability

- CRM data: **99.999999999%** (11 nines) — replicated across 3 MySQL/HBase nodes
- Email content: Durable in blob storage with redundancy
- Workflow state: Persisted in Kafka + database; at-least-once execution guarantee
- Audit logs: Immutable append-only storage, 7-year retention for compliance

---

## Capacity Estimations (Back-of-Envelope)

### Assumptions

- 268,000 paying customers, average 50 users per account = ~13.4M total users
- ~30% are daily active = ~4M DAU
- Average customer has 50,000 contacts, 10,000 companies, 5,000 deals
- Average 10 workflows per customer, each processing 100 contacts/day

### Traffic Estimates

| Metric | Estimation | Calculation |
|---|---|---|
| DAU / MAU | 4M / 13.4M | 268K accounts × 50 users × 30% DAU |
| CRM Read QPS (avg) | ~500K | 4M DAU × 30 reads/user/day ÷ 86,400 |
| CRM Write QPS (avg) | ~50K | 4M DAU × 3 writes/user/day ÷ 86,400 |
| CRM Peak QPS | ~1.5M | 3× average (business hours concentration) |
| Workflow Actions/sec | ~10K avg, ~50K peak | 268K × 10 workflows × 100 actions ÷ 86,400 |
| Email Send QPS | ~150 avg, ~5K peak | 400M emails/month ÷ 30 ÷ 86,400 |
| Email Analytics Events/sec | ~30K | Sends + opens + clicks + bounces |
| API Calls/sec (external) | ~50K | 268K customers × ~15 API calls/day/customer |

### Storage Estimates

| Metric | Estimation | Calculation |
|---|---|---|
| CRM Objects (Year 1) | ~200 TB | 268K × 65K objects × avg 12 KB/object |
| CRM Objects (Year 5) | ~1 PB | Growth at ~40%/year + historical data |
| Email Analytics | 260 TB compressed | Published figure — event data (sends, opens, clicks) |
| Workflow State | ~5 TB | Active workflow instances + execution history |
| File Attachments | ~500 TB | Documents, images attached to CRM records |
| Total Storage (Year 1) | ~1 PB | CRM + Analytics + Workflows + Files |
| Total Storage (Year 5) | ~5 PB | Growth + retention requirements |

### Bandwidth Estimates

| Metric | Estimation | Calculation |
|---|---|---|
| CRM API bandwidth | ~20 Gbps | 1.5M QPS × 2 KB avg response |
| Email outbound | ~5 Gbps | 5K emails/sec × 100 KB avg email |
| Webhook delivery | ~2 Gbps | ~100K webhooks/sec × 2 KB payload |
| Internal (Kafka) | ~50 Gbps | Cross-service event traffic |

### Cache Estimates

| Cache Layer | Size | Contents |
|---|---|---|
| Hot CRM objects | ~50 TB | Frequently accessed contacts, deals by account |
| Session/auth tokens | ~5 TB | Active user sessions, OAuth tokens |
| Workflow state | ~2 TB | Active workflow execution contexts |
| Search index cache | ~10 TB | Recent query results, popular filters |
| Email templates | ~500 GB | Compiled/rendered template cache |

---

## SLOs / SLAs

| Metric | SLO (Internal) | SLA (Customer) | Measurement |
|---|---|---|---|
| CRM API Availability | 99.99% | 99.95% | Successful responses / total requests |
| CRM API Latency (p99) | 200ms | 500ms | Server-side response time |
| Workflow Execution Latency | 5s (p99) | 30s | Trigger event → action execution |
| Email Queue-to-Send | 30s (p99) | 5min | Time from queue to SMTP handoff |
| Email Deliverability | 98%+ | 95%+ | Inbox placement rate |
| Search Freshness | 5s | 30s | Record change → searchable |
| Dashboard Load Time | 2s (p95) | 5s | Full render with data |
| Webhook Delivery | 99.9% | 99% | Successful delivery within 5 retries |
| Data Durability | 99.9999999% | 99.999% | No data loss per year |

---

## Read/Write Ratio Analysis

| Component | Read:Write | Implication |
|---|---|---|
| CRM Objects | 10:1 | Cache-heavy, read replicas beneficial |
| Email Analytics | 1:3 | Write-heavy, append-only, batch reads for reports |
| Workflow Engine | 1:1 | Balanced — reads for state, writes for transitions |
| Search Index | 50:1 | Read-heavy, async index updates acceptable |
| Activity Timeline | 5:1 | Read-heavy display, append-only writes |

---

## Growth Projections (Year 1-5)

| Metric | Year 1 | Year 2 | Year 3 | Year 5 |
|--------|--------|--------|--------|--------|
| Paying customers | 268K | 350K | 450K | 700K |
| Total CRM objects | 200 TB | 350 TB | 600 TB | 1.5 PB |
| Email volume/month | 400M | 650M | 1B | 2.5B |
| Workflow actions/day | 100M | 250M | 500M | 1.5B |
| Peak CRM QPS | 1.5M | 3M | 6M | 15M |
| Microservices | 3,000 | 4,000 | 5,500 | 8,000 |
| Hublets | 3 | 5 | 8 | 15 |

**Growth drivers**: International expansion (new Hublets in AP, LATAM), custom object adoption, AI-powered automation increasing action volume, marketplace ecosystem growth.

---

## Advanced Features (Phase 2)

| # | Requirement | Description |
|---|---|---|
| FR-19 | **AI Lead Scoring** | ML-based scoring using behavioral signals (page visits, email engagement) + firmographic data + similar-company analysis |
| FR-20 | **Predictive Email Send Time** | Per-contact optimal send time prediction based on historical engagement patterns |
| FR-21 | **Data Quality Engine** | Automated deduplication, enrichment, normalization of CRM records using ML-based entity resolution |
| FR-22 | **Revenue Attribution** | Full-funnel revenue attribution connecting marketing touches to closed deals with multi-touch models |
| FR-23 | **AI Content Generation** | LLM-powered email subject lines, body text, and CTA suggestions based on audience segment and campaign goal |
| FR-24 | **Custom Code Actions** | User-defined Node.js/Python functions executed within workflows in sandboxed environments |

---

## Per-Account Resource Limits

| Resource | Free | Starter | Professional | Enterprise |
|----------|------|---------|-------------|------------|
| Contacts | 1,000 | 1,000 | 2,000 | 10,000 (included) |
| Marketing emails/month | 2,000 | 5× contacts | 10× contacts | 20× contacts |
| Workflows | 0 | 10 | 300 | 1,000 |
| Custom properties | 10 | 1,000 | 1,000 | 1,000 |
| Custom objects | 0 | 0 | 10 | 100 |
| API calls/day | 250 | 250K | 500K | 1M |
| Lists | 5 | 25 | 1,000 | 1,500 |
| Report dashboards | 1 | 10 | 25 | 50 |

---

## Cost Model (Infrastructure Economics)

| Component | Monthly Cost (at 268K customers) | Cost Driver |
|-----------|--------------------------------|-------------|
| HBase cluster (100 clusters, 7K+ RegionServers) | ~$800K | Per-RegionServer instance + storage |
| Vitess/MySQL (1,000+ clusters) | ~$500K | Per-shard instance + IOPS |
| Kafka (80 clusters) | ~$300K | Per-broker + cross-region replication |
| Email delivery infrastructure | ~$200K | SMTP servers + IP pool + ISP monitoring |
| Compute (3,000+ services) | ~$1.5M | Container instances across Hublets |
| CDN / Edge (Cloudflare) | ~$150K | Bandwidth + Workers compute |
| Object storage | ~$100K | File attachments, logs, backups |
| **Total infrastructure** | **~$3.5M/month** | ~$13/customer/month at current scale |

### FinOps: Per-Customer Cost Attribution

```
Cost Attribution Formula:
  customer_cost = (
      crm_storage_gb × storage_cost_per_gb
    + crm_reads × read_cost_per_op
    + crm_writes × write_cost_per_op
    + workflow_actions × action_cost_per_exec
    + emails_sent × email_cost_per_send
    + api_calls × api_cost_per_call
    + search_queries × search_cost_per_query
  )

  // Overhead allocation (shared infra): 30% surcharge on direct costs
  total_customer_cost = customer_cost × 1.30

  // Example: Enterprise customer with 500K contacts, 50 active workflows
  //   CRM storage: 6 GB × $0.10 = $0.60
  //   CRM reads:   10M/month × $0.000001 = $10.00
  //   CRM writes:  1M/month × $0.00001 = $10.00
  //   Workflows:   500K actions/month × $0.00005 = $25.00
  //   Emails:      5M/month × $0.00003 = $150.00
  //   API calls:   2M/month × $0.000005 = $10.00
  //   Total:       ~$205.60/month × 1.30 = ~$267/month
  //   Revenue:     ~$3,600/month (Professional plan)
  //   Margin:      ~93% (healthy for SaaS)
```

---

## Operational Estimations

| Metric | Calculation | Result |
|--------|------------|--------|
| **HBase RegionServers (per Hublet)** | 25M QPS ÷ 50K QPS/server | ~500 servers |
| **Kafka Brokers (per Hublet)** | 80 clusters × 3-10 brokers | ~400 brokers |
| **MySQL/Vitess Shards (per Hublet)** | 1,000+ clusters × 3 replicas | ~3,000 instances |
| **Email SMTP Fleet** | 400M emails/month ÷ 30 days ÷ 86,400 sec × 10 IPs | ~50 dedicated IPs |
| **Workflow Consumer Instances** | 100M actions/day ÷ 86,400 × headroom factor 3 | ~3,500 tasks/sec capacity |
| **API Request Volume** | 268K customers × avg 50 calls/day | ~13.4M calls/day |
| **Search Index Size** | 268K accounts × avg 100K objects × 500B index entry | ~13 TB index |
| **Blob Storage (email templates, attachments)** | 400M emails × 10% with attachments × 500KB avg | ~20 TB/month growth |
| **Network Egress (per Hublet)** | API responses + email delivery + webhook delivery | ~50 TB/month |
| **Redis Cache Memory (per Hublet)** | 100M hot CRM objects × 2KB avg cached fields | ~200 GB |

### Peak vs. Steady-State Ratios

| Component | Steady-State | Peak (10 AM ET, Tues) | Peak/Steady Ratio |
|-----------|-------------|----------------------|-------------------|
| CRM API QPS | 15M | 25M | 1.67× |
| Workflow enrollments/sec | 5K | 15K | 3.0× |
| Email sends/sec | 150 | 800 | 5.3× |
| Search queries/sec | 50K | 120K | 2.4× |
