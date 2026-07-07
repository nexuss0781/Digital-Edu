# Requirements & Estimations — AI-Native Cybersecurity Platform

## Functional Requirements

### Core Features

1. **Endpoint Telemetry Ingestion** — Collect process creation/termination, file system operations, registry modifications, network connections, loaded modules, and in-memory activity from lightweight agents deployed on endpoints (servers, workstations, containers, VMs). Support both kernel-mode (driver-based) and user-mode collection with <2% CPU overhead.

2. **Real-Time Threat Detection (ML + Rules)** — Evaluate every incoming event against a layered detection engine: static signature matching (known IOCs), behavioral rules (MITRE ATT&CK-mapped TTPs), and ML models (classification, anomaly detection, sequence models). Produce scored alerts within 1 second of event ingestion for critical detections.

3. **Behavioral Analysis & Anomaly Detection (UEBA)** — Build dynamic behavioral baselines for every user, device, application, and service account. Detect deviations such as: unusual login times/locations, impossible travel, privilege escalation outside defined roles, lateral movement patterns, and abnormal data access volumes. Baselines adapt over a rolling window (7-30 days).

4. **SIEM Log Aggregation & Correlation** — Ingest, normalize, and store logs from heterogeneous sources: firewalls, proxies, DNS, VPN, cloud audit trails, SaaS applications, identity providers. Correlate events across sources using time, entity, and kill-chain-stage dimensions. Support both streaming correlation (real-time) and batch correlation (historical).

5. **SOAR Automated Playbooks** — Define, test, and execute automated response workflows triggered by alerts or alert patterns. Playbooks support: conditional branching, parallel execution, human-in-the-loop approval gates, enrichment steps (threat intel lookup, asset inventory query), and response actions (isolate endpoint, block IP, disable user, create ticket). Visual and YAML-based authoring.

6. **EDR/XDR Unified Detection** — Correlate detections across multiple domains (endpoint + network + cloud + identity + email) into unified incidents. An attacker phishing a user (email), stealing credentials (identity), moving laterally (network), and exfiltrating data (endpoint + cloud) should produce a single correlated incident, not four siloed alerts.

7. **Threat Intelligence Integration** — Ingest IOC feeds from commercial providers, open-source feeds (MISP, AlienVault OTX), government feeds (CISA, CERT), and ISACs via STIX/TAXII protocols. Score and age IOCs based on source reliability, context, and freshness. Enrich incoming events with matched threat intel in real-time during ingestion.

8. **Incident Investigation & Forensics** — Provide analysts with a timeline-based investigation console showing the full attack chain: initial access vector, persistence mechanisms, lateral movement path, data staging/exfiltration, and impacted assets. Support drill-down from incident → alert → raw event → endpoint forensic snapshot.

9. **Vulnerability Management Integration** — Correlate detected threats with known vulnerabilities on affected assets. Prioritize vulnerabilities by exploitability (is there active exploitation in the wild?) and exposure (is the vulnerable asset internet-facing?).

10. **GenAI Security Copilot** — Natural-language interface for threat hunting (analysts describe what they're looking for in English, the system generates structured queries), automated incident summarization (multi-paragraph human-readable narratives from raw alert chains), playbook generation from natural-language descriptions, and conversational investigation assistance. The copilot augments analysts but never executes response actions autonomously — it always recommends and waits for confirmation.

11. **Identity Threat Detection and Response (ITDR)** — Dedicated detection engine for identity-layer attacks: credential stuffing, token theft, OAuth consent phishing, service principal abuse, Kerberoasting, Golden Ticket attacks, impossible travel, and dormant account activation. Integrates with identity providers (directory services, SSO, MFA platforms) and correlates identity signals with endpoint and network telemetry.

12. **Attack Surface Management (ASM)** — Continuous external discovery of internet-facing assets (domains, subdomains, IPs, certificates, exposed services) belonging to the organization. ASM findings enrich the detection engine by identifying assets that are: (a) unknown to IT inventory (shadow IT), (b) running vulnerable services, (c) exposing sensitive data, or (d) at risk of certificate expiry. ASM-discovered assets receive elevated monitoring priority.

13. **Cloud Workload Protection (CNAPP Integration)** — Extend detection coverage to cloud-native workloads: container runtime protection, serverless function monitoring, infrastructure-as-code misconfiguration detection, cloud security posture management (CSPM) findings correlation with runtime alerts, and Kubernetes audit log analysis.

### Out of Scope

- Penetration testing and red-team simulation tooling
- Physical security (CCTV, badge access) integration
- Full packet capture and deep packet inspection (DPI) — the platform ingests metadata and flow data, not full payloads
- Governance, risk, and compliance (GRC) platform functionality
- Managed detection and response (MDR) human analyst staffing
- Data loss prevention (DLP) content inspection — the platform detects data exfiltration patterns, not content classification
- Deception technology / honeypots (complementary but separate product)

### Feature Prioritization Matrix

| Feature | Detection Value | Implementation Complexity | Priority |
|---------|----------------|--------------------------|----------|
| Endpoint telemetry ingestion | Critical — foundation of all detection | High (agent + pipeline) | P0 |
| Real-time ML + rule detection | Critical — core detection capability | Very high (ML + streaming) | P0 |
| SIEM log aggregation | High — cross-source correlation | High (heterogeneous sources) | P0 |
| Alert correlation (incidents) | Critical — reduces alert volume 100x | High (graph algorithms) | P0 |
| SOAR automated playbooks | High — reduces MTTR 10x | Medium (workflow engine) | P1 |
| UEBA behavioral analysis | High — insider threat detection | High (baseline computation) | P1 |
| Threat intelligence integration | Medium — enriches context | Medium (feed integration) | P1 |
| ITDR identity detection | High — #1 attack vector | High (identity graph analysis) | P1 |
| GenAI security copilot | Medium — analyst productivity | High (LLM orchestration + safety) | P2 |
| ASM external discovery | Medium — exposure prioritization | Medium (scanning + enrichment) | P2 |
| CNAPP cloud workload protection | Medium — cloud coverage gap | Medium (cloud API integration) | P2 |

---

## Non-Functional Requirements

### CAP Theorem Position

**AP (Availability + Partition Tolerance)** — Security telemetry must continue flowing even during network partitions. Endpoint agents must cache and forward events when connectivity to the cloud is interrupted. Detection decisions at the edge must proceed without central coordination. Eventual consistency is acceptable for alert metadata enrichment; strong consistency is required only for response action coordination (to prevent duplicate isolations or conflicting playbook executions).

### Consistency Model

**Tiered Consistency:**
- **Event ingestion:** Eventual consistency — events may arrive out of order; the pipeline reorders within a configurable time window (default: 60 seconds)
- **Alert state:** Sequential consistency — alert status transitions (new → triaged → investigating → resolved) must be ordered per-alert
- **Response actions:** Linearizable — isolation commands, IP blocks, and user disablements must execute exactly once with strong ordering guarantees to prevent conflicting actions
- **Copilot context:** Session-scoped consistency — each analyst's copilot session maintains a consistent view of the investigation state; concurrent sessions on the same incident are independently consistent
- **Behavioral baselines:** Eventually consistent (daily batch) — baselines reflect activity from the most recent computation window; new activity affects scoring within the next batch cycle

### Availability Target

| Component | Target | Rationale |
|-----------|--------|-----------|
| Endpoint agent (local detection) | 99.99% | Agent must continue protecting even during cloud outages |
| Telemetry ingestion pipeline | 99.95% | Brief ingestion delays acceptable; agents buffer locally |
| Real-time detection engine | 99.95% | Delayed detections during maintenance windows acceptable (agents still protect locally) |
| SOAR playbook executor | 99.9% | Automated responses can tolerate brief delays; critical actions fall back to manual |
| Investigation console (UI) | 99.9% | Standard web application availability |
| Threat intel service | 99.9% | Stale intel for minutes is acceptable; local cache covers gaps |

### Latency Targets

| Operation | p50 | p95 | p99 |
|-----------|-----|-----|-----|
| Endpoint agent local detection (on-device) | <50ms | <100ms | <200ms |
| Cloud detection (event → alert) | <500ms | <1s | <3s |
| Alert correlation (alert → incident) | <5s | <15s | <30s |
| SOAR playbook trigger (alert → first action) | <10s | <30s | <60s |
| Threat hunting query (ad-hoc, 7 days) | <5s | <15s | <30s |
| Threat hunting query (ad-hoc, 90 days) | <30s | <60s | <120s |
| Threat intel enrichment (per event) | <10ms | <50ms | <100ms |
| Investigation timeline render | <2s | <5s | <10s |

### Durability Guarantees

- **Raw telemetry events:** At-least-once delivery from agent to cloud; deduplication at ingestion layer
- **Security alerts:** Durable with write-ahead log; zero-alert-loss guarantee
- **Incidents and investigation data:** Strongly durable with replication; 7-year retention for compliance
- **Playbook execution logs:** Immutable audit trail with tamper-evident logging
- **Threat intel IOCs:** Best-effort with periodic full-sync; local cache survives feed outages
- **Copilot session state:** Ephemeral; session state is not persisted beyond the active investigation; copilot can reconstruct context from incident data at any time
- **ITDR identity baselines:** Same durability as UEBA baselines — daily snapshot with incremental updates; baseline loss triggers cold-start procedure using peer group fallback

---

## Capacity Estimations (Back-of-Envelope)

**Reference deployment:** Large enterprise — 100,000 endpoints, 50,000 users, 10,000 servers, 5,000 cloud workloads, 500 network sensors.

### Event Volume

| Source | Events/sec | Calculation |
|--------|-----------|-------------|
| Endpoint agents (processes) | 500K | 100K endpoints x 5 process events/sec |
| Endpoint agents (network) | 1M | 100K endpoints x 10 connection events/sec |
| Endpoint agents (file/registry) | 300K | 100K endpoints x 3 file events/sec |
| Network flow sensors | 200K | 500 sensors x 400 flows/sec |
| Cloud audit logs | 50K | 5,000 workloads x 10 events/sec |
| Identity provider logs | 10K | Login events, token refreshes, MFA events |
| Firewall/proxy logs | 100K | 500 appliances x 200 events/sec |
| **Total** | **~2.2M events/sec** | **~190B events/day** |

### Storage

| Tier | Retention | Size | Calculation |
|------|-----------|------|-------------|
| Hot (streaming + real-time queries) | 24 hours | ~15 TB | 2.2M events/sec x 80 bytes avg (compressed) x 86,400s |
| Warm (threat hunting queries) | 30 days | ~450 TB | 15 TB/day x 30 days |
| Cold (compliance + forensics) | 1 year | ~2 PB | 15 TB/day x 365 days (further compressed ~3:1) |
| Deep archive (regulatory) | 7 years | ~5 PB | Heavily compressed, sampled, indexed |

### Compute

| Component | Resources | Calculation |
|-----------|-----------|-------------|
| Ingestion pipeline | 200 nodes | 2.2M events/sec / 11K events/sec/node |
| ML detection engine | 100 GPU nodes | Batch inference at ~22K events/sec/GPU |
| Rule evaluation engine | 80 nodes | 5,000 rules evaluated per event, optimized with decision trees |
| Behavioral baseline compute | 50 nodes | Nightly recomputation for 50K users + 100K devices |
| Correlation engine | 40 nodes | Sliding window join across alert streams |
| SOAR orchestrator | 20 nodes | Playbook execution with API integrations |
| Search/query cluster | 60 nodes | Distributed search over 30-day warm tier |

### Network Bandwidth

| Path | Bandwidth | Calculation |
|------|-----------|-------------|
| Agent → ingestion (aggregate) | ~20 Gbps | 2.2M events/sec x 1KB avg raw size / compression ratio 8:1 |
| Ingestion → detection pipeline | ~25 Gbps | Enriched events slightly larger than raw |
| Detection → storage | ~15 Gbps | Post-dedup, post-filter events to storage layer |
| Inter-AZ replication | ~10 Gbps | Cross-AZ replication for durability |

---

## SLOs / SLAs

| Metric | SLO | SLA | Measurement |
|--------|-----|-----|-------------|
| Mean Time to Detect (MTTD) — critical threats | <1 min | <5 min | Time from malicious activity to alert generation |
| Mean Time to Detect (MTTD) — advanced persistent threats | <1 hour | <4 hours | Behavioral detection lag for slow-and-low attacks |
| Mean Time to Respond (MTTR) — automated | <5 min | <15 min | Time from alert to first containment action (automated playbook) |
| False positive rate (critical alerts) | <1% | <3% | False positives / total critical alerts over 30 days |
| False positive rate (all alerts) | <5% | <10% | False positives / total alerts over 30 days |
| Detection coverage (MITRE ATT&CK) | >85% techniques | >70% techniques | Techniques with at least one active detection |
| Event ingestion completeness | >99.9% | >99.5% | Events received / events generated by agents |
| Threat intel freshness | <15 min | <60 min | Time from feed publication to enrichment availability |
| Investigation query completeness | 100% (30-day) | 100% (30-day) | All events within retention window queryable |
| Platform availability | 99.95% | 99.9% | Uptime of detection + response pipeline |
| Copilot query accuracy | >85% | >70% | Generated queries return relevant results (measured by analyst acceptance rate) |
| ITDR detection (token theft) | <5 min | <15 min | Time from token replay to identity alert |

---

## Constraints Unique to Security Platforms

### The Adversarial Environment

| Constraint | Impact |
|------------|--------|
| Attackers actively evade detection | Models must detect evasion techniques (process hollowing, living-off-the-land, fileless malware); static signatures alone are insufficient |
| Endpoint agents are targets | Agents must resist tampering, unloading, and blinding; self-protection is a first-class requirement |
| Response actions have blast radius | Isolating an endpoint disconnects a user; blocking an IP may break legitimate traffic; automated response requires confidence thresholds |
| Data is highly sensitive | Security telemetry reveals internal architecture, vulnerabilities, and user behavior; the platform itself is a high-value target |
| Regulatory fragmentation | Different jurisdictions have different data residency, retention, and breach notification requirements (GDPR, CCPA, HIPAA, PCI DSS, FedRAMP) |

### Alert Fatigue Economics

| Metric | Typical Value | Impact |
|--------|---------------|--------|
| Raw alerts per day (large enterprise) | 10,000-50,000 | Impossible for human analysts to review all |
| Analyst capacity (alerts reviewed/day) | 50-100 | ~200x gap between alert volume and review capacity |
| Required deduplication + correlation ratio | >99% | Must reduce 50K alerts to <500 incidents for human review |
| Cost per false positive investigation | ~$30 (15 min analyst time) | 1,000 false positives/day = $30K/day wasted |

### The GenAI Copilot Impact on SOC Economics

| Metric | Without Copilot | With GenAI Copilot | Impact |
|--------|----------------|-------------------|--------|
| Mean investigation time per alert | 15-30 min | 5-10 min | Copilot auto-summarizes context, reducing context-switching |
| Query authoring time (threat hunting) | 5-15 min per query | 30 sec (natural language) | Analysts describe intent; copilot generates structured KQL |
| Playbook creation time | 2-4 hours per playbook | 15-30 min (guided generation) | Copilot scaffolds playbooks from natural-language descriptions |
| Tier 1 → Tier 2 escalation rate | 25-40% | 10-15% | Copilot assists Tier 1 with investigation steps previously requiring Tier 2 expertise |
| Analyst effective capacity (incidents/day) | 50-100 | 150-300 | 2-3x multiplier from reduced context-switching and automated summarization |

### Identity Attack Landscape (Driving ITDR Requirements)

| Attack Vector | Frequency Trend (2024-2026) | Detection Challenge |
|---------------|----------------------------|---------------------|
| Credential stuffing / password spray | Stable (high volume) | Must distinguish from legitimate failed logins; per-account and per-source rate analysis |
| Token theft / session hijacking | Rapidly increasing | Stolen tokens bypass MFA; detection requires binding tokens to device fingerprints and detecting token replay from new devices |
| OAuth consent phishing | Emerging | Malicious app registration tricks users into granting permissions; requires monitoring consent grants and app reputation scoring |
| MFA fatigue / push bombing | Increasing | Attacker repeatedly triggers MFA prompts until user approves; requires detecting rapid MFA prompt sequences |
| Service principal abuse | Increasing (cloud-native attacks) | Legitimate-looking API calls from compromised service accounts; requires behavioral baselines per service principal |
| Golden Ticket / Silver Ticket (Kerberos) | Stable (advanced adversaries) | Forged authentication tickets; requires Kerberos ticket metadata analysis and impossible-timeline detection |
| Adversary-in-the-Middle (AiTM) phishing | Rapidly increasing | Proxies real login page to steal session cookies post-MFA; requires detecting anomalous session origins |

---

## Cost Model (Annual)

**Reference deployment:** Large enterprise — 100,000 endpoints, multi-region.

| Cost Category | Estimate | Calculation |
|---------------|----------|-------------|
| Compute (ingestion + detection + correlation) | ~$2.5M/yr | ~550 nodes × avg instance cost × 12 months |
| GPU compute (ML inference) | ~$1.2M/yr | ~100 GPU nodes × GPU instance cost × 12 months |
| Hot storage (24h streaming) | ~$0.5M/yr | ~15 TB × high-performance storage pricing |
| Warm storage (30-day search) | ~$1.8M/yr | ~450 TB × search-optimized storage pricing |
| Cold/archive storage (1-7 years) | ~$0.3M/yr | ~2-5 PB × object storage pricing (heavily compressed) |
| Network (agent → cloud) | ~$0.8M/yr | ~20 Gbps sustained egress pricing |
| Threat intelligence feeds | ~$0.3M/yr | Commercial + open-source feed subscriptions |
| **Total platform cost** | **~$7.4M/yr** | **~$74/endpoint/year** |

**Industry benchmark:** Commercial XDR/EDR platform pricing ranges from $50-150 per endpoint per year, confirming the cost model is realistic for a platform-grade deployment.

### Key Cost Optimization Levers

| Lever | Savings Potential | Trade-Off |
|-------|------------------|-----------|
| **Agent-side pre-filtering** | 30-40% ingestion cost | Some low-value events never reach cloud; reduces threat hunting completeness |
| **ML cascade (reduce GPU usage)** | 20x GPU cost reduction | Fast classifier must maintain low false-negative rate to avoid missing threats |
| **Lakehouse storage tiering** | 100x storage cost (hot → archive) | Older data queries are slower; compliance retrieval takes hours not seconds |
| **Decoupled compute** | 30-40% compute cost | On-demand hunting clusters add startup latency; always-on detection is non-negotiable |
| **Per-tenant resource pools** | 20-30% for MSSP | Noisy neighbor risk increases; must maintain per-tenant SLA guarantees |
