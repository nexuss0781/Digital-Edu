# Insights — SMS Gateway

## Insight 1: The Carrier Is the Slowest part of the process You Cannot Engineer Away

**Category:** Scaling

**One-liner:** Unlike every other distributed system where you can add capacity by deploying more nodes, an SMS gateway's throughput ceiling is determined by external carrier TPS limits that no amount of infrastructure can increase.

**Why it matters:**

In a typical distributed system—a database, a cache, a compute layer—when you hit a throughput wall, the solution is horizontal scaling: add more nodes, add more shards, add more replicas. The SMS gateway fundamentally breaks this assumption. The Slowest part of the process isn't your infrastructure; it's the carrier SMSC that sits behind a contractual TPS limit. Carrier A allows 5,000 TPS. You cannot buy a second Carrier A connection and get 10,000 TPS—they'll throttle you or terminate the connection.

This means the architectural strategy inverts from "scale to meet demand" to "distribute demand across fixed-capacity endpoints." The routing engine isn't just an optimization—it's the core scaling mechanism. When one carrier is at capacity, traffic must overflow to alternative carriers with available TPS headroom. The message queue isn't just a decoupling buffer—it's a rate-matching layer between unbounded customer demand and bounded carrier capacity. Priority queuing becomes essential because when total demand exceeds aggregate carrier capacity, you must choose which messages to delay (marketing) and which to prioritize (OTP).

The long-term scaling strategy is negotiation, not engineering: securing higher TPS allocations from carriers, establishing direct carrier relationships (bypassing aggregators with their own limits), and provisioning dedicated short codes that come with significantly higher TPS allowances. This is unusual in system design—your scaling roadmap is partly a business development roadmap.

---

## Insight 2: Message State Is a Distributed Consensus Problem Across Trust Boundaries

**Category:** Consistency

**One-liner:** A message's true delivery status is distributed across three independent systems (your platform, the originating carrier, the terminating carrier), and you must build a reliable view from unreliable, partial, and sometimes dishonest signals.

**Why it matters:**

When you submit a message via SMPP, you receive a `submit_sm_resp` with a carrier message_id. This means the carrier's SMSC accepted the message—not that it was delivered. The message then traverses the carrier's internal routing (potentially crossing to a different carrier if the recipient is on a different network), and at some point, the destination carrier may send a DLR back. The keyword is "may."

Some carriers never send DLRs. Others send DLRs that confirm "delivered to SMSC" but not "delivered to handset." Some carriers send fake "delivered" DLRs to improve their apparent delivery metrics—they report delivery without handset confirmation. The DLR may arrive in 100ms, or 6 hours later, or never. Your platform must construct a reliable customer-facing status from these unreliable signals.

The architectural response is a state machine with timeout-based fallbacks: after 72 hours without a final DLR, the message moves to "unknown." Carrier trust scoring tracks each carrier's DLR reliability (percentage of messages that receive a final DLR, percentage where DLR matches observed engagement). Carriers with poor DLR fidelity get lower routing scores, creating economic pressure to improve. But fundamentally, the platform must be transparent with customers: "delivered" means "the carrier's DLR said delivered," not "we verified the recipient read it." This honest framing of what delivery means is a product decision shaped by architectural reality.

---

## Insight 3: Regulatory Compliance Is Per-Message, Creating a Unique Runtime Evaluation Problem

**Category:** Compliance

**One-liner:** Unlike most compliance frameworks that apply uniformly to all data (GDPR, HIPAA), SMS compliance rules vary per individual message based on destination, number type, content, time-of-day, and sender registration status—requiring real-time rule evaluation on the critical path.

**Why it matters:**

In a typical system, compliance is a configuration concern: you enable GDPR mode, encrypt PII, and all requests are treated uniformly. In an SMS gateway, the compliance landscape is combinatorial. Consider a single message: if it's sent to a US number via a 10DLC sender, it needs TCPA consent verification, 10DLC campaign registration check, CTIA content guidelines validation, and time-of-day restriction enforcement (no marketing before 8 AM or after 9 PM in the recipient's timezone). If the same message were sent to a UK number, it falls under GDPR's ePrivacy directive instead. If sent to India, TRAI DND registry check and DLT template registration are required. If sent via a short code, different rules apply than for a long code.

The compliance engine must evaluate each message individually, and it sits on the critical path—before routing. You cannot compliance-check messages after delivery because a single TCPA violation is $500-$1,500 in statutory damages, and class actions aggregate across all affected recipients. A million-message marketing campaign sent without proper 10DLC registration could result in carrier-level filtering (100% block rate) or regulatory fines exceeding the company's revenue.

This per-message evaluation must execute in < 10ms to avoid becoming a Slowest part of the process at 35K msg/sec. The solution is a tiered approach: fast-path checks (opt-out cache lookup, sender registration cache) handle 95% of compliance decisions in < 1ms. Slow-path checks (content classification, URL scanning) are parallelized. Any single check that fails results in immediate rejection—the compliance engine is fail-closed, not fail-open.

---

## Insight 4: GSM-7 Encoding Is a Hidden Cost Multiplier That Shapes Product Decisions

**Category:** Data Structures

**One-liner:** The difference between GSM-7 (160 chars) and UCS-2 (70 chars) encoding means a single emoji or accented character can double or triple the number of SMS segments billed—turning an encoding detail into a significant cost and product design concern.

**Why it matters:**

SMS encoding seems like a trivial implementation detail until you understand its financial implications. A 160-character English message is one SMS segment in GSM-7 encoding. Add a single emoji (🎉) and the entire message must be re-encoded as UCS-2, reducing capacity to 70 characters. That same 160-character message now requires 3 segments (⌈160÷67⌉ = 3, because concatenation uses 67 chars per segment in UCS-2). The customer is billed for 3 messages instead of 1—a 3x cost increase for one emoji.

This encoding constraint shapes the product in several ways. First, the API must transparently report segment count before sending, so customers can make informed decisions. Second, "smart encoding" becomes a feature: automatically substituting Unicode characters with GSM-7 equivalents when possible (curly quotes → straight quotes, em dash → hyphen). Third, the billing engine must count segments, not messages—a critical distinction that confuses many customers.

For concatenated messages, the encoding overhead compounds. Each segment carries a 6-7 byte UDH (User Data Header) containing the concatenation reference, reducing usable capacity from 160 to 153 (GSM-7) or 70 to 67 (UCS-2) characters per segment. The reference ID in the UDH is an 8-bit value (0-255), which means at most 256 concatenated messages can be in-flight simultaneously to the same destination before reference IDs collide. At high throughput, this creates a subtle collision risk that can cause segment reassembly failures on the handset.

---

## Insight 5: Carrier-Partitioned Queues Are a Rate-Matching Architecture, Not Just a Routing Convenience

**Category:** Architecture

**One-liner:** Partitioning message queues by carrier rather than by destination or customer creates a natural rate-matching layer where each queue's consumption rate precisely matches its carrier's TPS limit—the most elegant solution to the heterogeneous rate-limiting problem.

**Why it matters:**

The SMS gateway faces a unique queueing problem: the producers (customer API calls) are homogeneous and elastic, but the consumers (carrier SMPP connections) have wildly different, fixed consumption rates. Carrier A accepts 5,000 TPS, Carrier B accepts 200 TPS, and Carrier C in a developing market accepts 20 TPS. If you use a single queue or destination-partitioned queues, the consumer for each queue must know which carrier each message targets and enforce the appropriate rate—mixing rate-limiting logic with consumption logic.

Carrier-partitioned queues solve this cleanly: each queue feeds a single carrier, and each consumer applies a single rate limit. The queue depth becomes a direct measurement of carrier pressure—a carrier with a growing queue is under pressure; a carrier with an empty queue has unused capacity. This signal feeds back into the routing engine: routes to congested carriers get lower scores, naturally redistributing traffic.

Priority lanes within each carrier partition add another dimension. A carrier queue with OTP, transactional, and marketing lanes implements weighted fair queuing: 70% of the carrier's TPS goes to the highest-priority non-empty lane. During a marketing campaign blast, OTP messages for all customers continue to flow at full speed through their priority lane, even though the same carrier's marketing lane is deeply queued. This priority isolation would be much harder to achieve with destination-partitioned or customer-partitioned queues.

---

## Insight 6: SMPP's Asynchronous Window Protocol Creates a Natural Backpressure Mechanism

**Category:** Resilience

**One-liner:** SMPP's in-flight window (unacknowledged PDUs per connection) acts as an automatic backpressure valve—when a carrier slows down, the window fills and submission automatically throttles without any explicit rate-limiting logic.

**Why it matters:**

SMPP is an asynchronous protocol: you can send multiple `submit_sm` PDUs without waiting for each `submit_sm_resp`. The "window" is the maximum number of unacknowledged PDUs allowed in flight simultaneously (typically 10-50 per connection). When the carrier SMSC is healthy, responses come back in 50-100ms, and the window stays mostly empty. When the carrier is under load, response times increase. As responses slow, the window fills. When the window is full, no more PDUs can be sent on that connection—the protocol itself throttles the sender.

This is a more elegant backpressure mechanism than application-level rate limiting because it responds to actual carrier load, not estimated capacity. A carrier might normally handle 1000 TPS per connection but degrade to 200 TPS during peak hours. An application-level token bucket set to 1000 TPS would overflow the carrier; an application-level bucket set to 200 TPS would underutilize the carrier during normal hours. The SMPP window automatically adjusts: during normal hours, the 50-PDU window processes quickly (50 TPS per window × 20 connections = 1000 TPS), and during degraded hours, the same window processes slowly (10 TPS per window × 20 connections = 200 TPS).

The architectural implication is that the SMPP connection pool is the true rate-limiting layer, not the application-level token bucket. The token bucket provides a hard ceiling (the contractual TPS limit), but the window provides the dynamic, load-responsive throttle. Monitoring window utilization (current in-flight / max window) is the best real-time indicator of carrier pressure—more responsive than monitoring response latency or error rates.

---

## Insight 7: Traffic Pumping Is an Economic Attack Exploiting the Billing Asymmetry Between Sender and Receiver

**Category:** Security

**One-liner:** Traffic pumping exploits the fact that senders pay per message while certain receiving carriers earn revenue per message—creating a fraudulent feedback loop where attackers generate messages to destinations that pay them for receiving traffic.

**Why it matters:**

Traffic pumping (artificially inflated traffic, or AIT) is the most financially damaging attack against SMS gateways, and it exploits a fundamental economic asymmetry in the telecommunications billing model. When an application sends an SMS, the sending platform (and ultimately the customer) pays. The receiving carrier also earns interconnect revenue for terminating the message. In legitimate traffic, this is a non-issue. But certain carriers—particularly in countries with premium-rate number ranges or lax regulation—actively share this termination revenue with number holders.

The attack works as follows: an attacker creates an account on the SMS platform, obtains a block of numbers from a revenue-sharing carrier, and triggers message sends to those numbers (often by exploiting OTP flows—enter the attacker's numbers into sign-up forms of legitimate businesses). The SMS platform's customer pays for the messages, the terminating carrier earns interconnect fees, and the carrier shares a portion with the attacker. The attacker doesn't even need to receive the messages—the economic loop completes at the carrier level.

Detection is challenging because each individual message looks legitimate: it's a real phone number, sent through proper channels, with valid content. The signals are statistical: unusual concentration of traffic to specific number ranges, sequential number patterns, new accounts with sudden high international volume, and traffic to known pumping destinations. The mitigation is layered: real-time velocity checks, destination risk scoring, progressive trust models for new accounts (limited messaging until identity verified), and spend caps that limit financial exposure before fraud is detected.

---

## Insight 8: The 10DLC Registration Pipeline Converts a Real-Time System Into a Days-Long Approval Workflow

**Category:** Operations

**One-liner:** 10DLC requires brand vetting and campaign registration that take 5-10 business days to complete, creating an onboarding Slowest part of the process where customers cannot send their first message for over a week—a product design challenge disguised as a compliance requirement.

**Why it matters:**

Modern developers expect to sign up for an API and send their first message within minutes. The 10DLC (10-digit long code) registration requirement in the US fundamentally breaks this expectation. Before a customer can send A2P messages through a local US number, they must: (1) register their brand with The Campaign Registry (TCR), providing legal entity information, EIN, and website—review takes 1-7 business days; (2) register each messaging campaign (use case, sample messages, opt-in flow)—review takes 1-3 business days; (3) have the campaign approved by each carrier (AT&T, T-Mobile, Verizon) independently. Only then can messages flow.

This creates an architectural challenge: the provisioning and compliance systems must manage a multi-day, multi-party approval workflow with status tracking, failure handling, and customer notification. The system must gracefully handle the transition states: account created but brand pending, brand approved but campaign pending, campaign approved by T-Mobile but rejected by AT&T.

The product response is multi-layered: offer toll-free numbers (verification takes 3-5 business days but is simpler), provide pre-registered short codes for high-volume senders, and create a "sandbox" mode where customers can test with limited messaging before 10DLC approval. The API must clearly communicate which numbers are approved for which carriers and which message types, preventing customers from discovering at send time that their number isn't registered for their intended use case. This compliance-driven onboarding complexity is a major differentiator between SMS platforms—the one with the smoothest registration experience wins customers.

---

## Insight 9: Number Pooling Transforms a Stateless Delivery Problem into a Sticky Session Routing Problem

**Category:** System Modeling

**One-liner:** When customers use a pool of sender numbers, recipients must consistently see the same number across a conversation — turning each message into a session-aware routing decision rather than a simple dispatch.

**Why it matters:**

Without number pooling, a customer sends from a single number, and routing is straightforward: every message to a given recipient comes from the same sender. But single numbers have carrier-imposed TPS limits (10 TPS for 10DLC, 100 TPS for short codes). Customers needing higher throughput use a pool of 10-100 numbers, distributing traffic across them to aggregate TPS capacity.

The complication arises from two-way messaging: if a customer sends a message to a recipient from number A, and the recipient replies, the reply arrives on number A. If the next outbound message to the same recipient comes from number B, the recipient now has two separate SMS threads — a confusing and unprofessional experience. The routing engine must maintain a "sticky mapping" (recipient → sender number) that persists across messages.

This sticky mapping creates state that must be consistent across all routing engine instances, durable across restarts, and evictable when numbers are removed from pools. The mapping must also respect number capabilities: if number A in the pool is a 10DLC number approved only for campaign X, it cannot be used for campaign Y messages to the same recipient. The simple-sounding "use a pool of numbers" requirement cascades into a distributed, capability-aware, session-routing system with consistency requirements that rival a session store in a web application.

---

## Insight 10: DLR Correlation Is a Distributed Join Problem with Non-Unique, Format-Inconsistent Keys

**Category:** Data Structures

**One-liner:** When carriers return delivery reports, the carrier's message_id that links a DLR to the original message is not globally unique, may be in a different format than what was issued, and can arrive hours later — creating a temporal distributed join problem.

**Why it matters:**

When you submit a message via SMPP, the carrier's `submit_sm_resp` returns a `message_id` (e.g., "ABC123"). When the DLR arrives later via `deliver_sm`, it contains that same `message_id` to identify which message was delivered. Simple — except for three problems.

First, message_ids are not globally unique. Different carriers may return the same string "ABC123" for different messages. The correlation key must be (carrier_id, message_id), not just message_id. Second, some carriers return the message_id in decimal in the response but hexadecimal in the DLR (or vice versa). A system that does literal string matching will fail to correlate these. Third, DLRs can arrive 30 seconds, 5 minutes, or 72 hours after submission. The correlation cache must retain entries for at least 72 hours, and at 1B messages/day, that's 3B+ entries — too large for a simple in-memory cache.

The solution is a write-through correlation cache with a tiered eviction strategy: entries stay in the hot cache (distributed in-memory) for 6 hours (covering 95%+ of DLRs), then fall through to a warm store (on-disk key-value) for 72 hours. Format normalization (uppercase, hex-to-decimal conversion) is applied at both write and read time. Orphaned DLRs (no matching submission) are logged and periodically analyzed — a high orphan rate for a specific carrier indicates a correlation format bug that needs a carrier-specific adapter fix.

---

## Insight 11: Message Validity Periods Create a Time-Bounded State Machine That Garbage-Collects Itself

**Category:** Architecture

**One-liner:** Each message has a validity period (5 minutes for OTP, 24 hours for marketing) after which the message should not be delivered — the message queue and carrier must both enforce this, creating a distributed TTL problem with partial enforcement.

**Why it matters:**

An OTP code that arrives 30 minutes late is worse than one that never arrives — the user has already abandoned the flow, and a late delivery creates confusion. A marketing message delivered 48 hours after a flash sale ended is irrelevant and wastes money. The validity period is the message's natural TTL, and the system must enforce it at multiple layers.

The SMPP protocol supports a `validity_period` field in `submit_sm`, telling the carrier SMSC to discard the message if it cannot be delivered within that window. But not all carriers respect this field, and the carrier's clock may not be synchronized with yours. The platform must independently enforce validity: (1) at the queue layer — messages that have aged past their validity period in the queue are discarded before submission, preventing wasted carrier TPS on expired messages; (2) at the DLR layer — a "delivered" DLR arriving after the validity period is logged but may be flagged as "delivered late" in analytics.

This validity-based expiration creates a natural garbage collection mechanism for the message state machine. Messages in "submitted" state with no DLR after 72 hours move to "unknown." Messages in "queued" state past their validity period move to "expired." This self-cleaning behavior prevents the message store from accumulating indefinitely-pending messages, which would otherwise grow without bound during carrier outages.

---

## Insight 12: International Routing Creates a Country-Carrier Matrix That Must Be Maintained as Living Infrastructure

**Category:** Operations

**One-liner:** Routing a message to the optimal carrier for a given destination country requires maintaining a continuously-updated matrix of (country × carrier) delivery performance, pricing, regulatory status, and capability data — a living dataset that degrades if not actively maintained.

**Why it matters:**

For a gateway serving 200+ countries through 400+ carriers, the routing table is a matrix with 80,000+ cells, each representing a specific (country, carrier) combination with its own cost, delivery rate, latency, supported number types, and regulatory requirements. This matrix is not static — carrier performance in a given country shifts week to week based on carrier network changes, interconnect agreement modifications, regulatory actions, and seasonal traffic patterns.

The maintenance challenge is that most of this data comes from observation, not configuration. Delivery rates are measured from actual traffic. Costs come from carrier contracts that change quarterly. Regulatory status changes when a country updates its messaging laws (India's DLT template requirement, Nigeria's DND registry, EU's ePrivacy regulation). A carrier's performance in delivering to Country X can degrade suddenly if that carrier loses an interconnect agreement with the dominant mobile operator in Country X.

The routing engine must treat this matrix as a living system: carrier health scores are updated in real-time from observed delivery and error rates (EWMA with a 1-hour half-life); cost data is refreshed from carrier billing APIs; regulatory compliance flags are maintained by the compliance team and exposed as routing constraints. A carrier that had 98% delivery to Brazil last month but dropped to 70% this week due to a network change must be automatically deprioritized — before the next 100,000 messages to Brazil are routed through it. This is why SMS routing is more analogous to adaptive network routing (BGP path selection) than to static load balancing.

---

*Previous: [Interview Guide](./08-interview-guide.md)*
