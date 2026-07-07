# Security & Compliance — Error Tracking Platform

## Authentication & Authorization

### Authentication Mechanisms

| Actor | Mechanism | Details |
|-------|-----------|---------|
| **SDKs** | DSN (Data Source Name) | Project-scoped public/secret key pair embedded in the SDK configuration. Public key authenticates event submissions; secret key (optional) for management API calls. DSN format: `https://{public_key}@{host}/{project_id}` |
| **Users (Web UI)** | OAuth 2.0 / OIDC + MFA | SSO integration with identity providers. Session tokens with 24-hour expiry. Mandatory MFA for organization admins. |
| **API integrations** | API tokens (Bearer) | Scoped tokens with explicit permissions. Tokens can be org-scoped or project-scoped. Rotatable without downtime. |
| **Internal services** | Mutual TLS (mTLS) | Service-to-service communication authenticated via client certificates. Certificate rotation automated. |

### Authorization Model

**Role-Based Access Control (RBAC) with project-level granularity:**

| Role | Scope | Permissions |
|------|-------|-------------|
| Owner | Organization | Full access; billing; member management; delete org |
| Manager | Organization | Project creation; team management; alert rule management |
| Admin | Project | Project settings; source map management; issue management |
| Member | Project | View issues; comment; assign; resolve issues |
| Viewer | Project | Read-only access to issues and dashboards |

**Special permissions:**
- **PII access:** Separate permission flag. Only users with `pii:read` can see user emails, IP addresses, and unredacted breadcrumbs. Others see redacted versions.
- **Source map access:** Only project admins can upload or download source maps (they contain original source code).
- **Alert rule management:** Restricted to Admin+ to prevent accidental notification storms.

### Token Management

- DSN keys can be rotated per-project without affecting other projects
- API tokens support expiration dates (recommended: 90-day rotation)
- Revoked tokens are propagated to relay nodes within 60 seconds via push invalidation
- Session tokens stored in secure, HTTP-only cookies with SameSite=Strict

---

## Data Security

### Encryption at Rest

| Data | Encryption | Key Management |
|------|-----------|----------------|
| Event data (columnar store) | AES-256 at storage layer | Managed encryption keys; per-organization keys for enterprise plans |
| Issue metadata (relational DB) | AES-256 transparent data encryption | Database-managed keys with HSM backing |
| Source maps (object storage) | AES-256 server-side encryption | Per-release encryption keys |
| Cache (Redis) | Not encrypted at rest (ephemeral) | Contains no PII; fingerprint hashes only |
| Backups | AES-256 with separate backup keys | Backup keys stored in separate key vault |

### Encryption in Transit

- All SDK → Relay communication: TLS 1.3 (minimum TLS 1.2)
- Internal service communication: mTLS between all components
- Database connections: TLS with certificate verification
- Cross-region replication: Encrypted via TLS; data never traverses public internet

### PII Handling

Error events inherently contain PII: user email addresses, IP addresses, usernames, and potentially sensitive data in breadcrumbs, local variables, and request bodies.

**Data scrubbing pipeline (applied during ingestion):**

1. **IP address handling:** Configurable per-project — store full IP (for geo-IP), store hashed IP, or strip entirely
2. **User identity:** Email addresses hashed by default; original stored only if organization opts in
3. **Breadcrumb scrubbing:** Regex-based patterns strip credit card numbers, SSNs, API keys, and passwords from breadcrumb data
4. **Request body scrubbing:** Configurable field blocklist (e.g., `password`, `credit_card`, `ssn`); matching fields replaced with `[Filtered]`
5. **Local variable scrubbing:** Stack frame local variables containing sensitive patterns are redacted
6. **Custom scrubbing rules:** Organizations define regex patterns for domain-specific PII (e.g., patient IDs, account numbers)

**Server-side scrubbing** is enforced even if the SDK doesn't scrub client-side, ensuring PII cannot bypass controls.

### Data Masking / Anonymization

- **Aggregate analytics:** Dashboard statistics (error counts, affected user counts) never expose individual user data
- **Shared issue links:** When an issue is shared externally (e.g., linked in a GitHub issue), PII fields are automatically stripped from the shared view
- **Data export:** Exported event data respects the project's PII settings; fields marked as PII are redacted in exports

---

## Threat Model

### Top Attack Vectors

#### 1. DSN Key Exposure

**Threat:** DSN public keys are embedded in client-side JavaScript and are inherently exposed. An attacker who obtains a DSN can:
- Flood the project with fake error events (quota exhaustion, data pollution)
- Send events containing malicious payloads (XSS in error messages rendered in the UI)

**Mitigation:**
- **Rate limiting per DSN:** Token bucket rate limits prevent quota exhaustion from a single source
- **Origin validation:** Relay checks the `Origin` header against an allowlist of expected domains
- **Payload sanitization:** All event fields are HTML-escaped before rendering in the UI; CSP headers prevent inline script execution
- **Abuse detection:** Anomaly detection flags events with unusual patterns (e.g., events from unexpected user agents, events without valid stack traces)

#### 2. Source Map Exfiltration

**Threat:** Source maps contain original, unminified source code — often the most sensitive intellectual property for a web application. If an attacker gains access to source maps, they can reverse-engineer the application.

**Mitigation:**
- **Source maps are never served to browsers:** Unlike the common practice of hosting source maps alongside deployed code, the platform stores them internally and never exposes them via public URLs
- **Access control:** Only authenticated users with project admin permissions can download source maps via the API
- **Upload authentication:** Source map upload requires the DSN secret key or an API token with `project:releases` scope
- **Automatic expiration:** Source maps for old releases are automatically deleted after the retention period (default: 90 days)
- **Audit logging:** All source map uploads and downloads are logged with actor, timestamp, and IP address

#### 3. Cross-Tenant Data Leakage

**Threat:** In a multi-tenant SaaS deployment, a bug or misconfiguration could expose one organization's error data to another.

**Mitigation:**
- **Tenant isolation in storage:** Columnar store partitions include `project_id` as part of the partition key; all queries are forced to include a project_id filter at the query engine level
- **Row-level security in relational DB:** All queries are scoped to the authenticated user's organization and project memberships
- **API authorization checks:** Every API endpoint validates that the authenticated user has access to the requested project before querying data
- **Penetration testing:** Regular third-party security assessments focused on tenant isolation boundaries

#### 4. Malicious Event Injection

**Threat:** An attacker crafts error events containing XSS payloads in stack trace frames, error messages, or breadcrumbs, targeting developers who view the issue in the web UI.

**Mitigation:**
- **Output encoding:** All event data is HTML-entity encoded before rendering. Stack traces, messages, and breadcrumbs are treated as untrusted input.
- **Content Security Policy:** Strict CSP headers prevent inline script execution even if encoding is bypassed
- **Payload size limits:** Events exceeding size limits (200 KB compressed) are rejected at the relay
- **Schema validation:** Events must conform to the expected schema; unexpected fields are stripped

#### 5. Denial of Service via Event Flooding

**Threat:** An attacker generates millions of fake error events to overwhelm the platform, degrading service for all tenants.

**Mitigation:**
- **Per-DSN rate limiting:** Enforced at the relay layer before events reach the message bus
- **Spike protection:** Automatically throttles abnormal event rates per project
- **Network-level protection:** DDoS mitigation at the load balancer/CDN layer (rate limiting, IP reputation, challenge pages)
- **Quota enforcement:** Hard quota limits prevent any single organization from consuming unbounded resources

---

## Compliance

### GDPR

| Requirement | Implementation |
|-------------|---------------|
| Right to erasure | "Delete user data" API removes all events containing a specific user identifier across all projects in the organization. Propagated to columnar store (partition-level deletion), relational store, and backups (marked for exclusion from restore). |
| Data minimization | SDK data scrubbing removes unnecessary PII at collection time. Server-side scrubbing enforces organizational policies regardless of SDK configuration. |
| Data portability | Event data export API provides events in JSON format, scoped to a specific user. |
| Data residency | EU-only processing option ensures events never leave the EU region. Dedicated regional deployment with no cross-region data transfer. |
| Data processing agreement | Standard DPA available for all customers; describes data handling, sub-processors, and breach notification procedures. |
| Breach notification | Automated incident detection triggers breach assessment workflow. Notification within 72 hours as required. |

### SOC 2 Type II

- **Security:** Encryption at rest and in transit; RBAC; penetration testing; vulnerability management
- **Availability:** Multi-AZ deployment; automated failover; defined SLAs with uptime monitoring
- **Processing integrity:** Event deduplication; idempotent processing; data validation at ingestion
- **Confidentiality:** Tenant isolation; source map access controls; audit logging
- **Privacy:** PII scrubbing; data retention policies; user data deletion capabilities

### Additional Compliance

- **HIPAA:** Available as add-on for healthcare customers. Requires BAA, additional encryption controls, audit logging, and data retention enforcement.
- **PCI DSS:** Error events from payment processing systems may contain cardholder data. SDK scrubbing rules for PCI fields are pre-configured. Platform does not store or process cardholder data when properly configured.

---

## Additional Attack Vectors

#### 6. Fingerprint Manipulation

**Threat:** An attacker with DSN access crafts events with specific fingerprints to pollute existing issues. By computing the same fingerprint as a real bug, they can inject misleading stack traces, fake error messages, or distracting breadcrumbs into a legitimate issue, wasting developer investigation time.

**Mitigation:**
- **Anomaly detection on event patterns:** Flag events whose metadata (user agent, origin, SDK version) diverges significantly from the issue's existing event population
- **Event source fingerprinting:** Track the SDK version and transport characteristics per event; alert when a new event source pattern appears for an existing issue
- **Rate limiting per fingerprint:** No more than N events per minute per fingerprint from a single IP range

#### 7. Breadcrumb Data Exfiltration

**Threat:** A malicious insider with access to the error tracking UI extracts sensitive user behavior data from breadcrumbs (API calls, navigation patterns, form submissions) that reveal business intelligence or user PII.

**Mitigation:**
- **Breadcrumb scrubbing pipeline:** Apply the same PII scrubbing rules to breadcrumb data fields (URLs, request bodies, form data)
- **Role-based breadcrumb access:** Users without the `pii:read` permission see redacted breadcrumb data
- **Audit logging:** All breadcrumb data access is logged with actor, timestamp, and accessed fields

#### 8. Supply Chain Attack via SDK Dependency

**Threat:** An attacker compromises the error tracking SDK itself (supply chain attack). The compromised SDK exfiltrates application data to an attacker-controlled endpoint while appearing to send normal error reports.

**Mitigation:**
- **SDK integrity verification:** Publish SDK checksums and signatures; provide lock-file verification guidance
- **SDK transparency:** Open-source SDKs allow security audits; maintain reproducible builds
- **DSN scope limiting:** Even a compromised SDK can only report to the configured project's DSN endpoint

#### 9. Timing Attack on Fingerprint Cache

**Threat:** An attacker observes response time differences between the relay's handling of events with known fingerprints (cache hit, fast) vs. new fingerprints (cache miss, slow). This leaks information about which error patterns exist in the target project.

**Mitigation:**
- **Constant-time response:** Relay returns `200 OK` immediately after publishing to the message bus, regardless of fingerprint cache state
- **Asynchronous fingerprinting:** Fingerprint computation happens after the relay response, eliminating timing side channels

#### 10. Data Residency Bypass via Source Map Upload

**Threat:** An EU customer's events are processed in the EU region (GDPR compliance), but their source maps are uploaded to and stored in a US region. During symbolication, event data (stack trace positions) must be sent to the US region for resolution, violating data residency guarantees.

**Mitigation:**
- **Regional source map storage:** Source map uploads are routed to the same region as the project's event processing
- **Regional symbolicator deployment:** Each data residency region has its own symbolicator fleet with local source map cache
- **Upload endpoint validation:** Enforce that source map upload URLs match the project's configured data residency region

---

## Attack Surface by Component

| Component | External Exposure | Attack Surface | Key Controls |
|-----------|------------------|---------------|-------------|
| Relay gateway | Internet-facing | DSN brute-force, payload injection, DDoS | Rate limiting, envelope validation, origin check |
| Source map upload API | Authenticated external | Source code exfiltration, overwrites | DSN secret key or API token required; audit logging |
| Web UI | Authenticated external | XSS via error messages, CSRF | CSP headers, output encoding, SameSite cookies |
| Management API | Authenticated external | Unauthorized state changes, data enumeration | RBAC, rate limiting, input validation |
| Message bus | Internal only | Message poisoning (compromised worker) | mTLS, message schema validation |
| Columnar store | Internal only | SQL injection via tag queries | Parameterized queries, query allowlisting |
| Relational DB | Internal only | Privilege escalation, row-level bypass | Row-level security, connection pooling, least privilege |

---

## Incident Response Playbooks

### Playbook 1: DSN Compromise — Mass Event Flooding

**Detection:** Alert on `relay.events.accepted` > 10x baseline for a single project with anomalous user agent distribution.

**Response Steps:**
1. **Immediate (< 5 min):** Enable emergency rate limiting for the affected project (reduce to 10% of normal threshold)
2. **Triage (5-15 min):** Analyze event metadata — look for patterns in user agent, origin header, IP ranges. Determine if flooding or legitimate spike.
3. **Contain (15-30 min):** If confirmed attack: rotate the DSN key; invalidate old key across all relay nodes (< 60s propagation); notify customer to update SDK configuration
4. **Remediate:** Purge injected events from the columnar store using the identified attack patterns. Restore quota consumed by fake events.
5. **Post-mortem:** Review origin validation rules; consider additional abuse detection signals.

### Playbook 2: Source Map Data Breach

**Detection:** Alert on `sourcemap.download` events from unexpected actors or IP ranges; or external report of source code exposure.

**Response Steps:**
1. **Immediate (< 5 min):** Revoke API tokens that may have been used for unauthorized access
2. **Assess (5-30 min):** Determine which releases' source maps were accessed; check if `sourcesContent` was populated (full source code exposure vs. mapping-only)
3. **Contain (30 min - 2h):** Delete affected source maps; trigger de-symbolication for events that referenced them (replace resolved frames with minified frames)
4. **Notify:** If source code contains secrets (API keys, credentials in comments), initiate secret rotation; notify customer per breach notification obligations
5. **Harden:** Review source map access controls; consider disabling `sourcesContent` embedding by default

### Playbook 3: Cross-Tenant Data Leakage

**Detection:** Customer report of seeing another organization's data; or automated checks detect `project_id` mismatch in query results.

**Response Steps:**
1. **Immediate (< 5 min):** Disable the affected API endpoint or query path
2. **Assess (5-30 min):** Determine root cause — missing `project_id` filter in a query, row-level security bypass, cache key collision
3. **Contain (30 min - 2h):** Deploy fix; flush cache to eliminate stale cross-tenant entries; audit all queries for the affected period to determine exposure scope
4. **Notify:** Per GDPR Art. 33: notify the supervisory authority within 72 hours if personal data was exposed; notify affected customers per DPA obligations
5. **Prevention:** Add automated query analysis to CI/CD that flags queries missing tenant isolation filters

---

## Zero-Trust Architecture

| Principle | Implementation |
|-----------|---------------|
| **Never trust, always verify** | Every internal service call includes authentication (mTLS) and authorization (JWT with claims) |
| **Least privilege** | Processing workers have write-only access to the columnar store; read access to relational DB is scoped to issue lookups |
| **Micro-segmentation** | Relay → bus, bus → workers, workers → storage each traverse separate network segments with firewalled boundaries |
| **Continuous verification** | mTLS certificates rotate every 24 hours; JWT tokens expire every 15 minutes |
| **Assume breach** | Encryption at rest on all storage; audit logging on all data access; anomaly detection on internal traffic patterns |

---

## Data Classification and Tagging

### PII Detection Pipeline

Error events contain PII in unpredictable locations — email addresses in error messages, phone numbers in breadcrumbs, passwords in request body fields. The PII detection pipeline runs during ingestion:

| PII Type | Detection Method | Action | Confidence |
|----------|-----------------|--------|-----------|
| Email address | Regex: `[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}` | Hash or redact per project config | High |
| Credit card number | Luhn algorithm + regex | Always redact (replace with `[Filtered]`) | High |
| Social Security Number | Regex: `\d{3}-\d{2}-\d{4}` | Always redact | High |
| IP address | Regex: IPv4/IPv6 patterns | Strip or hash per project config | High |
| API key / token | Regex: long hex/base64 strings in key-value pairs | Redact | Medium |
| Password field | Field name matching: `password`, `passwd`, `secret`, `token` in request bodies | Always redact | High |
| Custom PII | Organization-defined regex patterns | Redact per custom rules | Variable |

### Security Testing Requirements

| Test Type | Frequency | Scope | Responsibility |
|-----------|-----------|-------|---------------|
| Penetration testing | Quarterly | Full platform including API, UI, relay | Third-party security firm |
| Dependency vulnerability scan | Continuous (CI/CD) | All dependencies in relay, workers, UI | Automated (Snyk/Dependabot) |
| Source map access audit | Monthly | All source map download events | Security team review |
| Cross-tenant isolation test | Per release | Query paths, cache, API endpoints | Automated integration tests |
| PII scrubbing validation | Per release | All event ingestion paths | Automated tests with synthetic PII |
| SDK security review | Per SDK release | SDK code, transport, local storage | SDK team + security review |

---

## Compliance Automation

| Compliance Area | Manual Approach | Automated Approach | Improvement |
|----------------|----------------|-------------------|-------------|
| PII detection | Security team reviews events manually | ML-based PII scanner in ingestion pipeline | Reactive → proactive; 100% coverage |
| Data retention enforcement | Manual cleanup scripts | TTL-based partition expiration in columnar store; automated lifecycle policies | Eliminates human error in retention |
| Access audit | Quarterly audit report generation | Real-time access logging with anomaly detection | Quarterly → continuous monitoring |
| Data residency enforcement | Manual region configuration | Project-level region tag enforced at relay routing | Configuration → architectural enforcement |
| Breach detection | Manual log review after incident report | Automated anomaly detection on access patterns | Reactive → proactive |
| Right-to-erasure | Manual data deletion request processing | API-driven erasure pipeline with confirmation | Days → hours for complete erasure |

---

## GDPR Erasure Deep Dive

The right-to-erasure (RTBF) implementation for an error tracking platform is complex because user PII is scattered across multiple storage systems in non-obvious locations:

### Erasure Pipeline Steps

1. **Identify:** Query all events containing the target user identifier across all projects the user may have interacted with. User identifiers may appear in `user_context.id`, `user_context.email`, `tags`, `breadcrumbs`, and even error messages.

2. **Delete from columnar store:** ClickHouse does not support efficient point deletes. Instead:
   - For recent data (< 30 days): Issue `ALTER TABLE DELETE WHERE user_id = X` — lightweight mutation
   - For historical data: Mark affected partitions for re-write; schedule asynchronous mutation
   - Verify deletion via `SELECT count() WHERE user_id = X` post-mutation

3. **Delete from relational store:** Standard `DELETE FROM` with cascading for related records (assignments, comments attributed to the user)

4. **Delete from backups:** Mark the user identifier for exclusion from future backup restores. For existing backups past the retention period, document that the backup will be overwritten by normal rotation.

5. **Delete from caches:** Invalidate any cached events or issue metadata containing the user identifier. Issue a pub/sub cache invalidation event.

6. **Audit log:** Record the erasure action with timestamp, scope, and completion status — without logging the erased data itself.

7. **Confirmation:** Return erasure confirmation to the data controller within the GDPR-required timeframe (typically 30 days).

### Erasure Complexity by Storage Layer

| Storage Layer | Erasure Method | Time to Complete | Verification |
|--------------|---------------|-----------------|-------------|
| Redis cache | Key deletion + pub/sub invalidation | Seconds | Key existence check |
| PostgreSQL (issues) | Standard DELETE with CASCADE | Seconds | Row count verification |
| ClickHouse (events) | ALTER TABLE DELETE mutation | Minutes to hours (async) | Post-mutation count query |
| Object storage (source maps) | Object deletion API | Seconds | HEAD request returns 404 |
| Backups | Exclusion marker for restore | Next backup rotation cycle | Audit log of exclusion |
| Message bus | Not erasable (retention-bounded) | Auto-expires per bus retention | Verify bus retention < GDPR timeline |

---

## SDK Security Hardening

The SDK runs in the customer's application and must minimize its security footprint:

| Principle | Implementation | Rationale |
|-----------|---------------|-----------|
| **Minimal permissions** | SDK requires only network access to relay endpoint | No file system, no device access beyond what the app already has |
| **No persistent secrets** | DSN is the only credential; stored in app config, not SDK state | Compromised SDK state reveals nothing beyond the public DSN |
| **Local PII scrubbing** | SDK applies client-side scrubbing rules before transmission | Reduces PII surface area; defense-in-depth with server-side scrubbing |
| **Transport security** | TLS 1.2+ mandatory; certificate pinning optional for mobile SDKs | Prevents MITM interception of error data |
| **Self-errors excluded** | SDK never reports its own internal errors to the same DSN | Prevents feedback loops; self-errors logged locally only |
| **Payload size limits** | SDK truncates oversized payloads (>200 KB) before transmission | Prevents accidental resource exhaustion on client device |
| **No dynamic code execution** | SDK never executes dynamically constructed code strings | Eliminates code injection vector via SDK configuration |

---

## Audit Logging Requirements

| Event | What's Logged | Retention | Access |
|-------|-------------|----------|--------|
| DSN key rotation | Old key hash, new key hash, actor, timestamp | 1 year | Security team |
| Source map upload | Release, filename, actor, IP, file hash | 1 year | Security + project admin |
| Source map download | Release, filename, actor, IP | 1 year | Security team |
| User data deletion (GDPR) | User identifier hash, scope, completion status | 3 years | Compliance team |
| Role/permission change | Actor, target user, old role, new role | 1 year | Security team |
| API token creation/revocation | Token hash, scope, actor | 1 year | Security team |
| Failed authentication attempt | DSN/token hash, IP, user agent, endpoint | 90 days | Security team (anomaly detection) |
| Cross-tenant access attempt | Source org, target org, endpoint, actor | 1 year | Security team (immediate alert) |

---

## Network Security Architecture

| Zone | Components | Ingress Rules | Egress Rules |
|------|-----------|--------------|-------------|
| **DMZ** | Relay gateway, load balancer | Public internet (HTTPS only) | Internal message bus; cache cluster |
| **Processing** | Workers, symbolicator | Message bus (internal only) | Cache; object storage; relational DB; columnar store |
| **Data** | PostgreSQL, ClickHouse, Redis | Processing zone only | Cross-AZ replication; backup targets |
| **Management** | Web UI, API servers, alert engine | Authenticated external (HTTPS) | Relational DB (read); columnar store (read); notification services |
| **External** | Notification channels (Slack, PagerDuty, email) | Alert engine only | Internet (HTTPS to external APIs) |

### Data-in-Transit Protection Matrix

| Path | Protocol | Authentication | Encryption |
|------|----------|---------------|------------|
| SDK → Relay | HTTPS | DSN public key in header | TLS 1.3 (min 1.2) |
| Relay → Message bus | Internal TCP | mTLS (client certificate) | TLS 1.3 |
| Worker → Symbolicator | gRPC | mTLS | TLS 1.3 |
| Worker → ClickHouse | Native TCP | Username/password + mTLS | TLS 1.3 |
| Worker → PostgreSQL | PostgreSQL wire protocol | Username/password + mTLS | TLS 1.3 |
| Worker → Redis | RESP protocol | AUTH command + mTLS | TLS 1.2+ |
| Alert engine → Slack/PagerDuty | HTTPS | OAuth token / API key | TLS 1.3 |
| Cross-region replication | Internal TCP | mTLS + VPN tunnel | TLS 1.3 + IPSec |
| Source map upload | HTTPS | DSN secret key or API token | TLS 1.3 |
