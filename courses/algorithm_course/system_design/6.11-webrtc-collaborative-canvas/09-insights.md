# Key Architectural Insights

## Insight 1: Why Pure WebRTC Mesh Fails at Scale

**Category**: Network Architecture

**One-liner**: The O(n²) connection complexity, ~20% NAT traversal failure rate, and TURN bandwidth explosion make pure P2P mesh untenable beyond a handful of peers---server-mediated relay is mandatory at production scale.

**Why it matters**: WebRTC's promise of peer-to-peer communication is seductive for a collaborative canvas: no server in the hot path, lowest possible latency, no relay infrastructure cost. The reality is brutal. With n peers, a full mesh requires n×(n-1)/2 connections. At 10 users that is 45 connections; at 50 users, 1,225. Each connection requires independent ICE negotiation, STUN binding requests, and connectivity checks. Approximately 18-22% of peer pairs cannot establish a direct connection due to symmetric NATs or corporate firewalls, requiring TURN relay at ~50 Kbps per session.

The failure mode is not graceful. A single peer behind a symmetric NAT forces TURN fallback for every connection to that peer, and the TURN server becomes a bandwidth Slowest part of the process for the entire session. In a 20-person workshop, one restrictive network participant can degrade the experience for everyone. The SFU relay model reduces this to O(n) connections---each client connects once to the server, which fans out operations. The server also provides a natural point for permission enforcement, operation logging, and late-joiner state transfer, none of which are possible in a pure mesh. Production canvas tools universally adopt server-mediated architectures despite the latency tax, because reliability at scale is non-negotiable.

---

## Insight 2: Ephemeral vs Durable State---The Core Architectural Split

**Category**: Data Modeling

**One-liner**: Recognizing that cursor positions and shape mutations require fundamentally different transport, persistence, and consistency guarantees is the single most important design decision in a collaborative canvas.

**Why it matters**: A canvas produces two radically different categories of real-time data. Cursor positions, viewport bounds, and selection highlights update at 15-30 Hz per user but have zero historical value---a cursor position from 200ms ago is useless. Shape creation, property changes, and connector updates occur at 1-5 Hz but must be durable, ordered, and conflict-free for all time. Mixing these into a single channel creates 10-30x write amplification in the operation log with no benefit, because every cursor tick would be recorded as a CRDT operation and persisted.

The separation drives architecture at every layer. Ephemeral state uses an unreliable, unordered WebRTC data channel (UDP semantics) where dropped packets are acceptable---the next cursor update supersedes the lost one. Durable state uses a reliable, ordered channel (TCP semantics) backed by CRDT merge and an append-only operation log. The persistence service never sees cursor data. The CRDT engine never processes cursor positions. This clean split means the cursor relay server can be a lightweight, stateless pub/sub broadcaster, while the CRDT sync engine is a heavier stateful service with snapshot management. Scaling each independently is trivial because they share no state.

---

## Insight 3: CRDTs for 2D Spatial Data vs Text

**Category**: Consistency Model

**One-liner**: Spatial data lacks the linear ordering that text CRDTs exploit, requiring a composition of LWW-Map for properties and fractional indexing for z-order, with unique tombstone challenges from frequent delete-and-recreate patterns.

**Why it matters**: Text CRDTs solve a well-defined problem: maintaining a consistent linear sequence under concurrent inserts and deletes. Canvas CRDTs face a fundamentally different challenge. A shape has a position (x, y), dimensions, rotation, fill color, stroke style, and z-order---each an independent property that can be concurrently modified. There is no natural ordering of positions in 2D space; two users dragging the same shape to different coordinates is a conflict that LWW-Register resolves by timestamp, not by finding a "merged position" that satisfies both.

Z-ordering adds a second layer of complexity. Objects must have a total order for rendering (back-to-front), and operations like "bring to front" or "move behind shape X" must be represented as CRDT operations. Fractional indexing assigns each object a rational number between its neighbors, allowing concurrent reordering without conflicts. But the indices grow in precision over time (0.5, 0.25, 0.375, 0.3125...) and eventually require rebalancing. Canvas workflows also exhibit a delete-and-recreate pattern (undo, then redo with modifications) that generates tombstones faster than text editing. A board with 10,000 live objects may carry 20,000+ tombstones, requiring periodic garbage collection coordinated across all replicas.

---

## Insight 4: TURN Server Costs as an Architecture Driver

**Category**: Infrastructure Economics

**One-liner**: At 50 Kbps per relayed session across hundreds of thousands of concurrent users, TURN bandwidth becomes a six-figure monthly cost center that fundamentally shapes transport decisions.

**Why it matters**: TURN relay is the fallback when direct peer connections fail, and it fails for roughly one in five connections. At 500K concurrent sessions, that means ~100K TURN-relayed sessions consuming 5 Gbps of relay bandwidth. At typical cloud egress pricing, this translates to approximately $64,000/month just for TURN---on top of the infrastructure to run globally distributed relay servers with low latency. By contrast, routing the same traffic through existing WebSocket infrastructure costs a fraction, because the WebSocket servers are already provisioned for non-WebRTC clients.

This cost asymmetry is why production canvas platforms like Miro use WebSocket as their primary transport and treat WebRTC data channels as a progressive enhancement for clients that achieve direct P2P connectivity. The architecture must function correctly with WebSocket alone; WebRTC reduces latency for the lucky ~80% who can connect directly, but the system never depends on it. This also drives decisions to minimize real-time operation frequency: delta compression, batching cursor updates into 50ms windows, and sending simplified stroke data all reduce per-session bandwidth, directly translating to TURN cost savings.

---

## Insight 5: Infinite Canvas as a Distributed Scaling Problem

**Category**: Rendering & Sync

**One-liner**: The infinite canvas is not just a UI challenge---10,000+ objects require spatial indexing, viewport culling, level-of-detail rendering, and progressive loading, all compounded by real-time synchronization.

**Why it matters**: An infinite 2D coordinate plane means users can place objects anywhere and zoom from 10x (inspecting a single text label) to 0.1x (viewing an entire project board with 50,000 objects). The rendering pipeline must answer "which objects are visible in this viewport?" in under 1ms for smooth panning at 60 FPS. An R-tree spatial index makes viewport queries logarithmic, but the index itself must be maintained as objects are created, moved, and deleted in real time---including moves from remote collaborators arriving over the network.

At low zoom levels, rendering every detail of thousands of visible objects would crush the frame budget. Level-of-detail rendering replaces text with gray placeholders below 8px, simplifies freehand strokes to bounding boxes, and substitutes image thumbnails---all dynamically based on zoom. For boards exceeding 50,000 objects, spatial chunking divides the canvas into grid cells loaded on demand, with distant chunks evicted from memory. The compounding challenge is that CRDT synchronization cannot naively sync all objects every frame; the sync engine must be viewport-aware, prioritizing operations on visible objects and deferring updates to off-screen regions.

---

## Insight 6: CRDT Operation Log Compaction via Snapshotting

**Category**: Storage & Performance

**One-liner**: Without periodic snapshotting, the CRDT operation log grows unbounded, making it impossible for new joiners to load a board that has accumulated a million operations since creation.

**Why it matters**: Every CRDT operation---shape creation, property change, move, delete---is appended to an immutable log. A board actively used for six months may accumulate 500K-1M operations. Replaying this entire log to reconstruct the current state would take tens of seconds, making the board load experience unacceptable. Snapshotting captures the full materialized CRDT state at a point in time, so loading a board requires only the latest snapshot plus the operations that occurred after it.

The snapshot strategy balances freshness against cost: creating a snapshot every 200 operations or 10 minutes ensures that at most 200 operations need replay on load. Snapshots are stored in object storage and cached in a key-value store for hot boards. The subtlety is that snapshots must preserve CRDT metadata (vector clocks, tombstones, fractional indices) to maintain merge capability---a snapshot is not merely a "current state dump" but a full CRDT state that can accept concurrent operations from offline peers who haven't seen the snapshotted operations. Old operations before the snapshot are retained for version history and undo but can be compacted after 30 days, reclaiming storage while preserving the ability to roll back to any snapshot.

---

## Insight 7: Connector Routing as a Real-Time Consistency Problem

**Category**: Domain Complexity

**One-liner**: Connectors between shapes must reroute around obstacles when endpoints move, and concurrent moves of connected shapes create routing conflicts that text editors never face.

**Why it matters**: A connector between Shape A and Shape B must find an orthogonal path that avoids intersecting other shapes, using obstacle-aware pathfinding (visibility graph + A* search). When a user drags Shape A, every connector attached to it must reroute in real time---potentially 10+ connectors on a densely connected diagram. This pathfinding must complete within a single frame (16ms) to avoid visible lag during drag.

The deeper architectural insight is that connector routes are derived state, not stored state. The CRDT stores only which objects are connected and the anchor points; the actual path is computed client-side from the current positions of connected objects. This avoids CRDT conflicts on route geometry when shapes move concurrently. If two users simultaneously move opposite endpoints of the same connector, each client independently recomputes the route and arrives at the same result because the CRDT-converged endpoint positions are identical. During active drag, routes are approximated as straight lines for performance, with full obstacle-aware pathfinding deferred to drag-end. This optimization trades visual precision during interaction for consistent 60 FPS rendering.

---

## Insight 8: Freehand Drawing---The High-Frequency Operation Problem

**Category**: Real-Time Performance

**One-liner**: Freehand strokes generate 60+ points per second that cannot each be individual CRDT operations; the solution splits drawing into an ephemeral streaming phase and a single CRDT commit on stroke completion.

**Why it matters**: When a user draws freehand, the pointer generates events at 60-120 Hz. If each point were a CRDT operation, a 3-second stroke would produce 180-360 operations with full vector clocks, causal metadata, and persistence overhead. Multiply by 10 concurrent drawers and the system drowns in operation traffic. The solution is a two-phase approach: during drawing, raw points stream over the ephemeral (unreliable) channel to other participants for live preview. On stroke completion (pointer up), the client applies Ramer-Douglas-Peucker simplification and Bezier curve fitting, reducing 500 raw points to approximately 25-80 control points---a 85-95% reduction. This simplified stroke becomes a single CRDT operation that is persisted and merged.

Remote participants see the stroke being drawn in real time via the ephemeral channel (with some jitter and possible dropped points, which is acceptable for a preview) and then see it "snap" to the final simplified version when the CRDT operation arrives. The visual difference is imperceptible because Bezier fitting preserves the stroke's visual character. This pattern---ephemeral preview followed by durable commit---is reusable for any high-frequency canvas operation: laser pointer trails, eraser strokes, lasso selections, and real-time shape resize all benefit from the same two-phase approach.

---

## Insight 9: Tombstone Garbage Collection Is a Distributed Coordination Problem That CRDTs Were Supposed to Eliminate

**Category**: Distributed Systems

**One-liner**: CRDTs promise coordination-free merging, but tombstone garbage collection reintroduces the coordination requirement they were designed to avoid---creating an architectural tension between merge safety and unbounded metadata growth.

**Why it matters**: When a user deletes a shape, the CRDT cannot simply remove it. An offline peer who hasn't yet received the delete might create a concurrent operation on the same shape. If the deleted shape's record is gone, the offline peer's operation would "resurrect" it. CRDTs solve this with tombstones: deleted objects are marked as deleted but retained in the data structure. Over time, tombstones accumulate. A board actively used for 6 months with frequent create-delete cycles (brainstorming, reorganizing) may carry 20,000+ tombstones alongside 5,000 live objects---quadrupling the CRDT state size.

Garbage collecting tombstones requires knowing that every replica has observed the delete operation. This is precisely the kind of distributed coordination that CRDTs were designed to avoid. The practical solution is a "causal stability" threshold: if all known replicas have acknowledged operations up to vector clock V, tombstones with timestamps before V can be safely removed. But "all known replicas" includes offline peers who may not reconnect for days or weeks. The system must balance tombstone accumulation (degrades performance) against premature GC (causes resurrection bugs). A 7-day GC window with forced re-sync for peers offline longer than 7 days is the common production trade-off.

---

## Insight 10: Viewport-Aware Synchronization Transforms CRDT Sync from O(total) to O(visible)

**Category**: Performance Architecture

**One-liner**: Naively syncing all CRDT operations to all clients wastes bandwidth and CPU on objects that no participant can see---viewport-aware sync prioritizes visible operations, creating a dramatic efficiency improvement for large boards.

**Why it matters**: Consider a board with 50,000 objects. At any given moment, each user's viewport shows perhaps 200 objects. Naively, every CRDT operation on any object is broadcast to every connected client, meaning 49,800 operations per frame are for objects no one is currently looking at. On a 300-user session with 50,000 objects, this produces catastrophic bandwidth waste.

Viewport-aware sync introduces a spatial filter at the relay layer. Each client periodically reports its viewport bounds (x, y, width, height at current zoom) to the relay server. The relay only forwards operations on objects within or near any client's viewport. Operations on distant objects are queued and delivered when a client pans or zooms to include them. This reduces steady-state bandwidth by 10–50x for large boards.

The subtlety is that the CRDT must still maintain global consistency. Operations on off-screen objects are not discarded---they are deferred. When a client pans to a new region, the relay delivers the backlog of deferred operations for that region, and the client's CRDT state catches up. The client may see a brief "loading" state for the newly visible region while deferred operations are applied. This is acceptable because users cannot see the inconsistency during the pan animation---by the time rendering stabilizes, the CRDT has converged.

---

## Insight 11: The Board Load Problem Is Fundamentally Different from Document Load Because State Size Grows with Total History, Not Current Content

**Category**: Storage Architecture

**One-liner**: A text document's load time is proportional to its current length, but a canvas board's load time is proportional to its total operation history unless actively managed through snapshotting---and the snapshot strategy is itself a complex distributed systems problem.

**Why it matters**: A Google Doc with 10 pages loads in roughly the same time whether it was written in one session or edited over 6 months. The server sends the current document content; the editing history is separate. A canvas board's CRDT state includes the entire operation history needed to reconstruct the current state: every shape created, moved, resized, and deleted. A board actively used for 6 months may have 500K–1M operations. Replaying this log takes seconds to tens of seconds, making the board load experience unacceptable.

Snapshotting solves this by capturing the full materialized CRDT state at a point in time. Loading requires only the latest snapshot plus operations since the snapshot. The interval between snapshots (every 200 operations or 10 minutes) determines worst-case load time: at most 200 operations to replay. But snapshots themselves are complex: they must preserve CRDT metadata (vector clocks, tombstones, fractional indices) to remain mergeable with operations from peers who haven't seen the snapshot. A snapshot is not a "current state dump" but a full CRDT state that can accept concurrent operations from offline peers.

The GC question compounds this: operation log entries before the latest snapshot can be compacted to save storage, but they must be retained for version history (undo to any point in time) and audit trails. The system needs two retention policies: one for operational efficiency (compact after snapshot) and one for product features (retain for version history). These frequently conflict.

---

## Insight 12: AI-Generated Canvas Operations Must Enter the CRDT Pipeline, Not Bypass It

**Category**: AI Integration

**One-liner**: When an AI generates a diagram from a natural language prompt, the resulting shapes and connectors must be applied as standard CRDT operations---not as server-side mutations---to preserve composition with concurrent human edits, undo semantics, and offline merge guarantees.

**Why it matters**: AI features (auto-layout, diagram generation, sticky note clustering) are becoming standard in collaborative canvas products. The tempting implementation is to treat AI as a privileged server-side actor that directly modifies board state in the database. This breaks every guarantee the CRDT architecture provides. If a human is editing the board while AI generates a diagram, server-side mutations bypass the CRDT merge logic and may overwrite concurrent human operations. AI-generated objects won't appear in the undo history. Offline peers who merge their state will miss AI changes or conflict with them unpredictably.

The correct architecture treats AI as another CRDT peer. The AI service receives the current board state (or a read-only snapshot), generates a batch of CRDT operations (create shape, set properties, create connectors), and submits them through the same sync channel as human operations. The CRDT engine merges AI operations with concurrent human operations using the same conflict resolution rules. AI operations appear in the undo stack and can be reverted individually. Offline peers who reconnect receive AI operations through the normal sync protocol.

The performance implication is that AI operations must be batched carefully. An AI generating 500 shapes and 200 connectors in a single burst would flood the CRDT operation log and cause rendering lag for all connected clients. The architecture must throttle AI operation injection to a rate that the rendering pipeline can absorb---typically 50–100 operations per frame (16ms), with visual progress indication as the AI "draws" the diagram incrementally.
