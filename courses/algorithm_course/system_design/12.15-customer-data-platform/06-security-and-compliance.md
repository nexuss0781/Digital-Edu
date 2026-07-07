# 06 — Security and Compliance: Customer Data Platform

## Threat Model

### Assets Under Protection

| Asset | Sensitivity | Threat |
|---|---|---|
| Customer PII (email, phone, name) | Critical | Unauthorized read/exfil, cross-tenant access |
| Behavioral event history | High | Unauthorized read, profiling misuse |
| Identity graph | High | Linkage attack to re-identify anonymous users |
| Destination credentials | Critical | Credential theft enabling data exfil to attacker-controlled systems |
| Consent records | Critical | Tampering to bypass consent enforcement |
| Audit log | High | Tampering to hide unauthorized access |

### Threat Actors and Attack Vectors

| Actor | Vector | Mitigation |
|---|---|---|
| External attacker | Compromised write key → data injection | Write key rotation; rate limiting; schema validation blocks unexpected payloads |
| External attacker | API enumeration of profile data | Profile lookup requires access token (not write key); rate limiting; no bulk enumeration API |
| Malicious insider | Direct database access to read PII | Database access via service accounts only; PII encrypted at rest; access logged in audit trail |
| Compromised destination | Destination credentials used to exfil data | Credentials stored in managed KMS; only decrypted by delivery worker; never returned via API |
| Cross-tenant data leak | Tenant isolation failure in multi-tenant query | Strict `workspace_id` predicate on every query; enforced at ORM/query-builder layer |
| Supply chain attack | Malicious SDK | SDK binary signing and integrity verification; CSP headers for web SDK |
| SDK code injection | Malicious events crafted to trigger SSRF via destination webhooks | Destination URL validation (allowlist of valid schemes/domains); SSRF protection in HTTP client |

---

## PII Handling

### PII Classification

All event properties and profile traits are classified at schema registration time. PII classification levels:

| Level | Examples | Storage Treatment |
|---|---|---|
| Level 0 (Public) | Product ID, page URL, event name | Stored and forwarded as-is |
| Level 1 (Sensitive) | First name, last name, user agent | Encrypted at rest; may be forwarded if destination allows |
| Level 2 (Highly Sensitive) | Email, phone, IP address | Encrypted at rest; hashed before cross-system forwarding by default |
| Level 3 (Regulated) | Health data, financial data, biometrics | Encrypted at rest with separate key; forwarded only with explicit per-destination configuration and enhanced consent |

### Email and Phone Handling

Email and phone are stored in two forms in the profile:
- **Encrypted plaintext**: stored encrypted with workspace-specific key in the profile store (for display in management UI, right-to-access response)
- **Normalized hash**: SHA-256 of the lowercase, E.164-normalized value (for identity matching and forwarding to destinations that accept hashed PII)

Plaintext email/phone never appear in event payloads forwarded to destinations. Destinations that need plaintext PII must be explicitly configured and require Level 3 consent from the user.

### IP Address Treatment

IP addresses received at the edge are used for geo-enrichment (country, region, city, ISP) and then either:
- Dropped entirely (most privacy-conscious configuration)
- Truncated to /24 (IPv4) or /48 (IPv6) before storage
- Stored encrypted with 90-day TTL

Full IP addresses are never forwarded to destinations.

### Data Minimization

The schema registry enforces data minimization rules:
- Properties marked as "ephemeral" are used for real-time enrichment only and dropped after processing
- Properties marked as "transform: hash" are hashed before storage
- Properties marked as "transform: drop_before_destination" are stripped from delivery payloads

---

## Consent Management Architecture

### Consent Data Model

```
ConsentRecord {
  profile_id:       UUID
  workspace_id:     UUID
  purpose:          String (e.g., "marketing", "analytics", "personalization", "sale_of_data")
  status:           Enum { granted | denied | unknown }
  legal_basis:      Enum { consent | legitimate_interest | contract | legal_obligation }
  jurisdiction:     String (e.g., "EU", "CA", "global")
  granted_at:       ISO8601?
  revoked_at:       ISO8601?
  source:           String (e.g., "cookie_banner", "preference_center", "import")
  consent_string:   String? (IAB TCF consent string for EU cookie consent)
  version:          Int (incremented on every change; used for conflict resolution)
}
```

### Consent Propagation

Consent changes are propagated through the system via a dedicated consent event stream. When a user updates consent in the preference center:

1. ConsentRecord updated in the profile store (ACID write)
2. Consent change event emitted to the consent event stream
3. Consent enforcement layer reads the stream and updates its in-memory consent cache (serving consent checks at ingest and fan-out)
4. Ongoing fan-out workers re-check consent against the updated cache on next dequeue cycle
5. Destinations configured to receive consent change events are notified (for downstream consent propagation)

The consent cache is a read-through cache with a short TTL (30 seconds). This means a consent revocation takes effect within 30 seconds in the delivery path — acceptable for most regulatory requirements.

### Purpose-Based Routing

Each destination is configured with a set of required consent purposes. The fan-out router enforces:

```
FUNCTION profileConsentedForDestination(profile, destination) -> Bool:
  FOR each required_purpose in destination.consent_purposes:
    consent = profile.consent[required_purpose]
    IF consent IS NULL OR consent.status != "granted":
      RETURN false
  RETURN true
```

This means a destination configured for "marketing" purpose will only receive deliveries for users who have explicitly granted marketing consent. Users who have denied or not responded are automatically excluded, with the exclusion recorded in the audit log.

### GDPR vs. CCPA Model Differences

| Aspect | GDPR (EU) | CCPA/CPRA (California) |
|---|---|---|
| Default | No processing without lawful basis; consent is opt-in | Processing allowed by default; opt-out available |
| Consent model | Explicit granular consent per purpose | Right to opt out of "sale/sharing" of personal data |
| Implementation | Consent required before event is accepted | Events accepted; "do not sell" flag gates destinations marked as "data sale" |
| Right to erasure | Yes, mandatory within 30 days | Yes (right to delete), within 45 days |
| Data subject access | Right to access all data | Right to know categories and specific pieces |

The platform supports both models simultaneously. Each workspace is configured for its applicable jurisdictions. Profiles from EU users are subject to GDPR rules; profiles from California users are subject to CCPA rules. Profiles may be subject to both if the user is in both jurisdictions.

---

## Right-to-Erasure Pipeline

### Pipeline Stages

When an erasure request is received:

```
Stage 1: Validation (< 1 minute)
  - Verify requester identity and authorization
  - Locate profile by identifier
  - Mark profile as "erasure_requested" in fast-path lookup (immediately blocks new event processing)

Stage 2: Live Store Erasure (< 1 hour)
  - Delete profile document from profile store
  - Remove all identity graph nodes for this profile
  - Delete from audience membership cache
  - Purge pending delivery records from destination queues

Stage 3: Event Store Erasure (< 24 hours)
  - Identify all events in the append-only event store linked to this profile
  - For immutable log tiers: overwrite PII fields with null/tombstone markers
  - Update event store index to exclude this profile from future reads

Stage 4: Warehouse Export Erasure (< 7 days)
  - Issue deletion requests to customer-configured warehouse destinations
  - For warehouses that don't support point deletes: issue a suppression list that
    query layers must apply, or require customer to run DELETE SQL

Stage 5: Archive Erasure (< 30 days)
  - Identify backup and cold archive files containing this profile's events
  - Mark files for re-processing with PII stripping on next access
  - For tape/WORM storage: note in erasure record that archive data will be overwritten at next
    scheduled archive rotation

Stage 6: Confirmation (< 30 days)
  - Generate cryptographically signed erasure certificate listing all stages completed
  - Retain erasure record in audit log (non-PII: erasure_request_id, profile_id_hash, completion_timestamps)
```

### Erasure in Immutable Logs

The challenge of erasure in append-only event logs requires careful design. Three approaches:

1. **Crypto-shredding**: Each profile's events are encrypted with a profile-specific key. To erase, delete the key. Without the key, the ciphertext is effectively unreadable. Fast, scalable, but requires per-profile key management at scale.

2. **Compaction with PII stripping**: Mark events for erasure; during the next log compaction, strip PII fields. Slower (days to take effect) but simpler.

3. **Event suppression index**: Maintain a list of erased `profile_id` values. Query layers apply this suppression list before returning results. Data remains on disk but is invisible to all query paths.

Production CDPs often combine these: crypto-shredding for active data, compaction for archived data, suppression index as an interim measure.

---

## Audit Trail

The audit log records every significant action in the system:

| Event Category | Examples |
|---|---|
| Data access | Profile read via API; bulk export initiated |
| Profile mutations | Profile created, merged, split, trait updated |
| Consent changes | Consent granted, revoked, updated for a purpose |
| Identity resolution | Merge performed; split performed; identifier linked |
| Erasure | Request received, each stage completed, certificate issued |
| Destination activity | Destination created, credential updated, circuit opened |
| Administrative | Schema registered, workspace settings changed, user permissions changed |

The audit log is:
- **Append-only**: no record can be modified or deleted (enforced at the storage layer)
- **Cryptographically chained**: each record includes the hash of the previous record (Merkle-chain structure allows tamper detection)
- **Replicated**: synchronously written to at least two storage locations before acknowledgment
- **Retained** for 7 years (configurable per workspace to meet different regulatory retention requirements)

---

## SOC 2 Controls Summary

| SOC 2 Criterion | Implementation |
|---|---|
| CC6.1 (Logical access) | Role-based access control; principle of least privilege; MFA required for management UI |
| CC6.2 (New access provisioning) | Access granted via formal provisioning workflow; quarterly access review |
| CC6.3 (Access removal) | Automated de-provisioning on employee offboarding |
| CC6.6 (Transmission protection) | TLS 1.3 for all data in transit; certificate pinning for SDK |
| CC6.7 (Encryption at rest) | AES-256 for all storage tiers; per-workspace encryption keys |
| CC7.2 (Anomaly monitoring) | Real-time anomaly detection on data access patterns; alerting on off-hours bulk reads |
| CC9.2 (Vendor risk) | Destination credentials stored in managed KMS; vendor security questionnaires |
| A1.2 (Availability) | Multi-AZ deployment; automated failover; tested DR runbooks |

---

## Advanced Threat Scenarios

### Threat 1: Identity Graph Poisoning

An attacker creates synthetic events designed to merge unrelated profiles by injecting events with carefully chosen identifier combinations (e.g., an event carrying both victim A's anonymousId and victim B's email hash). If identity resolution accepts this merge, the attacker has linked two unrelated individuals, corrupting both profiles.

**Defenses:**
1. **Merge confidence threshold**: Require at least N co-occurrence events between two identifiers before merging, not just one event. A single event linking two previously-unrelated identifiers triggers a "soft link" (candidate merge) that requires additional confirming evidence.
2. **Merge velocity limiter**: Alert if a single source or API key triggers an unusually high number of identity merges per unit time (> 5× baseline).
3. **Merge anomaly detector**: Flag merges where the two profiles have zero overlapping behavioral signals (different geolocations, different device types, different browsing patterns). Route these to manual review.
4. **Source trust scoring**: Weight merge evidence differently by source. A server-side API with authenticated user context is trusted more than an anonymous web SDK event.

### Threat 2: Consent Record Tampering

An attacker with write access to the consent store (via compromised credentials or insider access) modifies consent records to enable data delivery to destinations the user has not consented to — effectively weaponizing the CDP as an unauthorized data distribution system.

**Defenses:**
1. **Immutable consent event log**: Consent records are append-only events, not mutable rows. A "revocation" is a new event that supersedes the previous grant. The current state is derived by replaying events.
2. **Cryptographic consent receipts**: Each consent change generates a signed receipt (timestamp, purpose, status, hash of previous receipt) forming a hash chain. Tampering requires forging the chain, which is detectable.
3. **Dual-control consent writes**: Consent changes from internal administrative tools require two-person approval. Programmatic changes from the SDK are permissioned separately.
4. **Consent audit reconciliation**: A daily reconciliation job compares the consent event log against the materialized consent state in the profile store, flagging any divergence.

### Threat 3: Destination Credential Exfiltration

Destination credentials (OAuth tokens, API keys, webhook signing secrets) are high-value targets. If exfiltrated, an attacker can redirect customer data to attacker-controlled endpoints or impersonate the CDP to destination systems.

**Defenses:**
1. **Envelope encryption**: Each destination credential is encrypted with a destination-specific data key (DEK), which is itself encrypted with a workspace-level key encryption key (KEK) stored in the managed KMS. Compromise of one DEK exposes one destination, not all.
2. **Credential access auditing**: Every decryption of a destination credential is logged with the decrypting service identity, timestamp, and purpose. Anomalous access patterns (credential decrypted outside delivery flow, unusual time) trigger alerts.
3. **Short-lived tokens**: Where destinations support OAuth, prefer short-lived access tokens refreshed from stored refresh tokens. The access token lifetime is minimized (1 hour or less).
4. **No credential return**: The management API never returns plaintext credentials. Once stored, credentials can only be overwritten, not read back.

### Threat 4: Cross-Tenant Data Leakage via Destination Schema Mapping

A misconfigured destination schema mapping could cause one workspace's events to be delivered to another workspace's destination — not through a direct data access vulnerability, but through a routing error in the fan-out layer.

**Defenses:**
1. **Workspace-scoped destination IDs**: Destination identifiers are globally unique and contain the workspace ID as a prefix. The fan-out router validates that the workspace ID in the destination matches the workspace ID of the event before delivery.
2. **Schema mapping isolation**: Schema mappings are stored per-workspace in separate collections/schemas. No cross-workspace reference is possible at the data layer.
3. **Delivery-time workspace assertion**: The delivery worker asserts that the workspace_id on the queued message matches the workspace_id configured on the destination before executing the delivery. This is a defense-in-depth check — if the routing layer has a bug, the delivery layer catches it.
4. **Synthetic canary events**: A continuous integration test sends canary events for a test workspace through the full pipeline and verifies they arrive only at the configured test destination and no others.

---

## Multi-Tenant Security Boundaries

### Isolation Layers

```
Layer 1: Network Isolation
  - Each workspace's ingest traffic is routed through workspace-tagged load balancers
  - Internal service-to-service calls include workspace_id in request headers
  - Network policies restrict cross-workspace communication at the mesh layer

Layer 2: Query Isolation
  - All database queries include workspace_id as a mandatory predicate
  - Database views enforce workspace_id filtering at the database layer (not application)
  - ORM/query builder automatically injects workspace_id; raw SQL queries require
    explicit workspace_id parameter (validated by code review policy)

Layer 3: Encryption Isolation
  - Per-workspace encryption keys for profile store, event store, and destination credentials
  - Key hierarchy: root key → workspace KEK → data DEK
  - Cross-workspace key access is impossible without the workspace's KEK

Layer 4: Audit Isolation
  - All data access operations logged with workspace_id
  - Cross-workspace access attempts (even by admin) generate immediate alerts
  - Quarterly access review verifies no unexpected cross-workspace patterns
```

### Workspace Data Residency Enforcement

For workspaces configured with data residency requirements (e.g., EU data must stay in EU):

```
FUNCTION enforceDataResidency(event, workspace):
  required_region = workspace.data_residency_region
  IF required_region IS NULL:
    RETURN  // No residency requirement; process anywhere

  processing_region = getCurrentProcessingRegion()
  IF processing_region != required_region:
    // Route to correct region instead of processing locally
    forward_to_region(event, required_region)
    RETURN

  // Verify all downstream storage targets are in the required region
  FOR EACH storage_target IN [event_store, profile_store, identity_graph]:
    IF storage_target.region != required_region:
      RAISE DataResidencyViolation(workspace.id, storage_target.name)
```

---

## Breach Response Playbook

### Detection Phase (0–15 minutes)

```
1. SIEM alert triggers on anomalous pattern:
   - Unusual volume of profile reads from internal service account
   - Destination credentials accessed outside delivery flow
   - Cross-workspace query attempt detected
   - Bulk data export to unrecognized endpoint

2. On-call engineer validates alert:
   - Check if alert correlates with known deployment or maintenance
   - Verify alert is not a false positive from load spike
   - If confirmed suspicious → escalate to security incident
```

### Containment Phase (15–60 minutes)

```
3. Immediate containment actions:
   - Rotate all destination credentials for affected workspace(s)
   - Revoke the compromised access token / API key
   - Block the suspect IP range at edge collector layer
   - Pause destination delivery for affected workspace (queue messages, don't deliver)
   - Enable 100% request tracing for affected workspace

4. Scope assessment:
   - Query audit log for all actions by the compromised credential
   - Determine time window of unauthorized access
   - Identify which profiles were accessed or exfiltrated
   - Check if identity graph or consent records were modified
```

### Notification Phase (1–72 hours)

```
5. Regulatory notification assessment:
   - Count of affected data subjects (profiles accessed)
   - Categories of data exposed (PII level classification)
   - Jurisdictions of affected data subjects (for GDPR: EU DPA notification within 72h)
   - Prepare data breach notification for affected workspace administrators

6. Communication:
   - Notify affected workspace administrators with:
     - Scope of breach (number of profiles, data categories)
     - Timeline of unauthorized access
     - Containment actions taken
     - Recommended actions for downstream systems
```

### Recovery Phase (1–30 days)

```
7. Remediation:
   - If consent records were tampered: restore from immutable consent event log
   - If profiles were corrupted: replay from event store checkpoint
   - If identity graph was poisoned: run identity graph audit to detect
     and reverse unauthorized merges
   - Deploy fix for the vulnerability that enabled the breach

8. Post-incident:
   - Root cause analysis and post-mortem
   - Update threat model with new attack vector
   - Implement additional monitoring for the attack pattern
   - Update SOC 2 control documentation if applicable
```

---

## Data Classification Matrix

| Data Element | Classification | Storage | Transit | Retention | Erasure |
|---|---|---|---|---|---|
| Event payload (non-PII) | Internal | Encrypted at rest | TLS 1.3 | Per retention policy | Standard delete |
| Event payload (PII fields) | Confidential | Per-profile key encryption | TLS 1.3 | Per retention policy | Crypto-shredding |
| Profile traits (non-PII) | Internal | Workspace-level encryption | TLS 1.3 | Indefinite | Profile delete |
| Profile traits (PII) | Confidential | Per-profile key encryption | TLS 1.3 | Indefinite | Crypto-shredding + profile delete |
| Consent records | Regulated | Tamper-proof append-only log | TLS 1.3 | 7 years minimum | Retained even after profile erasure (audit) |
| Destination credentials | Critical | Envelope encryption (DEK+KEK) | TLS 1.3 + mTLS | Until rotation | Secure wipe |
| Audit log entries | Regulated | Merkle-chained, multi-AZ | TLS 1.3 | 7 years | Non-deletable |
| Identity graph edges | Confidential | Graph-level encryption | TLS 1.3 | Indefinite | Cascade from profile erasure |
| Write keys (SDK tokens) | Critical | KMS-managed | TLS 1.3 | Until rotation | Immediate revocation |

---

## Key Rotation Schedule

| Key Type | Rotation Period | Impact During Rotation | Process |
|---|---|---|---|
| Workspace KEK | 90 days | None (envelope encryption allows transparent rotation) | Generate new KEK → re-encrypt all DEKs with new KEK → retire old KEK after 24h |
| Profile data key (UDK) | 365 days or on compromise | Requires re-encryption of all profile events during next compaction cycle | Add new UDK → new writes use new key → background re-encrypt old data |
| Destination DEK | 180 days | Brief pause in delivery (< 1 minute) during credential re-encryption | Generate new DEK → re-encrypt credential → resume delivery |
| SDK write keys | 180 days (or customer-configured) | Requires SDK client update; old key remains valid for grace period (7 days) | Issue new key → notify workspace admin → deprecation period → revoke old key |
| TLS certificates | 90 days (automated) | Zero-downtime via dual-cert serving | Automated via certificate manager; old cert served in parallel until expiry |
| Audit log signing key | 365 days | New chain segment started; old segment finalized and sealed | New signing key → new chain root → cross-reference to old chain tail |
