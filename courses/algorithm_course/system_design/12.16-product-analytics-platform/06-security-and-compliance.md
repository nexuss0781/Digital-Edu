# 12.16 Product Analytics Platform — Security & Compliance

## Threat Model

A product analytics platform sits at the intersection of three sensitive data categories: user behavioral data (what users do inside products), user identity data (who those users are), and business intelligence (conversion rates, revenue funnel performance). Threats arise from three directions: external attackers seeking bulk behavioral data for competitive intelligence or user profiling; compromised customer credentials enabling cross-tenant data access; and the platform operator itself, which holds sensitive behavioral data and must demonstrate it does not misuse or over-retain it.

---

## PII in Events: Detection and Handling

### The PII Problem in Analytics

Unlike structured databases where PII fields are known at schema design time, analytics events contain arbitrary key-value properties. A developer may inadvertently log `user.email` as an event property, a mobile SDK may capture clipboard contents, or a server-side event may include a full JWT with embedded user data. PII in the event stream is the most common compliance risk for analytics customers.

### Detection Pipeline

The governance scorer performs PII scanning on every incoming event's property values using a multi-signal approach:

**Signal 1: Pattern matching**
```
PII_PATTERNS = {
  "email":       REGEX r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
  "phone_us":    REGEX r"(\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}",
  "ssn":         REGEX r"\b\d{3}-\d{2}-\d{4}\b",
  "credit_card": REGEX r"\b(?:\d[ -]*?){13,16}\b",  // Luhn-validated
  "ipv4":        REGEX r"\b(?:\d{1,3}\.){3}\d{1,3}\b",
  "passport":    REGEX r"[A-Z]{1,2}\d{6,9}"
}
```

**Signal 2: Property key heuristics**
Property keys named `email`, `phone`, `ssn`, `password`, `token`, `auth`, `credit_card`, `card_number` are flagged regardless of value, as they are likely to contain PII even if current values are synthetic.

**Signal 3: Entropy analysis**
High-entropy strings (Shannon entropy > 4.5 bits/char) in string properties may be tokens or hashed identifiers. Flagged for human review, not automated blocking.

### PII Handling Actions

| Detection Level | Action |
|---|---|
| Confirmed PII (email, SSN, credit card) | Mask before storage: replace with `[REDACTED:email]`; fire governance alert to project owner |
| Suspected PII (high-entropy, known-key Practical rule of thumb) | Store with flag `pii_suspected=true`; surface in Governance UI for owner review |
| IP address (always present) | Pseudonymize: zero last octet before storage (IPv4: X.X.X.0; IPv6: zero last 80 bits) |
| User-agent (always present) | Parse to device/OS/browser components; discard raw string after parsing |

PII masking happens in the stream processor before any write to storage. The raw unmasked event is never persisted beyond the collector's in-flight buffer.

---

## Data Anonymization

### User Identification Pseudonymization

The platform does not store raw user email addresses or names. The `user_id` field is a stable opaque identifier provided by the customer's application (typically a hashed or UUID-based internal ID, never raw PII). The platform treats `user_id` as an opaque string.

**Customer responsibility boundary:** Customers are responsible for ensuring their `user_id` values do not contain PII. The platform's PII scanner checks for email patterns in user\_id values and flags violations.

### K-Anonymity for Exported Data

When event data is exported to a customer's data warehouse, the export service applies k-anonymity filtering:
- Any breakdown group (e.g., funnel users with property combination X) with fewer than k=5 users is suppressed (count reported as `< 5` rather than the exact value)
- This prevents re-identification of individuals in small cohorts from exported analytical results
- K-threshold is configurable per project; minimum enforced value is 3

---

## Access Control

### Multi-Level Permission Model

```
Permission levels (hierarchical):

  Organization Admin
  └── Can manage billing, create/delete projects, add members

  Project Admin
  └── Can manage project settings, event schemas, API keys
  └── Can view all data including user-level event lookup

  Project Analyst
  └── Can view aggregated analytics (funnels, retention, cohorts)
  └── Cannot view individual user event history
  └── Cannot export raw events

  Project Viewer
  └── Read-only access to saved dashboards and saved queries
  └── Cannot run ad hoc queries
  └── Cannot view user-level data

  Export Service Account
  └── Write-only API key for event ingestion (cannot read data)
  └── Time-limited API key (rotated every 90 days)
```

**Capability enforcement:** Each API request carries a project-scoped API key or user OAuth token. The API gateway resolves the principal's role and attaches capability tags to the request. The query layer enforces capability checks: user-lookup queries require `USER_LEVEL_ACCESS` capability; raw export requires `DATA_EXPORT` capability.

### Row-Level Project Isolation

Storage layer access is enforced by project\_id scoping at the query planner level, not at the application layer. The query planner injects a mandatory `WHERE project_id = {requesting_project_id}` predicate into every query plan. This predicate cannot be overridden by API parameters and is enforced even for internal system queries.

**Verification:** Integration tests continuously run cross-project query attempts and assert they return zero results, serving as a security regression suite.

---

## GDPR and Right-to-Erasure

### Erasure Process

GDPR Article 17 requires personal data erasure within 30 days of a valid request. The platform implements erasure via a multi-phase process:

**Phase 1 — Soft deletion (immediate, < 1 hour):**
1. The user\_id is added to a per-project erasure list stored in the identity resolution service
2. The identity resolution service stops resolving this user\_id in new queries
3. The user's entry in the user\_properties SCD table is deleted
4. Session replay recordings linked to this user\_id are flagged for deletion
5. API responses for analytics queries automatically exclude events by this user\_id (runtime filter)

**Phase 2 — Hard deletion (compaction, < 30 days):**
1. A background erasure job scans all Parquet partitions for events with the target user\_id
2. For each matching event: rewrite the Parquet file with that row omitted (tombstone approach is not used—Parquet files are immutable; deletion requires file rewrite)
3. After rewrite, the old file is marked for garbage collection
4. The queue is scanned for any in-flight events by this user\_id (evicted if found)
5. The bloom filter entries for event\_ids from this user are cleaned up

**Verification:** After Phase 2 completes, the erasure job runs a verification scan across all tiers for the target user\_id and asserts zero matches. The verified erasure is logged to an immutable audit trail (separate append-only log store).

### Data Retention Policies

```
Retention policy configuration (per project):

  hot_store_retention:      24 hours (fixed)
  warm_store_retention:     90 days (default, configurable 30–180 days)
  cold_store_retention:     730 days (default, configurable 365–3650 days)
  user_properties_retention: follows cold_store_retention

  After cold_store_retention:
    Events are permanently deleted via compaction (not archived)
    Rollup tables retain pre-aggregated data without user_id linkage (anonymized)
```

---

## Encryption

### Encryption at Rest

All storage tiers encrypt data at rest using AES-256:
- Hot store (in-memory): data is encrypted before eviction to NVMe; in-memory data not encrypted (within process boundary)
- Warm store (NVMe/SSD): filesystem-level encryption using managed key material
- Cold store (object storage): server-side encryption with per-project key isolation; customer-managed key (CMK) option available for Enterprise plans

**Key rotation:** Encryption keys are rotated annually. Old keys are retained for the duration of data encrypted under them, then destroyed. Key material is managed via a managed KMS service external to the analytics platform.

### Encryption in Transit

All SDK-to-collector communication is encrypted with TLS 1.3 minimum. Internal service-to-service communication within the platform uses mTLS for mutual authentication. Message queue connections use TLS with certificate pinning.

### Tokenization of Sensitive Properties

For projects that must pass sensitive properties (e.g., order amounts, subscription tier changes) through the analytics pipeline without risk of PII exposure, the platform offers a client-side tokenization SDK:
- Sensitive values are tokenized before SDK transmission: a stable token replaces the raw value
- The tokenization key is held by the customer, never by the analytics platform
- Analytics queries work on tokens; to dereference, the customer joins the exported data with their tokenization table externally

---

## Consent-Aware Event Processing

In jurisdictions with GDPR, CCPA, or similar regulations, the platform must respect per-user consent preferences at every stage of the pipeline:

```
FUNCTION process_event_with_consent(event, consent_store):
  consent = consent_store.GET(event.project_id, event.user_id)

  IF consent IS NULL:
    consent = get_project_default_consent(event.project_id)

  IF consent.analytics_tracking == DENIED:
    increment_counter("consent.events_dropped")
    RETURN NULL  // Drop event entirely

  IF consent.property_storage == LIMITED:
    event.properties = KEEP_ONLY(event.properties,
      ALLOWED=["platform", "device_type", "country"])

  IF consent.cross_session_linking == DENIED:
    event.user_id = NULL  // Session-level only
    event.anonymous_id = generate_session_only_id(event.session_id)

  RETURN event
```

### Consent Categories

| Category | Description | Default (EU / US) |
|---|---|---|
| **Essential Analytics** | Event counting, basic page views | Allowed / Allowed |
| **Behavioral Tracking** | Funnel, retention, path analysis | Opt-in / Opt-out |
| **Property Storage** | Custom event properties | Follows behavioral |
| **Cross-Session Linking** | Identity stitching across sessions | Opt-in / Opt-out |
| **Data Export** | User-level data to external systems | Opt-in / Opt-in |

---

## Data Classification Framework

| Level | Description | Access | Encryption | Retention |
|---|---|---|---|---|
| **Public** | Aggregated metrics (no user-level data) | Any role | At rest + in transit | Per project policy |
| **Internal** | Event-level data with user\_id | Analyst role+ | At rest + in transit | Per project policy |
| **Confidential** | User-level lookup; PII-adjacent properties | Admin role only | Customer-managed keys | GDPR-compliant |
| **Restricted** | Audit logs, erasure records | Platform admin only | Dedicated KMS | 7 years (regulatory) |

---

## Audit Logging

All data access operations are written to an append-only audit log stored separately from the analytics data store:

| Event Type | Logged Fields |
|---|---|
| Query executed | principal, project\_id, query\_type, query\_hash, date\_range, execution\_time\_ms, result\_row\_count |
| User-level lookup | principal, project\_id, target\_user\_id, accessed\_at |
| Data export initiated | principal, project\_id, export\_destination, record\_count, initiated\_at |
| API key created/rotated | principal, project\_id, key\_type, created\_at |
| Erasure request | requesting\_principal, project\_id, target\_user\_id, phases\_completed, verified\_at |
| Permission change | acting\_principal, target\_principal, old\_role, new\_role |

Audit logs are retained for 7 years to satisfy regulatory requirements. They are stored in a write-once append-only system where even platform administrators cannot modify or delete entries.

---

## Advanced Threat Analysis

### Threat 1: Cross-Tenant Data Exfiltration via Query Side Channel

**Attack vector:** An attacker with access to one project crafts queries designed to infer information about events in another project by observing query timing differences (timing side channel) or by exploiting shared compute resources.

**Mitigation:**
- Query execution uses constant-time partition scoping: the `WHERE project_id = X` filter is applied at the storage layer before any data reaches the query executor, eliminating timing variation based on cross-project data
- Query executor worker pools are logically isolated per project: workers assigned to project A never execute scans on data belonging to project B, even if the storage nodes are shared
- Query latency is not exposed at the resolution needed for timing attacks: all results are returned with minimum 50ms padding

### Threat 2: SDK Token Compromise

**Attack vector:** A client-side write API key (embedded in JavaScript SDK) is extracted from browser source code and used to inject fake events into a project, corrupting analytics data.

**Mitigation:**
- Write API keys are project-scoped and rate-limited (max 10K events/minute per API key)
- SDK origin validation: the collector checks the `Referer` and `Origin` headers against a project-configured list of allowed domains. Events from unexpected origins are quarantined rather than rejected (allowing legitimate mobile webview traffic that lacks Referer headers)
- Anomaly detection on ingestion patterns: sudden spikes from a single API key trigger automatic throttling and owner notification
- API key rotation every 90 days; compromised keys can be immediately revoked via the project admin UI

### Threat 3: Insider Access to Behavioral Data

**Attack vector:** A platform engineer with production database access reads sensitive behavioral data from a customer's project (e.g., viewing which features a competitor uses).

**Mitigation:**
- All production data access requires just-in-time (JIT) access with approval and time-bound scope
- Data access by platform engineers is logged to the same audit trail as customer queries, with additional `access_type=internal` tag
- Data at rest is encrypted per-project; decryption keys are held in a managed KMS accessible only to the query engine service account, not to individual engineers
- Annual access review: all internal data access events are audited by the security team

### Threat 4: Event Injection for Metric Manipulation

**Attack vector:** A malicious actor within a customer organization injects synthetic events to artificially inflate conversion metrics (e.g., to trigger performance bonuses tied to product KPIs).

**Mitigation:**
- Event provenance tracking: each event carries `sdk_version`, `platform`, and `ip_address` metadata that enables forensic analysis of suspicious event patterns
- Statistical anomaly detection on per-user event frequency: users generating events at >10× the project median rate are flagged
- IP clustering: events from a disproportionate number of user\_ids originating from a single IP range are flagged as potential bot traffic
- Governance dashboard surfaces these anomalies to project admins proactively

---

## Multi-Tenant Security Boundaries

### Isolation Layers

The platform enforces multi-tenant isolation at five independent layers:

```
Layer 1: Network isolation
  - Project API keys route to project-specific queue partitions
  - No shared network path between two projects' event data

Layer 2: Storage isolation
  - Events stored in project-specific storage partitions (project_id prefix)
  - Object storage uses project-specific key prefixes with IAM policies
  - No shared storage files between projects

Layer 3: Query isolation
  - Query planner injects mandatory project_id filter into all query plans
  - Filter cannot be overridden or removed by API parameters
  - Tested by continuous integration cross-project query canary tests

Layer 4: Compute isolation
  - Standard tier: shared query worker pool with project-level fair scheduling
  - Enterprise tier: dedicated query worker pool per project
  - Worker memory is cleared between query executions for different projects

Layer 5: Access control isolation
  - API keys and OAuth tokens are project-scoped
  - Organization-level admin cannot query project data without explicit project membership
  - Service-to-service communication uses project-scoped mTLS certificates
```

### Isolation Verification

A continuous security canary runs every 10 minutes:
1. Create a test event in project A
2. Query project B for the test event's unique event\_id
3. Assert zero results (any non-zero result triggers P1 security alert)
4. Query project A for the test event to confirm it was ingested correctly

This canary tests the full isolation stack: storage, query planner, and access control.

---

## CCPA/CPRA Compliance

### Right to Know

CCPA grants consumers the right to know what personal information a business has collected. The platform provides:

1. **Per-user data export API:** Given a user\_id and project\_id, export all events associated with that user across the full retention window
2. **Export format:** Structured JSON, machine-readable, including all event properties and user properties with timestamps
3. **Response time:** Export available within 24 hours (background job processes the cross-tier scan)
4. **Data categories disclosed:** Event names, timestamps, device information, geo-location (country level), and all custom event properties

### Right to Delete

Functionally identical to GDPR erasure (see above). CCPA specifies a 45-day window (vs. GDPR's 30 days); the platform targets the stricter 30-day window for both.

### Right to Opt-Out of Sale

The platform does not sell personal information. However, customers who share analytics data with third parties via the export connector must ensure the export respects user opt-out preferences. The platform supports:
- A `do_not_share` user property that, when set, excludes the user from all data exports
- Export connector filters automatically apply this property without requiring the customer to implement the filter

---

## SOC 2 Type II Attestation

### Controls Relevant to Analytics Platforms

| Control Area | Implementation |
|---|---|
| **CC6.1: Logical access controls** | RBAC with four permission levels; API key rotation; OAuth 2.0 with PKCE for dashboard access |
| **CC6.6: External boundary protections** | TLS 1.3 for all ingestion; mTLS for internal services; WAF at collector tier |
| **CC6.7: Transmission integrity** | Event checksums validated end-to-end; HMAC signature on SDK batches |
| **CC7.2: Monitoring activities** | Continuous anomaly detection on event volume, query patterns, and access patterns |
| **CC8.1: Change management** | All schema changes to the event store require approval; code deploys gated by CI/CD pipeline with security scans |
| **A1.2: Recovery mechanisms** | Multi-region standby; RPO < 1 hour; RTO < 2 hours |

### Continuous Compliance Monitoring

Rather than point-in-time audits, the platform maintains continuous compliance evidence:
- **Access control evidence:** Every API key creation, rotation, and deletion is logged with actor and timestamp
- **Encryption evidence:** Automated weekly verification that all storage tiers have encryption enabled and key rotation is on schedule
- **Data retention evidence:** Automated monthly verification that data older than the configured retention window has been purged
- **Isolation evidence:** Cross-project canary test results aggregated into a compliance report (100% pass rate required)

---

## Breach Response Playbook

### Phase 1: Detection and Containment (0–1 hour)

1. **Identify scope:** Which projects' data was potentially exposed? Which storage tiers were accessed?
2. **Revoke access:** Immediately rotate all affected API keys and invalidate active sessions for affected projects
3. **Isolate affected infrastructure:** If a storage node is compromised, take it offline and redirect traffic to replicas
4. **Preserve forensic evidence:** Snapshot audit logs, access logs, and network flow logs before any remediation

### Phase 2: Assessment (1–24 hours)

1. **Determine data categories exposed:** Event names, user\_ids, properties, user properties
2. **Estimate affected individuals:** Count unique user\_ids in exposed projects
3. **Assess re-identification risk:** Did exposed events contain PII (despite PII scanning)? Were user\_ids pseudonymous or directly identifying?
4. **Notify internal security team and legal counsel**

### Phase 3: Notification (24–72 hours)

1. **GDPR (if applicable):** Notify supervisory authority within 72 hours if breach involves personal data of EU residents
2. **CCPA (if applicable):** Notify affected consumers if breach involves unencrypted personal data
3. **Customer notification:** Notify affected project owners via email and in-platform alert with breach details, affected time window, and remediation steps
4. **Public disclosure:** Per company policy and legal requirements

### Phase 4: Remediation (1–30 days)

1. **Root cause analysis:** Identify the vulnerability that enabled the breach
2. **Fix and verify:** Patch the vulnerability; conduct penetration testing to verify the fix
3. **Strengthen controls:** Implement additional monitoring and access controls to prevent recurrence
4. **Update incident response plan:** Document lessons learned and update the breach response playbook
