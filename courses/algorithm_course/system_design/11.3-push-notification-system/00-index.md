# 11.3 Push Notification System

## System Overview

A Push Notification System is the real-time communication backbone that delivers targeted, time-sensitive messages to billions of devices across mobile (iOS, Android, Huawei), web (browsers via Web Push), and desktop platforms. At scale, the system must integrate with multiple third-party push providers—Apple Push Notification service (APNs), Firebase Cloud Messaging (FCM), Huawei Push Kit (HMS), and the Web Push Protocol (VAPID)—each with distinct authentication schemes, payload formats, rate limits, and feedback mechanisms. Modern notification platforms orchestrate the entire lifecycle from ingestion to analytics: accepting notification requests from hundreds of internal services, resolving user-to-device mappings across a registry of billions of tokens, applying targeting and segmentation rules, rendering templates with personalization, scheduling time-zone-aware delivery, rate-limiting per provider and per user, fanning out to millions of devices in seconds, tracking delivery and engagement metrics, and enforcing user opt-out preferences—all while achieving sub-second ingestion-to-provider-handoff latency, 99.95%+ delivery success rates (for reachable devices), and processing throughput exceeding 1 million notifications per second at peak.

---

## Key Characteristics

| Characteristic | Description |
|---|---|
| **Architecture Style** | Microservices with event-driven fan-out pipeline, CQRS for device registry reads, and provider-specific adapter pools |
| **Core Abstraction** | Notification as a routable message envelope: payload + target (user/segment/topic) + channel (push/web/silent) + scheduling constraints + provider routing metadata |
| **Processing Model** | Streaming for real-time notification delivery; batch for scheduled campaigns, analytics aggregation, and token cleanup |
| **Provider Integration** | Multi-provider adapter layer (APNs HTTP/2, FCM HTTP v1, HMS Push Kit v2, Web Push VAPID) with per-provider connection pooling, rate limiting, and feedback processing |
| **Fan-Out Model** | Two-tier: logical fan-out (user → devices) via device registry, physical fan-out (devices → provider connections) via partitioned worker pools |
| **Data Consistency** | Strong consistency for device token registry and user preferences; eventual consistency for delivery status and analytics |
| **Availability Target** | 99.95% for notification ingestion API, 99.9% for delivery pipeline, 99.99% for device token registry |
| **Delivery Guarantee** | At-least-once delivery to providers with idempotency keys; exactly-once semantics for deduplication at the device level |
| **Personalization** | Template engine with variable interpolation, locale-aware content, A/B variant selection, and rich media attachment resolution |
| **Feedback Loop** | Real-time provider feedback processing (invalid tokens, throttle signals, delivery receipts) feeding back into device registry and analytics |

---

## Quick Navigation

| Document | Focus Area |
|---|---|
| [01 - Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning |
| [02 - High-Level Design](./02-high-level-design.md) | Architecture diagrams, data flows, key decisions |
| [03 - Low-Level Design](./03-low-level-design.md) | Data models, API contracts, core algorithms |
| [04 - Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Provider adapters, fan-out engine, token lifecycle |
| [05 - Scalability & Reliability](./05-scalability-and-reliability.md) | Scaling strategies, fault tolerance, disaster recovery |
| [06 - Security & Compliance](./06-security-and-compliance.md) | Threat model, token security, GDPR/privacy, provider auth |
| [07 - Observability](./07-observability.md) | Metrics, logging, tracing, alerting |
| [08 - Interview Guide](./08-interview-guide.md) | 45-minute pacing, trade-offs, common pitfalls |
| [09 - Insights](./09-insights.md) | Key architectural insights and cross-cutting patterns |

---

## What Differentiates This System

| Dimension | Simple Notification Sender | Production Push Notification Platform |
|---|---|---|
| **Provider Integration** | Single provider (FCM only), hardcoded credentials | Multi-provider adapter layer with connection pooling, automatic failover, per-provider rate limiting |
| **Token Management** | Store tokens in a single table, never clean up | Token lifecycle management: registration, validation, rotation, staleness detection, provider feedback-driven cleanup |
| **Fan-Out** | Sequential loop over devices, send one-by-one | Partitioned parallel fan-out with batched provider API calls, processing millions of devices in seconds |
| **Targeting** | Send to all users or explicit user IDs | Segment-based targeting with boolean expressions over user attributes, behavioral triggers, and topic subscriptions |
| **Personalization** | Static message text for everyone | Template engine with per-user variable interpolation, locale selection, A/B variants, and rich media |
| **Scheduling** | Fire immediately, ignore user's timezone | Time-zone-aware delivery windows, optimal send-time prediction, quiet hours enforcement |
| **Rate Limiting** | None—overwhelm provider, get throttled | Per-provider rate limiting (APNs/FCM quotas), per-user frequency capping, campaign-level pacing |
| **Delivery Tracking** | Fire-and-forget, no feedback | End-to-end delivery status tracking: accepted → delivered → displayed → interacted, with provider feedback loop |
| **Analytics** | None | Real-time dashboards: delivery rates, open rates, CTR, uninstall correlation, A/B test results, funnel analysis |
| **Preferences** | No opt-out mechanism | Granular user preference center: per-category opt-in/out, quiet hours, channel preferences, frequency limits |

---

## What Makes This System Unique

### 1. You Don't Own the Last Mile—Providers Do
Unlike most distributed systems where you control the entire delivery path, push notifications depend on third-party providers (APNs, FCM, HMS) for the final delivery hop to the device. You hand the message to the provider, and from that point, delivery timing, battery optimization, device sleep state, and network conditions are entirely outside your control. This means your "delivery guarantee" is actually a "handoff guarantee"—you can guarantee the provider accepted the message, but not that the user saw it. This fundamental constraint shapes every architectural decision: you must build robust feedback loops to learn what happened after handoff, design fallback channels (in-app, email) for critical messages, and carefully distinguish between "sent to provider" and "delivered to device" in your metrics.

### 2. The Fan-Out Problem Is the Defining Scale Challenge
A single campaign targeting "all users" with 500 million registered devices means generating 500 million individual provider API calls, each with a device-specific token. This is not a pub/sub broadcast—each message is uniquely addressed. At 1 million notifications/second throughput, a full fan-out takes over 8 minutes. The fan-out engine must partition devices across worker pools, batch API calls per provider (FCM supports up to 500 tokens per multicast), manage connection pools to providers, handle partial failures (some devices succeed, some fail), and track individual delivery status—all while maintaining backpressure so the pipeline doesn't overwhelm downstream providers or exhaust memory.

### 3. Provider APIs Are Heterogeneous and Rate-Limited
Each provider has fundamentally different APIs, authentication mechanisms, payload formats, and rate limits. APNs uses HTTP/2 with JWT or certificate-based auth, 4KB payload limit, and connection-based rate limiting. FCM uses HTTP v1 with OAuth 2.0, 4KB data payload, and per-project quotas. HMS uses OAuth 2.0 with different token endpoints. Web Push uses VAPID with elliptic-curve signed JWTs and encrypted payloads. The adapter layer must abstract these differences while respecting each provider's unique constraints—a leaky abstraction problem where the differences matter for performance, error handling, and rate management.

### 4. Device Token Entropy Is a Silent Reliability Killer
Device tokens are ephemeral. They change when a user reinstalls the app, restores from backup, clears app data, or (for APNs) when the provider rotates them silently. A device registry with 1 billion tokens accumulates stale tokens at 5-10% per month. Sending to stale tokens wastes provider quota, triggers throttling, and in APNs' case, can get your provider certificate flagged. Token hygiene—processing provider feedback (410 Gone, InvalidRegistration), tracking token freshness, running periodic validation sweeps, and promptly removing uninstalled devices—is not a maintenance task; it's a core reliability function that directly impacts delivery rates and provider standing.

---

## Scale Reference Points

| Metric | Value |
|---|---|
| **Global push notification volume** | ~15 billion push notifications sent daily across all platforms |
| **Registered devices (large platform)** | 500M–2B device tokens across all providers |
| **Daily active devices** | 200M–500M devices receiving notifications |
| **Peak notification throughput** | 1M–5M notifications/sec during campaigns or breaking events |
| **Average notification throughput** | 100K–300K notifications/sec sustained |
| **Device token registry size** | 500M–2B tokens × 500 bytes ≈ 250 GB–1 TB |
| **Notification events/day** | 5B–15B (sent + delivery receipts + opens + dismissals) |
| **Provider API calls/day** | 5B–15B across APNs, FCM, HMS, Web Push |
| **Stale token rate** | 5–10% of tokens become invalid per month |
| **Campaign fan-out time (500M devices)** | 5–10 minutes at 1M notifications/sec |
| **Notification payload size** | 2–4 KB average (title, body, image URL, deep link, actions) |
| **Analytics data volume** | 10–50 TB/day of delivery and engagement events |

---

## Technology Landscape

| Layer | Component | Role |
|---|---|---|
| **Ingestion API** | Rate-limited gateway | Accept notification requests, validate schemas, authenticate callers, enqueue for processing |
| **Device Registry** | Distributed token store | User-to-device mapping, token lifecycle management, platform metadata, preference storage |
| **Segmentation Engine** | Attribute-based query engine | Resolve target audiences from segment definitions, evaluate boolean expressions over user attributes |
| **Template Service** | Content rendering engine | Template storage, variable interpolation, locale selection, A/B variant assignment, rich media resolution |
| **Scheduling Service** | Time-zone-aware scheduler | Optimal send-time calculation, quiet hours enforcement, campaign pacing, deferred delivery queue |
| **Fan-Out Engine** | Partitioned parallel processor | Expand user targets to device tokens, batch by provider, distribute across worker pools |
| **Provider Adapters** | Platform-specific senders | APNs HTTP/2, FCM HTTP v1, HMS Push Kit, Web Push VAPID—each with connection pooling and rate limiting |
| **Feedback Processor** | Provider response handler | Parse delivery receipts, invalid token signals, throttle responses; update device registry and delivery status |
| **Analytics Pipeline** | Stream + batch processor | Real-time delivery metrics, open/CTR tracking, campaign performance, uninstall correlation |
| **Preference Service** | User opt-in/out manager | Category-level preferences, quiet hours, frequency caps, channel routing rules |
| **Priority Router** | Message classification engine | Classify notifications by urgency (transactional vs. marketing), route through appropriate priority queues |

---

## Related Patterns

| Pattern | Relevance |
|---|---|
| **Adapter / Anti-Corruption Layer** | Each provider adapter translates the internal notification model to provider-specific protocols—APNs HTTP/2, FCM multicast, HMS, Web Push VAPID—shielding the core pipeline from provider API differences |
| **Bulkhead Isolation** | Separate queue lanes and worker pools per priority class and per provider prevent cascading failures—APNs throttling cannot starve FCM delivery; marketing campaigns cannot delay OTP sends |
| **Fan-Out / Scatter-Gather** | The defining scaling pattern: expand a single logical notification into millions of per-device API calls, partitioned across worker pools, with aggregated delivery status collection |
| **Circuit Breaker** | Per-provider circuit breakers detect sustained provider failures (APNs 5xx, FCM QUOTA_EXCEEDED) and short-circuit sends to prevent queue exhaustion and quota waste |
| **Event Sourcing** | Notification lifecycle events (created → resolved → sent → delivered → opened) are appended to an immutable event log, enabling full replay for analytics, debugging, and compliance audits |
| **CQRS** | Device registry uses write-optimized store for token registration/deactivation and read-optimized cache layer for high-throughput token lookups during fan-out |
| **Timer Wheel** | Timezone-aware scheduling uses a distributed timer wheel to manage millions of deferred sends, efficiently firing batches at each timezone's optimal delivery window |
| **Backpressure / Flow Control** | Provider throttle signals propagate backward through the pipeline: provider → adapter queue → fan-out coordinator → ingestion, preventing memory exhaustion under load |

---

## Related Designs

| Design | Relationship |
|---|---|
| [4.7 Notification Feed](../4.7-notification-feed/00-index.md) | In-app notification feed is the persistent counterpart to ephemeral push; push drives urgency, feed provides history |
| [11.1 WhatsApp](../11.1-whatsapp/00-index.md) | Shares message delivery pipeline patterns—fan-out, delivery receipts, presence awareness—but with direct user-to-user messaging model |
| [11.2 Slack](../11.2-slack/00-index.md) | Slack's notification system demonstrates channel-level preference management and workspace-scoped notification routing |
| [4.3 Twitter](../4.3-twitter/00-index.md) | Twitter's fan-out-on-write vs fan-out-on-read debate parallels push notification pre-materialization vs lazy resolution trade-offs |
| [8.1 Amazon](../8.1-amazon/00-index.md) | E-commerce notification pipelines (order updates, delivery alerts) are the largest source of transactional push notifications |
| [5.7 Twitch](../5.7-twitch/00-index.md) | Live stream "going live" notifications face the same fan-out challenge—millions of followers notified within seconds |
| [15.1 Metrics Monitoring](../15.1-metrics-monitoring-system/00-index.md) | Alert routing in monitoring systems mirrors notification priority routing—critical alerts bypass batching just like transactional push |
| [10.2 IoT Platform](../10.2-iot-platform/00-index.md) | IoT device management patterns parallel device token lifecycle—registration, heartbeat validation, stale device cleanup |

---

## Evolution & Industry Trends

| Era | Trend | Impact on Architecture |
|---|---|---|
| **2015–2018** | GCM → FCM migration; APNs provider auth (JWT) | Adapter layer must handle credential migration without delivery disruption |
| **2018–2020** | GDPR enforcement; iOS notification permissions redesign | Consent management becomes a first-class pipeline component; preference enforcement within 24 hours |
| **2020–2022** | iOS 15 Notification Summary; Focus modes | "Delivered quietly" means displayed notification ≠ user awareness; engagement metrics lose reliability |
| **2022–2024** | Web Push support on iOS (Safari 16.4+); Live Activities (iOS 16) | New channel adds Web Push adapter for iOS; Live Activities enable real-time updating UI without repeated pushes |
| **2024–2025** | FCM HTTP v1 fully replaces legacy; APNs push-to-talk notifications; Huawei HMS global expansion | Legacy FCM endpoint deprecation forces migration; HMS market share growth in non-Google regions requires adapter investment |
| **2025–2026** | AI-driven send-time optimization; generative notification content; privacy-preserving engagement measurement | ML models predict per-user optimal delivery time; LLMs generate personalized notification copy; on-device attribution replaces server-side tracking |
| **Future** | Ambient notifications (wearables, AR glasses, car displays); cross-app notification protocols; decentralized push (replacing provider monopolies) | Multi-surface delivery targeting expands beyond phone/tablet/browser; open push protocols could eliminate provider lock-in |

---

## What Makes This System Architecturally Interesting

| Dimension | Why It's Unique |
|---|---|
| **External dependency as primary Slowest part of the process** | Unlike most systems where your own infrastructure is the scaling limit, push notification throughput is capped by provider rate limits (APNs/FCM quotas) you don't control |
| **Heterogeneous provider APIs** | Four fundamentally different protocols (HTTP/2, REST multicast, OAuth client credentials, VAPID + ECDH encryption) that must be unified behind a clean internal interface |
| **Write-dominated workload** | 10:1 write-to-read ratio inverts the typical caching strategy; the system optimizes for write throughput, not read latency |
| **Fan-out is the defining problem** | A single campaign = billions of individually-addressed API calls. This is not pub/sub; it's the largest scatter operation in system design |
| **Token entropy as reliability threat** | 5-10% of device tokens go stale monthly—a "healthy" system is constantly decaying, requiring active token lifecycle management |
| **Category-aware everything** | Dedup windows, frequency caps, delivery priority, consent requirements, and analytics all vary by notification category—making category a first-class dimension |

---

## Sources & References

| Source | Focus |
|---|---|
| Apple Developer Documentation — APNs Overview | Provider protocol, payload format, feedback semantics |
| Firebase Documentation — FCM Architecture | HTTP v1 API, multicast, topic messaging, token lifecycle |
| Web Push Working Group — RFC 8030, RFC 8291 | Web Push protocol, VAPID authentication, payload encryption |
| IETF RFC 8188 — Encrypted Content-Encoding for HTTP | AES-128-GCM encryption required by Web Push |
| Industry Reports — Global Push Notification Benchmarks | Delivery rates, open rates, uninstall correlation by industry vertical |
| GDPR Article 21, ePrivacy Directive Article 13 | Direct marketing opt-out rights and electronic communications consent |

---

*Next: [Requirements & Estimations ->](./01-requirements-and-estimations.md)*
