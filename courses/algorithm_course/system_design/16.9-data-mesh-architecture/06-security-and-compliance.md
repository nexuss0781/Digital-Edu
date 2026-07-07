# Security & Compliance — Data Mesh Architecture

## Authentication & Authorization

### Authentication Mechanisms

| Mechanism | Use Case | Implementation |
|-----------|----------|---------------|
| OAuth 2.0 / OIDC | Human consumers, analyst access | JWT validation against corporate identity provider |
| Service Tokens | Domain pipelines, automated consumers | Short-lived tokens issued per data product access grant |
| mTLS | Platform service-to-service communication | Certificate-based mutual authentication between platform components |
| API Keys | External partner access, third-party integrations | Scoped keys with per-product access limits |
| SAML | Enterprise SSO integration | Federated identity with corporate directory |

### Authorization Model: Federated Data Product Access Control

Data mesh authorization is more complex than traditional database access control because ownership is distributed: each data product has its own access policy defined by the domain team, but global policies set minimum security standards that all products must satisfy.

**Level 1: Platform-Level RBAC**

| Role | Permissions |
|------|------------|
| Platform Admin | Full access: platform configuration, global policies, user management |
| Governance Council | Create/modify global policies, review compliance reports |
| Domain Admin | Manage domain-level policies, approve access requests for domain products |
| Data Product Owner | Define access policies for owned products, publish/deprecate products |
| Data Consumer | Discover products, request access, query accessible products |
| Auditor | Read-only access to all metadata, governance results, and audit logs |

**Level 2: Data Product Access Policies**

Each data product declares its access policy as part of the product descriptor:

```
access_policy:
  default: DENY
  rules:
    - principal: "team:sales-analytics"
      access: READ
      purpose: "Customer segmentation"
      expires: "2027-01-01"
    - principal: "role:data-scientist"
      access: READ
      columns: ["customer_id", "ltv_score"]  # column-level restriction
      purpose: "Model training"
    - principal: "team:finance"
      access: READ
      conditions:
        - "request.purpose IN ['reporting', 'audit']"
      approval: OWNER  # requires owner approval
```

**Level 3: Column-Level Access Control**

Fine-grained access restricts which columns a consumer can read:

```
// Consumer with full access sees:
customer_id | name         | email              | ltv_score | ssn
C001        | Alice Smith  | alice@company.com  | 15000     | 123-45-6789

// Consumer with restricted access (no PII columns) sees:
customer_id | ltv_score
C001        | 15000
```

**Level 4: Row-Level Filtering (Purpose-Based)**

```
// Regional manager sees only their region's data
access_policy:
  rules:
    - principal: "user:regional_mgr_west"
      access: READ
      row_filter: "region = 'WEST'"
```

### Token Management

| Token Type | Lifetime | Refresh | Storage |
|-----------|----------|---------|---------|
| Consumer access token (JWT) | 1 hour | Via OIDC refresh flow | Client-side |
| Service pipeline token | 24 hours | Auto-rotation by platform | Secure vault |
| API key | 90 days | Manual or auto-rotation | Server-side encrypted store |
| Data product access grant | Defined per grant (30-365 days) | Re-request required | Platform access control service |

---

## Data Security

### Encryption at Rest

| Component | Encryption | Key Management |
|-----------|-----------|----------------|
| Platform metadata store | AES-256-GCM | Platform-managed key via external KMS |
| Lineage graph store | AES-256-GCM | Platform-managed key |
| Search index | AES-256-GCM | Platform-managed key |
| Data products | AES-256-GCM (minimum) | Domain-managed keys (platform provides KMS integration) |
| Governance policy store | AES-256-GCM | Platform-managed key |
| Audit logs | AES-256-GCM | Separate audit key with restricted access |

**Data product encryption responsibility:** The platform provides encryption templates and KMS integration, but the domain team manages the encryption keys for their data products. This preserves domain ownership while ensuring a minimum encryption standard is enforced by governance policies.

### Encryption in Transit

| Connection | Protocol | Minimum Version |
|-----------|----------|----------------|
| Consumer → Platform API | TLS 1.3 | Required |
| Platform → Domain storage | mTLS | Required |
| Platform service → Platform service | mTLS | Required |
| Federated query engine → Domain storage | mTLS | Required |
| Event bus → Consumers | TLS 1.3 | Required |

### PII Handling

| Data Category | Classification | Handling |
|--------------|---------------|---------|
| Direct identifiers (name, email, SSN) | PII-HIGH | Column-level access control; encryption at rest; masking for non-privileged consumers |
| Indirect identifiers (ZIP code, age range) | PII-MEDIUM | Access control; aggregation for analytics exports |
| Behavioral data (purchase history) | PII-LOW | Access control; anonymization for cross-domain sharing |
| Aggregated metrics (domain KPIs) | NON-PII | Standard access control; no masking required |

### Data Masking / Anonymization

| Technique | When Used |
|-----------|-----------|
| Column masking | Non-privileged consumers see masked values (email → a***@company.com) |
| Tokenization | Replace PII with reversible tokens for cross-domain joining without exposing raw PII |
| k-Anonymization | Aggregated data products ensure no individual can be identified from quasi-identifiers |
| Differential privacy | Noise injection for analytics data products shared broadly |
| Purpose-based access | Different masking levels based on declared purpose of use |

---

## Threat Model

### Top 5 Attack Vectors

#### 1. Data Product Poisoning

**Threat:** A compromised domain team (or a malicious insider) publishes a data product with intentionally corrupted data — correct schema but incorrect values. Downstream consumers and automated pipelines ingest bad data, causing incorrect business decisions.

**Impact:** Silent data corruption across the mesh; trust erosion in the data mesh as a whole.

**Mitigation:**
- Quality rules in data contracts (range checks, statistical distribution validation, referential integrity)
- Anomaly detection on published data (significant deviation from historical patterns triggers alert)
- Consumer-side contract validation (consumers verify incoming data against the contract before ingesting)
- Audit trail of all published versions with rollback capability

#### 2. Cross-Domain Privilege Escalation

**Threat:** A consumer with access to Domain A's product discovers that Domain A's product contains a foreign key to Domain B's product. By joining through the federated query engine, the consumer accesses Domain B data that they were not explicitly granted access to.

**Impact:** Unauthorized data access through transitive joins.

**Mitigation:**
- Access control evaluated per data product in federated queries (access to Domain A does not grant access to Domain B)
- Federated query engine checks authorization for each source before executing subqueries
- Join-path audit: log all cross-domain joins for compliance review
- Access policies can declare "no-join" restrictions preventing their product from being joined with specific other products

#### 3. Governance Policy Bypass

**Threat:** A domain team discovers a way to publish data outside the governed pipeline — for example, directly writing to object storage and sharing the path with consumers, bypassing contract validation and governance checks.

**Impact:** Ungovened data enters the organization's decision-making process.

**Mitigation:**
- Network-level controls: only the publishing pipeline has write access to the data product storage locations
- Observability layer detects data movement outside governed channels
- Executive KPIs track "mesh coverage" — percentage of known analytical data registered as governed products
- Cultural incentives: make it easier to publish through the mesh than to bypass it

#### 4. Metadata Store Compromise

**Threat:** An attacker gains access to the metadata store, which contains the complete catalog of all data products, their schemas, owners, and access policies. This is an intelligence goldmine for understanding the organization's data assets.

**Impact:** Exposure of organizational data architecture; ability to craft targeted data access attacks.

**Mitigation:**
- Metadata store encrypted at rest and in transit
- Access to metadata store restricted to platform service accounts only (no direct human access)
- All metadata access logged and auditable
- Metadata store in private network segment, not accessible from corporate network

#### 5. Stale Access Grant Exploitation

**Threat:** A consumer's role changes (leaves team, changes department) but their data product access grants are not revoked, allowing continued access to data products they no longer have legitimate need for.

**Impact:** Data access beyond authorized scope; compliance violation.

**Mitigation:**
- Access grants have mandatory expiration dates (maximum 365 days)
- Integration with corporate identity provider: role changes trigger access review
- Periodic access certification: product owners review and re-certify consumer access quarterly
- Automated detection of unused access grants (no queries in 90 days → alert to owner)

### Rate Limiting & Abuse Protection

| Layer | Mechanism |
|-------|-----------|
| Network | Connection rate limiting at load balancer |
| API | Per-consumer rate limiting (token bucket) |
| Query | Cost-based admission control for federated queries |
| Publishing | Per-domain rate limiting to prevent catalog flooding |
| Discovery | Search rate limiting to prevent catalog scraping |

---

## Compliance

### GDPR Considerations

| Requirement | Implementation |
|------------|---------------|
| Right to be forgotten | Lineage-driven deletion: identify all data products containing the individual's data via lineage graph, notify all product owners to purge records |
| Data portability | Export individual's data across all data products via lineage traversal and cross-domain query |
| Consent management | Consent modeled as a data product ("Consent Registry" in the Legal domain) consumed by access control |
| Data minimization | Governance policy enforces purpose declaration on access grants; unused access auto-expires |
| Processing records | Complete audit log of who accessed which data products, when, and for what declared purpose |
| Data residency | Data product descriptors declare storage region; governance policy enforces residency rules |

### SOC 2 Considerations

| Control | Implementation |
|---------|---------------|
| Access control | Multi-level RBAC with product-level, column-level, and row-level restrictions |
| Audit logging | Immutable audit log of all data product access, publishing, and governance events |
| Encryption | At-rest (AES-256) and in-transit (TLS 1.3/mTLS) for all platform and data product storage |
| Change management | All governance policy changes version-controlled; data product schema changes validated against contracts |
| Availability | Platform SLA with automated failover and domain-independent fault isolation |

### Data Mesh-Specific Compliance Challenges

| Challenge | Description | Solution |
|-----------|-------------|----------|
| Distributed ownership of PII | PII exists in data products across many domains; no single team controls all PII | Governance policy requires PII classification at publish time; lineage tracks PII propagation across domains |
| Cross-domain data lineage for audits | Auditors need end-to-end lineage that spans domain boundaries | Lineage graph maintains cross-domain edges; compliance reports generated from lineage traversal |
| Consistent retention policies | Different domains may retain data for different periods | Global governance policy sets minimum/maximum retention by data classification; domain policies refine within bounds |
| Right to deletion across domains | A GDPR deletion request must propagate to all domains holding the individual's data | Automated deletion workflow: lineage graph identifies all affected products → deletion request dispatched to each domain owner → confirmation tracked centrally |

### HIPAA Considerations (Healthcare Data Mesh)

| Requirement | Implementation |
|------------|---------------|
| Minimum necessary access | Purpose-based access policies enforce that consumers only access fields necessary for their declared purpose |
| Business associate agreements | Data contract includes BAA terms when product contains PHI; contract validation verifies BAA coverage |
| Access audit trail | Complete audit log of all PHI data product access with consumer identity, purpose, fields accessed, and timestamp |
| Breach notification | Automated breach detection workflow: anomalous access patterns trigger security investigation and notification pipeline |
| De-identification | Governance policy enforces Safe Harbor or Expert Determination de-identification before cross-domain PHI sharing |

### CCPA/CPRA Considerations

| Requirement | Implementation |
|------------|---------------|
| Right to know | Consumer identity linked to data products via lineage; "consumer data report" aggregates all data held across domains |
| Right to delete | Same mechanism as GDPR right to deletion with California-specific scope rules |
| Do Not Sell | "Sale" flag on data products; governance policy blocks cross-domain sharing of flagged products for opted-out consumers |
| Data minimization | Access grants must declare purpose and duration; unused grants auto-expire |

---

## Zero-Trust Security Model for Data Mesh

### Principles

| Principle | Application to Data Mesh |
|-----------|-------------------------|
| Never trust, always verify | Every federated query validates access at the product level; no implicit trust from domain membership |
| Least privilege | Access grants limited to specific columns and rows; no blanket domain-wide access |
| Assume breach | Encryption at rest and in transit; comprehensive audit logging; anomaly detection on access patterns |
| Verify explicitly | Every request carries identity proof (JWT/mTLS); access decisions logged and auditable |
| Micro-segmentation | Each data product is a security boundary; access to one product does not imply access to any other |

### Zero-Trust Architecture for Federated Queries

```
FUNCTION zero_trust_query_evaluation(consumer_identity, query):
    // Step 1: Verify identity (never trust)
    identity = verify_token(consumer_identity.token)
    IF NOT identity.valid:
        RETURN DENY("Invalid or expired identity token")

    // Step 2: For EACH product in the query, verify access independently
    products = parse_accessed_products(query)
    FOR EACH product IN products:
        access = evaluate_access(identity, product.id, query.context)
        IF access.decision == DENY:
            RETURN DENY("Access denied to " + product.id + ": " + access.reason)
        IF access.decision == PARTIAL:
            query = apply_column_restrictions(query, product.id, access.allowed_columns)

    // Step 3: Verify cross-product composition is permitted
    FOR EACH (product_a, product_b) IN combinations(products, 2):
        IF has_no_join_restriction(product_a, product_b):
            RETURN DENY("Join between " + product_a.id + " and " + product_b.id + " is restricted")

    // Step 4: Apply row filters per product
    FOR EACH product IN products:
        IF product.access.row_filter:
            query = inject_row_filter(query, product.id, product.access.row_filter)

    // Step 5: Log the authorized query for audit
    audit_log.record({
        consumer: identity,
        query: query.anonymized(),
        products_accessed: products,
        access_decisions: access_results,
        timestamp: current_timestamp()
    })

    RETURN ALLOW(query)
```

### Data Product Security Classification

| Classification | Definition | Access Requirements | Monitoring |
|---------------|-----------|-------------------|------------|
| **PUBLIC** | Non-sensitive aggregated data | Any authenticated consumer | Standard audit log |
| **INTERNAL** | Business-sensitive but not regulated | Team-level access with purpose declaration | Periodic access review |
| **CONFIDENTIAL** | Customer PII, financial data | Individual-level access with owner approval and expiration | Real-time anomaly detection |
| **RESTRICTED** | Regulated data (PHI, PCI, classified) | Individual access with compliance approval, mandatory encryption, purpose-limited | Real-time alerting on every access |

### Supply Chain Security for Data Products

| Threat | Description | Mitigation |
|--------|-------------|------------|
| Upstream poisoning | A compromised upstream data product injects malicious data that propagates through the lineage graph | Anomaly detection at consumer ingestion; contract-level data validation; hash-based integrity checking |
| Dependency hijacking | An attacker creates a data product with a similar name to a popular product, tricking consumers into connecting to the wrong source | Product URN-based addressing (not name-based); governance policy flags similarly-named products for manual review |
| Schema injection | A malicious field name containing SQL injection payload is registered in a data product schema | Input sanitization in all schema registration; parameterized queries in federated engine; field name validation policy |
| Privilege accumulation | A consumer gradually acquires access to many products, eventually able to reconstruct sensitive insights from combination | Maximum concurrent access grants per consumer; periodic access review; composition risk analysis |

---

## Compliance Automation

### Compliance-as-Code Framework

```
FUNCTION generate_compliance_report(regulation, time_period):
    report = ComplianceReport(regulation, time_period)

    IF regulation == "GDPR":
        // Article 30: Records of processing activities
        report.processing_records = query_audit_log(time_period)

        // Article 35: Data Protection Impact Assessment
        FOR EACH product IN catalog.products_with_pii():
            report.impact_assessments.add({
                product: product,
                pii_fields: product.pii_classifications,
                access_grants: get_active_grants(product.id),
                cross_domain_sharing: lineage.get_cross_domain_consumers(product.id)
            })

        // Article 17: Right to erasure readiness
        report.deletion_readiness = {
            products_with_pii: catalog.products_with_pii().count(),
            products_with_deletion_capability: catalog.products_with_deletion_api().count(),
            coverage: deletion_capable / total_pii_products
        }

    ELSE IF regulation == "SOC2":
        report.access_controls = audit_access_control_effectiveness(time_period)
        report.change_management = audit_schema_changes(time_period)
        report.availability = compute_sla_compliance(time_period)
        report.encryption = audit_encryption_coverage()

    RETURN report
```

### Automated Compliance Monitoring Dashboard

| Metric | Target | Measurement Frequency |
|--------|--------|---------------------|
| PII classification coverage | 100% of products with PII fields classified | Continuous (at publish) |
| Access grant expiration compliance | 0 expired but active grants | Daily scan |
| Encryption coverage | 100% of CONFIDENTIAL/RESTRICTED products encrypted | Daily scan |
| Deletion capability coverage | > 95% of PII-containing products support deletion | Weekly report |
| Audit log completeness | 100% of data access events logged | Continuous |
| Cross-domain PII flow tracking | 100% of PII-to-PII lineage edges documented | At publish |
| Retention policy compliance | 0 products exceeding retention limits | Daily scan |

---

## Data Product Security Lifecycle

### Security Checks at Each Lifecycle Stage

| Stage | Security Checks | Enforcement |
|-------|----------------|-------------|
| **DRAFT** | Descriptor reviewed for PII field declarations | Advisory — warnings only |
| **VALIDATING** | PII classification verified; encryption at rest confirmed; access policy declared; naming convention compliance | Blocking — must pass to publish |
| **PUBLISHED** | Continuous monitoring: access pattern anomalies, unused grants, encryption certificate validity | Alerting — owner notified |
| **DEPRECATED** | Verify no active consumers have elevated access; archive access audit logs | Automated — grants frozen |
| **ARCHIVED** | Encryption keys rotated; audit trail preserved; data purged per retention policy | Automated — compliance driven |

### Incident Response for Data Product Security Breach

```
Severity Levels:
  P1 — Unauthorized data access confirmed (PII exposure, privilege escalation)
  P2 — Suspicious access pattern detected (anomalous query volume, unusual consumer)
  P3 — Configuration vulnerability discovered (missing encryption, expired access grants)

P1 Response:
  0-15 min:  Revoke compromised access grants immediately
  0-30 min:  Quarantine affected data products (status → DEGRADED, access → FROZEN)
  0-60 min:  Identify all consumers who accessed the product during the breach window
  1-4 hours: Conduct forensic analysis of audit logs; determine scope
  4-24 hours: Notify affected parties per regulatory requirements (GDPR: 72 hours)
  24-72 hours: Root cause analysis; implement corrective controls; restore access

P2 Response:
  0-1 hour:  Investigate anomaly; determine if legitimate or malicious
  1-4 hours: If confirmed suspicious, escalate to P1 response
  4-24 hours: If false positive, tune anomaly detection thresholds

P3 Response:
  0-24 hours: Notify product owner of vulnerability
  1-7 days:  Owner remediates; platform verifies fix
  7-14 days: If unresolved, escalate to domain lead; product flagged in catalog
```

### Cross-Domain Data Sovereignty

In a multi-region data mesh, data sovereignty adds complexity to cross-domain operations:

| Scenario | Policy | Implementation |
|----------|--------|---------------|
| EU product consumed by US domain | GDPR Article 46 adequacy check | Access control verifies consumer region has adequacy decision or binding corporate rules |
| PII product joined with non-PII product | Result inherits highest classification | Federated query engine propagates PII classification to joined result |
| Aggregated product derived from PII source | De-identification verification | Governance policy validates that aggregation meets k-anonymity threshold before allowing cross-domain access |
| Product containing data from multiple regions | Most restrictive policy applies | Governance evaluates residency rules from all source regions; applies intersection of allowed consumers |
