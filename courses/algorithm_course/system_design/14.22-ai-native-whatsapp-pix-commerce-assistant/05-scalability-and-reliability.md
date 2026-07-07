# Scalability & Reliability — AI-Native WhatsApp+PIX Commerce Assistant

## Scalability

### Horizontal vs. Vertical Scaling

| Component | Scaling Strategy | Rationale |
|---|---|---|
| **Webhook Gateway** | Horizontal (stateless) | Pure HTTP receiver; scale by adding instances behind load balancer |
| **Deduplication Service** | Horizontal with shared Redis | Stateless check against centralized Redis cluster |
| **Text Parser (LLM)** | Horizontal (GPU pool) | Each instance loads model independently; route by availability |
| **Speech-to-Text** | Horizontal (GPU pool) | Independent processing per audio file; no shared state |
| **Computer Vision** | Horizontal (GPU pool) | Independent processing per image; no shared state |
| **Conversation State Machine** | Horizontal with sticky routing | Route by conversation_id hash to maintain cache locality; any node can handle any conversation via shared store |
| **Payment Orchestrator** | Horizontal with distributed lock | Stateless service; exactly-once via lock per user |
| **PIX SPI Gateway** | Vertical (limited by SPI connection pool) | BCB allocates fixed connection capacity per PSP; vertical scaling within allocation |
| **Transaction Ledger DB** | Vertical + read replicas | Write-heavy ACID store; scale reads with replicas; shard by user_id if needed |
| **Message Queue** | Horizontal (partitioned) | Kafka-style partitioning by conversation_id; add partitions for throughput |

### Auto-Scaling Triggers

| Component | Metric | Scale-Up Trigger | Scale-Down Trigger | Min/Max Instances |
|---|---|---|---|---|
| Webhook Gateway | Request rate | >800 req/s per instance | <200 req/s per instance | 4 / 50 |
| LLM Inference | GPU utilization | >70% utilization | <30% utilization | 8 / 40 (GPU) |
| STT Engine | Queue depth | >100 pending audio | <20 pending audio | 4 / 20 (GPU) |
| CV Engine | Queue depth | >50 pending images | <10 pending images | 2 / 15 (GPU) |
| Conversation Engine | CPU utilization | >65% | <25% | 6 / 30 |
| Payment Orchestrator | Active payments | >50 concurrent per instance | <10 concurrent per instance | 4 / 20 |
| Outbound Message Sender | Queue depth | >5,000 pending messages | <500 pending messages | 2 / 10 |

### Database Scaling Strategy

**Conversation Store (Document DB):**
- Hash-sharded by user_id (16 shards initially, expandable to 64)
- Each shard handles ~2M users
- TTL-based auto-expiry for conversations older than 24 hours
- Read replicas for analytics queries (not on the payment path)

**Transaction Ledger (Relational DB):**
- Partitioned by `settled_at` (monthly partitions)
- Primary for writes; 2 synchronous replicas for durability
- Read replicas for balance queries and transaction history
- Archive partitions older than 12 months to cold storage; retain metadata in hot tier for 5 years

**DICT Cache (In-Memory Store):**
- Redis Cluster with 6 nodes (3 primary, 3 replica)
- Keyspace: ~50M PIX keys cached (most frequently used subset of DICT)
- Memory: ~50GB (1KB per key entry including metadata)
- Background refresh from BCB DICT feed every 15 minutes
- On cache miss: synchronous DICT query (30-50ms) with result cached

### Caching Layers

| Layer | Technology | Data | Hit Rate | Latency |
|---|---|---|---|---|
| **L1 (in-process)** | Local LRU cache | Active conversation state | ~60% | <1ms |
| **L2 (distributed)** | Redis Cluster | Conversation state, user profiles, dedup keys | ~85% | 2-5ms |
| **DICT cache** | Dedicated Redis | PIX key → account mappings + fraud metadata | ~92% | 2ms |
| **Template cache** | In-process | WhatsApp message templates | ~99% | <0.1ms |
| **Model cache** | GPU memory | Loaded AI model weights | ~100% | N/A (resident) |

### Hot Spot Mitigation

| Hot Spot | Cause | Mitigation |
|---|---|---|
| **Salary-day surge** | 5th, 15th, 30th of month: 3-5x traffic | Pre-scale 12 hours before; priority queue management |
| **Viral merchant** | Single merchant generates thousands of QR code scans | Rate limit per merchant; cache merchant QR metadata |
| **Celebrity endorsement** | Sudden onboarding spike | Auto-scale webhook gateway; graceful onboarding queue |
| **Single user spam** | Bot or misbehaving client sends thousands of messages | Per-user rate limit (50 messages/hour); progressive throttling |
| **DICT hot key** | Popular merchant PIX key queried thousands of times | Local cache with 15-minute TTL; pre-warm popular keys |

---

## Reliability & Fault Tolerance

### Single Points of Failure (SPOF) Analysis

| Component | SPOF Risk | Mitigation |
|---|---|---|
| **WhatsApp Cloud API** | External dependency; if Meta's API is down, no messages in or out | Cannot mitigate; this is the channel. Graceful degradation: notify users via push notification to use the banking app directly |
| **Redis dedup cluster** | If dedup fails, duplicates pass through | Multi-node Redis Cluster with auto-failover; Layer 3 (DB) catches duplicates |
| **PIX SPI connection** | BCB SPI downtime prevents all settlements | Extremely rare (PIX operates 24/7); queue payments with user notification; PIX SPI has <5 minutes annual downtime historically |
| **LLM inference cluster** | GPU failure disables text understanding | Multi-node GPU pool; fallback to regex extraction for simple patterns |
| **Transaction DB primary** | Write path blocked | Synchronous replication with automatic failover; RPO=0 for financial data |

### Redundancy Strategy

| Component | Redundancy | Failover Time |
|---|---|---|
| Webhook Gateway | N+2 instances across 3 availability zones | Instant (load balancer routes around failures) |
| Redis Cluster | 3 primary + 3 replica nodes, cross-AZ | <30 seconds (automatic sentinel failover) |
| Transaction DB | 1 primary + 2 synchronous replicas, cross-AZ | <60 seconds (automatic failover with RPO=0) |
| Conversation DB | 3 replicas per shard, cross-AZ | <30 seconds |
| GPU Pool (LLM) | N+4 GPU nodes (tolerate loss of 4 simultaneously) | Immediate (requests routed to available GPUs) |
| GPU Pool (STT/CV) | N+2 GPU nodes each | Immediate |
| Message Queue | 3x replication factor per partition | <10 seconds (ISR failover) |

### Failover Mechanisms

**Webhook Gateway Failover:**
- Load balancer health checks every 5 seconds
- Unhealthy instance removed from pool within 10 seconds
- Webhook retries from WhatsApp (up to 7 attempts over 24 hours) provide inherent retry

**AI Pipeline Failover:**

```
FUNCTION process_with_fallback(message, modality):
    TRY with timeout(SLA_TIMEOUT[modality]):
        RETURN primary_pipeline(message, modality)
    CATCH TimeoutError:
        metrics.increment("ai.timeout", modality=modality)
        RETURN fallback_pipeline(message, modality)
    CATCH ServiceUnavailable:
        metrics.increment("ai.unavailable", modality=modality)
        RETURN fallback_pipeline(message, modality)

FUNCTION fallback_pipeline(message, modality):
    SWITCH modality:
        CASE TEXT:
            // Regex-based extraction for common patterns
            RETURN regex_extract(message.text)
        CASE AUDIO:
            // Ask user to type instead
            send_message(message.from, "Processamento de áudio indisponível. Por favor, digite sua solicitação.")
            RETURN null
        CASE IMAGE:
            // Ask user to enter details manually
            send_message(message.from, "Processamento de imagem indisponível. Por favor, insira a chave PIX manualmente.")
            RETURN null
```

### Circuit Breaker Patterns

| Service | Failure Threshold | Open Duration | Half-Open Strategy |
|---|---|---|---|
| LLM Inference | 5 failures in 10 seconds | 30 seconds | Allow 1 request; if success, close |
| STT Engine | 3 failures in 10 seconds | 30 seconds | Allow 1 request |
| CV Engine | 3 failures in 10 seconds | 30 seconds | Allow 1 request |
| WhatsApp Send API | 10 failures in 5 seconds | 15 seconds | Allow 3 requests (batch) |
| DICT Query | 5 failures in 10 seconds | 60 seconds | Allow 1 request; use stale cache during open |
| SPI Gateway | 2 failures in 30 seconds | 120 seconds | Allow 1 small-value transaction as probe |

### Retry Strategies

| Operation | Strategy | Max Retries | Backoff |
|---|---|---|---|
| Webhook processing | Rely on WhatsApp retries (7 attempts over 24h) | N/A | WhatsApp-managed |
| AI inference | Immediate retry on transient error | 2 | 100ms, 500ms |
| DICT lookup | Immediate retry with cache fallback | 1 | 200ms, then use stale cache |
| SPI submission | Exponential backoff (financial operation) | 3 | 1s, 5s, 15s |
| WhatsApp message send | Exponential backoff with jitter | 5 | 200ms, 500ms, 1s, 2s, 5s |
| Receipt generation | Async retry via dead-letter queue | 10 | 1s, 5s, 30s, 1m, 5m... |

### Graceful Degradation

| Degradation Level | Trigger | Behavior |
|---|---|---|
| **Level 0 (Normal)** | All systems healthy | Full multimodal processing, all features active |
| **Level 1 (AI Degraded)** | LLM or STT unavailable | Regex extraction for text; voice messages deferred; QR still works |
| **Level 2 (Partial Outage)** | Multiple AI services down | Text-only with regex; explicit structured input prompts ("Envie: PIX R$[valor] para [chave]") |
| **Level 3 (Payment Only)** | Conversation engine degraded | Direct payment links without conversational interface; banking app deep links |
| **Level 4 (Read Only)** | Payment execution unavailable | Balance queries and transaction history only; payment requests queued |
| **Level 5 (Offline)** | WhatsApp API unreachable | Push notification to users: "Use o app do banco diretamente" |

### Bulkhead Pattern

| Bulkhead | Isolated Resources | Purpose |
|---|---|---|
| **Payment processing** | Dedicated thread pool (200 threads), separate connection pool to DB | Payment transactions never starved by AI processing load |
| **Voice processing** | Dedicated GPU allocation (40% of GPU pool) | STT workload doesn't compete with LLM inference |
| **Outbound messaging** | Separate rate limiter per message priority | Receipt messages never delayed by marketing messages |
| **Per-user processing** | Max 5 concurrent messages per user | Misbehaving client can't exhaust system resources |

---

## Disaster Recovery

### RTO / RPO Targets

| Component | RTO | RPO | Justification |
|---|---|---|---|
| **Payment execution path** | 5 minutes | 0 (zero data loss) | Financial transactions are irrevocable; cannot lose settlement records |
| **Conversation engine** | 15 minutes | 5 minutes | Conversations can be re-initiated; small data loss acceptable |
| **AI pipeline** | 30 minutes | N/A (stateless) | Models reloaded from registry; no persistent state to recover |
| **Analytics & reporting** | 4 hours | 1 hour | Non-critical path; batch processes can re-run |

### Backup Strategy

| Data | Backup Type | Frequency | Retention | Location |
|---|---|---|---|---|
| Transaction ledger | Continuous WAL replication + daily snapshots | Continuous + daily | 5 years | Cross-region object storage |
| Conversation store | Daily snapshots | Every 6 hours | 90 days | Same region, different AZ |
| User profiles | Daily snapshots | Daily | 2 years | Cross-region |
| Audit logs | Append-only with daily integrity verification | Continuous | 5 years | Cross-region, immutable storage |
| AI models | Version-controlled in model registry | On each training run | All versions retained | Cross-region object storage |
| Configuration | Version-controlled in Git | On each change | Indefinite | Git repository |

### Multi-Region Considerations

Brazil-specific constraints:
- **Data sovereignty**: LGPD requires personal data of Brazilian citizens to be stored in Brazil or in countries with adequate data protection laws
- **SPI connectivity**: PIX SPI is accessible only from within the RSFN (national financial network); the primary data center must be in Brazil
- **Latency**: Users are concentrated in Southeast Brazil (São Paulo, Rio de Janeiro); primary region should be São Paulo
- **DR region**: Secondary region in another Brazilian city (e.g., Brasilia or Campinas) for regulatory compliance

**Active-Passive DR:**
- Primary: São Paulo data center (all traffic)
- Secondary: Brasilia data center (warm standby, receives replicated data)
- Failover trigger: >5 minutes of primary unavailability detected by external health checks
- Failover time: ~15 minutes (DNS switch + warm instance scaling)
- Failback: Manual, after verification of data consistency between regions

---

## Capacity Planning by Year

### Compute Scaling Trajectory

| Resource | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| **Webhook gateway instances** | 10 | 30 | 60 |
| **LLM inference (GPU)** | 8 GPUs | 30 GPUs | 60 GPUs |
| **STT processing (GPU)** | 4 GPUs | 15 GPUs | 30 GPUs |
| **CV/OCR processing (GPU)** | 2 GPUs | 10 GPUs | 20 GPUs |
| **Conversation engine (CPU)** | 10 cores | 30 cores | 60 cores |
| **Payment orchestrator (CPU)** | 8 cores | 20 cores | 40 cores |
| **Total sustained GPU** | 14 | 55 | 110 |
| **Peak GPU (salary day)** | 42 (3x) | 165 (3x) | 330 (3x) |

### Storage Growth Trajectory

| Data Type | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| **Transaction ledger** | 3 TB | 15 TB | 40 TB |
| **Conversation logs** | 2 TB | 10 TB | 25 TB |
| **Audit logs** | 1 TB | 5 TB | 15 TB |
| **AI model artifacts** | 50 GB | 200 GB | 500 GB |
| **Total hot storage** | 6 TB | 30 TB | 80 TB |
| **Total (hot + cold)** | 8 TB | 50 TB | 150 TB |

### Cost Scaling

| Cost Category | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| **WhatsApp API (messages)** | R$2M | R$8.4M | R$15M |
| **AI inference (GPU)** | R$3M | R$9.6M | R$18M |
| **Compute (services)** | R$1.5M | R$3.6M | R$7M |
| **Storage + DB** | R$0.5M | R$1.5M | R$3M |
| **PIX integration** | R$0.5M | R$1.2M | R$2M |
| **Total annual** | R$7.5M | R$24.3M | R$45M |
| **Cost per payment** | R$1.25 | R$0.67 | R$0.45 |

---

## Cost Optimization Strategies

### AI Inference Cost Reduction

1. **Tiered extraction (saves 40% GPU cost)**: Route simple patterns ("R$50 para Maria") through regex/Practical rule of thumb engine (10ms, CPU-only); reserve GPU for complex/ambiguous inputs. At 40% simple-pattern rate, this eliminates 8.4M daily LLM calls.

2. **Model distillation (saves 60% per-call cost)**: Train a 3B-parameter task-specific model for payment intent extraction, replacing the 13B+ general-purpose LLM for routine extractions. The distilled model runs on 1 GPU vs 4 GPUs for the full model, with <2% accuracy loss on the payment domain.

3. **Batched inference (saves 20% throughput cost)**: Group messages arriving within a 50ms window into batches of 8-16 for GPU processing. Trades 50ms latency for 3-5x throughput per GPU, reducing total GPU count needed at peak.

4. **Speculative execution**: While LLM processes, optimistically resolve recipient and pre-check fraud signals in parallel. If the LLM extraction matches the Practical rule of thumb pre-guess (40% of cases), downstream work is already complete, reducing end-to-end latency.

### WhatsApp API Cost Reduction

1. **Conversation window optimization**: Keep interactions within the 24-hour free window; avoid triggering new template-message conversations (R$0.02-0.08 each) by ensuring receipts and follow-ups happen within the existing window.

2. **Rich interactive messages**: Combine confirmation + deep link into a single interactive message instead of two separate messages (50% message cost reduction per payment flow).

3. **SMS receipt alternative**: For users who consent, send receipt via SMS (R$0.01) instead of WhatsApp template message (R$0.02-0.08) for post-window notifications.

---

## Salary-Day Surge Management

### The Problem

On salary days (5th, 15th, and 30th of each month), payment volume spikes 3-5x as Brazilians receive wages and immediately pay bills, transfer money, and make purchases. This creates correlated demand across all system components simultaneously.

### Preparation Timeline

```
T-24h: Salary day prediction confirmed
  - Pre-scale GPU pool to 3x normal capacity
  - Pre-warm DICT cache with popular PIX keys
  - Verify WhatsApp API tier (request temporary increase if needed)
  - Reduce marketing message volume to reserve outbound capacity

T-6h: Final capacity check
  - Verify all auto-scaling groups have headroom
  - Ensure Redis cluster has <60% memory utilization
  - Pre-stage additional conversation engine instances

T-0: Salary day begins
  - Auto-scaling responds to rising load
  - Priority queue activated: payment messages > all others
  - Marketing campaigns paused until volume normalizes
  - On-call team on standby

T+4h: Peak subsides
  - Gradual scale-down begins
  - Marketing campaigns resume
  - Post-mortem data collection starts
```

### Capacity Math for Salary Day Peak

```
Normal day:
  Messages: 35M/day = 405 QPS avg
  Payments: 3M/day = 35 QPS avg

Salary day (3x):
  Messages: 105M/day = 1,215 QPS avg, 3,600 QPS peak
  Payments: 9M/day = 105 QPS avg, 315 QPS peak

GPU requirement (salary day peak):
  LLM: 3,600 QPS × 60% text × 0.8s avg = ~1,728 concurrent inferences
  At 4 concurrent per GPU = 432 GPUs needed at absolute peak
  With tiered extraction (40% bypass): 260 GPUs needed
  With batching (3x efficiency): ~87 GPUs needed
```

---

## Chaos Engineering Scenarios

### Quarterly Resilience Tests

| Scenario | What It Tests | Expected Outcome |
|---|---|---|
| **LLM inference cluster failure** | AI pipeline fallback to regex extraction | Simple patterns still process (40% of traffic); complex messages get "please type your request more simply" response; no payment failures |
| **Redis dedup cluster failure** | Three-layer dedup resilience | Layer 1 (Redis) fails; Layer 2 (distributed lock) and Layer 3 (DB unique constraint) prevent duplicate payments; alert fires for dedup degradation |
| **WhatsApp API rate limit hit** | Priority queue behavior | Payment receipts and confirmations continue; marketing and informational messages queued; no payment UX degradation |
| **SPI settlement latency spike** | Settlement timeout handling | Users see "processing" status; conversation transitions to UNCERTAIN after 30s; corrective message sent when settlement confirms; no duplicate submissions |
| **Conversation DB primary failover** | Database resilience | Automatic failover to replica within 60 seconds; in-flight conversations resume from last persisted state; < 1% conversation loss |
| **Voice processing complete outage** | STT unavailability handling | Voice messages get "please type your request" response; text and QR processing continue normally; no payment failures |

### Resilience Metrics

| Metric | Target | Measurement |
|---|---|---|
| **Time to detect failure** | < 30 seconds | Automated health checks + alerting |
| **Time to activate fallback** | < 5 seconds | Circuit breaker opens automatically |
| **Payment success rate during degraded mode** | > 95% (vs. 99.5% normal) | Regex extraction handles simple patterns |
| **Recovery time from component failure** | < 5 minutes | Auto-scaling + circuit breaker half-open |
| **Zero duplicate payments during failure** | 100% | Three-layer dedup guarantee |

---

## Load Testing Strategy

### Test Profiles

| Profile | Volume | Duration | Purpose |
|---|---|---|---|
| **Baseline** | Normal day (405 QPS) | 4 hours | Validate steady-state performance |
| **Salary day** | 3x normal (1,215 QPS) | 2 hours | Validate peak handling |
| **Black Friday** | 5x normal (2,025 QPS) | 30 minutes | Stress test auto-scaling |
| **Spike** | 10x normal (4,050 QPS) for 5 min | 5 minutes | Validate burst handling and queue depth |
| **Endurance** | 2x normal | 24 hours | Detect memory leaks, connection exhaustion |

### Modality Distribution in Load Tests

| Modality | Normal Distribution | Salary Day | Black Friday |
|---|---|---|---|
| **Text** | 60% | 70% (more quick payments) | 50% |
| **Voice** | 25% | 15% (less time for voice) | 20% |
| **Image/QR** | 15% | 15% | 30% (merchant QR codes) |

### Key Test Assertions

| Assertion | Threshold | Consequence of Failure |
|---|---|---|
| Zero duplicate payments under load | 0 duplicates in any test profile | Block release; dedup layer requires fix |
| Payment success rate at 3x load | > 98% | Investigate Slowest part of the process; may need GPU pre-scaling |
| Webhook acknowledgment at 5x load | p99 < 5s | Scale webhook gateway; adjust queue configuration |
| Receipt delivery at 3x load | p95 < 10s | Priority queue may need tuning; check WhatsApp tier |
| AI extraction accuracy under load | > 92% (text) at peak | Model may need batching optimization; check for timeout-induced degradation |

---

## Geographic Scaling Considerations

### Brazil-Specific Infrastructure Challenges

| Challenge | Impact | Mitigation |
|---|---|---|
| **Single-region concentration** | 70%+ of PIX traffic originates from São Paulo/Southeast; but RSFN connectivity requires geographic proximity to BCB data centers | Primary region in São Paulo with active-passive DR in Rio de Janeiro; GPU pools pre-warmed in both regions |
| **Salary-day regional variance** | Federal, state, and municipal employees are paid on different schedules; salary-day surges vary by region | Per-region capacity models based on employment distribution; federal salary days (5th) hit nationally; municipal varies by state |
| **Network latency to DICT/SPI** | RSFN is a private network; latency depends on physical proximity to BCB's RSFN access points | Co-locate primary compute with RSFN access points; cache DICT aggressively to minimize cross-network round trips |
| **Data residency** | LGPD requires personal data processed within Brazil; no cross-border data transfer without explicit consent | All infrastructure provisioned within Brazil; no foreign cloud region spillover; GPU inference must remain in-country |

### Scaling Milestones

| Users | Key Infrastructure Change | Trigger |
|---|---|---|
| 1M → 5M | Single-region, basic auto-scaling | Launch |
| 5M → 15M | Add DR region; implement model distillation | GPU cost exceeds R$200K/month |
| 15M → 30M | Multi-LLM routing (CADE); DICT full-cache | CADE compliance deadline |
| 30M → 60M | Dedicated GPU clusters per modality; database sharding | p95 latency SLA pressure |
| 60M → 100M | Regional compute distribution; edge inference for regex | National scale requires sub-50ms edge extraction |

---

## Disaster Recovery Runbook

### DR Scenario: Primary Data Center Failure

```
Detection: External health checks report primary unreachable for > 5 minutes

Step 1 (T+5min): Activate DR
  - DNS failover to secondary (Brasilia) data center
  - Warm standby instances begin accepting traffic
  - Transaction DB replica promoted to primary

Step 2 (T+10min): Validate
  - Verify webhook processing resumed
  - Verify SPI connectivity from secondary (RSFN connection)
  - Verify Redis cluster reachable (cross-region replica)

Step 3 (T+15min): Communicate
  - Internal status page updated
  - WhatsApp template: "Estamos restaurando o serviço..."
  - Monitor error rates for first 30 minutes

Step 4 (T+4h): Assess
  - Determine if primary can be recovered
  - If not: plan extended secondary operation
  - Verify data consistency between regions

Data Loss Assessment:
  - Transaction DB (RPO=0): zero data loss (synchronous replication)
  - Conversation state (RPO=5min): up to 5 minutes of active conversations lost
  - AI pipeline (RPO=N/A): stateless; models reloaded from registry
```

## AI Release Ladder

Every AI model or capability change in this system MUST follow this rollout sequence:

| Stage | Description | Gate Criteria |
|-------|-------------|---------------|
| 1. Offline Evaluation | Benchmark against historical ground truth | Meets baseline metrics |
| 2. Shadow Mode | Run in parallel with production, compare outputs | No regression on key metrics |
| 3. Canary (Blast-Radius Capped) | 1-5% traffic, human review of all outputs | Error rate < threshold |
| 4. Human-Reviewed Production | AI recommends, human approves all actions | Approval rate > 90% |
| 5. Limited Autonomous Production | AI acts within pre-approved boundaries | Continuous monitoring, no alerts |
| 6. Instant Rollback | One-click revert to previous model/rules | < 5 min rollback time |

**Note:** AI capabilities that directly interact with end users or execute actions on their behalf must reach Stage 4 (human-reviewed production) with domain-expert sign-off before deployment. Stage 5 limited autonomy applies only to well-bounded, low-risk action categories with established rollback procedures.
