# Security & Compliance

## 1. Authentication & Authorization

### 1.1 Authentication Mechanism

| Method | Use Case | Details |
|--------|----------|---------|
| **OAuth 2.0 + OIDC** | Web and mobile clients | Authorization code flow with PKCE; short-lived access tokens |
| **SSO (SAML 2.0 / OIDC)** | Enterprise customers | Federated identity via corporate IdP |
| **API Keys** | Programmatic access, integrations | Scoped to specific permissions; rotatable |
| **Session Tokens** | WebSocket authentication | JWT-based; validated on WebSocket upgrade; refreshed via REST endpoint |
| **MFA** | All accounts (enforced for enterprise) | TOTP, WebAuthn/FIDO2 |

**WebSocket Authentication Flow:**

```
1. Client authenticates via OAuth → receives access_token (JWT, 1-hour TTL)
2. Client opens WebSocket: wss://collab.example.com/ws/docs/{doc_id}
   Header: Authorization: Bearer {access_token}
3. Server validates JWT signature, expiry, scopes
4. Server checks document permission (user_id, doc_id, required_role: "editor")
5. WebSocket connection established
6. Token refresh: Client sends REST refresh request before token expires;
   server sends new token over existing WebSocket
```

### 1.2 Authorization Model

**Relationship-Based Access Control (ReBAC) + RBAC**

```mermaid
flowchart TB
    Request["Authorization Request<br/>(user, action, doc_id)"]

    Request --> DirectGrant["1. Direct Grant<br/>user has explicit permission<br/>on this document?"]
    DirectGrant -->|Yes| Allow["ALLOW"]
    DirectGrant -->|No| FolderInherit["2. Folder Inheritance<br/>user has permission on<br/>parent folder?"]
    FolderInherit -->|Yes| Allow
    FolderInherit -->|No| TeamMember["3. Team/Group<br/>user belongs to team<br/>with document access?"]
    TeamMember -->|Yes| Allow
    TeamMember -->|No| ShareLink["4. Share Link<br/>request has valid<br/>share link token?"]
    ShareLink -->|Yes| Allow
    ShareLink -->|No| OrgDefault["5. Org Default<br/>org policy grants<br/>default access?"]
    OrgDefault -->|Yes| Allow
    OrgDefault -->|No| Deny["DENY"]

    classDef allow fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef deny fill:#ffebee,stroke:#c62828,stroke-width:2px
    classDef check fill:#e1f5fe,stroke:#01579b,stroke-width:2px

    class Allow allow
    class Deny deny
    class DirectGrant,FolderInherit,TeamMember,ShareLink,OrgDefault check
```

**Permission Levels:**

| Role | View | Comment | Suggest | Edit | Share | Delete | Admin |
|------|------|---------|---------|------|-------|--------|-------|
| **Viewer** | Yes | No | No | No | No | No | No |
| **Commenter** | Yes | Yes | No | No | No | No | No |
| **Suggester** | Yes | Yes | Yes | No | No | No | No |
| **Editor** | Yes | Yes | Yes | Yes | Limited | No | No |
| **Owner** | Yes | Yes | Yes | Yes | Yes | Yes | Yes |

**Real-time Permission Enforcement:**

When permissions change during an active editing session:
- Permission check happens on every operation at the collaboration service
- Downgrade: user's WebSocket receives `{type: "permission_changed", new_role: "viewer"}`; client disables editing UI
- Revocation: WebSocket is closed with reason "access_revoked"; client redirected to error page

### 1.3 Token Management

| Token Type | Lifetime | Storage | Refresh Strategy |
|------------|----------|---------|-----------------|
| Access token (JWT) | 1 hour | Client memory only | Refresh token exchange via REST |
| Refresh token | 30 days | Encrypted in OS keychain | Sliding window; revoked on password change |
| WebSocket session token | Duration of connection | Server memory | Refreshed via in-band token update message |
| Share link token | Until expiry/revocation | URL parameter | Not refreshable; new link = new token |
| API key | Until revoked | Hashed in database | Manual rotation by admin |

---

## 2. Data Security

### 2.1 Encryption at Rest

| Data | Algorithm | Key Management |
|------|-----------|----------------|
| **Document snapshots** | AES-256-GCM | Per-document DEK wrapped by per-tenant KEK; KEKs in HSM |
| **Operation log** | AES-256 (volume-level TDE) | Partition-level encryption; keys in HSM |
| **Metadata database** | AES-256 (transparent data encryption) | Database-managed keys backed by HSM |
| **Search index** | AES-256 | Index-level encryption; per-tenant index isolation |
| **Backups** | AES-256-GCM | Separate backup encryption keys |

### 2.2 Encryption in Transit

| Channel | Protocol | Details |
|---------|----------|---------|
| Client ↔ API Gateway | TLS 1.3 | Certificate pinning on mobile |
| WebSocket (wss://) | TLS 1.3 | Encrypted bidirectional channel |
| Service ↔ Service | mTLS | Mutual authentication with auto-rotated certs |
| Cross-region replication | TLS 1.3 | Dedicated replication channels |

### 2.3 Operation-Level Security

Unlike file storage where you encrypt blobs, collaborative editing has unique security challenges:

| Concern | Mitigation |
|---------|------------|
| **Operation content exposure** | Operations may contain user-typed text; encrypted in transit and at rest; never logged in plaintext |
| **Operation replay attack** | Each operation has a unique `(doc_id, user_id, client_seq)` tuple; server rejects duplicates |
| **Malicious operation injection** | All operations validated against document schema; invalid operations rejected |
| **Buffer overflow via large operation** | Max operation payload: 1 MB; max insert length: 100,000 characters |
| **XSS via document content** | Document content sanitized on render; CSP headers prevent script execution |

### 2.4 PII Handling

| Data Type | Classification | Handling |
|-----------|---------------|----------|
| Document content | User data (may contain PII) | Encrypted at rest; per-tenant isolation; never accessed by staff |
| User email/name | PII | Encrypted at rest; access-logged |
| Operation history | User behavioral data | Shows who typed what and when; anonymized after retention period |
| Cursor positions | Ephemeral | Never persisted; lost on disconnect |
| Comments | User content (may contain PII) | Encrypted at rest; tied to document permissions |
| IP addresses | PII (GDPR) | Retained 90 days; then anonymized |

---

## 3. Threat Model

### 3.1 Top Attack Vectors

| # | Attack Vector | Risk Level | Mitigation |
|---|--------------|------------|------------|
| 1 | **Unauthorized document access** (broken access control) | **Critical** | ReBAC authorization on every operation; WebSocket permission check; permission cache with immediate invalidation on changes |
| 2 | **XSS via document content** | **High** | Content sanitization on render; Content Security Policy (CSP); no inline script execution; DOMPurify for rich text |
| 3 | **Operation injection** (malicious client sends crafted operations) | **High** | Schema validation on every operation; position bounds checking; content length limits |
| 4 | **Session hijacking** (stolen WebSocket token) | **High** | Short-lived JWTs; device binding; anomaly detection (same token from different IPs) |
| 5 | **Denial of service via operation flood** | **Medium** | Per-user rate limiting (30 ops/s); per-document operation cap; auto-downgrade to viewer |
| 6 | **Data exfiltration via API** | **Medium** | Rate limiting on document export; anomalous bulk download detection; audit logging |

### 3.2 Rate Limiting & DDoS Protection

| Layer | Protection | Details |
|-------|-----------|---------|
| **Edge** | DDoS mitigation | Anycast absorption; connection rate limiting |
| **API Gateway** | Per-user REST rate limiting | Token bucket: 300 req/min |
| **WebSocket** | Per-user operation rate limiting | 30 ops/s per user per document |
| **Per-document** | Total operation rate cap | 5,000 ops/s per document (hard cap) |
| **Per-IP** | Connection rate limiting | Max 50 WebSocket connections per IP |

### 3.3 Content Security

Documents can contain user-generated rich text that gets rendered in other users' browsers:

```
ALGORITHM SanitizeOperation(op)
  IF op.type == "insert":
    // Strip dangerous content
    op.content ← REMOVE_SCRIPT_TAGS(op.content)
    op.content ← REMOVE_EVENT_HANDLERS(op.content)
    op.content ← SANITIZE_URLS(op.content)  // only allow http, https, mailto
    op.content ← TRUNCATE(op.content, MAX_INSERT_LENGTH=100000)

  IF op.type == "format":
    // Only allow known safe attributes
    ASSERT op.attribute IN ALLOWED_ATTRIBUTES
    // ALLOWED: bold, italic, underline, strikethrough, color, font,
    //          heading, link, list, align, indent
    // DENIED: style (arbitrary CSS), class, id, data-*

  RETURN op
```

---

## 4. Compliance

### 4.1 GDPR

| Requirement | Implementation |
|-------------|---------------|
| **Right to access** | Export API provides full document + operation history in standard format |
| **Right to erasure** | Account deletion removes all operations by that user; documents owned by user are deleted; contributions to shared docs are anonymized |
| **Data portability** | Export as HTML, DOCX, PDF, or raw JSON (document model) |
| **Data minimization** | Only store necessary metadata; presence data is ephemeral |
| **Breach notification** | Automated detection → 72-hour notification pipeline |
| **Data residency** | EU data processed and stored in EU regions (configurable per tenant) |

### 4.2 SOC 2 Type II

| Trust Principle | Controls |
|----------------|----------|
| **Security** | Encryption, MFA, vulnerability scanning, penetration testing, secure coding practices |
| **Availability** | 99.99% SLA, multi-zone replication, disaster recovery tested quarterly |
| **Confidentiality** | Per-tenant data isolation, encryption, access controls, employee background checks |
| **Processing Integrity** | Operation validation, convergence verification, checksums on snapshots |
| **Privacy** | Privacy policy, consent management, data subject request handling |

### 4.3 HIPAA

| Requirement | Implementation |
|-------------|---------------|
| **BAA** | Business Associate Agreement for enterprise healthcare customers |
| **PHI protection** | Optional E2EE mode; documents containing PHI flagged with sensitivity label |
| **Audit trail** | Complete operation log = immutable audit trail of who edited what and when |
| **Access controls** | RBAC with minimum necessary access; time-limited sharing |

### 4.4 Audit Trail

The operation log naturally forms a **complete, immutable audit trail**:

```
Every operation records:
  - WHO: user_id, device_id
  - WHAT: operation type and payload
  - WHEN: server-assigned timestamp
  - WHERE: document_id, version number
  - CONTEXT: base_version (what state the user was editing from)

This audit trail shows:
  - Every character ever typed in a document
  - Every formatting change
  - Who made each change and when
  - The complete evolution of the document from creation to current state

Retention: 1 year standard; 7 years for compliance-tagged documents
```

---

## 5. End-to-End Encryption for Collaborative Editing

### Challenge

E2EE for collaborative editing is fundamentally harder than for file storage because the server must process operations (transform, order, broadcast) without seeing their content.

### Approaches

| Approach | Feasibility | Trade-offs |
|----------|------------|-----------|
| **Client-side E2EE with trusted server for OT** | Impractical | Server needs plaintext to transform operations; defeats purpose |
| **CRDT-based E2EE** | Feasible | CRDTs don't need server-side transforms; operations encrypted on wire; server stores encrypted CRDT state |
| **Trusted execution environments (TEE)** | Emerging | Server processes operations inside secure enclave; encrypted at rest and in transit; only decrypted in TEE |
| **Proxy re-encryption** | Research stage | Transform operations on ciphertext; computationally expensive |

### CRDT-Based E2EE Architecture

```mermaid
flowchart TB
    subgraph Client["Client (E2EE Enabled)"]
        Edit["Edit Operation"]
        Encrypt["Encrypt with<br/>Document Key"]
        CRDTEncode["CRDT Encode"]
    end

    subgraph Server["Server (Zero Knowledge)"]
        Store["Store Encrypted<br/>CRDT Operations"]
        Relay["Relay to<br/>Other Clients"]
    end

    subgraph Receiver["Receiving Client"]
        Decrypt["Decrypt with<br/>Document Key"]
        CRDTApply["CRDT Merge"]
        Render["Render"]
    end

    Edit --> CRDTEncode --> Encrypt --> Store
    Store --> Relay --> Decrypt --> CRDTApply --> Render

    classDef client fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef server fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class Edit,Encrypt,CRDTEncode client
    class Store,Relay server
    class Decrypt,CRDTApply,Render client
```

**Key insight**: CRDTs enable E2EE because they don't require server-side transformation. Each client independently merges operations — the server only stores and relays encrypted CRDT updates. The trade-off: server-side search, AI features, and spam detection become impossible on encrypted content.

---

## 6. Data Residency and Compliance Boundaries

### Multi-Region Compliance Architecture

| Region | Data Types Stored | Compliance Frameworks | Notes |
|--------|------------------|----------------------|-------|
| **EU** | All data for EU users | GDPR, EU Data Act | Data never leaves EU boundary; processing in EU |
| **US** | All data for US users | SOC 2, CCPA, HIPAA (with BAA) | Default region for non-EU users |
| **APAC** | Read replicas for APAC users | PDPA, PIPL | Write operations forwarded to primary region |

### Document-Level Classification

| Sensitivity Level | Storage | Access | Audit |
|------------------|---------|--------|-------|
| **Public** | Standard encryption | Link sharing allowed | Standard logging |
| **Internal** | Standard encryption | Org members only | Enhanced logging |
| **Confidential** | Per-document DEK | Named individuals only | Full operation audit trail |
| **Restricted** | E2EE option available | Approval-gated access | Real-time admin notification on access |

---

## 7. WebSocket Security Hardening

| Threat | Mitigation |
|--------|------------|
| **Connection hijacking** | JWT validation on WebSocket upgrade; short-lived tokens (1 hour); re-authentication on token expiry |
| **Message tampering** | TLS 1.3 encryption; message integrity via WebSocket frame masking |
| **Replay attacks** | Per-operation `(doc_id, user_id, client_seq)` tuple; server rejects duplicates |
| **Slowloris DoS** | Connection timeout: 30s for handshake; idle timeout: 30 min; max message size: 1 MB |
| **WebSocket bombing** | Per-user connection limit: 10 concurrent WebSockets; per-IP limit: 50 |
| **Cross-site WebSocket hijacking** | Origin header validation; CSRF token in WebSocket URL |

---

## 8. Incident Response for Collaboration Systems

### Severity Classification

| Severity | Criteria | Response Time | Examples |
|----------|----------|---------------|----------|
| **SEV-1** | Data loss or document divergence affecting users | 15 min | WAL corruption, convergence failure, unauthorized document access |
| **SEV-2** | Editing degraded but no data loss | 30 min | High operation latency (>500ms), partial service outage |
| **SEV-3** | Feature degraded, workaround exists | 4 hours | Presence not updating, comments delayed, search lag |
| **SEV-4** | Minor issue, no user impact | 24 hours | Monitoring alert threshold tuning, log volume spike |

### Collaboration-Specific Incident Playbook

```
INCIDENT: Document Divergence Detected

STEP 1 — Contain (0-5 min)
  • Identify affected documents from convergence check alerts
  • Force-resync all connected clients (server state = source of truth)
  • Capture operation log snapshot for affected documents
  • Alert on-call engineer

STEP 2 — Diagnose (5-30 min)
  • Replay operation log to identify point of divergence
  • Compare client-reported hashes with server hash at each version
  • Identify the specific transform that produced incorrect output
  • Check if multiple documents are affected (systematic bug vs Edge Case (Unusual or extreme situation))

STEP 3 — Remediate (30 min - 4 hours)
  • If transform bug: deploy fix, re-validate all active documents
  • If race condition: add test case, review concurrency model
  • If client-side bug: push client update, force reload for active users

STEP 4 — Post-Incident (24-48 hours)
  • Write post-incident review (PIR) with timeline
  • Add regression test for the specific failure mode
  • Update convergence check frequency if detection was too slow
  • Review SLO burn rate and error budget impact
```

### Data Breach Response Timeline

| Time | Action | Owner |
|------|--------|-------|
| **T+0** | Automated detection (anomalous access pattern, bulk download, unauthorized API usage) | Security monitoring |
| **T+15 min** | Security team investigates; confirm or dismiss | Security on-call |
| **T+1 hour** | If confirmed: revoke compromised credentials, isolate affected systems | Security + Engineering |
| **T+4 hours** | Assess scope: which documents, which users, what data | Security + Legal |
| **T+24 hours** | Draft notification for affected users and regulators | Legal + Communications |
| **T+72 hours** | GDPR notification deadline: notify supervisory authority | Legal |
| **T+7 days** | Detailed incident report published internally | Security |
| **T+30 days** | Remediation complete; controls hardened | Engineering |

---

## 9. Third-Party Integration Security

### Plugin/Extension Security Model

Collaborative document editors often support third-party plugins (add-ons, integrations). These create a significant attack surface:

| Threat | Mitigation |
|--------|------------|
| **Malicious plugin reading document content** | Plugins run in sandboxed iframe; document access only via scoped API; user must explicitly grant permission |
| **Plugin injecting operations** | Plugin operations go through same OT pipeline and permission checks; attributed to plugin, not user |
| **Plugin exfiltrating data** | Content Security Policy restricts plugin network access; outbound requests proxied and logged |
| **Supply chain compromise of popular plugin** | Plugin code signing; automated security scanning on plugin updates; staged rollout with anomaly detection |
| **Plugin consuming excessive resources** | Per-plugin rate limits on API calls; memory and CPU limits in sandbox; timeout on long-running operations |

### OAuth Scope Restrictions for Integrations

| Scope | Access Granted | Example Use Case |
|-------|---------------|------------------|
| `documents.read` | Read document content and metadata | Search indexing, analytics |
| `documents.write` | Create and edit documents | AI writing assistant, template engine |
| `documents.comments` | Read and write comments | Code review bot, feedback collector |
| `documents.admin` | Manage permissions, delete documents | IT admin tools, compliance scanners |
| `presence.read` | See who's viewing a document | Team activity dashboard |

All scopes require explicit user consent. Scopes are per-document or per-folder (never workspace-wide for third-party integrations).
