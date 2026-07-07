# 14.14 AI-Native Regulatory & Compliance Assistant for MSMEs — Interview Guide

## 45-Minute Interview Pacing

| Phase | Time | Focus | What to Evaluate |
|---|---|---|---|
| **Phase 1: Problem Exploration** | 0-8 min | Understand the compliance domain; identify key challenges for MSMEs | Can the candidate identify the core tension: regulatory complexity vs. MSME resource constraints? Do they ask about multi-jurisdiction, deadline computation, and notification reliability? |
| **Phase 2: High-Level Design** | 8-20 min | Architecture: regulatory ingestion pipeline, obligation mapping, notification system, document vault | Does the design separate the regulatory knowledge graph from per-business obligation computation? Is the notification system designed for reliability, not just speed? |
| **Phase 3: Deep Dive** | 20-35 min | Choose one: regulatory text parsing, deadline computation engine, or notification reliability | Can the candidate reason about NLP for legal text, temporal computation with exceptions, or guaranteed delivery with multi-channel fallback? |
| **Phase 4: Scalability & Trade-offs** | 35-42 min | Scaling to millions of businesses; handling regulatory change cascades; cost optimization | Does the candidate identify archetype-based caching for obligation mapping? Can they reason about notification thundering herd? |
| **Phase 5: Wrap-up** | 42-45 min | Extensions, blind spots, what they'd do differently | Self-awareness about design trade-offs; ability to identify gaps |

---

## Opening Problem Statement

> "Design an AI-powered regulatory compliance assistant for small and medium businesses in India. The system should automatically determine which regulations apply to a business, track deadlines, send reminders, and help prepare for audits. A typical MSME might have 50-200 compliance obligations per year across tax, labor, environmental, and licensing regulations."

### Clarifying Questions the Candidate Should Ask

| Question | Why It Matters | Good vs. Weak Answer |
|---|---|---|
| "How many jurisdictions does a business typically operate in?" | Multi-jurisdiction is the core complexity driver | **Good:** "Because each state has different labor laws and professional tax, a 3-state business has 3× the compliance surface" / **Weak:** "I'll assume single jurisdiction for simplicity" |
| "What's the penalty structure for missed compliance?" | Drives notification reliability requirements | **Good:** "This determines our notification SLO—if penalties are ₹50/day, we need near-zero missed reminders" / **Weak:** Doesn't ask about consequences |
| "How do regulations change over time?" | Regulatory change tracking is a core feature | **Good:** "We need a pipeline that detects amendments and updates the obligation map automatically" / **Weak:** "We'll have an admin manually update regulations" |
| "Do businesses have dedicated compliance staff?" | MSMEs typically don't—drives UX decisions | **Good:** "If the owner is the compliance manager, we need proactive push notifications, not a dashboard they need to check" / **Weak:** Assumes a compliance department exists |
| "What document types need to be managed?" | Drives document vault design | **Good:** "PDFs, scanned receipts, digital acknowledgments—we need OCR and auto-classification" / **Weak:** "We'll have a file upload feature" |
| "Are there dependencies between obligations?" | Drives deadline computation complexity | **Good:** "Annual returns depend on monthly returns being complete—we need dependency tracking" / **Weak:** Treats deadlines as independent calendar entries |
| "How often do deadlines get extended?" | Drives extension propagation design | **Good:** "Extensions can be announced last-minute—we need fast detection and correction" / **Weak:** Doesn't consider runtime deadline changes |

---

## Phase 2: High-Level Design Evaluation

### Expected Architecture Components

| Component | Must Have | Nice to Have | Red Flag If Missing |
|---|---|---|---|
| **Regulatory Knowledge Graph** | Graph or hierarchical store for regulations, sections, obligations | Versioned graph with temporal queries; point-in-time queries | Storing regulations as flat rules or config files |
| **Obligation Mapping Engine** | Maps business parameters to applicable obligations | Archetype-based caching, event-driven recomputation, threshold monitoring | Manual obligation assignment or static checklist |
| **Deadline Computation Engine** | Computes deadlines from rules + business parameters | Holiday adjustment, government extensions, dependency chains, preparation windows | Fixed calendar dates without parameterization |
| **Notification Service** | Multi-channel reminders with staged delivery | Guaranteed delivery protocol, fallback channels, escalation, reconciliation | Single-channel or best-effort delivery |
| **Document Vault** | Secure storage with classification | Content-addressed storage, tamper evidence, dual-hash, full-text search | Generic file storage without compliance-specific features |
| **Regulatory Ingestion Pipeline** | Ingest from government sources, extract obligations | NLP for obligation extraction, impact analysis, confidence-based routing | Manual regulatory updates only |
| **Reconciliation Engine** | Absence detection for notifications | Independent reconciliation with auto-remediation | No mechanism to detect that a notification was never generated |

### Design Trade-offs to Discuss

| Trade-off | Option A | Option B | Best Answer |
|---|---|---|---|
| **Knowledge representation** | Rule engine (IF-THEN rules per regulation) | Knowledge graph (semantic relationships between regulations) | Graph for complex relationships; acknowledge rule engine is simpler for straightforward obligations; discuss hybrid approach |
| **Obligation computation** | Batch nightly for all businesses | Event-driven on parameter/regulation change | Event-driven with nightly batch as safety net; discuss eventual consistency trade-off |
| **Notification reliability** | Fire-and-forget with retry | Guaranteed delivery with multi-channel fallback and reconciliation | Guaranteed delivery with clear reasoning: penalty cost ($) >> infrastructure cost for guaranteed delivery |
| **Document integrity** | Path-based storage with access logging | Content-addressed storage with cryptographic hashing | Content-addressed with dual-hash for long-term integrity; explain why compliance documents need tamper evidence |
| **Scalability model** | Per-business graph traversal | Archetype-based caching | Archetype caching with discussion of invalidation thundering herd on popular archetypes |

---

## Phase 3: Deep Dive Options

### Option A: Regulatory Text Parsing (NLP Focus)

**Prompt:** "Let's dive into how the system ingests a new government notification and extracts actionable obligations."

**Strong Signals:**
- Identifies the challenge of legal language ambiguity (nested conditionals, cross-references to other sections, exceptions within exceptions)
- Proposes multi-stage pipeline: parse → classify → extract entities → resolve references → validate → create obligations
- Discusses confidence scoring and human-in-the-loop for low-confidence extractions
- Handles multi-language regulatory sources (state governments publish in regional languages)
- Mentions the challenge of scanned PDFs requiring OCR with legal font recognition
- Discusses the deadline extension fast path as a special case of regulatory ingestion
- Addresses the graph consistency problem: what if extraction is wrong and obligations are already propagated?

**Weak Signals:**
- "Just use an LLM to read the PDF and extract the obligations" (ignores structured extraction needs, confidence scoring, hallucination risk)
- No mention of reference resolution (regulations constantly reference other regulations)
- No confidence thresholds or human review mechanism
- No rollback plan if extraction is incorrect

### Option B: Deadline Computation Engine (Temporal Reasoning Focus)

**Prompt:** "Walk me through how the system computes the exact due date for a GST filing for a specific business."

**Strong Signals:**
- Identifies that deadlines depend on multiple parameters (turnover bracket, filing frequency, jurisdiction)
- Handles conditional deadlines (monthly vs. quarterly filer based on turnover threshold)
- Discusses holiday calendar management with jurisdiction-specific holidays and administering authority
- Addresses government deadline extensions as a runtime override with propagation
- Identifies dependency chains (annual return depends on monthly returns)
- Mentions the recomputation trigger when a business crosses a threshold mid-year
- Discusses preparation windows ("this obligation needs 3 weeks of prep, so start by date X")

**Weak Signals:**
- Hardcoded dates without parameterization
- No awareness of holiday adjustments or jurisdiction-specific calendars
- No concept of deadline dependencies
- No handling of government extensions

### Option C: Notification Reliability (Distributed Systems Focus)

**Prompt:** "How do you ensure that a business never misses a critical deadline reminder? The penalty is ₹50/day."

**Strong Signals:**
- Quantifies the reliability requirement (99.99% delivery = ≤ 1 missed per 10,000)
- Designs multi-channel delivery with fallback (WhatsApp → SMS → email → escalation)
- Implements reconciliation to detect missing notifications (absence monitoring)
- Addresses the thundering herd problem when millions of reminders are due on the same day
- Discusses the trade-off between notification fatigue (too many reminders) and coverage (zero missed deadlines)
- Considers idempotency for retry scenarios (duplicate notification is better than zero)
- Mentions the extension correction problem: how to correct already-sent notifications when deadlines change
- Discusses the dispatch gate mechanism for holding notifications during extension propagation

**Weak Signals:**
- "We'll just retry if it fails" (doesn't address the case where the notification was never generated)
- Single channel without fallback
- No reconciliation or absence detection
- No consideration of deadline extensions affecting already-queued notifications

---

## Trap Questions

### Trap 1: "Can we just use a cron job to check all deadlines daily?"

**What it tests:** Understanding of event-driven vs. batch processing trade-offs.

**Trap:** The candidate says "yes, daily batch is fine" without considering that (a) a deadline extension published at 3 PM must be reflected before the 5 PM reminder, and (b) a business crossing a threshold at 2 PM creates a new obligation that the daily batch won't catch until tomorrow.

**Good answer:** "A daily batch is a good baseline for forward-looking calendar computation, but we also need event-driven recomputation for three scenarios: regulatory changes (deadline extensions), business parameter changes (threshold crossings), and government portal status changes. The batch handles 95% of cases; the event-driven path handles the time-sensitive 5%. I'd also add a reconciliation engine as a safety net that catches anything both paths missed."

### Trap 2: "Why not store all regulations in a relational database with a `regulations` table?"

**What it tests:** Understanding of when graph databases provide genuine advantages over relational.

**Trap:** The candidate either (a) agrees without thinking about the graph nature of regulations, or (b) insists on a graph database without acknowledging that many queries are perfectly served by relational.

**Good answer:** "A relational table works for simple lookups ('show me all GST regulations'), but the core query pattern is multi-hop traversal: 'find all obligations applicable to this business' requires traversing act → sections → amendments → obligations while filtering by jurisdiction and applicability criteria. This is a natural graph query. However, transactional data (business profiles, notification records, filing history) is better served by relational databases. I'd use both: graph for the regulatory knowledge model, relational for everything else."

### Trap 3: "The system has 3 million businesses. How do you compute obligations for each one without spending 30 minutes on graph traversal?"

**What it tests:** Scalability thinking—can the candidate avoid the O(B × V) trap?

**Trap:** The candidate proposes traversing the entire graph for each business independently.

**Good answer:** "Most businesses share the same obligation set—a textile manufacturer with 20 employees in Maharashtra has the same obligations as every other textile manufacturer with 20 employees in Maharashtra. I'd create 'compliance archetypes' and cache the obligation set per archetype. With ~200 archetypes covering 80% of businesses, we reduce 3M graph traversals to 200. But I'd also address the invalidation thundering herd: when GST changes affect all archetypes, we need rate-limited propagation prioritized by deadline proximity."

### Trap 4: "What happens when the government extends a filing deadline at 6 PM the day before it's due?"

**What it tests:** Handling of external cache invalidation and correction notification cascades.

**Good answer:** "This is one of the hardest problems in the system. We've already pre-computed and queued millions of notifications based on the original deadline. We need: (1) a high-frequency fast path that checks extension-heavy sources every 15 minutes, (2) when detected, pull all queued notifications referencing the affected deadline, (3) recompute deadlines and regenerate notifications, (4) for businesses that already received the old notification, send a correction. I'd add a dispatch gate that holds notifications when an extension is being processed, and automatically dispatches the corrected version."

### Trap 5: "How do you handle a regulation that applies to businesses 'with turnover exceeding ₹5 crore in the preceding financial year' when the current FY hasn't ended yet?"

**What it tests:** Temporal reasoning about when obligations become applicable.

**Good answer:** "This is a forward-looking applicability problem. The system should: (1) monitor running turnover during the current FY, (2) when turnover crosses ₹5 crore mid-year, flag as a 'projected threshold crossing' with confidence level, (3) send a proactive warning, (4) when the FY ends and turnover is confirmed, convert projection to actual obligation, (5) handle the Edge Case (Unusual or extreme situation) where turnover crosses temporarily but falls back below by year-end. The key insight is that the 'preceding financial year' reference creates a lag—the obligation in FY 2026-27 is determined by FY 2025-26 turnover. I'd also model hysteresis: some thresholds like PF are permanent once crossed, while others like GST allow de-registration."

### Trap 6: "A CA manages 25 businesses on the platform. How do you prevent them from seeing aggregate data across their clients?"

**What it tests:** Multi-tenancy and privacy thinking for the accountant persona.

**Good answer:** "The CA sees each business independently—they must explicitly select which business to work with, and the session context is scoped to that business. The system must prevent: (1) cross-business search results (CA searching for a document should only return results from the currently selected business), (2) aggregate analytics (no 'average compliance score across my clients'), (3) cross-business data inference (noticing that two clients file the same amount). Per-business session tokens, action logging per business, and anomaly detection on cross-business access patterns provide defense-in-depth."

---

## Scoring Rubric

### Junior Engineer (L3-L4): Expectations

| Area | Minimum | Good | Exceptional |
|---|---|---|---|
| **Problem Understanding** | Identifies deadline tracking as the core problem | Recognizes multi-jurisdiction complexity | Articulates the difference between reactive compliance and proactive obligation inference |
| **Architecture** | Monolith or basic microservices with a database | Separates regulatory content from business obligations | Knowledge graph + obligation mapping + notification as distinct services with clear data flows |
| **Deep Dive** | Basic deadline computation with fixed rules | Parameterized deadlines with holiday awareness | Full temporal reasoning with dependencies, extensions, and preparation windows |

### Senior Engineer (L5-L6): Expectations

| Area | Minimum | Good | Exceptional |
|---|---|---|---|
| **System Design** | Clean service separation with clear data flows | Event-driven obligation recomputation; archetype-based scaling | Versioned knowledge graph; absence detection for notifications; dependency DAG for deadlines; dispatch gate for extensions |
| **Scalability** | Database partitioning; message queue for notifications | Archetype caching; tiered document storage | Three-phase archetype propagation; pre-computed notification with correction; predictive scaling for month-end |
| **Trade-offs** | Identifies 2-3 trade-offs | Discusses graph vs. relational, batch vs. event-driven, delivery guarantee levels | Quantifies trade-offs (cost of missed notification = ₹50/day × N businesses vs. multi-channel infrastructure cost) |
| **Reliability** | Basic retry mechanism | Multi-channel fallback | Reconciliation engine for absence detection; dispatch gate for extension handling; chaos engineering experiments |

### Staff Engineer (L7+): Expectations

| Area | Minimum | Good | Exceptional |
|---|---|---|---|
| **System Thinking** | End-to-end design covering all major components | Identifies the meta-compliance problem (the compliance tool must be compliant); DPDP implications | Reasons about the regulatory knowledge graph as a living ontology; designs forward-looking obligation projection; models threshold hysteresis |
| **Operational Maturity** | Monitoring and alerting | Absence detection; SLO-based error budgets; incident playbooks | Regulatory ingestion completeness monitoring via cross-reference; chaos engineering for reconciler validation; canary rollout for graph changes |
| **Domain Depth** | Understands basic GST/PF compliance flow | Handles jurisdiction conflict resolution (override/additive/concurrent); threshold-triggered obligation activation | Reasons about temporal ambiguity in legal text; designs DPDP consent cascade; models the interaction between statutory retention and data deletion rights |
| **Cost Reasoning** | Mentions cost as a concern | Identifies notification channel costs as dominant | Models per-business economics ($0.26/month); identifies archetype caching as the key cost lever; proposes smart notification routing to minimize SMS costs |

---

## Common Candidate Mistakes

| Mistake | Why It's Wrong | Better Approach |
|---|---|---|
| Treating obligations as static calendar entries | Obligations are dynamic: they change with business parameters, regulatory amendments, government extensions, and dependency completions | Model obligations as computed properties of the knowledge graph + business profile intersection |
| Designing notifications as fire-and-forget | The cost of a missed notification (₹50/day penalty) far exceeds the infrastructure cost of guaranteed delivery | Multi-channel with reconciliation; the reconciler is harder to build than the notification system |
| Using a single database for everything | The regulatory knowledge graph has different query patterns (multi-hop traversal) than transactional data (point lookups) | Graph database for regulations, relational for business/transactional data, object store for documents |
| Ignoring the extension propagation problem | Deadline extensions are frequent and announced last-minute; pre-computed notifications become incorrect | Fast-path extension detection + dispatch gate + correction notifications |
| Treating all deadlines equally | ₹50/day GST penalty ≠ potential imprisonment for expired license ≠ ₹100 informational filing fee | Severity-tiered notification strategy with different channel and frequency per tier |
| Assuming businesses are homogeneous | A micro enterprise with 5 employees has 30 obligations; a medium enterprise in 5 states has 200+ | Archetype-based scaling; the system must handle 10× variation in obligation count per business |
