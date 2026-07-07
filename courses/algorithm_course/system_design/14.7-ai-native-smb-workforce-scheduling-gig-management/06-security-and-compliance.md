# 14.7 AI-Native SMB Workforce Scheduling & Gig Management — Security & Compliance

## Authentication & Authorization

### Authentication Architecture

**Multi-factor authentication model:**

| Actor | Authentication Method | Token Lifetime |
|---|---|---|
| Business Owner/Admin | Email + password + optional TOTP | 24 hours (refresh: 7 days) |
| Manager | Email + password or SSO | 12 hours (refresh: 7 days) |
| Employee | Phone number + SMS OTP or biometric | 30 days (refresh: 90 days) |
| Gig Worker | Phone number + SMS OTP | 7 days (refresh: 30 days) |
| API Integration (POS, payroll) | API key + HMAC signature | No expiry (revocable) |

**Token architecture:**
- Short-lived JWT access tokens containing: tenant_id, user_id, role, location_ids (for multi-location access control).
- Long-lived opaque refresh tokens stored server-side with device binding (the refresh token is valid only from the device that created it).
- Token rotation: each refresh token use issues a new refresh token and invalidates the old one (replay detection).

### Authorization Model

Role-Based Access Control (RBAC) with location-scoping:

| Role | Schedule | Attendance | Compliance | Gig | Payroll | Settings |
|---|---|---|---|---|---|---|
| **Owner** | Full CRUD all locations | View + override all | View + override | Full control | Export all | Full access |
| **Manager** | Full CRUD own location(s) | View + override own location | View own location | Broadcast + approve | Export own location | Location settings |
| **Employee** | View own schedule, request swaps | Clock in/out, view own timesheet | Not visible | Not visible | View own hours | Personal preferences |
| **Gig Worker** | View accepted shifts only | Clock in/out for accepted shifts | Not visible | Accept/decline offers | View own earnings | Personal preferences |
| **Payroll Integrator** | Not visible | Read timesheets (approved only) | Not visible | Not visible | Read-only export | Not visible |

**Location scoping:** A manager with access to Location A cannot see schedules, employees, or timesheets for Location B—even within the same tenant. Cross-location access requires explicit Owner grant.

**API enforcement:** Every API request is validated against the RBAC policy. The middleware extracts tenant_id, user_id, and role from the JWT, then checks the requested resource against the policy. Denied requests return 403 with a generic message (no information leakage about what exists).

---

## Data Security

### Encryption

| Data State | Method | Key Management |
|---|---|---|
| In transit | TLS 1.3 for all API traffic; certificate pinning on mobile apps | Managed certificate rotation (90-day cycle) |
| At rest (database) | AES-256 encryption at the storage layer; per-tenant column-level encryption for PII fields | Tenant-specific keys stored in a managed key vault; key rotation every 365 days |
| At rest (biometrics) | AES-256 with a separate key hierarchy; biometric data stored in an isolated database | Biometric keys managed separately from PII keys; emergency key deletion capability |
| Backups | Encrypted with backup-specific keys before writing to object storage | Backup keys rotated with each full backup cycle |
| Clock-in GPS data | Encrypted at rest; retention-limited (90 days) | Auto-deletion enforced by TTL policy |

### PII Data Handling

```
PII Classification and Handling Rules:

HIGH SENSITIVITY (biometric data, government IDs):
  - Stored in isolated, encrypted database
  - Access logged and alerted
  - Retention: minimum necessary, auto-deleted on offboarding
  - Never included in analytics or exports
  - Right-to-deletion: 48-hour SLA

MEDIUM SENSITIVITY (name, phone, email, address):
  - Encrypted at rest with tenant-specific keys
  - Access restricted by RBAC
  - Retention: employment duration + 7 years (legal requirement)
  - Pseudonymized in analytics
  - Right-to-deletion: 30-day SLA (legal retention takes precedence)

LOW SENSITIVITY (availability preferences, shift history):
  - Standard encryption at rest
  - Accessible by authorized roles
  - Retention: 7 years (compliance requirement)
  - Aggregated in analytics
```

### Multi-Tenancy Data Isolation

**Isolation guarantee:** No API call, database query, cache operation, or background job can access data belonging to a different tenant.

**Enforcement layers:**

1. **Application middleware:** Every incoming request has its tenant_id extracted from the JWT. The middleware injects a tenant filter into every database query, cache key, and message queue operation. There is no code path that can bypass tenant filtering.

2. **Database-level enforcement:** Row-level security policies enforce that queries can only return rows matching the session's tenant_id. Even if application code has a bug that omits the tenant filter, the database rejects cross-tenant access.

3. **Cache key namespacing:** All cache keys are prefixed with tenant_id. Cache lookups without a tenant prefix are blocked at the client library level.

4. **Periodic audit:** An automated job runs daily, sampling 1,000 random API requests and verifying that the response data matches the requesting tenant. Any cross-tenant data detection triggers a P0 incident.

---

## Threat Model

### STRIDE Analysis

| Threat | Attack Vector | Impact | Mitigation |
|---|---|---|---|
| **Spoofing** | Stolen employee credentials used for fraudulent clock-in | Incorrect timesheet data; overpayment | Biometric verification as second factor; device binding for tokens; anomaly detection on unusual clock-in patterns |
| **Spoofing** | GPS spoofing app to fake location for remote clock-in | Employee clocks in from home instead of work location | Multi-signal verification (WiFi SSID, cell tower, accelerometer); mock-location API detection; impossible-travel detection |
| **Tampering** | Manager alters timesheet after approval to reduce hours | Employee underpayment; legal liability | Immutable event log for all timesheet changes; dual-approval for post-approval modifications; employee notification on timesheet changes |
| **Tampering** | Attacker modifies compliance rules to create loopholes | Labor law violations; penalty exposure | Compliance rules are read-only in production; changes require dual approval through a separate admin workflow; rules are cryptographically signed |
| **Repudiation** | Manager denies publishing a schedule that triggered premium pay | Dispute over who approved the schedule change | Immutable audit log with actor identity, timestamp, and IP address; schedule events are cryptographically chained (each event references the hash of the previous event) |
| **Information Disclosure** | Cross-tenant data leak through API vulnerability | Employee PII exposed to unauthorized party | Row-level security; tenant-scoped API middleware; automated cross-tenant access testing; cache key namespacing |
| **Information Disclosure** | Employee views other employees' pay rates through API manipulation | Compensation confidentiality breach | Field-level access control: pay rates visible only to Owner/Manager roles; API response filtering at the serialization layer |
| **Denial of Service** | Bot attack on clock-in endpoint during shift start surge | Legitimate employees cannot clock in | Rate limiting per device fingerprint; CAPTCHA-free challenge for suspicious patterns; elastic auto-scaling; offline clock-in capability as fallback |
| **Elevation of Privilege** | Employee modifies JWT to grant manager role | Unauthorized schedule modifications | JWT signature verification with rotating keys; role claims verified against the authorization database (not trusted solely from the token); sensitive operations require re-authentication |

### Biometric Security

Biometric data (facial recognition templates) receives special handling:

1. **On-device processing:** Facial recognition runs on the employee's mobile device. The raw image never leaves the device. Only the computed feature vector (a mathematical representation, not a recognizable face) is transmitted to the server for verification.

2. **Template storage:** Feature vectors are stored in an isolated database with separate encryption keys. They are never co-located with PII. Access requires a separate authorization path.

3. **Anti-spoofing:** The mobile app performs liveness detection (blink detection, head movement, 3D depth analysis on supported devices) to prevent photo-based spoofing.

4. **Consent and control:** Biometric enrollment requires explicit opt-in with a clear consent flow. Employees can revoke consent at any time, triggering immediate template deletion. Biometric verification is never the only clock-in method—GPS-only verification is always available as an alternative.

5. **Regulatory compliance:** Biometric data handling complies with BIPA (Illinois Biometric Information Privacy Act), CCPA biometric data provisions, GDPR Article 9 (special category data), and equivalent state laws. Written consent is collected and retained.

---

## Labor Law Compliance Architecture

### Compliance Data Flow

```
Jurisdiction identification
       ↓
Rule set binding (location → jurisdiction → active rules)
       ↓
Pre-publication validation (every schedule version)
       ↓
Real-time monitoring (during shift execution)
       ↓
Post-period reconciliation (end of pay period)
       ↓
Compliance reporting and record retention
```

### Key Compliance Domains

| Domain | Requirements | System Enforcement |
|---|---|---|
| **Predictive Scheduling** | 7–14 day advance notice; premium pay for late changes; good-faith estimate of hours at hire | Schedule publication tracking; change-window calculation; automatic premium pay computation; good-faith estimate stored per employee |
| **Overtime** | Federal: weekly > 40h. State: varies (daily, weekly, 7th consecutive day). Rate: 1.5x or 2x depending on hours and jurisdiction | Real-time hour tracking; proactive alerts before threshold; overtime cost projection in schedule optimizer |
| **Rest Periods** | 8–12 hour minimum between shifts (varies); "clopening" restrictions (close one night, open next morning) | Solver constraint; real-time detection of rest violations; block schedule publication if rest requirements not met |
| **Breaks** | Meal break (30 min) and rest break (10–15 min) requirements; timing varies; some states require paid breaks | Break scheduling within shifts; clock-in/out tracking for break compliance; alerts for missed breaks |
| **Minor Work Restrictions** | Max hours per day/week; restricted hours (no work after 7–10 PM); prohibited tasks; school-year vs. summer rules | Age-based rule activation; automatic restriction during school year; prohibited role enforcement |
| **Split Shift** | Premium pay when an employee works two shifts with > 1 hour gap in a single day | Gap detection in schedule; automatic premium calculation; optimizer avoids split shifts unless necessary |
| **Right-to-Rest** | Temporary workers: right to refuse shifts with < 11h rest without penalty | Rest period tracking for gig/temp workers; opt-in override with documentation |

### Compliance Record Retention

| Record Type | Retention Period | Legal Basis |
|---|---|---|
| Timesheets / work hour records | 7 years | FLSA, state wage laws |
| Schedule publication records | 7 years | Predictive scheduling laws |
| Schedule change records (with reasons) | 7 years | Predictive scheduling laws |
| Overtime approval records | 7 years | FLSA, state overtime laws |
| Break compliance records | 3 years | State break laws |
| Minor work records | Until minor turns 21 + 3 years | Child labor laws |
| Biometric consent records | Duration of employment + 3 years | BIPA, CCPA |
| Compliance violation records | 7 years | General labor law |

---

## API Security

### Rate Limiting

| Endpoint Category | Rate Limit | Burst Allowance |
|---|---|---|
| Authentication (login, OTP) | 5/minute per phone/email | 10 |
| Clock-in/out | 2/minute per employee | 5 |
| Schedule read | 100/minute per user | 200 |
| Schedule write | 20/minute per manager | 30 |
| Gig broadcast | 10/minute per business | 15 |
| Notification send | 1000/minute per tenant | 2000 |
| POS webhook | 100/second per integration | 500 |

### Input Validation

- All API inputs validated against JSON schema before processing.
- Employee IDs, shift IDs, and tenant IDs are UUIDs—sequential IDs that could be enumerated are never used.
- GPS coordinates validated for range (latitude: -90 to 90, longitude: -180 to 180) and precision (reject coordinates with > 8 decimal places, which suggests programmatic fabrication).
- Timestamp inputs validated against reasonable bounds (not in the future for clock-in, not more than 24 hours in the past for retroactive entries).

### Webhook Security (POS and Payroll Integrations)

- All incoming webhooks verified via HMAC-SHA256 signature.
- Webhook payloads are idempotent-processed (duplicate delivery is safe).
- Outbound webhooks (to payroll providers) include a per-integration secret and a request timestamp to prevent replay attacks.
- Webhook endpoints are rate-limited independently from user-facing APIs.

---

## Employee Data Privacy Architecture

### Right-to-Deletion Implementation

When an employee exercises their GDPR/CCPA right to deletion, the platform must handle a complex data lifecycle across multiple stores:

```
Deletion request received
    ↓
Identify all data linked to employee_id across:
  - Schedule database (shift assignments)
  - Timesheet records (clock-in/out events)
  - Biometric templates (facial recognition)
  - Gig worker profiles (if applicable)
  - Notification history
  - Swap offer/claim records
    ↓
Classify data by retention obligation:
  - DELETABLE: biometric templates, notification preferences,
    personal contact info, device fingerprints
  - RETAINABLE (legal hold): timesheet records (7-year FLSA),
    compliance audit logs (7-year), schedule publication records
    ↓
Execute tiered deletion:
  - Immediate: biometric templates, device data, notification prefs
  - Pseudonymize: replace employee name/phone/email with synthetic
    identifiers in retained records (timesheets become
    "Worker-A7F3" instead of "Sarah Johnson")
  - Retain: compliance records with pseudonymized identity
    (legal obligation overrides deletion right)
    ↓
Verification:
  - Automated scan confirms no PII remains in active stores
  - Certificate of deletion generated for regulatory proof
  - 30-day soft-delete window before permanent erasure
    (in case of accidental requests)
```

### Data Minimization Principles

| Data Type | Collection Scope | Retention | Justification |
|---|---|---|---|
| **GPS coordinates** | Only during clock-in/clock-out events (2 readings per shift) | 90 days | Dispute resolution only; not continuous tracking |
| **WiFi SSID scans** | Only during clock-in verification | 7 days | Spoofing detection; no location tracking value after verification |
| **Facial recognition** | Feature vector only; raw image never transmitted or stored | Until employment ends + 90 days | Template is not reversible to a face image; BIPA-compliant |
| **Device fingerprint** | Device model, OS version, screen size (no IMEI, no ad ID) | Duration of employment | Buddy-punching detection; minimal hardware identifiers |
| **Accelerometer data** | 5-second window around clock-in event | 7 days | Spoofing detection; movement pattern not stored long-term |

### Consent Management Architecture

Biometric verification requires explicit, informed consent under BIPA, GDPR Article 9, and equivalent state laws:

| Consent State | User Experience | System Behavior |
|---|---|---|
| **Not requested** | Employee has never been prompted for biometric consent | GPS-only verification; biometric features hidden in UI |
| **Consent given** | Employee opted in after reading disclosure; consent record stored with timestamp and disclosure version | Biometric verification active; face template enrolled |
| **Consent declined** | Employee explicitly declined biometric verification | GPS-only verification permanently; no biometric prompts; no performance penalty for declining |
| **Consent withdrawn** | Employee revoked previously-given consent | Biometric template deleted within 48 hours; reverts to GPS-only; consent withdrawal record retained |
| **Consent expired** | Jurisdiction requires periodic re-consent (annual under some BIPA interpretations) | Biometric verification suspended; re-consent prompt displayed; template retained in encrypted cold storage pending re-consent |

---

## Worker Classification Compliance

### The Legal Firewall Between Employee and Gig Worker Treatment

The platform must maintain a strict behavioral separation between employee features and gig worker features to avoid inadvertently creating evidence of an employment relationship:

| Dimension | Employee Treatment | Gig Worker Treatment | Legal Rationale |
|---|---|---|---|
| **Shift assignment** | Employer assigns shifts; employee can request swaps | Platform offers shifts; worker accepts voluntarily | Control over "when" to work indicates employment |
| **Rate setting** | Employer sets hourly rate | Worker sets their own rate range; business sets a maximum | Control over "how much" to pay indicates employment |
| **Performance rating** | Manager evaluates performance (reviews, raises) | Reliability score based only on no-show rate; no qualitative evaluation | Evaluation of work quality indicates employment |
| **Break enforcement** | System enforces mandatory breaks per labor law | System informs of break recommendations; no enforcement | Control over "how" to work indicates employment |
| **Scheduling frequency** | Regular weekly schedule | No guaranteed shifts; no minimum hours; no recurring assignments | Regular schedule indicates employment |
| **Tools and methods** | Business may require specific POS training, dress code | Worker uses their own methods; platform provides only the shift description | Control over "how" to perform work indicates employment |

### Audit Trail for Classification Defense

Every gig worker interaction is logged with classification-relevant metadata:

```
{
  "event": "shift_offered",
  "gig_worker_id": "uuid",
  "shift_id": "uuid",
  "offered_rate_range": {"min": 18.00, "max": 25.00},
  "worker_proposed_rate": 22.00,
  "worker_accepted": true,
  "acceptance_voluntary": true,
  "alternatives_available": 3,  // other shifts worker could have chosen
  "decline_penalty": "none",
  "classification_signals": {
    "worker_set_own_rate": true,
    "worker_chose_shift_freely": true,
    "no_recurring_commitment": true,
    "no_exclusivity_requirement": true
  }
}
```

This structured audit trail provides affirmative evidence that each gig engagement was a voluntary, independent contractor relationship—critical for defense against misclassification claims under AB-5, the IRS economic reality test, and state-level ABC tests.

---

## Incident Response for Scheduling Systems

### Compliance-Specific Incident Categories

| Incident Type | Severity | Response Protocol |
|---|---|---|
| **Cross-tenant data exposure** | P0 — Critical | Immediate: isolate affected tenants, revoke active sessions. 24h: identify breach scope, notify affected businesses. 72h: GDPR notification if EU PII exposed |
| **Compliance engine outage during publication window** | P0 — Critical | Fail-closed: block all schedule publications. Activate manual compliance review queue. Notify all managers with pending schedules |
| **Biometric template breach** | P0 — Critical | Immediate: rotate encryption keys, invalidate all templates. Require re-enrollment for all affected employees. BIPA notification within mandated timeframe |
| **GPS spoofing detection bypass discovered** | P1 — High | Audit last 30 days of clock-in events for affected detection vector. Flag suspicious events for manager review. Deploy updated detection model within 48 hours |
| **Premium pay miscalculation** | P1 — High | Identify affected pay periods and employees. Calculate correct premium pay amounts. Issue correction before next payroll cycle. Audit all schedules using the same rule version |
| **Gig worker classification audit trigger** | P2 — Medium | Review all gig engagement logs for classification signals. Verify behavioral firewall enforcement. Generate classification compliance report for legal review |

---

## Security Testing and Penetration

### Scheduling-Specific Attack Scenarios

| Attack Scenario | Test Method | Expected Outcome |
|---|---|---|
| **Cross-tenant schedule access** | Modify tenant_id in JWT; attempt to read another tenant's schedules | 403 Forbidden; no data leaked; security event logged |
| **Compliance rule tampering** | Attempt to modify compliance rules via API (rules should be read-only in production) | 403 Forbidden; rules are immutable via user-facing APIs |
| **GPS spoofing from a remote location** | Use mock-location app to clock in from 500km away | Spoofing detected; clock-in rejected; anomaly flagged |
| **Mass shift creation (DoS)** | Script that creates 10,000 shifts via API in 1 minute | Rate-limited after 20/minute; excess requests rejected with 429 |
| **JWT privilege escalation** | Modify role claim from "employee" to "owner" | Signature verification fails; request rejected; security event logged |
| **Timesheet retroactive modification** | Attempt to modify an approved timesheet entry via direct API call | Denied; approved timesheets are immutable; modification requires new approval workflow |
| **Gig worker identity spoofing** | One gig worker uses another's credentials to accept a shift | Biometric verification at clock-in detects mismatch; shift flagged for review |

### Compliance Audit Preparedness

The platform maintains continuous audit readiness for labor law investigations:

| Audit Type | Data Available | Retrieval SLA |
|---|---|---|
| **Wage and hour investigation** | Complete timesheet history with clock-in/out timestamps, GPS verification results, break records, overtime calculations | < 4 hours for any employee's full history |
| **Predictive scheduling complaint** | Schedule publication timestamps, all modifications with actor identity, premium pay calculations, employee notification receipts | < 2 hours for any schedule period |
| **Worker classification challenge** | Complete gig engagement log with voluntary-acceptance markers, rate-negotiation records, no-exclusivity evidence | < 4 hours for any gig worker's engagement history |
| **BIPA compliance audit** | Consent records with timestamps and disclosure versions, template retention records, deletion certificates | < 1 hour for any employee's biometric records |
| **EEOC scheduling discrimination** | Aggregated schedule fairness metrics (hour distribution by demographic, shift quality by demographic), all override justifications | < 8 hours for statistical analysis |

---

## Zero Trust Architecture for Multi-Tenant Scheduling

### Principle: Never Trust, Always Verify

In a multi-tenant scheduling platform, the zero-trust model means every request is treated as potentially malicious, regardless of its source:

| Layer | Zero-Trust Control |
|---|---|
| **API Gateway** | JWT validation + tenant_id extraction on every request; no request reaches a service without verified identity |
| **Service-to-service** | Mutual TLS between all services; service identity verified via short-lived certificates; no implicit trust based on network location |
| **Database access** | Connection-level tenant binding; row-level security enforced at database layer; application bugs cannot bypass tenant isolation |
| **Cache access** | Tenant-prefixed keys with middleware enforcement; cache library rejects any key without a valid tenant prefix |
| **Background jobs** | Job-level tenant context injection; audit trail for every background job execution with tenant scope verification |
| **Admin access** | Break-glass procedure for cross-tenant access (production debugging); requires dual approval + time-limited access + full audit logging |

### Supply Chain Security for Compliance Rules

Compliance rule configurations are the most sensitive data in the system—a tampered rule could expose thousands of businesses to legal liability:

```
Rule Authoring (Legal Team)
    ↓
Cryptographic signing (legal team's signing key)
    ↓
Peer review (second legal analyst verifies encoding)
    ↓
Automated testing (rule validates correctly against test schedules)
    ↓
Staged rollout (1% of affected businesses → 10% → 100%)
    ↓
Production deployment with signed manifest
    ↓
Runtime verification: every rule evaluation checks signature
    against trusted keyring before applying
```

Any rule that fails signature verification is rejected, and the system falls back to the previous rule version for that jurisdiction. This prevents supply-chain attacks where a compromised CI pipeline could inject malicious compliance rules.
