# Observability — AI-Native WhatsApp+PIX Commerce Assistant

## Metrics (USE/RED)

### Key Business Metrics

| Metric | Description | Target | Alert Threshold |
|---|---|---|---|
| `payment.conversion_rate` | Conversations resulting in completed payment | >40% | <30% (P1) |
| `payment.success_rate` | Successful settlements / total attempts | >99.5% | <98% (P0) |
| `payment.daily_volume` | Total PIX transactions per day | ~3M | <1M or >10M (anomaly) |
| `payment.daily_value` | Total BRL settled per day | ~R$150M | <R$50M or >R$500M (anomaly) |
| `conversation.intent_accuracy` | First-attempt correct extraction rate | >95% text, >90% voice | <90% text, <85% voice (P1) |
| `conversation.completion_rate` | Conversations reaching terminal state | >85% | <70% (P1) |
| `fraud.block_rate` | Transactions blocked by fraud engine | 0.3-0.8% | >2% (review model) or <0.1% (model may be too permissive) |
| `fraud.false_positive_rate` | Legitimate transactions incorrectly blocked | <0.5% | >1% (P1) |

### Infrastructure Metrics (USE)

| Resource | Utilization | Saturation | Errors |
|---|---|---|---|
| **Webhook Gateway** | Request rate, CPU, memory | Request queue depth, connection pool | 5xx rate, timeout rate |
| **GPU Pool (LLM)** | GPU utilization %, memory usage | Inference queue depth, batch fill rate | OOM errors, inference failures |
| **GPU Pool (STT)** | GPU utilization %, memory usage | Audio queue depth | Transcription failures |
| **GPU Pool (CV)** | GPU utilization %, memory usage | Image queue depth | Detection failures |
| **Redis Cluster** | Memory usage, CPU, connections | Eviction rate, connection wait time | Command errors, replication lag |
| **Transaction DB** | CPU, IOPS, connections | Lock wait time, replication lag | Deadlocks, query timeouts |
| **Message Queue** | Partition lag, throughput | Consumer group lag, pending messages | Producer failures, consumer errors |

### Service Metrics (RED)

| Service | Rate | Error | Duration |
|---|---|---|---|
| **Webhook Processing** | Webhooks/sec (by type) | Failed acknowledgments | p50/p95/p99 processing time |
| **Text Extraction** | Extractions/sec | Low-confidence extractions | p50/p95/p99 LLM inference time |
| **Voice Transcription** | Transcriptions/sec | Failed transcriptions | p50/p95/p99 STT time |
| **QR Recognition** | Recognitions/sec | Failed detections | p50/p95/p99 CV time |
| **Fraud Scoring** | Assessments/sec | Model errors | p50/p95/p99 scoring time |
| **Payment Execution** | Payments/sec | Failed settlements | p50/p95/p99 end-to-end time |
| **Receipt Delivery** | Receipts/sec | Failed sends | p50/p95/p99 delivery time |

### Dashboard Design

**Operational Dashboard (Real-Time):**
- Top row: Payment success rate (gauge), active conversations (counter), messages/sec (graph)
- Middle: Latency heatmaps per modality (text, voice, image), settlement latency
- Bottom: Error rates by component, circuit breaker states, queue depths

**AI Performance Dashboard:**
- Intent extraction accuracy by modality (time-series)
- Confidence score distribution (histogram)
- Disambiguation rate (% of conversations requiring clarification)
- STT word error rate by audio quality bucket
- QR detection success rate by image quality bucket

**Fraud Dashboard:**
- Risk score distribution (histogram, updated hourly)
- Block rate trend (should be stable; sudden changes indicate model issues)
- Top triggered fraud signals (bar chart)
- Confirmed fraud cases vs. blocked transactions (precision tracking)
- MED claims received vs. proactively blocked

**Business Dashboard (Daily):**
- Daily transaction volume and value
- Conversion funnel: message received → intent extracted → confirmed → authenticated → settled
- Top error reasons for failed payments
- User retention and repeat usage metrics
- Revenue per active user

---

## Logging

### What to Log

| Event Category | Log Level | Data Logged | PII Handling |
|---|---|---|---|
| **Webhook received** | INFO | Message ID, type, timestamp, user phone hash | Phone number hashed; never logged in plaintext |
| **AI extraction result** | INFO | Intent type, confidence, extracted entities (masked) | PIX keys masked; amounts logged; names pseudonymized |
| **Conversation state transition** | INFO | From state, to state, trigger, conversation ID | No PII in state transitions |
| **Payment intent created** | INFO | Intent ID, amount, risk score | Recipient PIX key masked |
| **Fraud assessment** | WARN (if high risk) | Risk score, triggered signals, decision | No PII; only signal names and scores |
| **Payment settlement** | INFO | Transaction ID, endToEndId, status, amount | endToEndId is BCB-generated; no PII |
| **Settlement failure** | ERROR | Transaction ID, error code, SPI response | SPI error codes; no PII |
| **Receipt sent** | INFO | Receipt ID, WhatsApp message ID, delivery status | No PII |
| **Authentication timeout** | WARN | Intent ID, time elapsed | No PII |
| **Circuit breaker state change** | WARN | Service, previous state, new state, trigger count | No PII |
| **Rate limit triggered** | WARN | User hash, limit type, current count | User phone hashed |

### Log Levels Strategy

| Level | Usage | Example |
|---|---|---|
| **ERROR** | System failures requiring immediate attention | SPI settlement failure, database connection loss, webhook signature validation failure |
| **WARN** | Degraded conditions that may become errors | High fraud score, circuit breaker opened, rate limit approaching, auth timeout |
| **INFO** | Normal business events | Message processed, payment settled, receipt delivered, state transitions |
| **DEBUG** | Detailed processing information (production: sampling only) | LLM prompt/response, STT intermediate results, QR detection stages |

### Structured Logging Format

```
{
    "timestamp": "2026-03-10T14:32:07.123Z",
    "level": "INFO",
    "service": "payment-orchestrator",
    "trace_id": "abc123def456",
    "span_id": "span789",
    "conversation_id": "conv-uuid-001",
    "user_hash": "sha256:a1b2c3...",
    "event": "payment.settled",
    "data": {
        "intent_id": "intent-uuid-001",
        "transaction_id": "tx-uuid-001",
        "end_to_end_id": "E12345678901234567890123456789012",
        "amount_brl": 50.00,
        "settlement_latency_ms": 4200,
        "source_modality": "text",
        "extraction_confidence": 0.92,
        "fraud_risk_score": 0.12
    }
}
```

### Log Retention & Compliance

| Log Type | Hot Storage | Warm Storage | Cold Archive | Total Retention |
|---|---|---|---|---|
| Transaction logs | 30 days | 1 year | 4 years | 5 years (BCB) |
| Conversation logs | 7 days | 90 days | 2 years | 2 years |
| Security/audit logs | 90 days | 2 years | 3 years | 5 years |
| AI debug logs | 3 days | 30 days | None | 30 days |
| Infrastructure logs | 7 days | 30 days | None | 30 days |

---

## Distributed Tracing

### Trace Propagation Strategy

Every inbound webhook initiates a trace that follows the message through the entire system:

```
Trace: "wamid.ABC123" (WhatsApp message ID as root span ID)
├── Span: webhook.receive (2ms)
│   ├── Span: dedup.check (1ms)
│   └── Span: queue.produce (3ms)
├── Span: ai.pipeline (1200ms)
│   ├── Span: media.fetch (200ms) [if audio/image]
│   ├── Span: stt.transcribe (800ms) [if audio]
│   ├── Span: cv.detect_qr (300ms) [if image]
│   └── Span: llm.extract_intent (500ms)
├── Span: conversation.state_transition (15ms)
│   ├── Span: state.load (5ms)
│   ├── Span: entity.resolve (8ms)
│   └── Span: state.save (2ms)
├── Span: confirmation.send (100ms)
│   └── Span: whatsapp.api.send (90ms)
│
│   [... user interaction gap ...]
│
├── Span: confirmation.receive (2ms)
├── Span: fraud.score (45ms)
│   ├── Span: dict.lookup_metadata (20ms)
│   └── Span: model.inference (25ms)
├── Span: auth.handoff (50ms)
│   └── Span: token.generate (10ms)
│
│   [... user authentication gap ...]
│
├── Span: settlement.execute (4200ms)
│   ├── Span: spi.submit_pacs008 (100ms)
│   └── Span: spi.await_pacs002 (4100ms)
├── Span: receipt.generate (30ms)
└── Span: receipt.deliver (100ms)
    └── Span: whatsapp.api.send (90ms)
```

### Key Spans to Instrument

| Span | Critical Attributes | Purpose |
|---|---|---|
| `webhook.receive` | message_type, user_hash, dedup_result | Track webhook intake and deduplication |
| `ai.pipeline` | modality, model_version, confidence, extraction_result | Track AI processing performance and accuracy |
| `llm.extract_intent` | model_id, prompt_tokens, completion_tokens, latency_ms | LLM cost and performance monitoring |
| `stt.transcribe` | audio_duration_ms, language, word_error_rate_estimate | STT quality monitoring |
| `cv.detect_qr` | image_size, qr_found, decode_success, scales_tried | CV performance and success rate |
| `entity.resolve` | match_type (exact/fuzzy/disambiguation), candidates_count | Recipient resolution quality |
| `fraud.score` | risk_score, risk_level, signals_triggered, decision | Fraud model monitoring |
| `settlement.execute` | amount, spi_status, settlement_time_ms | Payment performance |
| `receipt.deliver` | template_id, delivery_status, latency_ms | Receipt delivery reliability |

### Cross-Service Correlation

- **Trace ID**: WhatsApp message ID (wamid) for the initiating message; propagated through all services
- **Conversation ID**: Groups all traces within a single payment conversation
- **Intent ID**: Links the AI extraction, fraud assessment, and settlement for a single payment
- **End-to-End ID**: PIX-specific identifier for settlement reconciliation with BCB

---

## Alerting

### Critical Alerts (Page-Worthy — P0)

| Alert | Condition | Response |
|---|---|---|
| `payment.success_rate.critical` | Payment success rate <95% for 5 minutes | Page on-call; investigate SPI connectivity, fraud engine, auth service |
| `webhook.processing.down` | Zero webhooks processed for 2 minutes | Page on-call; check webhook gateway health, WhatsApp API status |
| `settlement.latency.critical` | p99 settlement >30 seconds for 10 minutes | Page on-call; check SPI connectivity, DICT lookup performance |
| `fraud.model.anomaly` | Fraud block rate >5% or <0.05% for 30 minutes | Page on-call + fraud team; model may be malfunctioning |
| `dedup.failure` | Redis dedup cluster unavailable | Page on-call; risk of duplicate payments |
| `database.replication_lag` | Transaction DB replication lag >5 seconds | Page on-call; risk of data loss on failover |
| `security.webhook_signature_failures` | >100 signature validation failures in 1 minute | Page security team; possible webhook forgery attempt |

### Warning Alerts (P1 — Response within 1 hour)

| Alert | Condition | Response |
|---|---|---|
| `ai.intent_accuracy.degraded` | First-attempt accuracy <90% (text) or <85% (voice) for 1 hour | Investigate model performance; check for new slang/patterns |
| `qr.recognition_rate.low` | QR success rate <85% for 1 hour | Check CV model performance; analyze failed images for patterns |
| `gpu.utilization.high` | GPU utilization >85% for 30 minutes | Scale GPU pool; check for inference anomalies |
| `whatsapp.rate_limit.approaching` | Outbound message rate >80% of tier limit | Check for spike cause; prepare priority queue activation |
| `conversation.abandonment.high` | Conversation abandonment rate >40% for 2 hours | Investigate UX issues; check disambiguation and confirmation flows |
| `auth.handoff.timeout_rate.high` | Auth timeout rate >20% for 1 hour | Banking app integration may be failing; check deep link routing |

### Informational Alerts (P2 — Review next business day)

| Alert | Condition | Response |
|---|---|---|
| `storage.growth.above_forecast` | Storage growth >120% of projected rate | Review retention policies; check for unexpected data accumulation |
| `model.drift.detected` | AI model prediction distribution shift detected | Schedule model retraining; analyze new conversation patterns |
| `compliance.data_subject_request.pending` | DSR request approaching 15-day deadline | Prioritize DSR processing |

### Runbook References

| Alert | Runbook |
|---|---|
| Payment success rate critical | `runbooks/payment-success-rate.md` — Check SPI status, verify DICT cache, review fraud engine decisions |
| Webhook processing down | `runbooks/webhook-gateway.md` — Verify WhatsApp API status, check TLS certs, review load balancer health |
| Duplicate payment detected | `runbooks/duplicate-payment.md` — Isolate affected transactions, initiate MED if needed, audit dedup layer |
| GPU pool exhaustion | `runbooks/gpu-scaling.md` — Emergency scale-up procedure, activate model distillation fallback |
| Fraud model anomaly | `runbooks/fraud-model.md` — Rollback to previous model version, manual review queue for blocked transactions |

---

## Conversation Observability (Unique to Conversational Systems)

### Conversation Flow Analytics

Track the full conversation funnel as a first-class metric:

```
Funnel Stage              Count     Drop-off
─────────────────────────────────────────────
Message Received          35.0M     —
Intent Extracted          33.2M     5.1% (unintelligible, non-payment)
Entity Resolved           30.8M     7.2% (ambiguous, no match)
User Confirmed            25.5M     17.2% (abandoned, cancelled)
Fraud Passed              25.3M     0.8% (blocked)
Auth Completed            22.8M     9.9% (timeout, auth failure)
Settled                   22.6M     0.9% (SPI failure)
Receipt Delivered         22.5M     0.4% (send failure)
```

### AI Model Observability

| Metric | Measurement | Purpose |
|---|---|---|
| **Extraction accuracy by field** | (amount_correct, recipient_correct, intent_correct) per 1000 messages | Identify which entity extraction needs improvement |
| **Confidence calibration** | Plotted: predicted confidence vs. actual accuracy | Ensure confidence scores are well-calibrated |
| **Disambiguation rate** | % of conversations requiring disambiguation | Track if entity resolution is improving over time |
| **Modality-specific error rate** | Error rate broken down by text/voice/image | Identify which input modality needs most attention |
| **LLM token usage** | Input/output tokens per extraction | Monitor cost and detect prompt bloat |
| **Model version A/B comparison** | Side-by-side accuracy for canary deployments | Validate model updates before full rollout |

---

## On-Call Playbooks

### Playbook 1: Payment Success Rate Drop

**Trigger:** `payment.success_rate` drops below 98% for 5 consecutive minutes.

```
Step 1: Identify the failure stage
  - Check SPI gateway: is settlement latency elevated?
    → If yes: SPI issue. Check BCB status page. Queue payments with user notification.
  - Check fraud engine: is block rate elevated?
    → If yes: possible model drift. Check recent model deployment. Rollback if deployed < 24h ago.
  - Check auth handoff: is timeout rate elevated?
    → If yes: banking app integration issue. Check deep link routing. Contact banking app team.

Step 2: Determine scope
  - Is failure affecting all users or a specific segment?
  - Is failure correlated with a specific modality (voice, text, QR)?
  - Is failure correlated with a specific PIX key type (CPF, CNPJ, email, phone)?

Step 3: Mitigate
  - If SPI: activate payment queue; send user message "Pagamento em processamento"
  - If fraud model: increase confidence threshold for blocking (reduce false positives)
  - If auth: extend token expiry from 5 min to 15 min as temporary measure

Step 4: Communicate
  - Update status page
  - Notify affected users via WhatsApp template: "Estamos com lentidão..."
```

### Playbook 2: AI Extraction Accuracy Degradation

**Trigger:** `conversation.intent_accuracy` drops below 90% (text) or 85% (voice) for 1 hour.

```
Step 1: Identify the cause
  - Check if a new LLM model version was deployed in last 24 hours
    → If yes: rollback to previous model version
  - Check if STT model was updated (voice accuracy specifically)
    → If yes: rollback STT model
  - Check if a new slang/pattern is trending (e.g., new viral payment phrase)
    → If yes: add examples to prompt; consider emergency fine-tuning

Step 2: Analyze failed extractions
  - Sample 100 recent low-confidence extractions
  - Categorize: amount error, recipient error, intent misclassification, hallucination
  - Identify if failures cluster around a specific input pattern

Step 3: Mitigate
  - Lower confidence threshold for triggering disambiguation (ask user more often)
  - Activate regex fast-path for simple patterns (bypass LLM for "R$X para Y")
  - If voice-specific: temporarily increase confirmation stringency for voice messages
```

### Playbook 3: WhatsApp API Rate Limiting

**Trigger:** Outbound message rate exceeds 80% of tier limit for 10 consecutive minutes.

```
Step 1: Identify the cause
  - Is there an active marketing campaign sending broadcast messages?
    → If yes: pause marketing campaign immediately
  - Is it a salary-day traffic spike?
    → If yes: pre-planned; activate priority queue
  - Is it a viral event (merchant QR code going viral)?
    → If yes: rate-limit per-merchant outbound messages

Step 2: Activate priority queue
  - Priority 1: Payment receipts and settlement confirmations
  - Priority 2: Payment confirmations and deep links
  - Priority 3: Balance queries and informational responses
  - Priority 4: Marketing and promotional messages (pause if needed)

Step 3: Escalate if needed
  - If payment receipts are delayed >30 seconds: contact Meta for temporary tier increase
  - If rate limit is sustained >1 hour: consider tier upgrade request
```

---

## Conversation Debugging Tools

### SLA Burn Rate Monitoring

Track error budget consumption in real-time to predict SLA breaches before they occur:

```
Error Budget Calculation:

Monthly error budget (99.95% availability):
  = 43,200 minutes × 0.05% = 21.6 minutes of allowed downtime

Burn rate = (errors in window / total requests in window) × (window / budget_period)

Alert thresholds:
  1-hour burn rate > 14.4x  → P0 page (will exhaust budget in 1 hour)
  6-hour burn rate > 6x     → P1 alert (will exhaust budget in 6 hours)
  24-hour burn rate > 3x    → P2 alert (will exhaust budget in 24 hours)
  72-hour burn rate > 1x    → P3 inform (on track to breach SLA)
```

**Per-SLO Burn Rate Dashboard:**

| SLO | Monthly Budget | Current Burn Rate | Budget Remaining |
|---|---|---|---|
| Availability (99.95%) | 21.6 min | 0.8x (healthy) | 18.2 min |
| Webhook Latency p99 < 2s | 0.05% of requests | 1.2x (elevated) | 0.03% |
| Payment Success > 99.5% | 0.5% of payments | 0.5x (healthy) | 0.4% |
| Receipt Delivery p95 < 5s | 5% of receipts | 0.3x (healthy) | 4.7% |

### Cost Observability

Track per-transaction cost breakdown to identify optimization opportunities:

| Cost Component | Metric | Target | Alert If |
|---|---|---|---|
| **LLM inference** | Cost per extraction (R$/msg) | R$0.018 | >R$0.025 (model inefficiency) |
| **STT processing** | Cost per voice minute (R$/min) | R$0.12 | >R$0.18 (under-utilized batching) |
| **CV processing** | Cost per image (R$/img) | R$0.03 | >R$0.05 (image quality driving retries) |
| **WhatsApp API** | Cost per conversation (R$/conv) | R$0.08 | >R$0.12 (template window management) |
| **GPU utilization** | Utilization across fleet | >70% | <50% (over-provisioned) or >90% (under-provisioned) |

### Conversation Replay

For investigating user-reported issues, the system provides a conversation replay tool that reconstructs the full payment flow from event logs:

```
Replay output for conversation conv-uuid-001:

[14:30:02] WEBHOOK_RECEIVED  type=text  msg_id=wamid.ABC123
[14:30:02] DEDUP_CHECK        result=NEW
[14:30:02] QUEUED_FOR_AI      queue=ai-pipeline  partition=17
[14:30:03] LLM_EXTRACTION     intent=PAYMENT  amount=50.00  recipient="Maria"
                               confidence=0.92  latency=820ms
[14:30:03] ENTITY_RESOLVED    recipient=Maria Silva  pix_key=maria@email.com
                               match_type=HISTORY  candidates=2
[14:30:03] STATE_TRANSITION   IDLE → CONFIRMATION_PENDING  version=1
[14:30:03] CONFIRMATION_SENT  template=payment_confirmation_v3
[14:30:15] WEBHOOK_RECEIVED   type=button_reply  value=CONFIRM
[14:30:15] STATE_TRANSITION   CONFIRMATION_PENDING → FRAUD_CHECK  version=2
[14:30:15] FRAUD_SCORED       score=0.12  level=LOW  signals=[]
[14:30:15] AUTH_HANDOFF        token_id=tok-xyz  expires_at=14:35:15
[14:30:28] AUTH_CALLBACK       result=SUCCESS  method=BIOMETRIC
[14:30:28] SPI_SUBMITTED       pacs008  e2e_id=E12345...
[14:30:32] SPI_CONFIRMED       pacs002  settlement_time=4200ms
[14:30:32] RECEIPT_GENERATED   receipt_id=rcp-001
[14:30:33] RECEIPT_DELIVERED   whatsapp_msg_id=wamid.DEF456
[14:30:33] STATE_TRANSITION   SETTLING → COMPLETED  version=5
```

---

## AI Observability Standards

This system's AI components MUST implement the observability patterns defined in:
- **[3.25 AI Observability & LLMOps](../3.25-ai-observability-llmops-platform/00-index.md)** — trace model, token accounting, prompt-completion linkage
- **[3.26 AI Model Evaluation & Benchmarking](../3.26-ai-model-evaluation-benchmarking-platform/00-index.md)** — eval taxonomy, regression testing, human review sampling

### Required AI-Specific Metrics
- AI resolution rate (queries handled without human escalation)
- Escalation rate and top escalation reasons
- End-to-end action latency (request to AI-completed action)
- Policy violation attempt rate (actions blocked by guardrails)
- User satisfaction score for AI-handled interactions
