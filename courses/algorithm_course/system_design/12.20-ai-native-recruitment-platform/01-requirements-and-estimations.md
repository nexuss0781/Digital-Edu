# 12.20 AI-Native Recruitment Platform — Requirements & Estimations

## Functional Requirements

| # | Requirement | Notes |
|---|---|---|
| FR-01 | **Multi-source candidate sourcing** — Crawl professional networks, open web, and internal ATS history to discover candidates; deduplicate across sources; respect opt-outs and do-not-contact flags | Produces enriched candidate profile records even before application |
| FR-02 | **Semantic candidate-job matching** — Rank candidates against job requisitions using skills-graph embedding similarity and a learned compatibility model | Match score computed at application and continuously re-ranked as new candidate signals arrive |
| FR-03 | **Conversational recruiting chatbot** — Engage candidates 24/7 over multiple channels (web chat, SMS, email, WhatsApp) for FAQ resolution, initial screening, and interview scheduling | Multi-turn dialogue state persisted across channel switches and time gaps |
| FR-04 | **Adaptive skills assessment** — Administer structured assessments (technical, behavioral, situational) with IRT-driven question difficulty adaptation | Assessment type and length configurable per role and seniority; proctoring integration optional |
| FR-05 | **Asynchronous video interview analysis** — Accept candidate-recorded video responses; extract ASR transcription, NLP coherence scores, domain vocabulary coverage, and speech fluency metrics | No facial expression or emotion scoring; structured competency signal output only |
| FR-06 | **Structured interview guide generation** — Generate role-specific, competency-anchored interview question sets with scoring rubrics for live human interviews | Questions generated from skills graph + role requirements; no direct resume copy |
| FR-07 | **Bias monitoring and adverse impact analysis** — Continuously compute selection rate ratios per demographic group per pipeline stage; alert on 4/5ths-rule violation; provide auditable bias report | Runs per decision batch; supports intersectional category analysis |
| FR-08 | **Candidate notice and consent management** — Provide candidates with pre-AEDT disclosure, opt-out mechanism, and alternative assessment pathway | NYC LL144 and GDPR/CCPA compliance |
| FR-09 | **Talent pool management** — Maintain candidate records across time; support re-engagement campaigns; track candidate opt-in and opt-out states; apply staleness decay to scores | Long-term talent relationship management |
| FR-10 | **Recruiter workflow dashboard** — Surface AI-ranked shortlists, candidate match explanations, assessment summaries, and interview analysis reports to recruiters | Explainability layer required; raw model scores surfaced alongside feature attribution |
| FR-11 | **Hiring manager collaboration** — Allow hiring managers to calibrate role requirements, provide feedback on shortlists, and submit structured interview ratings | Feedback ingested as training signal for compatibility model |
| FR-12 | **Compliance reporting** — Generate annual bias audit report (NYC LL144 format), EEOC EEO-1 selection rate report, and on-demand EU AI Act system documentation | Machine-readable export formats required |
| FR-13 | **Data subject rights fulfillment** — Support GDPR/CCPA right to access, right to erasure, and data portability requests within regulatory deadlines | Erasure must propagate to all subsystems including model training datasets |
| FR-14 | **ATS integration** — Bidirectional integration with external applicant tracking systems (Workday, Greenhouse, Lever, iCIMS) via standardized HR-XML / HRIS APIs | Requisition sync, candidate stage updates, and disposition codes pushed to ATS |

---

## Out of Scope

- **Compensation benchmarking** — Salary range analysis and offer generation (separate total rewards system)
- **Onboarding orchestration** — Post-hire onboarding workflows and document management
- **Background screening** — Third-party background check integration (separate vendor service)
- **Performance management** — Tracking employee performance post-hire (separate HRIS)
- **Internal mobility matching** — Lateral move recommendations for existing employees (separate internal mobility module, though shares skills graph)
- **Facial expression or emotion analysis** — Legally prohibited in growing number of jurisdictions; excluded entirely
- **Salary negotiation automation** — High legal risk; requires human judgment
- **Reference check automation** — Privacy concerns with automated outreach to references

---

## Capacity Estimation: Additional Scenarios

### Scenario 2: High-Volume Retail Hiring

A large retail chain hiring 100,000 seasonal workers across 5,000 store locations in a 6-week window.

```
Volume:
  Applications: 2M over 6 weeks → 48K/day → 560/sec peak
  Active requisitions: 5,000 (one per store location)
  Match operations: 5,000 req × 400 applications = 2M matches over 6 weeks
  Assessment sessions: 500K (25% of applicants complete assessment)
  Video interviews: 0 (not used for hourly roles)
  Conversational AI sessions: 2M (every applicant interacts with chatbot)

Key differences from enterprise tech hiring:
  - Assessment is short-form (10 questions, not 25) → lower IRT precision needed
  - No video interview analysis → reduced GPU requirements
  - Matching model simpler: location + availability + basic skills (not deep skill graph)
  - Bias monitoring still required but batches are large (high statistical power)
  - Conversational AI handles scheduling primarily (less FAQ, more logistics)
```

### Scenario 3: Executive Search (Low-Volume, High-Touch)

A retained executive search firm managing 200 active C-suite searches across Fortune 500 companies.

```
Volume:
  Candidate pool: 50,000 executive profiles (curated, not mass-sourced)
  Active requisitions: 200
  Match operations: 200 × 250 candidates = 50K matches/month
  Assessment sessions: 2,000/month (structured leadership assessment)
  Video interviews: 500/month (recorded panel interviews)
  Conversational AI: minimal (executives prefer email and phone)

Key differences:
  - Matching model trained on executive competency framework (not job-posting corpus)
  - Confidentiality is paramount: candidate identities visible only to assigned recruiters
  - Bias monitoring critical: executive hiring under intense scrutiny for diversity
  - Skills graph focused on leadership competencies, board experience, industry expertise
  - No mass sourcing crawler: profiles curated by research analysts
```

---

## Non-Functional Requirements

### Performance SLOs

| Metric | Target | Rationale |
|---|---|---|
| Candidate matching ranking latency (p99) | ≤ 2 s | Recruiter-facing shortlist must render quickly |
| Conversational AI response latency (p95) | ≤ 800 ms | Chatbot feels unresponsive beyond 1 second |
| Video interview analysis turnaround | ≤ 30 min from submission | Candidate expects feedback within hours |
| Assessment adaptive question selection | ≤ 200 ms per question | Live assessment experience |
| Bias monitoring batch cycle | ≤ 5 min from decision batch close | Alert must precede outreach trigger |
| Sourcing crawler enrichment latency | ≤ 24 h from crawl to indexed candidate | Acceptable for proactive sourcing use case |

### Reliability & Availability

| Metric | Target |
|---|---|
| Platform availability | 99.9% (≤ 43 min downtime/month) |
| Conversational AI availability | 99.95% (24/7 candidate-facing) |
| Video analysis pipeline durability | No submission loss; at-least-once processing |
| Audit log durability | 99.9999999% (9 nines); 7-year retention |

### Scalability

| Metric | Target |
|---|---|
| Active requisitions | 100,000 simultaneous across enterprise customers |
| Candidate profiles in graph | 500M unique profiles |
| Daily candidate matching operations | 10M match computations per day |
| Concurrent conversational sessions | 500,000 simultaneous dialogue sessions |
| Video submissions per day | 500,000 video interview submissions |
| Assessment sessions per day | 1M active assessment sessions |

### Security & Compliance

| Requirement | Specification |
|---|---|
| Demographic data handling | Collected only for bias monitoring; stored separately from matching features with restricted access |
| GDPR erasure | Data subject erasure request fulfilled within 30 days; propagates to model training sets via anonymization |
| NYC LL144 | Annual independent bias audit completed and published before AEDT is used in NYC; candidate notice ≥ 10 business days before AEDT application |
| EU AI Act | High-risk AI system registration; technical documentation; human oversight mechanism; quality management system |
| Model audit trail | Every model prediction logged with model version, input feature hash, and output score; retained 7 years |

---

## Capacity Estimations

### Candidate Profile Volume

**Assumptions:**
- 500M candidate profiles in the graph (combination of sourced and applied)
- 10M new or updated profiles per day (crawl updates + new applications)
- Each profile: ~5 KB structured record + ~2 KB embedding vector (1536-dimensional float32)

```
Profile store size:
  500M × (5 KB + 2 KB) = 3.5 TB structured data + embedding store

Embedding store:
  500M × 1536 × 4 bytes = ~3 TB float32 vectors
  Compressed (int8 quantization, 4x reduction): ~750 GB indexed in vector DB

Daily profile update throughput:
  10M updates/day = ~116 updates/sec (baseline)
  Peak (Monday morning hiring surge): 5x = ~580 updates/sec
```

### Matching Engine

```
Matching operations:
  100,000 active requisitions × 100 new applications/day = 10M match ops/day
  = ~116 match ops/sec baseline; ~580/sec peak

Per match operation:
  Embedding retrieval: ~1 ms (vector DB ANN lookup)
  Compatibility model inference: ~10 ms (dense layer on feature vector)
  Ranking sort (top-K): ~1 ms
  Total per match: ~12 ms → well within 2s p99 SLO at current scale

ANN index maintenance:
  10M profile updates/day → incremental HNSW index update: ~5 ms/update
  Total update throughput: 116 updates/sec × 5 ms = 580 ms/sec → single-threaded Slowest part of the process
  Solution: Batched HNSW rebuild every 15 min; serve stale index during rebuild
```

### Conversational AI

```
500,000 concurrent sessions:
  Average session: 10 turns, 2 min/turn gap → 20 min total session duration
  Turns per second: 500,000 sessions / (2 × 60 sec) = ~4,167 turns/sec

LLM inference cost:
  Intent classification: ~5 ms (distilled model, on-device or small GPU)
  Response generation: ~300 ms (LLM API call)
  Slot filling + calendar lookup: ~200 ms
  Total: ~505 ms → within 800 ms p95 target

GPU fleet for conversational AI:
  4,167 turns/sec × 300 ms LLM latency = 1,250 concurrent LLM inferences
  Per GPU: ~50 concurrent inferences (batch inference)
  GPUs needed: 1,250 / 50 = 25 GPUs for conversational LLM
  With 2x headroom: 50 GPUs
```

### Video Interview Analysis

```
500,000 video submissions/day = ~5.8 videos/sec

Per video (average 10 min):
  ASR transcription: ~2 min processing time (2× faster than real time)
  NLP coherence scoring: ~30 sec (transformer inference on transcript)
  Domain vocabulary extraction: ~10 sec
  Report generation: ~5 sec
  Total: ~2 min 45 sec per video (well within 30-min SLO)

Parallelism needed:
  5.8 videos/sec × 165 sec processing = 957 videos being processed at once
  With 4x surge headroom: 4,000 concurrent video analysis workers

Storage:
  Each video: 200 MB (raw) → stored 90 days, then deleted
  Per day: 500,000 × 200 MB = 100 TB raw video storage (rolling 90-day window)
  Peak rolling window: 100 TB × 90 = 9 PB raw video (heavy lifecycle management needed)
  Transcripts + analysis reports: 500,000 × 50 KB = 25 GB/day → ~9 TB/year (permanent)
```

### Assessment Engine

```
1M active assessment sessions/day = ~11.6 sessions/sec

Per question selection:
  IRT scoring: ~5 ms (logistic model computation)
  Next-item selection (maximum information criterion): ~10 ms (iterate 50-item candidate pool)
  Total: ~15 ms per question → within 200 ms target

Question bank size:
  50,000 calibrated items across all domains and difficulty levels
  Item parameters: 50 bytes each → ~2.5 MB (fits entirely in memory)
```

### Storage Summary

```
Candidate profile store:    ~3.5 TB structured + ~750 GB embeddings → ~4.25 TB
Audit log (7-year):         10M decisions/day × 1 KB = 10 GB/day → ~26 TB/year → ~182 TB at 7 years
Video storage (90-day):     Rolling 9 PB (managed with tiered storage and lifecycle deletion)
Assessment results:         1M × 5 KB = 5 GB/day → ~1.8 TB/year
Conversation logs:          500K sessions × 10 KB = 5 GB/day → ~1.8 TB/year
```

---

## SLO Summary

| SLO | Target | Measurement Window | Error Budget |
|---|---|---|---|
| Matching ranking p99 | ≤ 2 s | Rolling 1-hour | 1% of requests > 2s per hour |
| Conversational AI response p95 | ≤ 800 ms | Rolling 1-hour | 5% of turns > 800ms per hour |
| Video analysis turnaround p95 | ≤ 30 min | Daily | 5% of videos > 30 min per day |
| Bias monitoring cycle time | ≤ 5 min | Per decision batch | Zero tolerance (compliance) |
| GDPR erasure fulfillment | 100% within 30 days | Per request | Zero tolerance (regulatory) |
| NYC LL144 candidate notice | 100% ≥ 10 business days before AEDT use | Per candidate | Zero tolerance (regulatory) |
| Platform availability | 99.9% | Monthly | 43.2 min downtime/month |
| Audit log durability | 99.9999999% | Continuous | Zero tolerance |
| Assessment question delivery p95 | ≤ 200 ms | Per session | 5% of questions > 200ms |
| Bias monitoring gate uptime | 99.99% | Monthly | 4.3 min downtime/month |

---

## Latency Budget Breakdown

### End-to-End Matching Pipeline (target: ≤ 2s p99)

| Phase | Budget | Notes |
|---|---|---|
| API gateway routing + auth | 20 ms | Token validation, tenant lookup |
| Profile embedding retrieval | 10 ms | Cache hit on recent profiles |
| ANN search (10 shards, parallel) | 60 ms | max(shard latency) + merge; HNSW ef=200 |
| Shard result merge + dedup | 5 ms | Top-K merge across 10 result sets |
| Feature construction for re-ranker | 50 ms | Profile fetch + feature engineering |
| Compatibility model inference | 100 ms | Gradient-boosted ranker on ~1,000 candidates |
| SHAP explanation generation | 200 ms | Feature attribution for top-50 candidates |
| Bias batch membership assignment | 10 ms | Append decision to current batch |
| Response serialization + network | 30 ms | JSON serialization + TLS |
| **Total** | **485 ms** | Well within 2s p99 target |
| **Headroom** | **1,515 ms** | Available for cross-region fan-out or degraded conditions |

### Conversational AI Turn (target: ≤ 800ms p95)

| Phase | Budget | Notes |
|---|---|---|
| Channel adapter normalization | 20 ms | SMS/WhatsApp webhook processing |
| Session state load | 30 ms | Distributed key-value store read |
| Intent classification | 50 ms | Distilled NLU model (not full LLM) |
| Slot extraction | 30 ms | Rule-based + NER model |
| Context retrieval (FAQ/job details) | 80 ms | Vector search on knowledge base |
| LLM response generation | 400 ms | Streaming response; first token at 200ms |
| Output safety filter | 30 ms | Compliance content classifier |
| Session state persist | 30 ms | CRDT merge write |
| Channel delivery | 30 ms | SMS API or WebSocket push |
| **Total** | **700 ms** | Within 800ms p95 target |

---

## Read/Write Ratio Analysis

| Workload Type | Read:Write | Dominant Read | Dominant Write |
|---|---|---|---|
| Matching queries | 50:1 | Shortlist retrieval by recruiters | Application submission → profile enrichment |
| Conversational AI | 10:1 | Session state load per turn | Session state update per turn |
| Assessment engine | 5:1 | Item selection per question | Response recording per question |
| Bias monitoring | 20:1 | Decision batch read for analysis | Batch creation at stage transitions |
| Audit log | 1:5 | Audit queries (infrequent) | Every AI decision logged |
| Sourcing crawler | 1:10 | Dedup check per discovered profile | New profile creation |

**Overall weighted ratio: ~15:1 (read-heavy, but write-heavy on audit log and sourcing)**

---

## Hardware Requirements

| Component | CPU | Memory | Storage | GPU | Instance Count |
|---|---|---|---|---|---|
| Candidate API Gateway | 8 cores | 16 GB | 50 GB SSD | — | 6 (3 per region) |
| Profile Store (per shard) | 16 cores | 64 GB | 500 GB SSD | — | 10 shards × 3 replicas |
| ANN Vector Index (per shard) | 16 cores | 128 GB | 200 GB SSD | — | 10 shards × 2 replicas |
| Compatibility Model Serving | 16 cores | 32 GB | 50 GB | 1 GPU (optional) | 6 replicas |
| Conversational AI (LLM) | 8 cores | 32 GB | 50 GB | 1 GPU | 50 GPUs |
| Assessment Engine | 8 cores | 16 GB | 50 GB | — | 10 replicas |
| Video Analysis Workers | 8 cores | 32 GB | 100 GB | 1 GPU | 200 workers (burst to 4,000) |
| Bias Monitor | 4 cores | 8 GB | 20 GB | — | 3 replicas |
| Audit Log Store | 16 cores | 64 GB | 2 TB SSD | — | 3 replicas (3-AZ) |

### Estimated Monthly Cost

| Component | Unit Cost | Quantity | Monthly Cost |
|---|---|---|---|
| Profile store cluster | $800/node | 30 nodes | $24,000 |
| ANN index cluster | $1,200/node | 20 nodes | $24,000 |
| LLM GPU fleet | $3,000/GPU | 50 GPUs | $150,000 |
| Video analysis GPU pool | $1,500/GPU (spot) | 200 avg | $300,000 |
| Object storage (video) | $0.02/GB | 9 PB peak | $180,000 |
| Audit log storage | $0.01/GB (cold) | 26 TB/yr | $260 |
| All other compute | — | — | $50,000 |
| **Total estimated** | | | **~$728K/month** |

**Cost optimization note:** Video analysis GPU pool dominates cost. Shifting 60% of analysis to off-peak spot instances reduces this to ~$120K/month, bringing total to ~$548K/month.
