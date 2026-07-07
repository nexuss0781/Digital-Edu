# Google Meet / Zoom System Design

## Overview

Google Meet / Zoom is a real-time video conferencing platform supporting everything from 1-on-1 calls to large meetings with 1000+ participants. The system's defining challenge is **real-time media delivery at scale** -- achieving sub-200ms end-to-end latency for audio and video across globally distributed participants while continuously adapting to heterogeneous network conditions. Built on WebRTC as the transport layer (ICE, STUN/TURN, DTLS-SRTP), the architecture centers on a **Selective Forwarding Unit (SFU)** for media routing, with hybrid P2P/SFU/MCU topology selection based on meeting size. The system employs simulcast and SVC (Scalable Video Coding) for per-subscriber bandwidth adaptation, server-side MCU compositing for recording, and AI-powered features including noise cancellation, background replacement, and real-time transcription -- all served through a global infrastructure of geo-routed media servers.

## Key Characteristics

| Characteristic | Description |
|----------------|-------------|
| **Traffic Pattern** | Sustained real-time streams with diurnal peaks aligned to business hours across time zones |
| **Read:Write Ratio** | Symmetric -- each participant both sends and receives media simultaneously |
| **Consistency Model** | Eventual consistency for signaling metadata; strict ordering for media frames within each stream |
| **Latency Sensitivity** | Ultra-critical -- <150ms mouth-to-ear latency required for interactive conversation |
| **Contention Level** | Moderate -- SFU handles N streams per participant rather than N-squared connections |
| **Data Sensitivity** | HIPAA/GDPR compliance for enterprise deployments, optional end-to-end encryption |

## Complexity Rating

**Very High** -- Combines hard real-time constraints with adaptive bitrate media processing, hybrid topology orchestration, global media server routing, AI-powered audio/video enhancement, server-side recording compositing, and per-subscriber bandwidth adaptation across heterogeneous network conditions.

## Quick Navigation

| Document | Description |
|----------|-------------|
| [01 - Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning |
| [02 - High-Level Design](./02-high-level-design.md) | System architecture, data flow, key decisions |
| [03 - Low-Level Design](./03-low-level-design.md) | Data models, API design, core algorithms |
| [04 - Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | SFU scaling, media routing, bandwidth adaptation |
| [05 - Scalability & Reliability](./05-scalability-and-reliability.md) | Scaling strategies, fault tolerance, DR |
| [06 - Security & Compliance](./06-security-and-compliance.md) | E2E encryption, HIPAA/GDPR, threat model |
| [07 - Observability](./07-observability.md) | Metrics, logging, tracing, alerting |
| [08 - Interview Guide](./08-interview-guide.md) | 45-min pacing, trap questions, trade-offs |

## What Makes This System Unique

1. **Real-Time Constraint**: Unlike most distributed systems where latency is measured in hundreds of milliseconds or seconds, video conferencing has a hard latency budget of roughly 150ms mouth-to-ear. Every architectural decision -- media server placement, codec selection, jitter buffer depth, network path -- must respect this non-negotiable constraint.
2. **Heterogeneous Clients**: Participants in the same meeting range from fiber-connected desktops with dedicated GPUs to mobile phones on congested 3G networks. The system must adapt media quality independently per subscriber, delivering different resolutions and bitrates to each participant simultaneously.
3. **Media is Not Data**: Video and audio streams are loss-tolerant but delay-intolerant -- the exact opposite of typical request/response distributed systems. A dropped frame is acceptable; a 500ms delay makes conversation impossible. This inverts conventional reliability assumptions.
4. **N-Way Topology Problem**: Each participant both produces and consumes multiple media streams. Scaling from 2 participants (where P2P works) to 10 (where SFU is optimal) to 1000+ (where cascaded SFUs with active speaker detection are necessary) requires fundamentally different architectures that the system must dynamically select and transition between.
5. **Recording vs Live Path**: Recording requires server-side compositing with MCU-like behavior (decoding, mixing, and re-encoding all streams into a single output), while live delivery uses SFU forwarding (no transcoding). These two conflicting media processing models must coexist within one system, often for the same meeting simultaneously.
6. **AI as a Parallel Processing Pipeline**: Every audio and video frame can optionally pass through AI models (noise cancellation, background segmentation, live transcription) before reaching other participants. These AI pipelines must complete within a single frame budget (~16ms for 60fps video, ~20ms for audio) or they add perceptible latency. The system must support AI as a progressive enhancement that degrades gracefully when GPU resources are constrained.

## Related Patterns

| Related Design | Relationship | Key Lesson Borrowed |
|---|---|---|
| [12.8 WebRTC Infrastructure](../12.8-webrtc-infrastructure/00-index.md) | Foundation layer | ICE/STUN/TURN negotiation, DTLS-SRTP key exchange, data channel semantics |
| [6.11 WebRTC Collaborative Canvas](../6.11-webrtc-collaborative-canvas/00-index.md) | Sibling real-time system | WebRTC data channels for non-media payloads, SFU relay topology, ephemeral vs durable state separation |
| [5.3 Netflix / YouTube Streaming](../5.3-netflix-youtube-streaming/00-index.md) | Contrast: on-demand vs live | Adaptive bitrate strategies (HLS/DASH), CDN distribution, codec selection -- but conferencing cannot buffer; streaming can |
| [11.4 Email Delivery System](../11.4-email-delivery-system/00-index.md) | Notification integration | Meeting invitations, recording availability notifications, delivery reliability |
| [1.2 Distributed Load Balancer](../1.2-distributed-load-balancer/00-index.md) | Infrastructure pattern | Geo-aware routing, anycast-based traffic distribution, health-check-driven failover |
| [6.14 Customer Support Platform](../6.14-customer-support-platform/00-index.md) | Consumer of video APIs | Embedded video calls within support workflows, screen sharing for issue diagnosis |
| [12.2 Multiplayer Game State Sync](../12.2-gaming-multiplayer-game-state-sync/00-index.md) | Sibling real-time system | UDP-first transport, client-side prediction, jitter compensation, state reconciliation |
| [15.1 Distributed Tracing Infrastructure](../15.1-distributed-tracing-infrastructure/00-index.md) | Observability backbone | Trace propagation across signaling/media paths, sampling strategies for high-volume packet flows |

## Technology Landscape

| Component | Technology | Role |
|---|---|---|
| Transport Protocol | WebRTC (ICE/STUN/TURN/DTLS-SRTP) | Real-time media delivery over UDP with NAT traversal |
| Media Router | SFU (Selective Forwarding Unit) | Per-subscriber layer selection without transcoding |
| Video Codecs | VP9, AV1, H.264 | Encoding with simulcast and SVC support |
| Audio Codec | Opus | Adaptive bitrate audio with built-in FEC |
| Signaling | WebSocket over TLS | SDP offer/answer, ICE candidates, roster events |
| Key Agreement | MLS (RFC 9420) | Scalable group key management for E2EE |
| AI Inference | On-device and edge GPU | Noise cancellation, background segmentation, transcription |
| Broadcast Ingest/Playback | WHIP / WHEP | WebRTC-native low-latency broadcast protocols |
| Custom Video Processing | WebCodecs API | Client-side codec access for custom pipelines |

## Architectural Evolution (2025–2026 Trends)

| Trend | Impact | Architectural Implication |
|---|---|---|
| **AV1 SVC hardware decode** | Intel 12th gen+, Apple M1+ have AV1 hardware decoders; SVC mode eliminates simulcast upstream overhead | Migrate from VP9 simulcast to AV1 SVC as primary codec when client hardware supports it; reduces upstream bandwidth by 30-40% |
| **WebTransport (QUIC-based)** | Multiplexed streams over QUIC with independent congestion control per stream; survives network migration | Potential replacement for WebSocket signaling; multiplexed control + data streams without head-of-line blocking |
| **Neural audio codecs** | Models like Lyra/SoundStream achieve intelligible speech at 3-6 Kbps vs 32 Kbps Opus minimum | Ultra-low-bitrate fallback for extreme bandwidth constraints; requires client-side ML inference |
| **AI meeting intelligence** | Real-time transcription accuracy >95%, multi-language translation, automated summarization | Drives GPU infrastructure requirements at scale; per-meeting AI compute becomes a significant cost center |
| **MLS protocol (RFC 9420)** | Standardized group key agreement with O(log N) update cost | Enables E2EE for meetings with 100+ participants where pairwise key exchange is infeasible |
| **WHIP/WHEP broadcast** | WebRTC-native ingest (WHIP) and playback (WHEP) protocols replace RTMP for low-latency streaming | Unifies live meeting and broadcast architectures; audience receives via WHEP with sub-second latency |

## Real-World Scale

| Metric | Value |
|--------|-------|
| Google Meet monthly participants | 300M+ (2025) |
| Zoom daily meeting participants (peak) | 350M+ |
| Zoom annual meeting minutes | 3.3 trillion |
| Google global network edge locations | 202 |
| Google private fiber network | 2M+ miles |
| Zoom co-located data centers | 20+ globally |
| LiveKit (open-source SFU) annual calls | 3B+ |
| SFU vs MCU efficiency | SFU handles ~15x more participants on same hardware |
| Audio latency target (glass-to-glass) | Sub-100ms |
| Peak TURN relay sessions | 4.5M concurrent (~15% of 30M streams) |
| Signaling QPS at peak | ~500K events/second |
| Recording storage (annual) | ~1.4 EB |
| SFU servers required (peak) | ~31K globally |
| TURN servers required | ~1,400 globally |
| Recording compositing throughput | 3-5x real-time per GPU worker |

## Core Architecture Principles

| Principle | Description |
|---|---|
| **Signaling/Media Separation** | Control plane (WebSocket) and data plane (UDP/SRTP) are completely independent paths. Signaling failure does not interrupt active media streams. |
| **Per-Subscriber Adaptation** | Each receiver gets independently adapted quality based on their network conditions. One participant's poor connection never degrades others. |
| **Topology Elasticity** | The system dynamically transitions between P2P (2 users), single SFU (3-50), and cascaded SFU (50-1000+) based on meeting size. |
| **Recording as Hidden Participant** | Recording joins the SFU as a passive subscriber, decoupling capture from the live forwarding path. |
| **AI as Progressive Enhancement** | AI features (noise cancellation, backgrounds, captions) can be disabled independently without affecting core media flow. |
| **Edge-First Media Routing** | Media servers deployed at 200+ global PoPs to minimize first-hop latency. Private backbone for inter-region cascading. |

## Critical Design Tensions

Understanding the inherent tensions in video conferencing architecture is essential for navigating design decisions:

| Tension | Side A | Side B | How Production Systems Resolve It |
|---|---|---|---|
| **Latency vs Reliability** | UDP drops packets but delivers the rest on time | TCP retransmits but blocks on loss | Use UDP for media (accept loss), TCP for signaling (need reliability) |
| **E2EE vs Features** | Full encryption prevents server access to media | Server-side features (recording, transcription) need cleartext | Offer both modes; E2EE disables server features explicitly |
| **SFU vs MCU** | SFU scales 15x better but shifts decoding to clients | MCU reduces client load but costs 15x more server-side | SFU for live path, MCU only for recording compositing |
| **Simulcast vs SVC** | Simulcast has universal codec support but 1.5-2x upstream | SVC is 30% more efficient but limited to VP9/AV1 | Simulcast as default, SVC as progressive enhancement for capable clients |
| **Direct vs TURN** | Direct connections minimize latency and cost | TURN relays work through any firewall | Direct first, TURN fallback for the ~15% behind symmetric NATs |
| **AI quality vs latency** | Better AI models produce higher quality (noise cancellation, segmentation) | Larger models add inference latency | Client-side lightweight models with <10ms budget; server-side for non-real-time (transcription) |
| **Recording immediacy vs quality** | Real-time compositing gives immediate playback | Post-meeting multi-pass encoding produces better quality | Post-meeting by default; real-time only for live streaming |

## Case Study: Zoom's Monday Morning Thundering Herd

At 9:00 AM Eastern, Zoom experiences a predictable 4-5x spike in meeting creation within a 10-minute window as the US business day begins. This creates a thundering herd on SFU capacity, TURN allocation, and signaling WebSocket connections. The mitigation strategy combines three approaches: (1) time-zone-aware pre-scaling that provisions SFU capacity 30 minutes before predicted regional peaks, (2) staggered ICE negotiation that adds 0-2 seconds of random jitter to join sequences to spread the load, and (3) warm TURN credential pools that pre-generate ephemeral credentials to eliminate credential-generation latency during the spike. The result: join times remain under 3 seconds even during peak bursts of 1,800+ new meetings per second.

## Key Capacity Benchmarks

| Benchmark | Value | Significance |
|---|---|---|
| **Meeting join target (p95)** | < 3 seconds (click-to-first-audio) | Primary user experience metric; dominated by ICE negotiation time |
| **Mouth-to-ear latency budget** | 150ms total | Broken down: ~30ms encode, ~20ms network first hop, ~30-80ms inter-region, ~20ms jitter buffer, ~10ms decode |
| **SFU bandwidth per meeting (720p, 6 users)** | ~55 Mbps through SFU | ~9.3 Mbps inbound (6 publishers), ~46.5 Mbps outbound (6×5 subscribers) |
| **Recording compositing speed** | 3-5x real-time per GPU worker | A 1-hour meeting composites in 12-20 minutes; shorter meetings prioritized in queue |
| **TURN relay percentage** | ~15% of all connections | Driven by symmetric NATs and corporate firewalls; each relayed stream costs 2x bandwidth |
| **Keyframe interval (periodic)** | Every 2-3 seconds | Balances bandwidth (keyframes are 10-50x larger than P-frames) against layer-switch latency |

## Sources

- Google Cloud Network Infrastructure
- Zoom Architecture Technical Library
- LiveKit Open-Source SFU Documentation
- WebRTC.org and W3C WebRTC Standards
- RFC 8825-8831 (WebRTC Architecture RFCs)
- RFC 9420 (MLS - Messaging Layer Security)
- WHIP/WHEP IETF Drafts
- Tsahi Levent-Levi WebRTC Predictions 2026
