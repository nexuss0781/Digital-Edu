# High-Level Design — WebRTC Infrastructure

## System Architecture

The WebRTC infrastructure consists of three planes: the **signaling plane** (WebSocket-based session management), the **connectivity plane** (STUN/TURN for NAT traversal), and the **media plane** (SFU for packet forwarding). These planes operate independently but coordinate through shared session state.

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart TB
    subgraph Clients["Client Layer"]
        C1["Participant A<br/>(Browser/Mobile)"]
        C2["Participant B<br/>(Browser/Mobile)"]
        C3["Participant C<br/>(Browser/Mobile)"]
    end

    subgraph Signaling["Signaling Plane"]
        SIG["Signaling Server<br/>(WebSocket)"]
        SIGDB[("Session Store")]
    end

    subgraph Connectivity["Connectivity Plane"]
        STUN["STUN Server<br/>(Reflexive Discovery)"]
        TURN["TURN Server<br/>(Relay Fallback)"]
    end

    subgraph Media["Media Plane"]
        SFU1["SFU Node 1<br/>(Region A)"]
        SFU2["SFU Node 2<br/>(Region B)"]
        SFU1 <-->|"Cascaded<br/>Media Relay"| SFU2
    end

    subgraph Storage["Storage & Processing"]
        REC["Recording<br/>Egress"]
        OBJ[("Object<br/>Storage")]
    end

    C1 & C2 & C3 -->|"WebSocket<br/>(SDP, ICE candidates)"| SIG
    SIG --> SIGDB
    C1 & C2 & C3 -.->|"STUN Binding<br/>Request"| STUN
    C1 -.->|"TURN Allocation<br/>(if needed)"| TURN
    C1 & C2 -->|"SRTP Media<br/>Tracks"| SFU1
    C3 -->|"SRTP Media<br/>Tracks"| SFU2
    SFU1 -->|"Egress<br/>Pipeline"| REC
    REC --> OBJ

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef signal fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef connect fill:#e0f7fa,stroke:#00695c,stroke-width:2px
    classDef media fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef store fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class C1,C2,C3 client
    class SIG,SIGDB signal
    class STUN,TURN connect
    class SFU1,SFU2 media
    class REC,OBJ store
```

---

## Call Establishment Flow

The lifecycle of a WebRTC call involves coordinated interaction across all three planes. The sequence below shows a 1:1 call where both participants connect through an SFU.

```mermaid
%%{init: {'theme': 'neutral'}}%%
sequenceDiagram
    participant A as Participant A
    participant SIG as Signaling Server
    participant STUN as STUN Server
    participant TURN as TURN Server
    participant SFU as SFU Node
    participant B as Participant B

    Note over A,B: Phase 1 — Room Join & Signaling
    A->>SIG: Connect WebSocket + Auth Token
    SIG->>SIG: Validate token, create/join room
    B->>SIG: Connect WebSocket + Auth Token
    SIG->>A: Peer joined notification
    SIG->>B: Existing participants list

    Note over A,B: Phase 2 — ICE Candidate Gathering
    A->>STUN: STUN Binding Request
    STUN->>A: Server-Reflexive Candidate (public IP:port)
    A->>TURN: Allocate Request (if configured)
    TURN->>A: Relay Candidate (TURN IP:port)
    B->>STUN: STUN Binding Request
    STUN->>B: Server-Reflexive Candidate

    Note over A,B: Phase 3 — SDP Offer/Answer Exchange
    A->>SIG: SDP Offer (codecs, candidates, fingerprint)
    SIG->>B: Forward SDP Offer
    B->>SIG: SDP Answer (accepted codecs, candidates)
    SIG->>A: Forward SDP Answer

    Note over A,B: Phase 4 — ICE Connectivity Checks
    A->>SFU: STUN connectivity check (host candidate)
    SFU->>A: STUN response (success)
    B->>SFU: STUN connectivity check
    SFU->>B: STUN response (success)
    Note over A,SFU: ICE selects best candidate pair

    Note over A,B: Phase 5 — Secure Media Flow
    A->>SFU: DTLS handshake (derive SRTP keys)
    SFU->>A: DTLS handshake complete
    A->>SFU: SRTP audio/video tracks
    SFU->>B: Forward SRTP tracks (selective)
    B->>SFU: SRTP audio/video tracks
    SFU->>A: Forward SRTP tracks (selective)

    Note over A,B: Phase 6 — Ongoing Adaptation
    SFU->>A: RTCP TWCC feedback
    A->>A: Adjust bitrate via GCC
    SFU->>SFU: Switch simulcast layers per subscriber
```

---

## ICE Negotiation State Machine

The ICE agent transitions through a well-defined state machine during connectivity establishment. Understanding these states is critical for debugging connection failures.

```mermaid
%%{init: {'theme': 'neutral'}}%%
stateDiagram-v2
    [*] --> New: createPeerConnection()
    New --> Gathering: setLocalDescription()
    Gathering --> Gathering: candidate discovered
    Gathering --> Complete: all candidates gathered

    state "Connectivity Checking" as Checking {
        [*] --> Waiting
        Waiting --> InProgress: begin check
        InProgress --> Succeeded: STUN response
        InProgress --> Failed: timeout
        Succeeded --> Nominated: USE-CANDIDATE
    }

    New --> Checking: remote candidates arrive
    Complete --> Checking: remote candidates arrive
    Checking --> Connected: nominated pair established
    Connected --> Completed: all checks finished
    Connected --> Disconnected: consent timeout (30s)
    Completed --> Disconnected: consent timeout (30s)
    Disconnected --> Checking: ICE restart
    Disconnected --> Failed: 30s no recovery
    Failed --> New: full renegotiation
```

**State Transitions and Timing:**

| Transition | Trigger | Typical Duration | Impact |
|---|---|---|---|
| New → Gathering | `setLocalDescription()` called | Instantaneous | Candidate discovery begins |
| Gathering phase | STUN/TURN requests complete | 200-500ms | Host candidates instant; TURN slowest |
| Checking phase | Connectivity checks execute | 50-300ms | Priority-ordered; aggressive nomination |
| Checking → Connected | First nominated pair succeeds | < 100ms after best check | Media can flow |
| Connected → Disconnected | No STUN consent response for 30s | 30s timeout | Media paused; ICE restart triggered |
| Disconnected → Checking | ICE restart with new credentials | < 500ms | Re-gather on new interface |
| Disconnected → Failed | No recovery within 30s | 30s | Connection terminates |

---

## Data Channel Architecture

WebRTC data channels provide reliable and unreliable message delivery over the same ICE/DTLS transport used for media. They run over SCTP (Stream Control Transmission Protocol) encapsulated in DTLS.

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart LR
    subgraph App["Application Layer"]
        DC1["Data Channel<br/>(reliable, ordered)"]
        DC2["Data Channel<br/>(unreliable, unordered)"]
    end

    subgraph Transport["Transport Stack"]
        SCTP["SCTP Association<br/>(multiplexed streams)"]
        DTLS2["DTLS Encryption"]
        ICE2["ICE Transport<br/>(UDP)"]
    end

    DC1 --> SCTP
    DC2 --> SCTP
    SCTP --> DTLS2
    DTLS2 --> ICE2

    classDef app fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef transport fill:#e0f7fa,stroke:#00695c,stroke-width:2px

    class DC1,DC2 app
    class SCTP,DTLS2,ICE2 transport
```

**Data Channel Modes:**

| Mode | SCTP Config | Use Case | Behavior |
|---|---|---|---|
| **Reliable ordered** | Retransmit, in-order delivery | Chat messages, file transfer | TCP-like semantics over UDP |
| **Reliable unordered** | Retransmit, any-order delivery | Batch updates, state sync | All messages arrive, order doesn't matter |
| **Unreliable ordered** | No retransmit, max retransmit = 0 | Game state, cursor position | Drop if late, but preserve ordering |
| **Unreliable unordered** | No retransmit, unordered | Sensor data, heartbeats | UDP-like semantics |

**Key Design Consideration:** Data channels share the same ICE/DTLS transport as media via BUNDLE. This means data channel congestion can theoretically affect media quality if the shared transport becomes saturated. In practice, data channels carry kilobytes while media carries megabits, so interference is minimal. For high-throughput data transfer (file sharing), consider rate-limiting to avoid competing with media bandwidth.

---

## Recording and Egress Pipeline

Recording in SFU architecture requires a specialized egress pipeline that subscribes to tracks without publishing, acting as a silent participant.

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart TB
    subgraph Room["Active Room"]
        P1["Publisher A"]
        P2["Publisher B"]
        SFU3["SFU Node"]
        P1 -->|"Audio + Video"| SFU3
        P2 -->|"Audio + Video"| SFU3
    end

    subgraph Egress["Egress Pipeline"]
        BOT["Recording Bot<br/>(subscribes to all tracks)"]
        MUX["Muxer<br/>(combine tracks into container)"]
        ENC["Encoder<br/>(if composite mode)"]
        UPLOAD["Upload Worker<br/>(chunked upload)"]
    end

    subgraph Storage["Storage"]
        OBJ2[("Object Storage<br/>(segmented files)")]
        META2[("Metadata Store<br/>(recording index)")]
    end

    SFU3 -->|"Forward tracks"| BOT
    BOT -->|"Raw RTP"| MUX
    BOT -.->|"Composite"| ENC
    ENC -.-> MUX
    MUX -->|"5-second segments"| UPLOAD
    UPLOAD --> OBJ2
    UPLOAD --> META2

    classDef room fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef egress fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef store fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class P1,P2,SFU3 room
    class BOT,MUX,ENC,UPLOAD egress
    class OBJ2,META2 store
```

**Recording Modes:**

| Mode | Description | Resource Cost | Output |
|---|---|---|---|
| **Track-based** | Store each track as a separate file | Low (no processing) | Individual audio/video files per participant |
| **Composite** | Decode all tracks, compose into a single grid video | High (decode + layout + encode) | Single video file with participant grid |
| **Audio-only composite** | Mix all audio tracks into one stream | Medium (audio mixing) | Single audio file |

**Segmented Upload Strategy:**

```
Recording durability via segment-based upload:
1. Egress muxes media into 5-second segments
2. Each segment uploaded independently to object storage
3. Manifest file tracks segment order and timestamps
4. If egress crashes: at most 5 seconds of recording lost
5. On recovery: new egress bot joins, starts new segment chain
6. Post-processing: concatenate segments into final recording

Benefit: A 60-minute recording becomes 720 independent uploads.
         Any single upload failure affects only 5 seconds.
```

---

## WHIP/WHEP: Simplified Ingestion and Egress

WebRTC-HTTP Ingestion Protocol (WHIP) and WebRTC-HTTP Egress Protocol (WHEP) standardize how media enters and exits WebRTC infrastructure via simple HTTP-based negotiation, replacing custom signaling for unidirectional flows.

```mermaid
%%{init: {'theme': 'neutral'}}%%
flowchart LR
    subgraph Ingestion["WHIP (Publish)"]
        PUB["Publisher<br/>(OBS, Encoder)"]
        WHIP["WHIP Endpoint<br/>(HTTP POST)"]
    end

    subgraph Platform["Media Platform"]
        SFU4["SFU / Media Server"]
    end

    subgraph Egress2["WHEP (Subscribe)"]
        WHEP["WHEP Endpoint<br/>(HTTP POST)"]
        VIEW["Viewer<br/>(Browser, Player)"]
    end

    PUB -->|"POST SDP Offer<br/>(single HTTP request)"| WHIP
    WHIP -->|"SDP Answer<br/>(HTTP 201 response)"| PUB
    PUB ===|"SRTP Media"| SFU4

    SFU4 ===|"SRTP Media"| VIEW
    VIEW -->|"POST SDP Offer"| WHEP
    WHEP -->|"SDP Answer"| VIEW

    classDef ingest fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef platform fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef egress fill:#fffde7,stroke:#f57f17,stroke-width:2px

    class PUB,WHIP ingest
    class SFU4 platform
    class WHEP,VIEW egress
```

**WHIP/WHEP vs Custom Signaling:**

| Factor | Custom WebSocket Signaling | WHIP/WHEP |
|---|---|---|
| **Connection setup** | Persistent WebSocket + multi-message exchange | Single HTTP POST (offer) → 201 response (answer) |
| **Complexity** | Full signaling protocol implementation | Standard HTTP endpoint |
| **Use case** | Bidirectional interactive calls | Unidirectional publish (WHIP) or subscribe (WHEP) |
| **ICE candidates** | Trickle via WebSocket | Bundled in SDP or via PATCH requests |
| **Interoperability** | Custom per-platform | Standardized — any WHIP client works with any WHIP server |
| **When to use** | Multi-party rooms, interactive sessions | Broadcast ingestion, surveillance, one-to-many streaming |

---

## Media Flow Through SFU

In a group call with N participants, the SFU operates as a selective packet router. Each participant publishes their tracks once, and the SFU forwards copies to each subscriber with per-subscriber quality selection.

**Publisher path:**
1. Client encodes video at multiple simulcast layers (e.g., 720p @ 1.5 Mbps, 360p @ 500 Kbps, 180p @ 150 Kbps)
2. Client encodes audio with Opus codec at 50 Kbps
3. RTP packets are encrypted via SRTP and sent to the SFU over the ICE-selected transport
4. SFU receives packets and stores them in a per-track jitter buffer (reorders out-of-sequence packets)

**Subscriber path:**
1. SFU determines which simulcast layer each subscriber should receive based on:
   - Subscriber's estimated available bandwidth (via TWCC/REMB feedback)
   - Subscriber's requested resolution (e.g., thumbnail vs. main view)
   - Room policy (e.g., active speaker gets high quality, others get low)
2. SFU forwards the selected layer's RTP packets to the subscriber
3. If bandwidth drops, SFU switches to a lower simulcast layer — no packet loss, just lower resolution
4. Subscriber decodes and renders each received track independently

**Key optimization — Last-N:**
For rooms with many participants, the SFU only forwards the top N active speakers' video tracks, dramatically reducing subscriber bandwidth. Audio is always forwarded for all participants (low bandwidth cost). A voice activity detector (VAD) determines active speakers.

---

## Key Architectural Decisions

### Decision 1: SFU Over MCU

| Factor | SFU | MCU |
|---|---|---|
| **CPU cost** | Minimal (packet forwarding only) | High (decode + composite + re-encode per output) |
| **Latency** | 1-5ms forwarding | 50-200ms (encoding pipeline) |
| **Scalability** | Horizontal via cascading | Vertical (limited by encoding capacity) |
| **Client flexibility** | Each subscriber receives individual tracks, can layout locally | Single composite stream, fixed layout |
| **Bandwidth** | Higher downstream (N-1 tracks) | Lower downstream (1 composite) but server bears encoding cost |
| **Simulcast/SVC** | Natural fit (per-subscriber layer selection) | Not applicable |

**Decision:** SFU is the standard for all real-time interactive use cases. MCU is reserved only for specific legacy scenarios (SIP interop) or server-side recording compositing.

### Decision 2: Simulcast Over SVC

| Factor | Simulcast | SVC |
|---|---|---|
| **Codec support** | VP8, H.264, VP9, AV1 | VP9, AV1 only (limited H.264) |
| **Encoder complexity** | Multiple independent encodes | Single layered encode |
| **SFU complexity** | Simple layer switching | Must parse and strip NAL units |
| **Bandwidth efficiency** | ~40% overhead (redundant encoding) | ~15% overhead (shared base layer) |
| **Switching artifacts** | Brief freeze during layer switch (keyframe needed) | Seamless layer dropping |
| **Client support** | Universal | Incomplete (mobile platforms lag) |

**Decision:** Simulcast as the primary approach for broad compatibility. SVC for VP9/AV1-capable endpoints where bandwidth efficiency matters (large rooms).

### Decision 3: WebSocket-Based Signaling

**Rationale:** WebSockets provide full-duplex, low-latency signaling over a persistent connection. Alternatives:
- HTTP long polling: Higher latency, connection overhead per message
- Server-Sent Events: Unidirectional (server → client only)
- gRPC streaming: Better for service-to-service; browser support limited
- Pub/sub messaging: Good for inter-server, overkill for client-server signaling

**Decision:** WebSocket for client-server signaling. Pub/sub message bus for inter-SFU coordination and signaling server clustering.

### Decision 4: Custom Protocol for SFU Cascading

**Rationale:** Using WebRTC between SFU nodes would require ICE negotiation, SDP exchange, and DTLS handshake for each inter-node connection—adding unnecessary complexity and latency. A custom protocol using serialized metadata (e.g., FlatBuffers) over direct UDP/TCP connections allows:
- Supplementing RTP packets with track identifiers and room context
- Eliminating ICE negotiation (servers have known public addresses)
- Lower connection establishment latency (no DTLS handshake needed between trusted servers)
- Simpler topology management (mesh can be preconfigured)

**Decision:** Custom relay protocol for server-to-server media forwarding; standard WebRTC for client-to-server.

---

## Architecture Pattern Checklist

| Pattern | Applied? | Implementation |
|---|---|---|
| **Hub-and-spoke** | Yes | SFU as central hub; clients as spokes with single upstream connection |
| **Cascaded mesh** | Yes | Multi-SFU topology for large rooms and multi-region deployment |
| **Event-driven** | Yes | Signaling via WebSocket events; room state changes broadcast to subscribers |
| **Pub/sub** | Yes | Inter-SFU coordination via message bus; room topic-based state distribution |
| **Circuit breaker** | Yes | TURN fallback when direct/reflexive paths fail; SFU failover on node loss |
| **Sidecar** | Yes | Recording egress as sidecar to SFU (subscribes to tracks without publishing) |
| **Edge deployment** | Yes | STUN/TURN servers at edge PoPs; SFU nodes in regional data centers |
| **Graceful degradation** | Yes | Simulcast layer downgrade; audio-only mode; last-N video limiting |

---

## Component Interaction Summary

| Component | Communicates With | Protocol | Purpose |
|---|---|---|---|
| Client | Signaling Server | WebSocket (WSS) | SDP exchange, ICE candidates, room events |
| Client | STUN Server | STUN over UDP | Reflexive candidate discovery |
| Client | TURN Server | TURN over UDP/TCP/TLS | Relay allocation and media relay |
| Client | SFU Node | SRTP/SRTCP over UDP | Encrypted media track publish/subscribe |
| SFU Node | SFU Node | Custom relay (RTP + metadata) | Cascaded media forwarding |
| SFU Node | Message Bus | Pub/sub | Room state sync, participant routing |
| Signaling Server | Session Store | Key-value reads/writes | Room metadata, participant registry |
| SFU Node | Recording Egress | Internal subscription | Track data for recording pipeline |
| WHIP Client | WHIP Endpoint | HTTP POST + SRTP | Unidirectional media ingestion |
| WHEP Client | WHEP Endpoint | HTTP POST + SRTP | Unidirectional media egress |

---

## Active Speaker Detection

Active speaker detection drives the most impactful optimization in group calls — Last-N video forwarding. Only the top N speakers receive full-quality video forwarding, saving bandwidth proportional to room size.

**Detection Pipeline:**

```
Audio Level Extraction (per track, every 20ms):
1. SFU reads RTP header extension (urn:ietf:params:rtp-hdrext:ssrc-audio-level)
   - 7-bit level value (0 = loudest, 127 = silence)
   - Voice Activity Detection (VAD) flag (1 bit)
2. Apply exponential smoothing:
   smoothed_level = 0.7 * smoothed_level + 0.3 * current_level
3. Track recent activity window (last 2 seconds)

Speaker Ranking (every 500ms):
1. Score each participant:
   score = weighted_average(levels_last_2s) * vad_frequency
2. Sort by score descending
3. Top N speakers get full-quality video forwarded
4. Others get audio only (or low-quality thumbnail)

Hysteresis to Prevent Flickering:
- New speaker must maintain higher score for 1 second before replacing current top-N
- Departing speaker stays in top-N for 2 seconds after going silent
- This prevents rapid switching during conversation turn-taking
```

**Last-N Configuration by Room Size:**

| Room Size | Last-N Value | Video Tracks Forwarded | Bandwidth Savings |
|---|---|---|---|
| 2-4 | All | All participants | None (all visible) |
| 5-9 | 4 | Top 4 speakers | ~50% |
| 10-25 | 4-6 | Top 4-6 speakers | ~75% |
| 26-100 | 4 | Top 4 speakers | ~95% |
| 100+ | 4-9 (configurable) | Top speakers only | ~97% |

---

## Codec Negotiation and Selection

Codec selection during SDP offer/answer determines the encoding format for the entire session. The negotiation must balance quality, compatibility, and computational cost.

**Codec Preference Hierarchy:**

```
Video Codec Selection (SFU perspective):
1. AV1  — Best compression (30-50% better than VP9), SVC-native
            Limited: High encode cost, not all clients support it
2. VP9  — Good compression, SVC support, wide browser support
            Default for rooms where SVC is beneficial (large rooms)
3. VP8  — Universal support, low encode complexity
            Default for small rooms, mobile-heavy audiences
4. H.264 — Hardware encode/decode on all devices
             Use when mobile battery life is priority

Audio Codec:
1. Opus — Universal choice: 6-510 kbps, speech + music modes
          Features: in-band FEC, DTX (discontinuous transmission)
          No negotiation needed — Opus is mandatory in WebRTC spec
```

**SDP Codec Negotiation Flow:**

```
Offer:  "I support VP8, VP9, AV1, H.264" (preference order)
Answer: "I accept VP8, VP9" (intersected + reordered by receiver preference)
Result: VP8 used (highest mutual preference)

SFU behavior:
- SFU does NOT transcode between codecs
- All participants in a room must use the same video codec
- Room codec is locked when the first participant publishes
- Late joiners must support the room's codec or join audio-only
```
