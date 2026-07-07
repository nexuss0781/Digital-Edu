# Requirements & Capacity Estimations

## Functional Requirements

### Core Features

1. **Block-Based Document Editing**: Users create, edit, delete, move, and nest blocks of various types (paragraph, heading, list, table, image, embed, code, toggle, callout, database)
2. **Real-Time Collaboration**: Multiple users edit the same document simultaneously with changes visible to all within 100ms
3. **Multiplayer Cursors & Presence**: Show each collaborator's cursor position, selection range, and online status in real-time
4. **Offline Editing**: Full editing capability without network connection; automatic conflict-free merge on reconnect
5. **Version History**: Browse and restore previous versions; view per-user edit attribution
6. **Block Type Transformation**: Convert any block to a compatible type (paragraph <-> heading <-> quote) without losing content or children
7. **Nested Block Hierarchy**: Blocks can contain child blocks (toggle lists, columns, synced blocks) forming an arbitrarily deep tree
8. **Rich Text Within Blocks**: Bold, italic, strikethrough, code, links, mentions, comments within text blocks
9. **Undo/Redo**: Per-user undo stack that reverses only the current user's operations, even when interleaved with others' edits
10. **Comments & Discussions**: Inline comments anchored to specific text ranges or blocks

### Extended Features

11. **Synced Blocks**: A single block instance rendered in multiple locations; edits propagate to all instances
12. **Database Views**: Blocks that represent database entries with table, board, calendar, and gallery views
13. **Templates**: Reusable block structures that can be instantiated
14. **Import/Export**: Markdown, HTML, PDF import and export
15. **Search**: Full-text search across all documents in a workspace

### Out of Scope

- Video/audio real-time collaboration (covered in 6.7 Google Meet/Zoom)
- Drawing/whiteboard canvas (covered in 6.11 WebRTC Collaborative Canvas)
- File storage and sync (covered in 6.1 Cloud File Storage)
- Linear text OT algorithms in depth (covered in 6.2 Document Collaboration Engine)

---

## Non-Functional Requirements

### CAP Theorem Choice

**AP (Availability + Partition Tolerance)** with strong eventual consistency.

Justification: Collaborative editors must remain available during network partitions (offline editing is a first-class requirement). CRDTs provide mathematically guaranteed convergence, delivering strong eventual consistency without sacrificing availability.

### Consistency Model

| Aspect | Model | Rationale |
|--------|-------|-----------|
| Document content | Strong eventual consistency (CRDT) | All replicas converge to identical state |
| Block tree structure | Strong eventual consistency (Tree CRDT) | Moves and reparenting merge deterministically |
| Presence/cursors | Best effort, ephemeral | Stale cursor positions are harmless |
| Permissions | Strong consistency (server-authoritative) | Security cannot be eventually consistent |
| Version history | Causal consistency | Snapshots must reflect causal ordering |

### Availability Target

**99.95%** (26 minutes downtime/month) for online collaboration.

**100% for editing** --- offline-first architecture means the editor never goes "down" from the user's perspective; only sync is affected by outages.

### Latency Targets

| Operation | p50 | p95 | p99 |
|-----------|-----|-----|-----|
| Local keystroke to screen | <5ms | <10ms | <20ms |
| Edit propagation to peers | <50ms | <150ms | <300ms |
| Cursor/presence update | <30ms | <100ms | <200ms |
| Offline merge on reconnect | <500ms | <2s | <5s |
| Document load (cold) | <200ms | <500ms | <1s |
| Document load (cached) | <20ms | <50ms | <100ms |
| Full-text search | <100ms | <300ms | <500ms |

### Durability Guarantees

- **Zero data loss** for committed operations (operation log + periodic snapshots)
- Offline edits persisted to local storage (IndexedDB/SQLite) before any network operation
- Server-side triple replication across availability zones

---

## Capacity Estimations (Back-of-Envelope)

### Assumptions

- 100M registered users (Notion-scale)
- 30M MAU, 10M DAU
- Average session: 45 minutes, 3 sessions/day
- 200 blocks per document average, 50 documents per active user
- Average block size: 200 bytes (text + properties + metadata)
- 2 edits/second during active editing
- Average 2.5 concurrent editors per active document
- 20% of DAU editing simultaneously at peak

### Calculations

| Metric | Estimation | Calculation |
|--------|------------|-------------|
| DAU | 10M | Given |
| Peak concurrent users | 2M | 10M DAU * 20% |
| Active documents (peak) | 800K | 2M users / 2.5 editors per doc |
| Operations/sec (average) | 4M | 2M users * 2 ops/sec |
| Operations/sec (peak) | 8M | 2x average |
| Presence updates/sec | 2M | 2M users * 1 update/sec |
| WebSocket connections (peak) | 2M | 1 per active user |
| Storage per document | 40 KB | 200 blocks * 200 bytes |
| Total document storage | 100 TB | 10M DAU * 50 docs * 40KB * 5x (versions) |
| Operation log storage (Year 1) | 500 TB | 4M ops/sec * 100 bytes * 86400s * 365 * 0.4 (compression) |
| Operation log storage (Year 5) | 2.5 PB | 5x Year 1 |
| Bandwidth (peak) | 800 MB/s | 8M ops * 100 bytes |
| Cache size (hot documents) | 32 GB | 800K docs * 40 KB |

### Storage Breakdown

| Component | Size | Notes |
|-----------|------|-------|
| Block content | 100 TB | Document blocks with properties |
| Operation logs | 500 TB/year | Full edit history for replay |
| Version snapshots | 50 TB | Periodic snapshots for fast loading |
| CRDT metadata | 200 TB | Per-character/block CRDT state |
| Search index | 20 TB | Full-text index across documents |
| Media attachments | 500 TB | Images, files embedded in blocks |

---

## SLOs / SLAs

| Metric | Target | Measurement |
|--------|--------|-------------|
| Availability (online sync) | 99.95% | Percentage of time sync service is reachable |
| Availability (editing) | 100% | Offline-first; editor never unavailable |
| Edit propagation (p99) | <300ms | Time from one client's edit to another client's render |
| Cursor sync (p99) | <200ms | Cursor position broadcast latency |
| Offline merge (p99) | <5s | Time to merge offline edits on reconnect |
| Document load (p99) | <1s | Time to load and render a document |
| Data durability | 99.999999999% (11 nines) | Operations stored in replicated log |
| Error rate | <0.01% | Failed operations as percentage of total |
| CRDT convergence | 100% | All replicas MUST converge (mathematical guarantee) |

---

## Traffic Patterns

### Daily Pattern

```
Operations/sec
    |
8M  |          *****
    |        **     **
4M  |      **         **
    |    **             **
2M  |  **                 **
    |**                     **
    +----------------------------> Time (UTC)
     0  4  8  12  16  20  24
```

### Burst Scenarios

| Scenario | Impact | Mitigation |
|----------|--------|------------|
| Company all-hands (1000+ editors in one doc) | WebSocket fan-out Slowest part of the process | Operation batching, delta compression |
| Back-to-school/work (Monday 9 AM) | 3x normal document loads | Pre-warming caches, auto-scaling |
| Mass offline reconnection | Merge storm on sync servers | Queue-based merge processing, rate limiting |
| Viral template duplication | Sudden block tree cloning | Lazy copy, background materialization |

### Regional Traffic Distribution

```
Global traffic by region (peak hours shift across timezones):

Americas:     35%    Peak: 14:00-18:00 UTC (9 AM - 1 PM ET)
Europe:       30%    Peak: 08:00-12:00 UTC (9 AM - 1 PM CET)
Asia-Pacific: 25%    Peak: 01:00-05:00 UTC (10 AM - 2 PM JST)
Other:        10%    Peak: varies

Result: No single global peak—traffic is distributed across timezones.
This means infrastructure utilization is more even than for a single-region product.
However, cross-region collaboration (e.g., US-EU teams) produces "overlap peaks"
at 14:00-16:00 UTC where both regions are active.
```

---

## Bandwidth Estimations

| Flow | Direction | Payload | Rate (Peak) | Bandwidth |
|------|-----------|---------|-------------|-----------|
| CRDT update (edit) | Client → Server | 50-200 bytes (binary delta) | 8M ops/sec | 800 MB/s |
| CRDT broadcast (fan-out) | Server → Clients | 50-200 bytes per peer | 20M messages/sec | 2 GB/s |
| Presence / awareness | Bidirectional | 80-150 bytes (cursor + user) | 2M updates/sec | 200 MB/s |
| Document load (cold) | Server → Client | 40KB-2MB (snapshot) | 50K loads/sec | 50 GB/s |
| Document load (cached) | Local → Client | 40KB (from IndexedDB) | 200K loads/sec | 0 (local) |
| Offline merge (reconnect) | Bidirectional | 1KB-10MB (accumulated delta) | 5K merges/sec | 5 GB/s burst |
| Snapshot creation | Server → Storage | 40KB-2MB (full CRDT state) | 20K/min | 300 MB/s |

**Key bandwidth insight**: The fan-out multiplier is the dominant cost. A single edit generates one inbound message but N-1 outbound messages (where N is concurrent editors). For a 10-editor document, the outbound bandwidth is 9x the inbound.

---

## Cost Estimation Model

### Monthly Infrastructure Cost (at Notion Scale)

| Component | Specification | Monthly Cost | Notes |
|-----------|---------------|-------------|-------|
| **WebSocket Gateways** | 200 instances, 10K connections each | $40K | Compute-optimized instances |
| **Sync Servers** | 100 instances, 500 active docs each | $60K | Memory-optimized (CRDT state in RAM) |
| **Merge Workers** | 20 instances (auto-scaled to 50 during storms) | $8K | Burst capacity for offline reconnection |
| **Operation Log Storage** | 500 TB/year, append-only | $25K | Tiered storage: hot/warm/cold |
| **Snapshot Storage** | 50 TB | $5K | Key-value store, cross-region replicated |
| **Metadata Database** | Sharded PostgreSQL, 5 TB | $15K | Read replicas for listing queries |
| **Cache (Distributed)** | 256 GB across cluster | $12K | Hot document CRDT states |
| **Search Infrastructure** | 20 TB index, 10 nodes | $20K | Full-text search cluster |
| **Blob Storage (Media)** | 500 TB | $10K | Images, files embedded in blocks |
| **CDN** | Global edge delivery | $15K | Editor bundles, static assets |
| **Observability** | Metrics, logs, tracing | $20K | ~12% of infrastructure |
| **Total** | | **~$230K/month** | |

### Unit Economics

| Metric | Value |
|--------|-------|
| Cost per DAU per month | $0.023 |
| Cost per active document per month | $0.29 |
| Cost per million operations | $0.58 |
| Sync server cost per concurrent user | $0.03/hour |
| Storage cost per document (with history) | $0.002/month |

---

## Key Technical Constraints

| Constraint | Impact | Design Implication |
|-----------|--------|-------------------|
| **CRDT memory overhead** (4-32 bytes/char) | A 10KB document becomes 40-320KB in CRDT representation | Block-level lazy loading; aggressive GC; Eg-walker for memory-sensitive environments |
| **Tombstone accumulation** | Deleted items persist as tombstones forever without GC | GC with 30-day grace period; stale clients must do full snapshot reload |
| **WebSocket statefulness** | Sync servers hold in-memory CRDT state per document | Sticky sessions; careful failover with state reconstruction |
| **Offline duration vs. GC trade-off** | Longer offline support = more tombstones retained = more memory | 30-day grace period as default; configurable per workspace |
| **Block tree depth** | Deeply nested blocks cause O(d) traversal for ancestor checks | Max depth of 20 levels; cycle detection on every move |
| **Fan-out amplification** | N concurrent editors = N-1 broadcast messages per edit | Operation batching; viewport filtering; delta compression |
| **Binary CRDT encoding** | Not human-readable; complicates debugging | Diagnostic tools to decode binary state; structured logging of decoded operations |
| **Cross-document references** | Synced blocks create cross-document dependencies | Reverse index of references; cross-document subscription management |

---

## Assumptions and Dependencies

| Assumption | Risk if Wrong | Mitigation |
|-----------|--------------|------------|
| Average document size is 200 blocks | If documents are 10x larger, CRDT memory and sync payload scale proportionally | Block-level lazy loading; subtree pagination |
| 20% of DAU editing simultaneously at peak | Higher concurrency increases WebSocket and sync server load | Auto-scaling with 3x headroom; load testing at 2x peak |
| Average 2.5 concurrent editors per document | If viral documents regularly hit 100+ editors, fan-out dominates | Dedicated sync server for hot documents; operation batching |
| Client IndexedDB is reliable for offline storage | IndexedDB corruption or browser clearing loses offline edits | Periodic background sync when online; warning before clearing browser data |
| Yjs/Loro CRDT libraries are correct | CRDT bug causes silent divergence (worst-case scenario) | Periodic convergence verification; property-based testing in CI |
| TLS 1.3 is universally supported | Older enterprise browsers may not support TLS 1.3 | TLS 1.2 fallback for legacy environments only |

---

## Case Study: Notion's Offline Architecture Migration (2025)

```
Context:
  Notion launched in 2016 with a server-authoritative data model.
  All edits required a server round-trip for persistence.
  Offline support was limited to a read-only cache.

Problem:
  - Users on flights, trains, and unstable mobile networks couldn't edit
  - Latency in regions far from US servers (India, Southeast Asia) degraded UX
  - Server outages made the entire product unusable

Migration Decision (2024-2025):
  - Migrated from server-authoritative model to CRDT-native architecture
  - Adopted a Yjs-based CRDT layer for real-time sync and offline support
  - Each document's state became a CRDT that lives on every client
  - The server role changed from "source of truth" to "sync relay + persistence"

Key Challenges:
  1. Data migration: Converting billions of existing blocks from server format to CRDT format
     - Solution: Gradual migration with dual-write (old + new format) during transition
  2. Memory overhead: CRDT metadata increased per-document size 3-4×
     - Solution: Block-level lazy loading; Eg-walker for non-collaborative scenarios
  3. Client storage: Each client now stores full CRDT state locally
     - Solution: IndexedDB with OPFS for larger documents; background compaction

Result:
  - Offline editing shipped for web, desktop, and mobile (December 2025)
  - Edit latency dropped from ~200ms (server round-trip) to <5ms (local CRDT)
  - Users in India and Southeast Asia reported 10× improvement in editing responsiveness
  - Server outages no longer block editing — only sync is affected

Lesson:
  Retrofitting offline support into a server-authoritative architecture is a multi-year
  effort. Starting with CRDTs from day one avoids this migration entirely.
```
