# Requirements & Estimations

## Functional Requirements

### Core Features

| # | Feature | Description |
|---|---------|-------------|
| F1 | **Real-Time Transaction Scoring** | Evaluate every transaction with a fraud risk score (0.0 - 1.0) within 100ms, returning allow/block/review decision |
| F2 | **Rules Engine** | Execute deterministic rules (velocity checks, blacklists, geo-fencing, amount thresholds) before and alongside ML scoring |
| F3 | **ML Model Serving** | Serve an ensemble of gradient-boosted trees, neural networks, and anomaly detection models with feature vector assembly |
| F4 | **Feature Engineering Pipeline** | Compute real-time features (velocity, device fingerprint, behavioral signals) and batch features (spending profiles, historical patterns) |
| F5 | **Graph-Based Fraud Ring Detection** | Build and query entity relationship graphs to detect coordinated multi-account fraud patterns |
| F6 | **Case Management** | Route flagged transactions to analyst queues with enrichment data, investigation tools, and disposition workflow |
| F7 | **Feedback Loop & Model Retraining** | Capture analyst decisions and transaction outcomes as labels; retrain models on weekly/daily cadence |
| F8 | **Regulatory Reporting** | Generate and file Suspicious Activity Reports (SARs) and Suspicious Transaction Reports (STRs) with regulatory bodies |
| F9 | **Merchant/Customer Risk Profiling** | Maintain risk profiles for merchants and customers based on historical behavior and external signals |
| F10 | **Alert Management** | Generate, prioritize, and route fraud alerts based on severity, amount, and pattern type |

### User Personas

| Persona | Key Interactions |
|---------|-----------------|
| **Payment Service** | Calls scoring API synchronously during transaction authorization; receives allow/block/review decision |
| **Fraud Analyst** | Investigates flagged cases, views enrichment data, makes disposition decisions, files SARs |
| **Fraud Operations Manager** | Configures rules, sets thresholds, monitors team performance, reviews model metrics |
| **ML Engineer** | Trains models, deploys new versions, monitors model drift, manages feature pipelines |
| **Compliance Officer** | Reviews SAR filings, audits decision trails, ensures regulatory adherence |
| **Merchant** | Views fraud metrics for their transactions, configures risk sensitivity preferences |

---

## Non-Functional Requirements

| Requirement | Target | Rationale |
|-------------|--------|-----------|
| **Scoring Latency (p99)** | < 100ms | Must not perceptibly delay payment authorization |
| **Scoring Throughput** | 500+ TPS sustained, 1,500 TPS peak | Support 15M+ transactions/day with 3x burst |
| **Availability** | 99.95% | Scoring path cannot be a single point of failure for payments |
| **Fail-Open Policy** | Allow on scoring timeout | Better to miss fraud than block all payments during outage |
| **Model Update Latency** | < 30 minutes from deploy to 100% traffic | Fast rollout for new model versions to respond to emerging attacks |
| **Feature Freshness** | Real-time features: < 1s stale; Batch features: < 1 hour stale | Real-time velocity must reflect recent transactions |
| **Data Retention** | Raw events: 2 years; Features: 90 days hot / 2 years cold; Labels: indefinite | Training data and regulatory audit trail |
| **Explainability** | Top-5 contributing factors per decision | Regulatory requirement and analyst productivity |
| **False Positive Rate** | < 5% of blocked transactions | Minimize customer friction and revenue loss |
| **Detection Rate** | > 95% by fraud value | Catch nearly all fraud dollars, even if some low-value fraud slips through |

---

## Capacity Estimations

### Traffic

| Metric | Calculation | Value |
|--------|-------------|-------|
| Daily transactions | Given | 15M |
| Average TPS | 15M / 86,400 | ~175 TPS |
| Peak TPS (3x) | 175 x 3 | ~500 TPS |
| Holiday peak TPS (5x) | 175 x 5 | ~875 TPS |
| Scoring API calls/day | 15M x 1.1 (retries) | ~16.5M |

### Storage

| Data Type | Size per Record | Volume/Day | Daily Storage | Retention | Total |
|-----------|----------------|------------|---------------|-----------|-------|
| Transaction events | ~2 KB | 15M | ~30 GB | 2 years | ~22 TB |
| Feature vectors | ~4 KB (500 features x 8 bytes) | 15M | ~60 GB | 90 days hot | ~5.4 TB hot |
| Scoring results | ~500 bytes | 15M | ~7.5 GB | 2 years | ~5.5 TB |
| Entity graph nodes | ~1 KB | 100K new/day | ~100 MB | Indefinite | ~100M nodes |
| Entity graph edges | ~200 bytes | 500K new/day | ~100 MB | Indefinite | ~1B edges |
| Case records | ~10 KB (with enrichment) | 5,000 | ~50 MB | 7 years | ~130 GB |
| Rule definitions | ~2 KB | 500-2,000 active | ~4 MB | Versioned | ~100 MB |
| ML model artifacts | 50-500 MB each | 3-5 models | ~2 GB | Last 20 versions | ~40 GB |

### Compute

| Component | Resource Profile | Instances |
|-----------|-----------------|-----------|
| Scoring service | CPU-optimized (model inference) | 20-40 pods (auto-scaled) |
| Feature store | Memory-optimized (low-latency reads) | 10-20 nodes |
| Rules engine | CPU (deterministic evaluation) | 10-15 pods |
| Graph database | Memory + storage (traversal-heavy) | 5-10 nodes |
| Stream processor | CPU + memory (feature computation) | 15-25 pods |
| Case management API | Standard compute | 5-10 pods |
| Model training | GPU cluster (periodic) | 4-8 GPUs (on-demand) |

---

## SLOs and SLIs

| SLO | SLI | Target | Measurement |
|-----|-----|--------|-------------|
| **Scoring Latency** | p99 latency of /score endpoint | < 100ms | Histogram at API gateway |
| **Scoring Availability** | Successful responses / total requests | > 99.95% | 5xx error rate at load balancer |
| **Feature Freshness** | Age of newest feature at scoring time | Real-time: < 1s; Batch: < 1h | Feature store metadata timestamp |
| **Model Accuracy** | Weekly AUC-ROC on holdout set | > 0.98 | Offline evaluation pipeline |
| **False Positive Rate** | Blocked legitimate / total blocked | < 5% | Analyst disposition labels |
| **Detection Rate** | Caught fraud value / total fraud value | > 95% | Chargeback reconciliation |
| **Case Queue Latency** | Time from flagging to analyst assignment | < 15 minutes | Case management timestamps |
| **SAR Filing Timeliness** | Filing within regulatory deadline | 100% | Compliance tracking system |
| **Model Deploy Time** | Time from model approval to 100% traffic | < 30 minutes | Deployment pipeline metrics |
| **Rule Update Latency** | Time from rule save to enforcement | < 60 seconds | Rule engine version sync |

---

## Error Budget Policy

| SLO | Monthly Budget | Burn Rate Alert | Action |
|-----|---------------|-----------------|--------|
| Scoring availability (99.95%) | 21.6 min downtime | > 2x in 1 hour | Page on-call; activate fail-open |
| Scoring latency (p99 < 100ms) | 0.05% requests slow | > 5x in 15 min | Scale scoring pods; check feature store health |
| Detection rate (> 95%) | 5% fraud value missed | Weekly review | Emergency model retrain; tighten rules temporarily |
| False positive rate (< 5%) | 5% of blocks are FP | Daily review | Adjust thresholds; review recent rule changes |

---

## Fraud Rate by Transaction Type

```
Transaction Type         Volume/Day   Fraud Rate   Avg Fraud Amount   Key Attack Vectors
─────────────────────── ──────────── ──────────── ────────────────── ──────────────────────
Card-Not-Present (CNP)   8M (53%)     0.15%        $420               Account takeover, stolen cards
Card-Present (CP)        3M (20%)     0.02%        $180               Counterfeit, skimming
ACH / Bank Transfer      2M (13%)     0.08%        $2,500             Unauthorized debits, payroll
Peer-to-Peer (P2P)       1.5M (10%)   0.12%        $350               Social engineering, romance scams
Wire Transfer            0.5M (3%)    0.05%        $8,000             Business email compromise

Expected daily fraud volume:
  CNP:   8M × 0.0015 = 12,000 fraudulent transactions
  CP:    3M × 0.0002 = 600
  ACH:   2M × 0.0008 = 1,600
  P2P:   1.5M × 0.0012 = 1,800
  Wire:  0.5M × 0.0005 = 250
  Total: ~16,250 fraudulent transactions/day (~0.11% overall)

Expected daily fraud value:
  CNP:   12,000 × $420 = $5.04M
  ACH:   1,600 × $2,500 = $4.0M
  Wire:  250 × $8,000 = $2.0M
  P2P:   1,800 × $350 = $0.63M
  CP:    600 × $180 = $0.11M
  Total: ~$11.8M fraud value/day → ~$4.3B/year exposure
```

---

## Failure Budget Analysis

```
--- Scoring Availability Budget ---
SLO: 99.95% availability
Monthly error budget: 21.6 minutes of downtime
At 175 TPS: 21.6 min × 60 × 175 = ~226,800 unscored transactions/month
At $80 avg transaction value: ~$18M in unscored transactions/month
Fail-open policy: these transactions are ALLOWED, not blocked

Cost of fail-open window:
  At 0.11% fraud rate: ~249 fraudulent transactions slip through per month
  At $420 avg fraud value: ~$104K in fraud loss per monthly error budget
  This is acceptable: $104K/month << cost of blocking all transactions

--- Detection Rate Budget ---
SLO: 95% fraud value detection rate
5% missed fraud on $11.8M/day = $590K/day in undetected fraud
Annual undetected fraud: ~$215M
At chargeback cost of 1.5x (fraud + fees): ~$323M annual exposure from misses
Each 1% improvement in detection rate = ~$43M/year saved

--- False Positive Budget ---
SLO: <5% false positive rate
At 16,250 flagged transactions/day (assuming all fraud + some FP):
  5% FP = ~812 legitimate transactions blocked daily
  At $80 avg value: ~$65K/day in blocked legitimate revenue
  Plus: customer friction, support cost, potential churn
Each 1% reduction in FP rate = ~$13K/day saved + customer goodwill
```

---

## Cost Estimation

```
--- Infrastructure Cost (Monthly) ---

Scoring Service:
  20-40 pods × ~$200/pod/month = $4,000-8,000

Feature Store (Real-Time):
  8-node in-memory cluster × ~$500/node = $4,000
  With replication: $8,000

Feature Store (Batch):
  8-node key-value cluster × ~$300/node = $2,400

Stream Processing:
  20 instances × ~$250/instance = $5,000

Graph Database:
  5 nodes × ~$800/node = $4,000

Event Store + Analytics:
  30 GB/day × 30 days × $0.05/GB = $45/month (hot)
  Cold storage (2 years): ~$500/month

Model Training (GPU):
  Weekly training × 8 GPU-hours × ~$3/GPU-hour × 4 = $96

Case Management + Databases:
  ~$2,000/month

Total Infrastructure: ~$26,000-30,000/month (~$350K/year)

--- ROI Analysis ---
Fraud prevented: ~$11.2M/day × 95% detection = ~$10.6M/day
Annual fraud prevented: ~$3.87B
Infrastructure cost: ~$350K/year
ROI: ~11,000x (infrastructure cost is negligible vs fraud prevented)
Cost per scored transaction: $30K / 450M monthly txns = $0.00007/txn
```

---

## Regional Traffic Distribution

```
Region          Volume Share   Peak Hours (Local)   Fraud Rate   Notes
──────────────  ────────────   ──────────────────   ──────────   ──────────────
North America   35%            11 AM - 3 PM EST     0.12%        Highest CNP volume
Europe          25%            11 AM - 4 PM CET     0.09%        PSD2 SCA reduces fraud
Asia-Pacific    30%            10 AM - 9 PM local   0.14%        Mobile-dominant; diverse payment methods
Latin America   7%             10 AM - 8 PM local   0.18%        Higher fraud rate; emerging markets
Middle East/Africa 3%          9 AM - 6 PM local    0.22%        Highest per-transaction fraud rate

Multi-region scoring deployment:
├── Scoring latency requires regional deployment (cross-region adds 100ms+)
├── Feature stores must be replicated per region (consistency vs latency trade-off)
├── Models are globally trained but may need regional calibration
└── Regulatory requirements vary: GDPR (EU), CCPA (US), PDPA (APAC)
```

---

## SLO Burn Rate Analysis

```
Error Budget Consumption Framework:

Scoring Availability (99.95% SLO):
  Monthly budget: 21.6 minutes of downtime
  Burn rate alerting:
  ├── 1x burn rate: consuming budget at expected pace → no alert
  ├── 2x burn rate: 10.8 minutes remaining → P2 warning
  ├── 5x burn rate: 4.3 minutes remaining → P1 alert
  └── 14.4x burn rate: budget consumed in 36 hours → P0 page

Latency SLO (p99 < 100ms):
  Monthly budget: 0.05% of transactions may exceed 100ms
  At 15M txn/day = 7,500 over-budget transactions/day allowed
  Hourly budget: ~312 slow transactions/hour
  If 500+ slow in any 1-hour window → P1 alert

Detection Rate (> 95% by value):
  Measured weekly after chargeback settlement
  If 2-week rolling detection rate drops below 93% → P1 alert
  Challenge: 30-90 day label delay means SLO can only be
  measured retrospectively; analyst dispositions used as
  fast proxy with 85% correlation to final chargeback labels
```

---

## Key Assumptions

1. The payment service calls the fraud scoring API synchronously during transaction authorization---scoring is on the critical payment path
2. The system operates in a fail-open mode: if scoring is unavailable, transactions are allowed and flagged for async review
3. Chargebacks provide ground-truth fraud labels with a 30-90 day delay; analyst dispositions provide faster but noisier labels
4. Feature engineering uses point-in-time correctness: features used for scoring must match features available at training time to prevent data leakage
5. Models are retrained weekly with full dataset and updated daily with incremental learning on recent data
6. The system handles card-present, card-not-present, ACH, wire, and peer-to-peer transaction types with type-specific feature sets
7. Regulatory requirements vary by jurisdiction; SAR filing thresholds and timelines are configurable per region
8. Fraud patterns differ significantly by region; models must account for geographic variation in attack vectors
9. Infrastructure cost is negligible relative to fraud prevention value; optimize for detection accuracy over cost efficiency
