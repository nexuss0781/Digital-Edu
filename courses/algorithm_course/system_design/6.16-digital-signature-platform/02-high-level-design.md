# High-Level Design

## System Architecture

```mermaid
flowchart TB
    subgraph Clients["Client Layer"]
        WEB[Web Application]
        MOB[Mobile App]
        API_CLIENT[API Integrations]
        EMBED[Embedded Signing iFrame]
    end

    subgraph Gateway["API Gateway Layer"]
        GW[API Gateway]
        AUTH[Auth Service]
        RL[Rate Limiter]
    end

    subgraph CoreServices["Core Services"]
        ENV[Envelope Service]
        SIGNER[Signer Workflow Service]
        DOC[Document Processing Service]
        SIG[Signature Capture Service]
        CERT[Certificate Service]
        SEAL[Document Sealing Service]
        TMPL[Template Service]
        BULK[Bulk Send Service]
    end

    subgraph SupportServices["Support Services"]
        AUDIT[Audit Service]
        NOTIF[Notification Service]
        FIELD[Field Detection Service]
        RENDER[PDF Rendering Service]
    end

    subgraph Security["Security Layer"]
        HSM[HSM Cluster]
        KMS_SVC[Key Management Service]
        IDP[Identity Provider]
    end

    subgraph DataLayer["Data Layer"]
        PG[(Relational DB<br/>Envelope State)]
        OBJSTORE[(Object Storage<br/>Documents)]
        AUDITLOG[(Append-Only Store<br/>Audit Trail)]
        CACHE[(Distributed Cache)]
        SEARCH[(Search Index)]
    end

    subgraph Messaging["Event Bus"]
        MQ[Message Queue]
        STREAM[Event Stream]
    end

    WEB --> GW
    MOB --> GW
    API_CLIENT --> GW
    EMBED --> GW

    GW --> AUTH
    GW --> RL
    GW --> ENV
    GW --> SIGNER
    GW --> SIG
    GW --> TMPL
    GW --> BULK

    ENV --> DOC
    ENV --> FIELD
    ENV --> PG
    ENV --> OBJSTORE

    SIGNER --> PG
    SIGNER --> NOTIF
    SIGNER --> MQ

    SIG --> HSM
    SIG --> CERT
    SIG --> AUDIT
    SIG --> PG

    CERT --> HSM
    CERT --> KMS_SVC

    SEAL --> DOC
    SEAL --> HSM
    SEAL --> OBJSTORE
    SEAL --> AUDIT

    DOC --> OBJSTORE
    DOC --> RENDER

    TMPL --> PG
    TMPL --> OBJSTORE

    BULK --> TMPL
    BULK --> ENV
    BULK --> MQ

    AUDIT --> AUDITLOG
    AUDIT --> STREAM

    NOTIF --> MQ

    AUTH --> IDP
    AUTH --> CACHE

    ENV --> CACHE
    SIGNER --> CACHE

    ENV --> SEARCH

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef support fill:#e8eaf6,stroke:#283593,stroke-width:2px
    classDef security fill:#fce4ec,stroke:#880e4f,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef cache fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef queue fill:#e0f7fa,stroke:#00695c,stroke-width:2px

    class WEB,MOB,API_CLIENT,EMBED client
    class GW,AUTH,RL gateway
    class ENV,SIGNER,DOC,SIG,CERT,SEAL,TMPL,BULK service
    class AUDIT,NOTIF,FIELD,RENDER support
    class HSM,KMS_SVC,IDP security
    class PG,OBJSTORE,AUDITLOG data
    class CACHE cache
    class MQ,STREAM,SEARCH queue
```

---

## Service Responsibilities

| Service | Responsibility | Stateful? | Critical Path? |
|---------|---------------|-----------|---------------|
| **Envelope Service** | Envelope lifecycle (create, update state, track progress) | Stateless (state in DB) | Yes |
| **Signer Workflow Service** | Signer routing order, turn management, reminder scheduling | Stateless | Yes |
| **Document Processing Service** | PDF conversion, page extraction, document storage/retrieval | Stateless | Yes |
| **Signature Capture Service** | Validate signature input, invoke HSM for digital signatures, record signature | Stateless | Yes |
| **Certificate Service** | X.509 certificate issuance, validation, revocation checking | Stateless | Yes (for AES/QES) |
| **Document Sealing Service** | Embed signatures into PDF, generate certificate of completion | Stateless | Yes (post-signing) |
| **Template Service** | Template CRUD, field inheritance, version management | Stateless | No |
| **Bulk Send Service** | Fan-out template to N recipients, envelope generation, progress tracking | Stateless | No |
| **Audit Service** | Hash-chain event recording, audit log queries, audit certificate generation | Stateless | Yes |
| **Notification Service** | Email, SMS, webhook delivery for all lifecycle events | Stateless | No (async) |
| **Field Detection Service** | Auto-detect signature placement from anchor text in PDFs | Stateless | No |
| **PDF Rendering Service** | Convert PDF pages to images for signing UI, overlay fields | Stateless | Yes (signing UX) |

---

## Data Flow: Complete Signing Lifecycle

### Phase 1: Envelope Creation

```
Sender → API Gateway → Envelope Service
    1. Create envelope record (status: DRAFT)
    2. Upload documents → Document Processing Service → Object Storage
    3. Convert to PDF if needed
    4. Place fields → Field Detection Service (auto) or manual placement
    5. Define signer routing order
    6. Envelope status → SENT
    7. Audit: "envelope.created", "envelope.sent"
    8. Signer Workflow Service → determine first signer(s)
    9. Notification Service → email first signer(s) with signing link
```

### Phase 2: Signer Authentication & Viewing

```
Signer clicks email link → API Gateway → Signer Workflow Service
    1. Validate signer token (time-limited, single-use per session)
    2. Authenticate signer (email verification, OTP, KBA as configured)
    3. Audit: "signer.authenticated" with IP, user agent, geolocation
    4. Load envelope → Envelope Service
    5. Render document → PDF Rendering Service → return page images with field overlays
    6. Audit: "envelope.viewed" by signer
```

### Phase 3: Signature Capture

```
Signer fills fields and signs → API Gateway → Signature Capture Service
    1. Validate all required fields are completed
    2. Capture signature input (drawn image, typed text, click-to-sign)
    3. For SES: Store signature image + metadata
    4. For AES/QES: Invoke HSM via Certificate Service
        a. Generate document hash (SHA-256)
        b. HSM signs hash with signer's private key
        c. Return PKCS#7 signature block
    5. Record signature → Relational DB
    6. Audit: "signature.captured" with signature metadata
    7. Signer Workflow Service → advance routing
        a. If more signers in current parallel group: wait
        b. If current group complete: activate next sequential group
        c. If all signers complete: trigger sealing
    8. Notification Service → notify next signer(s) or completion
```

### Phase 4: Document Sealing

```
All signatures captured → Document Sealing Service
    1. Load original documents from Object Storage
    2. For each signature:
        a. Embed signature image at field coordinates
        b. Embed PKCS#7/CAdES signature block into PDF
    3. Compute final document hash (SHA-256 over entire sealed PDF)
    4. HSM signs final hash → platform seal
    5. Generate Certificate of Completion:
        a. Signer names, emails, IP addresses, timestamps
        b. Document hashes (before and after signing)
        c. Hash chain summary from audit trail
    6. Store sealed PDF + certificate → Object Storage (immutable)
    7. Update envelope status → COMPLETED
    8. Audit: "envelope.completed", "document.sealed"
    9. Notification Service → email all parties with download links
```

### Phase 5: Retrieval & Verification

```
Any party requests document → API Gateway → Envelope Service
    1. Verify requester authorization (sender, signer, CC recipient)
    2. Retrieve sealed PDF from Object Storage
    3. Optionally: verify document integrity
        a. Recompute document hash
        b. Verify against stored hash and HSM signature
        c. Verify hash chain integrity in audit trail
    4. Return sealed PDF + certificate of completion + audit trail
    5. Audit: "document.downloaded" by requester
```

---

## Key Architectural Decisions

### 1. Envelope-Centric Data Model

**Decision**: Model the system around the "envelope" as the primary entity, containing documents, signers, fields, and audit events.

**Rationale**: An envelope is the atomic unit of a signing transaction. All signers, documents, and fields are scoped to a single envelope. This enables:
- Sharding by `envelope_id` for horizontal scaling
- Complete envelope retrieval in a single query path
- Clear lifecycle management (DRAFT → SENT → COMPLETED → SEALED)

**Trade-off**: Cross-envelope queries (e.g., "all envelopes signed by user X") require secondary indexes.

### 2. Append-Only Audit Trail with Hash Chaining

**Decision**: Store audit events in an append-only log with each event's hash computed over the event data + previous event's hash, forming a hash chain.

**Rationale**: Legal non-repudiation requires proving that audit records have not been tampered with. A hash chain makes any modification (insertion, deletion, reordering) mathematically detectable. A simple audit table with auto-increment IDs and timestamps is trivially modifiable by anyone with database access.

**Trade-off**: Hash chains create sequential write dependencies within an envelope's audit trail. Mitigated by per-envelope hash chains (not a global chain).

### 3. HSM for All Digital Signature Operations

**Decision**: All cryptographic signing operations (AES/QES level) must go through Hardware Security Modules. No private keys exist in application memory.

**Rationale**: Legal and compliance requirement. eIDAS Qualified signatures require keys on FIPS 140-2 Level 3 certified devices. Even for Advanced signatures, HSM-backed keys provide stronger non-repudiation defense.

**Trade-off**: HSM operations are slower (~50ms per sign) and capacity-limited. Mitigated by HSM cluster scaling and routing SES signatures (click-to-sign) through software path.

### 4. Event-Driven Architecture for Non-Critical Paths

**Decision**: Signature capture and audit recording are synchronous. Notifications, search indexing, analytics, and bulk send fan-out are asynchronous via message queue.

**Rationale**: Signing latency must be <500ms. Sending an email to the next signer can take 5-30 seconds. Decoupling non-critical paths from the signing critical path keeps the user experience responsive.

**Trade-off**: Notifications may be delayed by seconds to minutes. Acceptable because signers do not need to sign within seconds of being notified.

### 5. Immutable Document Storage

**Decision**: Once a document is sealed (all signatures embedded), the PDF is stored as an immutable blob in object storage with content-addressed addressing (hash of content = storage key).

**Rationale**: Immutability is a legal requirement for signed documents. Content-addressed storage provides built-in tamper detection---if the content changes, the hash changes, and the original is still retrievable.

**Trade-off**: Storage costs are higher (no in-place updates, old versions retained). Mitigated by object storage tier management (hot → warm → cold based on age).

### 6. Separate Signing Session Authentication

**Decision**: Signers authenticate via time-limited, single-use tokens sent via email, not via the sender's account credentials. Additional authentication (OTP, KBA) is layered on top.

**Rationale**: Signers may not be users of the platform. A signer could be a customer, vendor, or counterparty who has never registered. The signing session must be self-contained and not require platform registration.

**Trade-off**: Token-based authentication is vulnerable to email interception. Mitigated by short token expiry (24-72 hours), single-use sessions, and optional multi-factor authentication.

---

## Architecture Pattern Checklist

| Pattern | Decision | Justification |
|---------|----------|---------------|
| Sync vs Async | Sync for signing + audit; Async for notifications, search, analytics | Signing must be immediate; notifications can be delayed |
| Event-Driven vs Request-Response | Event-driven for post-signing workflows; request-response for signing flow | Event-driven enables decoupled scaling of downstream consumers |
| Push vs Pull | Push for signer notifications; pull for document retrieval | Signers need proactive notification; document download is on-demand |
| Stateless vs Stateful | Stateless services; state in relational DB and object storage | Enables horizontal scaling; state durability via database |
| Write-Heavy vs Read-Heavy | Write-heavy during signing; read-heavy for audit queries and document retrieval | Optimize write path for signing latency; cache for read path |
| Real-Time vs Batch | Real-time for signing; batch for bulk send fan-out and analytics | Signing is interactive; bulk operations are background |
| Edge vs Origin | Edge for PDF rendering/caching; origin for signing operations | Reduce latency for document viewing; centralize cryptographic operations |

---

## Communication Patterns

```mermaid
flowchart LR
    subgraph Synchronous["Synchronous (Request-Response)"]
        A1[Signature Capture] --> A2[HSM Signing]
        A3[Audit Event Write] --> A4[Append-Only Store]
        A5[Envelope State Update] --> A6[Relational DB]
    end

    subgraph Asynchronous["Asynchronous (Event-Driven)"]
        B1[Signing Complete] --> B2[Message Queue]
        B2 --> B3[Send Notification]
        B2 --> B4[Update Search Index]
        B2 --> B5[Trigger Next Signer]
        B2 --> B6[Analytics Pipeline]
    end

    subgraph BulkProcessing["Batch (Fan-Out)"]
        C1[Bulk Send Request] --> C2[Message Queue]
        C2 --> C3[Envelope Generator 1]
        C2 --> C4[Envelope Generator 2]
        C2 --> C5[Envelope Generator N]
    end

    classDef sync fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef async fill:#e0f7fa,stroke:#00695c,stroke-width:2px
    classDef batch fill:#fff3e0,stroke:#e65100,stroke-width:2px

    class A1,A2,A3,A4,A5,A6 sync
    class B1,B2,B3,B4,B5,B6 async
    class C1,C2,C3,C4,C5 batch
```

---

## Document Sealing Pipeline Architecture

```mermaid
flowchart TB
    subgraph Trigger["Trigger Layer"]
        LAST_SIG[Last Signature Captured]
        ROUTING[Routing Engine: All Groups Complete]
    end

    subgraph Preparation["Preparation Layer"]
        LOAD_ORIG[Load Original PDF from Object Storage]
        LOAD_SIGS[Load All Signature Records]
        LOAD_CERTS[Load Signer Certificates]
        VALIDATE[Validate All Fields Complete]
    end

    subgraph Embedding["Signature Embedding Layer"]
        VISUAL[Embed Visual Signature Images at Field Coordinates]
        PKCS7[Generate PKCS7/CAdES Blocks per Signer]
        INCR[PDF Incremental Save per Signer]
        LTV[Embed LTV Data: OCSP + CRL + Timestamps]
    end

    subgraph Sealing["Platform Sealing Layer"]
        HASH[Compute SHA-256 over Sealed PDF]
        HSM_SEAL[HSM Signs Final Hash: Platform Seal]
        CERT_GEN[Generate Certificate of Completion]
        AUDIT_FINAL[Write Final Audit Events + Hash Chain]
    end

    subgraph Storage["Immutable Storage Layer"]
        STORE_PDF[Store Sealed PDF: Content-Addressed]
        STORE_CERT[Store Certificate of Completion]
        STORE_AUDIT[Store Audit Trail PDF]
        NOTIFY[Notify All Parties: Download Links]
    end

    LAST_SIG --> ROUTING
    ROUTING --> LOAD_ORIG
    ROUTING --> LOAD_SIGS
    ROUTING --> LOAD_CERTS
    LOAD_ORIG --> VALIDATE
    LOAD_SIGS --> VALIDATE
    VALIDATE --> VISUAL
    VALIDATE --> PKCS7
    LOAD_CERTS --> PKCS7
    VISUAL --> INCR
    PKCS7 --> INCR
    INCR --> LTV
    LTV --> HASH
    HASH --> HSM_SEAL
    HSM_SEAL --> CERT_GEN
    HSM_SEAL --> AUDIT_FINAL
    CERT_GEN --> STORE_PDF
    CERT_GEN --> STORE_CERT
    AUDIT_FINAL --> STORE_AUDIT
    STORE_PDF --> NOTIFY
    STORE_CERT --> NOTIFY
    STORE_AUDIT --> NOTIFY

    classDef trigger fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef prep fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef embed fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef seal fill:#fce4ec,stroke:#880e4f,stroke-width:2px
    classDef store fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class LAST_SIG,ROUTING trigger
    class LOAD_ORIG,LOAD_SIGS,LOAD_CERTS,VALIDATE prep
    class VISUAL,PKCS7,INCR,LTV embed
    class HASH,HSM_SEAL,CERT_GEN,AUDIT_FINAL seal
    class STORE_PDF,STORE_CERT,STORE_AUDIT,NOTIFY store
```

### Sealing Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Embedding order** | Visual images first, then PKCS#7 blocks | Visual embedding does not affect cryptographic content; PKCS#7 must cover final byte content |
| **Incremental save strategy** | One incremental save per signer | Each signer's ByteRange covers all previous signers' content, creating a chain |
| **LTV data inclusion** | Embed at sealing time | OCSP responders and CRLs may be unavailable years later; embed now |
| **Platform seal** | HSM-generated signature over the complete sealed PDF | Provides platform-level tamper detection beyond individual signer signatures |
| **Content addressing** | `SHA256(sealed_pdf_bytes)` as storage key prefix | Built-in deduplication and integrity verification |
| **Certificate of completion** | Separate PDF document (not embedded in signed PDF) | Signed PDF must not be modified after sealing; certificate is a companion document |

---

## Template-to-Envelope Flow

```mermaid
flowchart LR
    subgraph Template["Template (Mutable)"]
        T_DOC[Template Document v3]
        T_FIELDS[Field Definitions]
        T_ROUTING[Default Routing]
        T_SETTINGS[Auth + Reminder Settings]
    end

    subgraph Snapshot["Copy-on-Send Snapshot"]
        SNAP[Version Pin at Send Time]
    end

    subgraph Envelope["Envelope (Immutable After Send)"]
        E_DOC[Document Copy]
        E_FIELDS[Field Copy]
        E_ROUTING[Routing Copy]
        E_SIGNERS[Per-Recipient Signers]
        E_AUDIT[New Audit Chain: Genesis]
    end

    T_DOC --> SNAP
    T_FIELDS --> SNAP
    T_ROUTING --> SNAP
    T_SETTINGS --> SNAP
    SNAP --> E_DOC
    SNAP --> E_FIELDS
    SNAP --> E_ROUTING
    SNAP --> E_SIGNERS
    SNAP --> E_AUDIT

    classDef template fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef snapshot fill:#e0f7fa,stroke:#00695c,stroke-width:2px
    classDef envelope fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px

    class T_DOC,T_FIELDS,T_ROUTING,T_SETTINGS template
    class SNAP snapshot
    class E_DOC,E_FIELDS,E_ROUTING,E_SIGNERS,E_AUDIT envelope
```

### Template Snapshot Rules

| Data Element | Snapshot Behavior | Why |
|-------------|-------------------|-----|
| **Document bytes** | Deep copy to object storage | Template doc may be updated; envelope must have exact version signed |
| **Field positions** | Full field definition copy | Field coordinates must match the copied document, not future template versions |
| **Routing order** | Complete routing DAG copy | Adding/removing signers from template must not affect in-flight envelopes |
| **Authentication levels** | Per-signer auth requirements copied | Changing template auth levels must not weaken in-flight security |
| **Reminder schedule** | Copy at creation; mutable until send | Sender may customize reminders per envelope before sending |
| **Template version ID** | Recorded for analytics only | No runtime dependency on template after envelope creation |

---

## Signer Authentication Decision Tree

```mermaid
flowchart TB
    START[Signer Clicks Email Link] --> VALIDATE_TOKEN{Token Valid?}
    VALIDATE_TOKEN -->|Expired| EXPIRED[Show Expiry Message + Request Resend]
    VALIDATE_TOKEN -->|Invalid| INVALID[Show Error + Log Security Event]
    VALIDATE_TOKEN -->|Valid| CHECK_AUTH{Auth Level Required?}

    CHECK_AUTH -->|Level 1: Email Only| CREATE_SESSION[Create Signing Session]
    CHECK_AUTH -->|Level 2: Email + OTP| OTP[Send OTP to Email/SMS]
    CHECK_AUTH -->|Level 3: KBA| KBA[Knowledge-Based Questions]
    CHECK_AUTH -->|Level 4: ID Verify| IDV[Government ID + Selfie Upload]
    CHECK_AUTH -->|Level 5: Certificate| CERT[Certificate-Based Auth]

    OTP --> VERIFY_OTP{OTP Correct?}
    VERIFY_OTP -->|Yes| CREATE_SESSION
    VERIFY_OTP -->|No, Attempts < 3| OTP
    VERIFY_OTP -->|No, Attempts >= 3| LOCKOUT[Lock Signer + Alert Sender]

    KBA --> VERIFY_KBA{KBA Passed?}
    VERIFY_KBA -->|Yes| CREATE_SESSION
    VERIFY_KBA -->|No| LOCKOUT

    IDV --> VERIFY_IDV{ID Verified?}
    VERIFY_IDV -->|Yes| CREATE_SESSION
    VERIFY_IDV -->|No| MANUAL_REVIEW[Queue for Manual Review]

    CERT --> VERIFY_CERT{Certificate Valid?}
    VERIFY_CERT -->|Yes| CREATE_SESSION
    VERIFY_CERT -->|No| CERT_ERROR[Certificate Error + Support Contact]

    CREATE_SESSION --> RENDER[Render Document for Signing]

    classDef start fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef decision fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef action fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef error fill:#fce4ec,stroke:#880e4f,stroke-width:2px

    class START start
    class VALIDATE_TOKEN,CHECK_AUTH,VERIFY_OTP,VERIFY_KBA,VERIFY_IDV,VERIFY_CERT decision
    class CREATE_SESSION,OTP,KBA,IDV,CERT,RENDER action
    class EXPIRED,INVALID,LOCKOUT,MANUAL_REVIEW,CERT_ERROR error
```
