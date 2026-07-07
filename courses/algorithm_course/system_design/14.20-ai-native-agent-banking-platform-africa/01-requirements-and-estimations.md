# Requirements & Estimations — AI-Native Agent Banking Platform for Africa

## Functional Requirements

| ID | Requirement | Description |
|---|---|---|
| FR-01 | **Agent Onboarding & Lifecycle** | Register new agents with document verification, background screening, device provisioning, training assessment, and graduated activation; manage agent tiers (basic, standard, premium, super-agent) with tier-specific capabilities and limits |
| FR-02 | **Cash-In (Deposit)** | Accept customer cash deposits: verify customer identity (biometric or ID-based), validate against transaction limits, debit agent e-float, credit customer account, generate signed receipt; support both banked and unbanked customer flows |
| FR-03 | **Cash-Out (Withdrawal)** | Process customer cash withdrawals: authenticate customer via biometric/PIN, validate balance and limits, debit customer account, credit agent e-float, agent dispenses physical cash, generate receipt; apply velocity checks and risk scoring |
| FR-04 | **Fund Transfers** | Enable person-to-person transfers initiated at agent locations: sender authentication, recipient validation (phone number, account number, or agent code), real-time crediting for on-network transfers, queuing for cross-network transfers |
| FR-05 | **Bill Payments & Airtime** | Process utility bill payments (electricity, water, DSTV), airtime purchases, and government fee payments through agent terminals; integrate with 50+ biller APIs; reconcile payments in real-time |
| FR-06 | **Float Management** | Track agent cash and e-float balances in real-time; AI-driven predictive rebalancing recommendations; super-agent float distribution; automated alerts when float levels breach thresholds; float top-up via bank transfer or super-agent visit |
| FR-07 | **Biometric KYC** | Capture, validate, and store biometric data (fingerprint, facial) for customer identity verification; on-device quality assessment; offline template matching; server-side deduplication against national databases; tiered KYC (basic with phone number, standard with biometrics, full with government ID) |
| FR-08 | **Offline Transaction Processing** | Process transactions when device has no network connectivity; apply local risk rules; store transactions with cryptographic signatures; sync and reconcile when connectivity resumes; handle conflicts from concurrent offline operations |
| FR-09 | **Fraud Detection & Prevention** | Real-time transaction risk scoring; detect phantom transactions, float diversion, collusion rings, unauthorized fee charging; automated case management; agent risk scoring with dynamic limit adjustment |
| FR-10 | **Account Opening** | Open basic bank accounts or mobile wallets at agent locations; tiered KYC capture; instant account activation for basic tier; compliance verification for higher tiers; link to national identity databases |
| FR-11 | **Agent Performance Management** | Track agent performance metrics (transaction volume, uptime, customer satisfaction, compliance score); AI-generated performance scores; automated tier promotion/demotion; commission calculation and disbursement |
| FR-12 | **Regulatory Reporting** | Generate jurisdiction-specific regulatory reports; real-time suspicious transaction reporting (STR); daily/monthly aggregate reporting; automated compliance checks against configurable rule sets |

---

## Out of Scope

- **Lending and credit products**: Agent-originated loan applications and disbursements (covered by dedicated lending platforms)
- **Merchant acquiring**: POS card payment processing and merchant settlement (adjacent but distinct from CICO agent banking)
- **Insurance products**: Agent-sold micro-insurance policies and claims processing
- **Cryptocurrency**: Digital currency exchange or trading through agent network
- **Core banking system**: The underlying ledger and account management system (platform integrates with existing core banking via APIs)

---

## Non-Functional Requirements

### Performance SLOs

| Metric | Target | Rationale |
|---|---|---|
| Transaction processing latency (online) | p50 < 800ms, p99 < 3s | Agent and customer waiting at point of sale; slower than this causes abandonment |
| Transaction processing latency (offline sync) | < 30s per batch of 50 transactions | Agents accumulate transactions offline; sync must complete quickly when connectivity returns |
| Biometric matching latency (on-device) | < 2s for 1:1 verification | Customer waiting at agent location; must feel instant |
| Biometric deduplication (server-side) | < 10s for 1:N search against 50M+ templates | Background process during KYC enrollment; not blocking transaction |
| Float balance query | p99 < 200ms | Agents check float balance frequently; must be instant |
| API availability | 99.95% monthly (excluding planned maintenance) | Financial service; downtime directly prevents transactions |
| Offline transaction success rate | > 99.5% reconciliation without manual intervention | Most offline transactions should auto-reconcile when synced |
| Fraud detection alert latency | < 5 minutes for critical alerts | Must catch fraud while agent is still operating |

### Reliability

| Dimension | Requirement |
|---|---|
| **Data Durability** | Zero transaction loss; every completed transaction must be persisted with at least 3 replicas across 2 availability zones |
| **Consistency Model** | Strong consistency for balance updates (double-entry ledger); eventual consistency acceptable for analytics, reporting, and agent performance scores (< 5 minute lag) |
| **Recovery Point Objective** | RPO < 1 minute for transaction data; RPO < 1 hour for analytics and reporting data |
| **Recovery Time Objective** | RTO < 15 minutes for transaction processing; RTO < 4 hours for analytics dashboards |
| **Offline Resilience** | Agent devices must support up to 72 hours of offline operation with local transaction capacity of 500 transactions before requiring sync |
| **Multi-Region** | Active-active deployment across at least 2 regions per country for disaster resilience |

---

## Capacity Estimations

### Traffic Estimates

| Parameter | Value | Derivation |
|---|---|---|
| Total registered agents | 600,000 | Moniepoint alone has 500K+; combined platform target |
| Active agents (daily) | 420,000 (70%) | Industry benchmark for daily active agent ratio |
| Transactions per agent per day | 85 | Based on Moniepoint's 1.67B monthly / ~600K agents |
| Daily transactions | ~35 million | 420,000 active agents × 85 txns/agent |
| Monthly transactions | ~1.05 billion | 35M × 30 days |
| Peak transactions per second | 1,200 TPS | 35M daily / 86,400 × 3x peak multiplier (midday surge) |
| Absolute peak TPS | 3,000 TPS | Salary day / month-end peaks (5-7x average) |
| Offline transactions (% of daily) | 15-25% | Varies by geography; rural areas up to 40% |
| Biometric verifications per day | ~28 million | ~80% of transactions require biometric auth |

### Storage Estimates

| Data Type | Per-Record Size | Daily Volume | Daily Storage | Annual Storage |
|---|---|---|---|---|
| Transaction records | ~2 KB | 35M | 70 GB | 25.5 TB |
| Biometric templates (fingerprint) | ~500 bytes (minutiae) | 50K new enrollments | 25 MB | 9.1 GB |
| Biometric templates (facial) | ~2 KB (embedding) | 50K new enrollments | 100 MB | 36.5 GB |
| Biometric raw captures (images) | ~200 KB | 50K enrollments | 10 GB | 3.65 TB |
| Agent profile data | ~10 KB | 1,000 new agents | 10 MB | 3.65 GB |
| Audit logs | ~500 bytes | 70M events | 35 GB | 12.8 TB |
| Fraud detection features | ~1 KB | 35M | 35 GB | 12.8 TB |
| **Total active storage** | | | **~150 GB/day** | **~55 TB/year** |

### Compute Estimates

| Component | Requirement | Notes |
|---|---|---|
| Transaction processing | 60 cores at peak | 3,000 TPS × 20ms CPU per transaction |
| Biometric matching (server) | 40 cores | 1:N deduplication is CPU-intensive; GPU acceleration for large databases |
| Fraud ML inference | 30 cores | Real-time scoring on every transaction |
| Float prediction | 20 cores | Batch prediction every 4 hours for 600K agents; real-time adjustment on demand |
| Offline sync processing | 25 cores at peak | Burst capacity for morning sync wave (agents coming online) |

### Network Estimates

| Flow | Bandwidth | Notes |
|---|---|---|
| Agent ↔ Platform (per agent) | 2-5 KB per transaction | Compressed payloads for low-bandwidth environments |
| Biometric upload (enrollment) | ~250 KB per customer | Fingerprint + facial images + metadata |
| Offline sync batch | 100-500 KB per sync | 50-200 queued transactions per batch |
| Platform ↔ Core banking | 500 Mbps sustained | Transaction posting, balance queries, settlement |
| Platform ↔ Identity services | 100 Mbps sustained | Biometric dedup, national ID verification |
| **Total egress** | ~2 TB/day | Dominated by biometric data and transaction responses |

---

## SLO Summary

| SLO | Target | Measurement Window |
|---|---|---|
| Transaction processing latency (online) p99 | ≤ 3 s | Rolling 1-hour |
| Transaction processing latency (online) p50 | ≤ 800 ms | Rolling 1-hour |
| Offline sync reconciliation success rate | ≥ 99.5% auto-reconcile | Daily |
| Biometric 1:1 verification accuracy | ≥ 95% TAR at 0.1% FAR | Monthly (field conditions) |
| Biometric deduplication latency | ≤ 10 s | Per enrollment |
| Float prediction accuracy (next-day) | ≥ 80% within ±20% of actual | Weekly |
| Fraud detection precision (suspend threshold) | ≥ 99% | Monthly |
| API availability (overall) | ≥ 99.95% | Monthly |
| Core banking sync lag | ≤ 30 s (p95) | Rolling 1-hour |
| Agent device uptime (online agents) | ≥ 95% of operating hours | Daily per agent |
| Regulatory report generation | 100% on-time | Per regulatory deadline |
| Geo-fence compliance rate | ≥ 98% of online transactions | Daily |

---

## Key Trade-offs

| Trade-off | Option A | Option B | Platform Choice |
|---|---|---|---|
| **Online vs. offline capability** | Online-only (simpler, stronger consistency) | Offline-first (complex reconciliation, but serves rural areas) | Offline-first: 30-40% of agents have intermittent connectivity; cannot exclude them |
| **Biometric accuracy vs. inclusion** | High threshold (fewer false accepts, more rejections of legitimate users) | Adaptive threshold (more inclusive, higher fraud risk) | Adaptive: quality-based thresholds with compensating controls (PIN fallback, multi-modal fusion) |
| **Fraud precision vs. recall** | High recall (catch more fraud, suspend more innocent agents) | High precision (fewer false positives, miss some fraud) | High precision: suspending a legitimate agent destroys their livelihood; graduated response instead |
| **Device cost vs. capability** | Expensive POS (₦80K+, better sensors, GPS, printer) | Budget smartphone (₦30K, camera-based biometrics, no printer) | Tiered: POS for premium agents, smartphone for basic agents; both supported by same backend |
| **Float prediction granularity** | Per-region aggregate forecast (simpler, less accurate) | Per-agent individual forecast (complex, highly personalized) | Per-agent: individual patterns vary wildly; aggregate forecasts miss agent-specific events (market days, salary cycles) |
| **Regulatory compliance approach** | Hardcoded rules per country (fast to implement, slow to change) | Programmable policy engine (slower to build, instant rule updates) | Policy engine: regulations change 2-3 times per year per jurisdiction with short implementation windows |

---

## Growth Projections

```
Year 1 (Single Market — Nigeria):
  Agents: 100K → 600K
  Monthly transactions: 200M → 1.05B
  Peak TPS: 500 → 3,000
  Customer base: 10M → 50M
  Biometric database: 5M → 50M templates
  Float volume: ₦50B → ₦300B daily

Year 2 (Multi-Market — Nigeria + Ghana + Tanzania):
  Agents: 600K → 1.2M
  Monthly transactions: 1.05B → 2.5B
  Peak TPS: 3,000 → 7,000
  Customer base: 50M → 120M
  Products: CICO + transfers → + bill pay + savings + micro-insurance
  Cross-border corridors: 3 active (Nigeria-Ghana, Kenya-Tanzania, Ethiopia-Kenya)

Year 3 (Continental Platform):
  Agents: 1.2M → 2.5M
  Monthly transactions: 2.5B → 5B
  Peak TPS: 7,000 → 15,000
  Customer base: 120M → 250M
  Markets: 5+ countries
  Products: Full financial services suite
  CBDC integration: eNaira + eCedi wallet support
```

---

## Regulatory Requirements by Jurisdiction

| Requirement | Nigeria (CBN) | Kenya (CBK) | Tanzania (BOT) |
|---|---|---|---|
| Agent exclusivity | Required (April 2026) | Not required | Not required |
| Geo-fencing | Mandatory (device must operate within registered location) | Recommended | Not required |
| Customer daily limit | ₦100,000 (basic KYC), ₦500,000 (full KYC) | KSh 150,000 (M-Pesa), KSh 300,000 (bank agents) | TSh 3,000,000 |
| KYC tiers | 3 tiers (phone, BVN+biometric, full ID) | 3 tiers (phone, national ID, full) | 2 tiers (basic, full) |
| Agent qualification | Business registration, minimum float deposit, CBN approval | CBK licensing of agency banking provider | BOT approval of mobile money operator |
| Reporting frequency | Daily transaction reports + monthly aggregates | Monthly regulatory filings | Quarterly reports |
| STR filing | Real-time for threshold breaches | Within 7 days of detection | Within 3 days of detection |
| Data residency | Data must be stored in Nigeria | No explicit requirement | Data must be accessible to BOT |
| National ID integration | NIN/BVN verification mandatory | IPRS integration recommended | NIDA integration mandatory |

---

## Extended Capacity Planning

### Biometric Database Growth

| Metric | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| **Total enrolled customers** | 50M | 120M | 250M |
| **Biometric templates stored** | 100M (2 per customer avg) | 240M | 500M |
| **Template storage** | 50 GB | 120 GB | 250 GB |
| **Daily enrollment rate** | 50K new customers | 100K | 150K |
| **Deduplication search space** | 100M templates | 240M | 500M |
| **Dedup latency budget** | < 10s | < 12s (LSH scaling) | < 15s (partitioned search) |
| **On-device template cache** | 500 templates per device | 1,000 | 2,000 |

### Float Volume Projections

| Metric | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| **Total daily float volume** | ₦300B | ₦750B | ₦1.5T |
| **Average float per agent** | ₦500K | ₦625K | ₦600K |
| **Super-agent float pool** | ₦50B | ₦125B | ₦250B |
| **Rebalancing events per day** | 180K | 400K | 750K |
| **Average rebalance amount** | ₦150K | ₦175K | ₦200K |
| **Float prediction accuracy target** | 80% within ±20% | 85% within ±15% | 90% within ±10% |

### Cross-Border Corridor Projections

| Corridor | Year 1 Volume | Year 2 Volume | Year 3 Volume |
|---|---|---|---|
| **Nigeria → Ghana** | $20M/month | $80M/month | $200M/month |
| **Kenya → Tanzania** | — | $50M/month | $150M/month |
| **Ethiopia → Kenya** | — | $30M/month | $100M/month |
| **Nigeria → UK (diaspora)** | — | — | $50M/month |
| **Settlement frequency** | Every 4 hours | Every 2 hours | Real-time netting |
| **FX exposure limit** | $500K per corridor | $1M | $2M |

---

## Infrastructure Cost Model

### Cost per Transaction Breakdown

| Component | Cost per Transaction | % of Total | Notes |
|---|---|---|---|
| **Compute (transaction processing)** | ₦0.12 | 18% | Auto-scaled container instances |
| **Compute (ML inference)** | ₦0.08 | 12% | Fraud scoring + biometric matching |
| **Storage (transaction records)** | ₦0.02 | 3% | Distributed database with 3x replication |
| **Storage (biometric templates)** | ₦0.01 | 1.5% | Encrypted at rest with key rotation |
| **Network (agent ↔ platform)** | ₦0.05 | 7.5% | Compressed payloads, edge CDN for static assets |
| **Network (core banking integration)** | ₦0.10 | 15% | Settlement and balance sync |
| **SMS/USSD notifications** | ₦0.15 | 22% | Customer receipts, agent alerts |
| **Biometric API (national ID verification)** | ₦0.10 | 15% | NIMC/BVN verification calls |
| **Infrastructure overhead** | ₦0.04 | 6% | Monitoring, logging, security |
| **Total** | **₦0.67** | **100%** | At 35M daily transactions: ₦23.5M/day |

### Cost Optimization Strategies

1. **Batch biometric dedup during off-peak**: Run 1:N deduplication searches during 22:00-06:00 when compute demand is 70% lower, reducing reserved instance costs
2. **SMS receipt optimization**: Default to USSD push notifications (free) for repeat customers; SMS only for first-time or high-value transactions (reduces SMS costs by 60%)
3. **Edge caching for static data**: Cache agent profiles, compliance rules, and fee schedules at regional edge nodes; reduces core API load by 35%
4. **Tiered storage**: Move transaction records older than 90 days to cold storage (10x cheaper); maintain hot access only for regulatory reporting window
