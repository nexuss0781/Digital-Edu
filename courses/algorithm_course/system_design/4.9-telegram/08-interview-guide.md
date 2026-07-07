# Telegram: Interview Guide

## Interview Pacing (45-min Format)

| Time | Phase | Focus | Key Actions |
|------|-------|-------|-------------|
| 0-5 min | **Clarify** | Scope the problem | Ask about scale, features, constraints |
| 5-15 min | **High-Level** | Core architecture | Draw main components, data flow |
| 15-30 min | **Deep Dive** | Critical components | Channel fanout, cloud vs secret chats |
| 30-40 min | **Scale & Trade-offs** | Bottlenecks, failures | Discuss alternatives, justify choices |
| 40-45 min | **Wrap Up** | Summary, extensions | Handle follow-ups, show depth |

---

## Phase 1: Clarify (0-5 min)

### Questions to Ask Interviewer

| Question | Why It Matters |
|----------|---------------|
| "What's the expected scale - users, messages/day?" | Drives capacity planning |
| "Is this WhatsApp-style (E2EE) or cloud-stored messages?" | Fundamentally different architectures |
| "Do we need to support large groups/channels (100K+ members)?" | Affects fanout strategy |
| "What's the latency requirement for message delivery?" | Guides caching, DC strategy |
| "Multi-device support - should messages sync across devices?" | Server storage vs store-and-forward |
| "File sharing - what size limits?" | Storage and CDN design |
| "Should we design the bot platform too?" | Scope management |

### Clarification Output

After asking questions, summarize:

> "So we're designing a Telegram-like system with:
> - 1 billion MAU, 500M DAU
> - Cloud-stored messages (unlike WhatsApp's E2EE)
> - Support for groups up to 200K and unlimited channel subscribers
> - Multi-device sync across unlimited devices
> - File sharing up to 2-4GB
> - Sub-200ms message delivery for online users
>
> I'll focus on the core messaging architecture, large group/channel fanout, and multi-device sync. I'll set aside the bot platform and voice/video calls as extensions."

---

## Phase 2: High-Level Design (5-15 min)

### Draw Core Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  HIGH-LEVEL ARCHITECTURE (Whiteboard)                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│    ┌─────────┐                                                              │
│    │ Clients │ ←── iOS, Android, Desktop, Web                              │
│    └────┬────┘                                                              │
│         │ MTProto / HTTPS                                                   │
│         ▼                                                                   │
│    ┌─────────────┐                                                          │
│    │ Load        │ ←── GeoDNS for routing                                  │
│    │ Balancer    │                                                          │
│    └──────┬──────┘                                                          │
│           │                                                                 │
│    ┌──────┴──────┐                                                          │
│    ▼             ▼                                                          │
│  ┌─────────┐ ┌─────────┐                                                    │
│  │ Gateway │ │ Bot API │                                                    │
│  │ (MTProto)│ │ (HTTP)  │                                                    │
│  └────┬────┘ └────┬────┘                                                    │
│       │           │                                                         │
│       └─────┬─────┘                                                         │
│             ▼                                                               │
│    ┌─────────────────────────────────────────┐                              │
│    │            Core Services                 │                              │
│    │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐       │                              │
│    │  │Auth │ │ Msg │ │Chan │ │File │       │                              │
│    │  └─────┘ └─────┘ └─────┘ └─────┘       │                              │
│    └────────────────┬────────────────────────┘                              │
│                     │                                                       │
│    ┌────────────────┼────────────────┐                                      │
│    ▼                ▼                ▼                                      │
│  ┌─────────┐   ┌─────────┐    ┌─────────┐                                   │
│  │User DB  │   │Msg Store│    │File     │                                   │
│  │(PG)     │   │(Cassandra)   │Storage  │                                   │
│  └─────────┘   └─────────┘    └─────────┘                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Explain Data Flow

**Message Send (Online Recipient):**
1. Client encrypts with session key (MTProto)
2. Gateway decrypts, validates session
3. Message service stores message
4. Lookup recipient's active sessions
5. Push to all recipient devices
6. Delivery ACK → double tick

**Key Decision Points to Mention:**
- "We're using server-side storage to enable multi-device sync"
- "MTProto gives us efficient binary protocol for mobile"
- "Cassandra for messages - good for time-series, high write throughput"

---

## Phase 3: Deep Dive (15-30 min)

### Deep Dive #1: Channel Fanout

**Problem Statement:**
> "Channels can have 43M+ subscribers. When an admin posts, how do we deliver to all subscribers quickly?"

**Solution:**

```
FANOUT STRATEGY:

1. PRE-SHARD SUBSCRIBERS
   - At subscription time, assign user to shard
   - 1000 shards for large channels
   - ~43K users per shard

2. PARALLEL WORKER POOL
   - 1000 workers, one per shard
   - Each processes 43K subscribers
   - Batches of 1000 for efficiency

3. CLASSIFY DELIVERY
   - Online check via Redis bitmap
   - Online (~10%): Direct MTProto push
   - Offline (~90%): Batch push notifications

4. DELIVERY METRICS
   - 43M subscribers / 1000 workers = 43K per worker
   - 43K / 1000 batch = 43 batches
   - At 10K batches/sec = ~4 seconds shard time
   - Total: ~60 seconds for 99% delivery
```

**Trade-off Discussion:**
| Approach | Pros | Cons | When to Use |
|----------|------|------|-------------|
| Push model | Fast delivery | Server load | Default |
| Pull model | Client-driven | Delay, battery | Inactive users |
| Hybrid | Balanced | Complexity | Large channels |

### Deep Dive #2: Cloud vs Secret Chats

**Problem Statement:**
> "How do we support both convenient cloud chats and secure end-to-end encrypted chats?"

**Solution:**

```
DUAL ENCRYPTION ARCHITECTURE:

CLOUD CHATS:
┌─────────────────────────────────────────────────────────────┐
│ Client ←──MTProto──→ Server ←──MTProto──→ Client            │
│         (encrypted)     │      (encrypted)                  │
│                         │                                   │
│                    Decrypt, Store,                          │
│                    Re-encrypt                               │
│                                                             │
│ Features: Multi-device sync, search, history on new device  │
└─────────────────────────────────────────────────────────────┘

SECRET CHATS:
┌─────────────────────────────────────────────────────────────┐
│ Client ←──E2E Encrypted──→ Server ←──E2E Encrypted──→ Client│
│                              │                              │
│                         Relay only                          │
│                      (cannot decrypt)                       │
│                                                             │
│ Features: Device-specific, self-destruct, no sync           │
└─────────────────────────────────────────────────────────────┘
```

**Trade-off:**
- Cloud: Convenient, feature-rich, but server can access
- Secret: Maximum privacy, but limited features, single device

### Deep Dive #3: Multi-Device Sync

**Problem Statement:**
> "How do we keep messages in sync across unlimited devices?"

**Solution:**

```
STATE SYNCHRONIZATION:

1. PTS (Points) COUNTER
   - Server maintains per-user state counter
   - Every change increments PTS
   - Devices track their last seen PTS

2. SYNC PROTOCOL
   Device connects:
   → getDifference(my_pts, server_pts)
   ← List of updates since my_pts
   → Apply updates locally

3. REAL-TIME PUSH
   New message arrives:
   → Server increments PTS
   → Push update to ALL active sessions
   → Each device updates local PTS

4. GAP HANDLING
   If gap > 1000 updates:
   → Server returns "TOO_LONG"
   → Device does full state refresh
```

---

## Phase 4: Scale & Trade-offs (30-40 min)

### Slowest part of the process Analysis

| Slowest part of the process | Symptom | Solution |
|------------|---------|----------|
| Channel fanout slow | >2 min delivery | More shards, workers |
| Connection memory | OOM on gateways | Offload sessions to Redis |
| Search latency | >1s queries | Partition by user, tiered indexing |
| DB writes spike | Message lag | More Cassandra nodes, async |
| File uploads backlog | Queue growth | Scale file service, CDN offload |

### Trade-offs Discussion

| Decision | Option A | Option B | Telegram's Choice |
|----------|----------|----------|-------------------|
| **Encryption** | E2EE everywhere | Cloud + optional E2EE | **B**: Convenience for most, E2EE for paranoid |
| **Protocol** | Standard (XMPP, WS) | Custom (MTProto) | **B**: Mobile-optimized, efficient |
| **Storage** | Store-and-forward | Server-side permanent | **B**: Multi-device, search, history |
| **Group size** | Cap at 1K | Allow 200K+ | **B**: Community use cases |
| **File size** | Cap at 100MB | Allow 2-4GB | **B**: Differentiation, heavy users |

### Failure Scenarios

**"What if a data center goes down?"**

> "We run multi-DC active-active. If Miami DC fails:
> 1. GeoDNS removes Miami (30s)
> 2. Traffic routes to nearest DC (Amsterdam/Singapore)
> 3. Users reconnect, getDifference syncs state
> 4. Async replication ensures data available
> 5. RTO: ~1 minute, RPO: ~5 seconds"

**"What if a popular channel goes viral?"**

> "For sudden 10x spike on mega-channel:
> 1. Fanout queue grows
> 2. Auto-scale workers
> 3. Push notifications batched
> 4. Degrade: delay delivery to offline users
> 5. Priority: keep online users real-time"

---

## Phase 5: Wrap Up (40-45 min)

### Summary Statement

> "To summarize, I designed a Telegram-like messaging system with:
>
> **Core Architecture:**
> - MTProto protocol for efficient mobile communication
> - Server-side cloud storage for multi-device sync
> - Dual encryption (cloud + secret chats)
>
> **Scale Solutions:**
> - Sharded subscriber lists for channel fanout
> - Parallel workers for 43M+ subscriber delivery
> - Multi-DC active-active for availability
>
> **Key Trade-offs:**
> - Chose convenience (cloud storage) over E2EE by default
> - Custom protocol for mobile efficiency
> - Permanent storage enables search, history
>
> **Extensions I'd add given more time:**
> - Bot platform with webhooks
> - Voice/video calls with STUN/TURN
> - Stories feature with 24h TTL"

---

## Trap Questions & Best Answers

| Trap Question | What They Want | Best Answer |
|---------------|----------------|-------------|
| "Why not just use E2EE everywhere like Signal?" | Understand trade-offs | "E2EE prevents multi-device sync, search, and server-side features. Telegram chose convenience for most users with optional E2EE via Secret Chats. WhatsApp chose the opposite - always E2EE, limited multi-device." |
| "How would you handle a channel with 1 billion subscribers?" | Think beyond current scale | "At 1B, we'd need a different model: pull-based with CDN-cached posts, client polls for updates, notifications only for engaged users. Like a news feed, not a chat." |
| "What if the entire cloud provider goes down?" | Multi-cloud thinking | "Multi-cloud strategy: run across 2+ providers. Geographic redundancy. Data replicated cross-provider. DNS failover in 30s. We accept 99.99% availability, not 100%." |
| "Why custom protocol instead of WebSocket + JSON?" | Protocol efficiency | "MTProto: binary (50% smaller), built-in encryption, session persistence, multi-transport (TCP/HTTP/WS). JSON is verbose, no built-in security. For 175K msgs/sec, efficiency matters." |
| "How do you prevent spam?" | Operational concerns | "Multi-layer: rate limits per user, phone verification for new accounts, ML-based content detection, user reporting, progressive penalties (slow mode → ban)." |

---

## Common Mistakes to Avoid

| Mistake | Why It's Wrong | Better Approach |
|---------|---------------|-----------------|
| Proposing E2EE for all chats | Breaks multi-device, search | Explain cloud chat benefits, offer Secret Chats |
| Ignoring channel fanout challenge | Shows lack of scale thinking | Deep dive on 43M subscriber problem |
| Using standard JSON/REST | Inefficient for messaging | Explain MTProto benefits |
| Single database for everything | Won't scale | Polyglot: PG for users, Cassandra for messages |
| No multi-DC strategy | Single point of failure | Active-active across regions |
| Forgetting offline users | Major use case | Queue + push notification system |

---

## Questions to Ask at End

| Question | Shows |
|----------|-------|
| "How would you want me to approach the bot platform?" | Extension thinking |
| "Should I elaborate on the Secret Chat key exchange?" | Security depth |
| "Do you want me to discuss voice/video call architecture?" | Breadth |
| "Any concerns about my fanout strategy?" | Openness to feedback |

---

## Quick Reference Card

### Numbers to Remember

```
MAU:                    1B
DAU:                    500M
Messages/day:           15B
Messages/sec:           175K avg, 500K peak
Supergroup max:         200K members
Channel max:            Unlimited (43M+ largest)
File size:              2-4GB
Delivery target:        <200ms online
Concurrent connections: 100M
```

### Key Components

```
Protocol:       MTProto 2.0 (custom, mobile-optimized)
Encryption:     AES-256 + DH-2048
Storage:        Server-side (cloud chats), Device-only (secret)
User DB:        PostgreSQL (sharded)
Message DB:     Cassandra (partitioned by chat)
File Storage:   Distributed file system (TFS)
Cache:          Redis (sessions, presence)
```

### Architecture Decisions

```
1. Cloud storage (not E2EE by default) → Multi-device sync
2. Custom MTProto protocol → Mobile efficiency
3. Sharded fanout → Handle 43M subscriber channels
4. Dual encryption model → User choice
5. Multi-DC active-active → High availability
```

---

## Interview Variants

### 30-Minute Version
- Skip: Detailed capacity math, multiple deep dives
- Focus: One deep dive (fanout OR encryption), key trade-offs
- Simplify: High-level architecture, mention extensions

### 60-Minute Version
- Add: Full capacity planning, multiple deep dives
- Add: Database schema design, API design
- Add: More failure scenarios, operational concerns

### "Design Messaging System" (Generic)
- Start by asking: "Should this be WhatsApp-style (E2EE) or Telegram-style (cloud)?"
- If cloud: Telegram approach
- If E2EE: WhatsApp approach (Signal Protocol, store-and-forward)
- Key: Understand the fundamental trade-off before designing

---

## Case Studies

### Case Study 1: Channel Fanout During Breaking News

**Context:** A major news channel with 28M subscribers posts a breaking story. Within 30 seconds, the post must reach at least 90% of online subscribers.

**Challenge:** The fanout engine's standard configuration processes 43K subscribers per shard worker, with 1000 shards. But breaking news events are correlated -- multiple major channels post simultaneously, competing for fanout worker capacity.

**Solution:**
1. Priority queuing: Breaking news channels (flagged by admin activity patterns) get dedicated high-priority fanout lanes
2. Online-first delivery: The 10% online subscribers receive direct MTProto pushes within 5 seconds; the 90% offline receive batched push notifications over 60 seconds
3. Adaptive batch sizing: During load spikes, increase batch size from 1,000 to 5,000 subscribers per worker iteration, trading per-batch latency for overall throughput
4. CDN pre-warming: For posts with media attachments, the CDN is pre-populated from origin before fanout begins, preventing 28M simultaneous origin requests

**Result:** P95 delivery to online subscribers: 4.2 seconds. P99 push notification delivery: 47 seconds. Zero fanout worker OOM events despite 3 major channels posting simultaneously.

### Case Study 2: "Delete for Everyone" Across 5 Data Centers

**Context:** A user deletes a message in a group chat with 15K members, with recipients spread across 5 DCs. The deletion must eventually appear on all recipient devices, including those currently offline.

**Challenge:** Physical deletion from all replicas, all recipient devices, and the search index cannot be made atomic across 5 DCs without unacceptable latency.

**Solution:**
1. Tombstone record appended to the message log (append-only, never physically delete)
2. PTS incremented for the group -- all devices receive the tombstone via normal getDifference sync
3. Cross-DC replication propagates the tombstone through async log replication (P99: 2.3 seconds)
4. Search index processes tombstone in next batch cycle (5-minute lag)
5. Devices offline for >30 days receive full state refresh, which reflects the deletion
6. Tombstone retained for 90 days, then compacted

**Key takeaway:** Treating deletion as an event (tombstone) rather than a mutation (physical delete) converts an impossibly complex distributed coordination problem into a simple append to the existing replication pipeline.

---

## Related Topics to Study

| Topic | When It Helps |
|-------|--------------|
| Signal Protocol | If asked about E2EE details |
| Cassandra internals | If asked about message storage |
| Push notification systems | If asked about offline delivery |
| CDN architecture | If asked about media delivery |
| Rate limiting algorithms | If asked about spam prevention |
| Distributed consensus | If asked about multi-DC consistency |
