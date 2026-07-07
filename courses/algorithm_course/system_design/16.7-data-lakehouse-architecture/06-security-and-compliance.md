# Security & Compliance — Data Lakehouse Architecture

## Threat Model

### Top 5 Attack Vectors

| # | Threat | Description | Severity |
|:---|:---|:---|:---|
| 1 | **Credential leakage via catalog** | Catalog vends temporary object-storage credentials; if the vending endpoint is compromised, attackers gain direct access to data files | Critical |
| 2 | **Snapshot poisoning** | A malicious writer commits a snapshot referencing tampered data files, corrupting downstream queries and ML training | Critical |
| 3 | **Metadata exfiltration** | Manifest files contain column statistics (min/max values) that reveal data distribution even without reading actual data | High |
| 4 | **Stale credential reuse** | Temporary credentials are captured and reused after intended expiry due to clock skew or insufficient revocation | High |
| 5 | **Partition inference attack** | Partition values (e.g., date, region) are visible in file paths on object storage; attacker infers data characteristics from path patterns | Medium |
| 6 | **Manifest statistics leakage** | Column min/max values in manifests reveal data ranges (salary bounds, age ranges) without reading data files | Medium |
| 7 | **Orphan file data remnants** | Failed commits leave data files on object storage; files contain real data but are not governed by the catalog | Medium |
| 8 | **Cross-engine privilege escalation** | A less-restricted query engine accesses columns or rows that another engine's policy would block | High |
| 9 | **Snapshot rollback data resurrection** | Rolling back to a previous snapshot re-exposes data that was deleted for compliance reasons | High |
| 10 | **Compaction timing side channel** | Compaction patterns reveal write activity — an observer can infer data ingestion frequency and volume | Low |

### Attack Surface by Component

| Component | Attack Surface | Key Controls |
|:---|:---|:---|
| **Catalog** | REST API, credential vending endpoint, admin interface | Rate limiting, mTLS, RBAC, audit logging |
| **Object Storage** | Direct access via storage API, bucket policies | Scoped credentials, prefix-based policies, encryption |
| **Query Engine** | SQL interface, JDBC/ODBC endpoints | SQL injection prevention, parameterized queries, column masking |
| **Metadata Files** | Manifest statistics, snapshot history | Encryption at rest, access via catalog only (no direct storage reads) |
| **Compaction Service** | Read/write access to all table data | Service account with minimal privileges, dedicated network segment |

## Authentication

### Authentication Mechanisms

| Mechanism | Use Case | Strength |
|:---|:---|:---|
| OAuth 2.0 / OIDC | Interactive users (BI tools, notebooks) | Standard; supports MFA and SSO |
| Service account tokens | Engine-to-catalog communication | Machine identity; rotatable |
| mTLS | Engine-to-object-storage, engine-to-catalog | Strong mutual authentication; certificate-based |
| API keys | Programmatic access (CI/CD pipelines) | Simple but must be rotated frequently |
| SAML / LDAP federation | Enterprise SSO integration | Centralized identity management |

### Token Management

| Token Type | Lifetime | Refresh |
|:---|:---|:---|
| User access token | 15 minutes | Via refresh token (8-hour lifetime) |
| Service account token | 1 hour | Auto-rotation by secret manager |
| Object storage credential | 15 minutes (scoped) | Re-vended by catalog per request |
| mTLS certificate | 90 days | Automated renewal via certificate authority |

## Authorization

### Role-Based Access Control (RBAC)

| Role | Permissions |
|:---|:---|
| **Reader** | SELECT on granted tables; load metadata; read data files |
| **Writer** | Reader + INSERT, UPDATE, DELETE on granted tables |
| **Table Admin** | Writer + ALTER TABLE (schema evolution, partition changes), COMPACT, VACUUM |
| **Namespace Admin** | Table Admin + CREATE/DROP TABLE within namespace |
| **Catalog Admin** | Full control: namespace management, access policy, audit configuration |

### Fine-Grained Access Control

| Level | Mechanism | Example |
|:---|:---|:---|
| **Table-level** | RBAC grants on table identifiers | `GRANT SELECT ON analytics.events TO role_analyst` |
| **Column-level** | Column masking policies | PII columns (email, phone) masked for non-privileged roles |
| **Row-level** | Row filter policies attached to table | `WHERE region = current_user_region()` transparently applied |
| **Partition-level** | Access grants scoped to partition values | Finance team sees only `department = 'finance'` partitions |

### Credential Vending

The catalog acts as a **credential broker**: when a query engine needs to read data files, it requests scoped credentials from the catalog. The catalog:

1. Validates the engine's identity and the user's authorization.
2. Generates a temporary credential with permissions limited to the exact object-storage paths needed.
3. Returns the credential with a short TTL (15 minutes).
4. Logs the vending event for audit.

This prevents engines from holding long-lived, broadly-scoped storage credentials.

### Credential Vending Security Properties

| Property | Implementation | Failure Mode |
|:---|:---|:---|
| **Least privilege** | Credentials scoped to exact file paths needed for the query | Over-scoping exposes unrelated tables |
| **Short-lived** | 15-minute TTL; non-renewable | Clock skew > TTL allows reuse after expiry |
| **Audit trail** | Every vending event logged with user, scope, engine | Log gap creates compliance blind spot |
| **Revocation** | Credential can be invalidated before TTL via catalog API | Revocation latency allows brief unauthorized access |
| **Engine binding** | Credential tied to requesting engine's identity | Stolen credential usable from different engine |

### Cross-Engine Authorization Consistency

When multiple engines access the same table, authorization must be enforced at the **catalog level**, not the engine level. Otherwise, a less-restrictive engine becomes a bypass path.

| Approach | Mechanism | Trade-off |
|:---|:---|:---|
| **Catalog-enforced RBAC** | All access checks at catalog; engines receive only authorized file paths | Centralized; catalog becomes authorization Slowest part of the process |
| **Engine-enforced policies** | Each engine applies its own policy engine | Inconsistent enforcement risk; policy drift |
| **Policy-as-data** | Policies stored as catalog metadata; engines download and enforce locally | Consistent policies; enforcement depends on engine compliance |
| **View-based access** | Create engine-specific views with embedded row/column filters | Simple; but views must be maintained per policy change |

## Data Security

### Encryption at Rest

| Layer | Encryption | Key Management |
|:---|:---|:---|
| Object storage | Server-side encryption (AES-256-GCM) | Platform-managed keys with customer-managed key option |
| Metadata files | Same as data files (co-located on object storage) | Same key hierarchy |
| Catalog database | Transparent database encryption | Dedicated key, rotated quarterly |
| Local SSD cache | Full-disk encryption | Ephemeral keys destroyed on instance termination |

### Encryption in Transit

| Channel | Protocol | Notes |
|:---|:---|:---|
| Client → Query engine | TLS 1.3 | Certificate pinning for sensitive environments |
| Query engine → Catalog | TLS 1.3 or mTLS | mTLS recommended for service-to-service |
| Query engine → Object storage | HTTPS (TLS 1.3) | Enforced by storage policy; HTTP rejected |
| Catalog → Catalog replica | mTLS | Cross-AZ replication encrypted |

### PII Handling

| Classification | Examples | Handling |
|:---|:---|:---|
| Restricted | SSN, credit card numbers | Column-level encryption; access logged and alerted |
| Confidential | Email, phone, name | Column masking; accessible only to authorized roles |
| Internal | User IDs, session tokens | Standard encryption at rest and in transit |
| Public | Aggregated metrics, public timestamps | No special handling |

### Data Masking Techniques

| Technique | Application | Example |
|:---|:---|:---|
| Full redaction | Restricted columns for non-privileged users | `***-**-****` |
| Partial masking | Email addresses | `j***@example.com` |
| Tokenization | Columns used in joins but not displayed | Deterministic token replacing PII |
| Bucketing | Age, salary for analytics | `30-39` instead of exact age |

## Compliance

### GDPR Considerations

| Requirement | Implementation |
|:---|:---|
| Right to erasure | Delete specific rows via MoR delete files; compact to physically remove; vacuum expired snapshots containing the data |
| Right to access | Query by subject ID across all tables; export as portable format |
| Data minimization | Retention policies auto-expire partitions beyond defined periods |
| Consent tracking | Separate consent table with time-travel for audit |
| Cross-border transfers | Region-pinned tables; metadata includes data-residency tags |

**GDPR and time travel tension**: Time travel retains historical snapshots that may contain deleted user data. Mitigation: set snapshot retention shorter than the GDPR compliance window, and ensure vacuum physically removes files containing erased data.

### GDPR Erasure Workflow (Right to Be Forgotten)

```
1. Receive erasure request for subject_id = X
2. Query all tables containing subject_id column
3. For each table:
   a. Issue DELETE WHERE subject_id = X
      → CoW: rewrites affected files without subject X's rows
      → MoR: writes delete files marking subject X's rows
      → Deletion vectors: sets bits for subject X's row positions
4. Force compaction on affected partitions (MoR/DV only)
   → Physically rewrites base files, excluding deleted rows
5. Run vacuum with zero retention on affected snapshots
   → Removes old files that contained subject X's data
6. Verify: time-travel to any snapshot no longer returns subject X
7. Log erasure completion in compliance audit trail
```

**Critical timing**: Steps 4–5 must complete within the compliance window (typically 30 days under GDPR). Without forced compaction and vacuum, the data remains physically present in old files even after logical deletion.

### Data Sovereignty & Cross-Border Compliance

| Regulation | Requirement | Lakehouse Implementation |
|:---|:---|:---|
| **GDPR (EU)** | Data of EU residents must be processable within EU | Region-tagged tables; catalog enforces region for vended credentials |
| **CCPA (California)** | Right to know + right to delete | Subject access queries via snapshot; deletion via erasure workflow |
| **LGPD (Brazil)** | Similar to GDPR; data processing legal bases | Consent table with time-travel for audit |
| **PIPEDA (Canada)** | Consent-based data processing | Consent tracking integrated with ingestion pipeline |
| **China PIPL** | Data localization for Chinese citizen data | Dedicated region deployment; no cross-border replication for covered data |

### Data Residency Enforcement

```
Table Property: data_residency = "eu-west-1"

Catalog Behavior:
  - Commit: reject if any new file path is outside the allowed region prefix
  - Credential vending: refuse to vend credentials for storage in other regions
  - Replication: exclude residency-tagged tables from cross-region replication
  - Compaction: ensure compacted files are written to the same region as source files
```

### SOC 2 Considerations

| Control | Implementation |
|:---|:---|
| Access control | RBAC + fine-grained policies enforced at catalog layer |
| Audit logging | All catalog operations (reads, commits, grants) logged immutably |
| Encryption | At-rest and in-transit encryption for all data and metadata |
| Availability | Multi-AZ deployment with failover; uptime SLO ≥ 99.95% |
| Change management | Schema and partition evolution tracked in snapshot history |

### PCI-DSS Considerations

| Control | Implementation |
|:---|:---|
| Cardholder data isolation | Dedicated namespace with stricter access policies |
| Network segmentation | Query engines accessing PCI data run in isolated network segments |
| Audit trail | Immutable commit log with tamper-evident checksums |
| Key rotation | Encryption keys rotated every 90 days; re-encryption via compaction |

## Audit & Monitoring

### Audit Log Events

| Event | Details Captured |
|:---|:---|
| Table created / dropped | Who, when, schema, namespace |
| Snapshot committed | Who, operation type, files added/deleted, row counts |
| Schema evolved | Who, columns added/dropped/renamed, before/after schema |
| Access grant / revoke | Who granted, to whom, what scope |
| Credential vended | To whom, scope, TTL, requesting engine |
| Data accessed (query) | Who, which table, which partitions, rows scanned |
| Compaction / vacuum executed | Who triggered, partition, files affected |

### Audit Storage

- Audit logs written to a separate, append-only table in the lakehouse (self-hosted audit trail).
- Retention: minimum 1 year for SOC 2; 7 years for financial regulations.
- Access to audit tables restricted to security and compliance roles.
- Tamper detection: each audit entry includes a hash chain linking to the previous entry.

## Incident Response Playbooks

### Playbook 1: Credential Compromise (Catalog or Storage)

| Step | Action | Timeline |
|:---|:---|:---|
| 1 | Revoke compromised credentials immediately | 0–5 min |
| 2 | Rotate all credentials vended during the compromise window | 5–15 min |
| 3 | Audit: query catalog logs for all operations performed with compromised credential | 15–30 min |
| 4 | Assess: determine if any data was exfiltrated or modified | 30–60 min |
| 5 | If data modified: rollback affected tables to last known-good snapshot | 60–90 min |
| 6 | If data exfiltrated: notify affected data owners; begin breach notification process | 90+ min |
| 7 | Root cause analysis: how was the credential compromised? | 24 hours |

### Playbook 2: Snapshot Poisoning (Malicious Commit)

| Step | Action | Timeline |
|:---|:---|:---|
| 1 | Identify the malicious snapshot via audit log analysis | 0–15 min |
| 2 | Rollback table to the last known-good snapshot before the poisoned commit | 15–30 min |
| 3 | Quarantine the poisoned data files (do not delete — forensic evidence) | 30–45 min |
| 4 | Review all downstream consumers that read the poisoned snapshot | 45–60 min |
| 5 | Notify downstream teams; trigger re-computation from clean snapshot | 60+ min |
| 6 | Strengthen commit validation: add checksum verification for committed files | Post-incident |

### Playbook 3: Orphan File Data Exposure

| Step | Action | Timeline |
|:---|:---|:---|
| 1 | Identify orphan files via `remove_orphan_files` with dry-run | 0–30 min |
| 2 | Assess: do orphan files contain sensitive data? | 30–60 min |
| 3 | Delete orphan files with safety retention overridden (set to 0) | 60–90 min |
| 4 | Review: why did commits fail without cleanup? Fix writer error handling | Post-incident |
| 5 | Implement monitoring: alert when orphan file count exceeds threshold | Post-incident |

## Zero-Trust Architecture

| Principle | Implementation |
|:---|:---|
| **Never trust, always verify** | Every API call to catalog requires valid token; no ambient authority |
| **Least privilege** | Credentials scoped to exact file paths needed; minimum permissions per role |
| **Assume breach** | Audit all operations; detect anomalies in access patterns; rotate credentials aggressively |
| **Verify explicitly** | mTLS between all services; certificate validation on every connection |
| **Lateral movement prevention** | Compaction workers in isolated network segment; cannot access catalog admin APIs |

## Security Testing Requirements

| Test Type | Frequency | Scope | Pass Criteria |
|:---|:---|:---|:---|
| **Penetration testing** | Quarterly | Catalog API, credential vending, object storage access | No critical/high findings |
| **Access control audit** | Monthly | RBAC role assignments, column masking policies | No over-privileged accounts |
| **Credential rotation verification** | Weekly | Automated rotation of all service accounts | All credentials < 90 days old |
| **Encryption validation** | Monthly | At-rest and in-transit encryption on all channels | 100% encrypted; no TLS < 1.3 |
| **Data classification scan** | Weekly | Scan new columns for PII patterns | All PII columns masked for non-privileged roles |
| **Snapshot rollback security review** | On-demand | Verify rollback doesn't re-expose erased data | Erased data not accessible after rollback |

## Column-Level Encryption

### When Column-Level Encryption Is Needed

Standard object storage encryption (AES-256-GCM) protects data at rest but does not distinguish between columns. Any user with file-level access can read all columns. Column-level encryption adds per-column key management:

| Approach | Mechanism | Performance Impact | Use Case |
|:---|:---|:---|:---|
| **Application-level encryption** | Encrypt sensitive columns before Parquet serialization | ~5% write overhead; ~3% read overhead | PII columns in multi-tenant environments |
| **Format-level column encryption** | Parquet modular encryption (PME) — different keys per column group | ~8% overhead; transparent to application | Regulatory requirement for column-level protection |
| **Tokenization** | Replace PII with deterministic tokens; maintain mapping table | ~2% overhead | Columns used in joins but not displayed |

### Parquet Modular Encryption (PME) Properties

```
Parquet Modular Encryption:
  - Per-column keys: different encryption keys for different column groups
  - Footer encryption: encrypted footer hides schema information
  - Envelope encryption: column keys encrypted by a master key
  - Key rotation: re-encrypt the column key envelope without re-encrypting data
  - Access pattern: user needs both file access AND column key access to read
```

**Security improvement over file-level encryption**: A storage admin can copy files but cannot read encrypted columns without column-specific keys. This implements defense-in-depth — breaching the storage layer alone is insufficient for data access.

## Network Security Architecture

| Network Zone | Components | Ingress Rules | Egress Rules |
|:---|:---|:---|:---|
| **Public zone** | Load balancer, API gateway | HTTPS from client IPs | To catalog zone only |
| **Catalog zone** | Catalog service, credential vender | From API gateway, from engine zone | To object storage, to auth provider |
| **Engine zone** | Query engines, ingestion services | From catalog zone (metadata), from object storage (data) | To catalog zone, to object storage |
| **Compaction zone** | Compaction workers | From orchestrator | To object storage only (read/write data) |
| **Management zone** | Monitoring, logging, admin tools | From VPN only | To all zones (read-only metrics) |

## Data Classification and Tagging

### Automated PII Detection Pipeline

| Stage | Mechanism | Accuracy | Latency |
|:---|:---|:---|:---|
| **Schema-based heuristics** | Column name matching (email, ssn, phone, address) | 70% recall, 85% precision | < 1 ms per column |
| **Pattern matching (regex)** | Apply PII regex patterns to sampled data | 85% recall, 90% precision | ~100 ms per 1 000 rows |
| **ML classification** | Trained classifier on column statistics + sample values | 92% recall, 95% precision | ~500 ms per column |
| **Human review** | Flagged columns reviewed by data steward | 99% accuracy | Hours to days |

**Cascade**: Stage 1 runs on every new column at commit time. Stage 2 runs on columns not confidently classified. Stage 3 runs on ambiguous cases. Stage 4 for edge cases and policy decisions.

### Tag-Based Access Control

```
Table: customers
  Column: email    → tags: [PII, GDPR_PERSONAL, CONFIDENTIAL]
  Column: name     → tags: [PII, GDPR_PERSONAL, CONFIDENTIAL]
  Column: user_id  → tags: [INTERNAL]
  Column: created  → tags: [PUBLIC]

Policy: "role:analyst can read columns WHERE NOT tag:CONFIDENTIAL"
Effect: Analyst sees user_id and created; email and name are masked
```

## Compliance Automation

| Compliance Task | Manual Approach | Automated Lakehouse Approach | Improvement |
|:---|:---|:---|:---|
| GDPR erasure | Manual SQL DELETE + verification | Automated erasure workflow → compact → vacuum → verify | Hours → minutes |
| Data lineage for audit | Interview teams; trace manually | Snapshot history + manifest diffs provide automatic lineage | Days → seconds |
| Access control review | Spreadsheet-based role audit | Catalog RBAC export → automated policy analysis | Quarterly → continuous |
| Retention enforcement | Manual partition drops | Table lifecycle properties → auto-expire partitions | Error-prone → reliable |
| Cross-border compliance | Manual region checks | Catalog-enforced data residency tags | Reactive → proactive |

## Snapshot Rollback Security Implications

### The Data Resurrection Problem

Rolling back to a previous snapshot re-exposes data files that may have been logically deleted for compliance reasons.

| Scenario | Risk | Mitigation |
|:---|:---|:---|
| GDPR erasure followed by rollback | Deleted user data re-accessible | Catalog rejects rollback to snapshots predating an erasure event |
| PCI data removed, then snapshot cherry-picked | Cardholder data resurfaces | Snapshot tags block cherry-pick across erasure boundaries |
| Time-travel query to pre-deletion snapshot | Analyst sees deleted data | Access control on time-travel: restrict historical access for PII tables |
| Backup restore from pre-deletion state | Restored backup contains deleted data | Backup policy: exclude snapshots older than erasure events for compliance-tagged tables |

### Erasure-Safe Snapshot Management

```
Table property: compliance.erasure_events = [
    {subject_id: "user-123", erased_at: snapshot_S50, timestamp: "2025-03-15"},
    {subject_id: "user-456", erased_at: snapshot_S55, timestamp: "2025-03-18"}
]

Rollback policy:
  - REJECT rollback to snapshot < S50 (would re-expose user-123's data)
  - REJECT time-travel query to snapshot < S50 for tables tagged GDPR_PERSONAL
  - ALLOW time-travel to S50+ (post-erasure snapshots are safe)
```
