# 13.3 AI-Native Energy & Grid Management Platform — Interview Guide

## Interview Structure (45 Minutes)

| Phase | Duration | Focus |
|---|---|---|
| **Phase 1: Requirements Scoping** | 8 min | Clarify which grid management capabilities to design; establish scale and constraints |
| **Phase 2: High-Level Architecture** | 12 min | IT/OT separation, core subsystems, data flow between grid control and market operations |
| **Phase 3: Deep Dive** | 15 min | Candidate-chosen area: grid optimization, VPP dispatch, AMI pipeline, or renewable forecasting |
| **Phase 4: Reliability & Security** | 7 min | Five-nines grid control, NERC CIP compliance, DER authentication |
| **Phase 5: Trade-offs & Extensions** | 3 min | Scaling to multi-utility, market expansion, AI model governance |

---

## Phase 1: Requirements Scoping (8 min)

### Opening Prompt

*"Design an AI-native energy and grid management platform that handles real-time grid optimization, renewable generation forecasting, demand response, and virtual power plant coordination for a large utility."*

### Key Scoping Questions the Candidate Should Ask

| Question | Why It Matters | Strong Answer |
|---|---|---|
| "What is the utility scale — number of meters, generators, substations?" | Grid optimization complexity scales with network size | "I'll design for a large utility: 10M smart meters, 200 generators, 500 substations, 20,000 bus network" |
| "Are we designing the OT control system (real-time dispatch) or the IT analytics layer, or both?" | IT/OT separation is fundamental to grid platforms | "Both, with explicit IT/OT separation — the control plane has different availability and security requirements than analytics" |
| "What DER types and scale are we managing?" | VPP architecture depends on DER heterogeneity | "Heterogeneous DERs: solar, batteries, EVs, thermostats — 5M devices with different communication protocols" |
| "Which energy markets does the platform participate in?" | Market integration drives bidding and dispatch architecture | "Day-ahead energy, real-time energy, frequency regulation, and spinning reserve" |
| "What regulatory framework — NERC CIP, European NIS2, or both?" | Compliance shapes architecture non-negotiably | "NERC CIP for North America — dictates IT/OT network segmentation and audit requirements" |

### Red Flags in Requirements Phase

- Does not ask about IT/OT separation (fundamental to grid platforms)
- Treats grid management like a typical web service without acknowledging physics constraints
- Does not mention regulatory compliance as an architectural driver
- Assumes all DERs are identical and fully controllable

---

## Phase 2: High-Level Architecture (12 min)

### What Strong Candidates Cover

1. **IT/OT dual-plane architecture:** Explicitly draw the boundary between the OT plane (SCADA, state estimation, OPF, DER dispatch) and IT plane (forecasting, market bidding, customer analytics). Describe the data diode / DMZ mechanism for controlled data flow.

2. **SCADA cycle timing:** Articulate that grid control runs on a fixed 4-second cycle: SCADA scan → state estimation → OPF → dispatch. This is the heartbeat of the entire system.

3. **Streaming vs. batch data paths:** SCADA and DER telemetry are streaming (sub-second latency); AMI meter data is batch-with-streaming-overlay (bulk collection overnight, near-real-time for critical meters); NWP weather data arrives in batches every 1–6 hours.

4. **Subsystem decomposition:** Grid optimization engine, renewable forecast service, VPP dispatch controller, demand response orchestrator, AMI pipeline, outage prediction service, market bidding optimizer.

5. **Data stores:** Time-series store for SCADA/AMI telemetry, graph/relational store for network topology, DER registry for device management, forecast store for generation predictions, audit store for compliance.

### Evaluation Criteria

| Criterion | Below Bar | At Bar | Above Bar |
|---|---|---|---|
| **IT/OT separation** | No mention of OT security boundary | Mentions IT/OT split; describes data flow between planes | Details data diode, command proxy, regulatory rationale; explains what runs where and why |
| **Real-time constraints** | Treats everything as eventual consistency | Identifies grid control as hard real-time with 4-second cycle | Explains the full SCADA cycle pipeline timing, identifies which computations must complete within the cycle |
| **DER heterogeneity** | Treats DERs as homogeneous dispatchable resources | Acknowledges different device types with different capabilities | Models probabilistic availability per device type; explains protocol differences (IEEE 2030.5 vs. OCPP) |

---

## Phase 3: Deep Dive Options (15 min)

### Option A: Grid Optimization Engine

**Probe questions:**
1. "Walk me through what happens in a single 4-second SCADA cycle."
2. "How does the state estimator handle bad data — a sensor returning nonsensical values?"
3. "What is N-1 contingency analysis and how do you run it in real-time?"
4. "How do you handle a topology change (breaker operation) mid-cycle?"

**What to listen for:**
- Understanding of weighted least squares state estimation and its computational structure
- Knowledge that OPF is a non-convex problem and requires relaxation (SOCP, SDP, or DC approximation)
- Awareness that contingency screening can be parallelized (independent DC power flow solves)
- Understanding of sparse matrix factorization as the dominant computational Slowest part of the process
- Incremental Y-bus update for topology changes (rank-1 modification)

**Trap question:** *"Why not just solve AC-OPF directly instead of using relaxation?"*
- Weak answer: "We should solve the exact AC-OPF for accuracy."
- Strong answer: "AC-OPF is non-convex and may converge to local optima or fail to converge within the time budget. SOCP relaxation is convex, guarantees global optimum, and is exact for radial networks and near-exact for meshed networks under normal conditions. We verify relaxation tightness and fall back to successive LP if the gap exceeds 0.1%."

### Option B: VPP Dispatch and Market Bidding

**Probe questions:**
1. "How do you model the available capacity of a VPP when individual DER availability is uncertain?"
2. "How do you decide how much to bid in the frequency regulation market vs. the energy market?"
3. "A VPP commits 30 MW of frequency regulation. How do you ensure delivery within 4 seconds?"
4. "What happens when 15% of DERs don't respond to a dispatch signal?"

**What to listen for:**
- Probabilistic availability modeling (not just nameplate capacity)
- Stochastic co-optimization across multiple market products
- Pre-staged/armed dispatch for fast frequency response (can't wait for centralized command)
- Over-dispatch strategy to compensate for non-compliance, with real-time monitoring and backup activation

**Trap question:** *"Wouldn't it be simpler to bid the VPP's total nameplate capacity?"*
- Weak answer: "Yes, that gives maximum revenue."
- Strong answer: "Bidding nameplate means committing capacity we can't reliably deliver. For frequency regulation, non-delivery penalties can be $100/MWh — bidding 150 MW when only 52 MW is reliably available would result in massive penalties. We bid at a confidence-adjusted level (P90 for penalty-heavy products, P50 for energy) and over-dispatch with real-time reserves."

### Option C: AMI Data Pipeline and Theft Detection

**Probe questions:**
1. "How do you handle the midnight ingestion surge when millions of meters report simultaneously?"
2. "Walk me through the theft detection pipeline — what features indicate theft?"
3. "How do you balance theft detection sensitivity (catching real theft) with false positive rate (not sending field crews on wild goose chases)?"
4. "How do you handle meter data gaps — meters that fail to report for a day?"

**What to listen for:**
- Lambda architecture (speed layer for real-time, batch layer for daily analytics)
- Staggered collection windows and backpressure mechanisms for the ingestion surge
- Feature engineering: consumption trend change, peer comparison, tamper flags, weather normalization
- Practical understanding that field investigation capacity constrains detection threshold, not model accuracy
- VEE process (validation, estimation, editing) for gap handling

**Trap question:** *"Why not use deep learning for theft detection — wouldn't a neural network be more accurate?"*
- Weak answer: "Yes, we should use a transformer model for best accuracy."
- Strong answer: "Gradient-boosted trees outperform deep learning on this tabular data problem. The feature engineering (90-day consumption trends, peer comparison, tamper flags) is the hard part, not the model architecture. GBT is also faster to train, easier to explain to regulators and legal teams (who need to justify field investigations), and requires less data per meter (we have few confirmed theft labels). Interpretability matters here — a theft accusation that can't be explained to a customer is a liability."

### Option D: Renewable Forecasting

**Probe questions:**
1. "Why use an ensemble of NWP models instead of just the best one?"
2. "What is a ramp event, and why is it dangerous for the grid?"
3. "How do you produce probabilistic (quantile) forecasts from deterministic NWP models?"
4. "How do you know when your forecast model needs retraining?"

**What to listen for:**
- Understanding that no single NWP model is best across all weather regimes, lead times, and locations
- Ramp events: rapid generation changes that may exceed compensating generator ramp rates
- Post-processing with quantile regression trained on NWP vs. actuals data
- Calibration monitoring using PIT histograms — when the forecast distribution no longer matches the observed frequency, the model has drifted

**Trap question:** *"Solar forecasting is easy — just predict cloud cover and multiply by panel capacity."*
- Weak answer: "Yes, it's relatively straightforward."
- Strong answer: "Solar forecasting is deceptively complex. Cloud cover isn't binary — thin cirrus reduces output by 20%, cumulus creates rapid fluctuations, and morning fog clears unpredictably. You also need to model aerosol scattering, snow cover albedo effects, panel soiling, inverter clipping, temperature-dependent efficiency loss, and panel degradation over time. The NWP models resolve cloud cover at 1–3 km grid cells, but a single cumulus cloud can shade 500 meters of panels while the NWP shows 'partly cloudy' for the entire grid cell. This is why ensemble post-processing and ramp detection are necessary."

---

## Phase 4: Reliability & Security (7 min)

### Must-Cover Topics

1. **Five-nines for grid control:** How does the platform achieve 99.999% availability for the OT control plane? (Dual-redundant state estimators, backup control center, substation autonomous operation)

2. **NERC CIP compliance:** How does IT/OT network segmentation work? What is a data diode? How are control commands validated before entering the OT network?

3. **DER device security:** How are millions of DERs authenticated? What prevents a compromised device from injecting false telemetry or ignoring dispatch signals?

4. **Failure cascading prevention:** What happens when the state estimator fails? When the OPF engine fails? When the forecast service is unavailable?

### Scoring Rubric

| Area | 1 (Poor) | 2 (Basic) | 3 (Strong) | 4 (Exceptional) |
|---|---|---|---|---|
| **Grid reliability** | No mention of redundancy | Active-standby for critical components | Dual control centers, autonomous substations, degraded-mode operation | Quantifies failover timing, explains RAS pre-arming for contingency protection |
| **NERC CIP** | Treats security as a feature, not a regulatory mandate | Mentions IT/OT separation | Describes data diode, command proxy, audit trail requirements | Explains specific CIP standard impacts on architecture (CIP-005 network segmentation, CIP-010 change management) |
| **DER security** | No device authentication mentioned | TLS for DER communication | Certificate-based mTLS with PKI enrollment, anti-replay | Supply chain security (CIP-013), firmware signing, behavioral anomaly detection |

---

## Phase 5: Trade-offs & Extensions (3 min)

### Discussion Prompts

1. **"How would you extend the platform to manage grids in multiple countries with different regulatory frameworks?"**
   - Strong: Region-isolated OT networks with separate compliance postures; common IT platform for shared analytics; data sovereignty (no cross-border grid data flow).

2. **"What are the risks of increasing AI autonomy in grid control?"**
   - Strong: Acknowledge the tension between AI optimization speed and operator trust; discuss graduated autonomy (AI recommends → AI executes with operator confirmation → AI executes autonomously within safe boundaries); explain that NERC reliability standards require human operators as ultimate authority.

3. **"How does the platform adapt as renewable penetration increases from 20% to 80%?"**
   - Strong: Grid inertia decreases (fewer spinning generators), requiring synthetic inertia from batteries; frequency regulation becomes more critical; forecast uncertainty increases; VPP capacity becomes the primary flexibility resource; grid-forming inverters replace grid-following.

---

## Common Mistakes

| Mistake | Why It's Wrong | Correct Approach |
|---|---|---|
| Treating grid optimization like a web service scaling problem | Grid control has physics constraints (Kirchhoff's laws, frequency stability) that don't exist in web services | Model the physics: power balance equations, voltage limits, generator ramp rates. The optimization is constrained by physical laws, not just throughput. |
| Ignoring IT/OT separation | NERC CIP mandates network segmentation; ignoring it means the design is non-deployable | Design IT/OT separation from the start; specify data diode, command proxy, and which components run on which plane. |
| Assuming all DERs are identical and fully controllable | EVs unplug, batteries deplete, thermostats hit comfort limits — DERs are probabilistic, not deterministic | Model per-DER availability distributions; bid at confidence-adjusted levels; design for non-compliance. |
| Designing a single monolithic real-time pipeline | Different data sources have different latency requirements and volumes | SCADA at 4-second cycles (streaming), AMI at 15-minute intervals (batch/streaming), NWP at 1–6 hour intervals (batch). Design data pipelines matched to source characteristics. |
| Over-indexing on ML model accuracy for theft detection | Field investigation capacity (200/day) is the binding constraint, not model accuracy | Tune detection threshold to match field capacity; focus on ranking precision (the top 200 alerts must be high-quality) rather than overall AUC. |
| Forgetting that forecasts are probabilistic | Point forecasts hide uncertainty that cascades into bad market and dispatch decisions | Quantile forecasts propagate uncertainty into bidding decisions (bid P90 for penalty-heavy products) and reserve requirements (increase spinning reserve when forecast uncertainty is high). |

---

## Follow-Up Probes by Candidate Level

### Probe Set 1: Grid Optimization Depth

| Level | Probe | What It Tests |
|---|---|---|
| **Junior** | "What is state estimation and why do you need it?" | Basic understanding that measurements are noisy and redundant; WLS concept |
| **Mid** | "Why use SOCP relaxation instead of solving AC-OPF directly?" | Convex relaxation theory; awareness of non-convex optimization challenges |
| **Senior** | "How does look-ahead OPF differ from reactive OPF, and what is the optimal look-ahead horizon?" | Control theory thinking; understanding of feedback loop between dispatch and state evolution |
| **Staff** | "How do you handle the state estimator during a protection relay misoperation that turns N-1 into N-2?" | Extended contingency analysis; Y-bus rebuilds during cascading events; RAS validity under topology uncertainty |

### Probe Set 2: VPP and Market Bidding Depth

| Level | Probe | What It Tests |
|---|---|---|
| **Junior** | "Why can't you bid the VPP's nameplate capacity?" | Distinction between nameplate and available capacity; awareness of DER variability |
| **Mid** | "How do you handle the correlation between DER availability failures and high-value market conditions?" | Weather-conditioned availability modeling; tail risk awareness |
| **Senior** | "Describe the stochastic co-optimization problem for multi-market bidding." | First-stage/second-stage decision structure; scenario generation from probabilistic forecasts |
| **Staff** | "How do you ensure 4-second frequency regulation response when DER communication latency is 2-8 seconds?" | Pre-armed/armed dispatch pattern; local threshold-based response; over-dispatch compensation |

### Probe Set 3: AMI and Theft Detection Depth

| Level | Probe | What It Tests |
|---|---|---|
| **Junior** | "How do you handle 960M meter reads per day?" | Basic awareness of streaming vs. batch; partitioning concept |
| **Mid** | "Why is the midnight AMI surge harder than it looks?" | RF network capacity as the real Slowest part of the process; collection scheduling vs. server scaling |
| **Senior** | "What is the exploration-exploitation trade-off in theft detection?" | Multi-armed bandit framing; label acquisition pipeline; selection bias in model training |
| **Staff** | "How do you handle mass false positives from a tariff change that shifts consumption patterns?" | Concept drift detection; mass anomaly filtering; feature drift monitoring; model governance |

---

## Advanced Discussion Topics

### Discussion 1: Graduated AI Autonomy in Grid Control

**Framing:** Grid operators have decades of experience and deep skepticism of automated dispatch. How should AI autonomy evolve in grid control?

**Strong response includes:**
- Level 1 (advisory): AI recommends; operator executes every command manually. Trust-building phase.
- Level 2 (automated with confirmation): AI executes routine dispatch; operator confirms non-routine actions (topology changes, emergency dispatch). Most mature deployments today.
- Level 3 (supervised autonomy): AI executes all dispatch within pre-defined safe boundaries (ramp rate limits, voltage bounds). Operator intervenes only on boundary violations.
- Level 4 (full autonomy): AI operates grid end-to-end with operator monitoring. Reserved for well-understood scenarios (stable weather, normal demand). Immediate human takeover on anomaly detection.
- Regulatory reality: NERC reliability standards require a human operator as "ultimate authority." Full autonomy requires regulatory framework changes.

### Discussion 2: Grid Inertia Decline as Renewable Penetration Increases

**Framing:** As coal and gas plants retire (providing physical inertia from spinning mass), and renewables (connected via inverters with no rotating mass) grow to 80%+ penetration, how does the platform adapt?

**Strong response includes:**
- Synthetic inertia from grid-forming battery inverters (response within 50 ms, vs. 100 ms for natural inertia)
- Rate-of-change-of-frequency (RoCoF) as a new constraint in the OPF formulation
- Faster frequency response products (0.5-second response vs. traditional 4-second)
- Virtual synchronous generator (VSG) control algorithms on battery inverters
- Acknowledgment that 100% IBR (inverter-based resource) grids are fundamentally different control problems from synchronous machine grids

### Discussion 3: False Data Injection Defense vs. Detection Speed Trade-off

**Framing:** Adding cross-validation layers (PMU comparison, physics checks, ML anomaly detection) to defend against stealth attacks increases state estimation latency. How do you balance security with the 4-second cycle constraint?

**Strong response includes:**
- Two-tier approach: fast statistical tests (chi-squared) run within the primary cycle; deeper validation (PMU cross-check, physics-based) runs asynchronously on a 1-cycle delay
- If the async validator detects an anomaly, it flags the state and the next cycle uses a validated state (at the cost of 4 seconds of staleness, which is acceptable for defense)
- Priority-based validation: only validate the subset of measurements that could affect critical contingencies (top 500 by sensitivity ranking)
- Hardware-protected measurements at critical points (tie-lines, major generators) that bypass the general validation pipeline

### Discussion 4: Renewable Curtailment vs. Storage Economics

**Framing:** During midday solar oversupply, the grid can either curtail solar (waste free energy) or store it in batteries (expensive capital investment). How does the platform optimize this trade-off?

**Strong response includes:**
- Curtailment is "free" in the short term but has hidden costs: lost production tax credits, wasted capital investment in solar, increased carbon intensity when curtailed solar is replaced by gas at peak
- Battery storage has capital cost ($150/kWh × 4-hour duration) but generates revenue from energy arbitrage (charge at negative midday prices, discharge at $50–100/MWh evening prices)
- The platform's market bidding optimizer naturally solves this: if battery revenue > curtailment cost, it dispatches storage; otherwise, it curtails
- The OPF engine considers network constraints: curtailment may be needed even with available storage if transmission congestion prevents moving power from solar-rich areas to storage-rich areas

---

## Red Flags / Green Flags

### Red Flags

| Red Flag | Why It's Concerning |
|---|---|
| Treats grid control like a web service with auto-scaling | Demonstrates no understanding of physics constraints and hard real-time requirements |
| No mention of IT/OT separation in security discussion | NERC CIP mandate; ignoring it means the design is non-deployable in any regulated grid |
| Assumes all DERs respond to dispatch signals reliably | Ignores 8–15% non-compliance rate; no reserve strategy; will fail market delivery commitments |
| Uses a single NWP model for renewable forecasting | No single model is best across all weather regimes; ensemble is standard practice |
| Proposes deep learning for theft detection without discussing interpretability | Theft accusations require explainable evidence; regulatory and legal requirements |
| Ignores rebound peak after demand response events | Shows curtailment-only thinking; rebound can exceed original emergency peak |
| Treats forecast accuracy as a single number (8% MAE) | Hides regime-dependent accuracy; transitional weather errors are 3x the average |

### Green Flags

| Green Flag | What It Demonstrates |
|---|---|
| Immediately identifies the 4-second SCADA cycle as the fundamental constraint | Deep understanding of grid control timing and physics |
| Explains SOCP relaxation and when it fails (binding voltage constraints) | Advanced optimization knowledge; knows production workarounds |
| Models DER availability probabilistically with weather conditioning | Understands correlated failure; designs for tail risk |
| Discusses exploration budget in theft detection (10-15% random investigation) | Understands selection bias and label acquisition challenges in ML systems |
| Mentions relay misoperation extending N-1 to N-2 scenarios | Uncommon knowledge; indicates real-world grid reliability experience |
| Proposes staggered DR recovery to prevent rebound peaks | Systems thinking; understands second-order effects of control actions |
| Discusses GPS time synchronization and holdover oscillators | Awareness of precision timing infrastructure that underpins grid measurement |

---

## System Design Comparison Table

| Dimension | Junior | Mid-Level | Senior | Staff+ |
|---|---|---|---|---|
| **Architecture** | Monolithic pipeline: ingest → process → store | Identifies IT/OT separation; separate subsystems | Detailed dual-plane architecture with data diode and command proxy; hierarchical grid decomposition | Explains why each component runs on a specific plane; quantifies latency budget per pipeline stage; designs for regulatory compliance from Day 1 |
| **Grid Control** | "Run optimization every few minutes" | Identifies 4-second SCADA cycle; mentions state estimation | WLS state estimation with sparse factorization; SOCP-OPF with relaxation tightness monitoring | Look-ahead OPF with predictive state; topology change batching; computational budget mode for deterministic latency |
| **DER Management** | "Aggregate DER capacity and dispatch" | Acknowledges heterogeneous devices; mentions availability | Probabilistic availability per device type; confidence-adjusted bidding; over-dispatch for non-compliance | Weather-conditioned correlated availability; Monte Carlo tail risk; pre-armed dispatch for sub-second frequency response |
| **Forecasting** | "Use weather data to predict solar" | Ensemble NWP; mentions quantile forecasts | Regime-dependent accuracy; PIT calibration; ramp detection | Regime-tagged confidence propagation to OPF reserves; NWP model change detection; dropout-trained partial-input resilience |
| **Security** | "Encrypt everything; use authentication" | Mentions NERC CIP; IT/OT separation | Data diode + command proxy; DER certificate PKI; audit trail | Stealth attack defense (FDI); relay misoperation in contingency; supply chain security (CIP-013); insider threat behavioral analytics |
| **Reliability** | "Use redundancy" | Backup control center; mentions failover | Quantifies failover time; degraded-mode operation; substation autonomous capability | Extended N-1+protection failure contingency; cascading failure simulation; gas-electric coordination risk |

---

## Evaluation Anti-Patterns

| Anti-Pattern | Description | Why It's Unfair |
|---|---|---|
| **Expecting power systems background** | Penalizing candidates who don't know Kirchhoff's laws or SOCP | Most senior engineers can learn domain-specific physics; evaluate problem decomposition and engineering judgment |
| **Requiring specific NERC CIP standard numbers** | Expecting candidates to cite CIP-005 or CIP-010 by number | Evaluate whether they understand the principles (network segmentation, change management); regulation numbers can be looked up |
| **Penalizing for not knowing VPP market mechanics** | Expecting candidates to understand frequency regulation vs. spinning reserve markets | The key insight is that different market products have different delivery requirements and penalties; specific product knowledge is domain-specific |
| **Over-weighting ML model architecture** | Focusing on whether the candidate knows gradient-boosted trees vs. neural networks | The engineering challenge is the label pipeline, not the model; evaluate system design thinking, not ML architecture knowledge |
| **Ignoring practical trade-offs** | Expecting the "perfect" solution without acknowledging cost, complexity, and regulatory constraints | Every design decision in grid management involves trade-offs between safety, cost, and operational complexity; evaluate trade-off reasoning |
| **Testing obscure edge cases** | Asking about island formation or GPS holdover oscillators as primary evaluation criteria | These are deep operational details; evaluate whether the candidate asks about edge cases and has a framework for handling them |
