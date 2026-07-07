# AI-Native Procurement & Spend Intelligence --- Requirements & Estimations

## 1. Functional Requirements

### 1.1 Supplier Discovery & Management

| Requirement | Description |
|------------|-------------|
| **Global Supplier Search** | Search across a database of 10M+ suppliers by category, geography, capability, diversity certification, and risk profile |
| **AI-Powered Supplier Matching** | Given a procurement need (free-text or structured), recommend ranked suppliers using embedding similarity against supplier capability profiles |
| **Supplier Onboarding Automation** | Automated collection and verification of supplier documentation (W-9, insurance certificates, banking details) via document intelligence pipeline |
| **Supplier Scoring Dashboard** | Composite score integrating quality, delivery, pricing, risk, and ESG metrics; drill-down into each dimension |
| **Supplier Network Graph** | Visualize sub-tier supplier dependencies to identify concentration risk and single points of failure |

### 1.2 Price Optimization

| Requirement | Description |
|------------|-------------|
| **Market Benchmark Engine** | Maintain price benchmarks by commodity/category/geography; update from market feeds, historical PO prices, and contract rates |
| **Should-Cost Modeling** | ML-based estimation of fair market price for a given item/service based on raw material indices, labor costs, and market conditions |
| **Negotiation Intelligence** | Provide procurement teams with data-driven negotiation ranges: floor price, target price, ceiling price, and supplier-specific elasticity estimates |
| **Dynamic Pricing Alerts** | Detect when contracted prices deviate significantly from market benchmarks and flag renegotiation opportunities |
| **Volume Consolidation Recommendations** | Identify opportunities to consolidate demand across business units for volume discounts |

### 1.3 Contract Compliance Monitoring

| Requirement | Description |
|------------|-------------|
| **Contract Ingestion & Parsing** | OCR + NLP pipeline to extract structured data (terms, obligations, SLAs, pricing schedules, renewal dates) from PDF/scanned contracts |
| **Obligation Tracking** | Track contractual obligations (minimum purchase commitments, SLA targets, reporting requirements) with automated reminders |
| **Compliance Violation Detection** | Real-time monitoring of transactions against contract terms; flag purchases outside contracted rates, from non-approved suppliers, or exceeding quantity limits |
| **Renewal & Expiration Management** | Proactive alerts for upcoming renewals; AI-generated renewal recommendations based on supplier performance and market conditions |
| **Audit Trail** | Immutable log of all contract-related decisions, modifications, and compliance events for SOX audit readiness |

### 1.4 Spend Analytics

| Requirement | Description |
|------------|-------------|
| **Automated Spend Classification** | ML-based classification of every transaction into a multi-level taxonomy (L1--L4) with 95%+ accuracy; human-in-the-loop for low-confidence classifications |
| **Spend Cube Construction** | Multi-dimensional spend cube (supplier × category × business unit × time × geography) supporting slice-and-dice exploration |
| **Anomaly Detection** | Statistical and ML-based detection of spending anomalies: duplicate payments, price spikes, unusual vendor patterns, split purchases to circumvent approval thresholds |
| **Savings Tracking** | Track realized vs. projected savings from sourcing events, contract negotiations, and demand management initiatives |
| **Maverick Spend Identification** | Detect off-contract and non-compliant purchases; quantify the financial impact of maverick spending |

### 1.5 Risk Prediction

| Requirement | Description |
|------------|-------------|
| **Multi-Signal Risk Scoring** | Composite supplier risk score from financial health, geopolitical exposure, ESG ratings, news sentiment, delivery history, and regulatory compliance |
| **Predictive Risk Alerts** | ML models that predict supplier disruption 30--90 days before impact based on leading indicators (financial deterioration, management changes, regulatory actions) |
| **Concentration Risk Analysis** | Identify categories or regions with dangerous supplier concentration; recommend diversification strategies |
| **Cascading Risk Simulation** | Model the impact of a supplier failure across the supply network, considering sub-tier dependencies |
| **Risk-Adjusted Sourcing** | Factor risk scores into sourcing recommendations alongside price, quality, and delivery metrics |

### 1.6 Autonomous PO Generation

| Requirement | Description |
|------------|-------------|
| **Requisition-to-PO Automation** | For pre-approved categories and suppliers below configurable spend thresholds, automatically generate POs from approved requisitions without human intervention |
| **Smart Routing** | AI-driven approval routing based on spend amount, category risk, budget availability, and organizational hierarchy |
| **Three-Way Matching** | Automated matching of PO, goods receipt, and invoice with tolerance-based exception handling |
| **Budget Validation** | Real-time budget check against committed and actual spend; block POs that would exceed budget with override workflow |
| **Demand Forecasting** | Time-series models predicting future demand by category to enable proactive sourcing and inventory optimization |

### 1.7 Approval Workflows

| Requirement | Description |
|------------|-------------|
| **Configurable Approval Chains** | No-code configuration of approval workflows based on amount, category, department, risk level, and custom attributes |
| **Parallel & Sequential Approvals** | Support both parallel (all approvers simultaneously) and sequential (escalating authority) approval patterns |
| **Delegation & Escalation** | Automatic delegation during approver absence; time-based escalation for stale approvals |
| **Mobile Approval** | Push-notification-based approval on mobile devices with full context (spend history, supplier score, budget impact) |
| **Approval Analytics** | Track approval cycle times, bottlenecks, and rejection rates to optimize workflow design |

---

## 2. Non-Functional Requirements

| Requirement | Target | Rationale |
|------------|--------|-----------|
| **CAP Choice** | AP (Availability + Partition Tolerance) for spend analytics and supplier search; CP (Consistency + Partition Tolerance) for PO state, budget commitments, and approval workflows | Analytics can tolerate stale data; financial transactions must be strongly consistent |
| **Consistency Model** | Strong consistency for PO lifecycle, budget ledger, and approval state; eventual consistency (bounded staleness ≤ 5 min) for spend analytics, risk scores, and ML predictions | PO double-creation or budget over-commitment is unacceptable; analytics dashboards can tolerate brief staleness |
| **Availability Target** | 99.95% for PO and approval workflows; 99.9% for analytics dashboards; 99.5% for ML batch pipelines | Core procurement operations must be highly available; analytics and ML can tolerate brief maintenance windows |
| **Latency Targets** | Supplier search: p95 < 500ms; PO creation: p95 < 2s; Spend dashboard: p95 < 3s; Spend classification: p95 < 30s per batch of 1000 transactions; Risk score update: p95 < 60s after new signal ingestion | Interactive operations need sub-second response; ML operations measured in seconds to minutes |
| **Throughput** | 10K PO creations/hour peak; 100K spend classifications/hour; 1M supplier risk signal ingestions/day; 50K concurrent dashboard users | Sized for large enterprise with multiple operating regions |
| **Data Retention** | Transactional data: 7 years (SOX); Audit logs: 10 years; ML training data: rolling 5 years; Spend analytics: indefinite (aggregated) | Regulatory requirements drive retention; ML needs sufficient historical depth |
| **Multi-Tenancy** | Full tenant isolation for data, ML models, and configurations; shared infrastructure for compute efficiency; tenant-specific feature stores | SaaS platform serving thousands of enterprise customers |
| **Disaster Recovery** | RPO < 1 min for transactional data; RPO < 1 hour for ML models; RTO < 15 min for PO workflows; RTO < 1 hour for analytics | Financial data loss is unacceptable; ML models can be retrained |
| **Idempotency Window** | 24 hours for PO operations; 72 hours for document processing | Duplicate PO detection must cover retry windows; document resubmission must not create duplicate records |
| **Model Rollback Time** | < 5 minutes from decision to rollback completion | Rapid rollback to previous model version when accuracy degradation detected |
| **Vendor Resolution Accuracy** | > 99% for high-volume suppliers; > 95% for all suppliers | Incorrect vendor resolution corrupts all downstream analytics |
| **Three-Way Match Accuracy** | > 85% auto-match without human intervention | Manual invoice processing at scale is cost-prohibitive; false matches cause payment errors |
| **Split Purchase Detection** | > 90% detection rate for intentional circumvention patterns | Governance bypass undermines SOX controls and autonomous approval integrity |
| **Audit Log Completeness** | 100% of state transitions captured | Any gap in audit trail creates SOX compliance risk and potential regulatory finding |
| **AI Explainability** | 100% of autonomous decisions with machine-readable explanation | Every autonomous PO must log model version, features, confidence, and governance policy for SOX audit |
| **Cold-Start Time-to-Value** | 90%+ L2 accuracy within 30 days of onboarding | Active learning + global model baseline must provide rapid value to justify enterprise adoption |

---

## 3. Capacity Estimations

### Assumptions (Large Enterprise Customer)

| Parameter | Value | Basis |
|-----------|-------|-------|
| Annual spend | $5B | Large multinational enterprise |
| Annual PO volume | 2M | ~$2,500 average PO value |
| Active suppliers | 50,000 | Across all categories and regions |
| Active contracts | 15,000 | Including master agreements and SOWs |
| Procurement users | 5,000 | Buyers, approvers, analysts |
| Daily transactions for classification | 10,000 | POs, invoices, expense reports |
| Supplier risk signals/day | 500,000 | News, financial, ESG, delivery events |

### Storage Estimates

| Data Type | Per Record | Records | Total | Growth Rate |
|-----------|-----------|---------|-------|-------------|
| Purchase Orders | 5 KB | 2M/year | 10 GB/year | Linear |
| Line Items | 1 KB | 10M/year | 10 GB/year | Linear |
| Invoice Documents (OCR'd) | 200 KB | 2M/year | 400 GB/year | Linear |
| Contract Documents | 2 MB | 15K active | 30 GB | Slow growth |
| Spend Classification Features | 2 KB | 10M/year | 20 GB/year | Linear |
| Supplier Risk Features | 500 B | 50K × 365 | 9 GB/year | Linear |
| ML Model Artifacts | 500 MB | 20 models × 52 versions | 520 GB/year | Moderate |
| Audit Logs | 500 B | 100M events/year | 50 GB/year | Linear |
| Spend Cube (Aggregated) | --- | --- | 50 GB | Slow growth |
| **Total (per large tenant)** | | | **~1.1 TB/year** | |

### Compute Estimates

| Workload | Compute Requirement | Frequency |
|----------|-------------------|-----------|
| Spend Classification (ML inference) | 4 GPU instances | Continuous (streaming + batch) |
| Supplier Risk Scoring | 2 GPU instances | Hourly batches + real-time alerts |
| Price Optimization | 2 CPU instances (high-memory) | On-demand per sourcing event |
| Contract NLP Processing | 2 GPU instances | On contract ingestion |
| PO Generation & Approval Engine | 8 CPU instances | Continuous |
| Spend Analytics (OLAP queries) | 4 high-memory instances | On-demand, peak during business hours |
| Model Training Pipeline | 8 GPU instances | Weekly retraining cycles |

### Bandwidth Estimates

| Flow | Bandwidth | Pattern |
|------|-----------|---------|
| Supplier risk signal ingestion | 50 MB/hour | Continuous streaming |
| Document upload (invoices, contracts) | 200 MB/hour peak | Business hours burst |
| Analytics dashboard queries | 100 MB/hour | Business hours |
| ML model serving (inference) | 20 MB/hour | Continuous |
| ERP integration sync | 500 MB/hour peak | Scheduled + real-time |

---

## 4. SLOs / SLAs

| Metric | SLO (Internal) | SLA (Customer-Facing) | Measurement |
|--------|----------------|----------------------|-------------|
| **PO Creation Availability** | 99.97% | 99.95% | 5-min rolling window; excludes planned maintenance |
| **PO Creation Latency (p95)** | 1.5s | 2s | End-to-end from submission to PO number assignment |
| **Spend Classification Accuracy** | 96% | 93% | Measured against human-labeled validation set (monthly) |
| **Supplier Risk Score Freshness** | < 30 min after signal | < 1 hour | Time from signal ingestion to updated risk score |
| **Spend Dashboard Load Time (p95)** | 2s | 3s | Time to interactive for standard dashboards |
| **Contract Compliance Alert Latency** | < 5 min | < 15 min | Time from violation event to alert delivery |
| **Three-Way Match Rate** | 92% auto-match | 85% auto-match | Percentage matched without human intervention |
| **Approval Routing Accuracy** | 99.5% | 99% | Correct approver chain per policy rules |
| **ML Model Training Pipeline** | Complete within 4 hours | Complete within 8 hours | Weekly retraining cycle duration |
| **Data Pipeline Freshness** | < 15 min lag | < 30 min lag | Time from source system event to spend cube update |
| **Disaster Recovery (RTO)** | 10 min | 15 min | Time to restore PO and approval services |
| **Disaster Recovery (RPO)** | 30 sec | 1 min | Maximum data loss window |

---

## 5. Latency Budget Breakdown

### PO Creation (Target: p95 < 2,000ms)

```
Component                          Budget    Notes
─────────────────────────────────────────────────────────────
API Gateway (auth + routing)        20ms     JWT validation + tenant context injection
Intake parsing (NLP)                80ms     Extract item, quantity, category from request
Budget validation                   45ms     Pessimistic lock + balance check + reserve
  ├─ Lock acquisition                5ms     Row-level lock on cost center
  ├─ Balance check                  10ms     Compare remaining vs. PO amount
  └─ Replication                    30ms     Synchronous commit to replica
Sourcing service                   350ms     Supplier matching + risk + pricing
  ├─ Vector similarity search      120ms     Embedding-based supplier matching
  ├─ Risk score lookup              30ms     Feature store GET (cached)
  └─ Price benchmark               200ms     Should-cost model inference
PO record creation                  50ms     DB write + sequence number generation
Approval routing                    50ms     Rule evaluation + approver resolution
ERP sync (async kickoff)            15ms     Publish to ERP sync queue
Event publish                       10ms     Publish PO_CREATED to event bus
─────────────────────────────────────────────────────────────
Total critical path               ~620ms     Typical case (auto-approved)
Headroom for manual approval     +varies     Approval latency depends on approver
```

### Spend Classification (Target: p95 < 100ms per transaction, streaming mode)

```
Component                          Budget    Notes
─────────────────────────────────────────────────────────────
Text preprocessing                  10ms     Normalization, tokenization, entity extraction
Vendor resolution                   15ms     Hash lookup + fuzzy match if needed
Feature extraction                  20ms     Text embedding + vendor features from store
Hierarchical classification         40ms     L1→L2→L3→L4 sequential inference
  ├─ L1 classifier                   5ms     4 classes, lightweight
  ├─ L2 classifier                  10ms     ~50 classes, conditioned on L1
  ├─ L3 classifier                  12ms     ~500 classes, conditioned on L1+L2
  └─ L4 classifier                  13ms     ~5000 classes, conditioned on L1+L2+L3
Confidence calibration               5ms     Platt scaling + threshold check
Spend cube update (async)            5ms     Publish classified event
─────────────────────────────────────────────────────────────
Total critical path                ~95ms     Single transaction, streaming mode
Batch mode throughput            5,000/sec    GPU-optimized batch inference
```

---

## 6. Data Governance Requirements

| Requirement | Standard | Description |
|------------|----------|-------------|
| **SOX Audit Trail** | Sarbanes-Oxley Section 404 | Immutable record of all PO decisions, approvals, and AI-driven actions; auditors must be able to reconstruct decision context at any historical point |
| **Data Residency** | GDPR, India DPP, regional mandates | Tenant financial data stored within designated jurisdiction; cross-border transfer requires explicit consent and data processing agreements |
| **PII Minimization** | GDPR Art. 5(1)(c); CCPA | Supplier contact information, banking details encrypted at rest; system logs reference entity IDs, never raw PII |
| **Right to Erasure** | GDPR Art. 17 | Supplier profiles erasable upon request, but financial records (POs, invoices) retained per SOX mandate (7+ years); anonymization applied to non-financial fields |
| **Anti-Bribery Compliance** | FCPA; UK Bribery Act | Automated screening of supplier relationships against sanctions lists; flagging of gifts, entertainment, and facilitation payments in spend data |
| **AI Decision Explainability** | EU AI Act; SOX | Every autonomous PO decision must produce a machine-readable explanation: model version, features used, confidence score, rule checks passed |
| **Consent for Data Aggregation** | Multi-tenant SaaS | Tenant opt-in/opt-out for contributing anonymized data to global model training; clear data processing agreement defining aggregation scope |
| **Breach Notification** | GDPR 72h; CCPA 30d | Automated breach detection triggers notification pipeline; pre-drafted regulatory templates per jurisdiction |

---

## 7. Key Estimation Insights

1. **Document Intelligence is the GPU Slowest part of the process**: OCR + NLP processing (45--260 seconds per complex document) is the most resource-intensive workload. A two-speed architecture (structured docs bypass OCR; only scanned documents use GPU) reduces GPU utilization by 60% while improving average latency by 5x.

2. **Vendor name resolution is the data quality gate**: Without robust entity resolution, spend analytics fragments across name variations. The resolution pipeline (exact → fuzzy → ML → clustering) must run before any classification or aggregation, adding latency but preventing downstream data corruption.

3. **Budget ledger is the serialization point**: Pessimistic locking on cost center budget rows serializes concurrent PO creation. At < 10 concurrent POs per cost center per minute, this is acceptable. For organizations with high-volume cost centers, the reservation pattern (reserve → confirm/release) provides better throughput.

4. **Feature store eliminates training-serving skew**: Without centralized feature computation, ML models trained on warehouse-computed features diverge from features computed at serving time. The dual-layer feature store (offline for training, online for serving, same computation logic) eliminates this class of bugs.

5. **Spend cube storage scales with temporal depth**: The bi-temporal data model (transaction time + valid time) requires 3--5x storage compared to a non-temporal cube. For a $5B enterprise, this means ~150--250 GB for the spend cube instead of ~50 GB. The cost is non-negotiable for SOX compliance and ML point-in-time correctness.

6. **Signal deduplication is critical during burst events**: A major geopolitical event generates 100K+ news articles in hours. Without semantic deduplication (embedding similarity), the risk scoring pipeline is overwhelmed. Deduplication reduces signal volume by 60--80% during bursts.

7. **Cold-start accuracy determines tenant onboarding velocity**: New tenants reach productive use faster with global model baseline (80% L2 accuracy from day one) plus active learning. The 30-day ramp to 90%+ accuracy is the key metric for customer success.

8. **Multi-tenant compute sharing drives economics**: A dedicated GPU cluster per tenant is prohibitively expensive. Shared GPU pools with tenant-fair scheduling and priority queuing achieve 85% utilization vs. 30% for dedicated resources, making the SaaS model viable for mid-market customers.

9. **Idempotency is non-negotiable for financial operations**: At 10K POs/hour peak with network retries and API gateway retry policies, duplicate PO creation is a real risk. A 24-hour idempotency window with ~200M keys × 200 bytes = 40 GB fits easily in an in-memory store, preventing financial errors at negligible cost.
