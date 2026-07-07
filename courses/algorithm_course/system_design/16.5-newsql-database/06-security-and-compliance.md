# Security & Compliance — NewSQL Database

## Authentication & Authorization

### Authentication Mechanisms

| Mechanism | Use Case | Implementation |
|-----------|----------|---------------|
| Username/Password | Human users, admin access | Scram-SHA-256 hashed credentials in system tables |
| Certificate-based (mTLS) | Service-to-service, inter-node | X.509 certificates with automatic rotation |
| OAuth 2.0 / OIDC | Application clients, SSO integration | JWT validation against external identity provider |
| LDAP / Active Directory | Enterprise directory integration | Delegated authentication to corporate IdP |
| Kerberos / GSSAPI | Enterprise environments | SPNEGO negotiation for transparent authentication |

### Authorization Model: SQL-Native RBAC

NewSQL databases use standard SQL GRANT/REVOKE semantics extended to distributed objects:

**Level 1: Cluster-Level Roles**

| Role | Permissions |
|------|------------|
| Admin | Full access: node management, zone configuration, user management |
| DBA | Database creation/deletion, backup/restore, schema changes |
| Developer | Read/write data, create indexes, view query plans |
| Read-only | SELECT on granted tables/views only |
| Monitoring | View cluster metrics, query statistics, range distribution |

**Level 2: Database and Table Grants**

```
-- Grant read access to specific tables
GRANT SELECT ON TABLE orders, accounts TO analyst_role;

-- Grant write access with column restrictions
GRANT INSERT, UPDATE (status, updated_at) ON TABLE orders TO service_role;

-- Revoke delete to prevent accidental data loss
REVOKE DELETE ON TABLE orders FROM service_role;

-- Grant schema change privileges to DBA
GRANT CREATE, ALTER, DROP ON DATABASE production TO dba_role;
```

**Level 3: Row-Level Security (RLS)**

```
-- Multi-tenant isolation: each tenant sees only their rows
CREATE POLICY tenant_isolation ON orders
  USING (tenant_id = current_setting('app.tenant_id')::INT);

-- Regional compliance: users see only their region's data
CREATE POLICY region_filter ON customers
  USING (region = current_setting('app.user_region'));
```

### Token Management

| Token Type | Lifetime | Refresh | Storage |
|-----------|----------|---------|---------|
| Session token | 1 hour | Via re-authentication | Server-side session table |
| JWT (OIDC) | 15 minutes | Via refresh token from IdP | Client-side |
| API key | 90 days | Manual rotation | Encrypted in system catalog |
| Node certificate | 1 year | Auto-rotation 30 days before expiry | On-disk, managed by cert manager |
| Inter-node auth token | 24 hours | Automatic via gossip protocol | In-memory |

---

## Data Security

### Encryption at Rest

| Component | Encryption | Key Management |
|-----------|-----------|----------------|
| LSM-tree SST files | AES-256-CTR | Per-store key, wrapped by a master key in external KMS |
| WAL | AES-256-CTR | Same store key as SST files |
| Raft log | AES-256-CTR | Same store key (persisted as WAL entries) |
| System catalog | AES-256-CTR | Separate system key |
| Backups | AES-256-GCM | Dedicated backup key in KMS |
| Temporary sort/join files | AES-256-CTR | Ephemeral key, destroyed on cleanup |

**Key hierarchy:**

```
External KMS (master key)
  └── Store encryption key (per-node, wrapped by master key)
        ├── SST file encryption (data at rest)
        ├── WAL encryption (crash recovery data)
        └── Raft log encryption (replication data)
```

### Encryption in Transit

| Connection | Protocol | Minimum Version |
|-----------|----------|----------------|
| Client → SQL gateway | TLS 1.3 | Required in production |
| SQL gateway → KV storage (intra-cluster) | mTLS | Required |
| Node → Node (Raft replication) | mTLS | Required |
| Node → Object storage (backup) | TLS 1.3 | Required |
| Admin console → cluster | TLS 1.3 | Required |

### PII Handling

| Data Category | Classification | Handling |
|--------------|---------------|---------|
| User data (name, email) | PII | Column-level encryption, row-level security |
| Financial data (balances, transactions) | Sensitive | Encryption at rest, audit logging on access |
| Query logs | May contain PII | Parameter redaction; log only query templates |
| Backup data | Contains all PII | Encrypted backups with separate key management |
| Raft log entries | Contains mutations | Encrypted in transit and at rest |

### Data Masking / Anonymization

| Technique | When Used |
|-----------|-----------|
| Column-level encryption | Encrypt specific sensitive columns (SSN, credit card) with application-managed keys |
| Dynamic data masking | Non-privileged roles see masked values (e.g., `****1234` for credit cards) |
| Query parameter redaction | Strip literal values from slow query logs, replacing with `$1`, `$2` placeholders |
| Anonymized exports | Replace identifiers with hash-based pseudonyms for analytics exports |

---

## Threat Model

### Top 5 Attack Vectors

#### 1. SQL Injection

**Threat:** Application constructs SQL queries by concatenating user input, allowing an attacker to inject malicious SQL (e.g., `'; DROP TABLE orders; --`).

**Impact:** Data exfiltration, data destruction, privilege escalation.

**Mitigation:**
- Parameterized queries enforced at the wire protocol level (prepared statements)
- SQL parser rejects multi-statement execution unless explicitly enabled
- Least-privilege roles: service accounts cannot execute DDL
- Query audit logging for anomaly detection

#### 2. Privilege Escalation via Cross-Tenant Access

**Threat:** In a multi-tenant deployment, a compromised tenant application accesses another tenant's data by bypassing row-level security.

**Impact:** Data breach across tenant boundaries.

**Mitigation:**
- Row-level security policies enforced at the SQL execution layer (not bypassable by raw KV access)
- Separate database or schema per tenant as defense-in-depth
- Regular audit of RLS policy correctness
- Tenant-scoped connection credentials that cannot override `tenant_id`

#### 3. Raft Log Replay Attack

**Threat:** An attacker with access to a node's disk captures Raft log entries and replays them on a rogue node to extract data.

**Impact:** Data exfiltration from replayed Raft entries.

**Mitigation:**
- Raft log encrypted at rest with per-node keys
- Raft group membership requires mutual TLS authentication — rogue nodes cannot join
- Raft log entries include epoch and term — stale entries are rejected
- Physical disk access requires OS-level security controls

#### 4. Denial of Service via Expensive Queries

**Threat:** A malicious or poorly written query scans the entire keyspace, consuming CPU, memory, and I/O across all nodes.

**Impact:** Cluster-wide performance degradation.

**Mitigation:**
- Statement timeout (default 30 seconds, configurable per session)
- Memory budget per query (default 256 MB, configurable)
- Admission control: limit concurrent full-table scans
- Cost-based query rejection: optimizer rejects queries with estimated cost above threshold
- Per-client rate limiting on QPS and bytes scanned

#### 5. Clock Manipulation Attack

**Threat:** An attacker manipulates the NTP source for a node, skewing its clock. This causes the node to assign incorrect timestamps, potentially allowing stale reads to appear fresh or creating transaction ordering anomalies.

**Impact:** Violation of serializable isolation guarantees.

**Mitigation:**
- Nodes monitor clock offset against cluster peers; self-quarantine if offset exceeds `max_clock_offset`
- Multiple independent NTP sources with cross-validation
- HLC protocol absorbs clock jumps without violating causal ordering
- Raft leader lease includes clock-bound checks

### Rate Limiting & DDoS Protection

| Layer | Mechanism |
|-------|-----------|
| Network | Connection rate limiting per IP |
| Transport | TLS handshake rate limiting |
| Application | Per-user/role QPS limits (token bucket) |
| Query | Admission control based on estimated query cost |
| Storage | Per-range write rate limiting to prevent Raft overload |

### Threat Severity Matrix

| Attack Vector | Probability | Impact | Detection Time | Overall Risk |
|---------------|------------|--------|---------------|-------------|
| SQL Injection | Medium | Critical | Seconds (query audit) | High |
| Cross-tenant access | Low | Critical | Minutes (RLS audit) | High |
| Raft log replay | Very low | High | Hours (disk access required) | Medium |
| DoS via expensive queries | High | Medium | Seconds (admission control) | High |
| Clock manipulation | Very low | High | Seconds (auto-quarantine) | Medium |
| Insider data exfiltration | Low | Critical | Hours (audit log review) | High |
| Compromised NTP source | Low | High | Minutes (cross-validation) | Medium |

---

## Multi-Tenant Security Model

### Isolation Levels

| Level | Mechanism | Overhead | Use Case |
|-------|-----------|----------|----------|
| **Shared database, RLS** | Row-level security policies filter by tenant_id | Lowest | SaaS with many small tenants |
| **Separate schemas** | Per-tenant schema with cross-schema access denied | Low | Moderate isolation requirement |
| **Separate databases** | Per-tenant database with RBAC | Medium | Regulated industries (finance, healthcare) |
| **Separate clusters** | Per-tenant cluster | Highest | Maximum isolation; compliance mandates |

### Tenant Isolation Invariants

1. **Query isolation:** A tenant's query can never return rows belonging to another tenant (enforced by RLS at SQL execution layer, not bypassable via raw KV)
2. **Resource isolation:** One tenant's workload cannot degrade another tenant's latency (enforced by per-tenant admission control queues)
3. **Storage isolation:** Tenant data can be pinned to specific regions for data residency compliance
4. **Audit isolation:** Each tenant's audit trail is independently queryable and exportable
5. **Encryption isolation:** Per-tenant encryption keys enable tenant-specific key rotation without affecting other tenants
6. **Backup isolation:** Per-tenant backup and restore without touching other tenants' data

---

## Certificate Lifecycle Management

| Certificate | Scope | Rotation Period | Rotation Method |
|-------------|-------|----------------|-----------------|
| Node certificate | Inter-node mTLS | 1 year | Auto-rotation via cert-manager; 30-day overlap window |
| Client CA certificate | Client authentication | 3 years | Manual rotation with dual-CA transition period |
| UI/Admin certificate | HTTPS for admin console | 1 year | Auto-rotation or external CA integration |
| KMS wrapping key | Master key for store encryption | 1 year | KMS-managed rotation; transparent re-wrapping |

### Audit Log Architecture

```
Audit events captured:
  1. Authentication: login success/failure, source IP, credentials used
  2. Authorization: GRANT/REVOKE operations, RLS policy changes
  3. Data access: SELECT on sensitive tables (configurable per-table)
  4. Data modification: INSERT/UPDATE/DELETE on audited tables
  5. Schema changes: CREATE/ALTER/DROP operations
  6. Administrative: node join/decommission, zone config changes, backup/restore

Storage:
  - Write-once append log (immutable after write)
  - Separate from user data storage (not tamperable by DBA)
  - Retained for 1 year minimum (compliance requirement)
  - Exportable in SIEM-compatible format (CEF, LEEF, JSON)

Performance impact:
  - Audit logging adds ~0.1ms per query (async write to audit log)
  - Storage overhead: ~100 bytes per audit event
  - At 200K QPS: ~20 MB/s audit log write rate → ~1.7 TB/day
  - Compression reduces to ~200 GB/day
```

---

## Compliance

### GDPR Considerations

| Requirement | Implementation |
|------------|---------------|
| Right to be forgotten | DELETE from all tables + MVCC garbage collection ensures versions are purged after GC window |
| Data portability | Export user data via standard SQL SELECT with structured output (CSV, JSON) |
| Consent management | Application-level consent tracking in a dedicated table with audit trail |
| Data minimization | Column-level encryption + row-level TTL for automatic data expiration |
| Processing records | Query audit log tracks all access to PII-tagged tables |
| Data residency | Zone configurations pin data to specific geographic regions |
| Cross-border transfers | Data never leaves configured region; leaseholder + replicas co-located |
| Breach notification | Audit log analysis identifies scope of breach within 24 hours for Article 72 compliance |

**GDPR Deletion Deep Dive:**

Deletion in a NewSQL database is not instantaneous due to MVCC:
1. `DELETE` statement creates a tombstone MVCC entry at the current timestamp
2. The original data remains as older MVCC versions until GC window expires (25+ hours)
3. After GC window: compaction physically removes the deleted versions from SST files
4. Backup copies must also be purged — requires backup rewrite or expiration
5. CDC consumers may have exported the data — downstream systems must also delete
6. Raft log entries containing the original write must age out of log retention

Total time from DELETE to complete physical removal: GC window + compaction cycle + backup retention. For a 25-hour GC window and 30-day backup retention, full physical deletion takes up to 31 days.

### SOC 2 Considerations

| Control | Implementation |
|---------|---------------|
| Access control | SQL RBAC with row-level security, certificate-based inter-node auth |
| Audit logging | Immutable audit log of all DDL, DML on sensitive tables, and admin operations |
| Encryption | At-rest (AES-256) and in-transit (TLS 1.3/mTLS) |
| Availability | 99.999% SLA with automatic failover and multi-AZ replication |
| Change management | Online schema changes with version tracking in system catalog |

### HIPAA Considerations

| Requirement | Implementation |
|------------|---------------|
| Access controls | Role-based access to PHI columns with audit logging |
| Encryption | Column-level encryption for PHI fields, encryption at rest for all data |
| Audit trail | Complete audit log of all access to tables containing PHI |
| Data integrity | ACID transactions prevent partial updates to health records |
| Disaster recovery | Cross-region replication with RPO=0, automated backup verification |

### PCI-DSS Considerations (Financial Workloads)

| Requirement | Implementation |
|------------|---------------|
| Cardholder data isolation | Separate database/schema for card data; dedicated encryption keys |
| Network segmentation | Database nodes in isolated network segment; mTLS for all connections |
| Access logging | All queries touching cardholder tables logged with user identity |
| Key management | AES-256 encryption keys rotated every 90 days via KMS |
| Vulnerability management | Automated CVE scanning of database binaries; patch within 30 days |
| Tokenization | Application-level tokenization; database stores tokens, not PANs |

---

## Advanced Threat Scenarios

### Scenario 1: Insider Threat — Privileged Database Administrator

**Threat:** A DBA with broad access exfiltrates sensitive data by running SELECT queries and extracting results.

**Mitigations:**
- Principle of least privilege: DBAs have schema management rights but not SELECT on sensitive tables
- All DBA queries logged to a tamper-evident audit system (separate from the database)
- Dynamic data masking: even privileged roles see masked PII unless a break-glass procedure is followed
- Break-glass access requires two-person approval and triggers immediate security review
- Query result size limits: SELECT queries returning >10,000 rows from sensitive tables trigger an alert

### Scenario 2: Supply Chain Attack — Compromised Dependency

**Threat:** A malicious update to the LSM-tree storage library introduces a backdoor that exfiltrates data during compaction.

**Mitigations:**
- Reproducible builds: all binary releases are built from source with cryptographic verification
- Dependency pinning: all third-party libraries pinned to specific commit hashes
- Binary attestation: signed build provenance certificates for every release
- Runtime integrity monitoring: eBPF-based system call monitoring detects unexpected network connections from database processes
- Air-gapped build pipeline: CI/CD system isolated from external package registries

### Scenario 3: Side-Channel Attack via Query Timing

**Threat:** An attacker measures query execution time to infer whether certain data exists (timing oracle attack). For example, a query that takes 1ms when a row exists and 0.5ms when it does not reveals existence information.

**Mitigations:**
- Constant-time comparison for authentication checks (password verification)
- Query result padding: add random delay (0-5ms) to query responses to mask timing signals
- Row-level security policies prevent unauthorized existence checks
- Rate limiting on repeated queries with varying predicates

---

## Incident Response: Data Breach Playbook

### Severity Classification

| Severity | Criteria | Response Time |
|----------|---------|---------------|
| **P1 — Critical** | Confirmed data exfiltration; unauthorized access to production data; key compromise | 15 minutes |
| **P2 — High** | Suspicious access pattern detected; failed authentication surge; audit log tampering | 1 hour |
| **P3 — Medium** | Vulnerability discovered; dependency CVE; configuration drift detected | 24 hours |

### Breach Response Flow

**Phase 1: Containment (0-30 minutes)**
1. Revoke compromised credentials immediately
2. If key compromise: rotate affected encryption keys via KMS
3. Block suspicious IP addresses at network level
4. Capture forensic snapshot of affected nodes (memory dump, process list, network connections)

**Phase 2: Assessment (30 minutes - 4 hours)**
1. Query audit logs: identify all queries executed by compromised credentials
2. Determine data scope: which tables, how many rows, which PII categories
3. Check for lateral movement: did the attacker escalate privileges or access other nodes?
4. Review Raft logs for unauthorized data modifications

**Phase 3: Eradication (4-24 hours)**
1. Patch the vulnerability that enabled access
2. Rotate all potentially compromised credentials (not just confirmed ones)
3. Re-encrypt affected data with new keys
4. Audit all RBAC policies for overly permissive grants

**Phase 4: Notification (24-72 hours)**
1. Notify affected users per GDPR Article 72 (72-hour window)
2. File regulatory notifications (state breach notification laws, GDPR supervisory authority)
3. Publish security advisory if vulnerability affects other users

**Phase 5: Post-Incident (1-2 weeks)**
1. Blameless post-mortem with timeline, root cause, and action items
2. Add detection rules for the observed attack pattern
3. Update threat model with new attack vector
4. Conduct tabletop exercise to verify updated response procedures
