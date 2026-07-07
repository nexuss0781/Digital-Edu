# Interview Guide

[Back to Index](./00-index.md)

---

## Interview Pacing (45-minute format)

| Time | Phase | Focus | What to Cover |
|------|-------|-------|---------------|
| **0-5 min** | Clarify | Scope & requirements | Offline duration, terminal count, AI features needed |
| **5-15 min** | High-Level | Architecture | Three-tier design, mDNS, leader election concept |
| **15-30 min** | Deep Dive | Pick 1-2 components | CRDTs OR Raft OR Edge AI (based on interviewer interest) |
| **30-40 min** | Scale & Trade-offs | Bottlenecks, failures | Sync bandwidth, split brain, model drift |
| **40-45 min** | Wrap Up | Summary, extensions | Multi-store, global rollout, future AI features |

---

## Phase-by-Phase Strategy

### Phase 1: Clarify (0-5 min)

**Essential Questions to Ask:**

1. "What's the expected offline duration we need to support? Hours? Days?"
   - *Impacts storage requirements and sync strategy*

2. "How many terminals per store, and how many stores total?"
   - *Impacts leader election complexity and cloud scale*

3. "Which AI features are highest priority: product recognition, fraud detection, or voice?"
   - *Impacts model size, latency requirements*

4. "What payment methods need to work offline?"
   - *Card-not-present has compliance implications*

5. "Any specific compliance requirements? PCI-DSS is assumed, but GDPR? HIPAA?"
   - *Impacts data handling, retention*

**Scope Statement Example:**
> "So we're designing an offline-first POS for a retail chain with ~50K stores, 5 terminals each, needing 24+ hour offline capability with embedded AI for product recognition and fraud detection. The system should sync inventory and transactions across terminals in real-time locally, and batch sync to cloud every 15 minutes when online. PCI-DSS compliant."

### Phase 2: High-Level Design (5-15 min)

**Draw This Architecture:**

```
┌─────────────────────────────────────────────────────────────────┐
│                           STORE                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                       │
│  │Terminal 1│←→│Terminal 2│←→│Terminal 3│  (mDNS Discovery)     │
│  │ Edge AI  │  │ Edge AI  │  │ Edge AI  │                       │
│  │ SQLite   │  │ SQLite   │  │ SQLite   │                       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                       │
│       │             │             │                              │
│       └──────┬──────┴──────┬──────┘                              │
│              │             │                                     │
│         ┌────┴─────┐  ┌────┴─────┐                              │
│         │  Raft    │  │  CRDT    │                              │
│         │ Election │  │  Sync    │                              │
│         └────┬─────┘  └────┬─────┘                              │
│              │             │                                     │
│         ┌────┴─────────────┴────┐                               │
│         │      LEADER           │                               │
│         │  (Sync Coordinator)   │                               │
│         └───────────┬───────────┘                               │
│                     │                                            │
└─────────────────────┼────────────────────────────────────────────┘
                      │ (When Online)
                      ▼
              ┌───────────────┐
              │  CLOUD API    │
              │  Event Store  │
              │  Master DB    │
              └───────────────┘
```

**Key Points to Mention:**
- **Three-tier**: Terminal → Leader → Cloud
- **Offline-first**: Local operations never blocked
- **CRDTs**: Conflict-free replication (no coordination needed)
- **Raft**: Leader election for sync coordination
- **mDNS**: Zero-config terminal discovery

### Phase 3: Deep Dive (15-30 min)

**Option A: Deep Dive into CRDTs**

*If interviewer asks about conflict resolution:*

1. **Explain the problem:**
   "When two terminals sell the last item simultaneously, who wins?"

2. **Introduce CRDTs:**
   "We use Conflict-free Replicated Data Types. For inventory, a PN-Counter."

3. **Walk through example:**
   ```
   Initial: 10 items
   Terminal A sells 3: N[A] = 3
   Terminal B sells 2: N[B] = 2

   Merge: P[initial]=10, N[A]=3, N[B]=2
   Value = 10 - 3 - 2 = 5 ✓
   ```

4. **Address edge cases:**
   "For true conflicts (both sell last item), we detect negative inventory post-sync and use AI to decide which transaction to flag for review."

**Option B: Deep Dive into Leader Election (Raft)**

*If interviewer asks about coordination:*

1. **Explain why leader:**
   "We need one terminal to coordinate cloud sync and avoid duplicate uploads."

2. **Describe Raft basics:**
   - Terms, heartbeats, election timeout
   - Majority vote requirement
   - Log replication for state

3. **Failover scenario:**
   ```
   T+0:     Leader crashes
   T+300ms: Followers detect (no heartbeat)
   T+350ms: Random timeout, candidate emerges
   T+400ms: Votes received, new leader
   T+500ms: Heartbeats resume
   ```

4. **Handle split-brain:**
   "Smaller partition cannot get majority, enters read-only mode."

**Option C: Deep Dive into Edge AI**

*If interviewer asks about AI features:*

1. **Model selection:**
   "We use TensorFlow Lite with INT8 quantization for ~50MB models."

2. **Deployment:**
   "Models are signed, versioned, and updated via cloud sync."

3. **Inference flow:**
   ```
   Camera frame → Preprocess → TFLite Interpreter → Product ID + Confidence
   ```

4. **Fallback strategy:**
   "If confidence < 70% or model fails, fallback to manual barcode entry."

### Phase 4: Scale & Trade-offs (30-40 min)

**Discuss These Trade-offs:**

| Decision | Option A | Option B | Our Choice |
|----------|----------|----------|------------|
| **Consistency** | Strong (via leader) | Eventual (CRDTs) | **Eventual** - availability > consistency |
| **Sync frequency** | Real-time to cloud | Batch (15 min) | **Batch** - bandwidth, offline-first |
| **AI location** | Cloud inference | Edge inference | **Edge** - latency, offline |
| **Leader role** | Full coordinator | Minimal (sync only) | **Minimal** - simpler failover |

**Slowest part of the process Discussion:**

1. **Sync bandwidth at peak:**
   - Problem: 5 terminals × 100 events/min × 500B = 250 KB/min
   - Solution: Delta compression (70% reduction), batching

2. **Leader as Slowest part of the process:**
   - Problem: All terminals sync through leader
   - Solution: Leader only aggregates, doesn't process. Followers can peer-sync.

3. **AI model size:**
   - Problem: Limited terminal storage
   - Solution: INT8 quantization, model Cutting off unnecessary steps, <100MB per model

### Phase 5: Wrap Up (40-45 min)

**Extensions to Mention:**

1. **Multi-store inventory:**
   "Could extend to cross-store sync via cloud events, but adds latency."

2. **Real-time promotions:**
   "Leader can receive push updates from cloud when online."

3. **Voice-first checkout:**
   "Voice model can process entire transactions: 'Two coffees and a muffin.'"

---

## Trade-offs Discussion Template

| Decision | Option A | Option B | Recommendation |
|----------|----------|----------|----------------|
| **Leader selection** | Random | Highest uptime terminal | **Highest uptime** - more stable |
| **Sync trigger** | Time-based only | Time + network detection | **Both** - catches connectivity changes |
| **Conflict resolution** | CRDTs only | CRDTs + AI escalation | **CRDTs + AI** - handles semantic conflicts |
| **Local storage** | SQLite | Embedded RocksDB | **SQLite** - simpler, reliable |
| **Cloud database** | PostgreSQL sharded | CockroachDB | **Postgres** - mature, known scale |

---

## Trap Questions & How to Handle

| Trap Question | What Interviewer Wants | Best Answer |
|---------------|------------------------|-------------|
| "Why not just use a cloud database?" | Understand offline-first principles | "Cloud requires connectivity. Our core requirement is 24+ hour offline. Local-first with sync preserves availability." |
| "What if the leader is malicious?" | Security thinking | "Device certificates from company CA, allowlisted devices, mTLS for all communication. A compromised device can be revoked remotely." |
| "How do you handle 100 terminals?" | Understand Raft limits | "Raft works best with 3-15 nodes. For larger stores, we create zones with 10-15 terminals each, with a zone leader per zone and a store coordinator." |
| "What if AI makes wrong predictions?" | Fallback thinking | "Low-confidence predictions require manual confirmation. All AI decisions are logged for audit. Model drift triggers automated retraining." |
| "What about real-time inventory across stores?" | Distinguish in-store vs cross-store | "In-store is real-time via CRDTs. Cross-store is eventually consistent via cloud. True real-time cross-store would require always-online, which breaks our offline-first model." |
| "How do you test this system?" | Operational maturity | "Chaos testing: kill leader mid-sync, partition network, exhaust storage. Integration tests simulate 24hr offline followed by reconnection." |

---

## Common Mistakes to Avoid

1. **Ignoring offline requirement:**
   "Let's just use Firebase Realtime Database."
   → *Firebase requires connectivity. Offline-first is the core requirement.*

2. **Over-complicating leader election:**
   "We'll implement Paxos with Byzantine fault tolerance."
   → *Raft is sufficient for trusted terminals in a store.*

3. **Assuming strong consistency is free:**
   "All terminals will have the same view instantly."
   → *Explain CAP trade-offs. We choose AP with eventual consistency.*

4. **Forgetting payment compliance:**
   "We'll store card numbers locally encrypted."
   → *PCI-DSS prohibits this. Use tokenization with P2PE.*

5. **Ignoring AI model updates:**
   "Deploy model once and done."
   → *Models drift. Need versioning, signed updates, rollback capability.*

6. **Not considering terminal heterogeneity:**
   "All terminals are identical."
   → *Different hardware capabilities affect AI inference latency.*

---

## Questions to Ask Interviewer

1. "What's the expected peak transaction rate per terminal?"
   → *Helps size local storage and sync frequency*

2. "Are there any existing systems we need to integrate with?"
   → *Payment processors, ERP, loyalty systems*

3. "What's the acceptable data staleness for inventory across stores?"
   → *Impacts cross-store sync architecture*

4. "Is there a preference for commercial vs open-source components?"
   → *SQLite vs commercial DB, TFLite vs proprietary AI*

5. "What's the deployment model: self-managed or SaaS?"
   → *Impacts operational design*

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────┐
│           AI NATIVE OFFLINE FIRST POS - INTERVIEW CARD          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  REMEMBER TO MENTION                                            │
│  ───────────────────                                            │
│  • Offline-first: Local ops never blocked                       │
│  • CRDTs: PN-Counter for inventory, OR-Set for transactions     │
│  • Raft: Leader election for sync coordination                  │
│  • mDNS: Zero-config terminal discovery                         │
│  • Edge AI: TensorFlow Lite, <100ms inference                   │
│  • Delta sync: Lamport timestamps, batch to cloud               │
│                                                                 │
│  KEY NUMBERS                                                    │
│  ───────────                                                    │
│  • Election timeout: 300-500ms (random)                         │
│  • Heartbeat: 150ms                                             │
│  • Cloud sync: 15 min batch                                     │
│  • Offline duration: 24+ hours                                  │
│  • AI inference: <100ms (product recognition)                   │
│                                                                 │
│  AVOID SAYING                                                   │
│  ────────────                                                   │
│  ✗ "Strong consistency everywhere"                              │
│  ✗ "Store card numbers locally"                                 │
│  ✗ "Use cloud database"                                         │
│  ✗ "Single leader, no failover"                                 │
│                                                                 │
│  GOOD PHRASES                                                   │
│  ────────────                                                   │
│  ✓ "Eventual consistency is acceptable because..."              │
│  ✓ "We tokenize payments for PCI-DSS compliance"                │
│  ✓ "Leader failover takes <5 seconds via Raft"                  │
│  ✓ "CRDTs mathematically guarantee convergence"                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Complexity Variations

### 30-Minute Interview (Simplified)

Focus on:
- High-level architecture (5 min)
- CRDTs for conflict resolution (10 min)
- Leader election basics (5 min)
- One trade-off (5 min)
- Wrap-up (5 min)

Skip:
- Deep AI discussion
- Security/compliance details
- Cloud architecture

### 60-Minute Interview (Extended)

Add:
- Detailed security threat model (10 min)
- Cloud-side architecture (10 min)
- Operational concerns: monitoring, alerting (5 min)

### System Design with Coding (90 min)

After design (45 min), implement:
- PN-Counter merge function
- Basic Raft leader election state machine
- Delta sync protocol Step-by-step plan in plain English

---

## Additional Trap Questions

### Trap: "Why not use a shared database instead of CRDTs?"

```
What They're Testing: Understanding of offline-first constraints

Poor Answer: "CRDTs are more modern."

Better Answer:
"A shared database requires network access for every write, which
violates the core offline-first requirement. Consider the failure
modes:

Shared database (e.g., cloud PostgreSQL):
• Network outage → all terminals stop processing sales
• Latency → every transaction waits for round-trip (100-500ms)
• Single point of failure → database down = store down

CRDTs with local storage:
• Network outage → zero impact on local operations
• Latency → local writes in <1ms
• No single point of failure → each terminal is autonomous

The trade-off is consistency: CRDTs give us strong eventual
consistency, meaning all terminals converge to the same state
after sync, but there's a window where terminals disagree.

For a POS system, this is acceptable because:
1. Most data is append-only (transactions)
2. Inventory conflicts (overselling) are rare and recoverable
3. The alternative (rejecting sales) has higher business cost

A shared database makes sense for a single-terminal, always-online
system. For multi-terminal offline-capable, CRDTs are necessary."
```

### Trap: "How do you update AI models on terminals without internet?"

```
What They're Testing: Understanding of edge AI lifecycle management

Poor Answer: "We push updates when internet is available."

Better Answer:
"Model updates require a multi-phase approach:

1. Differential updates (not full model replacement):
   • Only changed layers are transmitted (~2-5MB vs 20-100MB)
   • Layer-wise checksums identify deltas
   • Reduces bandwidth by 90%+ for fine-tuning updates

2. Staged rollout:
   • Leader terminal downloads and validates first
   • Leader runs test inference batch against known products
   • If accuracy exceeds threshold, leader distributes to followers
   • If validation fails, leader rejects the update

3. Atomic swap:
   • New model staged in separate directory
   • Validated against reference dataset
   • Swapped in atomically (symlink change)
   • Old model kept as rollback for 24 hours

4. Offline fallback:
   • If terminal hasn't updated in >30 days, alert store manager
   • Terminal continues with current model (stale but functional)
   • Manual USB update as last resort

The key principle: never interrupt sales for a model update.
Updates are opportunistic, validated, and reversible."
```

### Trap: "What happens when two terminals sell the last item simultaneously?"

```
What They're Testing: Deep understanding of CRDT limitations

Poor Answer: "CRDTs prevent this."

Better Answer:
"CRDTs CANNOT prevent this -- and that's by design.

The sequence:
1. Inventory shows 1 unit of SKU-123 on both terminals
2. Terminal A sells it at 10:01:00
3. Terminal B sells it at 10:01:05
4. Both terminals show 0 locally (correct per their view)
5. After sync, CRDT merge shows -1 (mathematically correct)

This is the fundamental trade-off: preventing overselling requires
coordination (locks, reservations), which requires communication,
which breaks offline operation.

The resolution is post-sync:
1. Detect negative inventory after merge
2. AI resolver evaluates: which sale to honor?
   - Consider timestamps (earlier wins)
   - Consider customer profiles (loyalty tier)
   - Consider business rules (perishable items differ)
3. Options: backorder, void + refund, adjust inventory

For high-value items (electronics), you might add a local
reservation counter that limits sales to (stock - 1) per terminal,
accepting that the last unit can only be sold by one terminal.
This is a business-level configuration, not a protocol change.

The honest answer: 100% oversell prevention and 100% offline
operation are mutually exclusive. The system chooses availability
over strict consistency."
```

---

## Related Interview Topics

If you know this design well, you can handle:
- **Distributed Key-Value Store** (CRDT concepts, conflict resolution)
- **Distributed Lock Manager** (Raft/consensus, leader election)
- **Edge Computing Platform** (edge AI, offline, resource constraints)
- **Event Sourcing** (sync via events, append-only logs)
- **Multi-Region Active-Active** (CRDTs, consistency, partition tolerance)
- **Service Discovery** (mDNS parallels, zero-config networking)
- **Secret Management** (offline credential caching, HSM integration)

---

## Practice Questions

1. "Design a POS system that works for 24 hours without internet."
2. "How would you handle inventory sync across 10 checkout lanes?"
3. "Design a system where AI product recognition works offline."
4. "How do you prevent double-selling the last item in stock?"
5. "Design leader election for a store with 5 terminals."
6. "How would you handle payment processing when the store loses internet mid-transaction?"
7. "Design a model update system for 100,000 stores with intermittent connectivity."
8. "What happens when a network partition splits 5 terminals into groups of 3 and 2?"
