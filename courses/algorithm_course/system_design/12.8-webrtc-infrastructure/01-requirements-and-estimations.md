# Requirements & Estimations — WebRTC Infrastructure

## Functional Requirements

### Core Features (In Scope)

| # | Requirement | Description |
|---|---|---|
| FR-1 | **1:1 Audio/Video Calls** | Establish peer-to-peer or SFU-routed calls between two participants with full duplex audio and video |
| FR-2 | **Group Calls** | Support multi-party rooms with 3-100 participants, each publishing audio and optionally video |
| FR-3 | **Screen Sharing** | Allow participants to share screen/window/tab as an additional video track alongside camera |
| FR-4 | **STUN Service** | Provide globally distributed STUN servers for reflexive candidate discovery (public IP/port mapping) |
| FR-5 | **TURN Relay** | Operate TURN relay servers for sessions that cannot establish direct or reflexive connectivity |
| FR-6 | **ICE Negotiation** | Implement full ICE agent with candidate gathering, pairing, connectivity checks, and nomination |
| FR-7 | **Adaptive Quality** | Dynamically adjust video resolution/bitrate per subscriber based on bandwidth estimation |
| FR-8 | **Media Recording** | Record individual tracks or composite views to object storage for playback |
| FR-9 | **Data Channels** | Support reliable and unreliable data channels over SCTP/DTLS for application messages |
| FR-10 | **Participant Events** | Publish join/leave/mute/unmute events to all room participants in real time |

### Out of Scope

- PSTN/SIP gateway interconnection
- Real-time transcription and captioning (downstream consumer of media)
- Virtual backgrounds and video effects (client-side processing)
- Broadcast/HLS-based live streaming (different latency tier)
- Phone dial-in/dial-out

### Feature Dependency Matrix

```
Feature dependencies and their infrastructure implications:

Group Calls (FR-2) REQUIRES:
  ├── SFU infrastructure (cannot use P2P mesh beyond 4-6 participants)
  ├── Simulcast encoding (per-subscriber quality adaptation)
  └── Active speaker detection (Last-N optimization for 7+ participants)

Screen Sharing (FR-3) REQUIRES:
  ├── Higher bandwidth allocation (1.5-3 Mbps additional per sharer)
  ├── Content-type aware encoding (screen content uses different codec settings)
  └── Separate simulcast config (screen shares need higher resolution, lower framerate)

Media Recording (FR-8) REQUIRES:
  ├── Egress pipeline (recording bot joins as silent subscriber)
  ├── Object storage integration (segmented upload)
  ├── Consent management framework (jurisdiction-dependent)
  └── CONFLICTS WITH: Full E2EE (server-side recording impossible with E2EE)

E2EE (implicit from security) REQUIRES:
  ├── Insertable Streams API support on all clients
  ├── Key management service for per-sender key distribution
  ├── SFrame framing for standardized encryption
  └── CONFLICTS WITH: Server-side recording, noise suppression, transcription
```

---

## Non-Functional Requirements

| Category | Requirement | Target |
|---|---|---|
| **Latency** | Glass-to-glass (camera capture to screen render) | < 150ms for 95th percentile |
| **Latency** | SFU forwarding per hop | < 5ms median, < 15ms p99 |
| **Latency** | ICE negotiation to first media | < 500ms for 90th percentile |
| **Latency** | Signaling message delivery | < 50ms within same region |
| **Availability** | Media forwarding path | 99.99% (52 min downtime/year) |
| **Availability** | Signaling server | 99.95% (4.4 hrs downtime/year) |
| **Availability** | TURN relay | 99.9% per region (8.7 hrs/year) |
| **Packet Loss Tolerance** | Audio intelligibility maintained | Up to 5% random packet loss |
| **Packet Loss Tolerance** | Video watchable (with artifacts) | Up to 3% random packet loss |
| **Jitter Tolerance** | Smooth playout without glitches | Up to 30ms jitter with adaptive buffer |
| **Scalability** | Concurrent sessions platform-wide | 5M+ sessions |
| **Scalability** | Participants per room | Up to 100 active, 100K+ passive via cascading |
| **Scalability** | SFU horizontal scaling | Linear with node count |
| **Security** | Transport encryption | Mandatory DTLS-SRTP on all media |
| **Security** | E2EE option | Available via Insertable Streams |
| **Reconnection** | Peer reconnection after network change | < 2 seconds via ICE restart |
| **Codec** | Required video codec support | VP8 mandatory, VP9/AV1 optional |
| **Codec** | Required audio codec support | Opus mandatory (per WebRTC spec) |
| **Recording** | Recording availability and durability | 99.9% with < 5s segment loss on failure |
| **Data Channels** | Message delivery latency | < 100ms for reliable ordered mode |
| **Compatibility** | Browser/platform coverage | All modern browsers, native mobile SDKs |

---

## Capacity Estimations

### Assumptions

| Parameter | Value | Rationale |
|---|---|---|
| Daily active sessions | 10M sessions/day | Mid-large platform scale |
| Peak concurrent sessions | 2M sessions | ~20% of daily concentrated in peak hours |
| Average participants per session | 3.5 | Mix of 1:1 (2) and group (5-15) calls |
| Average session duration | 25 minutes | Typical video call length |
| Video bitrate per participant (up) | 2 Mbps | 720p with simulcast (high + low layers) |
| Video bitrate per participant (down) | 4 Mbps | Receiving 2-3 video tracks at varying quality |
| Audio bitrate per participant | 50 Kbps | Opus at 48 kHz |
| TURN relay percentage | 12% of sessions | Industry average for sessions requiring relay |
| Screen share percentage | 20% of sessions | Additional 1.5 Mbps track when active |

### Bandwidth Calculations

**Per-participant bandwidth (typical 4-person room):**

```
Upload:   1 video track x 2 Mbps (simulcast) + 1 audio x 50 Kbps = 2.05 Mbps
Download: 3 video tracks x 1.5 Mbps (avg) + 3 audio x 50 Kbps  = 4.65 Mbps
Total per participant: ~6.7 Mbps
```

**Aggregate platform bandwidth at peak:**

```
Concurrent participants: 2M sessions x 3.5 participants = 7M participants
Upload aggregate:  7M x 2.05 Mbps = 14.35 Tbps
Download aggregate: 7M x 4.65 Mbps = 32.55 Tbps
Total SFU bandwidth: ~47 Tbps (upload + download are different; SFU handles both)
```

**TURN relay bandwidth:**

```
TURN sessions: 2M x 12% = 240K concurrent relayed sessions
TURN bandwidth per session: ~6.7 Mbps x 2 (relay doubles—ingress + egress) = 13.4 Mbps
Total TURN bandwidth: 240K x 13.4 Mbps = 3.2 Tbps
```

### Signaling Load

```
Call setup messages per session:     ~15 (offer, answer, ICE candidates, join/leave)
Ongoing signaling per session:       ~2 messages/min (mute, quality updates, heartbeats)
Peak signaling QPS (setup):          2M sessions / 300s ramp x 15 msgs = 100K QPS
Peak signaling QPS (ongoing):        2M x 2/60 = ~67K QPS
Total signaling QPS at peak:         ~170K QPS
WebSocket concurrent connections:    7M (one per participant)
```

### STUN Server Load

```
ICE candidates gathered per session: ~8 (4 per peer, mix of host/reflexive/relay)
STUN requests per candidate:         1 binding request + response
Peak STUN QPS:                       2M sessions / 300s x 8 = ~53K QPS
Note: STUN is stateless and trivially horizontally scalable
```

### Storage (Recording)

```
Sessions recorded: 5% of total = 500K sessions/day
Average recording size: 25 min x 2 Mbps composite = 375 MB
Daily recording storage: 500K x 375 MB = 187.5 TB/day
Monthly storage: ~5.6 PB/month
Retention: 30-90 days configurable
```

### Server Capacity Planning

**SFU nodes:**

```
Tracks per SFU node: ~1,000 (with 10 Gbps NIC)
Concurrent tracks at peak: 7M participants x 2 tracks (audio + video) = 14M published tracks
SFU nodes needed: 14M / 1,000 = 14,000 nodes
With overhead/headroom (60% utilization target): ~23,000 SFU nodes
```

**TURN servers:**

```
Concurrent TURN allocations per server: ~500 (with 10 Gbps NIC)
TURN servers needed: 240K / 500 = 480 servers
Geo-distributed across 15+ regions for latency
```

**Signaling servers:**

```
WebSocket connections per server: ~50K (with proper tuning)
Signaling servers needed: 7M / 50K = 140 servers
```

### Cost Model Estimation

```
Cost breakdown per 1,000 concurrent sessions (1-hour duration):

SFU Compute:
  1,000 sessions x 3.5 participants = 3,500 participants
  3,500 participants x 2 tracks = 7,000 published tracks
  SFU nodes needed: 7,000 / 1,000 = 7 nodes (at 60% target utilization: 12 nodes)
  Compute cost: 12 nodes x $0.10/hr = $1.20/hr per 1K sessions

SFU Bandwidth:
  Upload: 3,500 x 2.05 Mbps = 7.175 Gbps
  Download: 3,500 x 4.65 Mbps = 16.275 Gbps
  Total: 23.45 Gbps
  Bandwidth cost: 23.45 Gbps x 3600s / 8 = 10.5 TB/hr
  At $0.02/GB: $210/hr per 1K sessions

TURN Relay (12% of sessions):
  120 relayed sessions x 13.4 Mbps x 3600s / 8 = 724 GB/hr
  At $0.02/GB: $14.48/hr per 1K sessions

Total cost per 1K session-hours: ~$226
Cost per participant-minute: ~$0.001
```

---

## SLO Summary

| SLO | Target | Measurement |
|---|---|---|
| Call setup success rate | ≥ 99.5% | Percentage of call attempts resulting in media flowing within 5s |
| Glass-to-glass latency (p95) | < 150ms | Measured via NTP-synced frame timestamps |
| Audio MOS score (p50) | ≥ 4.0 | Estimated MOS from packet loss, jitter, latency |
| Video freeze rate | < 2% of call duration | Percentage of time video is frozen > 500ms |
| TURN fallback latency | < 300ms additional | Compared to direct path for same region pair |
| Participant reconnection time | < 2s (p90) | ICE restart to first media after network switch |
| Platform availability (monthly) | ≥ 99.99% | Measured as successful media forwarding minutes / total minutes |
| Recording availability | ≥ 99.9% | Percentage of requested recordings successfully stored |

---

## Capacity Planning Decision Tree

```
For a room of N participants:
|-- N = 2 (1:1 call)
|   |-- Try P2P direct (STUN reflexive) — cheapest
|   |-- Fall back to TURN relay if symmetric NAT
|   +-- SFU optional (needed for recording or quality control)
|-- N = 3-6 (small group)
|   |-- SFU mandatory (mesh would require N x (N-1) connections)
|   |-- Simulcast: 2 layers (high + low)
|   +-- Single SFU node sufficient
|-- N = 7-50 (medium group)
|   |-- SFU with 3-layer simulcast (high/medium/low)
|   |-- Last-N optimization: only forward top N active speakers' video
|   |-- May span 2 SFU nodes if bandwidth exceeds single node
|   +-- Audio-only for non-active participants saves ~80% bandwidth
+-- N > 50 (large room / webinar)
    |-- Cascaded SFU mesh across multiple nodes
    |-- Tiered participant roles (publisher vs subscriber-only)
    |-- Aggressive last-N (show only 4-9 active speakers)
    |-- Lower default resolution for subscribers (360p)
    +-- Cross-region cascading if participants span geographies
```
