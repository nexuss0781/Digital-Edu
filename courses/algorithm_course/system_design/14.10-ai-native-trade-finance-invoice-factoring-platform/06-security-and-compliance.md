# 14.10 AI-Native Trade Finance & Invoice Factoring Platform — Security & Compliance

## Authentication & Authorization

### Authentication Architecture

| Actor | Authentication Method | Session Management |
|---|---|---|
| MSME Users (Web/Mobile) | OAuth 2.0 + OpenID Connect with MFA; optional biometric on mobile | JWT access tokens (15-min expiry) + refresh tokens (30-day expiry, rotated on use) |
| Financier Users | OAuth 2.0 with mandatory MFA (TOTP or hardware key); IP allowlisting | JWT with 5-min expiry for sensitive operations; per-session IP binding |
| Anchor Corporate Users | SSO via SAML 2.0 integration with corporate IdP; MFA enforced | Federated session management; session terminated on IdP logout |
| ERP Integrations | API key + mutual TLS (mTLS); per-integration rate limits | Stateless; each request authenticated independently |
| TReDS Platforms | mTLS with certificate pinning; IP allowlisting | Stateless API authentication |
| Internal Services | Service mesh with mTLS; SPIFFE/SPIRE for service identity | Zero-trust service-to-service authentication |
| Platform Operations | SSO + hardware security key + privilege escalation for sensitive operations | Session recording for audit; auto-logout after 10 minutes of inactivity |

### Authorization Model

**Role-Based Access Control (RBAC) with Attribute-Based Overlays:**

```
Role Hierarchy:
├── PLATFORM_ADMIN          (full access; restricted to CXO + security team)
├── PLATFORM_OPS            (operations: settlement management, dispute resolution)
├── COMPLIANCE_OFFICER      (regulatory reports, KYC approvals, STR filing)
├── RISK_ANALYST            (credit model management, fraud review)
├── FINANCIER_ADMIN         (portfolio management, bid approval, limit management)
├── FINANCIER_ANALYST       (view portfolio, place bids, view analytics)
├── ANCHOR_ADMIN            (supplier onboarding, program management)
├── ANCHOR_VIEWER           (view program analytics, supplier status)
├── MSME_ADMIN              (manage invoices, view deals, manage users)
└── MSME_USER               (upload invoices, view deal status)
```

**Attribute-Based Overlays:**
- **Data isolation**: An MSME user can only access their own invoices and deals; a financier can only access deals they've funded or are eligible to bid on
- **Value-based escalation**: Deal approval requires a higher authority based on deal value:
  - < ₹50 lakh: auto-approved (if within financier's pre-set criteria)
  - ₹50 lakh – ₹5 crore: Financier Analyst can approve
  - ₹5 crore – ₹25 crore: Financier Admin must approve
  - > ₹25 crore: Maker-checker with two separate Financier Admins
- **Temporal access**: Month-end close operations (ledger adjustments, provisioning) are only available during the close window (last 3 business days of month)

### Maker-Checker Enforcement

All high-value or high-risk operations require maker-checker:

| Operation | Maker | Checker | Additional Controls |
|---|---|---|---|
| Deal approval (> ₹5 crore) | Financier Analyst | Financier Admin | Cannot be same person; 4-eye principle |
| Manual settlement override | Platform Ops | Platform Ops (different user) | Must provide written justification; auto-logged |
| Credit model deployment | Risk Analyst | Risk Lead | Canary deployment; automatic rollback on degradation |
| KYC override (manual approval) | Compliance Officer | Compliance Lead | Time-limited (24-hour) approval; re-verification in 30 days |
| Platform fee adjustment | Platform Ops | Platform Admin | Audit trail with business justification |
| Financier limit increase | Financier Admin | Platform Ops | Requires updated financial documents |

---

## Data Security

### Encryption

| Data Category | At Rest | In Transit | Key Management |
|---|---|---|---|
| Financial ledger entries | AES-256 (database-level TDE) | TLS 1.3 (inter-service) | HSM-backed keys; key rotation every 90 days |
| Invoice documents | AES-256 (object storage encryption) | TLS 1.3 | Per-tenant encryption keys; stored in HSM |
| Bank account details | AES-256 with application-level encryption | TLS 1.3 + tokenization | Separate encryption key from database TDE; HSM-stored |
| PAN/GSTIN (PII) | AES-256 with application-level encryption | TLS 1.3 | Encrypted at application layer before database write |
| Credit scores | Database-level TDE | TLS 1.3 | Standard database encryption key |
| Audit logs | AES-256 + integrity hashing (SHA-256 chain) | TLS 1.3 | WORM storage prevents modification; hash chain detects tampering |
| API keys and secrets | Vault-encrypted | Never transmitted in plaintext; only via vault API | Vault with auto-unsealing; secrets rotated on schedule |

### Data Masking and Tokenization

- **Bank account numbers**: Tokenized at ingestion; original stored in vault; only tokenized reference used in application logic
- **PAN numbers**: Masked in all UIs (show only last 4 digits); full PAN accessible only via authorized API call with audit logging
- **Invoice amounts**: Visible to authorized parties only; anonymized in analytics (shown as percentiles or ranges)
- **Buyer identity**: Anonymized in financier-facing marketplace view until deal is accepted; prevents cherry-picking

---

## Threat Model

### STRIDE Analysis

| Threat | Category | Attack Vector | Mitigation |
|---|---|---|---|
| **Fictitious invoice injection** | Spoofing | Fraudster creates fake invoices with fabricated buyer details to obtain financing | GST cross-verification (invoice must exist in GSTR filings); buyer confirmation workflow; e-invoice IRN validation; anomaly detection on new supplier-buyer pairs |
| **Duplicate financing** | Tampering | MSME submits same invoice to multiple platforms simultaneously | Document hash deduplication; cross-platform registry integration; GST IRN uniqueness check; behavioral monitoring (financing ratio vs. revenue) |
| **Credit score manipulation** | Tampering | Adversary manipulates input signals to inflate buyer credit score | Feature integrity checks (cross-validate bureau data with GST filings); anomaly detection on score changes; manual review for score jumps > 15 points |
| **Unauthorized deal creation** | Elevation of Privilege | Compromised MSME account used to create fraudulent deals | MFA for deal creation; transaction velocity limits; notification to MSME on every deal; IP and device fingerprinting |
| **Settlement diversion** | Tampering | Attacker modifies disbursement bank account to redirect funds | Bank account change requires re-verification (penny-drop + OTP); 48-hour cooling period for new bank accounts; maker-checker for account changes |
| **Data exfiltration** | Information Disclosure | Insider or external attacker extracts financial data for competitive intelligence or fraud | Data classification and access controls; DLP (Data Loss Prevention) on egress; database query auditing; anomaly detection on data access patterns |
| **Denial of service on settlement** | Denial of Service | Attacker floods settlement engine with invalid requests to delay legitimate settlements | Rate limiting per client; separate queues for settlement (priority) vs. general traffic; circuit breakers on external dependencies |
| **Collusion between MSME and buyer** | Spoofing | MSME and buyer collude to create fictitious invoices and split the financing proceeds | Graph-based relationship analysis; shared director/address detection; abnormal payment patterns (buyer always pays exactly on day 1 instead of at maturity) |

### API Security

| Control | Implementation |
|---|---|
| Rate limiting | Per-tenant, per-endpoint limits; graduated: 100 RPS (MSME), 1,000 RPS (financier), 5,000 RPS (ERP integration) |
| Input validation | Schema validation on all inputs; parameterized queries (no raw SQL); file upload scanning (virus, malware, embedded macros) |
| Output sanitization | PII redaction in error messages; no stack traces in production responses; structured error codes |
| Request signing | HMAC-SHA256 request signing for ERP integrations and TReDS APIs; prevents replay attacks |
| Webhook verification | HMAC signature on all outbound webhooks; recipient must verify signature before processing |

---

## Regulatory Compliance

### RBI NBFC Compliance

| Regulation | Requirement | Implementation |
|---|---|---|
| **Capital adequacy (CRAR)** | Maintain capital adequacy ratio ≥ 15% of risk-weighted assets | Real-time CRAR calculation based on funded portfolio; alerts when approaching threshold; automated rejection of new deals if CRAR would breach |
| **NPA classification** | Classify assets as NPA when overdue > 90 days; sub-standard, doubtful, loss categories | Automated DPD tracking per deal; NPA reclassification triggered at DPD=90; provisioning automatically calculated per RBI norms |
| **Provisioning norms** | Standard assets: 0.40%; Sub-standard: 15%; Doubtful: 25-100%; Loss: 100% | Real-time provisioning calculation; provisioning impact shown to financiers before deal acceptance; month-end provisioning report auto-generated |
| **Fair practices code** | Transparent pricing, no hidden charges, proper communication of terms | Pricing breakdown shown to MSME before acceptance; cooling-off period for first-time borrowers; vernacular communication of terms (if applicable) |
| **Reporting** | Monthly/quarterly returns to RBI: NPA reports, capital adequacy, ALM statements | Automated report generation from event-sourced ledger; scheduled filing with confirmation; historical report regeneration for audits |

### GST Act Compliance

| Requirement | Implementation |
|---|---|
| **E-invoicing mandate** | For invoices above threshold (currently ₹5 crore): mandatory e-invoice with IRN from GST portal; system validates IRN before accepting invoice |
| **GSTR reconciliation** | Cross-match every invoice against GSTR-1 (seller's filing) and GSTR-2B (buyer's auto-populated return); flag mismatches |
| **HSN code validation** | Validate HSN codes on invoices against government master; incorrect HSN codes may indicate fabricated invoices |
| **Tax deduction at source** | For applicable transactions, ensure TDS is correctly calculated and reported; integrate with Form 26AS reconciliation |

### FEMA and Cross-Border Compliance

| Requirement | Implementation |
|---|---|
| **Purpose code validation** | Every cross-border transaction must have a valid RBI purpose code; system enforces purpose code selection and validates against transaction type |
| **EDPMS reporting** | Export invoices must be reported in the Export Data Processing and Monitoring System; automated filing within mandated timelines |
| **LRS limits** | Individual remittances checked against Liberalized Remittance Scheme limits ($250,000/year); system tracks and enforces |
| **Correspondent banking** | Cross-border settlements routed through authorized correspondent banking channels; no direct transfers to sanctioned jurisdictions |

### AML/KYC Compliance

| Control | Implementation |
|---|---|
| **Customer Due Diligence** | Tier-based KYC: Simplified (< ₹50 lakh annual limit), Standard (₹50 lakh – ₹5 crore), Enhanced (> ₹5 crore or high-risk profile) |
| **Beneficial ownership** | Identify and verify individuals with > 10% ownership; recursive lookup for multi-layered corporate structures |
| **Transaction monitoring** | Rule-based + ML-based transaction monitoring; rules cover structuring (splitting to avoid thresholds), rapid movement, and circular flows |
| **Suspicious Transaction Reports** | Automated STR generation for detected suspicious patterns; filed with FIU-IND within mandated timeline; secure filing channel |
| **Sanctions screening** | Real-time screening against OFAC, EU, UN, and domestic sanctions lists; screening on onboarding + every transaction |
| **Record retention** | All KYC records, transaction records, and STRs retained for minimum 5 years after business relationship ends |

---

## Audit Trail Architecture

### Event-Sourced Audit Log

Every state change, user action, and system decision is recorded as an immutable event:

```
Event Structure:
{
    event_id:        <monotonic ID>,
    timestamp:       <nanosecond precision>,
    entity_type:     "INVOICE" | "DEAL" | "SETTLEMENT" | "CREDIT_SCORE" | ...,
    entity_id:       <UUID>,
    event_type:      "CREATED" | "STATUS_CHANGED" | "PRICED" | "APPROVED" | ...,
    actor_id:        <UUID of user or system service>,
    actor_type:      "USER" | "SYSTEM" | "API_CLIENT",
    actor_role:      "MSME_USER" | "FINANCIER_ADMIN" | "SETTLEMENT_ENGINE" | ...,
    old_state:       { ... },
    new_state:       { ... },
    metadata:        { ip_address, user_agent, request_id, correlation_id },
    hash:            SHA-256(previous_event_hash + this_event_data)
}
```

**Integrity Guarantees:**
- Each event's hash includes the previous event's hash → cryptographic chain prevents insertion, deletion, or reordering
- Periodic hash verification (hourly): recompute chain from last verified checkpoint; alert if any hash mismatches
- Write-once storage: audit log stored on WORM (Write Once Read Many) storage; even platform administrators cannot modify historical events
- Independent audit hash published to external timestamping service (blockchain-based or third-party TSA) daily → provides external proof that the audit log existed in a specific state at a specific time

---

## Trade Finance-Specific Attack Patterns

| # | Attack Pattern | Sophistication | Detection Method | Mitigation |
|---|---|---|---|---|
| 1 | **Coordinated invoice inflation ring** | A group of colluding MSMEs systematically inflate invoice amounts by 30-50% across different buyers, staying below individual detection thresholds | Aggregate analysis: compare total financed amount per MSME against GST-reported revenue; deviation > 110% triggers investigation | Revenue-to-financing ratio monitoring; automatic hold on MSMEs where financed value exceeds 120% of reported annual revenue; require purchase order matching for invoices above ₹10 lakh |
| 2 | **Buyer impersonation via GST clone** | Fraudster creates a new GSTIN using stolen identity documents, files minimal GST returns to appear legitimate, then submits fictitious invoices against the cloned identity | Verify GSTIN registration date; new GSTINs (< 6 months) with first-time invoice financing require enhanced due diligence; cross-reference with company registrar (MCA) data | Age-gated GSTIN thresholds: entities with GSTIN < 6 months require additional verification (director KYC, bank statement, physical verification); maximum financing limit of ₹5 lakh for entities < 12 months old |
| 3 | **Settlement timing manipulation** | Buyer colludes with MSME to mark invoices as paid early (claiming early payment discount) while simultaneously the MSME withdraws the financed amount, creating a double-payment scenario | Monitor for early payment patterns that deviate from buyer's historical behavior; cross-reference with NACH mandate execution status; flag buyer-MSME pairs with unusually high early settlement rates | Mandatory 48-hour hold on early settlement proceeds; re-verify buyer's bank statement for the claimed payment; auto-cancel pending NACH mandates before releasing early settlement funds |
| 4 | **Credit model poisoning via strategic defaults** | Sophisticated actor intentionally pays invoices late on a specific pattern (e.g., late on small invoices, on-time on large ones) to manipulate the credit model into underweighting certain risk signals | Track DPD distribution by invoice amount band per buyer; flag buyers with bimodal payment patterns; monitor credit score changes that don't correlate with expected business fundamentals | Segment-aware credit scoring: model trained on amount-stratified payment behavior; anomaly detection on credit score trajectory; human review for buyers with inconsistent payment patterns across amount bands |
| 5 | **Cross-platform arbitrage** | MSME submits the same invoice to two platforms—finances on the platform with the lower rate, then if the buyer defaults, claims insurance on the platform with the higher rate | Cross-platform hash registry participation; monitor for MSMEs who maintain accounts on multiple known platforms; detect sudden changes in invoice submission patterns (volume drop suggesting dual-platform activity) | Mandatory cross-platform dedup check before funding; contractual exclusivity clause with liquidated damages; credit bureau reporting within 24 hours of disbursement (rather than standard 30-day lag) |

**Invoice Injection Detection:**

```
FUNCTION ValidateInvoiceSource(invoice, request_context):
    risk_signals = []

    // Check document provenance
    IF invoice.source == "PDF_UPLOAD":
        metadata = ExtractPDFMetadata(invoice.document)
        IF metadata.creation_tool IN KNOWN_FABRICATION_TOOLS:
            risk_signals.APPEND("suspicious_creation_tool")
        IF metadata.modification_count > 3:
            risk_signals.APPEND("excessive_modifications")
        IF metadata.creation_date > invoice.invoice_date + 7_DAYS:
            risk_signals.APPEND("backdated_document")

    // Check submission pattern
    recent_submissions = GetRecentSubmissions(invoice.supplier_id, 24_HOURS)
    IF COUNT(recent_submissions) > supplier.historical_daily_avg * 3:
        risk_signals.APPEND("velocity_anomaly")

    // Check for format inconsistency
    IF invoice.supplier_id IN known_suppliers:
        template_similarity = CompareToHistoricalTemplates(invoice, invoice.supplier_id)
        IF template_similarity < 0.7:
            risk_signals.APPEND("template_deviation")

    // Check geographic consistency
    IF request_context.ip_geolocation != invoice.supplier_registered_state:
        risk_signals.APPEND("geo_mismatch")

    RETURN InvoiceValidation(
        risk_signals = risk_signals,
        risk_score = ComputeAggregateScore(risk_signals),
        action = DetermineAction(risk_signals)
    )
```

---

## Compliance Automation

| # | Compliance Requirement | Automation | Frequency | Evidence Generation |
|---|---|---|---|---|
| 1 | **CRAR calculation** | Real-time computation of capital adequacy ratio from funded portfolio risk weights; automated rejection of new deals that would breach the 15% minimum | Continuous (every deal creation/settlement) | Daily CRAR snapshot stored in audit log; monthly regulatory report auto-generated; alert at 16% (pre-breach warning) |
| 2 | **NPA classification** | Automated DPD tracking per deal; reclassification at DPD=90 (sub-standard), DPD=180 (doubtful), DPD=365 (loss); provisioning auto-calculated per RBI norms | Real-time (on payment event) + daily batch reconciliation | NPA register with timestamped classification changes; provisioning calculation audit trail; monthly NPA report for board and RBI |
| 3 | **STR filing** | ML-based suspicious transaction detection triggers pre-filled STR forms; compliance officer reviews and approves; automated submission to FIU-IND within regulatory timeline | Real-time detection + batch review | Complete investigation trail from trigger event through filing; response tracking from FIU-IND; 5-year retention of all STR documentation |
| 4 | **GST reconciliation** | Automated matching of every financed invoice against GSTR-1/2B filings; discrepancy flagging; monthly reconciliation report for each MSME and buyer | Per-invoice (at funding) + monthly batch | Reconciliation report with invoice-level match status; discrepancy resolution tracking; quarterly summary for GST audit |
| 5 | **EDPMS reporting** | Automated filing of export invoice details in RBI's Export Data Processing and Monitoring System; tracks shipment, realization, and write-off status | Per export deal + monthly reconciliation | Filing confirmation receipts; realization tracking dashboard; automated follow-up for unrealized exports approaching deadline |
| 6 | **AML transaction monitoring** | Rule-based + ML monitoring: structuring detection (splits to avoid thresholds), rapid fund movement, circular flows, unusual geographic patterns | Real-time (per transaction) + daily batch | Transaction monitoring alerts with investigation status; case management workflow; regulatory examination-ready report |
| 7 | **DPDP Act compliance** | Consent management for MSME financial data; data minimization enforcement; right-to-erasure workflows; data processing activity logs | Continuous | Consent audit trail; data processing register; erasure completion certificates; annual privacy impact assessment |

**Compliance Event Log Schema:**

```
ComplianceEvent:
    event_id:           <UUID>
    timestamp:          <nanosecond precision>
    regulation:         "RBI_NBFC" | "GST_ACT" | "FEMA" | "AML" | "DPDP"
    requirement:        "CRAR_CHECK" | "NPA_CLASSIFICATION" | "STR_FILING" | ...
    entity_type:        "DEAL" | "SETTLEMENT" | "MSME" | "BUYER"
    entity_id:          <UUID>
    check_result:       "PASS" | "FAIL" | "WARNING" | "MANUAL_REVIEW"
    details:            { threshold, actual_value, required_action }
    action_taken:       "AUTO_APPROVED" | "AUTO_REJECTED" | "ESCALATED" | "FILED"
    actor:              "SYSTEM" | <compliance_officer_id>
    evidence_hash:      SHA-256(all_supporting_data)
```

---

## Encryption Key Hierarchy

```
Key Management Hierarchy:
├── Master Key (HSM-stored, never exported)
│   ├── Ledger Encryption Key (rotated quarterly)
│   │   ├── Per-partition sub-keys for ledger DB TDE
│   │   └── Hash chain signing key
│   ├── Document Encryption Key (rotated annually)
│   │   └── Per-tenant sub-keys for invoice document encryption
│   ├── PII Encryption Key (rotated quarterly)
│   │   ├── Bank account tokenization key
│   │   ├── PAN/GSTIN application-level encryption key
│   │   └── KYC document encryption key
│   ├── API Signing Key (rotated monthly)
│   │   ├── HMAC signing for ERP integrations
│   │   ├── Webhook signing for financier callbacks
│   │   └── TReDS API mutual authentication
│   └── Audit Log Signing Key (rotated annually)
│       ├── Event hash chain key
│       └── External attestation signing key
```

**Key Rotation Procedure:**
- **Zero-downtime rotation**: New key encrypts all new data; old key retained for decryption of existing data until re-encryption batch completes
- **Re-encryption budget**: 50 TB of ledger data re-encrypted over 72-hour window; automated verification that all data accessible after rotation
- **Emergency rotation**: If key compromise suspected, rotate within 4 hours; accept temporary performance degradation during re-encryption burst

---

## Data Residency and Cross-Border Data Controls

| Data Type | Residency Requirement | Cross-Border Transfer Rule |
|---|---|---|
| Financial ledger and audit log | India only (RBI data localization) | No transfer permitted; all processing within Indian data centers |
| MSME KYC documents | India only (DPDP Act) | No transfer; anonymized statistics may be exported for global analytics |
| Invoice documents | India only (originals); encrypted copies to DR region within India | Cross-border only for export finance: invoice shared with counterparty bank per FEMA guidelines |
| Credit scores and risk models | India only (model and features) | Anonymized model performance metrics may be exported for global model governance |
| Buyer payment behavior data | India only | Aggregated, anonymized industry benchmarks may be exported; individual buyer data never crosses border |
| Export finance documentation | India primary; copies shared with correspondent banks per LC terms | Governed by UCP 600 rules; shared only with named parties in the LC |

---

## Insider Threat Mitigation

| Control | Implementation | Monitoring |
|---|---|---|
| **Privileged access management** | Just-in-time elevation: platform ops access production database only via break-glass procedure with time-limited credentials (1-hour max) | All privileged sessions recorded; automatic review of any database query accessing > 100 records |
| **Separation of duties** | No single person can create a deal AND approve settlement; credit model deployers cannot modify training data; compliance officers cannot modify ledger entries | Role conflict matrix checked daily; violations generate P1 alerts |
| **Data export controls** | All bulk data exports (> 1,000 records) require manager approval; DLP agents monitor egress points for PII patterns (GSTIN, PAN, bank account formats) | Weekly report of all data exports by volume, destination, and requester |
| **Code deployment controls** | All production deployments require two approvals (developer + team lead); settlement engine and ledger service deployments require additional security team review | Deployment audit trail; automated rollback if post-deployment anomaly detected within 30 minutes |
| **Financial reconciliation** | All manual ledger adjustments require dual authorization AND are limited to ₹1 lakh per adjustment; larger adjustments require CFO approval | Monthly reconciliation of manual adjustments against supporting documentation |

---

## Third-Party Risk Assessment

| Third Party | Risk Category | Controls |
|---|---|---|
| **Banking partners** (settlement APIs) | Financial — settlement failure could strand funds | Redundant banking relationships (minimum 2 banks per payment rail); daily reconciliation; escrow balances verified independently |
| **GSTN** (government API) | Operational — outage blocks invoice verification | Graceful degradation mode; 24-hour cache strategy; no single-transaction dependency |
| **Credit bureaus** | Data quality — stale or incorrect data affects pricing | Cross-validate bureau data against platform payment history; anomaly detection for sudden score changes not correlated with platform observations |
| **Cloud infrastructure** | Availability — platform-wide outage | Multi-AZ deployment within India; DR region with synchronous ledger replication; no dependency on single cloud provider for settlement-critical path |
| **OCR/ML model providers** | AI supply chain — model quality degradation | Shadow scoring against production model; automatic rollback on quality degradation; model weights stored and versioned internally |

---

## Security Incident Response

| Incident Type | Response Time | Containment Action | Communication |
|---|---|---|---|
| **Suspected data breach** | 15 minutes (detection to response) | Isolate affected systems; revoke compromised credentials; activate forensic logging | Notify CERT-In within 6 hours (per IT Act); notify affected parties per DPDP Act timeline |
| **Confirmed fraud ring** | 1 hour | Freeze accounts of involved entities; halt disbursements; preserve evidence | Notify financiers with exposure; file STR with FIU-IND; engage legal |
| **Insider data access anomaly** | 30 minutes | Revoke access; initiate investigation; preserve audit logs | Notify CISO; escalate to HR if employee involved |
| **Settlement system compromise** | 5 minutes | Halt all settlements; activate manual reconciliation; verify escrow integrity | Page on-call + management; notify banking partners; regulatory disclosure if funds affected |
| **DDoS on API gateway** | 2 minutes (auto-mitigation) | Rate limiting escalation; geographic blocking; CDN-based absorption | Status page update; notify financiers of potential API latency |

---

## Privacy-Preserving Analytics

The platform holds commercially sensitive data about buyer-supplier relationships, transaction volumes, and pricing. Analytics and model training must respect data boundaries.

| Use Case | Data Required | Privacy Control |
|---|---|---|
| **Credit model training** | Buyer payment history across all suppliers | Anonymize buyer identity in training set; use buyer_id hash; no supplier names in features |
| **Industry benchmarks** | Aggregate payment behavior by industry sector | Minimum k-anonymity (k=50): benchmark only published when ≥ 50 buyers contribute; individual buyer behavior never derivable |
| **Platform-wide risk dashboard** | Portfolio composition, default rates, concentration | Role-based access: financiers see only their own portfolio; platform admin sees aggregate; no cross-financier data leakage |
| **Working capital advisor** | MSME's receivables, payables, cash flow | Consent-gated: MSME explicitly opts in to data sharing for advisory; data not used for credit scoring of the MSME itself |
| **Fraud detection model** | Cross-entity transaction patterns | Purpose limitation: fraud detection data used only for fraud prevention; not shared with credit scoring or pricing engines |
| **Regulatory reporting** | Transaction-level detail for RBI, GST, FEMA | Minimum necessary: reports contain only fields required by regulation; no additional enrichment |

**Differential Privacy for Benchmarks:**
When publishing industry benchmarks (e.g., "average payment days for auto sector buyers"), the platform adds calibrated noise to prevent individual buyer identification. Noise level calibrated to maintain utility (±2 days accuracy) while ensuring no single buyer's behavior can be inferred from the published benchmark, even with auxiliary information.

---

## Regulatory Examination Readiness

The platform must be audit-ready at all times, not just during scheduled examinations.

| Examination Type | Frequency | Required Artifacts | Auto-Generated |
|---|---|---|---|
| **RBI on-site inspection** | Annual + ad-hoc | CRAR calculation, NPA register, provisioning report, ALM statement, top 100 exposures | Yes — all generated from event-sourced ledger on demand |
| **Statutory audit** | Annual | Financial statements, ledger integrity verification, internal control testing | Yes — hash chain verification + point-in-time balance reconstruction |
| **GST audit** | Annual | Invoice-wise reconciliation, ITC claims verification, GSTR match reports | Yes — automated from invoice verification pipeline |
| **FEMA examination** | Ad-hoc | Cross-border transaction listing, purpose code compliance, EDPMS filing status | Yes — FEMA compliance events auto-logged per transaction |
| **FIU-IND inquiry** | Ad-hoc (investigation) | STR filings, transaction trails for specified entities, KYC records | Yes — complete entity timeline from audit event store |
| **Internal audit** | Quarterly | Maker-checker compliance, access privilege review, settlement exception analysis | Yes — automated reports from RBAC and settlement logs |

**Examination Response SLA:** Platform can produce any regulatory report within 4 hours of request. Historical state reconstruction (point-in-time portfolio) available within 1 hour for the last 10 years.
