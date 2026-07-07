# 16.3 Security & Compliance

## Authentication & Authorization

### Authentication Mechanisms

| Method | Use Case | Details |
|---|---|---|
| **API Keys** | Service-to-service indexing, automated pipelines | Scoped to specific indices and operations; rotatable; rate-limited per key |
| **OAuth 2.0 / OIDC** | User-facing search applications, admin dashboards | Integration with identity provider; JWT token validation at coordinator; refresh token flow |
| **Mutual TLS (mTLS)** | Inter-node communication within the cluster | Every node presents a certificate; prevents unauthorized nodes from joining the cluster |
| **SAML / LDAP** | Enterprise single sign-on for management UI | Integration with corporate identity providers; role mapping from LDAP groups |

### Authorization Model

```
FUNCTION authorize_request(user: AuthenticatedUser, request: SearchRequest) -> AuthDecision:
    // Three-level authorization: cluster -> index -> field/document

    // Level 1: Cluster-level permissions
    IF request.type == "cluster_admin":
        REQUIRE role IN user.roles WHERE role.cluster_permissions CONTAINS request.action

    // Level 2: Index-level permissions
    IF request.type == "index_operation":
        REQUIRE role IN user.roles WHERE
            role.index_patterns MATCHES request.index
            AND role.index_permissions CONTAINS request.action
        // Actions: "read", "write", "create_index", "delete_index", "manage"

    // Level 3: Field-level security (FLS)
    IF role.field_security IS DEFINED:
        request.allowed_fields = role.field_security.include
        request.excluded_fields = role.field_security.exclude
        // Only return specified fields in search results
        // Prevents exposure of sensitive fields (e.g., internal_notes, cost_price)

    // Level 4: Document-level security (DLS)
    IF role.document_security IS DEFINED:
        request.dls_filter = role.document_security.query
        // Injected as a mandatory filter clause
        // e.g., {"term": {"tenant_id": "acme"}} for multi-tenant isolation
        // e.g., {"range": {"classification": {"lte": user.clearance_level}}}

    RETURN ALLOW
```

### Role Definitions

| Role | Index Permissions | Field-Level Security | Document-Level Security |
|---|---|---|---|
| `search_user` | Read on `products-*` | Exclude `cost_price`, `supplier_notes` | Filter by `tenant_id = user.tenant` |
| `catalog_admin` | Read + Write on `products-*` | All fields | Filter by `tenant_id = user.tenant` |
| `analytics_reader` | Read on `analytics-*` | Exclude PII fields | No restriction |
| `cluster_admin` | All on all indexes | All fields | No restriction |
| `ml_ranker` | Read on `products-*`, Write on `models-*` | Scoring fields only | No restriction |

---

## Multi-Tenancy Isolation

### Isolation Strategies

| Strategy | Description | Pros | Cons | Best For |
|---|---|---|---|---|
| **Index-per-tenant** | Each tenant gets a dedicated index | Strong isolation; independent lifecycle; per-tenant mapping | Cluster state bloat (many indexes); shard count explosion; cold tenants waste resources | Large tenants with unique schemas |
| **Shared index + DLS** | Single index, document-level security filter | Efficient resource usage; simple scaling | Noisy neighbor risk; no per-tenant mapping; query filter overhead | Many small tenants with similar schemas |
| **Hybrid** | Large tenants get dedicated indexes; small tenants share | Balances isolation and efficiency | Complex routing logic; monitoring across both patterns | SaaS platforms with varied tenant sizes |

### Implementation

```
FUNCTION route_tenant_request(request: Request, tenant: Tenant) -> RoutedRequest:
    IF tenant.tier == "enterprise":
        // Dedicated index per enterprise tenant
        request.index = "products-{tenant.id}"
        // No DLS filter needed (index is already isolated)

    ELSE IF tenant.tier == "standard":
        // Shared index with document-level security
        request.index = "products-shared"
        request.dls_filter = {"term": {"tenant_id": tenant.id}}
        // Every query automatically filtered to this tenant's docs

    // Rate limiting per tenant
    IF rate_limiter.exceeds_quota(tenant.id, request.type):
        RETURN 429 Too Many Requests

    RETURN request
```

---

## Data Security

### Encryption

| Layer | Method | Details |
|---|---|---|
| **In transit (client-cluster)** | TLS 1.3 | All client connections encrypted; certificate pinning for critical clients |
| **In transit (inter-node)** | mTLS | Node-to-node communication encrypted; automatic certificate rotation |
| **At rest (data nodes)** | Disk-level encryption | Transparent disk encryption via OS or storage layer; search engine does not manage keys |
| **At rest (snapshots)** | Server-side encryption | Object storage encryption for backup snapshots; customer-managed keys for enterprise tenants |
| **Field-level encryption** | Application-level | Sensitive fields encrypted before indexing; searchable encryption for exact match on encrypted fields (limited) |

### PII Handling

```
FUNCTION pii_ingest_pipeline(document: Document) -> Document:
    // Ingest pipeline processor that detects and handles PII before indexing

    FOR field_name, value IN document.fields():
        IF field_name IN pii_fields:
            // Strategy 1: Mask (preserve format, hide content)
            IF pii_policy == "mask":
                document[field_name] = mask_pii(value)
                // "john@example.com" -> "j***@e******.com"

            // Strategy 2: Hash (irreversible, but searchable by exact match)
            ELSE IF pii_policy == "hash":
                document[field_name] = sha256_hmac(value, tenant_key)

            // Strategy 3: Tokenize (reversible via secure vault)
            ELSE IF pii_policy == "tokenize":
                token = pii_vault.tokenize(value)
                document[field_name] = token
                // Original value stored in secure vault, not in search index

            // Strategy 4: Remove entirely
            ELSE IF pii_policy == "remove":
                document.remove(field_name)

    RETURN document
```

---

## Threat Model

### Top Attack Vectors

| Attack Vector | Description | Mitigation |
|---|---|---|
| **Query injection** | Malicious query syntax to extract unauthorized data or crash nodes (e.g., deeply nested boolean queries, regex DoS) | Validate and sanitize query input; set max clause count (default 1024); limit regex complexity; query cost estimation before execution |
| **Index poisoning** | Injecting documents with SEO-spam content or adversarial text to manipulate relevance rankings | Content validation in ingest pipeline; anomaly detection on indexing patterns; rate-limit writes per source; human review for high-impact indexes |
| **Resource exhaustion (DoS)** | Expensive queries that consume all cluster resources (large aggregations, deep pagination, wildcard leading queries) | Circuit breakers for memory; query timeout limits; reject leading wildcards by default; limit `from + size` to 10,000; restrict deep pagination to `search_after` |
| **Data exfiltration** | Unauthorized access to sensitive documents via over-broad queries or aggregation side channels | Document-level security; field-level security; audit logging of all search queries; aggregation result masking (minimum doc count threshold) |
| **Cluster takeover** | Unauthorized node joining the cluster to intercept data | mTLS for inter-node communication; node certificate validation; network isolation (cluster nodes on private subnet) |

### Audit Logging

```
AuditEvent {
    timestamp:      datetime
    user:           string          // Authenticated user or API key ID
    action:         string          // "search", "index", "delete", "admin"
    index:          string          // Target index
    query:          string          // Sanitized query (PII redacted)
    source_ip:      string
    result_count:   uint32
    duration_ms:    uint32
    status:         uint16          // HTTP status code
    tenant_id:      string          // For multi-tenant audit trails
}

// Audit log stored in a separate, write-only index
// Retention: 90 days hot, 365 days cold, 7 years archive (compliance)
// Access: restricted to security team role only
```

---

## Compliance

### Framework Requirements

| Framework | Requirements for Search Systems | Implementation |
|---|---|---|
| **GDPR** | Right to erasure; data minimization; lawful processing basis; cross-border data transfer restrictions | Delete-by-query API for PII removal; force-merge after deletion to physically reclaim deleted documents; data residency controls via shard allocation awareness |
| **HIPAA** | PHI protection; access controls; audit trails; encryption | Field-level encryption for PHI fields; document-level security per provider; complete audit logging; BAA-compliant deployment |
| **PCI-DSS** | Cardholder data protection; access restriction; network segmentation | Never index full card numbers; tokenize PAN before indexing; network isolation for PCI-scoped indexes; quarterly access reviews |
| **SOC 2** | Logical access controls; change management; availability monitoring | RBAC with principle of least privilege; index template versioning; uptime monitoring with alerting |

### GDPR Right to Erasure

```
FUNCTION handle_erasure_request(user_id: string):
    // Step 1: Find all documents containing user data
    affected_docs = search_all_indexes(
        query={"term": {"user_id": user_id}},
        scroll_all=True
    )

    // Step 2: Delete documents
    FOR doc IN affected_docs:
        delete(doc.index, doc.id)

    // Step 3: Force-merge to physically remove deleted data
    // Deleted docs are only logically marked; physical removal requires merge
    FOR index IN affected_indexes:
        force_merge(index, max_num_segments=1)
        // After merge, deleted document bytes are reclaimed
        // Without force_merge, deleted data persists on disk until natural merge

    // Step 4: Audit trail
    log_erasure_event(user_id, affected_docs.count, timestamp=now())

    // Step 5: Propagate to replicas and snapshots
    // Replicas: automatic (replication follows primary)
    // Snapshots: old snapshots still contain the data -> document retention policy
    //   for snapshots must align with erasure requirements
```

### Data Residency Controls

```
FUNCTION enforce_data_residency(document: Document, tenant: Tenant) -> RoutingDecision:
    // Ensure documents are indexed only on nodes in allowed regions
    // Uses shard allocation awareness (rack/zone/region attributes)

    allowed_regions = tenant.data_residency_policy.allowed_regions
    // e.g., EU tenant: ["eu-west-1", "eu-central-1"]
    // e.g., US tenant: ["us-east-1", "us-west-2"]

    // Index-level allocation filtering
    index_settings = {
        "index.routing.allocation.include.region": allowed_regions,
        "index.routing.allocation.exclude.region": ALL_REGIONS - allowed_regions
    }

    // Verify at ingestion time
    target_nodes = resolve_allocation(document.index, index_settings)
    IF any(node.region NOT IN allowed_regions for node in target_nodes):
        REJECT document with "Data residency violation"

    // Cross-cluster replication: only replicate to follower clusters in allowed regions
    IF tenant.data_residency_policy.cross_region_replication == false:
        DISABLE CCR for tenant's indexes

    RETURN RoutingDecision(allowed_nodes=target_nodes)
```

---

## Domain-Specific Threat Model

### Search-Specific Attack Patterns

| Attack | Mechanism | Severity | Detection | Mitigation |
|---|---|---|---|---|
| **Relevance manipulation (SEO spam)** | Inject documents with keyword-stuffed content to rank artificially high | High (undermines trust) | Anomaly detection on indexing rate per source; BM25 score distribution monitoring | Content quality scoring in ingest pipeline; rate-limit writes per API key; human review for high-value indexes |
| **Query timing side-channel** | Measure query response time to infer document existence (e.g., "does this person exist in the database?") | Medium | Audit log analysis for systematic query probing patterns | Add random jitter (1-5ms) to all query responses; constant-time filter evaluation; rate-limit per user |
| **Aggregation side-channel** | Use aggregations to extract data that field-level security hides (e.g., terms aggregation on a restricted field) | High | Monitor aggregation queries on restricted fields | Enforce FLS on aggregation results; set minimum doc count threshold (default: 1) to prevent unique value extraction |
| **Denial-of-service via expensive queries** | Craft queries that consume maximum resources: leading wildcards (`*foo`), deeply nested bool queries, regex catastrophic backtracking | Critical | Slow query log; circuit breaker trips; query cost estimation | Limit max bool clause count (1024); reject leading wildcards by default; regex timeout (10s); query complexity scoring at parse time |
| **Cross-tenant data leakage** | In shared indexes, bypass DLS filter to access another tenant's data | Critical | Audit log correlation: queries returning documents from multiple tenants when DLS is expected | DLS filter injected at coordinator level (not client-specified); mandatory filter clause added to every query; periodic DLS audit |
| **Index poisoning for ML models** | Manipulate documents to influence LTR model training via click data | Medium-High | Model monitoring: track feature distribution drift; A/B test new models before full rollout | Separate training data pipeline with anomaly detection; human-in-the-loop for model updates; gradual rollout with automatic rollback |

### API Security Hardening

```
FUNCTION api_security_middleware(request: Request) -> Request:
    // Rate limiting
    rate_limit = get_rate_limit(request.api_key)
    IF rate_limiter.is_exceeded(request.api_key, rate_limit):
        RETURN 429 Too Many Requests
        // Per-key limits: search=1000/min, index=100/min, admin=10/min

    // Request size limits
    IF request.body_size > max_request_size:
        RETURN 413 Payload Too Large
        // max_request_size: 100 MB for bulk, 10 MB for single operations

    // Query complexity scoring
    IF request.type == "search":
        complexity = estimate_query_complexity(request.query)
        // Factors: bool clause count, nested depth, wildcard count, aggregation depth
        IF complexity > max_complexity:
            RETURN 400 Bad Request ("Query complexity exceeds limit")

    // Input sanitization
    sanitize_query(request.query):
        // - Escape special characters in user-provided query strings
        // - Limit regex pattern length
        // - Reject script-based queries (painless scripting) for non-admin users
        // - Validate field names against mapping (reject unknown fields in strict mode)

    RETURN request
```

---

## Compliance Automation

### Automated Compliance Checks

| Check | Frequency | Method | Action on Failure |
|---|---|---|---|
| PII scan on new documents | Every ingestion | Ingest pipeline processor with NER-based PII detection | Quarantine document; alert data team; apply PII handling policy |
| Encryption verification | Daily | Verify TLS certificates, disk encryption status, snapshot encryption | Alert security team; block writes if encryption disabled |
| Access control audit | Weekly | Compare actual index access patterns against role definitions | Generate access review report; flag over-privileged keys |
| DLS filter integrity | Daily | Run cross-tenant query test suite; verify no tenant can access another's data | Critical alert; disable shared index reads until verified |
| Retention policy enforcement | Daily | Verify ILM policies delete data per retention schedule; verify snapshots expire | Alert compliance team; trigger manual deletion if overdue |
| GDPR erasure verification | After each erasure batch | Query for erased user IDs; verify force-merge completed; verify snapshot rotation | Escalate if documents still found; schedule additional force-merge |

### Compliance Event Log Schema

```
ComplianceEvent {
    event_id:           uuid
    timestamp:          datetime
    event_type:         enum("pii_detected", "erasure_requested", "erasure_completed",
                             "access_review", "retention_enforcement", "dls_audit")
    tenant_id:          string
    affected_indexes:   list<string>
    affected_documents: uint32           // count, not IDs (avoid logging PII)
    initiator:          string           // user or automated system
    result:             enum("success", "partial", "failed")
    details:            json             // structured details specific to event type
    retention_days:     uint32           // how long to keep this log entry
}

// Compliance log itself is:
//   - Append-only (no updates or deletes)
//   - Encrypted at rest
//   - Retained for 7 years (regulatory minimum)
//   - Access restricted to compliance and legal roles only
//   - Stored in a separate cluster from production search
```

---

## AI Act and Ranking Transparency

### EU AI Act Implications for Search Ranking

The EU AI Act (effective 2025-2026) classifies ranking systems used for significant decisions (hiring, lending, content moderation) as potentially high-risk AI systems, requiring:

| Requirement | Implication for Search | Implementation |
|---|---|---|
| **Explainability** | Users must be able to understand why results are ranked in a specific order | Provide `_explanation` API endpoint that returns per-factor scoring breakdown (BM25 contribution, function score, LTR feature importances) |
| **Non-discrimination** | Ranking must not produce systematically biased outcomes for protected groups | Bias auditing pipeline: compute ranking fairness metrics (demographic parity, equalized odds) across protected attributes; alert on disparity |
| **Transparency** | Ranking methodology must be documented and auditable | Maintain versioned ranking configuration (BM25 parameters, field boosts, LTR model version); log configuration alongside query audit trail |
| **Human oversight** | Humans must be able to override automated ranking decisions | Support manual boosting/pinning API; editorial override layer in ranking pipeline; A/B test monitoring for automated rollback |
| **Risk assessment** | High-risk ranking systems require conformity assessment before deployment | Document risk assessment for each ranking use case; maintain test suites for bias detection; periodic third-party audits |

### Ranking Explainability API

```
// Explain why document X ranks at position Y for query Z
POST /{index}/_explain/{doc_id}
Body: {
    "query": {
        "multi_match": {
            "query": "software engineer",
            "fields": ["title^3", "description"]
        }
    }
}
Response: {
    "matched": true,
    "explanation": {
        "value": 12.45,
        "description": "sum of:",
        "details": [
            {
                "value": 8.2,
                "description": "weight(title:software in 123) [BM25]",
                "details": [
                    {"value": 3.1, "description": "idf(docFreq=5000, docCount=1000000)"},
                    {"value": 2.65, "description": "tf(freq=2.0), with freq of 2.0"}
                ]
            },
            {
                "value": 4.25,
                "description": "weight(title:engineer in 123) [BM25]",
                "details": [...]
            }
        ]
    }
}
// For LTR: include feature vector values and model coefficients
// For hybrid search: include BM25 rank, vector rank, and RRF computation
```
