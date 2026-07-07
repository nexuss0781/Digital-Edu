# 14.12 AI-Native Field Service Management for SMEs — Security & Compliance

## Authentication & Authorization

### Multi-Layer Authentication

**User authentication:**
- OAuth 2.0 / OpenID Connect for web dashboard and customer portal
- JWT tokens with short expiry (15 minutes) and refresh tokens (7 days)
- Multi-factor authentication (MFA) required for dispatcher and admin roles
- Biometric authentication option on mobile app (fingerprint, face ID) for quick technician access

**Device authentication:**
- Each technician mobile device registered with a unique device certificate
- Device certificate + user credential required for sync operations (two-factor device identity)
- Device can be remotely wiped and deregistered by tenant admin
- Offline authentication uses locally cached credential hash with device certificate validation

**IoT device authentication:**
- Mutual TLS (mTLS) for all IoT device connections
- Per-device X.509 certificates provisioned during device onboarding
- Certificate rotation automated on 90-day cycle
- Device identity tied to equipment record; orphaned devices auto-quarantined

**API authentication:**
- API keys for third-party integrations (accounting systems, CRM)
- Scoped tokens with granular permissions (read-only, specific entity types)
- Rate limiting per API key to prevent abuse

### Role-Based Access Control (RBAC)

| Role | Permissions | Scope |
|---|---|---|
| **Tenant Admin** | Full system configuration; user management; billing; data export | Entire tenant |
| **Dispatcher** | Schedule management; job assignment; technician management; customer view | Assigned service zones |
| **Technician** | View assigned jobs; update job status; create invoices; collect payments | Own assignments only |
| **Office Staff** | View schedules; customer management; invoice review; reports | Read-heavy; limited write |
| **Customer** | View own service history; request service; view invoices; make payments | Own records only |
| **IoT System** | Push telemetry; receive configuration; trigger alerts | Registered devices only |

**Attribute-based access control (ABAC) extensions:**
- Geographic restrictions: technicians can only view/modify jobs within their assigned service zones
- Temporal restrictions: dispatchers can only modify future schedule entries (not historical records)
- Sensitivity restrictions: customer financial data (payment methods, billing history) accessible only to admin and office staff roles

### Tenant Isolation

**Data isolation:**
- All database tables partitioned by tenant_id; every query includes tenant_id filter enforced at the ORM level
- Row-level security (RLS) policies in the database as a second layer of defense
- Tenant_id is extracted from the JWT token and injected into the request context; application code cannot override
- Cross-tenant data access is impossible through the application layer; requires direct database access (which is restricted to platform operators)

**Compute isolation:**
- Scheduling engine instances serve multiple tenants but maintain per-tenant memory spaces with no shared state
- API rate limits applied per tenant to prevent noisy-neighbor effects
- Background job queues prioritized by tenant tier (premium tenants get dedicated queue lanes)

**Network isolation:**
- Tenant API traffic identified and tagged at the gateway level
- IoT telemetry routed through tenant-specific MQTT topics
- No lateral movement possible between tenant contexts

---

## Data Protection

### Data Classification

| Classification | Examples | Storage | Encryption | Access |
|---|---|---|---|---|
| **Critical** | Payment credentials, auth tokens | Vault / HSM | AES-256 at rest; TLS 1.3 in transit | Payment service only; never logged |
| **Sensitive** | Customer PII (name, phone, address, email) | Encrypted database columns | AES-256 at rest; TLS 1.3 in transit | Role-restricted; audit logged |
| **Confidential** | Job details, invoices, service history | Encrypted at rest (volume-level) | TLS 1.3 in transit | Tenant-scoped RBAC |
| **Internal** | Schedule data, route plans, fleet metrics | Standard database encryption | TLS 1.3 in transit | Tenant-scoped RBAC |
| **Public** | Service areas, business hours | CDN / public API | TLS 1.3 in transit | Unrestricted |

### Encryption Strategy

**At rest:**
- Database: transparent data encryption (TDE) for all tenant databases
- Object storage: server-side encryption with per-tenant encryption keys
- Mobile device: local database encrypted with device-specific key derived from user credential + device certificate
- Backups: encrypted with separate backup encryption key; key stored in hardware security module (HSM)

**In transit:**
- TLS 1.3 for all client-server communication
- mTLS for IoT device communication
- gRPC with TLS for all internal service-to-service communication
- Certificate pinning on mobile app to prevent man-in-the-middle attacks

**Key management:**
- Per-tenant data encryption keys (DEKs) wrapped with a master key (KEK) stored in HSM
- Automatic key rotation every 90 days
- Key revocation capability for compromised tenants
- Tenant offboarding triggers secure key destruction and data purge

### Data Retention and Deletion

| Data Type | Active Retention | Archive Retention | Deletion Policy |
|---|---|---|---|
| Job records | 2 years | 5 years (cold storage) | Anonymized after archive period |
| Customer PII | Active relationship + 1 year | N/A | Hard delete on customer request or tenant offboarding |
| Invoices & payments | 2 years | 7 years (regulatory) | Retained with PII anonymization after 7 years |
| IoT telemetry | 90 days (raw) | 5 years (aggregated) | Raw data purged; aggregates anonymized |
| GPS traces | 90 days | 1 year (anonymized) | Hard delete after 1 year |
| Photos | 1 year | 3 years (cold storage) | Deleted after archive period |
| Audit logs | 1 year | 3 years | Immutable; archived then purged |

### Mobile Device Security

**On-device data protection:**
- Local database encrypted at rest with AES-256; key derived from user PIN + device hardware key
- Automatic data wipe after 10 failed authentication attempts
- Remote wipe capability triggered by tenant admin or platform operator
- Screen capture prevention for sensitive screens (customer PII, payment forms)
- No customer PII stored in local logs or crash reports

**Lost device protocol:**
1. Technician or admin reports device lost/stolen
2. Device certificate revoked immediately (prevents sync)
3. Remote wipe command queued (executes on next connectivity)
4. All active sessions for the device invalidated
5. Affected customers notified if PII exposure risk exists
6. New device provisioned with fresh certificate; data re-synced from server

---

## Payment Security (PCI DSS Compliance)

### Cardholder Data Flow

| Stage | Data Location | Protection |
|---|---|---|
| **Card presentation** | POS hardware secure element | Never touches app memory; hardware-encrypted |
| **Tokenization** | On-device in POS hardware | Card number replaced with gateway-specific token within POS secure element |
| **Offline queue** | Local encrypted database | Token (not card number) stored; encrypted with device-specific key |
| **Submission** | Sync service → payment gateway | TLS 1.3 end-to-end; token submitted to gateway for processing |
| **Storage** | Server-side payment record | Only token and last-4 digits stored; no full card number anywhere in system |

**Key principle:** No cardholder data (PAN, CVV) ever enters the application layer. The POS hardware's secure element tokenizes before the app receives any data. This reduces PCI DSS scope to the hardware device only, not the entire mobile app or sync service.

### Cash Payment Controls

| Control | Implementation | Purpose |
|---|---|---|
| Cash receipt photo | Technician photographs cash received (optional, configurable per tenant) | Evidence for reconciliation disputes |
| Amount confirmation | Customer digitally signs receipt showing cash amount | Prevents "I paid $200, technician says $150" disputes |
| Daily cash reconciliation | Office staff confirms total cash collected matches receipts | Detects cash "leakage" |
| Cash limit threshold | Configurable maximum cash payment per job (default $500) | Forces high-value payments to tracked methods |
| Discrepancy alert | Alert when cash reconciliation differs from reported amount by >$50 | Early detection of systematic issues |

---

## Compliance Requirements

### Labor Law Compliance

| Requirement | Implementation |
|---|---|
| **Maximum working hours** | Scheduling engine enforces configurable daily/weekly hour limits per jurisdiction; overtime requires explicit approval |
| **Mandatory break periods** | Break windows defined per technician; optimizer never schedules jobs that would prevent required breaks |
| **Overtime calculation** | Deterministic overtime computation in pricing engine; configurable thresholds (8 hrs daily, 40 hrs weekly) |
| **Travel time tracking** | GPS-based travel time recorded separately from job time; configurable rules for paid vs. unpaid travel |
| **Certification requirements** | Jobs requiring specific certifications (electrical, gas, refrigerant) only assignable to certified technicians; expired certifications auto-flagged |
| **Right to disconnect** | No push notifications or job assignments outside configured working hours per jurisdiction |

### Privacy Regulations

| Regulation | Applicability | Implementation |
|---|---|---|
| **GDPR** | EU-based tenants and customers | Consent management; data portability API; right to erasure; DPO designation; breach notification within 72 hours |
| **CCPA/CPRA** | California-based customers | "Do not sell" opt-out; data access requests; deletion requests; annual privacy notice |
| **India DPDP Act** | India-based tenants | Consent-based processing; data localization for certain categories; grievance officer designation |
| **SOC 2 Type II** | Platform-level | Annual audit; continuous monitoring; access controls; encryption; incident response |

### GPS and Location Privacy

**Technician location tracking safeguards:**
- GPS tracking active only during working hours (configurable per technician)
- Location data is tenant-visible only (platform operators cannot access individual technician locations without audit trail)
- Technician can see their own location history and request correction
- Location precision degraded to 100m radius after working hours (for fleet-level analytics only, not individual tracking)
- Clear consent obtained during onboarding; revocable with 30-day notice (with impact on scheduling capability disclosed)

**Customer location privacy:**
- Customer addresses stored encrypted; decrypted only for active job context
- Address never shared across tenants
- Geolocation used for service zone matching only; not for marketing or analytics without explicit consent

---

## Security Monitoring and Incident Response

### Threat Model

| Threat | Attack Vector | Mitigation |
|---|---|---|
| **Unauthorized data access** | Compromised credentials; privilege escalation | MFA; RBAC with least privilege; session management; anomaly detection |
| **Cross-tenant data leakage** | Application bug; SQL injection | Tenant isolation at ORM + RLS level; input validation; parameterized queries |
| **Mobile device compromise** | Lost/stolen device; malware | Device encryption; remote wipe; certificate-based auth; app integrity checks |
| **IoT device spoofing** | Fake telemetry injection; device impersonation | mTLS; device certificate pinning; telemetry rate and range validation |
| **Man-in-the-middle** | Network interception of field traffic | TLS 1.3; certificate pinning; no sensitive data over HTTP |
| **Insider threat** | Malicious employee; social engineering | Audit logging; separation of duties; access reviews; background checks |
| **Payment fraud** | Fake invoices; payment interception | Invoice digital signatures; payment gateway tokenization; reconciliation checks |

### Audit Logging

Every security-relevant action is logged to an immutable audit store:

| Event Category | Examples | Retention |
|---|---|---|
| Authentication | Login, logout, MFA challenge, failed attempt | 1 year |
| Authorization | Permission grant/revoke, role change | 3 years |
| Data access | Customer PII view, invoice download, report export | 1 year |
| Data modification | Job creation, schedule change, price book update | 3 years |
| Device management | Device registration, certificate renewal, remote wipe | 3 years |
| Administrative | Tenant configuration change, user management, billing | 3 years |
| System | API key creation, webhook configuration, integration setup | 1 year |

### Incident Response Plan

| Phase | Actions | Timeline |
|---|---|---|
| **Detection** | Automated alerting on anomalous access patterns, failed auth spikes, cross-tenant query attempts | Real-time |
| **Triage** | Classify severity (P1-P4); assign incident commander; notify affected teams | < 15 minutes |
| **Containment** | Isolate affected tenant/device/service; revoke compromised credentials; block suspicious IPs | < 1 hour |
| **Eradication** | Identify root cause; patch vulnerability; rotate keys; verify no lateral movement | < 4 hours |
| **Recovery** | Restore from clean backup if needed; re-enable services; verify integrity | < 8 hours |
| **Post-mortem** | Root cause analysis; timeline documentation; corrective actions; customer notification if required | < 48 hours |

---

## Domain-Specific Threats

### Threat 1: Technician Device Compromise for Data Exfiltration

**Attack vector:** Attacker targets technician mobile devices (less secured than corporate devices) to extract customer PII, home addresses, access codes (gate codes, alarm codes stored in location notes), and payment tokens.

**Risk level:** High — each device contains PII for 50-200 customer locations plus access codes that enable physical intrusion.

**Mitigation layers:**
1. Selective sync: device only stores data for today's assigned jobs + 2-day look-ahead (not entire customer database)
2. Access codes encrypted with per-session key derived from user credential; displayed only during active job (not persistently visible)
3. Automatic data wipe: job data purged from device 24 hours after job completion
4. Payment tokens stored in POS hardware secure element, never in app memory or local database
5. App integrity verification: detect rooted/jailbroken devices; refuse to sync customer data

### Threat 2: Fake Technician Registration for Social Engineering

**Attack vector:** Malicious actor creates a fake SME tenant account, registers a "technician," and uses the platform's customer communication features to impersonate legitimate service providers (send "your technician is arriving" messages to targets).

**Risk level:** Medium — platform's branded notifications could be weaponized for social engineering (gaining access to homes under false pretenses).

**Mitigation layers:**
1. Tenant verification: business license validation, domain verification, or payment method verification before enabling customer-facing notifications
2. Customer-visible tenant identity: all notifications include verified business name and registration number
3. Customer confirmation: customers must confirm they requested service before technician arrival notifications are sent (prevents unsolicited "your technician is coming" attacks)
4. Rate limiting on new tenant notification volume: first 30 days capped at 50 notifications/day

### Threat 3: IoT Telemetry Injection for False Maintenance Jobs

**Attack vector:** Compromised or spoofed IoT device sends fabricated telemetry (fake high vibration readings) to trigger unnecessary predictive maintenance work orders, generating fraudulent billable visits.

**Risk level:** Medium — could generate unauthorized revenue at customer expense.

**Mitigation layers:**
1. Device certificate pinning: each IoT device authenticated via X.509 certificate tied to specific equipment record
2. Telemetry rate and range validation: reject readings outside physically plausible range for equipment type
3. Multi-gate validation pipeline (statistical + cross-metric + historical pattern gates) makes single-metric injection insufficient to trigger work orders
4. Anomaly alert requires corroboration from at least 2 independent sensor types before generating work order
5. Customer notification and approval required before auto-generated maintenance is scheduled

### Threat 4: Invoice Manipulation via Modified Mobile App

**Attack vector:** Technician (or external party) decompiles mobile app and modifies pricing engine to generate inflated invoices (e.g., override flat rate from $150 to $350; add phantom line items).

**Risk level:** Medium — financial fraud at customer expense.

**Mitigation layers:**
1. Server-side re-computation: every invoice synced from device is re-computed using the same pricing version; total must match within $0.01
2. If device total differs from server total, invoice flagged for admin review (never auto-approved)
3. App binary integrity check: hash of pricing engine module verified at sync time; mismatch triggers device quarantine
4. Line item validation: part numbers, service codes, and quantities cross-referenced against job type template and equipment history
5. Statistical anomaly detection: alert when a technician's average invoice exceeds their historical pattern by >50%

### Threat 5: Cross-Tenant Data Leakage via Shared Scheduling Engine

**Attack vector:** Bug in scheduling engine allows one tenant's optimization to access another tenant's technician or job data (e.g., tenant A's optimizer reads tenant B's schedule due to incorrect partition routing).

**Risk level:** Critical — violates core multi-tenancy promise.

**Mitigation layers:**
1. Scheduling engine enforces tenant isolation at memory level: each tenant's data in separate data structures; no shared state
2. Every data access includes tenant_id validation; asserts fail on mismatch (crash rather than leak)
3. Database RLS as defense-in-depth: even if application code has a bug, database enforces tenant boundaries
4. Automated integration test suite: cross-tenant access attempts in every CI/CD run; any successful cross-tenant read is a deployment-blocking failure
5. Canary tenant: dedicated test tenant with synthetic data; monitors for any unexpected data access patterns

---

## Data Residency and Sovereignty

| Region | Regulation | Data Residency Requirement | Implementation |
|---|---|---|---|
| **European Union** | GDPR | Personal data of EU data subjects must be processable within EU; transfer requires adequacy decision or SCCs | EU tenants assigned to EU region; data at rest and in transit within EU boundaries |
| **India** | DPDP Act 2023 | Critical personal data must be stored in India; significant personal data may be transferred with conditions | India tenants on APAC/India region; critical PII (Aadhaar-linked, financial) India-only |
| **United States** | CCPA/CPRA + state laws | No mandatory localization; California-specific disclosure and deletion rights | US region handles all US tenants; California customers get enhanced privacy controls |
| **Brazil** | LGPD | Similar to GDPR; DPO required; data processing must have legal basis | Brazil tenants in Americas region; DPO designation per tenant |
| **Middle East** | Various (UAE DPL, Saudi PDPL) | Data must remain within national boundaries for certain sectors | On-roadmap: Middle East region for regulated sectors |

**Cross-region data flows (strictly limited):**
- ML model training: federated learning aggregates (no raw data crosses regions)
- Global analytics: anonymized, aggregated metrics only (no PII crosses regions)
- Billing/subscription: minimal data (tenant_id, plan, usage counts)

---

## Data Lifecycle and Retention

| Data Category | Hot Storage | Warm Storage | Cold Storage | Purge |
|---|---|---|---|---|
| Active job records | Real-time (primary DB) | — | — | Never (move to archive on completion) |
| Completed job records | 90 days (primary DB) | 2 years (read replica) | 5 years (compressed archive) | Anonymize after 5 years |
| Customer PII | Active relationship | +1 year after last service | — | Hard delete on request or tenant offboarding |
| GPS traces | 90 days (primary DB) | 1 year (anonymized) | — | Delete after 1 year |
| IoT telemetry (raw) | 7 days (time-series DB) | 90 days (downsampled hourly) | 5 years (daily aggregates) | Purge raw after 90 days |
| Photos | 30 days (object storage hot) | 1 year (warm tier) | 3 years (cold tier) | Delete after 3 years |
| Invoices/payments | 2 years (primary DB) | 7 years (regulatory archive) | — | Anonymize PII after 7 years; retain financial records indefinitely |
| Audit logs | 1 year (hot log store) | 3 years (compressed archive) | — | Purge after 3 years (immutable during retention) |
| Device sync logs | 14 days (primary DB) | 90 days (compressed) | — | Purge after 90 days |

**Right to erasure (GDPR Article 17):**
1. Customer requests deletion → customer PII anonymized within 30 days
2. Job records retained but customer-identifying fields replaced with anonymized tokens
3. Photos containing customer premises: deleted entirely
4. GPS traces: deleted (not anonymizable—location itself is identifying)
5. Invoice records: PII anonymized but financial data retained (legal obligation override)
6. Verification report generated proving deletion completeness

---

## AI/ML Security Considerations

### Model Poisoning

**Risk:** If training data is compromised (e.g., attacker manipulates historical job duration records), the scheduling optimizer learns incorrect duration distributions, causing systematically late or early ETAs.

**Mitigation:**
1. Training data validation: statistical outlier detection removes records >3σ from median before training
2. Model monitoring: compare new model predictions against holdout test set from verified-clean data period
3. Gradual rollout: new models deployed to 5% of tenants for 7 days; performance compared against control group
4. Rollback capability: instant revert to previous model version if performance degrades

### Adversarial Inputs

**Risk:** Manipulated sensor readings designed to trigger (or suppress) predictive maintenance alerts. Subtle enough to pass basic validation but skew model predictions.

**Mitigation:**
1. Multi-gate validation pipeline already provides defense-in-depth (single-metric manipulation insufficient)
2. Cross-device correlation: if one device in a multi-device installation shows anomaly while others don't, flag for manual review
3. Temporal consistency check: readings must follow physically plausible trajectories (no instantaneous jumps between extreme values)

### Privacy in ML Training

**Risk:** ML models trained on fleet-wide data may memorize and leak specific tenant data (e.g., a model could predict that a specific customer always needs service on Tuesdays, revealing PII).

**Mitigation:**
1. Differential privacy: noise injection during training ensures individual records cannot be extracted
2. Federated learning: models trained on aggregated gradients, not raw data; raw data never leaves tenant's home region
3. Model output filtering: predictions stripped of tenant-identifying information before use by other tenants' systems
