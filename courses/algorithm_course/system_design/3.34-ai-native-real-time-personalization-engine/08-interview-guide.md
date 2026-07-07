# Interview Guide

## Interview Pacing (45-Minute Format)

| Time | Phase | Focus | Key Actions |
|------|-------|-------|-------------|
| 0-5 min | **Clarify** | Understand scope | Ask questions, establish constraints |
| 5-15 min | **High-Level Design** | Architecture | Draw three-tier system, explain data flow |
| 15-30 min | **Deep Dive** | Critical components | Focus on streaming embeddings OR bandits OR LLM |
| 30-40 min | **Scale & Trade-offs** | Production concerns | Discuss bottlenecks, failure scenarios |
| 40-45 min | **Wrap Up** | Summary | Recap key decisions, handle follow-ups |

---

## Phase 1: Clarify (0-5 minutes)

### Questions to Ask the Interviewer

**Scope Questions:**
1. "What's the expected scale? Users, items, QPS?"
2. "What content types? Text only, or multi-modal (images, video)?"
3. "What's the latency requirement? Sub-50ms or more relaxed?"
4. "Do we need real-time adaptation (session-level) or is batch OK?"
5. "Is explainability required? 'Why this recommendation?'"

**Constraints Questions:**
1. "What's the cold start scenario? Frequent new users/items?"
2. "Privacy constraints? GDPR, on-device preferences?"
3. "Existing infrastructure? Can we assume streaming (Kafka), etc.?"
4. "Budget constraints? Can we use LLMs, or cost-sensitive?"

### Establishing Scope

```
"Based on what you've described, I'll design for:
- 100M users, 10M items, 500K QPS
- Multi-modal content (text, images, video)
- <50ms latency at edge, <100ms at origin
- Real-time session adaptation with streaming embeddings
- Thompson Sampling for exploration
- Optional LLM for explanations and cold start

Does this match your expectations, or should I adjust?"
```

---

## Phase 2: High-Level Design (5-15 minutes)

### Key Points to Cover

1. **Three-Tier Architecture**
   - Edge Layer: Personalized cache + lightweight scoring
   - Streaming Layer: Real-time embedding updates
   - Origin Layer: Deep ranking + bandits + LLM reasoning

2. **Data Flow**
   - Request path: Client → Edge (cache) → Origin (if miss)
   - Event path: Client → Kafka → Stream processor → Vector DB

3. **Core Components**
   - Streaming Embedding Service
   - Contextual Bandit Engine
   - LLM Reasoning Layer (optional path)
   - Multi-Modal Encoder

### Architecture Sketch

```
Draw this on the whiteboard:

┌─────────────────────────────────────────────────────────┐
│                     CLIENTS                              │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│  EDGE LAYER (CDN, 200+ PoPs)                            │
│  ┌─────────┐ ┌─────────────┐ ┌───────────┐              │
│  │ Cache   │ │ ONNX Scorer │ │Edge Bandit│              │
│  └─────────┘ └─────────────┘ └───────────┘              │
└──────────────────────┬──────────────────────────────────┘
                       │ cache miss
┌──────────────────────▼──────────────────────────────────┐
│  STREAMING LAYER                                         │
│  ┌─────────┐ ┌────────────────┐ ┌─────────────┐         │
│  │ Kafka   │→│Stream Processor│→│Vector DB    │         │
│  └─────────┘ └────────────────┘ └─────────────┘         │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│  ORIGIN LAYER                                            │
│  ┌───────────┐ ┌─────────┐ ┌──────┐ ┌─────────┐         │
│  │Orchestrator│→│Retrieval│→│Ranker│→│Bandit   │         │
│  └───────────┘ └─────────┘ └──────┘ └─────────┘         │
│        │                                                 │
│        └──────────────────────────────┐                  │
│                              ┌────────▼───────┐          │
│                              │ LLM (optional) │          │
│                              └────────────────┘          │
└─────────────────────────────────────────────────────────┘
```

### Key Decisions to Explain

| Decision | Choice | One-Sentence Justification |
|----------|--------|---------------------------|
| Architecture | Three-tier | Edge for latency, streaming for freshness, origin for complexity |
| Embeddings | Streaming | User intent changes within sessions, batch is too stale |
| Exploration | Thompson Sampling | Bayesian approach naturally balances explore/exploit |
| LLM | Selective invocation | Too slow/expensive for all requests, use for cold start and explanations |

---

## Phase 3: Deep Dive (15-30 minutes)

### Option A: Streaming Embeddings (Recommended for ML-focused interviews)

**What to Cover:**
1. **Problem**: Batch embeddings (daily) miss session-level intent shifts
2. **Solution**: Incremental embedding updates on every interaction
3. **Algorithm**: Momentum-based update (show Step-by-step plan in plain English)
4. **Trade-offs**: Freshness vs compute cost, consistency vs availability

**Key Step-by-step plan in plain English:**
```
ON interaction(user, item, action):
  current_emb = get_embedding(user)
  item_emb = get_embedding(item)

  weight = action_weights[action]  // purchase=1.0, click=0.3
  decay = exp(-hours_since / 24)
  direction = item_emb - current_emb

  update = learning_rate * weight * decay * direction
  new_emb = normalize(current_emb + update)

  write_to_vector_db(user, new_emb)
```

**Performance Numbers to Mention:**
- End-to-end latency: <60 seconds
- Throughput: 50K events/sec
- Memory per user: ~3KB

### Option B: Thompson Sampling (Recommended for systems interviews)

**What to Cover:**
1. **Problem**: Pure exploitation creates filter bubbles, pure exploration hurts UX
2. **Solution**: Thompson Sampling - sample from posterior, probability matching
3. **Algorithm**: Beta distribution sampling with contextual features
4. **Trade-offs**: Exploration rate vs regret, complexity vs interpretability

**Key Step-by-step plan in plain English:**
```
FOR each candidate item:
  alpha, beta = get_bandit_params(item, context)
  sampled = Beta.sample(alpha, beta)
  context_adjustment = sigmoid(dot(weights, context_features))
  final_score = base_score * (1-ε) + sampled * ε

ON reward observed:
  alpha += reward
  beta += (1 - reward)
```

**Performance Numbers to Mention:**
- Cumulative regret: <10% of optimal
- Exploration rate: 5-15%
- Update latency: <10ms

### Option C: LLM Integration (Recommended for AI/ML interviews)

**What to Cover:**
1. **Problem**: Complex personalization needs reasoning; cold start needs content understanding
2. **Solution**: Selective LLM invocation with RAG for context
3. **When to invoke**: Cold start, low confidence, explainability requested
4. **Trade-offs**: Latency (100-200ms), cost ($0.003/request), fallback handling

**Key Points:**
- LLM is NOT in the critical path for most requests
- Use caching (40% hit rate at segment level)
- Have template-based fallback for degraded mode

---

## Phase 4: Scale & Trade-offs (30-40 minutes)

### Scalability Discussion

**Edge Scaling:**
- "Edge workers auto-scale based on latency p95 > 40ms"
- "We target 80%+ cache hit rate to reduce origin load"

**Streaming Scaling:**
- "Flink scales based on consumer lag"
- "State checkpointing enables fast recovery"

**GPU Scaling:**
- "Ranking GPUs are pre-provisioned (slow startup)"
- "LLM GPUs use queue-based admission control"

### Failure Scenarios

**"What if the embedding pipeline fails?"**
```
Graceful degradation:
1. Edge continues serving cached results
2. Origin uses batch (daily) embeddings as fallback
3. Alert on-call, fix pipeline
4. No user-facing error, just stale personalization
```

**"What if LLM is unavailable?"**
```
1. Circuit breaker opens after 3 failures
2. Switch to template-based explanations
3. Set llm_generated=false in response
4. User experience degraded but functional
```

**"What if a region goes down?"**
```
1. GeoDNS detects health check failure
2. Traffic routes to next-nearest region
3. Active-active data replication ensures data available
4. RTO < 15 minutes
```

### Trade-off Discussions

| Trade-off | Option A | Option B | Recommendation |
|-----------|----------|----------|----------------|
| **Freshness vs Cost** | Real-time (<60s) | Batch (daily) | Real-time for active users, batch for inactive |
| **Personalization vs Privacy** | Full tracking | Cohort-based | Consent-based, offer opt-out |
| **Edge vs Origin** | Edge-first | Origin-first | Edge-first with origin fallback |
| **LLM vs Heuristics** | Always LLM | Never LLM | Selective (5-10% of requests) |

---

## Phase 5: Wrap Up (40-45 minutes)

### Summary Points

```
"To summarize, I've designed a three-tier personalization engine:

1. EDGE (5-20ms): Serves 80% of requests from personalized cache
   with lightweight ONNX scoring and edge bandit exploration

2. STREAMING (<60s): Updates embeddings in real-time using
   momentum-based incremental updates on Flink

3. ORIGIN (<100ms): Handles complex requests with deep ranking,
   Thompson Sampling, and optional LLM reasoning

Key trade-offs:
- Streaming embeddings vs batch: Chose streaming for freshness
- Thompson Sampling vs epsilon-greedy: Chose Thompson for principled exploration
- LLM always vs selective: Chose selective for cost/latency balance

The system scales to 500K QPS, 100M users, with 99.99% availability."
```

---

## Trap Questions & Best Answers

### Trap 1: "Why not just use LLM for all personalization?"

**What they're testing:** Understanding of latency/cost trade-offs

**Best answer:**
"LLM inference takes 100-200ms and costs ~$0.003 per request. At 500K QPS, that's:
- Latency: Would exceed our 50ms edge target
- Cost: $0.003 × 500K × 86,400 = $130M/year just for LLM

Instead, we use LLM selectively (5-10% of requests) for cold start and explanations, while embeddings and bandits handle the common case at sub-10ms latency."

### Trap 2: "Why not use epsilon-greedy instead of Thompson Sampling?"

**What they're testing:** Understanding of bandit algorithms

**Best answer:**
"Epsilon-greedy with ε=0.1 explores randomly 10% of the time, regardless of what we've learned. This has linear regret.

Thompson Sampling has logarithmic regret because it explores proportionally to uncertainty. When we're confident about an item, we rarely explore it. When uncertain, we explore more. This is more sample-efficient and leads to better long-term reward."

### Trap 3: "What if streaming embeddings drift over time?"

**What they're testing:** Understanding of ML systems challenges

**Best answer:**
"Great question. Drift can occur for several reasons:

1. **Individual drift**: Addressed by time decay in update algorithm
2. **Population drift**: Monitored via embedding drift metrics (cosine distance from baseline)
3. **Model drift**: Periodic batch retraining to recalibrate

We set alerts on drift > 0.2 and trigger investigation. If systematic, we schedule off-hours batch retraining to reset embeddings."

### Trap 4: "How do you handle cold start for new users?"

**What they're testing:** Completeness of design thinking

**Best answer:**
"Cold start has three tiers of fallback:

1. **Content-based**: Use item embeddings from what they're viewing to infer preferences immediately
2. **Cohort-based**: Use device type, geo, time to assign to a user segment with known preferences
3. **LLM reasoning**: For truly cold users, invoke LLM with RAG to reason about first few interactions

The streaming embedding pipeline means users get personalized within 60 seconds of their first interaction, much faster than batch systems."

### Trap 5: "Why three tiers? Isn't that over-engineered?"

**What they're testing:** Justification of complexity

**Best answer:**
"Each tier solves a specific latency/capability trade-off:

1. **Edge (5-20ms)**: Required for <50ms latency target. CDN is the only way to serve globally at this latency.

2. **Streaming (separate tier)**: Embedding updates have different scaling characteristics than serving. Combining them would make the system harder to scale and debug.

3. **Origin (50-100ms)**: Complex ranking and LLM can't run at edge. Need central infrastructure with GPUs.

If latency requirements were relaxed to 200ms, we could collapse to two tiers. But for <50ms, three tiers is the standard industry pattern (see Netflix, TikTok architectures)."

---

## Common Mistakes to Avoid

| Mistake | Why It's Wrong | Better Approach |
|---------|----------------|-----------------|
| **Ignoring edge delivery** | Can't meet <50ms without CDN | Start with edge, work backward |
| **Batch embeddings only** | Stale within session | Design streaming from start |
| **LLM for everything** | Cost/latency prohibitive | Selective invocation |
| **Ignoring exploration** | Filter bubbles | Thompson Sampling |
| **No cold start strategy** | Poor new user experience | Multi-tier fallback |
| **Single region** | SPOF, high latency globally | Multi-region active-active |
| **Ignoring privacy** | Compliance failure | GDPR/CCPA from start |

---

## Questions to Ask Interviewer at End

1. "What's the current personalization approach, and what pain points led to this design question?"
2. "How important is explainability vs latency in your use case?"
3. "Are there specific compliance requirements (GDPR, AI Act) I should consider?"
4. "What's the team structure? Would this be built in-house or would you consider platforms like Shaped/Recombee?"
5. "How do you currently measure personalization success? What metrics matter most?"

---

## Quick Reference Card

```
+------------------------------------------------------------------------+
|    AI-NATIVE REAL-TIME PERSONALIZATION - INTERVIEW QUICK REFERENCE     |
+------------------------------------------------------------------------+
|                                                                         |
|  KEY DIFFERENTIATORS FROM TRADITIONAL RECS                              |
|  -----------------------------------------                              |
|  * Streaming embeddings (sub-minute) vs batch (daily)                   |
|  * Thompson Sampling (Bayesian) vs epsilon-greedy (random)              |
|  * Three-tier (edge/streaming/origin) vs two-tier (CDN/origin)          |
|  * LLM reasoning (selective) vs static ranking                          |
|  * Multi-modal (text+image+video) vs text-only                          |
|                                                                         |
+------------------------------------------------------------------------+
|                                                                         |
|  NUMBERS TO REMEMBER                                                    |
|  --------------------                                                   |
|  * Edge latency: <50ms p95                                              |
|  * Origin latency: <100ms p95                                           |
|  * Embedding freshness: <60 seconds                                     |
|  * Cache hit rate: >80%                                                 |
|  * Exploration rate: 5-15%                                              |
|  * LLM invocation: 5-10% of requests                                    |
|  * Personalization lift: 15-40%                                         |
|                                                                         |
+------------------------------------------------------------------------+
|                                                                         |
|  ALGORITHMS TO KNOW                                                     |
|  ------------------                                                     |
|  * Thompson Sampling: sample θ ~ Beta(α, β), pick argmax                |
|  * Streaming Embedding: emb += lr × weight × decay × (item - user)      |
|  * Multi-Modal Fusion: cross-attention + weighted pooling               |
|                                                                         |
+------------------------------------------------------------------------+
|                                                                         |
|  KEY TRADE-OFFS                                                         |
|  ---------------                                                        |
|  * Freshness vs Cost: Streaming is expensive, tier by user activity     |
|  * Exploration vs Regret: Thompson balances, measure regret             |
|  * Personalization vs Privacy: Consent-based, support opt-out           |
|  * LLM vs Latency: Selective invocation, template fallback              |
|                                                                         |
+------------------------------------------------------------------------+
```

---

## Trap 6: "How do you prevent filter bubbles?"

**What they're testing:** Understanding of recommendation diversity and user welfare

**Best answer:**
"Filter bubbles are addressed at three levels:

1. **Thompson Sampling exploration**: Items with uncertain posteriors get explored, naturally introducing diversity. The 5-15% exploration rate ensures users see content outside their profile.

2. **Diversity constraint in re-ranking**: After scoring, we apply a diversity constraint requiring at least 30% of results from different categories. The `ApplyDiversityConstraint` procedure enforces this.

3. **Novelty monitoring**: We track novelty score (% items user hasn't seen before, target 20-40%) and serendipity score (% unexpected but liked items, target 5-15%) as business metrics with alerts when they drop below thresholds.

The key insight is that diversity is a business metric, not just an algorithm parameter. If novelty drops below 10%, we increase exploration weight."

### Trap 7: "How do you handle the flash sale scenario where normal embeddings are useless?"

**What they're testing:** Ability to think about non-stationary environments

**Best answer:**
"Flash sales create a distribution shift where normal behavioral patterns become invalid. We handle this with:

1. **Pre-sale preparation**: Pre-compute 'sale persona' embeddings from historical sale data and pre-warm edge caches

2. **During sale**: Switch to faster embedding update windows (10 seconds vs 60 seconds), increase exploration rate to 20%, and add inventory-aware re-ranking that suppresses out-of-stock items in real-time

3. **Post-sale recovery**: Gradually blend sale-mode embeddings back to normal over 24 hours and reset bandit priors for sale items since sale behavior is non-representative

The streaming architecture makes this possible because we can change update cadence and blending weights without redeploying models."

---

## Advanced Discussion: Agentic Personalization (2025-2026 Trend)

For senior-level interviews, be prepared to discuss the evolution from reactive to proactive personalization:

```
Traditional (Reactive):
  User requests page → System ranks items → Return results

Agentic (Proactive):
  System maintains per-user "personalization agent" that:
  1. Tracks ongoing user goals (e.g., "planning a trip to Japan")
  2. Proactively surfaces relevant content across sessions
  3. Explains reasoning in natural language
  4. Adapts strategy based on goal progress

Architecture Impact:
  - Requires long-term memory beyond session (→ 3.28 AI Memory Management)
  - LLM invocation becomes more frequent (goal tracking)
  - Personalization becomes a conversation, not a single request
  - Edge tier handles goal-aware caching (invalidate when goal changes)

Trade-off: More engaging but significantly higher compute cost
and privacy implications (persistent goal tracking).
```

---

## Related Topics for Follow-Up

If the interviewer wants to go deeper, be prepared to discuss:

1. **Multi-armed Bandits**: UCB, LinUCB, contextual bandits, regret bounds
2. **Embedding Models**: Two-tower, CLIP, contrastive learning, foundation model embeddings
3. **Feature Stores** ([3.16](../3.16-feature-store/00-index.md)): Online/offline, point-in-time, streaming materialization
4. **A/B Testing**: Statistical significance, interleaving, multi-arm testing with bandits
5. **Privacy**: Differential privacy, federated learning, GDPR, real-time unlearning
6. **MLOps**: Model versioning, canary deployment, monitoring, shadow mode evaluation
7. **Hybrid Retrieval**: Dense + sparse fusion, reciprocal rank fusion, query understanding
8. **LLM Integration** ([3.21](../3.21-llm-gateway-prompt-management/00-index.md)): Prompt engineering for personalization, semantic caching, cost control
