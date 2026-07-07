# Security & Compliance — Graph Database

## Authentication & Authorization

### Authentication Mechanisms

| Mechanism | Use Case | Implementation |
|-----------|----------|---------------|
| Username/Password | Human users, admin access | Bcrypt-hashed credentials in internal auth store |
| OAuth 2.0 / OIDC | Application clients, SSO integration | JWT validation against identity provider |
| API Keys | Programmatic access, service-to-service | HMAC-signed keys with rotation support |
| mTLS | Service mesh, inter-node communication | Certificate-based mutual authentication |
| LDAP/SAML | Enterprise directory integration | Delegated authentication to corporate IdP |

### Authorization Model: Multi-Level Graph Access Control

Graph databases require a richer authorization model than relational databases because access patterns are graph-structural: a query might be allowed to see a node but not traverse certain relationship types, or see a relationship but not read specific properties.

**Level 1: Database-Level RBAC**

| Role | Permissions |
|------|------------|
| Admin | Full access: schema DDL, user management, backup/restore |
| Architect | Schema DDL, index management, read/write data |
| Writer | Read and write nodes, edges, properties |
| Reader | Read-only access to all data |
| Analytics | Read-only access via analytics engine (no OLTP) |

**Level 2: Label-Based Authorization**

```
// Grant read access to Person nodes but not InternalUser nodes
GRANT TRAVERSE ON GRAPH social TO reader
GRANT READ {*} ON NODE:Person TO reader
DENY READ {*} ON NODE:InternalUser TO reader
```

Label-based security controls which node labels and relationship types a role can see. A denied label makes those nodes invisible in traversal results — queries behave as if those nodes do not exist.

**Level 3: Property-Based Authorization**

```
// Allow reading Person nodes but deny access to the SSN property
GRANT READ {name, email, age} ON NODE:Person TO analyst
DENY READ {ssn, salary} ON NODE:Person TO analyst
```

Property-based security controls which properties within an allowed label are visible. Denied properties return NULL.

**Level 4: Subgraph Segmentation**

For multi-tenant deployments, restrict each tenant to a labeled subgraph:

```
// Tenant isolation via label prefixing
GRANT ALL ON NODE:Tenant_A_* TO tenant_a_role
DENY ALL ON NODE:Tenant_B_* TO tenant_a_role
```

### Token Management

| Token Type | Lifetime | Refresh | Storage |
|-----------|----------|---------|---------|
| Access token (JWT) | 15 minutes | Via refresh token | Client-side |
| Refresh token | 24 hours | Re-authentication required | Secure cookie / keystore |
| API key | 90 days | Manual rotation or auto-rotate | Server-side encrypted store |
| Service certificate | 30 days | Auto-rotation via certificate manager | mTLS-managed |

---

## Data Security

### Encryption at Rest

| Component | Encryption | Key Management |
|-----------|-----------|----------------|
| Node store | AES-256-GCM | Per-database key, managed by external KMS |
| Relationship store | AES-256-GCM | Same database key |
| Property store | AES-256-GCM | Same database key + per-property envelope key for sensitive fields |
| WAL | AES-256-GCM | Same database key (WAL replay requires decryption) |
| Index files | AES-256-GCM | Same database key |
| Backups | AES-256-GCM | Separate backup key with cross-region replication |

**Per-property encryption:** For highly sensitive properties (SSN, credit card), an additional envelope encryption layer allows those properties to be encrypted with a separate key, enabling key rotation without re-encrypting the entire store.

### Encryption in Transit

| Connection | Protocol | Minimum Version |
|-----------|----------|----------------|
| Client → Query Router | TLS 1.3 | Required |
| Query Router → Storage Nodes | mTLS | Required |
| Storage Node → Storage Node (replication) | mTLS | Required |
| Storage Node → Object Storage (backup) | TLS 1.3 | Required |

### PII Handling

| Data Category | Classification | Handling |
|--------------|---------------|---------|
| Node properties (name, email) | PII | Property-level encryption, label-based access control |
| Relationship existence | Sensitive metadata | Relationship types may reveal sensitive info (e.g., DIAGNOSED_WITH) |
| Graph structure | Behavioral data | Traversal patterns can infer sensitive relationships |
| Query logs | Contains PII queries | Parameter redaction in logs, retain only query templates |

### Data Masking / Anonymization

| Technique | When Used |
|-----------|-----------|
| Property redaction | Non-privileged roles see NULL for sensitive properties |
| Node generalization | Replace specific identifiers with categories (e.g., city → region) |
| Edge differential privacy | Add noise to degree counts in analytics exports |
| k-anonymity for subgraphs | Ensure exported subgraphs cannot identify individuals |

---

## Threat Model

### Top 5 Attack Vectors

#### 1. Traversal Escalation Attack

**Threat:** An attacker crafts a query that starts from an authorized node and traverses through relationships to reach nodes they should not access (e.g., traversing from a public profile to an internal admin node via a shared group).

**Impact:** Unauthorized data access, bypassing label-based access control.

**Mitigation:**
- Access control checks at every hop in the traversal, not just at the query start
- Denied labels create "traversal barriers" — the traversal engine treats denied nodes as non-existent
- Audit log for traversals that touch access-controlled boundaries

#### 2. Cypher/GQL Injection

**Threat:** Application passes unsanitized user input into query strings, allowing injection of malicious graph operations (e.g., `DELETE` or `SET` operations embedded in a `MATCH` clause).

**Impact:** Data destruction, unauthorized modification, data exfiltration.

**Mitigation:**
- Parameterized queries mandatory (query templates with `$parameter` placeholders)
- Query parser rejects statements with multiple clauses when submitted via read-only endpoints
- Input validation layer strips graph query keywords from user-supplied strings

#### 3. Denial-of-Service via Expensive Traversals

**Threat:** A malicious or poorly written query triggers unbounded traversal (e.g., `MATCH (a)-[*]->(b)` without depth limits) consuming all server resources.

**Impact:** System unavailability, affecting all users.

**Mitigation:**
- Maximum traversal depth enforced at query planning stage (configurable, default 15 hops)
- Query timeout (default 30 seconds)
- Memory budget per query (default 512 MB)
- Query guard: automatic detection and termination of runaway queries
- Rate limiting by client identity

#### 4. Graph Structure Inference

**Threat:** Even with property-level encryption, an attacker with read access can infer sensitive information from graph structure alone (e.g., the existence of an edge of type DIAGNOSED_WITH between a person and a disease reveals medical information).

**Impact:** Privacy violation through structural analysis.

**Mitigation:**
- Relationship-type-based access control (deny visibility of sensitive edge types)
- Edge masking: replace sensitive edge types with generic edges in query results for non-privileged roles
- Differential privacy for graph analytics exports (add noise to edge counts and degree distributions)

#### 5. Replica Divergence / Split-Brain

**Threat:** Network partition causes replicas to diverge. If both sides accept writes, the graph enters an inconsistent state where relationship chains have conflicting pointers.

**Impact:** Data corruption, traversal loops, dangling pointers.

**Mitigation:**
- Raft consensus requires majority quorum for writes (minority partition becomes read-only)
- Fencing tokens on leader transitions prevent stale leaders from accepting writes
- Automated consistency checks on partition heal (compare WAL positions)

### Rate Limiting & DDoS Protection

| Layer | Mechanism |
|-------|-----------|
| Network | Connection rate limiting, SYN flood protection |
| Transport | TLS handshake rate limiting |
| Application | Per-client query rate limiting (token bucket) |
| Query | Cost-based query admission control (expensive queries have higher cost) |
| Traversal | Per-query hop limit and expansion budget |

---

## Compliance

### GDPR Considerations

| Requirement | Implementation |
|------------|---------------|
| Right to be forgotten | Node deletion cascade: delete node, all incident edges, all properties, and all references in indexes |
| Data portability | Export a user's ego graph (user + 1-hop neighbors + all properties) in standard graph formats (GraphML, JSON-LD) |
| Consent management | Consent modeled as graph edges (User)-[:CONSENTED_TO]->(Purpose) with temporal properties |
| Data minimization | Property-level TTL: automatically expire and delete properties after retention period |
| Processing records | Audit log of all queries that accessed PII-labeled nodes |

### SOC 2 Considerations

| Control | Implementation |
|---------|---------------|
| Access control | Multi-level RBAC with label and property authorization |
| Audit logging | Immutable audit log of all data access and administrative operations |
| Encryption | At-rest (AES-256) and in-transit (TLS 1.3/mTLS) |
| Availability | 99.99% SLA with automated failover |
| Change management | Schema changes require DDL privileges and are version-controlled |

### PCI-DSS Considerations (if storing payment data)

| Requirement | Implementation |
|------------|---------------|
| Cardholder data isolation | Payment data in separate graph database instance with dedicated encryption keys |
| Network segmentation | Payment graph accessible only from PCI-compliant network zones |
| Access logging | Every query touching payment-labeled nodes logged with user identity |
| Key rotation | Per-property encryption keys rotated every 90 days |

### HIPAA Considerations (Healthcare Knowledge Graphs)

| Requirement | Implementation |
|------------|---------------|
| PHI isolation | Patient nodes and medical relationship types stored in an encrypted subgraph with dedicated access control |
| Access audit | Every traversal touching patient-labeled nodes generates an audit entry with clinician identity, access reason, and nodes accessed |
| Minimum necessary | Query results automatically filter to the minimum set of properties needed for the requesting role (nurse sees vitals, not billing codes) |
| Breach notification | Anomalous traversal patterns (clinician accessing unusual volume of patient records) trigger real-time alerts |

---

## Graph-Specific Security Threats (2025-2026)

### Threat 6: Adversarial Graph Injection

**Threat:** An attacker injects carefully crafted nodes and edges to manipulate graph analytics results. For example, injecting fake "FOLLOWS" edges to boost a user's PageRank score, or creating sybil nodes to manipulate community detection.

**Impact:** Corrupted analytics results; manipulated recommendation scores; inflated social proof metrics.

**Mitigation:**
- Anomaly detection on write patterns: flag accounts creating edges at unusual rates or with unusual structural properties
- Graph integrity constraints: enforce schema rules (e.g., "a Person node can have at most 10K FOLLOWS edges per day")
- Provenance tracking: tag each node/edge with its creation source (API, bulk import, internal process) and apply different trust levels
- Periodic sybil detection: run connected component analysis to identify clusters of recently created nodes with suspicious connectivity

### Threat 7: Link Prediction Privacy Attack

**Threat:** An attacker with read access uses graph structural features (common neighbors, Jaccard coefficient, Adamic-Adar index) to predict the existence of private edges — revealing hidden relationships even when edge-level access control is in place.

**Impact:** Privacy violation through inference. Even without seeing a "DIAGNOSED_WITH" edge between a patient and a disease, an attacker can infer its existence from shared neighbors (same doctors, same pharmacy, same support group).

**Mitigation:**
- Differential privacy for neighborhood queries: add calibrated noise to neighbor lists and degree counts
- Query budget per user: limit the number of structural queries a single user can execute per time window
- Structural privacy: when sensitive edge types exist, deny access not just to the edge but to the neighborhood features that could predict the edge
- Graph anonymization for analytics exports: apply k-anonymity transformations that ensure each node's structural signature is shared by at least k other nodes

### Threat 8: Cross-Tenant Data Leakage in Multi-Tenant Graphs

**Threat:** In a multi-tenant graph database where tenants share a physical cluster, a malicious tenant crafts queries that infer information about other tenants through shared reference data (e.g., a shared taxonomy or product catalog that multiple tenants link to).

**Impact:** Competitive intelligence leakage; unauthorized access to other tenants' graph structure.

**Mitigation:**
- Physical tenant isolation for sensitive deployments: separate graph databases per tenant with shared-nothing architecture
- Logical isolation with tenant-scoped traversal barriers: the traversal engine tracks the current tenant context and blocks traversals that would cross tenant boundaries, even through shared nodes
- Reference data duplication: each tenant gets a copy of shared reference nodes (products, categories) with tenant-specific edges, preventing cross-tenant traversal via shared nodes
- Audit logging with tenant attribution: every cross-tenant boundary access attempt is logged and alerted

### Threat 9: Query Timing Side-Channel Attack

**Threat:** An attacker measures query response times to infer graph structure. For example, a query that traverses through an existing edge returns faster than one that must discover the edge doesn't exist, revealing edge existence through timing differences.

**Impact:** Graph structure disclosure through timing analysis, even when access control prevents direct access.

**Mitigation:**
- Constant-time edge existence checks: pad response times to a fixed minimum regardless of result
- Response time bucketing: round response times to configurable intervals (e.g., nearest 5ms) to reduce timing precision
- Rate limiting with jitter: add random delay to query responses for unauthenticated or low-privilege clients
- Noise injection for sensitive queries: add artificial traversal steps for denied paths to make timing indistinguishable from allowed paths

---

## Security Architecture for Graph-Specific Operations

### Traversal Authorization Engine

```
FUNCTION authorize_traversal_hop(current_node, edge, target_node, user_context):
    // Check 1: Is the user allowed to see this edge type?
    IF NOT user_context.can_traverse(edge.type):
        RETURN DENY(reason="edge_type_denied")

    // Check 2: Is the user allowed to see the target node's label?
    FOR EACH label IN target_node.labels:
        IF NOT user_context.can_read_label(label):
            RETURN DENY(reason="label_denied")

    // Check 3: Subgraph segmentation (multi-tenant)
    IF target_node.tenant_id != user_context.tenant_id:
        IF NOT target_node.is_shared_reference:
            RETURN DENY(reason="tenant_boundary")

    // Check 4: Property-level access (which properties to include)
    allowed_properties = user_context.readable_properties(target_node.labels)

    RETURN ALLOW(visible_properties=allowed_properties)
```

### Audit Trail for Graph Access

| Event Type | Captured Data | Retention |
|-----------|--------------|-----------|
| Traversal attempt | User, query template, start node, max depth, result count | 90 days |
| Authorization denial | User, denied operation, resource, policy | 1 year |
| Cross-boundary access | User, source tenant, target tenant, shared node | 1 year |
| Supernode access | User, supernode ID, edges traversed, query cost | 90 days |
| Bulk export | User, export format, node/edge count, time window | 1 year |
| Schema modification | User, DDL statement, before/after state | Indefinite |
| Authentication event | User, method, result, client IP, user agent | 1 year |

### Secure Defaults

| Setting | Default Value | Rationale |
|---------|--------------|-----------|
| Max traversal depth | 15 hops | Prevents unbounded graph exploration |
| Query timeout | 30 seconds | Prevents resource exhaustion |
| Memory budget per query | 512 MB | Prevents OOM from fan-out explosion |
| Max result set size | 100,000 rows | Prevents bulk data exfiltration |
| Rate limit (unauthenticated) | 100 queries/min | Prevents reconnaissance |
| Failed auth lockout | 5 failures → 15 min lockout | Prevents credential brute-force |
| Property encryption | Opt-in per property | Selective encryption for sensitive fields |
| Audit logging | Always on for write operations | Compliance baseline |

---

## Data Sovereignty and Cross-Border Considerations

Graph databases face unique data sovereignty challenges because graph traversals can cross jurisdictional boundaries:

| Challenge | Description | Mitigation |
|-----------|------------|------------|
| **Cross-border traversal** | A traversal starting from a node in Region A may follow edges to nodes stored in Region B, potentially violating data residency rules | Geo-fencing at the traversal engine: block traversals from crossing configured jurisdictional boundaries |
| **Right to erasure with graph connectivity** | Deleting a user's data in a graph requires cascading through all edges, which may connect to nodes owned by other users | Distinguish between "owned data" (the user's node and outgoing edges) and "shared data" (edges where the user is an endpoint but not the owner) |
| **Consent propagation** | A user's consent status may affect whether their data can be traversed by other users' queries | Model consent as a graph property and check it during traversal authorization |
| **Audit trail for cross-border access** | When a query from Region A accesses data in Region B, the access must be logged in both regions | Dual-write audit logs with region tagging on every cross-region traversal hop |

---

## Security Testing and Validation

### Graph-Specific Security Test Cases

| Test Category | Test Case | Expected Behavior |
|--------------|-----------|-------------------|
| **Traversal escalation** | Start from authorized node, traverse 10 hops crossing label boundaries | Traversal stops at unauthorized labels; no data leakage |
| **Injection** | Submit query with embedded DELETE clause in a parameter value | Parameterized query rejects; no data modification |
| **DoS via query** | Submit `MATCH (a)-[*]->(b)` without depth limit | Query guard terminates within timeout; other queries unaffected |
| **Cross-tenant traversal** | From Tenant A context, attempt to traverse to Tenant B node via shared reference | Traversal blocked at tenant boundary; shared reference returns only public properties |
| **Property access** | Query a denied property on an authorized node | Property returns NULL; no error revealing property existence |
| **Timing attack** | Measure response time for existing vs. non-existing edges | Response times within 5ms of each other (padded) |
| **Replay attack** | Re-submit a captured transaction with the same idempotency key | Server returns cached result; no duplicate mutation |
| **Privilege escalation** | Attempt DDL operation (CREATE INDEX) with Writer role | Operation denied; audit log records the attempt |

### Penetration Testing Checklist for Graph Databases

- [ ] Verify access control at every traversal hop (not just query start)
- [ ] Test Cypher/GQL injection via all parameter entry points
- [ ] Verify query timeout enforcement under concurrent load
- [ ] Test cross-tenant isolation through shared reference nodes
- [ ] Verify property-level encryption key isolation
- [ ] Test certificate rotation without service interruption
- [ ] Verify WAL encryption at rest
- [ ] Test split-brain scenario: ensure minority partition becomes read-only
- [ ] Verify audit log completeness for all security-relevant events
- [ ] Test rate limiting under sustained load
