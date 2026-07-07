# 12.19 AI-Native Insurance Platform — Security & Compliance

## Regulatory Landscape

Insurance is regulated at the state level in the United States, creating a 50-jurisdiction compliance matrix that is among the most complex in any consumer-facing industry. The platform must simultaneously comply with:

| Regulatory Framework | Scope | Key Obligation |
|---|---|---|
| **State Insurance Codes** | All 50 states, separate for each line | Rate filing, prohibited factors, solvency requirements, market conduct |
| **FCRA (Fair Credit Reporting Act)** | Federal | Adverse action notices; permissible purpose for credit pulls; consumer dispute rights |
| **NAIC Data Security Model Law** | ~25 states adopted | Comprehensive information security program; annual audit; 72-hour breach notification |
| **NAIC AI Governance Framework** | Emerging state adoption | AI/ML system governance; bias testing; explainability requirements |
| **GLBA (Gramm-Leach-Bliley Act)** | Federal | Privacy notice; information security safeguard rule; limits on sharing NPI |
| **CCPA / State Privacy Laws** | California + 15+ states | Consumer right to access, delete, and opt out of sale of personal data |
| **HIPAA** (life/health lines only) | Federal | PHI handling for health-underwritten products |
| **OFAC Sanctions** | Federal | Sanctions screening for all policyholders and claimants |

---

## Prohibited Factor Enforcement

The most critical compliance control in the underwriting engine is the real-time exclusion of prohibited rating factors. States differ on which variables are prohibited:

| Factor | States Prohibiting (auto) | States Prohibiting (home) |
|---|---|---|
| Credit score / insurance score | CA, HI, MA | Some states for low-income applicants |
| Gender | CA, HI, MA, MT, NC, PA | Various |
| Education / occupation | Some states | Some states |
| Race, ethnicity, national origin | All (disparate treatment) | All |
| ZIP code alone (without actuarial justification) | Various | Various |

### Technical Enforcement Architecture

```
rate_algorithm.prohibited_features = ["credit_score", "education_level", ...]
                                       // per state, per LOB, per algorithm version

FUNCTION enforce_prohibited_factors(raw_features, algo):
  model_features = {}
  audit_excluded = []
  FOR feature_name, value IN raw_features:
    IF feature_name IN algo.prohibited_features:
      audit_excluded.append(feature_name)   // log that it was excluded
      CONTINUE                               // never reaches model
    model_features[feature_name] = value

  // Write both to risk_score_record for regulator audit
  record.feature_snapshot = encrypt(raw_features)     // complete, including excluded
  record.prohibited_features = audit_excluded          // what was excluded
  record.model_input = encrypt(model_features)         // what model actually saw
  RETURN model_features
```

A state insurance commissioner audit must be able to verify that prohibited variables were never passed to the scoring model. The risk score record stores both the complete feature set (encrypted, restricted access) and the model input (with prohibited features removed), enabling the auditor to verify exclusion without retraining or reproducing the run.

### Disparate Impact Testing Pipeline

Before any new rating variable is added to a rate filing, the data science team runs an automated disparate impact analysis:

```
FUNCTION disparate_impact_test(variable: feature_definition, training_data: dataset):
  // 4/5ths rule: approval/favorable rate for protected group must be ≥ 80% of
  // the rate for the highest-rate group

  protected_classes = ["race_proxy", "gender_proxy", "age_proxy",
                        "national_origin_proxy", "religion_proxy"]

  FOR protected_class IN protected_classes:
    protected_group_scores = training_data.filter(protected_class == 1)[variable]
    majority_group_scores  = training_data.filter(protected_class == 0)[variable]

    // Test: does variable explain residual disparity in loss prediction?
    disparity_ratio = mean(protected_group_scores) / mean(majority_group_scores)
    IF disparity_ratio < 0.80 OR disparity_ratio > 1.25:
      FLAG variable as requiring actuarial justification
      GENERATE disparity_impact_report(variable, protected_class, disparity_ratio)

  // Correlation with proxies
  FOR proxy IN protected_class_proxies:
    corr = correlation(variable, proxy)
    IF abs(corr) > 0.3:
      FLAG for legal review
```

This test must pass before a variable can be included in a rate filing submission. Results are preserved in the regulatory record for each filed algorithm version.

---

## Data Protection Architecture

### Data Classification Tiers

| Tier | Data Examples | Controls |
|---|---|---|
| **Tier 1 — Restricted** | SSN, full DOB, health data, income, bank account numbers | Field-level encryption (AES-256-GCM); HSM-managed keys; access requires MFA + break-glass logging; 7-year minimum retention |
| **Tier 2 — Confidential** | Driver's license, VIN, address, policy terms, premium | Column-level encryption in DB; role-based access; 7-year retention |
| **Tier 3 — Internal** | Telematics driving scores (not raw GPS), behavioral tiers | Encrypted at rest and in transit; internal access; 3-year retention |
| **Tier 4 — Operational** | Claim status, quote IDs, policy numbers | Standard DB encryption; customer-accessible; regulatory retention schedules |

### Telematics Data Privacy Controls

Raw GPS traces present the most privacy-sensitive data in the platform. The architecture applies multiple controls:

1. **On-device aggregation:** Raw GPS never leaves the device. Only trip-level feature vectors (distance, event counts, behavioral percentages) are uploaded to the server.
2. **Consumer-controlled dispute window:** For 30 days post-trip, the customer may request a disputed trip re-review. To support this, aggregated features are retained with a dispute flag. Raw GPS is **never** stored server-side unless the customer explicitly opts into "full trip replay" for their own benefit.
3. **Consent management:** Telematics enrollment requires explicit opt-in with plain-language disclosure. Opt-out must be available at any time from the mobile app, with the account immediately reverting to standard (non-behavioral) pricing.
4. **Retention limits:** Behavioral scores are retained for the policy life + 3 years. Trip-level records are purged after 12 months unless retained for ongoing claims investigation.

### FCRA Adverse Action Implementation

When the underwriting engine produces a coverage denial, rate increase, or reduced coverage offer, the FCRA requires an adverse action notice delivered within specified timeframes:

```
FUNCTION generate_adverse_action_notice(risk_score_record: record) -> notice:
  IF NOT record.adverse_action_triggered:
    RETURN null

  // Map internal reason codes to FCRA reason codes
  reasons = []
  shap_values = shap_store.get(record.record_id)  // sorted by absolute value descending
  top_adverse_features = shap_values.filter(value < 0).top(4)  // adverse contributors

  FOR feature IN top_adverse_features:
    reasons.append(fcra_reason_code_mapper.get(feature.name))
    -- e.g.: "credit_score" → "Your credit history"
    --       "prior_claim_count" → "Number of prior claims"
    --       "mvr_violations" → "Driving record violations"

  notice = adverse_action_notice{
    applicant_id: record.applicant_id,
    decision_type: record.decision_type,
    decision_at: record.decision_at,
    reasons: reasons,       // max 5 reasons required by FCRA
    credit_bureau_name: record.bureau_consulted,
    credit_bureau_address: ...,
    consumer_rights_statement: FCRA_CONSUMER_RIGHTS_TEXT,
    delivery_deadline: record.decision_at + 3_business_days
  }

  schedule_delivery(notice)  // email + mail, per FCRA dual-delivery rules
  RETURN notice
```

---

## NAIC Data Security Model Law Compliance

The NAIC Insurance Data Security Model Law (adopted in ~25 states as of 2025) requires insurers to:

1. **Maintain an Information Security Program** — Documented policies covering risk assessment, access controls, incident response, vendor management, and employee training
2. **Conduct Annual Third-Party Audits** — Independent security assessment and penetration testing; results reported to board of directors
3. **72-Hour Breach Notification** — Report material cybersecurity events to the state insurance commissioner within 72 hours of determination
4. **Vendor Oversight** — Written contracts with third-party service providers requiring security controls equivalent to the insurer's own program

### Breach Response Protocol

```
DETECTION → ASSESSMENT → NOTIFICATION → REMEDIATION

DETECTION (T+0):
  - Automated anomaly detection: unusual data exfiltration patterns
  - SIEM alert: failed authentication spike, privilege escalation
  - Customer report: unauthorized account access

ASSESSMENT (T+0 to T+24h):
  - Incident response team assembled (security, legal, compliance, executive)
  - Scope determination: which systems, how many records, what data tiers
  - "Material" determination: Tier 1 data affected → NAIC reportable
  - Forensic preservation: snapshot affected systems for investigation

NOTIFICATION (T+24h to T+72h):
  - Commissioner notification: NAIC-format report to each affected state's
    insurance commissioner
  - Consumer notification: FCRA/CCPA requirements (specific timing per state)
  - Law enforcement: coordination where required

REMEDIATION:
  - Contain: revoke compromised credentials, isolate affected systems
  - Eradicate: patch vulnerability, remove attacker persistence
  - Recover: restore from clean backups
  - Post-incident review: root cause analysis, control improvements
```

---

## Access Control Model

### Role-Based Access for Sensitive Operations

| Role | Permissions | Additional Controls |
|---|---|---|
| **Underwriting Analyst** | Read risk score records for assigned states; read bureau data for open quotes | Cannot access raw SSN; limited to 30-day window |
| **Claims Adjuster** | Read/write assigned claims; view damage assessments; initiate payment up to $50K | Cannot access other policyholders' data; actions logged |
| **SIU Investigator** | Read full fraud graph for assigned leads; access historical claims | Dual approval for access to Tier 1 data; supervisor countersign for SSN lookup |
| **Actuary** | Read aggregate statistical data; read anonymized risk score records for model training | No individual PII access; data accessed through anonymized ML pipeline only |
| **Regulator Auditor (external)** | Time-limited read access to specific risk score records; read rate filing configurations | Supervised access session; all actions logged; MFA required; session recorded |
| **ML Engineer** | Access to anonymized/pseudonymized training datasets; model registry read/write | No production PII access; training data in isolated ML environment |

### OFAC Sanctions Screening

All new applicants and claimants are screened against OFAC Specially Designated Nationals (SDN) list at application and FNOL submission:

```
FUNCTION screen_ofac(entity: {name, dob, address}) -> ofac_result:
  candidates = ofac_api.fuzzy_match(entity.name, threshold=0.85)
  FOR candidate IN candidates:
    score = name_match_score(entity.name, candidate.name)
           + dob_match_bonus(entity.dob, candidate.dob)
           + address_similarity(entity.address, candidate.address)
    IF score > 0.95:  // high confidence match
      RETURN {matched: true, sdn_id: candidate.id, confidence: score}
    IF score > 0.80:  // possible match → manual review
      RETURN {matched: false, review_required: true, candidate: candidate}
  RETURN {matched: false}
```

Policy binding is blocked for confirmed SDN matches. Manual review queue for possible matches is resolved within 24 hours.

---

## Insurance-Specific Attack Patterns

| # | Attack | Description | Mitigation |
|---|---|---|---|
| 1 | **Telematics score spoofing** | Attacker installs modified SDK or GPS spoofing app to fabricate safe driving data and earn undeserved discounts | Device attestation (SafetyNet/App Attest); trip plausibility checks (impossible speed transitions, repeated identical trips); anomaly detection on sensor noise patterns |
| 2 | **Fraud ring collusion with provider** | Organized ring files coordinated claims through a complicit body shop or medical provider; each individual claim appears legitimate | Graph-based detection (GNN on entity network); provider billing pattern analysis; geographic clustering of claims through same provider |
| 3 | **Rate algorithm extraction** | Competitor submits thousands of synthetic quotes to reverse-engineer the rating algorithm through differential analysis | Per-IP and per-identity rate limiting on quote API; quote request anomaly detection (systematic variable sweeps); response rounding (don't expose exact premium to the cent) |
| 4 | **Adverse action notice suppression** | Internal actor suppresses adverse action notices to avoid customer complaints; creates FCRA liability | Immutable adverse action queue with deadline monitoring; dual-control notice dispatch; compliance dashboard with aging alerts |
| 5 | **Bureau data poisoning** | Attacker manipulates their own bureau records (e.g., credit repair fraud) to obtain a favorable underwriting decision | Cross-validation between bureau sources; anomaly detection on bureau response changes between consecutive pulls; bind-time re-verification for high-risk tier transitions |
| 6 | **Model inversion attack** | Attacker uses model output (premium, tier) to infer prohibited factors or PII about other applicants | Output perturbation (small random noise on premium); minimum cohort size for tier assignment; differential privacy on aggregate statistics |
| 7 | **Claims photo manipulation** | Attacker submits doctored photos to inflate damage assessment or reuse photos from a different incident | EXIF metadata validation (timestamp, GPS, device); perceptual hash duplicate detection across claims; CV model trained on GAN-generated manipulation detection |

---

## Supply Chain Security for ML Models

The underwriting model pipeline has a unique supply chain risk: a compromised model artifact could systematically underprice risk or create backdoor pricing for specific applicants.

```
Model Supply Chain Integrity:

SOURCE → TRAINING → VALIDATION → FILING → DEPLOYMENT

SOURCE:
  - Training data access restricted to anonymized ML environment
  - Data lineage tracked: every training record traceable to source system
  - No PII in training pipeline; features pre-computed and pseudonymized

TRAINING:
  - Reproducible training: pinned dependencies, deterministic seeds, containerized
  - Training environment air-gapped from production
  - Model artifact hash computed at training completion

VALIDATION:
  - Automated validation suite: accuracy, calibration, disparate impact, adversarial robustness
  - Champion-challenger comparison on holdout dataset
  - Human actuary sign-off on statistical exhibits required before filing

FILING:
  - Model artifact hash recorded in rate filing package
  - SERFF submission includes model description, input variables, and validation results
  - State approval references specific artifact hash

DEPLOYMENT:
  - Production model artifact loaded by hash; verified against filed hash
  - Runtime integrity check: periodic inference on known test vectors; output must match
  - Any hash mismatch → immediate model quarantine; fallback to previous approved version
```

---

## Incident Response Plan: Insurance-Specific Scenarios

### Scenario 1: Prohibited Factor Leakage Discovery

**Trigger:** Audit reveals that a prohibited factor (e.g., credit score in California) was inadvertently included in the feature vector for a model version deployed in that state.

```
PHASE 1 — CONTAINMENT (T+0 to T+2h):
  - Immediately deactivate the affected algorithm version for the affected state
  - Revert to the previous approved algorithm version
  - Halt all new quotes in the affected state until reversion confirmed
  - Notify compliance officer and legal counsel

PHASE 2 — IMPACT ASSESSMENT (T+2h to T+48h):
  - Query risk_score_records for all policies bound under the affected version + state
  - Compute premium delta: re-score each affected policy with correct feature exclusion
  - Classify policies into: overcharged (refund required) vs. undercharged vs. no impact
  - Estimate total financial exposure (refunds + regulatory penalties)

PHASE 3 — REMEDIATION (T+48h to T+30d):
  - File corrective rate filing with state insurance commissioner
  - Issue refunds for overcharged policyholders (with interest per state regulation)
  - Generate consumer notifications explaining the error and corrective action
  - Root cause analysis: why did the feature exclusion fail?
  - Implement additional controls (automated pre-deployment verification of prohibited factor exclusion)
```

### Scenario 2: Telematics Data Breach

**Trigger:** Evidence that aggregated telematics trip data (behavioral scores, trip features) was exfiltrated.

```
PHASE 1 — CONTAINMENT (T+0 to T+4h):
  - Revoke API credentials for affected telematics data access path
  - Isolate affected telematics data stores from network
  - Preserve forensic snapshot of affected systems

PHASE 2 — ASSESSMENT (T+4h to T+24h):
  - Determine scope: which drivers' data was exposed?
  - Classify data sensitivity: aggregated scores (Tier 3) vs. trip features (Tier 3)
  - Note: raw GPS was never stored server-side, limiting breach scope
  - Determine if NAIC 72-hour notification threshold is met

PHASE 3 — NOTIFICATION (T+24h to T+72h):
  - File NAIC breach notification with affected state commissioners
  - Notify affected policyholders with plain-language description
  - Offer credit monitoring if breach included identity-adjacent data
```

---

## API Security

### Authentication by Endpoint Class

| Endpoint Class | Authentication | Rate Limit | Additional Controls |
|---|---|---|---|
| Consumer quote API | OAuth 2.0 + device fingerprint | 10 quotes/hour/IP; 50/day/identity | CAPTCHA on 3rd+ attempt; bot detection |
| Consumer claims API | OAuth 2.0 + MFA for payment | 5 FNOL/day/policy | Session binding; IP geolocation vs. policy state |
| Telematics upload | mTLS + device attestation token | 1,000 events/sec/device | Replay protection (nonce); device enrollment check |
| Internal fraud API | Service mesh mTLS + RBAC | 10,000 req/sec/service | No external exposure; audit logging |
| Regulatory audit API | Time-scoped JWT + MFA + VPN | 100 req/hour/session | Supervisor approval; session recording; auto-expire |
| Admin / rate filing | SSO + MFA + dual approval | 50 writes/day/user | Change approval workflow; immutable audit trail |

### Rate Limiting Strategy

```
FUNCTION rate_limit_quote_api(request) -> decision:
  // Layer 1: Per-IP rate limit
  IF ip_limiter.check(request.ip) > 100/hour:
    RETURN {blocked: true, reason: "IP_RATE_LIMIT"}

  // Layer 2: Per-identity rate limit (SSN hash or email)
  identity = hash(request.applicant.ssn OR request.applicant.email)
  IF identity_limiter.check(identity) > 10/hour:
    RETURN {blocked: true, reason: "IDENTITY_RATE_LIMIT"}

  // Layer 3: Anomaly detection (systematic variable sweeps)
  recent_quotes = quote_log.get_recent(identity, window=1_hour)
  IF detect_variable_sweep(recent_quotes):
    // Attacker varying one input at a time to probe the model
    RETURN {blocked: true, reason: "ANOMALY_SWEEP_DETECTED"}
    metrics.increment("rate_algo_extraction_attempt")

  RETURN {blocked: false}
```

---

## Penetration Testing Schedule

| Test Type | Frequency | Scope | Responsible |
|---|---|---|---|
| External application pentest | Quarterly | Consumer-facing APIs, web portal, mobile SDK | Third-party security firm |
| Fraud scoring adversarial testing | Semi-annually | Quote API probing, telematics spoofing, claim photo manipulation | Red team + data science |
| Internal network pentest | Annually | Service mesh, inter-service auth, privilege escalation | Third-party security firm |
| Social engineering (phishing) | Semi-annually | Employee targeting, especially claims adjusters and underwriters | Security awareness team |
| Regulatory audit simulation | Annually | Simulate state commissioner audit: risk record retrieval, prohibited factor verification | Compliance + engineering |
| Model supply chain audit | Annually | Training data provenance, model artifact integrity, deployment pipeline | ML platform team |

---

## Encryption Key Management

| Key Purpose | Rotation Frequency | Storage | Access Control |
|---|---|---|---|
| PII field encryption (Tier 1) | 90 days | HSM | Break-glass with dual approval + audit |
| Risk score record encryption | Annual | HSM | Automated; key versioned with record |
| Bureau response cache encryption | 30 days (aligned with TTL) | HSM | Service account only |
| Telematics feature encryption | 180 days | HSM | Telematics pipeline service account |
| Claims document encryption | Annual | HSM | Claims service + adjuster role |
| Inter-service mTLS certificates | 30 days (automated rotation) | Certificate authority | Service mesh managed |

**Crypto-deletion:** When a consumer exercises their right to data deletion (CCPA/state privacy law), the platform performs crypto-deletion: the encryption key for that consumer's Tier 1 data is destroyed, rendering the encrypted data irrecoverable without requiring physical deletion from backup tapes or cold archives.
