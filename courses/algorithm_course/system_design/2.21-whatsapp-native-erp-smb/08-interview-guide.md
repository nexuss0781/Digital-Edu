# Interview Guide

[Back to Index](./00-index.md)

---

## Interview Pacing (45-Minute Format)

| Time | Phase | Focus | Tips |
|------|-------|-------|------|
| **0-5 min** | Clarify | Scope, constraints, scale | Ask about SMB focus, India market |
| **5-15 min** | High-Level | WhatsApp integration, AI layers | Draw architecture, explain data flow |
| **15-30 min** | Deep Dive | 1-2 critical components | Rate limiting OR offline sync OR privacy AI |
| **30-40 min** | Scale & Trade-offs | Festival spikes, failures | Discuss degradation modes |
| **40-45 min** | Wrap Up | Summary, questions | Highlight unique aspects |

---

## Phase 1: Clarification Questions

### Questions to Ask the Interviewer

```
ESSENTIAL QUESTIONS
===================

1. Scale & Market
   "What's the target scale? 10K, 100K, or 1M+ SMBs?"
   "Is this India-specific or global?"
   "What's the average transaction volume per business?"

2. Functionality
   "Is WhatsApp the only interface, or is there a web dashboard?"
   "Which ERP modules are in scope? (Inventory, Orders, Invoicing, Accounting)"
   "Do we need to support ONDC integration?"

3. Constraints
   "Are there specific compliance requirements? (GST, DPDP)"
   "What's the budget for infrastructure?"
   "Is offline capability important?"

4. AI Expectations
   "Do we need AI-powered features? (NLU, OCR, suggestions)"
   "Privacy requirements for AI processing?"
   "Multi-lingual support? (Hindi, regional languages)"
```

### Scope Definition Example

```
SAMPLE SCOPE DISCUSSION
=======================

Interviewer: "Design an ERP system for SMBs using WhatsApp"

You: "Before I start, let me clarify a few things:

1. For scale, I'll assume 100K SMBs in India, primarily micro-businesses
   with 1-5 employees. Does that match your expectations?

2. For WhatsApp integration, I'll assume:
   - WhatsApp is the PRIMARY interface (not just notifications)
   - Businesses manage inventory, orders, and invoices through chat
   - We use WhatsApp Business API via a BSP partner

3. For compliance, I'll design for:
   - India DPDP Act (data localization)
   - GST compliance (invoicing, tax calculation)

4. I'll focus on these core modules:
   - Inventory management
   - Order processing
   - Invoice generation
   - Basic expense tracking

5. Out of scope (unless you want me to include):
   - HR/Payroll
   - Complex accounting
   - Manufacturing/BOM

Does this scope work, or should I adjust?"
```

---

## Phase 2: High-Level Design

### Architecture Walkthrough Script

```
ARCHITECTURE PRESENTATION
=========================

"Let me walk through the high-level architecture:

[Draw the main components]

1. USER LAYER
   - Business owner uses WhatsApp (primary interface)
   - Customers also interact via WhatsApp
   - Companion app for offline mode

2. WHATSAPP INTEGRATION
   - We use a BSP (Business Solution Provider) like AiSensy or Interakt
   - Why BSP? Faster integration, managed infrastructure, India support
   - BSP handles webhook delivery, rate limiting, compliance

3. MESSAGE PROCESSING
   - Webhooks received from BSP
   - Signature verification (HMAC-SHA256)
   - Priority queue for different message types
   - P0: Payments, P1: Orders, P2: Queries, P3: Marketing

4. AI LAYER (Privacy-First)
   - Edge NLU for intent classification (FastText)
   - Meta's CVM for complex processing
   - No persistent storage of message content
   - This is key for India DPDP compliance

5. ERP SERVICES
   - Stateless microservices
   - Inventory, Orders, Invoicing, Expenses
   - Each service owns its domain logic

6. DATA LAYER
   - PostgreSQL with Row-Level Security
   - Multi-tenant: shared database, logical isolation
   - Tenant-specific encryption keys

7. INTEGRATIONS
   - UPI/Razorpay for payments
   - GST portal for e-invoicing
   - ONDC for marketplace orders

[Pause for questions]

What aspect would you like me to dive deeper into?"
```

### Key Diagrams to Draw

```
DIAGRAM 1: Message Flow
───────────────────────

Customer → WhatsApp → BSP → Webhook → Queue → NLU → ERP Service → DB
                                                           ↓
                                               Response ← Queue ← BSP


DIAGRAM 2: Multi-Tenant Isolation
─────────────────────────────────

┌─────────────────────────────────┐
│        Shared PostgreSQL        │
├─────────────────────────────────┤
│  RLS: WHERE business_id = ctx   │
├─────────────────────────────────┤
│  Tenant A │ Tenant B │ Tenant C │
│   data    │   data   │   data   │
└─────────────────────────────────┘


DIAGRAM 3: Offline-First Sync
─────────────────────────────

┌─────────┐    Online?    ┌─────────┐
│ Local   │ ────Yes────→  │ Server  │
│ Queue   │               │         │
│         │ ────No─────→  │ Local   │
└─────────┘    Queue      │ DB      │
     ↑                    └─────────┘
     │
  Sync when
  online
```

---

## Phase 3: Deep Dive Topics

### Topic A: WhatsApp Rate Limiting

```
DEEP DIVE: RATE LIMITING
========================

Interviewer: "How do you handle WhatsApp API rate limits?"

You: "Great question. WhatsApp enforces 80 messages/sec/phone number.
During festivals like Diwali, we can see 10x traffic. Here's how I'd handle it:

1. PRIORITY QUEUE SYSTEM
   - P0 (Critical): Payments, order confirmations - never drop
   - P1 (Important): Order creation, inventory updates
   - P2 (Normal): Queries, reports
   - P3 (Low): Marketing, bulk messages - can defer

2. TOKEN BUCKET ALGORITHM
   - 80 tokens/second per phone number
   - Refill continuously
   - P0 waits for tokens, P3 gets queued

3. BACKPRESSURE HANDLING
   When queue > 1000:
   - Enable message aggregation (batch similar messages)
   - Pause P3 messages

   When queue > 5000:
   - Enable SMS fallback for P0/P1
   - Alert operations team

4. FESTIVAL PRE-SCALING
   - Calendar-based triggers (Diwali, Eid)
   - Pre-scale 3 days before
   - 5-10x normal capacity

5. MESSAGE AGGREGATION
   Instead of 10 separate 'Order created' messages:
   'You received 10 orders in the last hour:
    Total: ₹1.5L. [View Details]'

This reduces message count while keeping users informed."
```

### Topic B: Offline-First Sync

```
DEEP DIVE: OFFLINE SYNC
=======================

Interviewer: "How does the system work offline?"

You: "Offline capability is critical for India where connectivity is spotty.
Here's my approach:

1. COMPANION APP WITH LOCAL DB
   - SQLite on device stores recent data
   - All operations queue locally first
   - Sync when connectivity returns

2. SYNC PROTOCOL
   - Each operation has a logical timestamp (Lamport clock)
   - Operations sent to server in order
   - Server processes and returns results + server changes

3. CONFLICT RESOLUTION
   Different strategies per entity type:

   INVENTORY:
   - Server-authoritative
   - If client expected qty=10 but server has qty=8
   - Server wins, client notified of conflict
   - Prevents overselling

   EXPENSES:
   - Last-write-wins
   - Simple, no financial integrity risk
   - Merge by timestamp

   ORDERS:
   - Field-level merge
   - Non-conflicting fields auto-merged
   - Conflicts flagged for manual review

4. WHATSAPP AS BACKUP SYNC
   - WhatsApp handles its own queuing
   - If app is offline but WhatsApp works:
     - Customer orders still processed
     - Notifications still delivered
   - App syncs server state on reconnection

5. EXAMPLE SCENARIO
   Business owner creates order offline → Queued
   WhatsApp customer message arrives → Processed on server
   Owner comes online → Sync happens
   Both orders now visible"
```

### Topic C: Privacy-First AI

```
DEEP DIVE: PRIVACY-FIRST AI
===========================

Interviewer: "How do you handle AI without violating privacy?"

You: "This is crucial for DPDP compliance. Our AI never stores message content.

1. EDGE NLU (First Layer)
   - FastText model deployed in India (Mumbai, Chennai)
   - Intent classification + entity extraction
   - No message content logged
   - Handles 90% of requests

2. META'S CVM (Second Layer)
   Meta announced 'Private Processing' in April 2025:
   - Confidential Virtual Machines
   - Ephemeral keys per request
   - Anonymous credentials via third-party CDN
   - No persistent storage
   - Meta cannot access decrypted content

3. PROCESSING DECISION

   Simple query ('Stock iPhone'):
   → Edge NLU → Template response
   → No cloud AI needed

   Complex query ('Which products sold best last Diwali?'):
   → Edge intent detection
   → CVM processes with business context
   → Response generated
   → All data deleted after response

4. WHAT WE DON'T DO
   - No training on customer data
   - No message content in logs
   - No cross-tenant data sharing
   - No AI features without consent

5. FALLBACK FOR PRIVACY-CONSCIOUS
   - Users can disable AI entirely
   - Fall back to button-based interaction
   - Same functionality, just less convenient"
```

---

## Phase 4: Trade-offs Discussion

### Trade-off 1: BSP vs Direct Meta API

| Factor | BSP (Recommended) | Direct Meta API |
|--------|-------------------|-----------------|
| **Setup Time** | 2-3 days | 2-3 weeks |
| **Cost** | +₹0.10-0.20/msg markup | No markup |
| **Compliance** | BSP handles | Self-managed |
| **Support** | Local (India) | Global (slower) |
| **Control** | Limited | Full |

**Recommendation**: "For SMB market, BSP wins. The markup is minimal at scale, and the operational benefits are significant. We can always migrate to direct later if needed."

### Trade-off 2: Shared DB vs Database-per-Tenant

| Factor | Shared DB + RLS | Database per Tenant |
|--------|-----------------|---------------------|
| **Cost** | $3K/month | $300K/month (100K tenants) |
| **Isolation** | Logical (RLS) | Physical |
| **Operations** | Simple | Complex |
| **Compliance** | Encryption needed | Inherent isolation |

**Recommendation**: "At 100K tenants, shared DB with RLS is the only viable option. We add tenant-specific encryption keys for sensitive data."

### Trade-off 3: Real-time vs Batch Processing

| Factor | Real-time | Batch |
|--------|-----------|-------|
| **User Experience** | Instant response | Delayed |
| **Cost** | Higher (always-on) | Lower |
| **Complexity** | Higher | Lower |

**Recommendation**: "Hybrid approach - real-time for user interactions, batch for reports and GST exports."

---

## Phase 5: Trap Questions

### Trap Question 1: "Why not just build a web app?"

```
TRAP: Why WhatsApp instead of web app?

BAD ANSWER: "WhatsApp is trendy" or "Users prefer messaging"

GOOD ANSWER:
"Great question. For Indian SMBs specifically:

1. ADOPTION REALITY
   - WhatsApp: 500M+ users in India, 100% penetration in SMBs
   - Web app adoption: Typically 10-20% of target users
   - No app download, no learning curve

2. USE CASE FIT
   - SMB owners are mobile-first
   - They're already managing business via WhatsApp
   - We're meeting them where they are

3. REDUCED FRICTION
   - No login credentials to remember
   - No app updates to manage
   - WhatsApp handles notifications, offline queuing

4. COST EFFICIENCY
   - No iOS/Android development
   - No web frontend maintenance
   - Single integration point

We DO have a companion app for:
   - Offline-heavy operations
   - Complex reports
   - Settings management

But 90%+ of daily operations happen in WhatsApp."
```

### Trap Question 2: "What if WhatsApp goes down?"

```
TRAP: Single point of failure on WhatsApp

BAD ANSWER: "WhatsApp never goes down" or "We'd just wait"

GOOD ANSWER:
"WhatsApp is indeed a critical dependency. Here's our graceful degradation:

LEVEL 1: WhatsApp Delayed (queue building)
- Messages still delivered, just slower
- Priority queue ensures critical messages first
- No user action needed

LEVEL 2: WhatsApp Unreliable (<90% delivery)
- SMS fallback for P0 messages (payments, confirmations)
- Users notified: 'SMS for critical updates'
- Cost increase but business continues

LEVEL 3: WhatsApp Down
- Companion app becomes primary
- Full ERP functionality available
- Offline mode activated
- SMS for alerts

LEVEL 4: Extended Outage (>4 hours)
- Status page notification
- Proactive SMS to all active businesses
- Manual support queue activated

KEY POINT: We design for WhatsApp failure from day one.
The companion app isn't an afterthought - it's the backup brain.

Also, WhatsApp has 99.9%+ uptime historically.
Downtime is rare but we're prepared."
```

### Trap Question 3: "How is this different from Zoho/Tally?"

```
TRAP: Differentiation from existing ERP

BAD ANSWER: "We're cheaper" or "We have AI"

GOOD ANSWER:
"Zoho and Tally are excellent traditional ERPs. We're solving a different problem:

1. TARGET USER
   - Zoho/Tally: Businesses with dedicated accounting staff
   - Us: Micro-SMBs where owner does everything

2. INTERACTION MODEL
   - Zoho/Tally: Menu navigation, forms, reports
   - Us: Conversation - 'Kitna stock hai iPhone ka?'

3. LEARNING CURVE
   - Zoho/Tally: Days to weeks of training
   - Us: Zero - if you can use WhatsApp, you can use this

4. LANGUAGE
   - Zoho/Tally: Primarily English interface
   - Us: Native Hindi, Hinglish, regional languages

5. MOBILE-FIRST
   - Zoho/Tally: Designed for desktop, mobile is secondary
   - Us: WhatsApp IS the interface

6. ADOPTION BARRIER
   - Zoho/Tally: Download app, create account, learn system
   - Us: Message our WhatsApp number, start using

We're not competing with Zoho for enterprises.
We're enabling the 60 million Indian MSMEs who find traditional ERP too complex."
```

### Trap Question 4: "What about businesses without smartphones?"

```
TRAP: Edge Case (Unusual or extreme situation) - feature phones

BAD ANSWER: "They can't use our system" or "Everyone has smartphones"

GOOD ANSWER:
"Good Edge Case (Unusual or extreme situation). In India, ~30% still use feature phones. We have options:

1. USSD FALLBACK (Future)
   - *123# style interface
   - Basic operations: stock check, order status
   - Works on any phone

2. SHARED DEVICE MODE
   - Multiple businesses on one smartphone
   - Switch context by entering business code
   - Common in rural markets

3. AGENT-ASSISTED MODEL
   - Aggregator/distributor acts as proxy
   - They have smartphone, manage multiple small sellers
   - Common pattern in rural India

4. VOICE INPUT (Current)
   - WhatsApp voice notes work on basic smartphones
   - We transcribe and process
   - 'Send voice note: Aaj ka sale kitna hua'

5. SMS-ONLY MODE (Planned)
   - Core operations via SMS
   - No WhatsApp required
   - Higher cost but enables everyone

For MVP, we focus on smartphone users (70% of target).
USSD/SMS are Phase 2 features."
```

---

## Common Mistakes to Avoid

| Mistake | Why It's Wrong | Better Approach |
|---------|----------------|-----------------|
| **Over-engineering AI** | SMBs need simple, not GPT-4 | Start with templates, add NLU gradually |
| **Ignoring rate limits** | Will cause production issues | Design for limits from day 1 |
| **Single region deployment** | DPDP requires India data | Multi-region India (Mumbai + Chennai) |
| **Complex data model** | SMBs have simple needs | Minimal viable schema |
| **English-only** | 50%+ users prefer Hindi | Multi-lingual from start |
| **Forgetting offline** | India connectivity is spotty | Offline-first architecture |
| **Web dashboard focus** | Users won't use it | WhatsApp-first, web for admin only |

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────┐
│          WHATSAPP NATIVE ERP - INTERVIEW QUICK REF              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  KEY NUMBERS                      KEY DECISIONS                 │
│  ───────────                      ─────────────                 │
│  100K tenants Year 1              ✓ BSP over direct Meta API    │
│  10M messages/day                 ✓ Shared DB with RLS          │
│  500 QPS peak                     ✓ CVM-based AI (privacy)      │
│  80 msg/sec rate limit            ✓ Offline-first sync          │
│  99.9% availability               ✓ India-only deployment       │
│                                                                 │
│  UNIQUE ASPECTS                   COMPLIANCE                    │
│  ──────────────                   ──────────                    │
│  • WhatsApp IS the UI             • India DPDP (data local)     │
│  • Zero learning curve            • GST (tax calculation)       │
│  • Privacy-first AI (CVM)         • E-Invoice integration       │
│  • Hindi/Hinglish native          • Audit logging (7 years)     │
│  • Offline-first design                                         │
│                                                                 │
│  ARCHITECTURE HIGHLIGHTS                                        │
│  ───────────────────────                                        │
│  BSP → Webhook → Priority Queue → Edge NLU → ERP → PostgreSQL   │
│         ↓                              ↓                        │
│    Signature verify              CVM for complex                │
│         ↓                              ↓                        │
│    Deduplication              Privacy-preserved                 │
│                                                                 │
│  TRADE-OFFS TO DISCUSS                                          │
│  ─────────────────────                                          │
│  • BSP vs Direct: BSP wins (speed, support)                     │
│  • Shared vs Dedicated DB: Shared wins (cost)                   │
│  • Real-time vs Batch: Hybrid (UX + efficiency)                 │
│  • AI complexity: Simple first (templates → NLU → LLM)          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Interview Checklist

### Before the Interview
- [ ] Understand WhatsApp Business API basics
- [ ] Know India DPDP Act requirements
- [ ] Understand GST invoice structure
- [ ] Review rate limiting strategies
- [ ] Practice offline sync explanation

### During the Interview
- [ ] Clarify scope early (India focus, SMB scale)
- [ ] Emphasize WhatsApp-first, not WhatsApp-also
- [ ] Draw clear architecture diagram
- [ ] Discuss privacy-first AI (CVM)
- [ ] Address failure scenarios proactively
- [ ] Mention regional language support

### Key Differentiators to Highlight
1. **WhatsApp as primary UI** (not just notifications)
2. **Privacy-first AI** (Meta's CVM, no data storage)
3. **India-specific compliance** (DPDP, GST)
4. **Offline-first architecture** (critical for India)
5. **Zero learning curve** (if you can WhatsApp, you can ERP)

---

### Trap Question 5: "How do you handle WhatsApp's pricing changes?"

```
TRAP: WhatsApp pricing sensitivity

BAD ANSWER: "We just pass costs to the SMB" or "Messaging is cheap"

GOOD ANSWER:
"WhatsApp's July 2025 pricing restructure (per-message model) significantly
impacts unit economics. Our optimization strategy:

1. MESSAGE CONSOLIDATION (40% reduction)
   - Batch related notifications into single messages
   - Order confirmation + invoice + payment link = 1 message
   - Reduces 10 individual alerts to 3 digests

2. TEMPLATE CATEGORIZATION (15% rate reduction)
   - Classify messages correctly: utility vs marketing
   - Order confirmations are 'utility' (cheaper)
   - Only promotional broadcasts are 'marketing'

3. SESSION WINDOW MAXIMIZATION (20% reduction)
   - When user messages us, we have a 24h free-reply window
   - Schedule pending alerts within active sessions
   - Track session expiry per business user

4. FLOWS OVER TEXT CONVERSATIONS (10% reduction)
   - A 5-screen order Flow = 1 interaction
   - Same flow via text = 10+ messages
   - Flows are 80% cheaper for structured operations

5. COST MONITORING
   - Dashboard showing cost/tenant/day
   - Alert when cost exceeds thresholds
   - A/B test message strategies for cost efficiency

Net result: 63% cost reduction vs naive implementation.
At 100K tenants, that's ₹6.6 Cr/month in savings."
```

### Trap Question 6: "What happens when Meta changes the API?"

```
TRAP: Platform dependency risk

BAD ANSWER: "Meta's API is stable" or "We'll adapt when it happens"

GOOD ANSWER:
"API platform risk is real and we design for it:

1. BSP ABSTRACTION LAYER
   - All WhatsApp interactions go through our BSP gateway
   - Business logic never touches WhatsApp-specific formats
   - If Meta changes webhook format, only the normalizer changes

2. SCHEMA VERSIONING
   - Our internal message format is versioned
   - Webhook normalizer handles v1, v2, v3 payloads
   - New versions added without breaking existing flow

3. FEATURE DETECTION
   - Check WhatsApp capabilities at runtime
   - If Flows unavailable → fall back to interactive buttons
   - If Catalog API changes → degrade to text-based product listing

4. MULTI-CHANNEL ARCHITECTURE
   - Same ERP services exposed via WhatsApp, SMS, companion app
   - If WhatsApp becomes untenable, pivot to app-first
   - Business logic is channel-agnostic

5. MONITORING API HEALTH
   - Track Meta API response codes and deprecation headers
   - Alert on new deprecation warnings
   - Quarterly review of WhatsApp changelog

The key insight: the ERP is the product, WhatsApp is a channel.
We optimize for WhatsApp but don't make it irreplaceable."
```

---

## Cross-System Interview Connections

When discussing this system, demonstrate breadth by connecting to related system design concepts:

| If Asked About... | Connect To... | Key Point |
|-------------------|---------------|-----------|
| Rate limiting | [Distributed Rate Limiter](../1.1-distributed-rate-limiter/00-index.md) | Token bucket per phone number is same pattern as API rate limiting |
| Multi-tenancy | [Cloud Provider Architecture](../2.1-cloud-provider-architecture/00-index.md) | RLS is the lightweight version of cell-based isolation |
| Offline sync | [AI-Native Offline-First POS](../2.22-ai-native-offline-first-pos/00-index.md) | Same CRDT/conflict resolution patterns in a different domain |
| Privacy AI | [LLM Gateway](../3.21-llm-gateway-prompt-management/00-index.md) | CVM is the WhatsApp version of privacy-preserving inference |
| Event sourcing | [Event Sourcing System](../1.18-event-sourcing-system/00-index.md) | Audit trail uses append-only event log pattern |
| Message queuing | [Distributed Message Queue](../1.6-distributed-message-queue/00-index.md) | Priority queue with backpressure is standard message broker pattern |

---

## Related Reading

- Meta Engineering Blog: "Building Private Processing for AI tools on WhatsApp" (April 2025)
- WhatsApp Business Platform documentation - Cloud API, Flows, Catalogs
- India Digital Personal Data Protection (DPDP) Act 2023
- AiSensy, Interakt, Gallabox documentation and pricing
- WhatsApp Business pricing restructure (July 2025) - per-message model changes
