# 13.2 AI-Native Logistics & Supply Chain Platform — Security & Compliance

> This document covers the regulatory landscape (CTPAT, AEO, FSMA, GDP, HACCP), driver privacy (GDPR, ELD), tenant data isolation, API security for 80K+ carriers, cold chain audit trails, domain-specific threat models, data residency, and AI/ML security considerations.

---

## Regulatory Landscape

The logistics and supply chain platform operates at the intersection of international trade compliance, food safety regulation, driver privacy law, and supply chain security programs. Multiple regulatory frameworks impose overlapping obligations across different geographies and cargo types.

### Supply Chain Security Programs

#### CTPAT (Customs-Trade Partnership Against Terrorism) — US

CTPAT is a voluntary US Customs and Border Protection program that provides expedited customs processing for certified importers, carriers, and logistics providers in exchange for demonstrating supply chain security best practices.

**System obligations:**

| Requirement | Implementation |
|---|---|
| Cargo tracking and visibility | End-to-end shipment tracking with tamper-evident seal verification at each handoff point; audit trail of all custody transfers |
| Access control for shipment data | Role-based access control ensuring that only authorized personnel can view or modify shipment records; per-tenant data isolation |
| Physical security documentation | Integration with facility security systems for dock door access logs, surveillance footage timestamps linked to shipment events |
| Container inspection records | Structured recording of container inspection results (7-point inspection) with photo evidence stored in tamper-evident object storage |
| Incident reporting | Automated alert pipeline for security anomalies (unexpected route deviations, seal breaks, unauthorized access attempts) |

#### AEO (Authorized Economic Operator) — EU

The EU AEO program provides customs simplifications for certified traders. Requirements align with CTPAT but include additional data handling and risk assessment obligations.

| Requirement | Implementation |
|---|---|
| Risk assessment documentation | Automated risk scoring for each shipment based on origin, commodity type, carrier history, and route |
| Self-assessment questionnaire | System generates pre-filled AEO Self-Assessment Questionnaire from platform data (shipment volumes, carrier certifications, security measures) |
| Continuous monitoring | Real-time compliance monitoring dashboard showing AEO-relevant metrics; alert on deviations from certified practices |

### Cold Chain Compliance

#### FDA FSMA (Food Safety Modernization Act) — US

The FSMA Sanitary Transportation rule requires temperature-controlled transportation of food to maintain safe conditions throughout the supply chain.

**System obligations:**

| Requirement | Implementation |
|---|---|
| Continuous temperature monitoring | IoT sensor readings every 60 seconds; readings stored with tamper-evident timestamps |
| Temperature excursion documentation | Automated detection when temperature exits the defined range; excursion report with duration, max deviation, and corrective action taken |
| Shipper-carrier agreement documentation | Structured records of agreed temperature specifications per shipment type |
| Vehicle pre-cooling verification | Sensor-confirmed pre-cooling completion before cargo loading; pre-cool certificate generated automatically |
| Audit trail retention | 2-year retention of all temperature records, excursion reports, and corrective actions in immutable storage |

#### EU GDP (Good Distribution Practice) — EU

EU GDP governs the distribution of medicinal products and requires documented temperature control throughout the supply chain.

| Requirement | Implementation |
|---|---|
| Qualification of transport equipment | Vehicle and container qualification records linked to shipment assignments; alerts if unqualified vehicle assigned to GDP shipment |
| Deviation management | Temperature excursions generate deviation records requiring disposition decision (release, quarantine, reject) with documented rationale |
| Annual GDP audit support | System generates audit-ready reports: temperature compliance rates, deviation summaries, vehicle qualification status |

### HACCP (Hazard Analysis Critical Control Points)

HACCP requires identification and monitoring of critical control points in the food supply chain.

| Requirement | Implementation |
|---|---|
| Critical control point monitoring | Temperature checkpoints at pickup, each transfer point, and delivery; automated compliance verification at each CCP |
| Corrective action records | When a CCP limit is exceeded, the system records the corrective action taken and who authorized the disposition decision |
| Verification records | Periodic verification that monitoring equipment (sensors) is calibrated; calibration certificates linked to sensor IDs |

---

## Driver Privacy and Telematics Data

### GDPR Compliance for Driver Telematics (EU)

Driver location tracking via telematics is classified as personal data processing under GDPR. The platform must balance operational requirements (fleet visibility, route compliance, safety monitoring) with driver privacy rights.

| Obligation | Implementation |
|---|---|
| Lawful basis for processing | Legitimate interest for fleet management; explicit consent for driving behavior scoring used in performance evaluation |
| Purpose limitation | Telematics data collected for operational purposes (route tracking, safety, maintenance) may not be repurposed for surveillance or disciplinary action without separate consent |
| Data minimization | Location precision reduced after delivery completion (exact GPS → city-level); historical routes retained at reduced resolution |
| Driver access rights | Drivers can request export of their telematics data through a self-service portal; fulfilled within 30 days |
| Off-duty privacy | Telematics collection paused or anonymized during off-duty hours; driver mobile app allows explicit clock-out that stops location reporting |
| Data retention | Operational telematics retained for 90 days at full resolution; aggregated to daily summaries after 90 days; summaries retained for 3 years for safety compliance; then purged |

### ELD (Electronic Logging Device) Compliance — US

US FMCSA requires electronic logging of driver hours of service (HOS). The platform's fleet management module integrates ELD data.

| Requirement | Implementation |
|---|---|
| Tamper-resistant logging | HOS records written to append-only store; driver cannot edit after 24-hour certification window |
| Roadside inspection access | ELD data exportable in standard format for DOT roadside inspections via Bluetooth or USB |
| Data retention | 6 months of ELD records retained per FMCSA requirement; archived in immutable storage |

---

## Data Architecture and Tenant Isolation

### Multi-Tenant Shipment Data Isolation

Shipment data is competitively sensitive—a shipper's shipping volumes, carrier choices, and supply chain network structure are proprietary business intelligence.

```
Tenant isolation design:
  Storage:     All tables partitioned by tenant_id; queries include tenant_id filter
               enforced at the query layer (not just application logic)
  Encryption:  Per-tenant encryption keys in managed KMS; key rotation every 90 days
  Access:      API authentication yields tenant context; all downstream queries scoped
  Audit:       Every data access logged with {accessor, tenant_id, resource, timestamp}

  Cross-tenant data:
    Carrier performance data is aggregated ACROSS tenants (carrier scorecard)
    But: individual shipment details are NEVER visible across tenants
    Aggregation rule: carrier statistics computed from ≥ 50 shipments across ≥ 5 tenants
    to prevent reverse engineering of any single tenant's volume
```

### Carrier Data Handling

Carriers share data with the platform (tracking, capacity, rates) under contractual agreements that restrict redistribution. The platform must ensure:

- Carrier rate data is visible only to the tenant who received the rate quote; never exposed to other shippers or competing carriers
- Carrier capacity data (available trucks, available lanes) is anonymized when used for aggregate market intelligence
- Carrier performance scores are computed from multi-tenant data but presented without revealing which tenants contributed to the score

---

## API Security

### Carrier API Integration Security

The platform integrates with 80,000+ carriers, each with different API authentication mechanisms:

```
Integration security:
  Authentication:
    - OAuth 2.0 for modern carrier APIs
    - API key + HMAC for legacy carrier APIs
    - AS2 with digital certificates for EDI integrations
    - mTLS for high-security carrier connections

  Credential management:
    - All carrier credentials stored in managed secrets store (not in application config)
    - Per-carrier API key rotation policy (90-day default; 30-day for high-risk carriers)
    - Automated credential rotation with zero-downtime key swap

  Rate limiting:
    - Per-carrier rate limits enforced at connector hub level
    - Carrier API rate limit metadata stored per connector
    - Exponential backoff on 429 responses; circuit breaker after 5 consecutive failures

  Data validation:
    - All carrier API responses validated against expected schema before ingestion
    - Malformed responses logged and quarantined; not propagated to downstream services
    - Input sanitization on all carrier-provided text fields (shipment reference numbers,
      driver names) to prevent injection attacks
```

### Customer-Facing Tracking Page Security

The tracking page is publicly accessible (customers receive a tracking link without authentication). Security requirements:

| Threat | Mitigation |
|---|---|
| Shipment enumeration | Tracking IDs are cryptographically random UUIDs; no sequential or predictable pattern |
| Sensitive data exposure | Tracking page shows: status, ETA, city-level location. Does NOT show: exact GPS coordinates, cargo contents, shipper identity, carrier identity, pricing |
| Tracking link leakage | Tracking links expire 30 days after delivery; after expiry, page shows "delivered" status only |
| Bot scraping | Rate limiting per IP; CAPTCHA after 10 rapid tracking page requests from same IP |

---

## Audit Trail Design

### Cold Chain Audit Trail

Cold chain audit records must be tamper-evident, timestamped with trusted time sources, and retained for regulatory review:

```
cold_chain_audit_entry {
  entry_id:        UUID
  shipment_id:     UUID
  event_type:      enum  -- SENSOR_READING | EXCURSION_DETECTED | EXCURSION_RESOLVED |
                         -- PRE_COOL_VERIFIED | CCP_CHECK | DISPOSITION_DECISION
  timestamp:       timestamp (from trusted NTP source, not sensor clock)
  sensor_id:       string
  reading:         {temperature_c, humidity_pct, location}
  excursion_detail: {threshold_c, actual_c, deviation_c, duration_sec} | null
  actor:           string          -- sensor_id, system_id, or user_id
  disposition:     string | null   -- RELEASE | QUARANTINE | REJECT (for disposition decisions)
  rationale:       string | null   -- human-provided rationale for disposition
  prev_entry_hash: bytes[32]       -- SHA-256 of previous entry (hash chain)
  entry_hmac:      bytes           -- HMAC-SHA256 with HSM-backed key
}

Retention: 7 years for pharmaceutical (GDP); 2 years for food (FSMA)
Storage: append-only, write-once storage; no delete path
Verification: daily hash chain integrity check from last verified checkpoint
```

---

## Security Controls Summary

| Data Category | At Rest | In Transit | Key Management |
|---|---|---|---|
| Shipment records | AES-256, per-tenant key | TLS 1.3 | Per-tenant key in managed KMS |
| Driver telematics | AES-256, per-fleet key | TLS 1.3 | Separate key hierarchy from shipment data |
| Cold chain readings | AES-256, dedicated key | TLS 1.3 | Per-customer key; HSM-backed for audit trail |
| Carrier credentials | AES-256 in secrets store | TLS 1.3 + mTLS for AS2 | Managed secrets store with auto-rotation |
| Demand forecasts | AES-256, per-tenant key | TLS 1.3 | Per-tenant key (forecasts are competitively sensitive) |
| Customer tracking data | AES-256 | TLS 1.3 | Platform-wide key (no PII on tracking page) |

---

## Domain-Specific Threat Model

### Threat 1: Supply Chain Network Reconnaissance via Tracking API

**Attack vector:** A competitor or malicious actor systematically queries the customer-facing tracking API to map a shipper's supply chain network—identifying shipping volumes, carrier choices, origin-destination lanes, and seasonal patterns.

**Impact:** Competitive intelligence extracted from publicly accessible tracking pages reveals a shipper's supply chain structure, enabling targeted competitive actions (undercutting carrier rates on high-volume lanes, poaching customers at identified delivery locations).

**Mitigations:**
- Tracking page URLs use cryptographically random UUIDs (128-bit entropy); sequential enumeration is infeasible.
- Rate limiting per IP address: 10 tracking queries per minute; CAPTCHA after 20 queries from same IP in an hour.
- Tracking pages show city-level location only (not exact coordinates, not carrier identity, not shipper identity).
- Tracking URLs expire 30 days after delivery; expired links show "delivered" with no route details.
- Honeypot tracking IDs: system generates fake tracking IDs that appear in response to enumeration attempts; any query for a honeypot ID flags the requesting IP for investigation.

### Threat 2: Carrier API Credential Compromise

**Attack vector:** An attacker compromises a carrier's API credentials stored in the platform's secrets store (through phishing a carrier admin, exploiting a vulnerability in the carrier connector, or insider threat). The attacker uses the credentials to inject false shipment status updates, redirecting shipments or masking theft.

**Impact:** False status updates (e.g., "delivered" when shipment is still in transit) mask cargo theft; false "in transit" updates delay investigation of missing shipments; corrupted ETA predictions based on false GPS positions.

**Mitigations:**
- All carrier credentials stored in a managed secrets store with access audit logging; no credentials in application configuration.
- Per-carrier API key rotation every 90 days (30 days for high-risk carriers); automated zero-downtime key rotation.
- Carrier API response validation: status update plausibility check (a shipment cannot go from "delivered" back to "in transit"; a GPS position cannot jump > 500 km in 5 minutes).
- Anomaly detection on carrier API patterns: sudden volume spike from a carrier, status updates outside carrier's normal operating hours, or updates for shipments not assigned to that carrier trigger investigation.
- mTLS for high-security carrier connections, ensuring both parties authenticate.

### Threat 3: Cold Chain Audit Trail Tampering

**Attack vector:** An insider (warehouse employee, carrier driver) attempts to modify cold chain temperature records to conceal a temperature excursion that would require disposal of high-value pharmaceutical goods.

**Impact:** Compromised goods reach patients; regulatory violation (FDA/EU GDP); legal liability for the shipper and platform.

**Mitigations:**
- Cold chain audit trail uses hash chaining: each entry's HMAC includes the hash of the previous entry; tampering with any entry breaks the chain.
- HMAC keys are HSM-backed (not software keys); key material never leaves the HSM.
- Write-once storage: the audit trail is stored in append-only, immutable storage with no delete or overwrite path.
- Trusted timestamps: temperature readings are timestamped using a platform-controlled NTP source, not the sensor's local clock (which could be manipulated).
- Daily integrity verification: an automated job verifies the hash chain from the last verified checkpoint to the current head; any break triggers an immediate SEV-1 alert.
- Separation of duties: the person who operates the cold chain equipment cannot also approve disposition decisions for excursions.

### Threat 4: GPS Spoofing for Cargo Theft

**Attack vector:** A threat actor places a GPS spoofing device near a truck or container, broadcasting false GPS coordinates to the tracking system. The platform shows the shipment at its expected location while the physical cargo is diverted to a different location for theft.

**Impact:** High-value cargo theft; delayed theft detection (hours or days if the spoofed track is plausible); insurance claim disputes.

**Mitigations:**
- Multi-source position verification: GPS position is cross-referenced with cellular tower triangulation, carrier EDI milestone events, and geofence check-ins at known waypoints. Divergence between sources triggers an alert.
- Speed and heading consistency checks: spoofed positions often show impossible speed (teleporting between distant locations) or inconsistent heading (position changes direction while heading remains constant).
- Historical route pattern analysis: if a shipment on a known lane suddenly deviates from all historical routes for that lane, flag as anomalous.
- Geofence-based verification: automated checkpoint alerts when a shipment enters/exits expected geofences (port, warehouse, customs checkpoint); missing geofence events on a known route trigger investigation.
- Dual-tracker deployments for high-value cargo: two independent trackers (different communication technologies—cellular and satellite) on the same shipment; divergence between trackers indicates spoofing.

### Threat 5: Demand Forecast Manipulation for Market Advantage

**Attack vector:** A malicious tenant or compromised internal account manipulates demand forecasts (via the planner override API) to artificially inflate forecasted demand for specific SKUs, causing the platform to over-order from suppliers. The attacker profits from the supplier side (kickback) or from a short position on the shipper's inventory costs.

**Impact:** Excess inventory orders waste working capital; supplier relationships distorted; if the manipulation is for perishable goods, physical waste.

**Mitigations:**
- Planner override audit trail: every manual forecast override is logged with {user_id, original_forecast, override_value, reason, timestamp}.
- Override magnitude alerts: overrides that change the forecast by more than 50% require manager approval (dual authorization).
- Override anomaly detection: if a single user issues > 10 overrides in a day, or overrides disproportionately affect a single supplier's products, flag for investigation.
- Override rollback: all overrides are reversible; the system retains the original model forecast alongside the override.
- Reconciliation verification: overrides are subject to the same MinT reconciliation as model forecasts; an override that creates gross incoherence (SKU-level overrides that exceed the category allocation) is flagged.

---

## Data Residency and Sovereignty

| Region | Regulation | Requirement | Implementation |
|---|---|---|---|
| EU | GDPR | Driver telematics (personal data) must be processed and stored within the EU | Per-region telemetry processing; EU-region driver data never replicated to non-EU regions |
| US | No federal data residency law | Industry-specific requirements (CTPAT, ELD) | Data can be processed in any US region; ELD records retained per FMCSA in US storage |
| China | PIPL + Cybersecurity Law | Logistics data involving Chinese shipments must be stored in China; cross-border transfer requires security assessment | Dedicated China region with local data store; cross-border data limited to aggregated, non-PII shipment statistics |
| India | DPDPA 2023 | Personal data of Indian data principals must be processed with notice and consent | Consent management for driver telematics; purpose limitation enforced at the application layer |
| Brazil | LGPD | Similar to GDPR; driver consent and data minimization | Brazil sub-region within Americas; driver data isolated from cross-region replication |

**Cross-border shipment handling:** When a shipment traverses multiple data residency jurisdictions (e.g., EU → US), the shipment record is replicated to both regions, but personal data (driver identity, driver location) is stripped from the cross-border replica. Only the shipment-level events (status, cargo temperature, ETA) are shared. The per-region visibility service assembles the full timeline by combining local events with anonymized cross-border events.

---

## Data Lifecycle and Retention

| Data Type | Hot Retention | Warm Retention | Cold Retention | Deletion |
|---|---|---|---|---|
| Shipment records | 30 days (active shipments) | 1 year (queryable for analytics) | 7 years (regulatory archive) | Per-tenant, on contract termination + grace period |
| GPS telemetry | 7 days (full resolution) | 30 days (5-min aggregation) | 1 year (hourly aggregation) | Auto-purged after 1 year |
| Driver telematics | 90 days (full resolution) | 3 years (daily summaries) | — | Purged per GDPR data minimization; driver right-to-erasure honored |
| Cold chain readings | 30 days (full resolution) | 2 years (FSMA) / 7 years (GDP) | — | Retained in immutable storage for full retention period |
| Demand forecasts | 90 days (current + 2 prior refresh cycles) | 1 year (for accuracy tracking) | 3 years (for model retraining) | Auto-purged after 3 years |
| Route solutions | 90 days (queryable for audit) | 1 year (compressed) | — | Auto-purged after 1 year |
| Cold chain audit trail | 2–7 years (depends on cargo type) | — | — | Never deleted during retention; immutable storage |
| ELD/HOS records | 6 months (per FMCSA) | — | — | Archived after 6 months; deleted after 1 year |

### Right to Erasure (GDPR Article 17)

When a driver exercises their right to erasure:
1. All personally identifiable telematics data (name, driver ID linked to GPS tracks) is deleted or pseudonymized.
2. Aggregated fleet statistics that included this driver's data are retained (no individual re-identification possible from aggregates).
3. The audit trail records that erasure was performed (who requested, when, what was deleted) — the audit entry itself does not contain the erased data.
4. Cold chain records that include the driver's name as the transporter are pseudonymized (driver name replaced with a token) but the temperature and compliance data is retained (regulatory obligation supersedes erasure for safety-critical records).

---

## Security Incident Response

### Supply Chain Cyber Attack Playbook

**Scenario:** A carrier's API integration is compromised, and the attacker is injecting false shipment status updates to mask cargo theft across multiple shipments.

**Detection indicators:**
- Multiple shipments from the same carrier show "delivered" status but the GPS trail does not show arrival at the delivery location.
- Carrier API authentication succeeds but the request pattern diverges from the carrier's normal usage (unusual hours, abnormal event rate, status updates for shipments not assigned to this carrier).
- Customer complaints of non-delivery for shipments marked "delivered" by this carrier.

**Response steps:**
1. **Contain** (< 15 min): Immediately revoke the compromised carrier's API credentials. Route all active shipments from this carrier through manual status verification (dispatch team contacts drivers directly).
2. **Assess** (< 1 hour): Identify all shipments affected (query: shipments with this carrier_id and status updates in the suspect time window). Cross-reference GPS data with status updates to identify discrepancies.
3. **Notify** (< 2 hours): Notify affected shippers with the list of potentially compromised shipments. Engage law enforcement if cargo theft is confirmed.
4. **Recover**: Issue new API credentials to the carrier through a verified out-of-band channel. Implement enhanced monitoring for this carrier (all API requests logged at debug level for 30 days; anomaly detection thresholds tightened).
5. **Post-incident**: Root cause analysis; implement additional controls (e.g., GPS-status correlation check as a real-time gate on all carrier status updates, not just anomaly detection).

---

## AI/ML Security Considerations

### Model Poisoning in Demand Forecasting

**Risk:** An attacker with access to the historical demand data pipeline injects synthetic demand records that skew the model toward over-forecasting or under-forecasting specific SKUs. Over-forecasting causes excess inventory (financial loss); under-forecasting causes stockouts (revenue loss and customer impact).

**Mitigations:**
- Data provenance tracking: every demand record in the training pipeline carries a provenance tag (source system, ingestion timestamp, validation status). Records from unverified sources are excluded from model training.
- Statistical anomaly detection on training data: before each model training run, compare the training data distribution against the previous training set. Detect unexpected volume spikes, new SKU-location combinations that don't correspond to actual product launches, and demand patterns inconsistent with the calendar (e.g., holiday-level demand in February).
- Model behavior auditing: after each retrain, compare the new model's predictions against the previous model on a held-out test set. If predictions diverge by more than 15% for any product category, flag for review before deployment.

### Adversarial GPS Inputs to ETA Model

**Risk:** Systematically injected GPS coordinates along a shipment route could cause the ETA model to learn incorrect travel time patterns for specific road segments, degrading prediction accuracy for all shipments on those segments.

**Mitigations:**
- GPS plausibility filter: reject GPS readings that are physically impossible (speed > 200 km/h for trucks, position jumps > distance achievable in the time interval).
- Multi-source validation: for training data, only use GPS readings that are corroborated by at least one other source (carrier EDI milestone, geofence crossing, cellular tower triangulation).
- Robust model training: use robust loss functions (Huber loss instead of MSE) that down-weight outlier training examples, reducing the impact of any poisoned data points.

### Prompt Injection in Generative AI Planner Interfaces

**Risk:** If the platform provides a natural-language interface for planners (RAG-based query system), a malicious user could craft queries that cause the LLM to execute unintended database operations, reveal other tenants' data, or bypass authorization controls.

**Mitigations:**
- The LLM generates structured query specifications, not raw database queries. A query sanitizer validates all generated queries against the tenant's authorization context before execution.
- The LLM has no direct database access; it communicates only through a structured API that enforces tenant isolation, rate limiting, and query complexity bounds.
- Output filtering: LLM responses are scanned for potential data leakage (references to other tenant names, shipment IDs outside the current tenant's scope) before being presented to the user.
