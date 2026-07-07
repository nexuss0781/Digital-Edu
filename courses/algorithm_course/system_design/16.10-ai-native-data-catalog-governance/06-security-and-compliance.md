# Security & Compliance — AI-Native Data Catalog & Governance

## Threat Model

A data catalog is a high-value target because it contains the **map of all organizational data** — knowing what sensitive data exists and where it lives is precisely the information an attacker needs to plan a data exfiltration. Compromising the catalog also enables policy manipulation to remove masking rules or access controls.

### Attack Vectors

| # | Attack Vector | Risk Level | Description | Detection |
|---|--------------|------------|-------------|-----------|
| 1 | **Catalog enumeration** | Critical | An attacker with minimal catalog access discovers the existence and location of sensitive datasets by browsing metadata, even without access to the actual data | Anomalous search patterns (user browsing PII-tagged assets outside their domain) |
| 2 | **Policy manipulation** | Critical | An insider modifies or disables masking/access policies to expose sensitive columns to unauthorized users | Real-time alerting on all policy changes; separation of duties enforcement |
| 3 | **Classification poisoning** | High | An attacker deliberately mislabels columns (removing PII tags) to bypass tag-based governance policies | Classification override audit trail; alert on bulk tag removals |
| 4 | **NL-to-SQL injection** | High | A user crafts a natural language query that tricks the LLM into generating SQL that bypasses row filters or accesses restricted tables | SQL output validation; policy enforcement at query engine layer |
| 5 | **Connector credential theft** | High | Metadata connectors store credentials for 50+ data sources; compromising the credential store exposes all connected systems | Credential access logging; anomalous connector authentication patterns |
| 6 | **Lineage graph manipulation** | Medium | Falsifying lineage edges to obscure the true origin of data, hiding compliance violations | Lineage change audit trail; lineage integrity verification |
| 7 | **Search result inference** | Medium | Even without direct data access, search result metadata (column names, descriptions, tags) can reveal sensitive business information | Access-filtered search results; metadata visibility policies |
| 8 | **Connector supply chain attack** | High | Malicious or compromised third-party connector plugins inject false metadata or exfiltrate credentials | Connector code signing; sandboxed execution; credential isolation |
| 9 | **AI model prompt injection** | Medium | Adversarial text embedded in metadata descriptions (e.g., table descriptions) is ingested by the NL-to-SQL LLM, causing it to generate harmful SQL | Metadata sanitization before LLM context injection; output validation |
| 10 | **Metadata exfiltration via API** | Medium | An insider uses the catalog API to bulk-export metadata for competitive intelligence or to plan social engineering attacks | API rate limiting; bulk export monitoring; data loss prevention on metadata |

### Attack Surface by Component

| Component | Attack Surface | Key Risk | Primary Control |
|-----------|---------------|----------|----------------|
| API Gateway | HTTP endpoints | Unauthorized access, DDoS | Authentication, rate limiting |
| Search Service | Query interface | Enumeration, inference | Visibility-filtered results |
| Policy Service | Policy CRUD API | Privilege escalation | Separation of duties, approval workflows |
| Connectors | Source credentials | Credential theft, lateral movement | Short-lived tokens, vault integration |
| NL-to-SQL Engine | Natural language input | Prompt injection, SQL injection | Input sanitization, output validation |
| Classification Engine | ML model + data samples | Poisoning, false negatives | Model integrity checks, human review |
| Event Bus | Internal messaging | Event injection, replay attacks | Authentication, message signing |

---

## Authentication & Authorization

### Authentication

| Mechanism | Use Case | Token Lifetime |
|-----------|----------|---------------|
| **OIDC / SAML SSO** | All human users via corporate identity provider | Session-based (8-12 hours) |
| **API tokens (JWT)** | Service-to-service communication, CI/CD pipelines | Short-lived (1 hour) with refresh |
| **Service accounts** | Metadata connectors, classification workers, automation bots | Bound to specific workload identity |
| **mTLS** | Internal service mesh communication | Certificate-based (auto-rotated) |
| **AI agent tokens** | Programmatic catalog access by AI agents | Scoped, short-lived (15 min), audited |

### Authorization Model: Tag-Based ABAC

The platform uses **Attribute-Based Access Control (ABAC)** where access decisions are based on metadata tags rather than explicit per-asset permissions:

```
Policy Structure:
  WHEN entity.tags MATCH {sensitivity: "confidential"}
  AND user.attributes NOT MATCH {clearance: "L3", domain: entity.domain}
  THEN DENY access

  WHEN entity.tags MATCH {pii_type: ANY}
  AND user.attributes NOT MATCH {role: "data_steward"}
  THEN APPLY column_masking(sha256_hash)
```

### Access Control Layers

| Layer | Scope | Mechanism | Bypass Prevention |
|-------|-------|-----------|-------------------|
| **Catalog visibility** | Can the user see that this entity exists? | Domain-based access lists; search results filtered by visibility policies | Search index pre-filters by user's domain |
| **Metadata read** | Can the user see full metadata (description, lineage, quality)? | Role-based: data consumers see basic info; data stewards see full detail | API enforces field-level access control |
| **Data preview** | Can the user see sample data values? | Tag-based: PII columns show masked previews; non-PII shows real values | Masking applied server-side, never in client |
| **Policy management** | Can the user create/modify governance policies? | Admin role + domain scope; all policy changes require approval workflow | Dual-control: creator ≠ approver |
| **Classification override** | Can the user change auto-classification labels? | Data steward role + audit trail; overrides logged with justification | Mandatory justification field; review required for PII tag removal |
| **Bulk export** | Can the user export metadata in bulk? | Explicit export permission; rate-limited; monitored | DLP scanning on exports > 1000 entities |

### Privilege Escalation Prevention

- **Separation of duties:** The person who creates a policy cannot approve it. Policy changes require a different approver.
- **Tag immutability audit:** Auto-classified tags cannot be removed without explicit "classification override" permission and a logged justification.
- **Policy change alerting:** All policy modifications trigger real-time alerts to the security team.
- **Blast radius limits:** Policy changes are scoped to a domain; organization-wide policy changes require additional approval from the governance council.
- **Admin session recording:** All administrative actions are recorded with full context (who, what, when, why, from where).

---

## Data Security

### Encryption

| Layer | Mechanism | Key Management |
|-------|-----------|---------------|
| **In transit** | TLS 1.3 for all API and inter-service communication | Automated certificate rotation via service mesh |
| **At rest (metadata)** | AES-256 for metadata database and search index | Customer-managed keys (CMK) with key rotation every 90 days |
| **At rest (audit log)** | AES-256 on immutable object storage | Separate key from metadata store; write-once policy |
| **Connector credentials** | AES-256 with envelope encryption in secrets manager | Per-connector key; auto-rotation supported |
| **Data samples** | Encrypted in transit; never persisted at rest | Samples are ephemeral — used during classification, then discarded |
| **Vector embeddings** | AES-256 at rest in vector store | Same key management as metadata store |
| **LLM context** | Encrypted in transit to LLM provider | No persistent storage of prompts by provider (contractual requirement) |

### Credential Vending for Connectors

Connectors do not store long-lived credentials. Instead:

1. Connector authenticates to catalog's credential service using its service account (workload identity)
2. Credential service issues a **short-lived token** (15-minute TTL) scoped to specific metadata operations (read-only schema, query log access)
3. Token is used to connect to the data source
4. Token expires automatically — even if intercepted, the window of exploitation is minimal
5. All credential vends are logged with connector identity, source system, and requested scope

### Connector Security Sandboxing

Each connector runs in an isolated environment to prevent a compromised connector from affecting other connectors or the catalog core:

| Control | Mechanism | Purpose |
|---------|-----------|---------|
| **Process isolation** | Separate container per connector | Prevent lateral movement |
| **Network policy** | Connector can only reach its assigned data source + event bus | Prevent unauthorized scanning |
| **Credential scope** | Each connector receives only its own source credentials | Limit blast radius of credential theft |
| **Code signing** | Connector images are signed and verified before deployment | Prevent supply chain attacks |
| **Resource limits** | CPU, memory, and network bandwidth caps per connector | Prevent resource exhaustion attacks |
| **Egress monitoring** | All outbound traffic logged and analyzed | Detect data exfiltration attempts |

### PII Protection in the Catalog Itself

The catalog contains metadata about PII but may also display PII in:
- **Column sample values** in search results
- **NL-to-SQL query results** that return actual data
- **Data preview** panels in the UI

**Mitigation:**
- Sample values pass through the policy engine before display — PII-tagged columns show masked samples
- NL-to-SQL results are filtered through the same masking/row-filter policies as direct SQL access
- Classification tags in search results show the presence of PII (e.g., "Contains: PII:email") without exposing actual values
- Data previews are generated server-side with masking applied; the client never receives unmasked PII

---

## NL-to-SQL Security

### Threat-Specific Controls

| Threat | Control | Implementation |
|--------|---------|----------------|
| **Prompt injection** | Input sanitization | Strip control characters, HTML, and known injection patterns from user questions |
| **SQL injection via LLM** | Output validation | Parse generated SQL; reject non-SELECT statements; validate against schema |
| **Schema enumeration** | Context filtering | LLM context includes only tables the user has permission to see |
| **Data exfiltration** | Read-only enforcement | All NL-to-SQL queries execute via read-only database connection with row limits |
| **Indirect injection** | Metadata sanitization | Escape metadata descriptions before including in LLM prompt context |
| **Excessive resource use** | Query complexity limits | Reject generated SQL with > 10 joins, > 3 subqueries, or no LIMIT clause |

### LLM Provider Security Requirements

| Requirement | Justification |
|-------------|---------------|
| No training on customer data | Catalog metadata is confidential; must not leak into model weights |
| No prompt logging beyond session | Queries may contain business-sensitive context |
| SOC 2 Type II compliance | Provider must meet enterprise security standards |
| Data residency options | LLM inference must occur within specified jurisdictions |
| Encryption in transit (TLS 1.3) | Prompts contain schema metadata including PII-related tags |

---

## Compliance

### GDPR

| Requirement | Implementation |
|-------------|----------------|
| **Right to erasure** | Lineage graph enables tracing all downstream copies of a user's data; erasure workflow propagates deletion requests through the lineage chain |
| **Data minimization** | Quality scoring flags datasets with excessive PII collection; automated recommendations to minimize |
| **Processing records** | Audit log maintains a complete record of who accessed what data, when, and for what purpose |
| **Data protection impact assessment** | Impact analysis API shows all downstream uses of a PII-containing dataset, automating DPIA documentation |
| **Consent tracking** | Tags record consent basis per dataset; policies enforce access restrictions based on consent status |
| **Cross-border transfer tracking** | Data residency metadata tracks physical location of data; policies enforce jurisdictional access rules |

### EU AI Act (High-Risk AI Systems)

| Requirement (Article 10) | Implementation |
|--------------------------|----------------|
| **Training data documentation** | Catalog stores dataset provenance, collection methodology, statistical properties, and fitness-for-purpose assessments |
| **Bias detection and mitigation** | Classification engine extends to detect demographic attributes; bias metrics (representation, distribution, fairness) stored as first-class metadata |
| **Data quality for AI** | Quality scoring includes AI-specific dimensions: representativeness, label accuracy, temporal relevance |
| **Conformity assessment support** | Catalog generates compliance reports: "For AI system X, here is the complete training data lineage, bias assessment, and governance documentation" |
| **Human oversight documentation** | Audit log tracks all human review decisions in the classification and policy approval workflows |

**EU AI Act compliance timeline:**

| Deadline | Requirement | Catalog Impact |
|----------|-------------|----------------|
| February 2025 | Prohibited AI practices | Catalog must flag datasets used in prohibited AI applications |
| August 2025 | General-purpose AI obligations | Track which datasets feed general-purpose models; document training data |
| August 2026 | High-risk AI system obligations | Full bias metadata, provenance tracking, conformity assessment support |

### SOC 2

| Control | Implementation |
|---------|----------------|
| **Access control (CC6)** | ABAC policies with tag-based enforcement; all access decisions logged |
| **Change management (CC8)** | Policy changes require approval workflow; full version history maintained |
| **Monitoring (CC7)** | Real-time alerting on policy violations, unauthorized access attempts, classification overrides |
| **Risk assessment (CC3)** | Auto-classification continuously assesses data sensitivity; quality scoring identifies data risk |
| **Logical and physical access (CC6.1)** | mTLS between services; network segmentation; connector sandboxing |

### HIPAA (Healthcare Data)

| Safeguard | Implementation |
|-----------|----------------|
| **Access controls** | PHI-tagged columns require explicit "healthcare_role" attribute; auto-masking for all other users |
| **Audit controls** | Every metadata access to PHI-tagged entities is logged with user, timestamp, and purpose |
| **Integrity controls** | Classification of PHI columns cannot be overridden without compliance officer approval |
| **Transmission security** | All API communication encrypted via TLS 1.3; mTLS between internal services |
| **Minimum necessary** | Policy engine enforces minimum necessary access: users see only the PHI columns required for their role |

### Data Sovereignty & Cross-Border Requirements

| Requirement | Implementation |
|-------------|----------------|
| **Data residency tracking** | Every entity tagged with physical storage region; lineage tracks cross-border data movement |
| **Jurisdictional access control** | Policies enforce that users in region X can only access metadata tagged for region X |
| **Cross-border lineage alerts** | When lineage reveals data flowing across jurisdictional boundaries, alert compliance team |
| **Regional catalog federation** | For strict sovereignty, deploy independent catalog instances per region with federated search |
| **Metadata localization** | PII-derived tags (which reveal the existence of PII) treated as sensitive — not replicated across regions |

### NIST AI Risk Management Framework (AI RMF)

| Function | Implementation |
|----------|----------------|
| **GOVERN** | Catalog stores AI governance policies; tracks accountability for datasets used in AI |
| **MAP** | Lineage traces data from collection through feature engineering to model training |
| **MEASURE** | Quality scoring includes AI-specific dimensions: bias, representativeness, label accuracy |
| **MANAGE** | Active metadata triggers alerts when datasets used in AI systems show quality degradation or bias drift |

### PCI DSS (Payment Card Data)

| Requirement | Implementation |
|-------------|----------------|
| **Cardholder data identification** | Auto-classification detects PAN, CVV, expiry patterns with high-confidence regex |
| **Access restriction** | PCI-tagged columns accessible only to users with "pci_handler" role |
| **Encryption** | PCI data samples never stored; masking applied before any display |
| **Audit trail** | All access to PCI-tagged metadata entities logged with full context |
| **Segmentation** | PCI-related metadata can be isolated in a dedicated domain with stricter policies |

---

## Audit Logging

### What Is Logged

| Event Category | Examples | Retention | Immutability |
|---------------|----------|-----------|-------------|
| **Access events** | Search queries, entity views, lineage traversals, data previews | 2 years | Append-only |
| **Policy events** | Policy creation, modification, deletion, evaluation results | 7 years | WORM storage |
| **Classification events** | Auto-classification results, manual overrides, confidence changes | 7 years | WORM storage |
| **Admin events** | User management, connector configuration, domain changes | 7 years | WORM storage |
| **NL-to-SQL events** | Natural language queries, generated SQL, execution context | 2 years | Append-only |
| **AI agent events** | Agent identification, API calls, datasets accessed, purposes declared | 7 years | WORM storage |
| **Data contract events** | Contract creation, violation detection, SLO breaches | 5 years | Append-only |

### Audit Log Architecture

```
Audit events → Append-only write → Immutable object storage
                                         │
                                    ┌─────▼─────┐
                                    │ Compliance │
                                    │ Query      │
                                    │ Engine     │
                                    └────────────┘
```

- **Immutability:** Audit logs are written to object storage with a write-once-read-many (WORM) policy. No event can be modified or deleted after writing.
- **Tamper detection:** Each log entry includes a hash chain (hash of current entry includes hash of previous entry). Breaking the chain is detectable.
- **Compliance queries:** "Show all users who accessed PII-tagged entities in the commerce domain in Q1 2026" runs against the audit index in seconds.
- **Export for regulators:** Audit logs can be exported in standardized formats (JSON, CSV) with cryptographic proof of completeness and integrity.

### Incident Response Playbooks

**Playbook 1: Suspected Classification Poisoning**
1. Alert triggered: Bulk PII tags removed by single user
2. Immediately re-apply tags from last known good state (event-sourced rollback)
3. Freeze classification override permissions for the suspect user
4. Investigate: Was this a legitimate steward activity or unauthorized?
5. If malicious: revoke access, file security incident, full classification re-scan of affected assets

**Playbook 2: Connector Credential Compromise**
1. Alert triggered: Connector credential used from unexpected IP or at unusual time
2. Immediately rotate the compromised credential
3. Audit all metadata operations performed by the connector in the last 24 hours
4. Check for unauthorized metadata modifications (lineage tampering, tag removal)
5. Re-crawl affected source to verify metadata integrity

**Playbook 3: NL-to-SQL Prompt Injection Detected**
1. Alert triggered: Generated SQL contains non-SELECT statement or accesses restricted tables
2. Block the query from execution
3. Log the original natural language input and generated SQL for investigation
4. Temporarily restrict the user's NL-to-SQL access
5. Review and update input sanitization rules

### Zero-Trust Architecture for Catalog

The data catalog implements zero-trust principles across all layers:

| Principle | Implementation |
|-----------|----------------|
| **Never trust, always verify** | Every API call authenticated via JWT; no implicit trust between services |
| **Least privilege access** | Connectors receive only read-only metadata access; no data-level permissions |
| **Micro-segmentation** | Each service has its own network policy; connectors isolated per source |
| **Continuous verification** | JWT tokens expire every hour; re-authentication required |
| **Assume breach** | All internal service communication logged; anomaly detection on internal traffic |
| **Encrypt everything** | TLS 1.3 everywhere, including internal service mesh; at-rest encryption for all stores |

### Security Testing Requirements

| Test Type | Frequency | Scope |
|-----------|-----------|-------|
| Penetration test (external) | Annually | API Gateway, auth flows, public endpoints |
| Penetration test (internal) | Annually | Service-to-service, privilege escalation |
| NL-to-SQL injection testing | Quarterly | Adversarial prompt testing against LLM pipeline |
| Connector security audit | Per new connector | Credential handling, data access scope, sandboxing |
| Classification poisoning test | Quarterly | Attempt to manipulate tags via adversarial metadata |
| Dependency vulnerability scan | Weekly (automated) | All container images and library dependencies |
| Access control review | Quarterly | Review ABAC policies for over-permissive rules |

### Audit Log Capacity

| Metric | Value | Notes |
|--------|-------|-------|
| Events per day | ~2M | Access + policy + classification events |
| Average event size | 500 bytes | Structured JSON with context |
| Daily storage | ~1 GB | Before compression |
| Compressed storage | ~200 MB/day | ~5x compression ratio |
| Annual storage | ~73 GB | Compressed, before long-term tier |
| 7-year retention (policy events) | ~500 GB | Tiered: hot (90 days) → warm (1 year) → cold (7 years) |

---

## AI-Specific Security Considerations

### LLM Data Handling Lifecycle

The catalog interacts with LLMs in two ways: NL-to-SQL query generation and classification disambiguation. Both require sending metadata to the LLM provider.

```
Data flow: Catalog → LLM Provider → Catalog

What is sent to LLM:
  - Table names and qualified paths
  - Column names and descriptions
  - Sample values (masked for PII-tagged columns)
  - Business glossary terms
  - User's natural language question

What is NOT sent:
  - Actual data values (beyond masked samples)
  - Connector credentials
  - User identity details
  - Policy definitions (these are evaluated catalog-side)
```

### AI Agent Access Controls

AI agents present unique security challenges because they operate autonomously:

| Control | Purpose | Implementation |
|---------|---------|----------------|
| **Agent registration** | Only approved agents can access catalog | Agent must be registered with unique agent_id; API key scoped to agent |
| **Purpose declaration** | Audit why agent accesses metadata | Each API call must include a `purpose` field |
| **Scope limits** | Prevent over-broad discovery | Agent access scoped to specific domains; cannot browse entire catalog |
| **Rate limiting** | Prevent abusive patterns | Per-agent rate limits (e.g., 1000 API calls/hour) |
| **Anomaly detection** | Detect compromised agents | Monitor for unusual access patterns (new domains, bulk export) |
| **Kill switch** | Immediately revoke agent access | Admin can disable any agent token instantly |

### Classification Model Security

The classification model itself is a security asset — it contains learned patterns for detecting PII:

| Threat | Mitigation |
|--------|------------|
| Model theft (extract classification patterns) | Model served via API only; no direct model file access |
| Model poisoning (adversarial training data) | Human review of classification feedback before model retraining; minimum 100 reviews per retrain cycle |
| Model inversion (reconstruct training data) | Training data includes only patterns, not actual PII values; differential privacy applied during training |
| Model evasion (format data to avoid classification) | Multi-stage classification (regex + NER + LLM) makes evasion difficult; adversarial testing quarterly |
