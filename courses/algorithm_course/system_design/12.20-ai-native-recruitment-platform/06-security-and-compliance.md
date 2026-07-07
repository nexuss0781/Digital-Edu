# 12.20 AI-Native Recruitment Platform — Security & Compliance

## Regulatory Landscape

The AI-native recruitment platform operates in one of the most heavily regulated intersections of AI law: automated decision-making that affects employment. Multiple legal frameworks impose overlapping obligations.

### NYC Local Law 144 (Automated Employment Decision Tools)

Enacted 2021, enforcement since July 2023. Applies to employers and employment agencies that use an "automated employment decision tool" (AEDT) for candidates or employees based in New York City.

**System obligations:**

| Requirement | Implementation |
|---|---|
| Independent bias audit annually | The platform generates a per-employer bias audit report covering each AEDT deployed, covering all stages where AI makes or substantially assists a decision. Published in machine-readable format. |
| Publish audit results before use | Audit results for the current year are published on a public URL before the AEDT is activated for NYC-located candidates. The compliance reporter generates the required LL144-format JSON report. |
| Candidate notice ≥ 10 business days before AEDT use | The consent_record on each candidate_profile tracks aedt_notice_sent_at. The matching pipeline checks this timestamp before ranking NYC candidates; a candidate who received notice < 10 business days ago is excluded from AI ranking (manual recruiter review only). |
| Alternative assessment option | Candidates who opt out of AEDT are routed to a human recruiter review workflow; this is a first-class pipeline branch, not a tacked-on exception. |
| Audit scope: sex, race/ethnicity, intersectional categories | The bias_monitoring_batch covers gender, race/ethnicity, and intersectional combinations as required by LL144 and EEOC EEO-1 categories. |

**Audit data pipeline:**

```
LL144 Audit Generation Process:
  1. Compliance reporter reads all candidate_stage_events for the audit period
  2. Joins with demographic_store (restricted read; separate audit trail for this join)
  3. Computes selection rates by LL144-specified categories per AEDT stage
  4. Computes impact ratios per category vs. reference group
  5. Generates audit report in LL144 JSON schema with:
     - AEDT description and model version history
     - Audit period (calendar year)
     - Selection rates per category per stage
     - Impact ratios
     - Auditor attestation fields
  6. Report archived for minimum 3 years
  7. Public-facing URL updated with new report before AEDT activation for next year
```

### EU AI Act — High-Risk AI System in Employment

The EU AI Act classifies AI systems used for recruitment, promotion, or employment as high-risk. Obligations effective by August 2026 for new systems.

**System obligations:**

| Requirement | Implementation |
|---|---|
| Registration in EU AI database | Platform is registered in the EU AI Act public database with technical documentation describing training data, accuracy metrics, bias testing, and intended use |
| Technical documentation | Maintained in a version-controlled documentation system; updated with each major model version change |
| Quality management system | ISO-aligned quality management system covering data management, model validation, bias testing, and incident response |
| Human oversight mechanism | Every AI-driven ranking and assessment decision has a human review pathway; no AI decision results in an irreversible rejection without human review option |
| Logging for traceability | All AI decisions logged with model version, inputs (as feature hash), outputs, and timestamps; retained minimum 6 months; available to national market surveillance authorities |
| Transparency to candidates | Candidates informed that AI is used; informed of logic, significance, and envisaged consequences of any AI decision that substantially affects them |
| Fundamental rights impact assessment | Conducted at system deployment and on material model changes |

### EEOC and Adverse Impact Law (US Federal)

The US Equal Employment Opportunity Commission applies the Uniform Guidelines on Employee Selection Procedures (UGESP), including the 4/5ths (80%) rule for adverse impact detection.

- The platform's bias_monitoring_batch implements the 4/5ths rule computation continuously per decision stage
- Selection rates are computed for sex and racial/ethnic categories as required by EEOC EEO-1 Component 1 categories
- Adverse impact analysis results are available for EEOC inquiry or litigation defense as structured data from the audit log

### GDPR and Candidate Data Rights

GDPR applies to candidates located in the EU; analogous obligations apply under CCPA for California candidates.

| Right | Platform Implementation |
|---|---|
| Right to access | Candidates can request a structured export of all personal data held; generated within 30 days by the GDPR pipeline; includes profile record, stage events, conversation logs, assessment scores, interview reports |
| Right to erasure | Erasure request triggers: (1) soft-delete of profile record, (2) removal from ANN vector index, (3) removal from model training datasets (anonymization, not deletion, for model integrity), (4) deletion of video files, transcripts, and reports; completed within 30 days |
| Right to object to automated decisions | Candidates may request human review of any AI-driven stage decision; implemented as the "alternative assessment pathway" in the pipeline |
| Data minimization | Demographic data collected only for bias monitoring; not used as model features; stored in isolated store with restricted access |
| Lawful basis for data processing | Application = legitimate interest for processing; sourced candidates = legitimate interest with opt-out obligation; consent required for AEDT processing in some EU member states |

---

## Demographic Data Architecture

### Isolation Design

Demographic data (gender, race/ethnicity) collected for bias monitoring must be:
1. **Isolated** from the matching features fed to the compatibility model (to prevent the model from using demographic attributes as proxy features)
2. **Access-restricted** to the bias monitoring service and compliance reporter only
3. **Audit-logged** every time it is read, including which service read it and why

```
Demographic data architecture:
  Storage:          Separate encrypted datastore from candidate_profile main store
  Schema:           {candidate_id (pseudonymized), gender_category, race_ethnicity_category,
                     intersectional_category, self_reported: boolean, collected_at, retention_until}
  Access control:   Only bias_monitor service account and compliance_reporter service account
                    can read; no direct human access except compliance officers via audited UI
  Audit log:        Every read appended to compliance audit log with {accessor, timestamp, purpose}
  Retention:        Retained for bias audit cycle (1 year) + 3-year legal hold; then purged
  Erasure:          Included in GDPR erasure pipeline; purged within 30 days of erasure request

  CRITICAL RULE: Demographic fields are NEVER passed to the embedding service, ANN index,
  or compatibility model. The matching pipeline has a feature-level assertion that verifies
  no demographic attributes are present in the feature vector before model inference.
```

---

## Audit Log Design

### Structure and Tamper Evidence

```
audit_log_entry {
  entry_id:        UUID
  timestamp:       timestamp (RFC 3339, from trusted time source)
  prev_entry_hash: bytes[32]      // SHA-256 of previous entry's content
  event_type:      enum           // MATCH_DECISION | STAGE_DECISION | BIAS_ALERT |
                                  // ASSESSMENT_SCORED | VIDEO_ANALYZED | DATA_ACCESS |
                                  // ERASURE_EXECUTED | AEDT_NOTICE_SENT
  entity_ids:      {candidate_id, req_id, batch_id, ...}
  actor:           string         // model_version OR user_id OR service_account
  decision_inputs: bytes[32]      // SHA-256 hash of input feature vector (not the features themselves)
  decision_output: string         // structured JSON of decision outputs
  model_version:   string
  policy_version:  string
  entry_hmac:      bytes          // HMAC-SHA256 of entry content; key in managed HSM
}
```

The audit log is append-only. There is no delete path. Every 24 hours, a chain integrity validator re-computes the hash chain from the last verified checkpoint and alerts if any entry has been tampered with.

---

## Access Control

### Role-Based Access Matrix

| Role | Can Access | Cannot Access |
|---|---|---|
| Recruiter | Candidate shortlists, match explanations, assessment summaries, interview reports | Raw model scores, feature vectors, demographic data |
| Hiring Manager | Shortlist for their requisitions, interview reports for their candidates | Other requisitions' data, demographic data |
| Compliance Officer | Bias audit reports, EEOC reports, audit log (read-only) | Individual candidate matching features, raw video |
| Data Privacy Officer | Erasure pipeline, GDPR request status, data subject export | Model internals, compatibility model parameters |
| ML Engineer | Model artifacts, training dataset metadata (anonymized), embedding service logs | Individual candidate data, demographic store |
| Platform Administrator | System configuration, rate limits, circuit breakers | Candidate data, demographic store |

### Model Artifact Access Control

Compatibility model weights and training datasets (even anonymized) are treated as high-sensitivity artifacts:
- Model artifacts stored in access-controlled object storage with versioned locking
- Training data access requires dual-approval (ML engineer + privacy officer)
- Model training runs executed in isolated compute environments with no internet access
- Model outputs (predictions) are logged; model weights are not logged

### Data Classification and Handling Requirements

| Data Category | Classification | Handling Requirements |
|---|---|---|
| Candidate name, email, phone | PII — High Sensitivity | Encrypted at rest (field-level); access-logged; erasable on request |
| Resume text | PII — High Sensitivity | Encrypted at rest; not used in model training (only extracted features) |
| Skills, experience records | Professional — Medium Sensitivity | Encrypted at rest; used for embedding generation; anonymizable |
| Assessment responses | Behavioral — High Sensitivity | Encrypted at rest; retained per assessment policy; erasable |
| Video recordings | Biometric-adjacent — Critical | Encrypted at rest + in transit; 90-day retention; auto-deleted |
| Interview transcripts | PII — High Sensitivity | Encrypted; retained per data retention policy; erasable |
| Demographic data | Protected — Critical | Isolated store; restricted access; separate key hierarchy |
| Match scores and rankings | AI Decision — Medium Sensitivity | Logged to audit trail; retained 7 years |
| Feature attribution maps | AI Decision — Medium Sensitivity | Logged to audit trail; skill-level explanations only (no raw features) |
| Model weights | IP — High Sensitivity | Access-controlled storage; no export without dual approval |
| Training datasets | IP + PII — Critical | Anonymized before use; lineage tracked; access requires dual approval |
| Audit log entries | Compliance — Critical | Append-only; tamper-evident; 7-year retention; no deletion |

---

## Security Controls

### Candidate Data Encryption

| Data Category | At Rest | In Transit | Key Management |
|---|---|---|---|
| Candidate profile (contact info) | AES-256, field-level | TLS 1.3 | Per-customer key in managed KMS |
| Demographic data | AES-256, dedicated key | TLS 1.3 | Separate key hierarchy from profile data |
| Assessment responses | AES-256 | TLS 1.3 | Per-customer key |
| Video submissions | AES-256 (server-side) | TLS 1.3 + chunked upload | Per-customer key; auto-deleted after retention |
| Interview transcripts | AES-256 | TLS 1.3 | Per-customer key |
| Audit log | AES-256 + HMAC | TLS 1.3 | HSM-backed key |

### Threat Model

| Threat | Risk Level | Attack Vector | Mitigation |
|---|---|---|---|
| Model inversion via matching API | High | Attacker queries matching API with crafted job descriptions to infer training data distributions | Rate limiting; outputs are rankings, not raw embeddings; feature attributions show skill-level explanations, not raw feature values |
| Bias monitor bypass | Critical | Engineering error: decisions submitted through a code path that skips batch creation | Bias monitoring reads directly from audit log event stream, not from service API; cannot be bypassed by API layer |
| Demographic data exfiltration | Critical | Compromised service account reads demographic store | Network-level isolation; all access through bias_monitor service with audit logging; no direct query path; IP allowlist |
| Profile enumeration | Medium | Attacker iterates candidate_ids to build candidate database | UUIDs are randomly generated; API requires authentication; candidates can only access their own profile |
| Video analysis result tampering | High | Compromised admin modifies interview scores post-generation | Reports written to audit log at generation time; subsequent edits detected by hash chain verification |
| GDPR erasure bypass | Critical | Subsystem fails to process erasure; candidate data persists | Erasure pipeline writes completion record to audit log; incomplete erasure detected by subsystem attestation check |
| Adversarial resume injection | High | Candidate crafts resume with hidden text to manipulate embedding | Resume parser strips non-visible content; embedding computed from extracted structured fields only, not raw text |
| Prompt injection via conversational AI | High | Candidate injects malicious prompt in chat message to manipulate LLM | Input sanitization layer; LLM system prompt guards; output filtering; response template constraints |
| Assessment item extraction | Medium | Candidate uses screen capture to build item bank; shares items | Item exposure monitoring; items with >20% exposure rate auto-retired; proctoring flags unusual screen activity |
| Training data poisoning | High | Malicious actor submits fake profiles to skew embedding space | Profile verification requirements for sourced candidates; anomaly detection on profile creation patterns |
| Cross-tenant data leakage | Critical | Multi-tenant architecture allows employer A to see employer B's candidates | Tenant isolation enforced at data layer (partition key includes employer_id); API gateway enforces tenant boundary |
| Insider threat: recruiter exports candidate list | Medium | Recruiter with legitimate access bulk-exports candidate data for competitor | Rate limiting on candidate data access; anomaly detection on export volume; audit trail on all data access |

---

## AI-Specific Security Controls (2025-2026 Landscape)

### Model Supply Chain Security

```
Model artifact security chain:

  1. Training environment: isolated compute with no internet access
  2. Training data: lineage tracked; no unapproved external datasets
  3. Model weights: signed with cryptographic key at training completion
  4. Artifact storage: versioned object storage with integrity verification
  5. Deployment: signature verified before model load; rejected if tampered
  6. Runtime: model outputs logged; input/output distributions monitored for anomaly
  7. Retirement: model weights securely deleted when version is retired

Supply chain attack mitigations:
  - No third-party pre-trained models loaded without security review
  - Embedding model fine-tuned from base model with known provenance
  - Model serialization format validated against known-safe schema
  - Dependency pinning for all ML framework versions
```

### LLM Output Safety for Conversational AI

```
LLM safety architecture:

  Layer 1: Input Filtering
    - Candidate message sanitized: strip control characters, limit length
    - Prompt injection detection: classify input for adversarial patterns
    - PII detection: mask candidate PII before passing to LLM

  Layer 2: System Prompt Hardening
    - System prompt instructs LLM to stay within recruitment context
    - Candidate demographic attributes never included in prompt context
    - Salary, compensation, and protected class topics explicitly excluded

  Layer 3: Output Filtering
    - Response classified for harmful content before delivery
    - Legal review of template responses for compliance-sensitive topics
    - Responses about job qualifications reference only stated requirements
    - No speculative statements about candidate fit or probability of hire

  Layer 4: Audit
    - All LLM inputs and outputs logged to audit trail (PII-masked)
    - Weekly sample review by compliance team (100 random conversations)
```

### EU AI Act Transparency Requirements (2025-2026)

| Obligation | Implementation | Status |
|---|---|---|
| Inform candidates AI is in use | Consent banner + in-app notice before any AI processing | Active |
| Explain AI decision logic | Match explanation UI shows top-5 contributing features per decision | Active |
| Provide human review pathway | "Request human review" button on every AI-driven stage decision | Active |
| Register as high-risk AI system | Platform registered in EU AI database with technical documentation | Active |
| Maintain technical documentation | Version-controlled documentation updated with each model change | Continuous |
| Conduct fundamental rights impact assessment | Performed at deployment; repeated on material model changes | Biannual |
| Appoint authorized representative in EU | EU-based compliance officer designated | Active |
| Post-market monitoring plan | Continuous bias monitoring + quarterly model performance review | Active |

---

## Incident Response for AI-Specific Incidents

### AI Incident Classification

| Incident Type | Severity | Response Timeline | Example |
|---|---|---|---|
| Bias violation detected | SEV-2 | 4-hour compliance review | 4/5ths rule violation for gender in engineering shortlisting |
| Model producing discriminatory outputs | SEV-1 | Immediate model rollback | Compatibility model systematically scoring one demographic group lower |
| LLM generating non-compliant responses | SEV-1 | Immediate template fallback | Chatbot making promises about salary or guaranteeing interview |
| Candidate data breach | SEV-1 | Immediate containment; 72-hour GDPR notification | Unauthorized access to candidate profile store |
| Assessment item leak confirmed | SEV-2 | Retire affected items within 24h | Item answers shared on public forum |
| Audit log integrity failure | SEV-1 | Halt all decision services | Hash chain verification failure in audit log |
| GDPR erasure deadline breach | SEV-1 | Immediate compliance escalation | Erasure request past 30-day deadline |

### Post-Incident Review for AI Incidents

```
AI incident post-mortem template:

  1. What AI system was affected? (model type, version, deployment region)
  2. What was the candidate impact? (number affected, decision types, demographic groups)
  3. Root cause: was this a training data issue, model architecture issue, or operational issue?
  4. Were any irreversible decisions made before detection?
     If yes: candidate remediation plan (re-evaluation, notification, legal review)
  5. What monitoring gap allowed the incident to persist?
  6. Corrective actions:
     - Immediate: model rollback, batch hold, candidate notification
     - Short-term: retrain model, update monitoring thresholds
     - Long-term: architectural change to prevent recurrence
  7. Regulatory notification required? (GDPR, EU AI Act serious incident reporting)
```

---

## Data Retention and Lifecycle Management

### Retention Policies by Data Category

| Data Category | Active Retention | Archive Retention | Deletion Trigger |
|---|---|---|---|
| Candidate profile (active) | While candidate is active or re-engageable | 2 years after last activity | Candidate opt-out or retention expiry |
| Candidate profile (sourced, no application) | 6 months from crawl date | None | Automatic deletion at 6 months |
| Assessment responses | 1 year from assessment date | 3 years (anonymized) | Automatic + GDPR erasure request |
| Video recordings | 90 days from submission | None | Automatic deletion at 90 days |
| Interview transcripts | 1 year from interview | 3 years (anonymized) | Automatic + GDPR erasure request |
| Conversation logs | 1 year from last message | 2 years (anonymized) | Session expiry + GDPR erasure |
| Audit log entries | 7 years | Permanent (cold storage) | **Never deleted** (regulatory requirement) |
| Bias monitoring results | 7 years | Permanent (cold storage) | **Never deleted** (LL144 + EEOC) |
| Demographic data | 1 year (bias audit cycle) + 3-year legal hold | None | Purged after legal hold expiry |
| Model training datasets | Retained for model lineage | Until model is retired + 3 years | Tied to model version lifecycle |

### Automated Lifecycle Management

```
Data lifecycle automation:

  Daily job: Scan candidate profiles for retention expiry
    → Profiles past retention_until → enqueue for soft-delete
    → Soft-deleted profiles held 30 days for recovery → then hard-deleted

  Daily job: Scan video submissions for 90-day expiry
    → Videos past 90 days → delete from object storage
    → Retain transcript and analysis report (separate retention schedule)

  Weekly job: Scan sourced profiles without applications
    → Profiles > 6 months old with no application → delete
    → Remove from ANN index; remove embedding from vector store

  Monthly job: Verify audit log retention compliance
    → Entries approaching 7-year mark → migrate to cold storage
    → Verify hash chain integrity after migration
    → Confirm no entries were lost in migration (count verification)

  On-demand: GDPR erasure pipeline
    → Triggered by candidate request → 30-day deadline
    → Orchestrated deletion across all subsystems
    → Completion attestation logged to audit trail
```

---

## Compliance Checklist: Pre-Launch Gate

Before the platform processes candidate data in a new jurisdiction, the following compliance checks must pass:

| # | Check | Owner | Frequency |
|---|---|---|---|
| 1 | Data processing agreement with each enterprise customer | Legal | Per customer |
| 2 | Privacy impact assessment for candidate data processing | DPO | Per jurisdiction |
| 3 | AEDT notice template reviewed by employment counsel | Legal | Annual |
| 4 | Bias audit completed and published (LL144) | Compliance | Annual |
| 5 | EU AI Act registration updated (if applicable) | Compliance | Per model change |
| 6 | GDPR erasure pipeline tested end-to-end | Engineering | Quarterly |
| 7 | Demographic data isolation verified (network-level) | Security | Monthly |
| 8 | Audit log integrity chain verified | Engineering | Daily (automated) |
| 9 | Model artifact signatures verified | ML Engineering | Per deployment |
| 10 | Penetration test of candidate-facing APIs | Security | Annual |
| 11 | LLM output safety audit (sample review) | Compliance | Weekly |
| 12 | Assessment item exposure rates within threshold | ML Engineering | Daily (automated) |
