# Interview Guide — AI-Native WhatsApp+PIX Commerce Assistant

## Interview Pacing (45-Minute Format)

| Time | Phase | Focus | What to Cover |
|---|---|---|---|
| 0-5 min | **Clarify** | Scope the problem | Confirm: is this a conversational payment assistant (not a payment processor)? Which modalities (text, voice, image)? What payment system (PIX)? Scale expectations? |
| 5-15 min | **High-Level** | Core architecture | Webhook ingestion, multimodal AI pipeline, conversation state machine, secure payment handoff, receipt delivery. Draw the component diagram. |
| 15-30 min | **Deep Dive** | 1-2 critical components | Pick from: (1) exactly-once payment semantics with at-least-once webhooks, (2) multimodal intent extraction pipeline, (3) secure auth handoff. Go deep. |
| 30-40 min | **Scale & Trade-offs** | Bottlenecks, failures, trade-offs | WhatsApp rate limits, LLM latency at scale, salary-day spikes, fraud detection vs. UX friction, voice accuracy vs. confirmation overhead |
| 40-45 min | **Wrap Up** | Summary + follow-ups | Highlight 2-3 key decisions, acknowledge trade-offs, answer interviewer questions |

---

## Meta-Commentary

### How to Approach This Problem

**Start with the unique constraint, not the generic pattern.** This system's defining characteristic is that it bridges two fundamentally different reliability models: casual messaging (at-least-once, best-effort, unordered) and financial transactions (exactly-once, irrevocable, strongly consistent). Lead with this tension—it shows you understand what makes this system interesting.

**Don't treat it as "chatbot + payment API."** The naive framing is "build a chatbot that calls a payment API when the user says 'pay'." The sophisticated framing is: "build a multimodal AI system that achieves financial-grade reliability while operating within the constraints of a third-party messaging platform." The former gives you a P3 answer; the latter gives you an L6+ answer.

**The AI is a means, not the end.** Interviewers for this system care about how AI affects system design (latency, reliability, cost, failure modes), not about the AI models themselves. Don't spend 10 minutes explaining transformer architectures. Spend 2 minutes on "the LLM extracts intent from text with 95% accuracy in 500ms-1.5s, and here's how that latency constraint shapes the rest of the architecture."

### What Makes This System Unique/Challenging

1. **The modality gap**: The system must extract structured financial data from unstructured inputs (text, voice, photos) with zero tolerance for amount/recipient errors because PIX is irrevocable
2. **Platform dependency**: WhatsApp's constraints (24-hour windows, webhook-only delivery, template approval, rate limits) are hard architectural boundaries, not soft suggestions
3. **Casual UX, financial reliability**: Users interact casually but expect bank-grade correctness—a mismatch that drives most of the interesting design decisions
4. **Regulatory complexity**: Four overlapping regulatory frameworks (BCB, CADE, LGPD, PCI DSS) with sometimes conflicting requirements

### Where to Spend Most Time

**If you have 15 minutes for deep dive**: Spend 10 minutes on the webhook-to-payment pipeline (deduplication, exactly-once semantics, the race condition between at-least-once delivery and irrevocable settlement) and 5 minutes on the multimodal AI pipeline (how different modalities have different failure modes and latency profiles).

**The interviewer will be most impressed by**: Your understanding of how at-least-once webhook delivery interacts with exactly-once payment execution—this is the system's central consistency challenge and is often overlooked by candidates who focus on the AI aspects.

---

## Trade-offs Discussion

### Trade-off 1: LLM Extraction vs. Rule-Based Extraction

| Aspect | LLM Extraction | Rule-Based (Regex) |
|---|---|---|
| **Pros** | Handles free-form text, slang, context; >95% accuracy on varied inputs; adapts to new patterns | Predictable latency (10ms vs. 500ms+); no GPU cost; no model versioning complexity; deterministic |
| **Cons** | 500ms-1.5s latency; GPU cost (~R$400K/month at scale); hallucination risk; model drift | Brittle with varied inputs; requires manual pattern updates; <60% accuracy on natural conversation |
| **Recommendation** | **Tiered approach**: Rule-based for simple patterns ("R$50 para [name]") as fast path; LLM for complex/ambiguous inputs. This captures 40% of messages in 10ms and reserves GPU capacity for the remaining 60%. |

### Trade-off 2: Confirmation Granularity (Always Confirm vs. Smart Skip)

| Aspect | Always Confirm | Smart Skip (High-Confidence) |
|---|---|---|
| **Pros** | Zero risk of incorrect payment from AI error; user always in control; simplifies fraud liability | Faster UX for repeat transactions; fewer messages; closer to "invisible banking" vision |
| **Cons** | Extra round-trip per transaction; 5-10 seconds added per payment; "Are you sure?" fatigue reduces conversion | Risk of incorrect payment if AI is wrong; liability if user didn't explicitly confirm; regulatory scrutiny |
| **Recommendation** | **Always confirm** for v1. The irrevocable nature of PIX means the downside of a wrong payment (permanent financial loss) far outweighs the upside of saving one message round-trip. Consider smart-skip only for repeat transactions to the same recipient with the same amount, after extensive A/B testing. |

### Trade-off 3: Deep Link Handoff vs. In-Chat Authentication

| Aspect | Deep Link to Banking App | In-Chat PIN/Password |
|---|---|---|
| **Pros** | PCI DSS compliant; biometric auth; banking app's security context; no credentials in message channel | Seamless UX; no app switching; entire flow in WhatsApp |
| **Cons** | App switch friction; 10-20% drop-off at handoff; requires banking app installed | PCI DSS violation; password in message history; no biometric; security nightmare |
| **Recommendation** | **Deep link handoff** is non-negotiable. PCI DSS 4.0 explicitly prohibits payment credentials in messaging channels. The drop-off is real but the alternative is a compliance violation. Mitigate drop-off with pre-filled deep links, fast biometric, and immediate receipt upon return. |

### Trade-off 4: Synchronous vs. Asynchronous AI Processing

| Aspect | Synchronous (wait for AI) | Asynchronous (queue and respond later) |
|---|---|---|
| **Pros** | Simpler architecture; response correlates directly to user's message; easier to debug | AI processing doesn't block webhook response; better throughput; handles load spikes gracefully |
| **Cons** | Webhook must respond within 20s (WhatsApp timeout); AI failure blocks the webhook; tight coupling | User sees delay between sending message and receiving response; more complex state management; message ordering challenges |
| **Recommendation** | **Asynchronous is mandatory**. The 20-second webhook timeout combined with 1-4 second AI processing (which can spike to 10+ seconds under load) means synchronous processing will hit the timeout. Acknowledge webhook immediately (200 OK in <2s), process asynchronously, send response as a new outbound message. |

### Trade-off 5: Single LLM Provider vs. Multi-LLM Abstraction

| Aspect | Single Provider | Multi-LLM Abstraction |
|---|---|---|
| **Pros** | Simpler integration; consistent behavior; lower development cost; faster iteration | CADE compliance (third-party AI mandate); vendor resilience; cost optimization (route to cheapest capable model); avoid lock-in |
| **Cons** | CADE non-compliant (since January 2026); single point of failure; vendor lock-in; no cost optimization | Abstraction complexity; different models have different capabilities/quirks; prompt compatibility across providers |
| **Recommendation** | **Multi-LLM abstraction** is required by CADE's January 2026 ruling. Design a provider abstraction layer with standardized input/output schemas. Use a primary model for most traffic and a secondary for failover. The abstraction cost is modest compared to the regulatory and resilience benefits. |

---

## Trap Questions & How to Handle

| Trap Question | What Interviewer Wants | Best Answer |
|---|---|---|
| "Why not just use WhatsApp Pay (Meta's native payment) instead of building this?" | Understand the value proposition beyond what Meta provides | WhatsApp Pay is limited to card-based payments with R$1,000/month caps and doesn't support PIX. This system handles PIX (40% of Brazil e-commerce, zero fees for P2P), supports multimodal input (voice, QR photo), and enables richer conversational flows. They're complementary, not competing. |
| "Can't you just regex the payment info from text messages?" | Test whether you understand the AI complexity vs. simplicity trade-off | For "R$50 para Maria"—yes, regex works perfectly. For "manda cinquenta conto pro João do trabalho pela pizza de ontem"—no. Brazilian Portuguese has colloquialisms, abbreviations, and context that regex can't handle. The tiered approach (regex fast path + LLM for complex cases) gives you the best of both worlds. |
| "What happens if the user sends 'pay R$50 to Maria' and you execute it, but they meant a different Maria?" | Test failure thinking and irrevocability awareness | This is why confirmation is mandatory, not optional. The system presents the resolved recipient (Maria Silva, maria@email.com) and requires explicit user confirmation before proceeding. If multiple Marias exist, disambiguation is triggered. The user must affirmatively confirm the exact recipient before the irrevocable PIX settlement executes. |
| "How would you handle 100x scale?" | Forward-thinking architecture evolution | At 100x (350M messages/day, 30M payments/day), the bottlenecks shift: (1) LLM inference requires a 100x larger GPU fleet or a massive model distillation effort, (2) WhatsApp's API rate limits become critical (need direct partnership with Meta for dedicated capacity), (3) DICT cache must hold the full directory (~800M keys, 50GB+), (4) transaction DB needs horizontal sharding. The architecture's event-driven, stateless core scales well; the binding constraints are GPU cost and external API limits. |
| "Why not process the payment entirely within WhatsApp without the banking app handoff?" | Test security knowledge | PCI DSS 4.0 explicitly prohibits transmitting payment credentials through end-user messaging technologies. Even if PCI didn't apply, processing payments entirely in WhatsApp means: (1) no biometric authentication, (2) payment credentials visible in chat history, (3) anyone with physical access to the phone can execute payments. The banking app handoff is a security requirement, not a UX preference. |
| "What if WhatsApp goes down?" | Test dependency and degradation thinking | WhatsApp is a channel, not the system. If WhatsApp is down: (1) payments in progress that have already reached the auth handoff stage continue normally in the banking app, (2) new payment requests can't be received, (3) we send push notifications to affected users suggesting they use the banking app directly, (4) receipts for in-progress settlements are queued and delivered when WhatsApp recovers. The system degrades gracefully rather than failing completely. |
| "How do you prevent the AI from being manipulated by prompt injection?" | Test AI security awareness | Three layers: (1) Structured output schema constrains what the LLM can output (only valid payment fields), (2) Validation layer checks extracted values against format rules and plausible bounds, (3) User confirmation is the final gate—the user sees exactly what will be executed. Even a successfully injected prompt can only produce payment parameters that the user must explicitly approve. |

---

## Complexity Estimation for Interviewers

### Component Complexity Ratings

Use this table to calibrate which components are realistic to discuss in a 45-minute interview:

| Component | Design Complexity | Implementation Effort | Interview Depth |
|---|---|---|---|
| Webhook gateway + dedup | Medium | Medium | **Deep dive worthy** — the three-layer dedup is the system's core consistency mechanism |
| LLM intent extraction | Low (as a box) | High (in reality) | **Surface level** — treat as a service with latency/accuracy characteristics; don't design the model |
| Conversation state machine | High | High | **Deep dive worthy** — multi-turn flows, interruptions, timeout handling, 24-hour window |
| Secure auth handoff | Medium | Medium | **Worth discussing** — PCI DSS constraint drives the design; token security properties |
| Fraud detection | Medium | High | **Worth discussing** — but focus on social engineering signals, not traditional fraud models |
| Multi-LLM abstraction | Medium | Medium | **Mention** — CADE mandate; describe the abstraction and qualification protocol |
| QR/CV pipeline | Low | Medium | **Mention** — BR Code parsing is interesting; discuss at surface level |
| Template management | Low | Low | **Skip** unless discussing 24-hour window constraints specifically |

---

## Common Mistakes to Avoid

| Mistake | Why It's Wrong | Better Approach |
|---|---|---|
| **Focusing on the AI models** instead of the system design | Interviewers care about how AI affects architecture, not about model architectures | Treat AI as a service with specific latency, accuracy, and cost characteristics. Focus on how these characteristics drive design decisions |
| **Ignoring WhatsApp platform constraints** | The 24-hour window, webhook timeout, template system, and rate limits are hard constraints that shape the entire architecture | Draw the WhatsApp API constraints on the whiteboard early; they define what's possible |
| **Assuming synchronous processing** | The 20-second webhook timeout makes synchronous AI processing risky | Show the async processing pattern: acknowledge immediately, process asynchronously, respond as a new message |
| **Skipping deduplication** | At-least-once webhook delivery + irrevocable payments = duplicate payment risk | This is the system's central consistency challenge; address it explicitly |
| **Putting payment credentials in WhatsApp messages** | PCI DSS violation; security risk | Show the secure handoff pattern: AI extracts intent, deep link to banking app for authentication |
| **Treating all modalities equally** | Text (60%), voice (25%), and image (15%) have different latency profiles, accuracy characteristics, and failure modes | Design the pipeline with modality-specific paths that converge at entity resolution |
| **Over-engineering the fraud model** | PIX fraud is primarily social engineering (70%), not technical fraud | Focus on behavioral indicators (coached interactions, new recipients, unusual amounts) rather than technical fraud patterns |
| **Not discussing regulatory compliance** | BCB, CADE, LGPD, and PCI DSS create real architectural constraints | Mention at least BCB transaction limits and PCI DSS messaging restrictions—they drive key design decisions |
| **Designing the DICT cache like a simple key-value store** | DICT staleness has financial consequences unlike typical caches; a stale entry can route payments to wrong accounts | Design the DICT cache with risk-aware TTLs (15 min) and pre-settlement re-validation for high-value transactions |
| **Ignoring the 24-hour conversation window** | Template messages require pre-approval from Meta; cannot be composed dynamically at runtime | Plan the template library upfront; design recurring payment flows (Pix Automático) around template re-engagement |
| **Assuming a single WhatsApp Business Account** | Rate limits, templates, and phone number verification are per-account; scaling may require multiple accounts | Discuss account federation and routing strategy for scale beyond single-account rate limits |

---

## Questions to Ask Interviewer

| Question | What It Reveals | How It Changes the Design |
|---|---|---|
| "What's the target user base—a fintech startup or an established bank?" | Whether we have an existing user base and banking infrastructure | Startup: build everything from scratch, focus on user acquisition. Bank: integrate with existing systems, focus on migration path |
| "Which modalities are must-have vs. nice-to-have?" | Scope prioritization | If voice is nice-to-have, skip the STT pipeline in v1; dramatically simplifies the architecture |
| "Is this P2P (peer-to-peer) or P2M (peer-to-merchant) focused?" | Transaction patterns and regulatory requirements | P2P: focus on contact resolution, social splitting. P2M: focus on QR codes, merchant onboarding, Nota Fiscal |
| "What's the transaction limit?" | Risk appetite and fraud model complexity | Higher limits = more sophisticated fraud detection needed; lower limits = simpler risk model acceptable |
| "Is the banking app already built, or do we need to build the auth handoff target?" | Integration scope | Existing app: focus on deep link integration. No app: must design secure WebView fallback |
| "Are we a direct SPI participant or going through a sponsor bank?" | SPI integration complexity | Direct: full control but BCB certification required. Indirect: simpler integration but dependency on sponsor bank's SLA |

---

## Evaluation Rubric (Self-Assessment)

| Dimension | Junior (L3-L4) | Mid (L5) | Senior (L6+) |
|---|---|---|---|
| **Problem Scoping** | Treats it as "chatbot + API" | Identifies the messaging + financial reliability tension | Frames the 4-way constraint: casual UX × financial reliability × platform constraints × regulatory compliance |
| **Architecture** | Monolithic webhook handler | Async event-driven pipeline with basic dedup | Tiered AI pipeline, three-layer dedup, conversation state machine, secure handoff, circuit breakers |
| **Consistency** | Doesn't address duplicates | Mentions dedup but misses the settlement race | Shows the three-layer dedup (webhook → conversation → payment) and the settlement-timeout race condition |
| **AI Integration** | "Use GPT to parse the message" | Discusses latency, accuracy, confidence scoring | Tiered extraction (regex fast path + LLM), compound confidence for voice, modality-specific failure modes |
| **Security** | "Encrypt everything" | Mentions PCI DSS, no credentials in messages | Designs the complete auth handoff flow, explains token security properties, addresses prompt injection |
| **Regulatory** | Doesn't mention regulations | Mentions LGPD or BCB | Integrates BCB limits, CADE AI mandate, LGPD data lifecycle, PCI DSS constraints into the design |
| **Scale** | "Add more servers" | Discusses GPU scaling, rate limits | Salary-day surge planning, WhatsApp tier management, model distillation for throughput, DICT cache strategy |

---

## Calibration Questions by Seniority

### Junior Engineer (0–3 years)

| Question | Expected Depth |
|---|---|
| "Walk me through what happens when a user sends 'pay R$50 to Maria' in WhatsApp." | Should describe: webhook received → text parsed → intent extracted → confirmation sent → user confirms → payment executes → receipt delivered. Bonus: mentions deduplication and the need for user confirmation before irrevocable settlement. |
| "Why can't we just ask the user for their PIN directly in the WhatsApp chat?" | Should identify PCI DSS prohibition on payment credentials in messaging channels. Bonus: describes the secure handoff pattern with deep link to banking app for biometric/PIN authentication. |
| "What happens if WhatsApp sends the same webhook twice?" | Should mention deduplication using message ID. Bonus: describes the three-layer approach (Redis → conversation lock → DB unique constraint) and explains why all three layers are needed. |

### Mid-Level Engineer (3–7 years)

| Question | Expected Depth |
|---|---|
| "A user sends a voice message saying 'manda cinquenta conto pro João do trabalho.' Walk me through how the system processes this." | Should describe: audio download → speech-to-text → text parsing → entity extraction (amount: R$50, recipient: João). Bonus: explains compound confidence (STT × LLM), the "conto" ambiguity (R$1 vs R$1,000 depending on region), and why voice requires more aggressive confirmation UX than text. |
| "Design the exactly-once payment guarantee given WhatsApp's at-least-once delivery." | Should describe at least two layers of deduplication. Bonus: explains the stale-state recovery problem (service crash leaves message in "processing" state) and the three-layer approach with timestamp-based stale detection. |
| "How do you handle a salary-day spike where payment volume triples?" | Should describe auto-scaling GPU and conversation instances. Bonus: discusses pre-scaling based on calendar prediction, priority queue for payment messages over marketing, and WhatsApp API tier management. |

### Senior Engineer / Architect (7+ years)

| Question | Expected Depth |
|---|---|
| "CADE mandates that you support third-party AI providers. How does this affect your architecture?" | Should describe an abstraction layer over the LLM. Bonus: explains that behavioral consistency across providers is the real challenge (different LLMs extract differently), proposes a behavioral test suite (golden dataset) for provider qualification, and discusses the prompt compatibility problem. |
| "Design the fraud detection system for conversational PIX payments, where 70% of fraud is social engineering." | Should describe behavioral signals beyond traditional fraud indicators. Bonus: discusses coached interaction detection (typing cadence, copy-paste patterns, unusually fast responses to complex prompts), progressive friction (extra confirmation for high-risk patterns), and the DICT metadata integration (recently created keys, high inbound mule indicators). |
| "How would you extend this system to support Pix Automático (recurring payments) and Pix Garantido (installment payments)?" | Should describe adding new payment types to the intent extraction model and new state machine paths. Bonus: recognizes that recurring payments require state beyond the 24-hour window (need template messages for scheduling confirmation), installments require credit risk assessment integration, and both require new conversation flows that are fundamentally different from one-time payments. |

---

## System Design Whiteboard Expectations

### What to Draw (12-Minute Architecture Phase)

```
Essential components (must-have):
  □ WhatsApp Cloud API with webhook ingestion
  □ Deduplication service (Redis + conversation lock)
  □ Multimodal AI pipeline (text/voice/image paths)
  □ Conversation state machine
  □ Secure authentication handoff (deep link to banking app)
  □ PIX SPI settlement gateway
  □ Receipt generator + WhatsApp template sender
  □ Event bus / message queue for async processing

Differentiating components (above-bar):
  □ Tiered extraction (regex fast path + LLM complex path)
  □ Three-layer dedup with stale-state recovery
  □ Conversational fraud scoring with social engineering detection
  □ CADE-compliant multi-LLM abstraction layer
  □ Priority queue for outbound message rate management
  □ Compound confidence scoring for voice pipeline

Data flows to articulate:
  □ Text: Webhook → Dedup → LLM → Entity Resolve → Confirm → Auth → SPI → Receipt
  □ Voice: Webhook → Audio Fetch → STT → LLM → Confirm (with echo-back) → Auth → SPI
  □ QR Photo: Webhook → Image Fetch → CV Detect → BR Code Parse → Confirm → Auth → SPI
  □ Dedup: Three layers preventing duplicate settlements from webhook retries
```

---

## Distinguishing Exceptional Candidates

1. **Delivery guarantee awareness:** Immediately identifies the at-least-once ↔ exactly-once tension as the system's central challenge. Designs the dedup system before discussing the AI pipeline, because dedup failures are catastrophic while AI failures are recoverable via user confirmation.

2. **Platform-constraint architecture:** Treats WhatsApp's constraints (24-hour window, 20s webhook timeout, template system, rate limits) as first-class architectural inputs, not afterthoughts. Mentions at least two constraints and explains how they shape design decisions.

3. **Multimodal pipeline sophistication:** Doesn't treat all input modalities equally. Explains that voice has lower compound accuracy (STT × LLM ≈ 87%) than text (~95%) and designs different confirmation UX per modality. Understands that voice generates 2.5x more multi-turn conversations due to clarification loops.

4. **Regulatory integration:** Incorporates at least BCB (transaction limits, MED), PCI DSS (no credentials in messages), and CADE (multi-LLM mandate) into the design rather than mentioning them as an afterthought. The best candidates explain how these regulations create architectural constraints.

5. **Irrevocability thinking:** Every design decision reflects awareness that PIX settlements cannot be reversed. This manifests in: mandatory user confirmation, conservative fraud thresholds, careful timeout handling (UNCERTAIN state, not FAILED), and the three-layer dedup approach.

---

## Case Study Walk-Through: PicPay Architecture Decisions

Use this section during senior-level interviews to discuss real-world architectural decisions:

### Scenario: PicPay's Tiered Extraction Migration

**Setup:** PicPay launched with full LLM extraction for every message. At 5M DAU, GPU costs reached R$600K/month. The team proposed migrating to tiered extraction (regex fast path + LLM for complex).

**Discussion Questions:**

| Question | What to Evaluate |
|---|---|
| "How would you identify which messages can be handled by regex?" | Candidate should describe pattern analysis: structured formats ("R$X para Y"), known templates, repeat transactions. Should mention false-negative risk: regex misses valid patterns → user frustration |
| "What's the rollout strategy?" | Shadow mode first: run both regex and LLM, compare results. Canary: route 5% through regex-only, monitor accuracy. Gradual expansion based on accuracy parity within 2% of LLM |
| "How do you handle the Edge Case (Unusual or extreme situation) where regex extracts confidently but incorrectly?" | Key insight: regex has high confidence but can be wrong silently (e.g., "R$50 para Maria" where "Maria" is the store name, not a person). The confirmation step catches this, but regex errors produce a different UX problem than LLM errors: the user sees a confident-looking but wrong confirmation |
| "At 40% regex coverage, what's the GPU cost savings?" | Direct 40% reduction in LLM calls, but actual savings are higher because regex handles the simplest (and most frequent) patterns, allowing the LLM fleet to batch more complex messages efficiently. Real-world savings: 50-55% GPU cost reduction |

### Anti-Pattern Gallery

| Anti-Pattern | Why Teams Choose It | Why It Fails |
|---|---|---|
| **"Smart skip" for repeat transactions** | Removes friction for users who pay the same person the same amount regularly | PIX is irrevocable. At 3M daily payments and even 0.1% error rate, that's 3,000 uncorrectable payments per day. The R$5 saved in UX friction per user does not justify the R$150+ average irrevocable loss per error |
| **Synchronous webhook processing** | Simpler architecture; response correlates to user's message; easier debugging | WhatsApp's 20-second timeout + LLM inference spikes = webhook timeouts → retries → duplicate processing → potential duplicate payments. The "simpler" architecture creates a worse failure mode |
| **Single-layer deduplication** | "Redis SET NX is enough; it handles 99.9% of duplicates" | The 0.1% includes the stale-state recovery problem (crash during processing). At 35M messages/day, 0.1% = 35,000 messages with potential dedup failures. For payment messages (40% conversion), that's ~14,000 potential duplicate payment events per day |
| **Storing PIX keys in conversation logs** | "We need the full conversation for debugging and compliance" | LGPD data minimization violation. PIX keys are PII; storing them in conversation logs means every conversation log access requires PII access authorization. Mask in logs; store unmasked only in the encrypted payment intent record |
| **Homogeneous confidence thresholds** | "Use 0.85 confidence threshold for all modalities" | Voice (compound STT × LLM ≈ 0.87 max) would block 30-40% of all voice payments. Text (0.95 typical) would over-accept marginal extractions. Per-modality thresholds are essential |
| **Global LLM prompt for all intents** | "One prompt handles payment, balance, history, and subscription setup" | Prompt bloat increases tokens (cost), reduces accuracy for each intent type, and makes A/B testing impossible. Separate intent-specific prompts allow independent optimization |

---

## Follow-Up Questions for Strong Candidates

| Question | What It Tests |
|---|---|
| "How would you add Pix Automático (recurring payments) to the WhatsApp assistant?" | Understanding that recurring payments transcend the 24-hour window; need template messages for monthly notifications; subscription state management beyond conversation scope |
| "A user reports being scammed after completing a PIX payment via the assistant. Walk me through the MED claim process." | Knowledge of post-settlement lifecycle; MED 2.0 multi-hop tracing; integration of conversational evidence with formal claim process |
| "BCB's Open Finance lets you access balances from multiple banks. How does this change the privacy model?" | Per-institution encryption; consent-scoped data access; selective data redaction without modifying immutable conversation logs |
| "How would you implement A/B testing for a new LLM model that handles payment intent extraction?" | Shadow mode evaluation; golden dataset comparison; gradual rollout with accuracy monitoring; rollback criteria for production deployment |
| "During Black Friday, payment volume spikes 5-8x and the QR code recognition queue backs up. How do you handle this?" | Priority-based resource allocation; GPU pool dedicated to payment-critical vs. informational modalities; graceful degradation for QR (manual entry fallback) while maintaining text payment flow |

---

## Time Management Tips for Candidates

### Pacing Mistakes and Corrections

| Mistake | Impact | Correction |
|---|---|---|
| **Spending 10+ minutes on AI model architecture** | Leaves no time for the payment consistency challenge, which is what differentiates this system | Cap AI discussion at 3 minutes: state modalities, latency/accuracy numbers, tiered extraction. Move to system design. |
| **Drawing a generic microservices diagram** | Misses WhatsApp-specific constraints that make this system interesting | Start with WhatsApp's constraints (24h window, 20s timeout, templates) and draw architecture around them |
| **Ignoring the deduplication problem** | This is the system's central challenge — at-least-once → exactly-once with irrevocable settlement | Proactively raise it when discussing webhook ingestion. Show the three-layer approach. |
| **Treating all modalities equally in design** | Text (95% accuracy, 500ms), voice (87%, 4s), and QR (92%, 3s) have fundamentally different system requirements | Sketch the modality-specific pipelines converging at entity resolution; mention compound confidence for voice |
| **Forgetting to discuss regulatory compliance** | BCB, CADE, LGPD, and PCI DSS create real architectural constraints, not just checkbox items | Weave regulations into design decisions: PCI DSS drives auth handoff, CADE drives multi-LLM, BCB drives limits and MED |

### The "Signal" Moments

The highest-signal moments in a WhatsApp+PIX interview — points where candidate quality diverges most:

1. **When discussing webhook processing**: Does the candidate immediately think about what happens if the same webhook arrives twice? Junior candidates describe the happy path. Senior candidates lead with the failure mode.

2. **When discussing the confirmation step**: Does the candidate see it as "UX friction to minimize" or as "the architectural firewall between AI uncertainty and financial certainty"? The latter framing shows deep understanding.

3. **When discussing voice messages**: Does the candidate compute the compound confidence (STT × LLM ≈ 87%) and explain why voice needs a different confirmation UX? This shows they understand serial pipeline reliability.

4. **When discussing scale**: Does the candidate identify that GPU cost (R$400K+/month), not infrastructure cost, is the dominant scaling concern? Model distillation and tiered extraction are the real scaling strategies, not "add more servers."

5. **When wrapping up**: Does the candidate identify the fundamental tension — casual messaging UX atop financial-grade reliability — as the system's defining characteristic? This framing separates architects from implementers.
