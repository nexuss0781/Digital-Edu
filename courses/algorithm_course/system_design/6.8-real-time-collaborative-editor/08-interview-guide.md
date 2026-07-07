# Interview Guide

## Interview Pacing (45-Minute Format)

| Time | Phase | Focus | Key Points |
|------|-------|-------|------------|
| 0-5 min | **Clarify** | Scope the problem | Block-based vs linear? Offline required? Scale? |
| 5-10 min | **Requirements** | Core features, non-functionals | Block model, real-time sync, offline, presence |
| 10-20 min | **High-Level Design** | Architecture, data flow | Client-server CRDT, WebSocket, block tree, operation log |
| 20-35 min | **Deep Dive** | 1-2 critical components | CRDT merge engine, block tree conflicts, OR offline sync |
| 35-42 min | **Scale & Trade-offs** | Bottlenecks, failure scenarios | Fan-out, memory, OT vs CRDT trade-offs |
| 42-45 min | **Wrap Up** | Summary, extensions | Synced blocks, database views, search |

---

## Meta-Commentary

### What Makes This System Unique/Challenging

1. **Three CRDT types must compose**: Unlike a chat system (just sequence CRDT) or a config system (just map CRDT), a block editor needs Sequence + Tree + Map CRDTs working together coherently. This is the core intellectual challenge.

2. **The block model changes everything**: If you approach this as "Google Docs with better structure," you'll miss that tree-structural operations (move, nest, reparent) create an entirely different conflict domain than text operations.

3. **Offline is not a feature---it's an architecture**: You can't bolt offline onto an OT-based system. The choice of CRDT is an architectural commitment that affects every layer.

4. **Presence is architecturally separate from sync**: Mixing ephemeral cursor data with durable document data is a common mistake. They have different persistence, consistency, and bandwidth requirements.

### Where to Spend Most Time

In the 45-minute interview, spend **60% of deep dive time on the CRDT merge engine and conflict resolution**. This is where the real system design thinking happens:

- How do concurrent block moves resolve?
- What happens when someone deletes a block that another user is moving into?
- How does the system handle 48 hours of offline edits merging?

### How to Approach This Specific Problem

1. **Start with the data model**: "Everything is a block with a UUID." This single statement shapes the entire architecture.
2. **Establish OT vs CRDT early**: Make the decision and justify it (offline requirement drives CRDT).
3. **Draw the block tree**: Show how blocks nest and how operations (insert, move, delete) affect the tree.
4. **Show the sync protocol**: State vector exchange for efficient delta sync.
5. **Discuss failure modes**: Concurrent moves, delete-while-editing, cycle creation.

---

## Trade-offs Discussion

### Trade-off 1: OT vs CRDT

| Decision | OT (Google Docs approach) | CRDT (Notion/AFFiNE approach) |
|----------|--------------------------|-------------------------------|
| | **Pros**: Lower memory overhead; simpler for linear text; proven at Google scale | **Pros**: Offline-first natively; peer-to-peer possible; mathematically guaranteed convergence |
| | **Cons**: No offline support; N-squared transform functions; central server Slowest part of the process | **Cons**: 4-32x memory overhead per character; complex to implement correctly |
| **Recommendation** | Choose CRDT if offline editing is a requirement (it usually is for modern productivity tools) |

### Trade-off 2: Block-Level vs Character-Level CRDT Granularity

| Decision | Character-Level CRDT (full document) | Block-Level CRDT (per block) |
|----------|--------------------------------------|------------------------------|
| | **Pros**: Simplest model; one CRDT state per document | **Pros**: Independent loading per block; smaller sync payloads; block-level GC |
| | **Cons**: Entire CRDT must load for any edit; large memory footprint | **Cons**: Cross-block operations require coordination; more complex state management |
| **Recommendation** | Block-level for production systems (enables lazy loading and reduces memory pressure) |

### Trade-off 3: Server-Authoritative vs Pure Peer-to-Peer

| Decision | Server-Authoritative (Notion) | Pure P2P (Local-first) |
|----------|-------------------------------|------------------------|
| | **Pros**: Central permission enforcement; audit trail; easier ops | **Pros**: Works without any server; maximum privacy; zero-latency |
| | **Cons**: Server is a dependency for sync (though not for editing) | **Cons**: No central permission model; discovery problem; harder backup |
| **Recommendation** | Server-assisted for enterprise/team tools; P2P for personal/privacy-focused tools |

### Trade-off 4: Tombstones vs Garbage Collection

| Decision | Keep All Tombstones | Garbage Collect |
|----------|---------------------|-----------------|
| | **Pros**: Simple; no coordination needed; supports arbitrary-length offline | **Pros**: Reduced memory; faster document loading; smaller sync payloads |
| | **Cons**: Unbounded memory growth; 50%+ of CRDT can be tombstones | **Cons**: Requires all replicas to agree on GC point; breaks very-long-offline clients |
| **Recommendation** | GC with a grace period (e.g., 30 days); clients offline longer must do full document reload |

### Trade-off 5: Eg-walker vs Traditional CRDT

| Decision | Traditional CRDT (Yjs/Automerge) | Eg-walker (Hybrid) |
|----------|----------------------------------|---------------------|
| | **Pros**: Well-understood; large ecosystem; production-proven | **Pros**: 10-100x less memory; fast merging; best of OT and CRDT |
| | **Cons**: Persistent metadata overhead; large state for big documents | **Cons**: Newer algorithm; smaller ecosystem; more complex implementation |
| **Recommendation** | Traditional CRDT for most use cases; Eg-walker for code editors or memory-constrained environments |

---

## Trap Questions & How to Handle

| Trap Question | What Interviewer Wants | Best Answer |
|---------------|------------------------|-------------|
| "Why not just use a database with row locking?" | Understand why DB transactions don't work for real-time editing | "Row locking would mean only one user edits at a time. We need concurrent edits with <50ms latency. Locking at character or block level is infeasible. CRDTs solve this by making all operations commutative---no locks needed." |
| "What if two users type the same character at the same position?" | Understand CRDT conflict resolution for text | "The CRDT assigns each character a unique ID with left/right origins. Concurrent insertions at the same position are ordered deterministically using the Fugue algorithm to prevent interleaving. Both users' characters appear, grouped by author." |
| "Can't you just use Git for version control?" | Understand difference between file-level and character-level merging | "Git operates on line-level diffs and requires manual conflict resolution. A collaborative editor needs character-level, real-time merging with zero user intervention. CRDTs provide automatic, always-correct merging at the keystroke level." |
| "Why not store operations in a Kafka topic and replay?" | Test understanding of CRDT vs event sourcing | "Good for the operation log, but Kafka alone doesn't solve conflict resolution. You still need a CRDT or OT algorithm to determine how concurrent operations merge. Kafka provides ordering and durability; CRDTs provide convergence." |
| "What happens with 10,000 concurrent editors?" | Test scaling thinking | "At that scale, we shard the broadcast. Not all 10K users need every keystroke---most are viewing, not editing. We batch operations (50ms windows), compress deltas, and use viewport-based filtering to only send relevant updates. For truly massive docs, we paginate the block tree." |
| "How do you handle a user who's been offline for 6 months?" | Test understanding of CRDT garbage collection trade-offs | "If we've garbage-collected tombstones, a 6-month-old client can't incrementally sync. We detect this via state vector comparison---if the gap is too large, we send a full snapshot instead of a delta. The client resets its state to the snapshot and syncs forward." |
| "What if someone pastes 1GB of text?" | Test input validation and limits | "We enforce limits at multiple layers: client-side validation (max block size), WebSocket message size limits, and server-side schema validation. A 1GB paste would be rejected at the client before it ever reaches the network." |

---

## Common Mistakes to Avoid

| Mistake | Why It's Wrong | Better Approach |
|---------|---------------|-----------------|
| Starting with the database schema | Premature; the hard problem is conflict resolution, not storage | Start with the block data model and CRDT algorithm |
| Describing only text editing | Missing the block-based tree structure | Explicitly discuss block operations: move, nest, transform |
| Using "eventual consistency" without qualifying | Suggests data loss is acceptable | Say "strong eventual consistency"---CRDTs guarantee convergence |
| Ignoring offline entirely | Major requirement for modern editors | Make offline a first-class architectural decision (drives CRDT choice) |
| Conflating presence with document sync | Different consistency, persistence, and frequency requirements | Explicitly separate presence as an ephemeral, best-effort channel |
| Saying "just add more servers" for scaling | Doesn't address document-level fan-out Slowest part of the process | Discuss operation batching, delta compression, viewport filtering |
| Using HTTP polling for real-time sync | Too high latency; too much overhead | WebSocket with persistent connection; binary CRDT deltas |

---

## Questions to Ask Interviewer

| Question | Why It Matters |
|----------|---------------|
| "Is offline editing a hard requirement?" | Drives the entire OT vs CRDT decision |
| "What's the expected scale---concurrent editors per document?" | Shapes fan-out strategy |
| "Is this block-based (Notion-style) or linear (Google Docs-style)?" | Determines data model complexity |
| "Are there enterprise requirements like permissions, audit, compliance?" | Adds server-authoritative validation layer |
| "Is real-time presence (multiplayer cursors) required?" | Adds presence subsystem |
| "What types of content? Just text, or also tables, databases, embeds?" | Determines block type complexity |
| "What's the target latency for edit propagation?" | Shapes batching and compression decisions |

---

## Quick Reference Card

### The 5-Sentence Architecture Summary

1. Everything is a UUID-identified **block** in a tree hierarchy, with each block containing typed properties and optional rich text content.
2. Document state is managed by a **composite CRDT** (Sequence CRDT for text + Tree CRDT for hierarchy + Map CRDT for properties) that guarantees convergence without a central server.
3. Edits are applied **optimistically on the client** (zero latency), persisted to **local storage** (offline safety), then synced via **WebSocket** to a sync server that broadcasts to peers.
4. **Offline editing** works natively because CRDTs merge without server coordination; reconnection uses **state vector exchange** to sync only missing operations.
5. **Presence** (cursors, selections) is a separate ephemeral channel that does not pollute the durable operation log.

### Key Numbers to Remember

| Metric | Value |
|--------|-------|
| Local edit latency | <5ms |
| Edit propagation (p50/p99) | 50ms / 300ms |
| CRDT memory overhead per char | 4-32 bytes |
| State vector exchange (sync) | ~128 bytes typical |
| WebSocket message size (delta) | 50-200 bytes |
| Max concurrent editors per doc | 200 (soft limit) |
| Offline merge rate | 100K ops/sec |
| Snapshot interval | Every 100 ops or 5 min |

---

## Extension Questions

Use these to demonstrate depth after covering the core design.

### Extension 1: How would you add real-time comments anchored to text ranges?

**Key challenge**: Comment anchors must survive concurrent edits that insert/delete text around the anchored range.

**Approach**: Anchor comments to CRDT item IDs, not integer offsets. A comment stores `(start_item_id, end_item_id)`. As text changes, the CRDT item IDs remain stable---the comment always covers the correct characters. When the anchored text is fully deleted, the comment becomes "orphaned" and is shown as a resolved/archived comment rather than silently discarded.

**Thread model**: Comments are stored as a separate CRDT Map (comment_id → comment data) with back-references to the document block. Comment threads are a list CRDT of replies. This keeps comment state independent from document content state, avoiding unnecessary conflict domains.

### Extension 2: How would you implement real-time collaboration on a 50,000-block knowledge base?

**Key challenge**: Loading 50K blocks' CRDT state into memory at once is infeasible on both client and server.

**Approach**: Block-level lazy loading with subtree pagination. The client loads only the root block and 2 levels of children (visible in the sidebar). As the user scrolls, blocks are loaded on-demand. The sync server similarly partitions: each sync server instance holds CRDT state for a subtree, not the entire document. Cross-subtree operations (e.g., moving a block from page 5 to page 42) require cross-server coordination via the message bus.

**Threshold**: Documents under 1,000 blocks load fully; over 1,000, lazy loading activates.

### Extension 3: How would you add AI-assisted writing (autocomplete, summarize) to the editor?

**Key challenge**: AI-generated text must integrate seamlessly with the CRDT without creating attribution confusion.

**Approach**: AI suggestions are presented as "ghost text" (rendered but not in the CRDT). When the user accepts a suggestion, it becomes a normal CRDT insert operation attributed to the AI system user. This ensures:
- Suggestions are ephemeral until accepted (no CRDT pollution)
- Accepted text appears in version history with AI attribution
- Other collaborators see the insertion as a normal edit
- Undo reverses the entire AI insertion as one unit

### Extension 4: How would you handle a compromised client sending malicious CRDT operations?

**Key challenge**: CRDT merges always succeed by design---you cannot "reject" a CRDT operation without breaking convergence guarantees.

**Approach**: Two-phase validation. The sync server applies the operation to a sandboxed CRDT copy, validates the result (schema, size limits, rate limits, content policy), and only commits to the authoritative CRDT if validation passes. If validation fails, the operation is discarded and the client receives a NACK. The client must then reset its local CRDT state from the server snapshot, effectively rolling back the malicious operation.

---

## Case Study Walkthrough: NoteForge (Team Knowledge Base Startup)

### Context

NoteForge is building a Notion-like collaborative workspace for mid-size engineering teams (50-200 engineers). Key requirements: block-based editor, real-time collaboration, offline support for remote workers, API access for integrations, SOC 2 compliance.

### Design Challenge 1: Data Model

**Interviewer**: "How would you model documents?"

**Answer**: Everything is a block with a UUID. A "document" is simply a root block of type `page`. Pages can contain other pages (sub-pages), creating a workspace tree. Each block stores its `parent_id`, `type`, `properties` (Map CRDT), inline `text` (Sequence CRDT), and its children ordering is managed by a Sequence CRDT on the parent. This single abstraction handles paragraphs, headings, images, tables, and even databases.

### Design Challenge 2: Offline for a Flight (4-Hour Gap)

**Interviewer**: "A developer edits on a 4-hour flight. What happens on landing?"

**Answer**: During the flight, all edits are applied to the local CRDT and persisted to IndexedDB. On reconnect:
1. Client sends its state vector (128 bytes) to the sync server
2. Server computes the diff: operations the client missed during 4 hours
3. Client computes its diff: the 4 hours of offline edits
4. Both exchange diffs and merge (CRDT guarantees convergence)
5. If the diff is large (>10K operations), the server sends a full snapshot first

**Follow-up**: "What if someone deleted a section the offline user was editing?"

The offline user's edits to deleted blocks create an orphan rescue: the CRDT preserves the content, and the system re-attaches the edited blocks to the deleted block's former parent position. The user sees their edits preserved but relocated.

### Design Challenge 3: 200-Person All-Hands Document

**Interviewer**: "200 people open the meeting notes simultaneously."

**Answer**: At 200 concurrent editors:
- Raw operation rate: ~400 ops/sec (200 users × 2 ops/sec)
- Broadcast fan-out: each operation goes to 199 peers
- This produces 80K messages/sec on the WebSocket tier

Optimizations:
1. **Operation batching**: Aggregate ops in 50ms windows → 8 batches/sec × 199 = 1,592 messages/sec
2. **Delta compression**: Binary diff encoding reduces payload by 70%
3. **Viewport filtering**: Users viewing page 2 don't need edits to page 5
4. **Dedicated sync server**: This document gets its own server instance (bulkhead pattern)

### Whiteboard Sequence

```
1. Draw the block tree: root → page → heading, paragraph, list, image
2. Show composite CRDT: Sequence (text) + Tree (hierarchy) + Map (properties)
3. Draw client-server sync: Client → WebSocket → Sync Server → Operation Log
4. Show offline flow: Client → IndexedDB → (reconnect) → State Vector Exchange
5. Mark the hot path: keystroke → local CRDT → render (no network in the loop)
```

---

## Whiteboard Diagram Checklist

| Component | Must Include | Common Mistakes |
|-----------|-------------|-----------------|
| **Client Editor** | Local CRDT state, IndexedDB storage | Forgetting client-side persistence |
| **WebSocket Gateway** | Sticky sessions by document | Routing all traffic to one server |
| **Sync Server** | CRDT merge engine, document sharding | Making it stateless (it holds CRDT state in memory) |
| **Presence Channel** | Separate from document sync | Mixing presence with operation log |
| **Operation Log** | Append-only, partitioned by document | Using a relational DB for high-frequency writes |
| **Snapshot Store** | Periodic full CRDT state | Relying only on op log replay (too slow for large docs) |
| **Cache Layer** | Hot document CRDT states | Single-layer cache (need L1 client + L2 server + L3 distributed) |
| **Block Tree** | UUID blocks, parent-child, types | Flat character sequence (that's Google Docs, not Notion) |
| **Offline Flow** | IndexedDB → reconnect → state vector exchange | Requiring server for any editing |
| **Search Service** | Async indexing from operation stream | Synchronous indexing on write path |
| **Version Service** | Snapshot + op replay for point-in-time | Only storing latest state |
| **Permission Model** | Server-authoritative validation on merge | Trusting client-side permission checks |
| **Message Bus** | Cross-shard broadcast for sync servers | Direct server-to-server connections |
| **Merge Server** | Queue-based offline reconciliation | Using the sync server for heavy merges |

---

## Red Flags in Candidate Responses

| Red Flag | Why It's Concerning | What to Listen For Instead |
|----------|--------------------|-----------------------------|
| "We'll use a database with row locking" | Shows no understanding of real-time concurrent editing | "CRDTs make operations commutative—no locks needed" |
| "We'll use HTTP polling for sync" | Too high latency, too much overhead | "WebSocket with persistent connections and binary CRDT deltas" |
| "Eventual consistency is fine" | Vague; doesn't convey CRDT guarantees | "Strong eventual consistency—CRDTs mathematically guarantee convergence" |
| No mention of offline | Missing a core architectural requirement | "Offline-first drives the CRDT choice; edits persist to local storage first" |
| "Just add more servers" | Doesn't address document-level fan-out | "Operation batching, delta compression, viewport filtering for hot docs" |
| Cursor positions stored in the CRDT | Massive write amplification | "Presence is an ephemeral channel, separate from document sync" |
| "Merge conflicts require user resolution" | That's Git, not a real-time editor | "CRDTs resolve all conflicts automatically and deterministically" |
| No mention of tombstones or GC | Missing the CRDT memory management story | "Tombstones accumulate; we need a GC strategy with a grace period" |

---

## Follow-Up Questions for Depth Assessment

### CRDT Mechanics
1. "Walk me through what happens byte-by-byte when two users type at the exact same position simultaneously."
2. "How does a CRDT sequence avoid interleaving characters from different users? What algorithm solves this?"
3. "If we've garbage-collected tombstones, what happens when a 2-month-offline client reconnects?"

### System Design
4. "How would you shard the sync server tier? What's the implication when two documents reference the same synced block?"
5. "What's the cost model? Walk me through the infrastructure cost per active document."
6. "How would you test that all replicas converge? How do you catch a CRDT implementation bug in production?"

### Scale and Performance
7. "A document has 50,000 blocks and 10 concurrent editors. What's the memory footprint on the sync server? How would you optimize?"
8. "What's the maximum offline duration you'd support, and what architectural trade-off does that create?"

### Security and Enterprise
9. "An admin revokes a user's edit permission while that user is offline editing. Walk through what happens on reconnect."
10. "How would you implement end-to-end encryption in a CRDT-based editor without breaking server-side search and indexing?"
