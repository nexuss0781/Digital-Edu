# 06 — Security & Compliance: A/B Testing Platform

## Experiment Integrity

### Preventing Assignment Manipulation

Experiment assignments must be tamper-resistant. If users could influence their variant assignment, they could selectively opt into favorable treatments, invalidating the randomization that makes causal inference possible. This is not a theoretical concern — in systems using client-side assignment based on user-controlled identifiers, sophisticated users and bots routinely exploit predictable hashing to land in desired variants.

**Threat model and mitigations:**

| Threat | Mechanism | Mitigation |
|---|---|---|
| Users gaming bucket assignment | Rotating entity ID to land in a desired bucket | Bind assignment to authenticated user ID from server-side session, not client-provided cookie |
| Cookie deletion to re-randomize | User clears cookies to get a new random session ID | Use authenticated user ID as primary entity ID; session ID only for unauthenticated users |
| Internal stakeholders biasing results | Manually placing themselves or colleagues in specific variants | Assignment override requires two-person approval; overrides are logged with full audit trail |
| Client-side SDK tampering | Modifying the local ruleset JSON to force a specific variant | Ruleset is cryptographically signed (HMAC-SHA256); SDK validates signature on load and rejects tampered rulesets |
| Traffic manipulation bots | Bots generating synthetic events to inflate conversion metrics | Bot filtering in event gateway using behavioral signals; bot events excluded from metric computation |
| Variant-specific instrumentation bugs | Bug in treatment code causes different event firing rates | SRM detection catches systematic event rate differences between variants |

### Cryptographic Ruleset Integrity

The compiled ruleset is signed before distribution:

```
Ruleset signing process:
1. Ruleset Manager compiles the ruleset document
2. Computes HMAC-SHA256(ruleset_bytes, signing_key)
3. Appends signature as a separate field in the distribution package
4. SDK on receipt: verify HMAC before loading ruleset into memory
5. On verification failure: discard ruleset, continue using previous valid ruleset
6. Alert: signature failure is a security event; page on-call immediately

Key management:
- Signing keys are rotated every 90 days
- Key rotation is transparent: new key distributed to SDKs in advance, 7-day overlap period
- Key material stored in managed KMS; never in application code or environment variables
```

### Assignment Log Integrity

The assignment log is the authoritative record of who saw what variant. It must be tamper-evident to support post-hoc investigation of disputed results.

1. **Append-only storage:** No update or delete operations are permitted on the assignment log. All writes are new entries via an API that only accepts append operations. The storage layer enforces this with object-lock semantics (write-once, read-many).

2. **Cryptographic chaining:** Hourly batches of assignment records include a `previous_batch_hash` field containing the SHA-256 hash of the preceding batch. Any modification to historical records breaks the chain, detectable by an audit job that recomputes hashes nightly.

3. **Server-side verification:** Even for client-evaluated assignments, the server independently computes the expected assignment using the same deterministic hash function and the same ruleset version the SDK used. Discrepancies are flagged as potential integrity violations.

4. **Immutable snapshots:** The ruleset version used by each assignment is recorded in the assignment log. This allows historical assignments to be verified even after the current ruleset changes.

### Variant Blinding for High-Stakes Experiments

For experiments where seeing intermediate results could influence analyst behavior — pricing tests, medical device UI experiments, financial product features, or any test where the analyst team has a strong prior — the platform supports **analyst blinding**:

```
Blinding workflow:
1. At experiment creation, owner enables blinding mode
2. Dashboard displays metric values but labels variants as "Variant A", "Variant B" (not "control/treatment")
3. Statistical significance is displayed without directional language ("significant difference detected")
4. Unblinding trigger: owner clicks "Reveal Results"; requires two-person confirmation
5. After unblinding: full directional results shown; decision must be recorded in the platform
6. Audit log records: who unblinded, when, whether significance was already reached at time of unblinding
```

---

## PII in Events

### Data Minimization by Design

Experiment events should carry as little personally identifiable information as possible. The platform enforces this at multiple layers:

**Layer 1 — Entity ID tokenization at the SDK:**
The raw user identifier (email, phone number, internal user ID) is never included in events transmitted over the network. SDKs substitute a tokenized ID computed as `HMAC-SHA256(raw_user_id, per_sdk_secret)`. The mapping between token and real identity exists only in the identity service. If an event log is exfiltrated, the tokens cannot be reversed to real identities without access to the per-SDK secret.

**Layer 2 — Property allowlisting at the Event Gateway:**
Each event type has an approved schema registered in the schema registry. The Event Gateway strips any property not in the approved schema before the event reaches the log. This prevents accidental logging of sensitive user inputs that developers might include during debugging (search queries, form field values, etc.).

**Layer 3 — Aggregation-only analysis:**
The statistical engine never exposes per-user event data. All outputs are aggregated sufficient statistics (count, sum, sum-of-squares per variant). Segment analysis outputs are suppressed if the segment contains fewer than 1,000 users (k-anonymity threshold) to prevent individual re-identification from small segment statistics.

### Differential Privacy for Sensitive Metrics

For experiments measuring sensitive outcomes (health-related features, financial behavior), the platform offers **differential privacy (DP) mode**:

```
DP mode operation:
- Gaussian mechanism: add noise drawn from N(0, σ²) to each per-user metric value before aggregation
- σ = (2 × sensitivity × ln(1.25/δ)) / ε  [DP parameter calibration]
- Default: ε=1.0, δ=10⁻⁵ (strong privacy guarantee)
- Trade-off: DP noise inflates variance, requiring larger sample sizes for the same statistical power
- Platform calculates and displays the effective sample size after DP noise, so analysts can plan accordingly
```

### Data Residency

Different regulatory jurisdictions require that user data remain within geographic boundaries. The event pipeline supports **regional partitioning**:

```
Regional data flow:
- Event tagged with user's jurisdiction at assignment time (from targeting attributes)
- Gateway routing: jurisdiction → regional ingest endpoint
- Storage: regional object storage bucket, no cross-region replication for user data
- Analysis: regional statistical engine instances process each region independently
- Cross-regional experiment results: aggregate sufficient statistics only (no user-level data transferred)

Supported regions: EU (GDPR), US, APAC (individual country configs available)
```

### Retention and Right to Erasure

Under data protection regulations, users may request deletion of their personal data. Compliance requires a response within 30 days in most jurisdictions.

**Pseudonymization via key rotation (preferred path):**
```
Erasure-equivalent process:
1. Receive deletion request for user_id U
2. Retrieve U's token: token_U = HMAC-SHA256(U, sdk_secret)
3. Add token_U to a "deleted entities" list stored in the identity service
4. On metric computation: filter out events with entity_id ∈ deleted_entities list
5. On SDK key rotation (every 90 days): new HMAC key makes historical tokens unlinkable to real IDs
```

**Hard deletion (regulatory requirement in some jurisdictions):**
```
Hard deletion process:
1. Mark all event records with entity_id = token_U as "pending_deletion"
2. Scheduled deletion job (runs nightly): purge pending_deletion records from event log
3. Update assignment log: overwrite entity_id with a null tombstone, preserving counts
4. Generate deletion certificate: { user_id_hash, deletion_timestamp, records_purged_count }
5. Store certificate for 7 years (regulatory evidence requirement)
```

---

## Audit Trail

### Comprehensive Audit Event Coverage

Every configuration change to an experiment generates an immutable audit record:

```
AuditEntry {
    audit_id:           UUID
    entity_type:        ENUM(experiment, metric, layer, ruleset, sdk_key, user_permission)
    entity_id:          UUID
    action:             ENUM(created, updated, started, paused, stopped, archived,
                             force_stopped, variant_overridden, analyst_unblinded,
                             permission_granted, permission_revoked, key_rotated)
    actor_id:           string          // authenticated user ID
    actor_ip:           string          // source IP for forensic analysis
    actor_user_agent:   string          // distinguish human vs. automated changes
    timestamp:          timestamp
    before_state:       JSON            // full entity state before change
    after_state:        JSON            // full entity state after change
    reason:             string          // required for sensitive actions
    approval_chain:     string[]        // IDs of approvers for two-person actions
    automated:          bool            // true for system-initiated actions (guardrail stop)
    risk_level:         ENUM(low, medium, high, critical)
}
```

### Audit Log Storage Architecture

The audit log is stored in an isolated storage system with different access controls from the experiment configuration database:

```
Audit log storage:
- Write path: asynchronous append via dedicated audit service (not the config service)
- Storage: write-once object storage (object lock, no delete API)
- Replication: 3 geographic replicas, independent from experiment config storage
- Retention: 7 years (covers maximum regulatory retention requirement)
- Indexing: audit_id, entity_id, actor_id, timestamp, action (for fast querying)
- Query API: read-only, paginated, filterable by any indexed field
```

A separate **meta-audit** logs all reads of the audit log itself, creating an unforgeable record of who examined what. This detects unauthorized access and supports forensic investigation.

### Sensitive Action Controls

Certain actions require elevated authorization:

| Action | Requirement | Justification |
|---|---|---|
| Start experiment with > 50% traffic | Layer admin approval | High-traffic experiments have large blast radius |
| Stop experiment with > 100K users | Two-person confirmation | Prevent accidental termination of valuable running tests |
| Change traffic fraction after start | Analyst + layer admin | Traffic fraction changes can invalidate causal estimates |
| Create pricing experiment | Compliance team review | Legal and regulatory implications |
| Access raw event data per user | Data governance approval + reason | User privacy protection |
| Rotate SDK signing key | Security team + second engineer | Incorrect rotation disrupts all SDK instances |

---

## Regulatory Compliance for Pricing Experiments

Experiments that test different prices for the same product to different users face regulatory scrutiny in many jurisdictions. Pricing experiments are the highest-risk experiment category from a compliance perspective.

### Legal Frameworks

| Jurisdiction | Relevant Regulation | Key Requirement for Pricing Experiments |
|---|---|---|
| United States | FTC Act, state consumer protection laws | No deceptive pricing; disclosure on request |
| European Union | Price Indication Directive, GDPR | Cannot discriminate by protected characteristics; data minimization |
| United Kingdom | Consumer Rights Act, ICO guidance | Transparency; user can request explanation of price differences |
| Canada | Competition Act | No misleading price representations |

### Platform Safeguards for Pricing Experiments

**1. Protected attribute exclusion check:**
Before a pricing experiment is approved, the platform's compliance engine scans the targeting rules for any use of protected attributes (age, gender, ethnicity, national origin, disability status, religious affiliation). Direct use is blocked. The platform also checks for **proxy attributes** — attributes that correlate strongly with protected characteristics (zip code as a race proxy, for example) — and flags these for human review.

**2. Randomization correlation check:**
Before the experiment starts, the platform runs a statistical test to verify that variant assignment is uncorrelated with known protected attributes available in the user attribute store. If Cramér's V (association measure) between assignment and any protected attribute exceeds 0.05, the experiment is blocked pending review.

**3. Price display consistency:**
The platform verifies that price differences between variants are attributable to the experiment configuration (variant flag overrides) and not to any other personalization system that might introduce correlated price variation outside the experiment.

**4. Extended retention:**
Pricing experiments are tagged with `compliance_category = "pricing"`, which applies:
- 7-year record retention (vs. default 90 days for event data)
- Daily snapshots of variant assignment counts (for regulatory reporting)
- Deletion certificate generation for any user deletion requests (proving data was removed)

**5. Disclosure registry:**
A compliance disclosure registry is updated when a pricing experiment starts. Customer service tools query this registry to provide accurate explanations to users who ask why they saw a particular price.

---

## Authentication and Authorization

### SDK Authentication

Server-side SDKs authenticate using a long-lived SDK key scoped to a specific environment (production, staging, development). SDK key properties:
- **Environment scoping:** Production keys fail in staging; prevents accidental production data from entering test experiments
- **Zero-downtime rotation:** Two keys accepted simultaneously during rotation (7-day overlap window); rotation process is automated
- **Permission scope:** SDK keys grant only ruleset read and event write — no experiment configuration permissions
- **Key audit:** All SDK key usage is logged with the issuing key ID, enabling per-key traffic attribution

Client-side (browser/mobile) SDKs use client-side keys that are intentionally not secret (they ship in compiled app bundles and are visible to users). These keys grant read-only access to public experiment configurations and event write. No private experiment data (results, statistical outputs) is accessible via client-side SDK keys.

### Platform API Authorization (RBAC)

| Role | Experiment Config | Metric Config | Results | Audit Log | User Admin |
|---|---|---|---|---|---|
| **Viewer** | Read | Read | Read | — | — |
| **Experimenter** | Create, Read, Start/Stop own | Create, Read | Read | Read own | — |
| **Layer Admin** | Read, Manage layers | Read | Read | Read layer | — |
| **Stats Admin** | Read | Create, Update, Delete | Read | Read | — |
| **Compliance Officer** | Read | Read | Read | Read all | — |
| **Platform Admin** | Full | Full | Full | Read/Write | Full |

Permission inheritance: each role inherits all permissions of roles listed above it in a per-role hierarchy, plus the additional permissions in its row.

### Zero-Trust Principles

All inter-service communication within the platform uses mutual TLS (mTLS) with service-specific certificates. Services authenticate each other before accepting requests — an Event Processor cannot be spoofed by a component claiming to be one. Certificate rotation is automated and monitored with < 24-hour rotation frequency.

API requests from authenticated users include short-lived tokens (1-hour expiry) issued by the identity service. Token refresh is transparent to users. Tokens are scoped to the minimum necessary permissions for the user's current session.

---

## Advanced Threat Scenarios

### Threat 1: Experiment Result Manipulation via Event Injection

An adversary injects synthetic events to inflate conversion metrics for a specific variant, influencing product decisions based on false data.

**Defenses:**
1. **HMAC event signing**: Server-side SDKs sign events with a per-environment secret. The Event Gateway verifies HMAC on receipt; unsigned or incorrectly signed events are rejected.
2. **Rate limiting per entity**: Events from a single entity_id exceeding 10× the p99 rate are flagged and quarantined for review before inclusion in metrics.
3. **Bot detection pipeline**: Behavioral signals (session patterns, event timing regularity, browser fingerprint anomalies) flag likely bot-generated events. Bot events are excluded from metric computation but retained in the event log for forensic analysis.
4. **Statistical anomaly detection**: Per-variant event rate comparison. If one variant's event rate deviates > 3σ from expected, an integrity alert fires.

### Threat 2: Insider Experiment Manipulation

An internal actor overrides their assignment to a favorable variant in a pricing or feature experiment to gain a personal advantage.

**Defenses:**
1. **Override audit trail**: All assignment overrides are logged with actor ID, timestamp, and business justification. Overrides without justification are blocked.
2. **Override visibility**: Overridden assignments are flagged in the analysis pipeline and excluded from statistical computation by default.
3. **Two-person authorization**: Overrides for pricing and compliance-tagged experiments require a second approver from a different team.
4. **Server-side verification**: Even when overrides are applied, the server independently computes the "natural" assignment and logs the discrepancy.

### Threat 3: Cross-Experiment Data Leakage

A careless metric definition joins data across experiments, causing treatment effects from one experiment to leak into another's metrics.

**Defenses:**
1. **Metric isolation**: The statistical engine computes metrics per-experiment with explicit experiment context filtering. Only events tagged with the target experiment's context are included.
2. **Temporal filtering**: Only events that occurred after the user was assigned to the experiment are counted. Pre-assignment events are excluded from outcome metrics (used only as CUPED covariates).
3. **Automated interaction detection**: The platform periodically runs the 2×2 factorial interaction test for concurrent experiment pairs flagged as potentially related.

---

## Data Classification Matrix

| Data Element | Classification | Retention | Access | Erasure |
|---|---|---|---|---|
| Experiment configuration | Internal | Indefinite (archived) | Experimenters, admins | Archival, not deletion |
| Assignment log | Internal | 90 days active + 7 years archive | Analysis pipeline; audit | Pseudonymization after retention |
| Raw event log | Confidential (may contain behavioral data) | 90 days active + 7 years for pricing experiments | Analysis pipeline; data governance approval for raw access | Hard deletion on erasure request |
| Tokenized entity IDs | Internal | Tied to event/assignment retention | Platform services only | Key rotation makes unlinkable |
| Statistical results | Internal | 2 years active + archived | Experimenters, analysts (read-only) | Non-deletable (audit requirement) |
| Audit log | Regulated | 7 years | Compliance officers, platform admins (read-only) | Non-deletable |
| SDK signing keys | Confidential | Active + 90-day overlap after rotation | Platform security team only | Secure destruction after overlap |
| Targeting attributes | Confidential (may include PII proxies) | Not stored in platform; passed at assignment time only | SDK (in-memory only); never logged | N/A (not persisted) |
| Metric definitions | Internal | All versions retained | Stats admins, experimenters | Archival, not deletion |
| Pricing experiment data | Regulated | 7 years (regulatory requirement) | Compliance team + authorized experimenters | Deletion certificate required |

---

## Breach Response Playbook

### Detection Phase (0-15 minutes)

```
Alert types that trigger incident response:
  - SDK signing key compromise suspected
  - Unauthorized access to raw event log
  - Assignment log integrity chain break
  - Mass event injection detected (bot attack)
  - Unauthorized experiment configuration changes

Step 1: Validate alert
  - Confirm alert is not a false positive (check for planned key rotations, deployments)
  - Identify scope: which data, which experiments, which users affected
  - If pricing experiment data involved: escalate to compliance immediately
```

### Containment Phase (15-60 minutes)

```
Step 2: Isolate the threat
  - If SDK key compromised: rotate key immediately; SDKs will re-validate on next refresh
  - If event injection detected: quarantine suspect events; pause metric computation
  - If config tampering detected: freeze experiment config changes; revert to last known-good state

Step 3: Preserve evidence
  - Snapshot audit log, access logs, and affected event data
  - Do not delete or modify suspect data; preserve for forensic analysis
```

### Recovery Phase (1-30 days)

```
Step 4: Remediate
  - Recompute metrics excluding compromised data
  - Notify experiment owners whose results may be affected
  - If pricing experiment data breached: notify affected users per regulatory requirements

Step 5: Post-incident
  - Root cause analysis and internal postmortem
  - Update threat model and security controls
  - Re-run integrity checks on all historical assignment and audit logs
```

---

## Key Rotation Schedule

| Key Type | Rotation Period | Rotation Method | Impact During Rotation |
|---|---|---|---|
| SDK signing keys | 90 days | New key distributed 7 days in advance; dual-key acceptance | Zero downtime; SDKs accept both keys during overlap |
| SDK API keys (server-side) | 90 days | Rolling rotation; old key valid for 7 days after new key issued | Zero downtime; transparent to SDK users |
| TLS certificates (mTLS) | 90 days | Automated via internal certificate authority | Zero downtime; certificate overlap period |
| Event HMAC secrets | 180 days | New secret distributed to SDKs via ruleset; old secret valid for 14 days | Brief window of dual verification overhead |
| Audit log encryption keys | 365 days | New key for new entries; old entries accessible via key chain | Seamless; key chain maintained indefinitely |
| Config store encryption | 365 days | Re-encryption batch job during maintenance window | No service impact; reads unaffected during re-encryption |

---

## Ethical Considerations for Experimentation

### Informed Consent and Transparency

The platform does not require individual user consent for standard product experiments (covered by the platform's terms of service), but imposes additional safeguards for sensitive categories:

| Experiment Category | Consent Requirement | Disclosure |
|---|---|---|
| UI/UX changes | None (covered by ToS) | None required |
| Pricing experiments | None (covered by ToS, but subject to regulatory compliance) | Customer service can explain price differences on request |
| Health-related features | Review by ethics board | Disclosure in privacy policy |
| Accessibility features | Review by accessibility team | Cannot degrade accessibility for any variant |
| Financial product features | Compliance review | Regulatory disclosure may be required |

### Experiment Harm Minimization

The platform embeds harm minimization principles:

1. **Minimum viable exposure**: Start experiments at the lowest traffic fraction that can reach significance within the planned duration. Do not expose users to treatments unnecessarily.
2. **Guardrail-gated launch**: No experiment affecting core user experience can launch without at least one guardrail metric configured.
3. **Automatic duration limits**: Experiments running > 60 days without a decision trigger a review prompt. Indefinitely running experiments represent unnecessary continued exposure to potentially suboptimal treatments.
4. **Treatment reversal capability**: Every experiment can be stopped and reverted to control within 60 seconds of the stop command. There is no experiment that cannot be immediately undone.

---

## Audit Log Architecture

Every state change in the experimentation platform is recorded in an immutable, append-only audit log. This is a regulatory and operational necessity — experimentation decisions drive product changes affecting millions of users, and must be defensible.

### Audit Event Schema

```
AuditEvent {
    audit_id:         UUID
    timestamp:        timestamp (UTC, microsecond precision)
    actor_id:         string                // user, service principal, or "system"
    actor_type:       ENUM(human, service, automated_policy)
    action:           string                // e.g. "experiment.start", "guardrail.trigger"
    resource_type:    string                // e.g. "experiment", "metric", "layer"
    resource_id:      UUID
    before_state:     JSON                  // snapshot of resource before change
    after_state:      JSON                  // snapshot of resource after change
    metadata: {
        ip_address:   string (hashed)
        user_agent:   string
        approval_id:  UUID                  // if change required approval
        reason:       string                // human-provided justification
    }
    integrity_hash:   bytes[32]             // SHA-256 of previous audit_id + this event content
}
```

### Integrity Chain

Each audit event's `integrity_hash` includes the previous event's ID, forming a hash chain. This ensures that:
- No event can be retroactively deleted without breaking the chain
- No event can be inserted between existing events
- Chain verification runs as a daily background job; broken chain triggers a P1 alert

### Audit Retention and Access

| Category | Retention | Access Control | Use Case |
|---|---|---|---|
| Experiment lifecycle events | 7 years | Platform team + compliance | Regulatory review |
| Assignment rule changes | 7 years | Platform team + compliance | Post-hoc bias analysis |
| Statistical result modifications | 7 years | Platform team + compliance | Defend against result manipulation claims |
| Dashboard access logs | 1 year | Security team | Detect unauthorized result access |
| Admin actions (layer creation, metric definition) | 3 years | Platform team | Operational troubleshooting |
| Automated policy actions (guardrail triggers) | 3 years | Platform team + oncall | Incident reconstruction |

### Compliance Certification Matrix

| Standard | Scope | Key Requirements | Platform Controls |
|---|---|---|---|
| SOC 2 Type II | All systems handling experiment data | Access controls, change management, monitoring | RBAC, audit log, automated alerting, annual penetration test |
| GDPR | EU user experimentation data | Right to erasure, data minimization, consent | Entity-ID pseudonymization, retention policies, data subject request API |
| CCPA | California user experimentation data | Right to know, right to delete, opt-out | Data inventory, deletion pipeline, opt-out flag in targeting |
| PCI DSS (if pricing experiments touch payment data) | Payment-adjacent experiments | Encryption at rest, network segmentation | Dedicated payment experiment layer, encrypted event properties |
| HIPAA (if health features experimented) | Health-adjacent experiments | PHI protection, minimum necessary | Separate health experiment partition, enhanced access controls, BAA with subprocessors |
