# 13.7 AI-Native Construction & Engineering Platform — Interview Guide

## 45-Minute Interview Pacing

| Phase | Duration | Focus | What to Evaluate |
|---|---|---|---|
| **Phase 1: Problem Framing** | 5 min | Clarify scope: which construction AI capabilities to focus on (progress tracking? safety? all?) | Does the candidate ask clarifying questions about site scale, real-time vs. batch, edge vs. cloud? |
| **Phase 2: Requirements** | 5 min | Define functional requirements and key SLOs (safety latency, progress accuracy, data volumes) | Can they estimate data volumes? Do they recognize the edge-cloud tension? |
| **Phase 3: High-Level Design** | 10 min | System architecture: edge layer, ingestion, processing pipelines, core services, storage | Do they separate safety (real-time edge) from analytics (batch cloud)? Do they address BIM as central data model? |
| **Phase 4: Deep Dive** | 15 min | Pick 1-2 areas: safety CV pipeline, progress tracking photogrammetry, BIM clash detection, cost estimation | Can they discuss CV inference at the edge, point cloud registration, spatial indexing, probabilistic estimation? |
| **Phase 5: Scaling & Reliability** | 5 min | Multi-site scaling, edge resilience, storage tiering for petabyte imagery | Do they address edge autonomous operation? Storage lifecycle for regulatory retention? |
| **Phase 6: Trade-offs & Extensions** | 5 min | Alternative approaches, what they would change, future extensions | Can they articulate trade-offs between real-time and batch processing? Quality vs. coverage? |

---

## Opening Question

> "Design an AI-native platform for managing construction projects. The platform should use computer vision to monitor safety and track progress, use BIM intelligence for coordination, and predict project risks. How would you architect this system?"

### Strong Opening Signals

- Immediately asks about site scale (single site vs. hundreds), project types (residential vs. mega-projects), and which capabilities are highest priority
- Recognizes the edge-cloud split: safety must be real-time on-site, progress tracking can be batched
- Asks about connectivity constraints and harsh environment requirements
- Identifies BIM as the central data model that links all capabilities

### Weak Opening Signals

- Jumps to a generic microservices architecture without addressing construction-specific constraints
- Treats all processing as cloud-based without considering edge requirements
- Does not ask about data volumes (images per day, model sizes)
- Misses the distinction between real-time safety and batch analytics

---

## Key Discussion Points by Phase

### Phase 3: High-Level Design — Must-Cover Topics

**Edge-cloud architecture:**
- Safety CV runs on edge GPUs with <500 ms latency
- Progress tracking batched to cloud for overnight processing
- Edge must operate autonomously for 24+ hours during connectivity loss
- Only structured events (not raw video) transmitted to cloud

**Data flow architecture:**
- Separate ingestion paths for streaming (safety cameras) vs. batch (360-degree captures, drone surveys)
- BIM as central linking schema — all data references IFC element GUIDs
- Event-driven architecture for safety alerts; batch pipeline for progress and analytics

**Storage strategy:**
- Object storage for imagery and point clouds (petabyte-scale)
- Graph database for BIM element relationships
- Time-series database for IoT sensor data and progress tracking
- Separate hot/warm/cold tiers with automated lifecycle policies

### Phase 4: Deep Dive Options

#### Option A: Safety CV Pipeline (Recommended for CV-experienced candidates)

**Questions to probe:**
1. "Walk me through the latency budget from camera frame to safety alert."
2. "How do you handle false positives without creating alert fatigue?"
3. "What happens when the safety system detects a life-threatening hazard? Walk me through the full alert path."
4. "How do you update CV models on edge devices without interrupting safety monitoring?"

**Expected strong answers:**
- Latency budget breakdown: frame capture (10 ms) → detection (80 ms) → tracking (15 ms) → PPE check (25 ms) → dispatch (20 ms) = ~200 ms with margin
- Multi-layer deduplication: temporal (same worker within 5 min), confidence threshold (>0.85), contextual filtering (break areas exempt), temporal persistence (3+ frames)
- Blue-green model deployment on edge: new model validated on standby GPU before traffic switch
- Edge-local alert dispatch (siren, local Wi-Fi push) independent of cloud connectivity

#### Option B: Progress Tracking Pipeline (Recommended for 3D vision candidates)

**Questions to probe:**
1. "How do you compare what a 360-degree camera sees against what the BIM model says should be there?"
2. "Construction elements look different during installation vs. the final design. How do you handle this?"
3. "What does your point cloud registration pipeline look like, and what accuracy do you need?"
4. "Why batch processing instead of real-time for progress tracking?"

**Expected strong answers:**
- SfM + MVS photogrammetry pipeline producing dense point clouds; ICP registration against BIM geometry
- Construction stage taxonomy: recognizes intermediate states (rebar cage, formwork, concrete pour, stripped, finished) and maps to completion percentage
- Registration accuracy <2 cm required for element-level matching; hierarchical registration using known reference geometry
- Batch because construction progress is measured in hours/days, not seconds; real-time processing would consume 20x GPU compute with negligible incremental insight

#### Option C: BIM Clash Detection (Recommended for algorithm-focused candidates)

**Questions to probe:**
1. "A BIM model has 500,000 elements. How do you find the clashes without checking every pair?"
2. "A typical clash report has 50,000 raw clashes. How do you filter to the 1,000 that matter?"
3. "How do you handle incremental clash detection when only 1,000 elements change?"
4. "What makes a clash 'relevant' vs. 'irrelevant'?"

**Expected strong answers:**
- Spatial indexing (R-tree/octree) for broad-phase filtering reduces O(n²) to O(n log n); narrow-phase geometry intersection on candidate pairs
- ML relevance classifier trained on historical coordinator decisions; features include element types, intersection volume, discipline pair, construction sequence
- Incremental: query spatial index for neighbors of changed elements only; retest those pairs
- Relevance depends on: tolerance standards (soft vs. hard clash), construction sequence (will one element be removed before the other is installed?), maintenance access requirements, and firm-specific standards

#### Option D: Probabilistic Cost Estimation (Recommended for data/ML candidates)

**Questions to probe:**
1. "Why probability distributions instead of single-point cost estimates?"
2. "How do you handle cost items with very few historical data points?"
3. "When a design change modifies one element, how do you update the project cost estimate?"
4. "How do you model the fact that cost overruns tend to cluster — when steel prices rise, all steel elements are affected?"

**Expected strong answers:**
- Single-point estimates create false precision and anchoring bias; distributions communicate uncertainty and enable risk-informed decisions
- Hierarchical Bayesian estimation: sparse items borrowing strength from broader category distributions
- Change impact propagation through BIM relationship graph; recompute costs for affected elements + their dependent elements
- Correlated sampling in Monte Carlo: sample cost drivers (material prices, labor rates) from joint distribution first, then compute element costs conditional on drivers — captures "everything goes wrong at once" tail risk

#### Option E: Autonomous Robot Integration (Recommended for robotics/IoT candidates)

**Questions to probe:**
1. "How do you plan inspection routes for a robot in a construction site that changes geometry every day?"
2. "The robot needs to inspect a confined mechanical chase with no GPS, no Wi-Fi, and poor lighting. How does it localize and navigate?"
3. "How do you reconcile robot-captured inspection data with camera-based progress tracking data for the same zone?"
4. "What is your safety interlock design — how do you prevent a 50 kg inspection robot from injuring a worker?"

**Expected strong answers:**
- Dynamic path planning against the latest point cloud / occupancy grid, not a static map; re-plan at mission start and adapt mid-mission when unexpected obstacles are encountered
- SLAM-based localization using onboard LiDAR + IMU; pre-seed the SLAM map from the latest BIM geometry for the zone; active illumination (onboard lights) for vision in dark spaces; breadcrumb communication relays or mesh network for connectivity in signal-dead zones
- Spatial alignment: robot data is registered against BIM coordinates using the same reference frame as camera data; temporal alignment: robot inspection timestamped and merged with same-day camera progress data; conflict resolution: when robot and camera disagree on element status, robot data wins for confined/occluded spaces (higher confidence), camera data wins for open areas
- Multi-layer safety: proximity sensors trigger stop at 2 m from any person; physical bumper triggers emergency stop on contact; geofenced exclusion zones around active work areas; maximum speed limits (0.5 m/s near workers); audible and visual presence indicators; remote kill switch accessible to any worker

#### Option F: LLM-Powered Project Queries (Recommended for NLP/GenAI candidates)

**Questions to probe:**
1. "A project manager asks: 'Why is Floor 8 MEP behind schedule?' Walk me through how the system answers this using RAG."
2. "How do you prevent the LLM from hallucinating about structural load capacities or fire rating requirements — domains where wrong answers can cause physical harm?"
3. "The system has data from 50 active projects. How do you ensure project isolation so that queries about Project A never surface confidential data from Project B?"
4. "How do you handle temporal queries like 'What changed on Floor 5 between March 1 and March 15?'"

**Expected strong answers:**
- RAG pipeline: parse intent (schedule query + specific activity + root cause), retrieve relevant chunks (Floor 8 MEP schedule, progress data, risk alerts, RFI log), synthesize answer grounding every claim on retrieved data with citations; the answer traces through: planned dates, actual progress percentages, predecessor delays, weather impacts, material delivery logs
- Safety-critical grounding: structural and compliance queries are routed to a restricted RAG pipeline that only retrieves from verified engineering documents (not general project notes); responses include mandatory disclaimers; high-stakes queries (load calculations, fire ratings) require human engineer sign-off before delivery; the LLM is instructed to say "I cannot confirm this — consult the structural engineer of record" rather than guess
- Project isolation: hard tenant partitioning at the vector store level (separate namespaces per project); retrieval query includes mandatory project ID filter that cannot be overridden by prompt injection; access control layer checks user's project permissions before retrieval; regular penetration testing with cross-project extraction attempts
- Temporal queries: the RAG index includes temporally versioned snapshots of project data; the retrieval layer filters for documents valid within the queried date range; the system can diff two temporal states and present changes as a structured changelog rather than a narrative (avoiding the risk of the LLM confabulating transitions)

---

## Trap Questions and Differentiators

### Trap 1: "Why not process every camera frame in real-time for progress tracking?"

**What it tests:** Understanding of cost-benefit analysis in system design.

**Weak answer:** "We should process everything in real-time for maximum accuracy" or "Real-time is always better."

**Strong answer:** "Construction progress changes over hours and days, not seconds. Processing 60,000 images per site in real-time would consume 20x more GPU compute while providing zero incremental insight — a wall does not become 'more installed' between two 30-second frames. Daily batch processing captures all meaningful changes at a fraction of the cost. The exception is triggered on-demand processing for critical events like post-pour inspections."

### Trap 2: "Can you use facial recognition to track individual worker productivity?"

**What it tests:** Ethical reasoning and regulatory awareness.

**Weak answer:** "Yes, we can identify workers and track their output per hour."

**Strong answer:** "No, and we deliberately should not. Facial recognition for productivity tracking raises serious privacy concerns under GDPR and labor laws, creates adversarial relationships with workers, and is ethically problematic. The platform tracks zone-level and crew-level productivity (aggregate output per zone per day) rather than individual worker metrics. Safety monitoring uses body-based detection (clothing, height, PPE) without facial recognition. Worker privacy is essential for platform adoption and regulatory compliance."

### Trap 3: "Your point cloud shows an element that isn't in the BIM model. Is it an error?"

**What it tests:** Understanding of construction reality vs. design idealization.

**Weak answer:** "Flag it as an error in the point cloud processing."

**Strong answer:** "Not necessarily. Construction sites contain many elements not in the BIM model: temporary works (scaffolding, formwork, shoring), construction equipment, material laydown, protective coverings, and safety barriers. The system must distinguish between temporary elements (expected, will be removed) and unauthorized permanent installations (actual errors requiring RFIs). The classification uses a combination of temporal persistence (temporary elements appear and disappear across daily snapshots) and semantic classification (recognizing scaffolding, formwork, etc. as construction-stage artifacts)."

### Trap 4: "The clash detection found 50,000 clashes. What do you tell the project team?"

**What it tests:** Understanding that raw technical output is not actionable.

**Weak answer:** "Send them the full clash report sorted by severity."

**Strong answer:** "50,000 raw clashes are useless — no coordinator can review that volume. The system must filter to the 500–1,000 actionable clashes using ML relevance classification, cluster related clashes (20 clashes between a duct run and a beam line are one coordination issue, not 20 separate problems), and prioritize by construction schedule urgency (a clash that must be resolved before next week's concrete pour is more urgent than one in a zone not scheduled for 6 months). The output is a prioritized punch list of ~50 coordination issues, each with responsible trade, resolution deadline, and suggested fix."

### Trap 5: "How do you handle a site where internet connectivity is completely unavailable?"

**What it tests:** Edge architecture and degradation strategy.

**Weak answer:** "The system can't function without cloud connectivity."

**Strong answer:** "The edge cluster handles all safety-critical functions locally — no cloud required. Safety monitoring, alerts, and zone enforcement continue via edge GPUs with local alert dispatch (sirens, Wi-Fi push to supervisors). Progress captures continue to local storage (10 TB buffer, sufficient for 10+ days). The field app accesses cached BIM models and the previous day's progress data from the edge node. When connectivity returns, buffered data uploads in priority order: safety events first, then progress imagery. The site loses only cloud-dependent functions: cost estimation, risk prediction, and multi-site analytics."

### Trap 6: "Can you use a single model for all construction types?"

**What it tests:** Awareness of domain generalization challenges and construction diversity.

**Weak answer:** "Yes, train one large model on all construction types — it will generalize." Or "Just fine-tune the base model for each project."

**Strong answer:** "Construction types vary enormously: a residential wood-frame project has different materials, element types, safety hazards, and construction sequences than a concrete high-rise, a steel industrial facility, or a bridge. A single PPE detection model may transfer reasonably well (hard hats look similar across project types), but progress tracking models cannot generalize — the visual appearance of 'rebar installed' is completely different from 'steel erection in progress' or 'wood framing complete.' The architecture needs a model registry with construction-type-specific models for progress tracking (at minimum: concrete vertical, steel, wood frame, civil/infrastructure), a shared base model for safety detection with site-specific calibration layers, and a classification tier that routes incoming data to the appropriate model based on project metadata. Transfer learning helps — a concrete model pre-trained on 50 projects can be fine-tuned for a new concrete project with 2 weeks of site-specific data — but the expectation of a single universal model is unrealistic and would produce dangerously inaccurate progress reports on non-dominant construction types."

### Trap 7: "Why not use real-time NeRF instead of daily batch photogrammetry?"

**What it tests:** Understanding of computational cost, construction pace, and practical value delivery.

**Weak answer:** "Real-time NeRF would be better — we should aim for continuous 3D reconstruction." Or "NeRF is always better than photogrammetry."

**Strong answer:** "This conflates two different tools with different strengths. Traditional photogrammetry (SfM + MVS) produces metrically accurate point clouds optimized for geometric measurement — element detection, registration against BIM, and dimensional verification. NeRF/3DGS produces photorealistic view synthesis optimized for visual inspection — seeing what a space looks like from angles where no camera exists. They serve complementary purposes: photogrammetry for quantitative progress tracking (is this element installed? by how many centimeters is it off-spec?), NeRF for qualitative review (what does Floor 8 look like from the architect's intended vantage point?). Real-time NeRF is also computationally impractical at construction scale: training a NeRF for a single zone takes 30–60 minutes on a high-end GPU; a site with 200 zones would need 200 GPU-hours per update cycle. Daily batch is the natural cadence because construction progress measured in real-time is noise — a wall does not meaningfully change between 2:00 PM and 2:05 PM. The correct architecture uses batch photogrammetry as the geometric backbone (daily) and NeRF as an on-demand view synthesis tool (triggered when stakeholders need a specific viewpoint)."

---

## Case Studies

### Case Study 1: Mega-Project with 2,000+ Cameras

**Scenario:** A $3.5B airport terminal expansion with 2,200 fixed cameras across 12 construction zones, 6 active tower cranes, daily drone surveys, and 4,500 peak workers. The platform must process 150,000 safety frames per minute and produce daily progress reports covering 1.2 million BIM elements.

**Discussion prompts:**
1. "How do you partition the edge compute layer for 2,200 cameras? What determines which cameras share an edge node?"
2. "At 150,000 frames per minute, how much bandwidth do you need between edge and cloud? How do you minimize it?"
3. "1.2 million BIM elements — your spatial index for clash detection has O(n log n) performance. What are the practical limits, and when do you need to partition the model?"

**What strong candidates address:**
- Edge partitioning by physical zone (not arbitrary): cameras in the same physical area share an edge node for cross-camera tracking (same worker visible in multiple cameras). Each zone gets a dedicated edge cluster (2-3 nodes for N+1 redundancy). Zone boundaries align with construction zones for independent operation.
- Bandwidth minimization: only structured events (bounding boxes, classifications, counts) flow to cloud, not raw video. At 2,200 cameras generating ~500 events per camera per hour, that is ~200 KB/s total — trivial bandwidth. Raw frames only upload for the daily progress capture batch (360-degree images, not security camera feeds).
- BIM partitioning: at 1.2M elements, a single R-tree exceeds practical memory for interactive clash detection. Partition by discipline (structural, mechanical, electrical, plumbing) and by zone. Intra-discipline, intra-zone clashes run in parallel; cross-discipline clashes run at zone level; cross-zone clashes run only at zone boundaries. This reduces effective n per query from 1.2M to ~50K.

### Case Study 2: International Project with Multi-Region Data Sovereignty

**Scenario:** A global engineering firm operates the platform across 35 sites in 12 countries. Data sovereignty regulations require that worker imagery never leaves the country of capture (GDPR in the EU, PIPL in China, LGPD in Brazil). The firm wants centralized risk analytics and cross-project ML training.

**Discussion prompts:**
1. "How do you architect the system to keep worker imagery in-country while enabling cross-project analytics?"
2. "You want to train a unified safety CV model using data from all 35 sites, but you cannot centralize the training data. What approach do you use?"
3. "A project manager in London wants to see progress dashboards for a site in Beijing. What data can cross the border?"

**What strong candidates address:**
- Tiered data classification: raw imagery (contains faces, bodies) is Tier 1 — never leaves the country. Aggregated analytics (zone-level counts, compliance percentages, progress percentages) is Tier 2 — can be centralized after anonymization. BIM models and cost data (no personal data) is Tier 3 — centralized freely. The architecture deploys per-country processing clusters that produce Tier 2 outputs locally, then sync aggregated data to the central analytics layer.
- Federated learning for cross-site ML: each site trains locally on its own data and uploads model weight updates (gradients) — not training data — to the central model server. The central server aggregates gradients (federated averaging) and distributes the improved model back to sites. Differential privacy noise is added to gradients to prevent reconstruction of individual training images from gradient inspection.
- Cross-border dashboards show Tier 2 data only: progress percentages, schedule status, cost metrics, risk scores. No imagery, no video, no worker-level data. The dashboard clearly labels data residency ("imagery processed in CN-Beijing; aggregates shown here").

### Case Study 3: Renovation Project with Existing Structure Scan

**Scenario:** A 1960s hospital is being renovated while partially occupied. The existing structure has no BIM model — only 60-year-old paper drawings of uncertain accuracy. The platform must create a digital twin of the existing conditions before renovation design can begin.

**Discussion prompts:**
1. "How do you create a BIM model from a physical building that has no digital records? What is your scan-to-BIM pipeline?"
2. "The building is partially occupied — patients and staff are present. How does this constrain your safety monitoring and progress tracking?"
3. "Renovation demolition reveals hidden conditions (asbestos, outdated wiring, structural modifications not on drawings). How does the system handle these discoveries?"

**What strong candidates address:**
- Scan-to-BIM pipeline: LiDAR scanning produces a dense point cloud of existing conditions. AI-assisted element recognition identifies walls, columns, beams, pipes, ducts from the point cloud and generates a parametric BIM model. Human BIM modelers review and correct the AI-generated model (expect 70-80% automation, 20-30% manual correction). The scan-to-BIM process takes 2-4 weeks for a building of this size. Critical: the existing conditions model has uncertainty — wall thicknesses may be approximate, hidden elements (in-wall piping) are inferred, not measured. The model must carry uncertainty metadata per element.
- Occupied building constraints: safety monitoring must distinguish between construction workers (PPE required) and building occupants (no PPE expected). The system uses zone-based classification — construction zones require PPE, occupied zones do not. Buffer zones at boundaries require both populations to follow safety rules. Progress tracking must handle occupied areas that cannot be scanned (patient rooms in use). The system maintains a "scannable area" map that updates daily as areas are vacated and released for renovation.
- Hidden condition discovery: when demolition reveals conditions that contradict the existing conditions model (asbestos behind a wall, a structural modification not on drawings), the system must support rapid model updates. The discovery triggers: (1) immediate safety response (asbestos = work stoppage + abatement protocol), (2) BIM model update with the as-found condition, (3) impact propagation through the design model (does this change the structural analysis? the MEP routing?), (4) cost estimate update reflecting the changed scope, (5) schedule impact analysis for the remediation work. The platform must handle these "change discoveries" as a first-class workflow, not an exception.

---

## Scoring Rubric

### Senior Engineer (L5) — Expected Competencies

| Area | Expectation | Score Weight |
|---|---|---|
| Edge-cloud split | Identifies that safety must be edge, analytics can be cloud | 20% |
| Data volume estimation | Reasonable estimates for imagery, point clouds, BIM sizes | 15% |
| BIM as central schema | Uses BIM elements as primary key linking all platform data | 15% |
| Pipeline design | Separates streaming (safety) from batch (progress) processing | 15% |
| Storage strategy | Object storage for imagery, tiered retention, regulatory compliance | 10% |
| Deep dive depth | Can discuss one area (CV, photogrammetry, or scheduling) in detail | 15% |
| Trade-off reasoning | Articulates cost-benefit of batch vs. real-time, accuracy vs. coverage | 10% |

### Staff Engineer (L6) — Additional Expectations

| Area | Expectation | Score Weight |
|---|---|---|
| Construction domain nuance | Understands construction stages, trade dependencies, temporal dependency types | 15% |
| ML model lifecycle | Addresses model drift, ground truth collection, edge model updates | 15% |
| Probabilistic thinking | Cost distributions, risk scores with calibration, confidence-aware decisions | 15% |
| Worker privacy | Proactively identifies privacy concerns without prompting | 10% |
| Multi-site scaling | Site-affinity processing, burst scaling, cross-site ML training | 15% |
| Edge resilience | Autonomous operation, degradation hierarchy, reconnection protocol | 15% |
| System-of-systems | How BIM intelligence feeds risk prediction, which feeds resource optimization, creating a closed-loop system | 15% |

---

## Follow-Up Questions for Strong Candidates

1. "How would you handle a scenario where the BIM model is updated mid-construction, changing elements that are already partially built? How does the progress tracking system handle the transition?"

2. "Your safety CV model performs well on one site but poorly when deployed to a different site with different lighting, camera angles, and construction type. How do you handle this domain shift?"

3. "A subcontractor disputes your AI-generated progress report, claiming their work is further along than the system shows. How do you design the system to handle this dispute?"

4. "How do you handle the 'last 10%' problem — progress tracking accuracy degrades in the final finishing stages when elements are small, numerous, and visually similar (outlet covers, switch plates, ceiling tiles)?"

5. "The risk prediction model says there's an 80% probability of a 3-week delay on the critical path. The project manager disagrees based on experience. How should the system present this information?"

6. "You need to deploy the platform to a site in a developing country with unreliable power (4-6 outages per week, each lasting 30 minutes to 3 hours). How do you design for this?"

7. "Two different AI models disagree: the progress tracking model says the concrete pour on Floor 7 is complete, but the IoT sensors embedded in the formwork say the concrete temperature never reached pour levels. How do you design a reconciliation system?"

8. "The platform has been running on 20 projects for 2 years. A new general contractor wants to adopt it but demands that their project data be completely isolated from all other clients — including the ML models trained on other clients' data. How do you handle this?"

---

## Common Mistakes to Watch For

| Mistake | Why It Is Wrong | What Good Looks Like |
|---|---|---|
| Treating all data as cloud-first | Safety latency budget cannot survive a round trip to cloud; worker lives depend on sub-second edge inference | Safety on edge, analytics in cloud — clearly separated by latency requirement |
| Ignoring BIM as the linking schema | Without BIM element GUIDs as primary keys, progress data, safety zones, cost items, and schedule activities become disconnected silos | Every data point references a BIM element GUID; BIM is the ontology, not just a 3D model |
| Uniform model deployment across cameras | Per-camera accuracy varies 82%-99% due to angle, height, lighting; aggregate metrics hide dangerous blind spots | Per-camera calibration profiles with camera-specific confidence thresholds |
| Assuming clean BIM input | Real BIM models have naming inconsistencies, missing elements, version conflicts between disciplines; "garbage in" is the default state | Robust IFC parsing with validation, normalization, and error recovery — not just a happy-path parser |
| Single-point cost estimates | Creates false precision and anchoring bias; hides the fat-tailed risk distribution that actually determines project financial outcomes | Probabilistic distributions with correlated sampling; communicate uncertainty ranges, not single numbers |
| Designing for steady-state only | Construction sites change constantly — new floors, seasonal weather, crew composition shifts; a system tuned for today breaks next month | Continuous monitoring for drift, adaptive thresholds, automated recalibration pipelines |
| Neglecting the human workflow | The best AI output is useless if it does not fit into the superintendent's 6 AM routine or the coordinator's clash review workflow | Design outputs around existing construction workflows: daily reports at shift start, clash lists in coordination meeting format |
