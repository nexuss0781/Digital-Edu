# Security & Compliance --- Metrics & Monitoring System

## Authentication & Authorization

### Authentication Mechanisms

| Client Type | AuthN Method | Details |
|---|---|---|
| **Metric agents (push)** | API key + mTLS | API key identifies tenant; mTLS provides transport-level identity; key rotation without downtime via dual-key support |
| **Scrape targets (pull)** | mTLS or Bearer token | Scraper authenticates to targets via client certificate; targets can require authentication for `/metrics` endpoint |
| **Dashboard users** | OIDC / OAuth 2.0 | SSO integration via corporate identity provider; session tokens with configurable TTL |
| **API consumers** | API key + HMAC | API key identifies tenant; HMAC signature prevents replay attacks; timestamp-based request validation |
| **Alert manager webhooks** | Shared secret + TLS | Webhook payloads signed with HMAC-SHA256; receivers validate signature before processing |

### Authorization Model: RBAC with Resource Scoping

```
ROLES:
  admin:        Full access to all tenant resources (metrics, alerts, dashboards, config)
  editor:       Create/modify dashboards, alert rules, silences; query all metrics
  viewer:       Read-only access to dashboards and queries; no configuration changes
  metrics_push: Write-only access to ingestion endpoints; no query access
  alert_admin:  Manage alert rules, notification routes, silences; no dashboard access

RESOURCE SCOPING:
  Each role is scoped to a tenant and optionally to a namespace/team:

  GRANT editor ON tenant="acme" namespace="platform-team"
    → Can edit dashboards and alerts for platform-team's metrics
    → Cannot access other teams' metrics within the same tenant

  GRANT viewer ON tenant="acme" namespace="*"
    → Can view all dashboards and query all metrics for tenant acme
    → Cannot modify anything

ACCESS CHECK:
  FUNCTION authorize(user, action, resource):
      user_roles = get_roles(user, resource.tenant_id)
      FOR EACH role IN user_roles:
          IF role.namespace == "*" OR role.namespace == resource.namespace:
              IF action IN role.allowed_actions:
                  RETURN ALLOW
      RETURN DENY
```

### Token Management

| Token Type | Lifetime | Storage | Rotation |
|---|---|---|---|
| **API keys** | Long-lived (90 days default) | Hashed in database; plaintext shown once at creation | Dual-key support: new key valid before old key expires; 7-day overlap window |
| **User session tokens** | 8 hours (configurable) | Server-side session store (Redis) | Automatic refresh on activity; hard expiry requires re-authentication |
| **Service-to-service tokens** | 1 hour | Short-lived JWT issued by internal CA | Automatic rotation via credential provider; no manual intervention |
| **Webhook signing keys** | Long-lived (per integration) | Encrypted in database | Manual rotation via API; old key valid for 24 hours after rotation |

---

## Data Security

### Encryption at Rest

| Data Type | Encryption Method | Key Management |
|---|---|---|
| **Object storage blocks** | Object storage server-side encryption (SSE) with customer-managed keys | Keys stored in KMS; per-tenant keys for premium tier; shared keys for standard tier |
| **WAL on local SSD** | Volume-level encryption (dm-crypt / BitLocker equivalent) | Node-level encryption key; key escrowed in KMS |
| **Index cache (Redis)** | Encrypted memory not practical for performance; network encryption instead | Cache data is derived (reconstructable from blocks); treated as ephemeral |
| **Alert manager state** | Encrypted at application level before persistence | Application-managed encryption key stored in KMS |
| **Dashboard database** | Database-level transparent data encryption (TDE) | Database encryption key in KMS |

### Encryption in Transit

| Communication Path | Protocol | Notes |
|---|---|---|
| Agent → Ingestion Gateway | TLS 1.3 (mTLS for push) | Certificate pinning optional; minimum TLS 1.2 enforced |
| Inter-service communication | mTLS | Service mesh or manual certificate management; auto-rotated certificates |
| Query Frontend → Dashboard UI | TLS 1.3 | Standard HTTPS |
| Alert Manager → Notification Channels | TLS 1.3 | Webhook payloads additionally signed with HMAC |
| Object storage access | HTTPS (TLS 1.3) | Service-level authentication via IAM roles |

### Metric Data Sensitivity Classification

Metric data is generally considered **operational** rather than **personal**, but it can contain sensitive information:

| Sensitivity Level | Examples | Handling |
|---|---|---|
| **Public** | System metrics (CPU, memory, disk), standard HTTP metrics | No special handling; safe to expose in shared dashboards |
| **Internal** | Business metrics (order count, revenue), service topology | Tenant isolation required; namespace-scoped access control |
| **Sensitive** | Security metrics (auth failures, IP addresses in labels), PII-adjacent metrics | Label scrubbing before storage; audit logging on access; restricted dashboard sharing |
| **Restricted** | Metrics containing PII (user IDs, email addresses in labels) | Must not exist: enforce label allow-listing at ingestion to prevent PII in metric labels |

### Label Scrubbing Pipeline

```
FUNCTION scrub_labels(series, scrub_rules):
    FOR EACH (label_name, label_value) IN series.labels:
        // Check for PII patterns
        IF matches_pii_pattern(label_value):  // email, phone, SSN patterns
            series.labels[label_name] = hash(label_value)  // replace with hash
            audit_log("pii_label_scrubbed", series.metric_name, label_name)

        // Check for deny-listed label names
        IF label_name IN scrub_rules.denied_labels:
            DELETE series.labels[label_name]
            audit_log("denied_label_removed", series.metric_name, label_name)

        // Check for high-cardinality indicators (potential PII proxy)
        IF label_cardinality(label_name) > scrub_rules.max_label_cardinality:
            flag_for_review(series.metric_name, label_name)

    RETURN series
```

---

## Threat Model

### Attack Vector 1: Metric Injection / Label Manipulation

**Threat**: An attacker with access to the ingestion API injects misleading metrics (e.g., `error_rate = 0` to suppress alerts) or adds malicious labels to exploit dashboard rendering (XSS via label values).

**Impact**: False operational picture; missed alerts; potential XSS if dashboard renders labels unsafely.

**Mitigation**:
- API key authentication scoping: each key is scoped to specific metric name prefixes and label names; cannot write arbitrary metrics
- Label value sanitization: strip HTML/script tags from label values at ingestion; enforce character allow-list (alphanumeric + `_-.:/`)
- Write-ahead audit log: all ingestion writes are logged with source identity; anomalous patterns (sudden metric value changes) trigger meta-alerts
- Dashboard rendering: all label values are HTML-escaped before rendering; Content-Security-Policy headers prevent inline script execution

### Attack Vector 2: Query-Based Denial of Service

**Threat**: A malicious or careless user submits expensive queries that consume all query engine resources, effectively denying service to other users and alert evaluations.

**Impact**: Alert evaluations delayed or skipped; dashboards unavailable for all users.

**Mitigation**:
- Per-query resource limits: max series per query (100K), max samples per query (50M), max query duration (120s)
- Per-tenant query concurrency limits: max 20 concurrent queries per tenant
- Query cost estimation: before execution, estimate query cost based on matched series count and time range; reject queries exceeding cost budget
- Query priority isolation: alert evaluations have reserved capacity that user queries cannot preempt
- Query audit logging: log all queries with execution time, series count, and tenant ID; automated detection of anomalous query patterns

### Attack Vector 3: Cardinality Bomb

**Threat**: An attacker (or misconfigured application) sends metrics with high-cardinality labels (e.g., random UUIDs as label values), causing memory exhaustion on ingesters and index servers.

**Impact**: Ingester OOM; index corruption; monitoring system outage.

**Mitigation**:
- Per-tenant cardinality caps enforced at the distributor level before data reaches ingesters
- Per-metric cardinality limits: automatic rejection of new series for metrics exceeding threshold
- Rate limiting on new series creation: max 1000 new series per second per tenant
- Cardinality pre-analysis: before accepting a new label value, check if it would exceed cardinality budget
- Automatic relabeling: for known high-cardinality labels, automatically drop or hash the label value

### Attack Vector 4: Alert Silencing Abuse

**Threat**: An insider silences critical alerts to mask an ongoing incident or cover unauthorized changes.

**Impact**: Critical alerts suppressed; incidents go undetected.

**Mitigation**:
- Silence creation requires explicit role (`alert_admin`) and is audit-logged with user identity, reason, and scope
- Maximum silence duration: 24 hours for critical alerts; must be explicitly renewed
- "Silence alert" on a silence: when a critical-severity alert is silenced, a separate notification goes to the security team via an independent channel
- Silence review workflow: silences matching `severity="critical"` require approval from a second authorized user
- Meta-monitoring: the meta-monitoring system tracks active silence count and alerts on unusual patterns

### Attack Vector 5: Supply Chain Attack via Metric Agents

**Threat**: Compromised metric agent or SDK sends exfiltrated data encoded in metric labels/values to an external endpoint, or is modified to stop reporting certain metrics.

**Impact**: Data exfiltration via side channel; blind spots in monitoring coverage.

**Mitigation**:
- Agent binary signing and verification: agents are signed with an internal certificate; deployment pipeline validates signatures
- Agent version tracking: metric `agent_version` is a standard label; alert on unexpected version changes
- Agent egress control: agents should only communicate with the ingestion gateway; network policies restrict outbound connectivity
- Agent behavior baseline: meta-monitoring tracks each agent's series count, ingestion rate, and scrape target list; deviations trigger investigation alerts

---

## Multi-Tenancy Security

### Tenant Isolation Layers

```
LAYER 1: INGESTION ISOLATION
  - Per-tenant API keys: tenant identified at gateway before any processing
  - Per-tenant rate limits: cardinality caps, ingestion rate limits enforced at distributor
  - Tenant ID injected as internal label: all series tagged with __tenant_id__
  - Cross-tenant write impossible: distributor validates tenant_id matches API key

LAYER 2: STORAGE ISOLATION
  Standard tier: logical isolation
    - Series stored in shared TSDB with __tenant_id__ label
    - Object storage blocks contain mixed tenant data
    - Index includes tenant_id in posting lists for efficient filtering
  Premium tier: physical isolation
    - Dedicated ingester pool per tenant
    - Separate object storage prefix per tenant
    - Independent compaction schedule

LAYER 3: QUERY ISOLATION
  - Tenant ID injected into every query automatically (no user-visible __tenant_id__ label)
  - Query engine enforces: every series access includes tenant_id filter
  - Cross-tenant query impossible: query planner validates single-tenant scope
  - Per-tenant query concurrency and memory limits

LAYER 4: NOTIFICATION ISOLATION
  - Alert routing rules scoped to tenant
  - Notification channels are per-tenant resources
  - Alert payloads contain only the owning tenant's data
  - Webhook endpoints validated per-tenant (no shared endpoints without explicit config)
```

### Tenant Data Access Audit Trail

Every cross-tenant data access attempt must be logged and auditable:

```
CROSS-TENANT ACCESS PREVENTION:

  Normal query flow:
    1. User authenticates → session contains tenant_id
    2. Query frontend injects __tenant_id__={session.tenant_id} into every query
    3. Query engine validates: all series access paths include tenant filter
    4. Audit log records: (user_id, tenant_id, query_hash, series_count, timestamp)

  Attack scenario: parameter manipulation
    1. User modifies API request to include different tenant_id in header
    2. Gateway validates: header tenant_id MUST match authenticated session tenant_id
    3. Mismatch → reject with 403 + audit alert
    4. Audit log records: (user_id, claimed_tenant, actual_tenant, source_ip, timestamp)

  Internal service access:
    1. Cross-tenant aggregation queries (e.g., billing, capacity planning) require
       privileged service account with explicit cross-tenant scope
    2. Privileged queries are rate-limited (max 10/minute) and logged with justification
    3. Monthly report of all cross-tenant queries reviewed by security team
```

### Compliance Considerations

| Regulation | Applicability | Requirements | Implementation |
|---|---|---|---|
| **SOC 2** | All deployments | Audit logging, access controls, change management | Comprehensive audit trail for config changes; RBAC; encrypted storage |
| **GDPR** | If metric labels contain EU personal data | Right to erasure, data minimization, lawful basis | Label scrubbing at ingestion prevents PII storage; no personal data in metrics by design; data retention policies with automatic deletion |
| **HIPAA** | Healthcare deployments | PHI protection, access auditing, encryption | Dedicated tenant with physical isolation; encrypted at rest and in transit; BAA with cloud provider; audit log retention for 6 years |
| **PCI-DSS** | If monitoring payment systems | Network segmentation, encryption, access logging | Separate network segment for payment system metrics; no card data in labels (enforced by allow-list); quarterly access reviews |
| **FedRAMP** | Government deployments | FIPS 140-2 encryption, continuous monitoring | FIPS-compliant TLS and encryption modules; dedicated government tenant with isolated infrastructure; continuous authorization artifacts |

### Audit Logging

All security-relevant actions are logged immutably:

| Event | Logged Fields | Retention |
|---|---|---|
| API key creation/rotation | user_id, tenant_id, key_prefix, scopes, timestamp | 2 years |
| Authentication failure | source_ip, tenant_id_attempted, failure_reason, timestamp | 1 year |
| Query execution | user_id, tenant_id, query_hash, series_count, duration, timestamp | 90 days |
| Alert rule modification | user_id, tenant_id, rule_id, change_diff, timestamp | 2 years |
| Silence creation/deletion | user_id, tenant_id, silence_scope, reason, timestamp | 2 years |
| Dashboard sharing | user_id, tenant_id, dashboard_id, share_target, timestamp | 1 year |
| Configuration change | user_id, tenant_id, config_key, old_value_hash, new_value_hash | 2 years |

---

## Advanced Threat Scenarios

### Threat 1: Metric Injection to Suppress Alerts

**Scenario**: An attacker with compromised API credentials injects false metric values (e.g., `error_rate = 0.0001`) to suppress firing alerts during an ongoing attack, creating a false sense of operational normalcy while exfiltrating data.

**Defense layers**:
1. **Anomaly detection on metric values**: ML model trained on per-series value distribution; flag sudden value changes that coincide with alert resolution
2. **Write audit correlation**: Correlate alert resolutions with metric writes from the same time window; flag resolutions caused by injected data
3. **Multi-source validation**: Critical metrics (error rate, latency) should have at least two independent sources (application metrics + eBPF kernel metrics); divergence between sources triggers investigation
4. **Immutable metric baseline**: For critical SLO metrics, maintain a separate, read-only baseline computed from multiple independent sources; alert evaluations cross-reference the baseline

### Threat 2: Denial of Service via Expensive Query

**Scenario**: An attacker crafts a PromQL query that matches millions of series across a long time range, consuming all query engine memory and CPU, and delaying alert evaluations for all tenants.

**Defense layers**:
1. **Pre-execution cost estimation**: Before executing a query, estimate the cost based on (matched series count x time range x step count); reject queries exceeding budget without executing
2. **Per-query memory limit**: Each query gets a memory sandbox (default: 512 MB); exceeding it terminates the query with an informative error
3. **Query execution timeout**: Hard timeout at 120 seconds for all queries; alert evaluations get 30-second timeout (faster feedback)
4. **Per-tenant query concurrency slots**: Max 20 concurrent queries per tenant; excess queries queued or rejected
5. **Query pattern blocklist**: Known-expensive patterns (e.g., `{__name__=~".+"}` matching all metrics) are blocked at the query frontend with a helpful error message

### Threat 3: Alert Silencing for Cover-Up

**Scenario**: An insider creates a silence matching critical security alerts (authentication failure rate, unauthorized API access) to mask malicious activity during an internal data theft.

**Defense layers**:
1. **Silence-on-silence alert**: When any `severity="critical"` alert is silenced, a separate notification goes to the security team via an independent channel (bypassing the alert manager being silenced)
2. **Mandatory justification**: Silence creation requires a written justification and a link to a change management ticket; machine-readable justification enables automated review
3. **Scope restriction**: Silences cannot match wildcard patterns on security-category alerts; must specify exact alert names
4. **Automatic expiry**: Maximum silence duration for security alerts: 4 hours; critical alerts: 12 hours; non-critical: 48 hours
5. **Post-silence review**: After a silence expires, an automated report compares alert state during the silence window against what would have fired, flagging any suppressed incidents

---

## Observability Data Privacy

### Metric Label PII Risk Assessment

| Risk Level | Label Pattern | Example | Prevalence | Mitigation |
|---|---|---|---|---|
| **Critical** | Email, phone, SSN | `user_email="john@example.com"` | Rare (explicit PII) | Block at ingestion; fail-closed label validation |
| **High** | User IDs, account numbers | `user_id="12345"` | Common (developer mistake) | Label allow-listing; high-cardinality detection as proxy |
| **Medium** | IP addresses | `client_ip="10.0.1.5"` | Common (infrastructure metrics) | Auto-hash IP labels for non-infrastructure metrics |
| **Low** | Geographic labels | `region="us-east"` | Universal | Generally safe; review for census-level granularity |
| **None** | Technical labels | `method="GET"`, `status="200"` | Universal | No special handling |

### Data Residency for Multi-Region Deployments

```
DATA RESIDENCY ENFORCEMENT:

Per-tenant configuration:
  tenant_id: "acme-eu"
  data_residency: "eu"           // all metric data must stay in EU
  processing_residency: "eu"     // queries can only execute in EU regions
  backup_residency: "eu"         // object storage replicas only in EU

Enforcement points:
  1. Distributor: route metrics for EU-resident tenants only to EU ingesters
  2. Object storage: EU-resident blocks stored only in EU bucket
  3. Query frontend: reject queries from non-EU query nodes for EU tenants
  4. Compactor: EU-resident blocks only compacted by EU compactor instances
  5. Federation: cross-region query federation DISABLED for residency-restricted tenants

Audit:
  Monthly report verifying no EU tenant data exists in non-EU storage
  Automated scan of object storage metadata for residency violations
```

---

## Incident Response for Monitoring System Failures

### Severity Classification

| Severity | Definition | Example | Response Time | Notification |
|---|---|---|---|---|
| **SEV-1** | Complete monitoring outage; no data ingested or alerts evaluated | All ingesters down; ring coordinator failure | 5 minutes | PagerDuty (direct, bypassing alert manager); all-hands bridge |
| **SEV-2** | Partial monitoring degradation; some tenants or features affected | Single ingester OOM; compaction stalled for 6+ hours | 15 minutes | PagerDuty (direct); team channel |
| **SEV-3** | Alert evaluation delayed; dashboards slow but functional | Query engine overloaded; cache miss rate spike | 30 minutes | Team channel notification |
| **SEV-4** | Cosmetic or minor functionality impacted | Dashboard template rendering issue; API rate limit too aggressive | Next business day | Ticketing system |

### SEV-1 Response Procedure

```
PROCEDURE monitoring_system_sev1:
    // Detected by meta-monitoring system (independent of primary)

    STEP 1: VERIFY (0-5 minutes)
      Confirm outage via meta-monitoring dashboard (separate from primary)
      Check: Can meta-monitoring reach primary components?
      Check: Are agents reporting buffer-full errors?

    STEP 2: COMMUNICATE (5-10 minutes)
      Post to incident channel: "Monitoring system SEV-1: [brief description]"
      Alert all on-call engineers: "Your monitoring is degraded; manual vigilance required"
      Start incident timer

    STEP 3: TRIAGE (10-20 minutes)
      Check ring coordinator health (etcd/consul cluster)
      Check ingester fleet (memory, CPU, disk, WAL status)
      Check object storage connectivity
      Check query engine capacity

    STEP 4: MITIGATE (20-60 minutes)
      IF ring coordinator down:
        Failover to backup coordinator; or restart with snapshot
      IF ingester OOM:
        Emergency cardinality cap enforcement; restart with reduced memory limit
      IF object storage unreachable:
        Enable cache-only mode; serve recent data from head blocks
      IF all else fails:
        Deploy fresh TSDB cluster pointing at existing object storage bucket
        (self-describing blocks enable fast cluster rebuild)

    STEP 5: VERIFY RECOVERY
      Confirm ingestion rate returns to normal
      Confirm alert evaluation resumes
      Confirm no data loss (compare expected vs. actual samples)
```
