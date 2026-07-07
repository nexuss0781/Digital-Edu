# 14.14 AI-Native Regulatory & Compliance Assistant for MSMEs — Security & Compliance

## The Meta-Compliance Challenge

A compliance management platform must itself be compliant. This creates a unique recursive requirement: the system that tracks whether businesses meet their regulatory obligations must meet its own regulatory obligations—data protection laws (DPDP Act 2023), information security standards, intermediary liability rules, and financial data handling requirements. A security breach in a compliance platform is doubly damaging: it compromises sensitive business data and simultaneously undermines the trust foundation that the platform's entire value proposition rests on. India's Digital Personal Data Protection Act (2023), with enforcement rules rolling out in 2025-2026, adds specific obligations around consent management, data minimization, breach notification, and cross-border data transfer that the platform must satisfy while also helping its customers understand their own DPDP obligations.

---

## Domain-Specific Threat Model

### Threat Categories Unique to Regulatory Compliance Platforms

| Threat | Attack Vector | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| **Credential stuffing on user accounts** | Automated login attempts with leaked credentials | High | Access to business compliance data, financial figures, PAN/GSTIN | Rate limiting, OTP-based auth (no passwords for mobile), account lockout after 5 failures, per-IP throttling |
| **Knowledge graph poisoning** | Compromised admin account injects false regulation, causing businesses to miss real obligations or comply with non-existent ones | Low | Mass incorrect compliance guidance; penalty exposure for affected businesses | Human review for all new regulation entries; versioned graph with rollback; validation pipeline with cross-reference against legal databases; dual-approval for graph write access |
| **Notification channel hijacking** | Attacker sends fake compliance notifications impersonating the platform | Medium | Phishing: fake "urgent filing" links to credential harvesting sites; fake deadline panic causing unnecessary actions | Branded message templates (WhatsApp verified business), sender ID registration for SMS, DKIM/SPF for email, in-app notification as authoritative source of truth |
| **Document vault data exfiltration** | Insider threat or compromised service account extracts compliance documents in bulk | Low | Bulk theft of PAN numbers, GSTIN, financial data, filing receipts across thousands of businesses | Per-tenant encryption keys, no bulk listing API, rate-limited downloads, anomaly detection on access patterns, break-glass access with mandatory audit |
| **Accountant account compromise** | CA account with access to 15-30 businesses compromised | Medium | Lateral access to multiple businesses' compliance data simultaneously | Per-business session tokens (CA must select active business), action logging per business, anomaly detection on cross-business access patterns, time-based access restrictions |
| **Government portal API impersonation** | Filing submitted to attacker-controlled endpoint mimicking government portal | Low | Intercepted filing data including financial details; filings not actually submitted | Certificate pinning for government API endpoints, URL allowlisting, human verification for new portal integrations, submission receipts cross-verified against official portal |
| **Regulatory translation manipulation** | LLM prompt injection in regulatory text causes incorrect plain-language translation | Low | Business owner receives wrong action items (e.g., "no action needed" when action is required) | Output validation pipeline checks LLM responses against structured obligation data; citation verification ensures LLM answer references actual regulation sections; human review for high-impact translations |
| **Consent withdrawal weaponization** | Competitor or malicious actor triggers mass consent withdrawals to disrupt service | Low | Mass data deletion cascade; businesses lose access to compliance history | Consent withdrawal requires OTP verification from business owner; 7-day cooling period with data locked (not deleted) during review; statutory retention overrides withdrawal for legally required documents |

---

## Data Classification and Protection

### Data Sensitivity Tiers

| Tier | Data Types | Protection Requirements |
|---|---|---|
| **Critical** | GST credentials, PAN numbers, bank account details, digital signatures, Aadhaar (if used for e-sign) | Encrypted at rest with envelope encryption; field-level encryption; access logged and alerted; never cached in plaintext; hardware security module for key management |
| **Sensitive** | Filing data, financial figures (turnover, tax paid), employee counts, salary data, ITC details | Encrypted at rest; access controlled by role; audit logged; retained per statutory requirements; DPDP consent required for processing |
| **Confidential** | Business profiles, compliance calendars, obligation maps, audit readiness scores | Encrypted at rest; tenant-isolated access; no cross-tenant data leakage; DPDP consent required |
| **Internal** | Regulatory text (public information), knowledge graph, system configuration | Standard encryption at rest; broadly accessible within the platform; no PII content |

### Encryption Architecture

```
Encryption Layers:
├── Transport: TLS 1.3 for all API communication
│   ├── Certificate pinning for mobile apps
│   ├── Mutual TLS for inter-service communication
│   ├── HSTS headers with 1-year max-age
│   └── Government API communication: TLS 1.2+ (some portals don't support 1.3)
│
├── Storage: Envelope encryption with per-tenant keys
│   ├── Master Key: Hardware security module (HSM)
│   ├── Data Encryption Key (DEK): Per-tenant, per-data-class
│   ├── DEK encrypted by master key (key wrapping)
│   ├── Key rotation: DEKs rotated quarterly; master key rotated annually
│   └── Key destruction on tenant deletion (crypto-shredding for DPDP compliance)
│
├── Field-Level: Critical fields encrypted at application layer
│   ├── GSTIN, PAN: Encrypted with searchable encryption (deterministic for exact match)
│   ├── Bank details: Encrypted with non-deterministic encryption (no search needed)
│   ├── Digital signatures: Encrypted and access-logged
│   └── Aadhaar: Encrypted per UIDAI guidelines; separate key hierarchy
│
└── Document Vault: Content encryption + integrity
    ├── Each document encrypted with unique DEK
    ├── Dual-hash (SHA-256 + SHA-3) computed before encryption
    ├── Hashes stored separately from encrypted content
    ├── Integrity verification: decrypt → recompute hashes → compare both
    └── Hash migration plan for algorithm obsolescence (7-10 year horizon)
```

### Tenant Data Isolation

```
Isolation Enforcement Points:
├── API Layer
│   ├── JWT token includes business_id claim
│   ├── Every API request validated: requested resource belongs to token's business_id
│   ├── CA tokens include explicit list of authorized business_ids
│   ├── Cross-tenant access attempt → 403 + security alert + rate limit tightening
│   └── API gateway enforces business_id in every downstream service call
│
├── Database Layer
│   ├── Row-level security policies enforce business_id filtering
│   ├── Database connection pool per service (not per tenant)
│   ├── Query auditing: flag queries without business_id filter → auto-block in production
│   ├── Periodic cross-tenant leakage testing (synthetic businesses with canary data)
│   └── Stored procedures for sensitive operations (prevent raw SQL with missing filters)
│
├── Document Storage Layer
│   ├── Object path: /{business_id}/{year}/{document_id}
│   ├── Pre-signed URLs scoped to business_id prefix with 15-minute expiry
│   ├── No listing permission—documents accessed by ID only
│   ├── Cross-business document access → immediate security incident
│   └── Per-tenant encryption key for document vault
│
├── Search Layer
│   ├── Search queries always include business_id filter
│   ├── Index-level: documents tagged with business_id
│   ├── Query-time filtering (not index-time partitioning) for cost efficiency
│   └── Periodic audit: verify search results never leak cross-tenant data
│
└── LLM Layer
    ├── Business context injected per-request; no cross-business context leakage
    ├── LLM responses validated to contain only data from the requesting business
    ├── No business data used in LLM training without explicit consent
    └── LLM conversation logs isolated per business; auto-deleted after 30 days
```

---

## Authentication and Authorization

### Authentication Framework

```
Authentication Flows:
├── Business Owner / Admin
│   ├── Mobile OTP (primary): Phone number + OTP via SMS/WhatsApp
│   ├── Email + Password (secondary): For web access
│   ├── Biometric (optional): Fingerprint/face on mobile for quick access
│   └── TOTP second factor: For premium tier accounts
│
├── Accountant / CA
│   ├── Invited via business owner with email verification
│   ├── Independent login credentials (not shared with business)
│   ├── CA can be linked to multiple businesses (multi-tenant access)
│   ├── Per-business session: must explicitly select which business to access
│   └── Session timeout: 30 minutes of inactivity (per security policy)
│
├── API Integration (Accounting Software / Payroll)
│   ├── OAuth 2.0 with PKCE for third-party integrations
│   ├── Scoped access tokens (read-only financial data, no document access)
│   ├── Token refresh rotation to prevent token theft
│   └── Integration revocation by business owner at any time
│
└── WhatsApp Bot
    ├── Phone number verification via WhatsApp Business API
    ├── Session-based authentication (24-hour window)
    ├── Sensitive operations (filing submission, document access) require OTP re-verification
    └── Read-only operations (view calendar, check score) without re-verification
```

### Role-Based Access Control

| Role | Profile | Calendar | Documents | Filing | Audit | Settings | NL Q&A |
|---|---|---|---|---|---|---|---|
| **Owner** | Full access | Full access | Full access | Approve & submit | Full access | Full access | Full access |
| **Admin** | Edit | Full access | Full access | Prepare & submit | Full access | Limited | Full access |
| **Accountant** | View | Full access | Upload & view | Prepare (not submit) | Full access | None | Full access |
| **HR Manager** | View (limited) | Labor law only | Labor docs only | Prepare (labor) | Labor audit only | None | Labor Q&A only |
| **Viewer** | View | View | View | None | View | None | View-only Q&A |

### Sensitive Operation Controls

```
Operations Requiring Additional Verification:
├── Filing submission to government portal → OTP verification + owner approval
├── Document deletion → Soft delete only; hard delete requires owner + 7-day waiting period
├── Business parameter change (affects obligations) → Confirmation + audit log
├── Accountant invitation/removal → Owner-only with OTP
├── Data export → Rate-limited; owner-only; logged; includes DPDP consent check
├── Account deletion → 30-day grace period; statutory data retained; non-statutory data deleted
├── Consent withdrawal → OTP verification + 7-day cooling period + statutory retention check
└── Cross-business data access (CA) → Per-business authorization check + action log
```

---

## DPDP Act Compliance (Platform's Own Obligations)

### Consent Management Framework

```
DPDP Consent Architecture:
├── Consent Collection
│   ├── Granular consent per processing purpose:
│   │   ├── Core compliance tracking (required for service)
│   │   ├── Document storage and classification (required for service)
│   │   ├── Notification delivery (required for service)
│   │   ├── Filing pre-fill from accounting data (optional)
│   │   ├── Compliance analytics and benchmarking (optional)
│   │   ├── Data sharing with CA/accountant (optional per CA)
│   │   └── Product improvement and model training (optional)
│   ├── Consent version tracking: each update creates new version
│   ├── Consent proof: timestamped, signed record of consent action
│   └── Consent withdrawal: immediate effect for optional purposes; statutory override for required
│
├── Data Minimization
│   ├── Collection minimization: only collect fields necessary for compliance computation
│   ├── Processing minimization: LLM Q&A uses only relevant regulation sections, not full profile
│   ├── Storage minimization: delete derived data when consent withdrawn
│   └── Retention minimization: auto-delete when statutory period expires and no consent exists
│
├── Data Subject Rights
│   ├── Right to access: Full data export within 72 hours
│   ├── Right to correction: Business can correct profile data; audit trail maintained
│   ├── Right to erasure: Statutory data retained; all other data deleted within 30 days
│   ├── Right to portability: Machine-readable export (JSON/CSV)
│   └── Right to grievance: In-app grievance mechanism with 30-day resolution SLA
│
└── Breach Notification
    ├── Detection: anomaly detection + access pattern monitoring
    ├── Classification: assess scope and severity within 24 hours
    ├── Notification to Data Protection Board: within 72 hours
    ├── Notification to affected data principals: within 72 hours
    └── Remediation: contain breach, assess damage, implement fixes
```

---

## Document Integrity and Tamper Evidence

### Content-Addressed Integrity Chain

```
Document Integrity Protocol:
├── Upload
│   ├── Compute SHA-256 and SHA-3 hashes of raw document bytes (dual-hash)
│   ├── Store hashes in separate database from document blob
│   ├── Encrypt document with per-document DEK
│   ├── Store encrypted blob in object storage
│   └── Log upload event with timestamp, user, and hashes
│
├── Verification (on access)
│   ├── Decrypt document blob
│   ├── Recompute both hashes
│   ├── Compare with stored hashes (both must match)
│   ├── If mismatch → integrity alert; serve from backup; investigate
│   └── Verification result logged
│
├── Audit Trail
│   ├── Every access logged: who, when, why (filing, audit, download)
│   ├── Log entries are append-only (immutable)
│   ├── Log integrity verified via hash chain (each entry includes hash of previous)
│   └── External audit log backup with independent integrity verification
│
├── Long-Term Preservation
│   ├── Document format migration for obsolete formats (rare for PDF)
│   ├── Dual-hash strategy future-proofs against algorithm weakening
│   ├── Background hash migration: if SHA-256 is weakened, SHA-3 provides integrity
│   ├── Hash migration rate: 100K documents/day → completes 150M corpus in 5 years
│   └── Geographic redundancy: documents replicated to 2+ data center regions
│
└── Legal Defensibility
    ├── Hash chain proves document existed at upload time
    ├── Access log proves who viewed/downloaded and when
    ├── Version history proves no modifications since upload
    └── Court-admissible: satisfies IT Act Section 65B requirements for electronic records
```

---

## The Platform's Own Compliance Obligations

### Compliance Audit Schedule

```
Audit Schedule:
├── Quarterly: Internal security review
│   ├── Access log analysis
│   ├── Encryption key rotation verification
│   ├── Vulnerability scan results review
│   ├── DPDP consent status audit
│   └── Incident response drill
│
├── Semi-Annual: Data protection assessment
│   ├── Data inventory update
│   ├── Retention policy compliance check
│   ├── Cross-border data transfer audit
│   ├── DPDP consent withdrawal handling verification
│   └── Data subject request response time verification
│
├── Annual: External audit
│   ├── SOC 2 Type II audit
│   ├── Penetration testing (third-party)
│   ├── Business continuity plan test
│   ├── Disaster recovery drill with documented results
│   └── DPDP compliance audit (when enforcement rules finalized)
│
└── Continuous: Automated compliance monitoring
    ├── Certificate expiration monitoring
    ├── Encryption at rest verification (sample checks)
    ├── API authentication enforcement (no unauthenticated endpoints)
    ├── Data retention policy enforcement (automated deletion of expired data)
    ├── Cross-tenant access attempt detection
    └── LLM output validation (no PII leakage, citation accuracy)
```

### Information Security Standards

```
Security Certifications and Practices:
├── SOC 2 Type II compliance
│   ├── Annual audit of security controls
│   ├── Continuous monitoring between audits
│   └── Report available to enterprise customers
│
├── Penetration Testing
│   ├── Annual third-party penetration test
│   ├── Quarterly automated vulnerability scanning
│   ├── Bug bounty program for responsible disclosure
│   └── Findings remediated within 7 days (critical) / 30 days (high)
│
├── Incident Response Plan
│   ├── Severity classification: P1 (data breach) → P4 (informational)
│   ├── P1 response time: 15 minutes to acknowledge, 1 hour to contain
│   ├── Communication plan: Affected businesses notified within 72 hours (DPDP requirement)
│   └── Post-incident review within 5 business days
│
├── Employee Security
│   ├── Background checks for all engineers with data access
│   ├── Principle of least privilege for production access
│   ├── Production access via break-glass procedure with audit trail
│   ├── Security awareness training quarterly
│   └── Mandatory DPDP training for all employees handling personal data
│
└── Supply Chain Security
    ├── Third-party vendor security assessment before integration
    ├── Sub-processor agreement for all data processors (SMS gateway, cloud provider)
    ├── Vendor access reviews quarterly
    └── Immediate notification if vendor experiences a breach
```

---

## LLM-Specific Security Considerations

### Regulatory Q&A Security

```
LLM Security Controls:
├── Input Sanitization
│   ├── User questions sanitized for prompt injection attempts
│   ├── Business context injected via system prompt (not user-controllable)
│   └── Regulatory text from knowledge graph treated as trusted (human-verified)
│
├── Output Validation
│   ├── Citation verification: every cited section/notification verified against graph
│   ├── Cross-reference: answer validated against structured obligation data
│   ├── PII leak detection: output scanned for PAN, GSTIN, bank details from other businesses
│   └── Hallucination detection: if answer references non-existent regulation, flag and block
│
├── Data Isolation
│   ├── LLM context window contains only the requesting business's data
│   ├── No cross-business information in prompt context
│   ├── Conversation history per-business, not shared
│   └── Model weights not updated with business-specific data (no fine-tuning on customer data)
│
└── Audit Trail
    ├── All LLM interactions logged (question, context provided, answer, confidence)
    ├── Logs retained for 30 days (DPDP: no longer than necessary)
    ├── Business can request deletion of their Q&A history
    └── LLM provider agreement: no training on customer data
```
