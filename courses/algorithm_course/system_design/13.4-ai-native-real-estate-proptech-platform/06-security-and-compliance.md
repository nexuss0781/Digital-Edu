# 13.4 AI-Native Real Estate & PropTech Platform — Security & Compliance

## Regulatory Landscape

Real estate technology operates under some of the most complex and consequential regulatory frameworks in any industry, spanning fair housing, consumer finance, building safety, environmental disclosure, and data privacy.

### Fair Housing and Fair Lending

| Regulation | Scope | Impact on Platform |
|---|---|---|
| **Fair Housing Act (FHA)** | Prohibits discrimination in housing based on race, color, national origin, religion, sex, familial status, disability | Tenant matching must exclude protected variables and proxies; property recommendations cannot steer users away from neighborhoods based on demographics |
| **Equal Credit Opportunity Act (ECOA)** | Requires creditors to provide specific adverse action reasons when denying credit | AVM used in lending must generate explainable valuations; tenant screening must provide adverse action notices |
| **Home Mortgage Disclosure Act (HMDA)** | Requires lenders to report loan application demographics | AVM outputs consumed by lenders inherit HMDA reporting obligations; valuation disparities are auditable |
| **Appraisal Foundation standards (USPAP)** | Professional standards for property valuation | AVM methodology must be documentable and defensible; comparable selection must be transparent |

### Building and Safety Codes

| Regulation | Scope | Impact on Platform |
|---|---|---|
| **ASHRAE 62.1** | Ventilation for acceptable indoor air quality | HVAC optimizer must maintain minimum ventilation rates per zone regardless of energy optimization objectives |
| **NFPA 72** | National Fire Alarm and Signaling Code | Fire detection and alarm systems must operate independently of building intelligence platform; response time requirements |
| **OSHA workplace standards** | Occupational safety for building occupants | CO, CO2, temperature, and humidity must stay within OSHA limits; platform must alert and actuate if limits are approached |
| **ADA compliance** | Accessibility requirements | Building intelligence must not disadvantage occupants who use accessibility features (e.g., elevators must not be deprioritized by energy optimization) |

### Data Privacy

| Regulation | Scope | Impact on Platform |
|---|---|---|
| **CCPA / CPRA** | California consumer data privacy | Property search history, saved homes, and screening data are personal information; right to deletion; opt-out of sale |
| **State tenant screening laws** | Vary by state; limit what data can be used | Some states prohibit criminal history in screening; some limit credit inquiry lookback period; platform must be configurable per jurisdiction |
| **FCRA** | Fair Credit Reporting Act | Tenant screening that uses credit data must comply with FCRA: permissible purpose, adverse action notices, consumer dispute process |
| **State biometric laws** | Illinois BIPA, Texas CUBI, Washington biometric law | Occupancy detection using facial recognition or biometric identification requires consent; prefer non-biometric methods (WiFi, badge, thermal) |

---

## Fair Housing Compliance Architecture

### Prohibited Variable Exclusion

The platform maintains a prohibited feature registry that lists variables that must never be used directly in tenant screening or property recommendation ranking:

```
Prohibited features (direct):
  - race, ethnicity, national_origin
  - religion
  - sex, gender, sexual_orientation
  - familial_status (presence of children, pregnancy)
  - disability_status
  - military/veteran_status (in some jurisdictions)
  - source_of_income (Section 8 vouchers; required in many jurisdictions)
```

**Proxy detection pipeline:**
Every feature used in tenant matching or property recommendation is tested quarterly for proxy correlation with protected classes:

1. **Statistical independence test:** For each candidate feature, compute mutual information with census-tract-level demographic composition. Features with mutual information above a threshold (calibrated per market) are flagged as potential proxies.

2. **Causal analysis:** Not all correlated features are proxies. Property value is correlated with neighborhood demographics, but this correlation reflects legitimate economic factors (school quality, amenities, employment access). The compliance team reviews flagged features to determine whether the correlation reflects a legitimate business justification or an impermissible proxy.

3. **Feature audit trail:** Every feature inclusion/exclusion decision is documented with justification, reviewer identity, and review date. This trail is available for regulatory examination.

### Anti-Steering in Property Recommendations

The property search engine must not "steer" users toward or away from neighborhoods based on demographics. This constraint affects the recommendation algorithm:

- **Prohibited signal:** The recommendation engine must not use the user's inferred race, ethnicity, or national origin to adjust which neighborhoods are recommended
- **Permitted signal:** The engine may use explicitly stated preferences (school district, commute time to workplace, price range) even if these correlate with demographic patterns, because these are legitimate housing search criteria
- **Monitoring:** A/B testing infrastructure compares recommendation distributions across user demographic groups. If users from different demographic groups receive statistically different neighborhood distributions after controlling for stated preferences, the algorithm is investigated for implicit steering

### Tenant Screening Adverse Action Compliance

When a tenant application is denied (or approved with conditions), the platform must provide specific, actionable adverse action reasons. This requires the screening model to be locally explainable:

1. For each denied application, the explainability engine computes SHAP values for the screening model's decision
2. The top 3-5 factors driving the denial are translated into standardized adverse action reason codes (per FCRA/ECOA)
3. The adverse action notice includes: specific reasons, the applicant's right to dispute, free credit report access information, and the contact information for the screening decision-maker
4. All adverse action notices are stored for 5 years in an immutable audit trail

---

## AVM Bias Detection and Mitigation

### Disparate Impact Testing

The platform runs automated disparate impact analysis monthly on AVM outputs:

```
FOR each census_tract:
  majority_group = tract.majority_demographic_group
  minority_group = tract.largest_minority_group

  majority_error = median_absolute_error(
    avm_estimates[majority_tracts], actual_prices[majority_tracts]
  )
  minority_error = median_absolute_error(
    avm_estimates[minority_tracts], actual_prices[minority_tracts]
  )

  -- Four-fifths rule: if minority accuracy < 80% of majority accuracy
  IF minority_error / majority_error > 1.25:  -- inverse: higher error = worse accuracy
    FLAG tract for review
    GENERATE detailed report with:
      - Feature importance differences between groups
      - Comparable selection patterns (are minority-area properties matched to
        lower-quality comparables?)
      - Data quality differences (fewer recent transactions in minority areas?)
```

### Appraisal Bias Detection

Beyond statistical testing, the platform monitors for individual valuation outliers that may indicate bias:

- **Reconsideration of value (ROV) tracking:** When a borrower challenges an AVM estimate, the platform logs the challenge, the original estimate, the revised estimate (if any), and the demographic characteristics of the neighborhood. A pattern of successful challenges concentrated in specific demographic areas triggers a model review.
- **Paired testing:** The platform periodically generates synthetic valuation requests for property pairs that differ only in neighborhood demographics (controlling for all property-level features). Statistically significant valuation differences between paired properties indicate potential bias in the spatial model component.

---

## Building IoT Security

### Network Segmentation

Building IoT networks are segmented into isolated zones to prevent lateral movement from a compromised sensor to building controls:

```
Zone 1: Safety Systems (air-gapped from internet)
  - Fire alarm, CO detection, emergency ventilation
  - Connected only to edge safety controller via dedicated BACnet/IP network
  - No IP connectivity to Zone 2, 3, or internet

Zone 2: Building Controls (isolated VLAN)
  - HVAC actuators, lighting controls, elevator controls
  - Connected to edge gateway via Modbus TCP on dedicated VLAN
  - Gateway mediates all commands; actuators cannot be addressed directly from internet

Zone 3: Monitoring Sensors (IoT VLAN)
  - Temperature, humidity, occupancy, energy meters
  - Read-only sensors; no actuation capability
  - Connected to edge gateway via MQTT over TLS

Zone 4: Edge Gateway (DMZ)
  - Aggregates data from Zones 2 and 3
  - Communicates with cloud via outbound-only HTTPS connections
  - Receives commands from cloud via authenticated, signed command channel
  - Command channel uses mutual TLS + command signing (each command signed with building-specific key)

Zone 5: Cloud Platform
  - Digital twin, RL optimizer, analytics
  - Commands to building pass through Zone 4 gateway; never directly to actuators
```

### Command Authentication and Authorization

Every command from the cloud to a building actuator (setpoint change, mode switch, equipment on/off) follows a chain of authentication:

1. **Command origin:** The RL optimizer or human operator issues a command via the building intelligence API
2. **Authorization check:** The command is validated against the building's authorized command set (e.g., the optimizer can adjust setpoints within ±5°F but cannot override safety systems)
3. **Command signing:** The command is signed with the building's command key (asymmetric cryptography; cloud holds signing key, edge gateway holds verification key)
4. **Rate limiting:** The edge gateway rate-limits commands (max 10 setpoint changes per zone per hour) to prevent runaway optimization loops from damaging equipment
5. **Actuator execution:** The edge gateway translates the signed command into the native protocol (BACnet write, Modbus register write) and sends to the actuator
6. **Confirmation:** The actuator confirms execution; the edge gateway logs the command and confirmation to the audit trail

### Sensor Data Integrity

Building sensors can be spoofed or tampered with (e.g., an occupant tapes a warm object to a temperature sensor to increase cooling). The platform detects anomalous sensor readings via:

- **Physical plausibility checks:** Temperature cannot change by more than 5°F in 1 minute; occupancy cannot exceed building capacity; energy cannot be negative
- **Cross-sensor consistency:** If a temperature sensor reports 85°F but all adjacent zone sensors report 72°F, the outlier is flagged
- **Temporal pattern detection:** A sensor that suddenly starts reporting constant values (stuck sensor) or perfectly periodic values (simulated data) is flagged for maintenance

---

## Data Privacy and Tenant Protection

### Data Minimization in Tenant Screening

The platform collects only the minimum data necessary for screening decisions:

| Data Category | Collected | Retention | Justification |
|---|---|---|---|
| Credit report | Yes (with consent) | 30 days after decision | FCRA permissible purpose; deleted after screening complete |
| Income verification | Yes | 30 days after decision | Rent-to-income ratio calculation |
| Rental history | Yes (with consent) | 30 days after decision | Payment history assessment |
| Criminal history | Jurisdiction-dependent | 30 days if collected | Prohibited in many jurisdictions; platform checks local law before requesting |
| Social media | Never | N/A | Not a legitimate screening factor; invasion of privacy |
| Biometric data | Never | N/A | Not relevant to tenant screening |

### Right to Deletion

When a tenant applicant exercises their right to deletion (CCPA/CPRA):
1. Screening data (credit report, income, application details) is permanently deleted
2. The screening decision record (approve/deny, date, adverse action reasons) is retained in anonymized form for 5 years (regulatory requirement)
3. The anonymized record cannot be re-linked to the individual (SSN hash is deleted; only anonymized aggregate statistics remain)

### Search History Privacy

Property search behavior (queries, viewed listings, saved homes, search frequency) is sensitive because it may reveal life circumstances (divorce, job change, financial stress). The platform:

- Stores search history only when the user is authenticated and has consented
- Provides clear UI for users to view and delete their search history
- Does not share individual search behavior with listing agents or property owners
- Uses search history for personalization only; never for advertising targeting without explicit opt-in
- Automatically purges search history after 12 months of account inactivity

---

## Compliance Monitoring Dashboard

| Metric | Target | Alert Threshold |
|---|---|---|
| AVM disparate impact ratio (minority/majority error) | ≤ 1.25 | > 1.20 |
| Adverse action notice delivery rate | 100% within 30 days | Any missed notice |
| Prohibited variable detection (proxy test) | All features tested quarterly | Any untested feature in production model |
| Building safety response time p99 | ≤ 100 ms | > 80 ms |
| ASHRAE 62.1 ventilation compliance rate | 100% | < 99.9% |
| Tenant data deletion request completion | ≤ 30 days | > 15 days |
| Credit report retention compliance | Delete within 30 days of decision | Any report retained > 35 days |
| ROV (reconsideration of value) rate by demographic group | Equal across groups (±10%) | > 20% disparity |

---

## Third-Party Data Provider Risk

### MLS and County Data Provider Trust

| Risk Category | Threat | Mitigation |
|---|---|---|
| **Schema poisoning** | A compromised MLS feed sends properties with manipulated attributes (inflated sqft, misrepresented condition) to influence AVM estimates | Per-feed anomaly detection: flag records where key attributes deviate >3σ from historical distribution for that MLS; quarantine until reviewed |
| **Feed interruption** | MLS provider changes API terms, rate limits, or authentication without notice | Multi-source coverage: 78% of US properties are covered by ≥2 MLS feeds; stale data alert at 4 hours; contractual SLA with provider |
| **Stale data injection** | County recorder office publishes records with multi-month lag, creating a "time warp" where recent transactions appear as historical | Timestamp reconciliation: compare recording date vs. transaction date; flag records where lag exceeds 60 days |
| **Geocoding errors** | Third-party geocoding service returns incorrect lat/lon, placing properties in wrong neighborhoods and affecting spatial model | Cross-validate geocodes against parcel boundary from tax records; flag properties where geocode falls outside parcel polygon |

### Climate Data Provider Trust

| Risk Category | Threat | Mitigation |
|---|---|---|
| **GCM version skew** | Different GCM providers release updated projections on different schedules, creating ensemble inconsistency | Ensemble version tracking: all 6 GCMs must be from same CMIP generation; hold risk score refresh if <4 of 6 are current |
| **Downscaling methodology change** | Statistical downscaling provider changes methodology, producing discontinuous risk scores between annual refreshes | Hindcast comparison: run new methodology against historical events; accept only if hindcast accuracy is within 10% of previous methodology |
| **FEMA map update lag** | FEMA flood maps are updated irregularly; platform may use outdated flood zone designations | Supplement FEMA maps with independent flood modeling; flag properties where platform flood risk diverges significantly from FEMA zone designation |

---

## Incident Response Playbook

### SEV-1: Building Safety System Failure

**Definition:** Any condition where a building's safety-critical path (fire detection, CO monitoring, emergency ventilation) is unresponsive or producing incorrect actuations.

**Timeline:**
| Time | Action | Owner |
|---|---|---|
| T+0 | Automated alert: safety sensor liveness drops below threshold or safety actuation fails | Monitoring system |
| T+1 min | On-call building operations engineer acknowledges | Building ops |
| T+5 min | Verify building edge gateway status: (a) primary gateway responsive? (b) standby gateway active? (c) local safety logic operating? | Building ops |
| T+10 min | If edge gateway unresponsive: dispatch local facilities team to building; verify building-level safety systems (fire panel, BMS) are operating independently | Building ops + Facilities |
| T+15 min | If cloud-only issue (edge gateway healthy, cloud connectivity down): confirm safety path is operating locally; downgrade to SEV-2 | Building ops |
| T+30 min | If edge gateway failure confirmed: activate manual safety monitoring protocol; position staff at building fire command center | Building ops + Facilities |
| T+60 min | Replacement edge gateway deployment if remote recovery fails | Field engineering |

**Escalation:** Building owner notified at T+5 min. Local fire department notified at T+30 min if safety monitoring cannot be confirmed. Regulatory authority (fire marshal) notified within 24 hours per code requirements.

### SEV-1: AVM Fair Lending Violation Detection

**Definition:** Automated disparate impact testing detects that AVM error rate for minority census tracts exceeds the 4/5ths rule threshold relative to majority tracts.

**Timeline:**
| Time | Action | Owner |
|---|---|---|
| T+0 | Automated alert: disparate impact ratio exceeds 1.25 for any metro | Compliance monitoring |
| T+1 hr | Compliance team reviews flagged metro: confirm the metric is not a statistical artifact (require ≥200 transactions in each group) | Compliance |
| T+4 hr | If confirmed: isolate root cause—data quality issue (fewer comps in minority tracts)? feature issue (proxy variable)? model issue (spatial model bias)? | ML engineering + Compliance |
| T+24 hr | Interim mitigation: widen confidence intervals for affected tracts; add human review flag for valuations in affected area | ML engineering |
| T+7 days | Root cause fix deployed (model retrain with fairness constraints, data quality improvement, or feature exclusion) | ML engineering |
| T+14 days | Rerun disparate impact test; confirm ratio returns below threshold | Compliance |

**Regulatory notification:** If disparate impact persists beyond 14 days, legal team evaluates ECOA reporting obligations. All remediation steps logged to immutable compliance audit trail.

### SEV-2: Lease Extraction Accuracy Degradation

**Definition:** Key term extraction F1 (Tier 1 financial clauses) drops below 93% on rolling 7-day window.

**Timeline:**
| Time | Action | Owner |
|---|---|---|
| T+0 | Alert: Tier 1 F1 drops below threshold | NLP monitoring |
| T+2 hr | Analyze error distribution: is degradation concentrated in specific (a) clause types, (b) document formats, (c) OCR quality tiers? | NLP engineering |
| T+4 hr | If OCR quality: route affected documents to enhanced OCR pipeline; alert submitters about scan quality requirements | NLP engineering |
| T+8 hr | If model degradation: deploy previous model version (rollback); queue model investigation | NLP engineering |
| T+48 hr | Root cause analysis complete; model fix or retraining initiated | NLP engineering |

---

## Data Breach Notification Protocol

**Scope:** A data breach involving tenant screening data (credit reports, SSNs, income verification) or building occupancy data (presence/absence patterns) triggers this protocol.

| Step | Timeline | Action |
|---|---|---|
| 1. Containment | T+0 to T+1 hr | Isolate affected systems; revoke compromised credentials; preserve forensic evidence |
| 2. Assessment | T+1 hr to T+24 hr | Determine scope: which records, which data elements, which time period; assess regulatory notification obligations |
| 3. Legal review | T+24 hr to T+48 hr | Legal team reviews state-by-state notification requirements (CCPA: 72 hours; state breach laws: 30-60 days) |
| 4. Affected party notification | Per state law | Notify affected tenants/applicants with: description of breach, data elements exposed, recommended actions (credit freeze, monitoring) |
| 5. Regulatory notification | Per regulation | State attorneys general, FTC if applicable, HUD if tenant screening data |
| 6. Remediation | Ongoing | Implement fixes; third-party security audit; update incident response procedures |
| 7. Post-incident report | T+30 days | Publish internal post-mortem; update threat model; implement preventive controls |

**Special consideration for building occupancy data:** Occupancy data (badge swipes, WiFi presence) reveals when specific people are and are not in a building—information with potential physical safety implications (stalking, burglary). Occupancy data is classified as sensitive PII and subject to the same breach notification requirements as financial data.

---

## Algorithmic Fairness and Transparency

### AVM Explainability for Regulatory Examination

Regulators (CFPB, OCC, state banking regulators) may examine the AVM methodology and demand explanations for individual valuations. The platform must provide:

| Requirement | Implementation | Delivery Format |
|---|---|---|
| **Model documentation** | Complete description of AVM ensemble architecture, feature set, training methodology, and validation results; updated per model version | PDF report; machine-readable appendix with model cards |
| **Individual valuation explanation** | For any valuation: which comparables were selected, what adjustments were applied, which features drove the estimate, and what the model's confidence is | JSON API response with SHAP values; human-readable PDF for appraisers |
| **Disparate impact analysis** | Monthly automated analysis across demographic groups; trend over time; remediation actions taken | Compliance dashboard; quarterly regulatory summary |
| **Feature audit trail** | For each feature in the model: justification for inclusion, proxy test results, last review date, reviewer identity | Immutable audit log; searchable by feature name or review date |

### Tenant Screening Model Governance

The tenant screening model operates under stricter governance than the AVM because it directly affects individual housing access:

1. **Model review board:** Every model change requires approval from a cross-functional review board (ML engineering, legal, compliance, product) before deployment
2. **Prohibited feature enforcement:** The feature pipeline physically excludes prohibited variables at the data layer—not just the model layer—so that no model version can accidentally access race, religion, or other protected characteristics
3. **Disparity monitoring:** Weekly automated disparity testing compares approval rates across demographic groups. Any disparity exceeding 20% triggers an automatic investigation
4. **Consumer right to explanation:** Every denied applicant receives a specific explanation of the factors that led to denial, formatted in plain language per FCRA requirements. The explanation must be generated automatically (not manually crafted) to ensure consistency

### Building IoT Physical Security

Beyond network segmentation, building IoT systems face physical security threats:

| Threat | Attack Vector | Mitigation |
|---|---|---|
| **Sensor tampering** | Physically covering or heating a temperature sensor to manipulate HVAC | Cross-sensor consistency checks; flag sensors with readings that diverge >3σ from zone neighbors |
| **Gateway access** | Physical access to edge gateway for firmware modification | Tamper-evident enclosure; secure boot chain; firmware signing verification on every boot |
| **Protocol spoofing** | Injecting forged BACnet or Modbus commands on the building network | Command authentication via building-specific signing keys; rate limiting on actuator commands |
| **Denial of service** | Flooding the BACnet network with broadcast packets to overwhelm the gateway | Traffic analysis at gateway; automatic broadcast storm suppression; dedicated safety VLAN immune to broadcast |
| **Insider threat** | Building maintenance contractor with physical network access | Principle of least privilege: maintenance accounts can read sensor data but cannot issue actuator commands; all commands logged with operator identity |

---

## Climate Risk Disclosure Compliance

### TCFD Reporting Requirements

The Task Force on Climate-Related Financial Disclosures (TCFD) framework is increasingly mandated by financial regulators. The platform must support institutional clients (REITs, lenders, insurers) in generating TCFD-compliant disclosures:

| TCFD Pillar | Platform Support | Data Sources |
|---|---|---|
| **Governance** | Audit trail of who approved climate risk methodology; model change governance logs | Platform governance records |
| **Strategy** | Scenario analysis outputs (SSP2-4.5 and SSP5-8.5 impacts on portfolio value); climate-adjusted valuations across time horizons | Climate risk service outputs; AVM climate adjustment layer |
| **Risk Management** | Per-property and portfolio-level risk scores; risk aggregation by geography, peril, and time horizon | Pre-computed risk scores; portfolio analytics |
| **Metrics & Targets** | Percentage of portfolio in high-risk zones; expected annual loss by peril; transition risk exposure (energy efficiency scores) | Climate risk cache; building IoT data (energy efficiency) |

### Regulatory Audit Support

The platform maintains an audit-ready posture for four regulatory domains:

| Regulatory Domain | Audit Frequency | What Regulators Examine | Platform's Evidence |
|---|---|---|---|
| **Fair lending (CFPB/OCC)** | Annual examination for large lenders | AVM methodology; disparate impact testing results; individual valuation explanations; proxy variable analysis | Model documentation; monthly disparate impact reports; per-valuation SHAP explanations; feature audit trail |
| **Fair housing (HUD)** | Complaint-driven | Tenant screening decisions; adverse action notices; recommendation algorithm for steering | Screening decision audit trail; adverse action notice archive; anti-steering monitoring reports |
| **Building safety (local fire marshal)** | Annual inspection | Safety system test results; actuation latency records; equipment maintenance logs | Monthly automated safety test logs; actuator command audit trail; predictive maintenance records |
| **Data privacy (state AG)** | Complaint-driven | Tenant data handling; deletion request fulfillment; data minimization practices | Data inventory; deletion request logs; retention policy enforcement records |

### Cross-Jurisdiction Compliance Matrix

Tenant screening regulations vary significantly by jurisdiction. The platform maintains a per-jurisdiction compliance configuration:

| Jurisdiction | Criminal History | Credit Lookback | Source of Income | Additional Restrictions |
|---|---|---|---|---|
| **California** | Prohibited for most housing | 7 years max | Protected (Section 8 must be accepted) | Ban-the-box; no inquiries until conditional offer |
| **New York City** | Prohibited (Fair Chance in Housing Act) | 7 years max | Protected | Credit report fee paid by landlord |
| **Oregon** | Limited (post-conviction only) | No state limit | Protected | Application fee cap |
| **Texas** | Permitted | No state limit | Not protected | Minimal restrictions |
| **Washington** | Limited lookback | 7 years max | Protected in Seattle | Per-city variation within state |
