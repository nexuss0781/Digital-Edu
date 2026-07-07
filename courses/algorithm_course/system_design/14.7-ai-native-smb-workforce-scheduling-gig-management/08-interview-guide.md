# 14.7 AI-Native SMB Workforce Scheduling & Gig Management — Interview Guide

## 45-Minute Interview Pacing

| Phase | Duration | Focus |
|---|---|---|
| **Phase 1: Requirements** | 0–8 min | Clarify scope, identify core requirements, establish scale parameters |
| **Phase 2: High-Level Design** | 8–22 min | Architecture diagram, key components, data flows, major design decisions |
| **Phase 3: Deep Dive** | 22–38 min | Go deep on 1–2 components (usually solver + compliance or attendance + gig matching) |
| **Phase 4: Trade-offs & Extensions** | 38–45 min | Scalability, failure modes, compliance edge cases, extensions |

---

## Phase 1: Requirements Gathering (0–8 min)

### Questions to Ask the Interviewer

1. **Scale:** How many businesses? How many employees per business? (10K vs 100K businesses changes the multi-tenancy design significantly)
2. **Worker types:** Full-time employees only, or blended with part-time and gig workers? (Gig integration is a major architectural dimension)
3. **Compliance scope:** US-only or international? Which cities? (Predictive scheduling laws vary dramatically by jurisdiction)
4. **Integration depth:** Do we need to integrate with POS systems for demand forecasting, or use simpler signals?
5. **Attendance verification:** GPS-only or biometric? (Biometric adds significant complexity and privacy requirements)
6. **Real-time requirements:** Is the schedule generation interactive (< 10s) or can it be batch?

### Key Functional Requirements to Establish

- AI-powered schedule generation from demand predictions
- Labor law compliance enforcement (overtime, rest periods, predictive scheduling, minors)
- Shift swap marketplace with compliance validation
- Gig worker integration for gap filling
- Geofenced attendance tracking with spoofing detection
- Multi-location management with cross-location employee sharing

### Key Non-Functional Requirements

- Schedule generation: < 10s for 100 employees
- Clock-in verification: < 2s
- 99.95% platform availability; 99.99% for clock-in
- Multi-tenant data isolation
- 7-year compliance record retention

---

## Phase 2: High-Level Design (8–22 min)

### What Strong Candidates Cover

1. **Dual-engine architecture:** Batch optimization (weekly schedule) + real-time event processing (intra-day disruptions). Many candidates only design one.

2. **Solver as a separate compute pool:** The constraint solver has different scaling characteristics (CPU-intensive, bursty) than the API layer (I/O-bound, steady). Strong candidates recognize this and design the solver as a horizontally-scalable stateless pool.

3. **Event-sourced schedule state:** Every schedule modification is an immutable event. The current schedule is a materialized view. This enables compliance audit trails and undo—both critical for this domain.

4. **Compliance as a cross-cutting concern:** Not buried inside the scheduler, but a separate engine that validates at multiple points (pre-publication, during shift swaps, real-time during execution).

5. **Multi-signal demand forecasting:** Not just "use last week's schedule" but POS data, weather, events, holidays feeding a time-series model.

### What Weak Candidates Do

- Design a basic CRUD calendar app without any optimization
- Ignore compliance entirely or treat it as "just some if-else checks"
- Put everything in a monolith with no separation of scheduling logic from API logic
- Forget about the clock-in/attendance tracking system
- No consideration of multi-tenancy

---

## Phase 3: Deep Dive (22–38 min)

### Deep Dive Option A: Constraint Solver

**Interviewer probe:** "The manager clicks 'generate schedule.' Walk me through exactly what happens."

**What to cover:**
1. Problem formulation (decision variables, hard constraints, soft constraints, objective function)
2. Why this is NP-hard and why greedy fails (look-ahead blindness, constraint interaction)
3. Two-phase approach: constraint propagation to reduce search space, then local search to optimize
4. Time-budgeted anytime algorithm (return best-so-far when budget expires)
5. Handling infeasibility (identify conflicting constraints, suggest relaxations)
6. Incremental re-optimization (mid-week change shouldn't re-solve the entire week)

**Red flag if candidate:** Proposes brute-force search, ignores time budget, or claims the problem is "just assignment."

### Deep Dive Option B: Compliance Engine

**Interviewer probe:** "A business operates in San Francisco and Los Angeles. How does the system enforce different labor laws at each location?"

**What to cover:**
1. Jurisdiction-as-configuration: rules are declarative data, not code
2. Rule versioning and effective dates
3. Overlapping jurisdictions (federal, state, city) with "most protective" resolution
4. Predictive scheduling premium pay calculation
5. Real-time monitoring (detecting overtime approach, not just at schedule generation)
6. Ambiguity handling (what counts as a "schedule change" for premium pay?)

**Red flag if candidate:** Hardcodes rules as if-else statements, ignores jurisdiction variation, or doesn't address rule updates.

### Deep Dive Option C: Attendance & GPS Verification

**Interviewer probe:** "How do you prevent employees from clocking in from home using a GPS spoofing app?"

**What to cover:**
1. Multi-signal verification (GPS + WiFi SSID + cell tower + accelerometer)
2. Mock location API detection on mobile devices
3. Impossible travel detection (compare current clock-in location with previous events)
4. Device fingerprinting to prevent shared/cloned devices
5. Handling legitimate edge cases (GPS drift near buildings, employee parks across the street)
6. Privacy considerations (collecting only during clock events, not continuous tracking)

### Deep Dive Option D: Gig Worker Matching

**Interviewer probe:** "An employee calls in sick 2 hours before their shift. How does the system find a replacement?"

**What to cover:**
1. Tiered notification strategy (top 5 first, then broader if no response)
2. Multi-factor scoring (proximity, reliability, skill match, rate, responsiveness)
3. The accept-renege problem and mitigation (confirmation checkpoints, overbooking)
4. Simultaneous acceptance race condition (atomic claim with optimistic locking)
5. Emergency broadcast with premium rate when time is critical
6. Unified schedule view (gig workers appear alongside employees)

---

## Trap Questions & How to Handle Them

### Trap 1: "Can't you just use a simple greedy algorithm for scheduling?"

**Why it's a trap:** Greedy seems reasonable for small cases but fails at production scale.

**Strong answer:** Explain why greedy fails (look-ahead blindness with a concrete example: assigning the only bartender to Monday blocks Tuesday). Then describe the two-phase approach (constraint propagation + local search). Acknowledge that greedy is used as a fast fallback when the solver times out or is unavailable.

**Weak answer:** "Yes, greedy is fine for small businesses." (Ignores constraint interaction problems even at small scale.)

### Trap 2: "Just store all the labor laws in a database table."

**Why it's a trap:** Oversimplifies rule encoding. Rules aren't simple key-value pairs—they have conditional logic, interaction effects, and temporal validity.

**Strong answer:** Distinguish between rule storage (declarative configuration in the database) and rule evaluation (an engine that interprets rules against a schedule). Address rule interaction (overtime rule + rest rule + predictive scheduling rule can create circular dependencies). Address versioning and effective dates.

### Trap 3: "GPS geofencing is enough for attendance verification."

**Why it's a trap:** GPS alone is easily spoofed.

**Strong answer:** Layer multiple signals. GPS is the primary check, but augment with WiFi SSID detection (device should see the location's WiFi), cell tower triangulation (consistent with GPS coordinates), accelerometer data (device should show movement consistent with arrival), and mock-location API detection. Discuss the false-positive problem (legitimate employees flagged) and the UX impact of rejecting a legitimate clock-in.

### Trap 4: "How do you handle a business with 1,000 employees?"

**Why it's a trap:** Tests whether you designed for the stated scope (SMB, 5–200 workers) or accidentally built an enterprise system.

**Strong answer:** "Our primary target is 5–200 workers. For the rare customer approaching 200+, we decompose the problem by department/role and solve sub-problems. Beyond 500, we'd recommend an enterprise solution—our solver is optimized for fast SMB-scale results, not large-scale optimization. But if we needed to support it, we'd increase the time budget, use problem decomposition, and potentially run the solver on dedicated compute."

### Trap 5: "What happens when the compliance engine and the schedule optimizer disagree?"

**Why it's a trap:** Tests architectural separation of concerns and conflict resolution.

**Strong answer:** The compliance engine doesn't "disagree" with the optimizer—it's a hard constraint that the optimizer must satisfy. The optimizer generates solutions that pass compliance validation. If no compliant solution exists, the system reports infeasibility with the specific conflicting constraints. The compliance engine has veto power—a schedule cannot be published without passing compliance validation. This is a deliberate design choice: we never publish a non-compliant schedule, even if it means the manager must adjust constraints.

---

## Trade-Off Discussions

### Schedule Optimality vs. Generation Speed

| Dimension | Fast (< 3s) | Optimal (10–30s) |
|---|---|---|
| Algorithm | Greedy + constraint repair | Full constraint propagation + local search |
| Quality | 85–90% of optimal | 97–99% of optimal |
| Infeasibility handling | May miss infeasibility | Proves infeasibility formally |
| Use case | Mid-week quick adjustments | Weekly full schedule generation |

**Production approach:** Default to the full solver for weekly generation (10s budget). Use the fast Practical rule of thumb for "what-if" scenarios and mid-week adjustments. Show quality score so the manager knows the trade-off.

### Compliance Strictness vs. Usability

| Dimension | Strict (fail-closed) | Flexible (warn + allow) |
|---|---|---|
| Hard constraints (overtime limits, minor restrictions) | Block publication; no override | Block publication; no override |
| Soft constraints (predictive scheduling notice) | Block publication; require override with documentation | Warn; allow publication with acknowledgment |
| Ambiguous rules (is this a "schedule change"?) | Conservative interpretation; always trigger premium pay | Provide guidance; let manager decide |

**Production approach:** Hard constraints are always fail-closed (legal liability). Soft constraints use warn-and-document. Ambiguous rules default to the conservative interpretation but allow business-level configuration after legal consultation.

### Gig Worker Quality vs. Fill Speed

| Dimension | Quality-First | Speed-First |
|---|---|---|
| Matching radius | 10 km | 30 km |
| Minimum reliability score | 4.5/5 | 3.0/5 |
| Tiered notification | 3 tiers over 45 min | All candidates immediately |
| Fill rate (30 min) | 60% | 85% |
| Worker quality | Consistently high | Variable |

**Production approach:** Default to quality-first for standard shifts (fill time is 24+ hours). Switch to speed-first for urgent shifts (< 4 hours until start). Let the business configure their preference.

---

## Common Mistakes in Interviews

| Mistake | Why It's Wrong | Correct Approach |
|---|---|---|
| Designing a calendar CRUD app | Misses the optimization and compliance dimensions entirely | Center the design on the constraint solver and compliance engine |
| Ignoring multi-tenancy | "Just put it in a database" doesn't address 100K businesses sharing infrastructure | Discuss tenant isolation, noisy neighbor protection, per-tenant data partitioning |
| Treating compliance as a final check | Checking compliance only at publication misses real-time violations | Dual-stack: pre-validation + real-time monitoring + post-period reconciliation |
| Over-engineering the solver | Spending 20 minutes on advanced optimization theory | The solver is important but should be discussed as one component among many; 5–8 minutes is sufficient |
| Ignoring the cold start problem | Assuming all businesses have historical data | Address demand forecasting without data (industry priors, transfer learning, manager input) |
| Forgetting about gig worker classification risk | Treating gig workers identically to employees in the system | Distinguish operationally-unified, legally-differentiated treatment; flag AB-5 concerns |

---

## Scoring Rubric

| Score | Criteria |
|---|---|
| **Strong Hire** | Identifies scheduling as a constraint satisfaction problem; designs a proper solver architecture; implements compliance as a cross-cutting engine with jurisdiction-aware rules; addresses multi-tenancy; handles clock-in verification with anti-spoofing; discusses gig matching with the accept-renege problem; shows clear trade-off reasoning throughout |
| **Hire** | Gets the high-level architecture right (separate solver, compliance engine, attendance service); addresses at least 2 deep dives competently; recognizes the compliance complexity; handles most trade-off questions well |
| **Lean Hire** | Reasonable architecture but misses 1–2 major components; shallow on compliance or solver details; doesn't fully address multi-tenancy or gig integration; some trade-off awareness |
| **No Hire** | Designs a basic calendar app; no optimization or compliance awareness; doesn't address scalability or multi-tenancy; can't discuss failure modes or trade-offs |

---

## Extension Questions (If Time Permits)

### Extension 1: "How would you add AI-powered natural language schedule management?"

**Context:** A manager texts "Schedule Sarah for the lunch rush on Tuesday" or "Who can cover Mike's shift tomorrow?"

**What to discuss:**
1. Intent classification (schedule command vs. query vs. swap request) using a fine-tuned language model
2. Entity extraction (employee names, shift types, dates) with disambiguation ("which Sarah?")
3. Constraint checking before executing the interpreted command (does Sarah have availability? Does this create an overtime violation?)
4. Confirmation flow: the AI interprets and presents its understanding for manager approval before executing
5. Error recovery: "I understood you want to schedule Sarah Chen for Tuesday 11 AM–3 PM at Downtown location. She would enter overtime (42 hours this week). Proceed anyway?"

### Extension 2: "How would you handle union scheduling rules?"

**Context:** Moving upmarket to mid-size businesses with unionized workforces introduces seniority-based bidding, contractual shift minimums, and grievance-traceable scheduling decisions.

**What to discuss:**
1. Seniority as a hard constraint (senior employees get priority for preferred shifts)
2. Contractual minimum hours (guaranteed 32 hours/week regardless of demand)
3. Shift bidding process (union contract may require a bidding window before assignment)
4. Grievance documentation (every scheduling decision must reference the contract clause that justifies it)
5. The solver must now explain its decisions (not just produce a schedule, but justify each assignment against the contract)

### Extension 3: "How does the system handle a pandemic-like disruption?"

**What to discuss:**
1. Capacity limits (regulatory maximum occupancy) become a new hard constraint that caps demand and staffing simultaneously
2. Health screening integration (pre-shift health questionnaire, temperature check as a clock-in gate)
3. Contact tracing: if Employee A tests positive, identify all employees who shared shifts within the exposure window and notify them
4. Dynamic team isolation: schedule employees into fixed "pods" that never overlap, so an infection in one pod doesn't shut down the entire business
5. Demand forecasting during regime change: historical patterns are invalidated; the model must detect regime shifts and rapidly adapt to new patterns

---

## Case Study Walkthrough (For Practice)

### Scenario: "Cafe Aroma — 3 Locations, 45 Employees"

**Setup:** A coffee shop chain with 3 locations in Portland, Oregon. 45 employees total (15 per location), 8 of whom float between locations. Hours: 6 AM–8 PM daily. Roles: barista (requires food handler cert), shift lead (requires key-holder status), baker (morning only).

**Key challenges to identify:**
1. Oregon statewide predictive scheduling (14-day advance notice, premium pay for changes) — all 3 locations are subject
2. Cross-location scheduling for 8 floaters — rest period validation across locations; clopening detection when a floater closes one location and opens another
3. Morning baker staffing — only 3 employees have baker training; if one calls off, the gig pool is unlikely to have certified bakers
4. Sunday morning surge (brunch crowd) vs. weekday morning commuters — fundamentally different demand shapes requiring different staffing models
5. The 6 AM opening shift creates a problem for predictive scheduling: if the schedule is published at 5 PM (13 days before), Oregon requires 14 days — the 6 AM shift on the 14th day is technically < 14 days notice

**What a strong candidate covers in 5 minutes:**
- Identifies the Oregon predictive scheduling constraint as the primary compliance challenge
- Recognizes the cross-location floater problem and proposes a unified timeline for rest-period checking
- Discusses the baker certification Slowest part of the process and proposes either cross-training more employees or a premium gig rate for certified bakers
- Notes that 45 employees across 3 locations is small enough for the solver to handle as a single joint optimization (no decomposition needed)
- Catches the 14-day notice Edge Case (Unusual or extreme situation) for early-morning shifts and proposes publishing schedules 15 days ahead to create a buffer

---

## Key Numbers to Know

| Metric | Value | Context |
|---|---|---|
| **Search space (50 employees, 7 days)** | ~10^120 possible assignments | Why greedy fails and proper constraint solving is required |
| **Schedule generation SLO** | ≤ 10s (p95) for ≤ 100 employees | Interactive-speed requirement drives solver architecture |
| **Clock-in peak** | 50,000 events/minute (8 AM surge) | Drives stateless verification worker scaling |
| **Predictive scheduling jurisdictions** | 15+ US cities + Oregon statewide | The compliance patchwork that rules-as-code must handle |
| **Gig worker no-show rate (industry)** | 8–15% | Drives the confirmation checkpoint and overbooking strategy |
| **Labor cost % of revenue (restaurants)** | 25–35% | Why 1–2% scheduling efficiency gains are high-impact |
| **Cold-start forecast improvement** | 35% → 22% MAPE with transfer learning | Justifies the cross-business intelligence infrastructure |
| **Sunday evening solver surge** | 10x typical load | Drives predictive auto-scaling and pre-computation strategies |
| **Compliance rule change velocity** | 50–100 changes/year across US | Drives rules-as-data (not rules-as-code) architecture |
| **Multi-location clopening window** | Cross-location rest period violations invisible to single-location managers | Drives the cross-location employee timeline index |

---

## Whiteboard Diagram Checklist

A complete whiteboard diagram for this system should include these components (strong candidates cover 8+):

| # | Component | Why It's Essential |
|---|---|---|
| 1 | **Client apps** (Manager, Employee, Gig Worker) | Three distinct user types with different access patterns |
| 2 | **API Gateway** with rate limiting | Multi-tenant entry point; tenant routing |
| 3 | **Schedule Service** | Core orchestrator for schedule lifecycle |
| 4 | **Constraint Solver Pool** (separate from API) | Different scaling characteristics than API; stateless workers |
| 5 | **Compliance Engine** (separate service) | Cross-cutting concern; validates at multiple points |
| 6 | **Demand Forecasting Service** | Time-series ML pipeline; POS/weather/event ingestion |
| 7 | **Attendance/Clock-In Service** | Real-time verification with GPS and biometric |
| 8 | **Gig Matching Service** | Independent marketplace with its own scoring |
| 9 | **Shift Swap Service** | Self-service marketplace with compliance validation |
| 10 | **Notification Service** | Multi-channel (push, SMS, email) with priority ordering |
| 11 | **Event Log** (immutable) | Compliance audit trail; schedule versioning source |
| 12 | **Schedule Database** (sharded by tenant) | Multi-tenant data isolation |
| 13 | **Time-Series Store** | Demand data, POS events, weather data |
| 14 | **Cache Layer** | Published schedules, employee availability |
