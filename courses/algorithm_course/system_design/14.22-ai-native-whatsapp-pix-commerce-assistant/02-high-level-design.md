# High-Level Design — AI-Native WhatsApp+PIX Commerce Assistant

## System Architecture

```mermaid
flowchart TB
    subgraph ClientLayer["Client Layer"]
        WA[WhatsApp Users<br/>165M+ Brazil]
        WABA[WhatsApp Business<br/>API Cloud]
    end

    subgraph IngressLayer["Ingress & Routing"]
        WH[Webhook Gateway]
        DD[Deduplication<br/>Service]
        MR[Message Router]
    end

    subgraph AILayer["Multimodal AI Pipeline"]
        TP[Text Parser<br/>LLM Intent Extraction]
        STT[Speech-to-Text<br/>Engine]
        CV[Computer Vision<br/>QR Decoder]
        OCR[OCR Engine<br/>Document Parser]
        IE[Intent Enrichment<br/>& Entity Resolution]
    end

    subgraph ConversationLayer["Conversation Engine"]
        CSM[Conversation<br/>State Machine]
        DM[Dialogue Manager<br/>Multi-Turn Flow]
        CT[Confirmation &<br/>Disambiguation]
    end

    subgraph PaymentLayer["Payment Execution"]
        PO[Payment<br/>Orchestrator]
        FL[Fraud & Risk<br/>Scoring Engine]
        AH[Auth Handoff<br/>Deep Link Generator]
        PIX[PIX Settlement<br/>SPI Gateway]
    end

    subgraph ReceiptLayer["Post-Settlement"]
        RG[Receipt<br/>Generator]
        NF[Nota Fiscal<br/>Service]
        TM[Template Message<br/>Sender]
    end

    subgraph DataLayer["Data & State"]
        CS[(Conversation<br/>Store)]
        TL[(Transaction<br/>Ledger)]
        UP[(User Profile<br/>& History)]
        DC[(DICT Cache)]
        MQ[[Message Queue<br/>Event Bus]]
    end

    WA <--> WABA
    WABA --> WH
    WH --> DD
    DD --> MR
    MR -->|text| TP
    MR -->|audio| STT
    MR -->|image| CV
    MR -->|image| OCR
    STT --> TP
    CV --> IE
    OCR --> IE
    TP --> IE
    IE --> CSM
    CSM <--> DM
    DM <--> CT
    CT --> PO
    PO --> FL
    FL -->|approved| AH
    AH -->|user authenticates| PIX
    PIX --> RG
    RG --> NF
    RG --> TM
    TM --> WABA

    CSM <--> CS
    PO <--> TL
    IE <--> UP
    PIX <--> DC
    MR <--> MQ

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef ai fill:#fce4ec,stroke:#c62828,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef queue fill:#e0f7fa,stroke:#00695c,stroke-width:2px
    classDef cache fill:#fffde7,stroke:#f57f17,stroke-width:2px

    class WA,WABA client
    class WH,DD,MR gateway
    class TP,STT,CV,OCR,IE ai
    class CSM,DM,CT,PO,FL,AH,PIX,RG,NF,TM service
    class CS,TL,UP data
    class DC cache
    class MQ queue
```

---

## Data Flow: Payment via Text Message

```mermaid
sequenceDiagram
    participant U as User (WhatsApp)
    participant WA as WhatsApp Cloud API
    participant WH as Webhook Gateway
    participant DD as Dedup Service
    participant LLM as Text Parser (LLM)
    participant CSM as Conversation State
    participant DM as Dialogue Manager
    participant FL as Fraud Engine
    participant AH as Auth Handoff
    participant BA as Banking App
    participant SPI as PIX SPI
    participant RG as Receipt Generator

    U->>WA: "manda 50 pra Maria do trabalho"
    WA->>WH: POST /webhook (message event)
    WH->>DD: Check message_id uniqueness
    DD-->>WH: New message (not duplicate)
    WH-->>WA: 200 OK (within 2s)

    WH->>LLM: Extract intent from text
    Note over LLM: Intent: PAYMENT<br/>Amount: R$50.00<br/>Recipient: "Maria do trabalho"<br/>Confidence: 0.92

    LLM->>CSM: Store extracted entities
    CSM->>DM: Evaluate conversation state

    Note over DM: Resolve "Maria do trabalho"<br/>against user's contact/tx history<br/>Found: Maria Silva (PIX: maria@email.com)

    DM->>WA: "Confirma enviar R$50,00 para<br/>Maria Silva (maria@email.com)<br/>via PIX? [Sim] [Cancelar]"
    WA->>U: Interactive message with buttons

    U->>WA: Taps [Sim]
    WA->>WH: POST /webhook (button reply)
    WH->>DD: Check uniqueness
    WH-->>WA: 200 OK

    WH->>CSM: Update state: CONFIRMED
    CSM->>FL: Score transaction risk
    Note over FL: Risk Score: 0.12 (LOW)<br/>Known recipient, typical amount

    FL->>AH: Generate secure handoff
    AH->>WA: Deep link to banking app<br/>"Toque para autenticar no app"
    WA->>U: Message with deep link

    U->>BA: Opens banking app, biometric auth
    BA->>SPI: pacs.008 (PIX credit transfer)
    SPI-->>BA: pacs.002 (settlement confirmed)
    BA->>WH: Callback: settlement complete

    WH->>RG: Generate receipt
    RG->>WA: In-chat receipt message
    WA->>U: "PIX enviado! R$50,00 para<br/>Maria Silva ✓<br/>ID: E12345...789<br/>10/03/2026 14:32:07"
```

---

## Data Flow: Payment via Voice Message

```mermaid
sequenceDiagram
    participant U as User (WhatsApp)
    participant WA as WhatsApp Cloud API
    participant WH as Webhook Gateway
    participant STT as Speech-to-Text
    participant LLM as Text Parser (LLM)
    participant CSM as Conversation State
    participant DM as Dialogue Manager

    U->>WA: Voice message (8 seconds, Opus)
    WA->>WH: POST /webhook (audio message)
    WH-->>WA: 200 OK

    WH->>WA: GET /media/{media_id}
    WA-->>WH: Audio file (Opus, ~15KB)

    WH->>STT: Transcribe audio
    Note over STT: Decode Opus → PCM<br/>Brazilian PT model<br/>Output: "paga o joão<br/>cinquenta conto pela<br/>pizza de ontem"<br/>Confidence: 0.88

    STT->>LLM: Parse transcription
    Note over LLM: Intent: PAYMENT<br/>Amount: R$50.00<br/>("conto" → R$1 colloquial)<br/>Recipient: "João"<br/>Memo: "pizza de ontem"

    LLM->>CSM: Store entities
    CSM->>DM: Resolve recipient

    Note over DM: Multiple "João" matches<br/>João Pedro (last PIX: 2 days ago)<br/>João Carlos (last PIX: 3 months ago)

    DM->>WA: "Entendi: pagar R$50 para João.<br/>Qual João?<br/>[João Pedro] [João Carlos]<br/>[Outro]"
    WA->>U: Disambiguation message

    U->>WA: Taps [João Pedro]
    Note over DM: Continue to confirmation<br/>and payment flow...
```

---

## Data Flow: Payment via QR Code Photo

```mermaid
sequenceDiagram
    participant U as User (WhatsApp)
    participant WA as WhatsApp Cloud API
    participant WH as Webhook Gateway
    participant CV as Computer Vision
    participant QR as QR Decoder
    participant CSM as Conversation State

    U->>WA: Photo of QR code on receipt
    WA->>WH: POST /webhook (image message)
    WH-->>WA: 200 OK

    WH->>WA: GET /media/{media_id}
    WA-->>WH: Image file (JPEG, ~200KB)

    WH->>CV: Detect QR regions in image
    Note over CV: Pre-processing:<br/>- Perspective correction<br/>- Contrast enhancement<br/>- Region detection<br/>Found: 1 QR code region

    CV->>QR: Decode QR payload
    Note over QR: BR Code TLV parsing:<br/>- Merchant: Pizzaria Bella<br/>- PIX Key: 12345678000199<br/>- Amount: R$47.50<br/>- City: São Paulo<br/>- CRC: Valid ✓

    alt Dynamic QR (COB/COBV)
        QR->>QR: Fetch charge from hosted URL
        Note over QR: GET /cobv/{txid}<br/>Validate JWT signature<br/>Check expiration
    end

    QR->>CSM: Store decoded payment info
    CSM->>WA: "QR Code lido! Pagar:<br/>R$47,50 para Pizzaria Bella<br/>CNPJ: 12.345.678/0001-99<br/>[Pagar] [Cancelar]"
    WA->>U: Confirmation with details
```

---

## Key Architectural Decisions

### 1. Sync vs. Async Communication

| Component | Model | Justification |
|---|---|---|
| Webhook ingestion | **Async** | Must acknowledge within 20s (WhatsApp timeout); actual processing happens asynchronously via message queue |
| AI pipeline (STT, CV, LLM) | **Async with streaming** | AI inference takes 1-4 seconds; queue-based with priority (text fastest, voice/image slower) |
| Payment settlement (SPI) | **Sync** | PIX settlement is inherently synchronous; the payer's PSP submits to SPI and waits for pacs.002 confirmation |
| Receipt delivery | **Async** | Decoupled from settlement; receipt generation and WhatsApp message sending happen after settlement callback |

### 2. Event-Driven vs. Request-Response

**Decision: Event-driven core with request-response at boundaries.**

The system's internal architecture is event-driven: each message ingestion produces an event that flows through the AI pipeline, conversation engine, and payment orchestrator. This enables:
- Decoupling between AI processing stages (STT can scale independently of CV)
- Retry and dead-letter handling for failed AI inferences
- Audit trail via event log (every state transition recorded)

Request-response is used only at system boundaries:
- WhatsApp Cloud API (webhooks in, API calls out)
- PIX SPI integration (pacs.008 request, pacs.002 response)
- DICT lookups (key-to-account resolution)

### 3. Database Choices (Polyglot Persistence)

| Data | Store Type | Rationale |
|---|---|---|
| **Conversation state** | Document store (e.g., MongoDB) | Flexible schema for multi-turn dialogue; per-user partition; TTL for 24-hour window expiry |
| **Transaction ledger** | Relational DB (e.g., PostgreSQL) | ACID guarantees for financial records; strong consistency; audit requirements |
| **User profiles & history** | Document store | Semi-structured user preferences, contact mappings, transaction history |
| **DICT cache** | In-memory store (e.g., Redis) | Sub-millisecond key-to-account lookups; TTL-based refresh from BCB |
| **Message deduplication** | In-memory store (e.g., Redis) | WhatsApp message ID dedup with 24-hour TTL |
| **Event bus** | Distributed log (e.g., Kafka) | Ordered event processing per conversation; replay capability; exactly-once semantics |
| **AI model registry** | Object storage + metadata DB | Model versioning, A/B testing, rollback capability |
| **Audit logs** | Append-only store | Immutable, hash-chained for regulatory compliance |

### 4. Caching Strategy

| Cache Layer | Data | TTL | Strategy |
|---|---|---|---|
| **L1 (in-process)** | Active conversation state | 5 min | LRU; ~10K concurrent conversations per node |
| **L2 (distributed)** | Conversation state, user profiles | 24 hours | Write-through for state, read-through for profiles |
| **DICT cache** | PIX key → account mappings | 15 min | Background refresh; fallback to direct DICT query on miss |
| **Template cache** | Pre-approved WhatsApp message templates | 1 hour | Refresh on template approval webhook |
| **AI model cache** | Loaded model weights | Until new version | Blue-green swap on model deployment |

### 5. Message Queue Usage

| Queue/Topic | Purpose | Ordering | Delivery |
|---|---|---|---|
| `inbound-messages` | Raw webhook events | Per-conversation (partition by user phone hash) | At-least-once with dedup |
| `ai-pipeline` | AI processing tasks | Per-conversation | At-least-once; priority sub-queues by modality |
| `payment-commands` | Confirmed payment intents | Per-user | Exactly-once (idempotency key) |
| `settlement-events` | SPI settlement callbacks | Per-transaction | At-least-once with dedup by endToEndId |
| `outbound-messages` | WhatsApp API messages to send | Per-conversation | At-least-once with rate limiting (80-1000 msg/s) |
| `audit-events` | All state transitions | Global ordering | At-least-once; append-only consumer |

---

## Architecture Pattern Checklist

- [x] **Sync vs Async**: Async ingestion + processing; sync at payment settlement boundary
- [x] **Event-driven vs Request-response**: Event-driven core; request-response at WhatsApp and PIX boundaries
- [x] **Push vs Pull**: Push-based (WhatsApp pushes webhooks to us; we push messages back via API)
- [x] **Stateless vs Stateful**: Stateless services with externalized state (conversation store, ledger); AI models loaded in memory (stateful at node level, but horizontally scalable)
- [x] **Read-heavy vs Write-heavy**: Write-heavy for ingestion (35M messages/day); read-heavy for conversation state retrieval during multi-turn flows
- [x] **Real-time vs Batch**: Real-time for all transaction paths; batch for analytics, model retraining, and compliance reporting
- [x] **Edge vs Origin**: Origin processing for AI inference (GPU requirements); edge CDN not applicable (no static content)

---

## Component Interaction Summary

### Happy Path (Text Payment)

1. **Ingress** (50ms): Webhook received → deduplicated → queued
2. **AI Extraction** (500ms-1.5s): LLM parses text → extracts intent, amount, recipient
3. **Entity Resolution** (200ms): Recipient name → PIX key via user history + DICT
4. **Conversation Turn** (100ms): State machine transitions → generates confirmation message
5. **User Confirmation** (human time): User taps "Confirm" button
6. **Fraud Scoring** (100ms): Risk assessment on extracted transaction parameters
7. **Auth Handoff** (200ms): Generate deep link with encrypted, short-lived token
8. **User Authentication** (human time): Biometric/PIN in banking app
9. **PIX Settlement** (3-10s): SPI processes pacs.008 → returns pacs.002
10. **Receipt** (500ms): Generate receipt → send via WhatsApp template message

**Total system time (excluding human interaction):** ~2-13 seconds
**Total user-perceived time (including authentication):** ~15-30 seconds

### Degraded Mode

| Failure | Degraded Behavior |
|---|---|
| LLM unavailable | Fall back to rule-based regex extraction for simple patterns; queue complex messages for retry |
| STT unavailable | Respond with "Voice messages temporarily unavailable, please type your request" |
| CV unavailable | Respond with "Photo processing unavailable, please enter PIX key manually" |
| DICT cache miss | Direct DICT query (30-50ms instead of 2ms); still within latency budget |
| SPI unavailable | Queue payment for retry; notify user of delay; this is extremely rare (PIX operates 24/7) |
| WhatsApp API rate limited | Queue outbound messages; prioritize payment confirmations and receipts over informational messages |

---

## Architecture Decision Records

### ADR 1: Asynchronous Webhook Processing

**Context:** WhatsApp Cloud API enforces a 20-second timeout on webhook responses. AI processing (LLM, STT, CV) takes 1-4 seconds normally but can spike to 10+ seconds under load.

**Decision:** Immediately acknowledge all webhooks (200 OK within 2 seconds), then process asynchronously via message queue.

**Rationale:**
- Synchronous processing risks 20-second timeout violations, causing WhatsApp to retry (creating duplicate events)
- Async decouples ingestion rate from processing rate, enabling independent scaling
- Message queue provides natural buffering for load spikes
- Dead-letter queues handle persistent processing failures

**Trade-off accepted:** The user sees a slight delay between sending a message and receiving a response (vs. immediate response in sync processing). Mitigated by WhatsApp's "typing indicator" during processing.

### ADR 2: Three-Layer Deduplication

**Context:** WhatsApp delivers webhooks at-least-once. PIX settlements are irrevocable. A single missed dedup = permanent financial loss.

**Decision:** Implement three independent deduplication layers, each capable of preventing duplicates if the other layers fail.

**Rationale:**
- Layer 1 (Redis): Fast, handles 99.9% of duplicates with SET NX on message ID
- Layer 2 (Conversation lock): Prevents concurrent state transitions on the same conversation
- Layer 3 (DB unique constraint): Prevents duplicate payment records even if Redis and locks fail
- Triple redundancy because the cost of failure (irrevocable financial loss) is asymmetrically high compared to the cost of implementation (modest)

**Trade-off accepted:** Added latency (2ms for Redis + potential lock wait); added operational complexity (3 dedup systems to monitor); over-engineering for non-financial systems.

### ADR 3: Mandatory User Confirmation for All Payments

**Context:** AI extraction accuracy is 87-95% depending on modality. Some teams propose skipping confirmation for high-confidence repeat transactions.

**Decision:** Require explicit user confirmation for every payment, regardless of confidence score.

**Rationale:**
- PIX is irrevocable: a wrong payment cannot be undone via chargeback
- At 3M daily payments and 5% error rate, "smart skip" would produce 150K incorrect payments per day
- The confirmation adds one message round-trip (~5 seconds) but eliminates AI-caused financial errors entirely
- User confirmation also serves as the last fraud defense: even if the AI is manipulated via prompt injection, the user sees and approves the actual parameters

**Trade-off accepted:** Slower UX (one extra message per payment); lower conversion rate vs. frictionless payment; future opportunity to introduce smart-skip for repeat transactions after extensive A/B testing.

---

## Cross-Cutting Concerns

### Idempotency Design

| Operation | Idempotency Key | Scope |
|---|---|---|
| **Webhook processing** | WhatsApp message ID (`wamid`) | 24-hour TTL in Redis |
| **Payment intent creation** | Conversation ID + state version | DB unique constraint per conversation |
| **SPI payment submission** | Intent ID + idempotency token | PIX end-to-end ID (BCB-mandated uniqueness) |
| **Receipt delivery** | Transaction ID + receipt type | Redis SET NX with 1-hour TTL |
| **DICT lookup** | PIX key + timestamp bucket (15-min) | Cache with TTL-based refresh |

### Rate Limiting Strategy

| Level | Limit | Purpose |
|---|---|---|
| **Global webhook intake** | 10,000 req/s | Protect infrastructure from DDoS |
| **Per-IP webhook** | 50 req/s | Detect and throttle anomalous sources |
| **Per-user messages** | 50 messages/hour | Prevent bot abuse or misbehaving clients |
| **Per-user payments** | 5 payments/hour | BCB-aligned transaction velocity limit |
| **Per-merchant QR scans** | 1,000 scans/hour | Prevent viral QR overload |
| **Outbound messages** | 80-1,000/s (WhatsApp tier) | Platform-imposed; managed via priority queue |

### Circuit Breaker Configuration

| Service | Failure Threshold | Open Duration | Fallback |
|---|---|---|---|
| **LLM inference** | 5 failures / 10s | 30s | Regex extraction for simple patterns |
| **STT engine** | 3 failures / 10s | 30s | "Please type your request" response |
| **CV engine** | 3 failures / 10s | 30s | "Please enter PIX key manually" response |
| **DICT query** | 5 failures / 10s | 60s | Stale cache (acceptable for 15 min) |
| **SPI gateway** | 2 failures / 30s | 120s | Queue payments with user notification |
| **WhatsApp send API** | 10 failures / 5s | 15s | Retry queue with exponential backoff |

---

## Multi-LLM Abstraction Layer (CADE Compliance)

```mermaid
---
config:
  theme: neutral
  look: neo
---
flowchart TB
    subgraph Input["Input Processing"]
        MSG[Normalized Message]
        PROMPT[Prompt Template<br/>Provider-Agnostic]
    end

    subgraph Router["Provider Router"]
        PR{Route by<br/>Policy}
    end

    subgraph Providers["LLM Providers"]
        P1[Provider A<br/>Primary]
        P2[Provider B<br/>Secondary / Failover]
        P3[Provider C<br/>Cost-Optimized]
    end

    subgraph Normalize["Output Normalization"]
        ON[Normalize to<br/>Standard Schema]
        VAL[Validate Extraction<br/>Format + Bounds]
    end

    MSG --> PROMPT --> PR
    PR -->|default| P1
    PR -->|failover| P2
    PR -->|cost_route| P3
    P1 & P2 & P3 --> ON --> VAL

    classDef input fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef router fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef provider fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef normalize fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class MSG,PROMPT input
    class PR router
    class P1,P2,P3 provider
    class ON,VAL normalize
```

**Provider Qualification Protocol:**
1. Run golden dataset (10,000+ annotated Brazilian Portuguese payment messages) against candidate provider
2. Require >93% accuracy on amount extraction and >90% on recipient extraction
3. Verify no systematic biases (e.g., model always interprets "conto" as R$1,000 when training data skews São Paulo)
4. Load test at 500 QPS to verify latency meets SLA (<1.5s p95)
5. Verify structured output format compliance (no hallucinated fields)

---

## WhatsApp Template Message Strategy

WhatsApp requires pre-approved message templates for proactive notifications (messages sent outside the 24-hour conversation window). Template management is a first-class architectural concern because:
- Templates must be submitted to Meta for review days before use
- Template variables have strict formatting rules
- Template rejection can block critical user communications
- Each template version has its own approval status

### Template Library

| Template ID | Purpose | Variables | Approval Status |
|---|---|---|---|
| `payment_receipt_v3` | Post-settlement receipt | `{{amount}}`, `{{recipient}}`, `{{e2e_id}}`, `{{timestamp}}` | Active |
| `payment_confirmation_v3` | Pre-settlement confirmation | `{{amount}}`, `{{recipient_masked}}`, `{{pix_key_type}}` | Active |
| `subscription_activated` | Pix Automático setup confirmation | `{{merchant}}`, `{{amount}}`, `{{frequency}}`, `{{next_date}}` | Active |
| `subscription_executed` | Monthly Pix Automático notification | `{{merchant}}`, `{{amount}}`, `{{date}}` | Active |
| `fraud_alert_v2` | Pre-transaction scam warning | `{{amount}}`, `{{risk_reason}}` | Active |
| `med_claim_update` | MED status notification | `{{claim_status}}`, `{{amount}}`, `{{expected_date}}` | Active |
| `service_degraded` | System issue notification | `{{affected_feature}}`, `{{estimated_recovery}}` | Active |
| `balance_insufficient` | Auto-debit failure alert | `{{merchant}}`, `{{amount}}`, `{{retry_time}}` | Active |

### Graceful Degradation Hierarchy

The system degrades in a prioritized order, protecting payment execution above all other capabilities:

```
Degradation Levels (from least to most severe):

Level 0: NORMAL — All capabilities operational
  └── Full multimodal support, rich messages, real-time balances

Level 1: AI_DEGRADED — LLM/STT/CV partially unavailable
  ├── Text: fall back to regex extraction (handles ~40% of messages)
  ├── Voice: "Please type your request" response
  ├── Image: "Please enter PIX key manually" response
  └── Payments still fully functional for successfully extracted intents

Level 2: OUTBOUND_CONSTRAINED — WhatsApp rate limited
  ├── Priority queue activated: receipts > confirmations > info
  ├── Rich interactive messages → simple text messages
  ├── Balance queries → delayed response with timestamp
  └── Marketing/broadcast messages paused entirely

Level 3: PAYMENT_DEGRADED — SPI or auth service issues
  ├── New payment intents queued with user notification
  ├── Existing in-flight payments continue (SPI retry)
  ├── Balance queries still operational
  └── Conversation engine fully operational (can extract, confirm)

Level 4: CHANNEL_DOWN — WhatsApp API unavailable
  ├── In-flight payments with auth tokens continue in banking app
  ├── Receipts queued for delivery when channel recovers
  ├── Push notification via banking app: "Use app directly"
  └── No new payment conversations possible
```

### Regional Deployment Topology

```
Brazil Region Configuration:

Primary: São Paulo (sa-east-1 equivalent)
├── Full compute: webhook gateways, AI pipeline, payment orchestrator
├── GPU pool: LLM inference, STT, CV (majority of compute)
├── Primary databases: transaction ledger, conversation store
├── Redis cluster: dedup cache, DICT cache, conversation state
└── SPI/DICT connectivity: direct RSFN network attachment

Secondary: Rio de Janeiro (disaster recovery)
├── Hot standby: webhook gateways (active-passive)
├── Database replicas: synchronous for transaction ledger, async for conversation
├── GPU pool: 30% of primary capacity (scale-up on failover)
└── SPI connectivity: independent RSFN attachment (BCB requirement for DR)

Failover criteria:
├── Automatic: primary health check fails for 60 seconds
├── Manual: BCB RSFN maintenance window (scheduled)
└── RTO: < 5 minutes for payment processing; < 15 minutes for AI pipeline
```

### Template Versioning Protocol

1. New template versions submitted 7 business days before planned deployment
2. If Meta rejects template: use previous version; iterate on rejected template
3. Template variable changes require new template version (Meta treats as new template)
4. Templates rotated quarterly to comply with Meta's anti-spam policies
