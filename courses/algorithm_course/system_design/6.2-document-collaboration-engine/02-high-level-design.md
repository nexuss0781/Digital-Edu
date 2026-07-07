# High-Level Design

## 1. System Architecture

```mermaid
flowchart TB
    subgraph Clients["Client Layer"]
        direction LR
        Web["Web Editor<br/>(Browser)"]
        Desktop["Desktop App"]
        Mobile["Mobile App"]
        API["API Clients"]
    end

    subgraph Edge["Edge Layer"]
        CDN["CDN<br/>(Static Assets)"]
        LB["Global Load Balancer<br/>(L7, WebSocket-Aware)"]
    end

    subgraph Gateway["Gateway Layer"]
        GW["API Gateway<br/>(Auth, Rate Limit)"]
        WSGateway["WebSocket Gateway<br/>(Connection Mgmt,<br/>Session Routing)"]
    end

    subgraph Core["Core Services"]
        direction TB
        CollabSvc["Collaboration Service<br/>(OT/CRDT Engine,<br/>Operation Transform)"]
        DocSvc["Document Service<br/>(CRUD, Metadata,<br/>Snapshots)"]
        PresenceSvc["Presence Service<br/>(Cursors, Selections,<br/>Online Status)"]
        CommentSvc["Comment Service<br/>(Threads, Suggestions,<br/>Anchors)"]
        VersionSvc["Version History<br/>Service<br/>(Snapshots, Deltas)"]
        SearchSvc["Search Service<br/>(Full-text Index)"]
        PermSvc["Permission Service<br/>(RBAC, Sharing)"]
    end

    subgraph Async["Async Processing"]
        MQ["Message Queue"]
        Workers["Background Workers<br/>(Snapshot, Index,<br/>Export, Cleanup)"]
    end

    subgraph Data["Data Layer"]
        direction TB
        OpLog["Operation Log<br/>(Append-Only,<br/>Ordered Ops)"]
        DocStore["Document Store<br/>(Snapshots +<br/>Metadata)"]
        SessionStore["Session Store<br/>(In-Memory,<br/>Presence Data)"]
        SearchIdx["Search Index"]
        CacheLayer["Cache Layer<br/>(Doc Snapshots,<br/>Op Buffers)"]
    end

    Web & Desktop & Mobile & API --> CDN
    Web & Desktop & Mobile --> LB
    API --> LB
    LB --> GW & WSGateway
    GW --> DocSvc & CommentSvc & VersionSvc & SearchSvc & PermSvc
    WSGateway --> CollabSvc & PresenceSvc
    CollabSvc --> OpLog
    CollabSvc --> DocSvc
    CollabSvc --> PresenceSvc
    DocSvc --> DocStore
    DocSvc --> CacheLayer
    PresenceSvc --> SessionStore
    CommentSvc --> DocStore
    VersionSvc --> DocStore & OpLog
    SearchSvc --> SearchIdx
    PermSvc --> DocStore
    CollabSvc --> MQ
    MQ --> Workers
    Workers --> DocStore & SearchIdx

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef edge fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef async fill:#e0f7fa,stroke:#00695c,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef cache fill:#fffde7,stroke:#f57f17,stroke-width:2px

    class Web,Desktop,Mobile,API client
    class CDN,LB edge
    class GW,WSGateway gateway
    class CollabSvc,DocSvc,PresenceSvc,CommentSvc,VersionSvc,SearchSvc,PermSvc service
    class MQ,Workers async
    class OpLog,DocStore,SessionStore,SearchIdx data
    class CacheLayer cache
```

---

## 2. Data Flow

### 2.1 Real-Time Editing Flow (OT-Based, Google Docs Model)

```mermaid
sequenceDiagram
    participant A as Client A
    participant B as Client B
    participant WS as WebSocket Gateway
    participant Collab as Collaboration Service
    participant OL as Operation Log
    participant Cache as Doc Cache

    Note over A,B: Both clients connected, viewing document at version 5

    A->>A: 1. User types "Hello" at position 10
    A->>A: 2. Apply locally (optimistic) → instant rendering
    A->>A: 3. Buffer operation in outgoing queue

    A->>WS: 4. Send: {op: insert("Hello", 10), base_version: 5, client_id: A}
    WS->>Collab: 5. Route to collaboration service (document shard)

    par Server Processing
        Collab->>Collab: 6. Check: server version == base_version?
        Note over Collab: Server at v5, client at v5 → no transform needed
        Collab->>OL: 7. Append operation to log (v5 → v6)
        Collab->>Cache: 8. Update cached document state
    end

    Collab->>WS: 9. ACK to Client A: {ack: true, server_version: 6}
    WS->>A: 10. Client A receives ACK → flush outgoing buffer
    Collab->>WS: 11. Broadcast to Client B: {op: insert("Hello", 10), version: 6}
    WS->>B: 12. Client B receives operation

    B->>B: 13. Transform against any pending local ops
    B->>B: 14. Apply transformed operation → see "Hello"
    B->>B: 15. Update local version to 6

    Note over A,B: Concurrent Edit Scenario

    par Concurrent Edits
        A->>A: 16a. Insert "X" at position 0, base v6
        A->>WS: 17a. Send op to server
    and
        B->>B: 16b. Insert "Y" at position 0, base v6
        B->>WS: 17b. Send op to server
    end

    Collab->>Collab: 18. A's op arrives first → applied as v7
    Collab->>Collab: 19. B's op arrives second, base v6 but server at v7
    Collab->>Collab: 20. Transform B's op: insert("Y", 0) vs insert("X", 0)
    Collab->>Collab: 21. Transformed: insert("Y", 1) [shift right by 1]
    Collab->>OL: 22. Append transformed op as v8

    Collab->>WS: 23. Broadcast A's op (v7) to B
    Collab->>WS: 24. Broadcast transformed B's op (v8) to A
    WS->>B: 25. B transforms A's op against pending local op
    WS->>A: 26. A applies B's transformed op

    Note over A,B: Both see "XY..." → convergence achieved
```

### 2.2 Document Open Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant GW as API Gateway
    participant Perm as Permission Service
    participant Doc as Document Service
    participant Cache as Doc Cache
    participant Collab as Collaboration Service
    participant WS as WebSocket Gateway
    participant Presence as Presence Service

    C->>GW: 1. GET /docs/{doc_id}
    GW->>Perm: 2. Check access (user_id, doc_id)
    Perm-->>GW: 3. Permission: editor

    GW->>Doc: 4. Get document state
    Doc->>Cache: 5. Check snapshot cache
    alt Cache hit
        Cache-->>Doc: 6a. Return cached snapshot + version
    else Cache miss
        Doc->>Doc: 6b. Load latest snapshot from store
        Doc->>Doc: 6c. Replay operations since snapshot
        Doc->>Cache: 6d. Cache reconstructed state
    end
    Doc-->>GW: 7. Document state + version + metadata
    GW-->>C: 8. Response: {content, version: 42, collaborators}

    C->>WS: 9. Open WebSocket: /ws/docs/{doc_id}
    WS->>Collab: 10. Join document session
    Collab->>Collab: 11. Register client in session
    Collab->>Presence: 12. Add user to presence list

    Presence->>WS: 13. Broadcast to all: "User X joined"
    WS->>C: 14. Receive presence: {users: [{id, name, cursor, color}]}

    Note over C: Client now connected, can send/receive operations
```

### 2.3 Presence Update Flow

```mermaid
sequenceDiagram
    participant A as Client A
    participant WS as WebSocket Gateway
    participant Presence as Presence Service
    participant B as Client B
    participant C as Client C

    loop Every 50-100ms during active editing
        A->>A: Cursor moved to position 45, selection: [45, 52]
        A->>WS: {type: "presence", cursor: 45, selection: [45,52], user_id: A}
        WS->>Presence: Update A's presence state
        Presence->>Presence: Debounce + batch (16ms window)
        Presence->>WS: Broadcast batched presence updates
        WS->>B: {presenceUpdates: [{user: A, cursor: 45, selection: [45,52]}]}
        WS->>C: {presenceUpdates: [{user: A, cursor: 45, selection: [45,52]}]}
    end

    Note over A,C: Presence is ephemeral — not durably stored
    Note over A,C: Lost on disconnect, no retry needed
```

---

## 3. Key Architectural Decisions

### 3.1 OT vs CRDT

**Decision: OT for centralized real-time editing; CRDT for offline reconciliation**

This hybrid approach (used by Notion) leverages the strengths of each:

| Factor | OT (Real-Time Path) | CRDT (Offline Path) |
|--------|---------------------|---------------------|
| When used | Online, connected to server | Offline or disconnected editing |
| Authority | Central server orders operations | Each replica converges autonomously |
| Latency | <200ms with optimistic local apply | Merge on reconnect (seconds to minutes) |
| Memory | Low (no per-character metadata) | Higher (tombstones, metadata per character) |
| Convergence | Server-defined total order | Mathematical guarantees |

### 3.2 Monolith vs Microservices

**Decision: Microservices with a stateful Collaboration Service**

| Component | Scaling Rationale |
|-----------|-------------------|
| Collaboration Service | **Stateful** --- holds in-memory document sessions; scaled by document partitioning |
| Document Service | Stateless CRUD; scales horizontally |
| Presence Service | Ephemeral state in memory; scales per connection count |
| Permission Service | Stateless lookups; scales horizontally with caching |
| Search Service | Independent index sharding |

### 3.3 Communication Patterns

| Communication | Pattern | Reason |
|---------------|---------|--------|
| Client ↔ Collaboration Service | **WebSocket** (bidirectional) | Real-time operation streaming; low-overhead persistent connection |
| Client ↔ Document Service | **HTTP/REST** | Request-response for CRUD operations (open, list, delete) |
| Collaboration → Presence | **In-process or shared memory** | Ultra-low latency for cursor updates |
| Collaboration → Operation Log | **Synchronous append** | Operations must be durably stored before ACK |
| Collaboration → Snapshot Workers | **Asynchronous** (Message Queue) | Periodic snapshots are non-critical-path |
| Collaboration → Notification | **Asynchronous** | Comment mentions, share notifications |

### 3.4 Database Choices

| Data Type | Storage Choice | Justification |
|-----------|---------------|---------------|
| **Operation log** | Append-only log store (partitioned by doc_id) | High write throughput; sequential reads for replay; immutable |
| **Document snapshots** | Document store (e.g., MongoDB-style) | Flexible schema for rich document structures |
| **Document metadata** | Relational DB (SQL) | ACID for permissions, sharing, ownership |
| **Presence state** | In-memory store (Redis-like) | Ephemeral; TTL-based expiry; pub/sub for broadcast |
| **Comment threads** | Document store or SQL | Threaded comments with anchoring metadata |
| **Search index** | Inverted index | Full-text search across document content |
| **Session state** | In-memory (per-service instance) | Document collaboration state is per-session |

### 3.5 Operation Log Design

The operation log is the **source of truth** for document state:

```
┌─────────────────────────────────────────────────────────┐
│ Operation Log (per document, append-only)                │
├─────────────────────────────────────────────────────────┤
│ Seq │ Version │ User │ Operation           │ Timestamp  │
│   1 │      1  │ Alice│ insert("H", 0)      │ T1         │
│   2 │      2  │ Alice│ insert("e", 1)      │ T2         │
│   3 │      3  │ Bob  │ insert("X", 0)      │ T3         │
│   4 │      4  │ Alice│ insert("l", 2)      │ T4         │
│   5 │      5  │ Bob  │ delete(1)           │ T5         │
│   …  │      …  │  …   │  …                  │  …         │
│ 100 │    100  │      │ [SNAPSHOT MARKER]   │ T100       │
│ 101 │    101  │ Carol│ format(bold, 5, 10) │ T101       │
│ …   │     …   │  …   │  …                  │  …         │
└─────────────────────────────────────────────────────────┘

Document state = Snapshot(v100) + replay(ops 101..latest)
```

### 3.6 Snapshot Strategy

| Strategy | Pros | Cons | Use Case |
|----------|------|------|----------|
| **Every N operations** (e.g., 100) | Bounded replay cost; predictable | May snapshot in middle of logical edit | Default strategy |
| **Time-based** (every 5 min) | Regular cadence; simple | May be too frequent or too rare | Supplement to operation-based |
| **On session close** | Captures natural edit boundaries | No snapshot if session is long-lived | Additional trigger |
| **On demand** (named version) | User-controlled save points | Sparse; can't rely on for recovery | User-facing "version history" |

**Hybrid approach**: Snapshot every 100 operations OR every 5 minutes (whichever comes first), plus on-demand named versions.

---

## 4. Architecture Pattern Checklist

| Pattern | Decision | Justification |
|---------|----------|---------------|
| Sync vs Async | **Sync** for operations (must ACK); **Async** for snapshots, indexing | Operations need durability guarantee before ACK |
| Event-driven vs Request-response | **Event-driven** for operation propagation | Every edit is an event broadcast to all participants |
| Push vs Pull | **Push** via WebSocket for real-time; **Pull** for document open | Push eliminates polling latency |
| Stateless vs Stateful | **Stateful** collaboration service; stateless everything else | Document session state must be in memory for sub-ms transforms |
| Read/Write optimization | **Write-optimized** operation log; **read-optimized** snapshots | Log handles write burst; snapshots serve document loads |
| Real-time vs Batch | **Real-time** for editing; **batch** for snapshots, indexing, cleanup | Editing is inherently real-time |
| Edge vs Origin | **Origin** for all editing operations | Central server required for OT ordering |

---

## 5. Component Responsibilities

| Component | Responsibilities |
|-----------|-----------------|
| **WebSocket Gateway** | Manages persistent connections; routes operations to correct collaboration service instance; handles connection lifecycle (connect, disconnect, reconnect) |
| **Collaboration Service** | Core OT/CRDT engine; transforms operations, maintains in-memory document state, appends to operation log, broadcasts transformed operations |
| **Document Service** | CRUD for documents and metadata; loads snapshots; manages document lifecycle (create, archive, delete) |
| **Presence Service** | Tracks connected users per document; broadcasts cursor/selection positions; manages join/leave events; assigns user colors |
| **Comment Service** | Manages threaded comments and suggestions; anchors comments to text ranges; handles suggest/accept/reject workflow |
| **Version History Service** | Creates and retrieves snapshots; computes diffs between versions; supports named versions and restore |
| **Permission Service** | RBAC for document access; manages share links; enforces real-time permission changes |
| **Search Service** | Indexes document content for full-text search; updates index asynchronously on document changes |
| **Background Workers** | Periodic snapshot creation; search index updates; operation log compaction; export generation |

---

## 6. Block-Based Document Model (Notion Architecture)

An alternative to the linear text model (Google Docs) is the **block-based model** pioneered by Notion:

```mermaid
flowchart TB
    subgraph Document["Document (Root Block)"]
        direction TB
        B1["Block: Heading<br/>id: blk_001<br/>'Project Plan'"]
        B2["Block: Paragraph<br/>id: blk_002<br/>'Overview text...'"]
        B3["Block: Toggle List<br/>id: blk_003<br/>'Requirements'"]
        B3a["Block: Bullet<br/>id: blk_004<br/>'Requirement 1'"]
        B3b["Block: Bullet<br/>id: blk_005<br/>'Requirement 2'"]
        B4["Block: Table<br/>id: blk_006<br/>(child blocks = rows)"]
        B5["Block: Image<br/>id: blk_007<br/>src: /assets/arch.png"]
    end

    B1 --> B2 --> B3
    B3 --> B3a & B3b
    B3 --> B4 --> B5

    classDef block fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    class B1,B2,B3,B3a,B3b,B4,B5 block
```

**Block-based vs Linear:**

| Aspect | Linear (Google Docs) | Block-Based (Notion) |
|--------|---------------------|---------------------|
| **Unit of editing** | Character positions in a flat text stream | UUID-identified blocks in a tree |
| **OT complexity** | Transform positions across entire document | Transform within blocks; block-level reordering separate |
| **Content types** | Text + inline formatting | Any content type (text, images, tables, embeds, databases) |
| **Concurrent editing** | Fine-grained character conflicts | Block-level isolation reduces conflicts |
| **Offline support** | Requires full document CRDT | Each block can be an independent CRDT |
| **Performance** | Large documents are one unit | Lazy loading by block; only render visible blocks |

---

## 7. AI Co-Editing Architecture (2024-2026)

AI writing assistants operate as first-class editors through the same OT/CRDT pipeline:

```mermaid
sequenceDiagram
    participant User as Human Editor
    participant Collab as Collaboration Service
    participant AI as AI Writing Agent
    participant LLM as LLM Service

    User->>Collab: "Summarize the next section" (trigger)
    Collab->>AI: Invoke AI agent for doc_abc, position 500
    AI->>Collab: GET document context (surrounding 2000 chars)
    Collab-->>AI: Document context + user prompt
    AI->>LLM: Generate text (streaming)

    loop Streaming tokens
        LLM-->>AI: Token: "The"
        AI->>Collab: insert("The", 500) as user=AI_agent
        Collab->>Collab: Transform (same as any user)
        Collab->>User: Broadcast AI's insert
        LLM-->>AI: Token: " key"
        AI->>Collab: insert(" key", 503)
        Collab->>User: Broadcast
    end

    Note over User,LLM: AI operations are OT-transformed like any other user
    Note over User,LLM: Human can edit simultaneously — AI ops adjust
```

**Key principles:**
- AI is a **peer**, not a privileged entity — its operations go through the same OT pipeline
- Human edits during AI generation cause AI operations to be transformed (same as any concurrent edit)
- AI operations are attributed to an AI user (visible as "AI Assistant" cursor)
- Rate limiting applied per AI session (prevent token storms from overwhelming the collaboration service)
- Cancellation: user can stop AI generation; pending AI operations in flight are completed, no partial tokens

---

## 8. End-to-End Operation Latency Breakdown

```
Single operation (character insert, 3 concurrent editors):

Client-side:
  Keystroke capture                       ~1 ms
  Apply locally (optimistic)              ~0.1 ms
  Encode operation + metadata             ~0.1 ms
  ─────────────────────────────────────── ~1.2 ms

Network (client → server):
  WebSocket send (TCP/TLS overhead)       ~0.5 ms (persistent connection)
  Network latency (same region)           ~10 ms
  ─────────────────────────────────────── ~10.5 ms

Server-side:
  WebSocket gateway routing               ~0.5 ms
  Collaboration service: validate         ~0.1 ms
  Transform against 0-2 concurrent ops    ~0.2 ms
  Apply to in-memory state                ~0.1 ms
  WAL write (synchronous)                 ~1.5 ms
  Update comment anchors                  ~0.1 ms
  ─────────────────────────────────────── ~2.5 ms

Broadcast:
  Serialize + send to 2 other clients     ~0.5 ms
  Network latency (server → clients)      ~10 ms
  ─────────────────────────────────────── ~10.5 ms

Receiving client:
  Deserialize operation                   ~0.1 ms
  Transform against local pending ops     ~0.2 ms
  Apply to local document state           ~0.1 ms
  Re-render affected text                 ~2 ms
  ─────────────────────────────────────── ~2.4 ms

Total (sender → other clients see it):   ~27 ms
User's own keystroke → visible:           ~1.2 ms (optimistic!)
```

---

## 9. Cross-Service Communication Matrix

| Source → Destination | Protocol | Payload | Frequency | Failure Handling |
|---------------------|----------|---------|-----------|-----------------|
| **Client → WebSocket Gateway** | WebSocket (wss://) | Operations, presence updates | Continuous (per keystroke) | Client buffers ops locally; auto-reconnect |
| **WebSocket Gateway → Collab Service** | gRPC (internal) | Operations with trace context | Per operation | Gateway queues briefly; returns error after timeout |
| **Collab Service → Operation Log** | Direct write (synchronous) | Serialized operation | Per operation | Blocks ACK until write succeeds; failover to replica |
| **Collab Service → WebSocket Gateway** | gRPC streaming | Broadcast operations | Per operation | Best-effort; client detects missed ops via version gap |
| **Collab Service → Snapshot Worker** | Message queue | Snapshot trigger event | Every 100 ops or 5 min | Queue persists message; worker picks up on recovery |
| **Collab Service → Presence Service** | UDP multicast (internal) | Batch presence updates | Every 16ms | Lossy by design; stale presence auto-expires |
| **Document Service → Snapshot Store** | Object storage API | Full document snapshot blob | On document load/save | Retry with exponential backoff; serve from cache |
| **Search Indexer → Operation Log** | Change stream / CDC | New operations for indexing | Near real-time (1-5s lag) | Consumer tracks offset; replays on restart |

---

## 10. Data Locality and Access Patterns

### Regional Architecture

```mermaid
flowchart TB
    subgraph US["US Region (Primary)"]
        USG["WebSocket\nGateway"]
        USC["Collab\nService"]
        USW["Operation\nLog (Primary)"]
        USS["Snapshot\nStore"]
    end

    subgraph EU["EU Region"]
        EUG["WebSocket\nGateway"]
        EUC["Collab\nService"]
        EUW["Operation Log\n(EU Replica)"]
        EUS["Snapshot\nStore (EU)"]
    end

    subgraph APAC["APAC Region"]
        APG["WebSocket\nGateway"]
        APC["Read-Only\nRelay"]
        APW["Operation Log\n(Read Replica)"]
    end

    USW <-->|"Async replication\n(< 1s lag)"| EUW
    USW -->|"Async replication\n(< 2s lag)"| APW

    classDef primary fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef secondary fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef readonly fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class USG,USC,USW,USS primary
    class EUG,EUC,EUW,EUS secondary
    class APG,APC,APW readonly
```

**Document ownership model:**
- Each document has a **home region** (determined by creator's location or org policy)
- Operations for a document are always processed in the home region
- Cross-region collaborators connect to local gateway → routed to home region collab service
- Added latency for cross-region: 80-150ms (acceptable for non-real-time feeling with optimistic local apply)
- EU-regulated documents MUST have EU as home region (GDPR data residency)
