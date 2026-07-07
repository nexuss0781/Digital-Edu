# 12.17 Content Moderation System — Security & Compliance

## Reviewer Safety and Wellness Architecture

### The Psychological Burden Problem

Content moderators—particularly those reviewing CSAM, graphic violence, and terrorism content—experience well-documented psychological harm including secondary traumatic stress, vicarious trauma, and burnout. Platform operators have both a moral obligation and an operational incentive (turnover is extremely costly in terms of training, certification, and quality ramp-up) to protect reviewer wellness. The system embeds wellness constraints directly into the moderation infrastructure rather than treating them as HR policies enforced manually.

### Exposure Caps and Category-Based Controls

The reviewer data model carries per-reviewer, per-category daily caps that are enforced at the assignment layer:

```
CSAM exposure limits:
  Daily cap: 20 confirmed CSAM items maximum per reviewer
  Consecutive cap: 5 CSAM items without a mandatory 15-minute break
  Weekly cap: 80 CSAM items; above this threshold reviewer is placed on rest rotation

Graphic violence:
  Daily cap: 50 items; consecutive cap: 10 items

General harmful content (hate speech, self-harm):
  No hard cap; monitored via wellness check-in responses

All limits are configurable per-reviewer (some reviewers have clinical training
and voluntarily accept higher limits with appropriate support structures).
```

When a reviewer reaches their daily cap for a category, the reviewer assignment algorithm marks that category as unavailable for that reviewer for the remainder of their shift. The system automatically routes that reviewer to lower-harm categories.

### Graduated Content Presentation

Harmful content is never presented to reviewers at full resolution without explicit action:

| Content Category | Default Presentation | Reviewer Action to Reveal |
|---|---|---|
| CSAM | Maximum blur (pixelated beyond recognition) | Supervisor-approved reveal with logged justification |
| Graphic violence | Moderate blur | Single click to de-blur; logged |
| NSFW (adult) | Low blur | Hover to reveal; not logged |
| Text (hate speech, threats) | Full text displayed | N/A |

CSAM images are never stored in human-readable form on the moderation platform. The system stores only the perceptual hash and a reference to the forensic archive. When a reviewer must view CSAM to make a determination (rare; typically only for novel content not matching known hashes), access requires multi-party authorization (reviewer + supervisor both authenticated), is logged in the audit trail with timestamp, reviewer ID, and business justification, and is reviewed by the wellness program within 24 hours.

### Wellness Monitoring and Intervention System

The wellness monitoring component runs continuous passive and active monitoring:

**Passive signals:**
- Review speed changes (unusual slowing may indicate distress; unusual speeding may indicate inattention)
- Decision pattern shifts (unusual increase in reversals may indicate decision fatigue)
- Intra-shift break patterns (skipping breaks is an early stress indicator)

**Active check-ins:**
- Automated wellness check-in prompts after every 30 consecutive harmful items
- Mandatory check-in at shift midpoint for CSAM-category reviewers
- Daily end-of-shift wellness questionnaire (brief; 3 questions; responses trigger support referral if thresholds exceeded)

**Intervention triggers:**
- `CHECK_IN_NEEDED`: Prompt appears in workstation; reviewer responds before next item loads
- `MANDATORY_BREAK`: Workstation locks for 15 minutes; reviewer cannot review items
- `REFERRED`: Wellness flag escalated to supervisor; reviewer moved to administrative tasks; EAP referral initiated

All wellness data is stored separately from moderation decision data with restricted access (HR and wellness program only; not accessible to quality assurance or legal teams without explicit consent).

---

## Adversarial Content Detection

### Taxonomy of Adversarial Techniques

Sophisticated bad actors employ a range of techniques to evade content moderation:

**Text obfuscation:**
- *Leetspeak and symbol substitution*: h@te, h4te, h8e
- *Unicode homoglyphs*: Using Cyrillic, Greek, or other character sets that look visually identical to Latin characters
- *Zero-width character injection*: Inserting invisible characters to break keyword matching
- *Intentional misspellings*: "t3rrorist", "kiddie p0rn"
- *Language mixing*: Switching between languages mid-sentence to confuse monolingual models
- *Euphemism and dog whistles*: Community-specific coded language that is opaque to classifiers without cultural context

**Image and video evasion:**
- *Minor perturbations*: Small pixel-level changes that exploit model decision boundaries (adversarial examples)
- *Steganographic embedding*: Hiding harmful content within seemingly benign carrier images
- *Color space manipulation*: Transforming images to non-standard color spaces that confuse perceptual hash algorithms
- *Composite overlays*: Overlaying CSAM thumbnails within complex scenes that hide from frame-level classifiers

**Coordinated inauthentic behavior:**
- *Report bombing*: Coordinated false user reports targeting legitimate content
- *Engagement manipulation*: Using bots to amplify borderline content before moderation catches it
- *Account cycling*: Creating new accounts to evade account-level suspensions

### Defense Mechanisms

**Text normalization pipeline** (described in deep-dive): Applied before every classifier invocation; continuously updated with new obfuscation patterns identified by the adversarial signal team.

**Ensemble model robustness**: Using an ensemble of diverse model architectures (transformer + gradient boosting + LLM) reduces the effectiveness of adversarial examples designed to fool a single model architecture. Gradient-based adversarial examples that fool BERT may not fool XGBoost features.

**Perceptual hash robustness**: PhotoDNA and PDQ are specifically designed to resist common image transformations. Robustness testing (published 2024-2025) shows these algorithms maintain high true positive rates against crop, resize, recompress, and moderate color manipulation. Severely perturbed images that evade hash matching are typically caught by ML image classifiers.

**Coordinated behavior detection**: The account trust scoring system (external to the moderation pipeline but informing it) uses graph analysis to detect accounts with unusual amplification patterns, coordinated posting times, and shared infrastructure signals. High coordinated-behavior-risk accounts receive lower trust scores, which increases their content's priority in the review queue.

**Cross-platform signal sharing**: The system consumes adversarial signal feeds from the Global Internet Forum to Counter Terrorism (GIFCT) and the Technology Coalition, which aggregate adversarial technique reports from multiple platforms. New evasion patterns identified on one platform are shared as hash updates and policy rule updates that apply across member platforms within hours.

---

## DSA Compliance Architecture

### Transparency Database Integration

The EU Digital Services Act Transparency Database requires platforms to submit a *statement of reasons* for every content removal. As of the July 2025 implementing regulation, submissions must use standardized machine-readable templates covering:

- Content category and subcategory (standardized taxonomy)
- Legal ground for removal (specific DSA article or national law)
- Territorial scope of removal (geo-restricted vs. global)
- Date and time of detection and removal
- Whether the decision was automated, human, or hybrid
- Whether the account received prior warning

The system generates DSA submission records automatically for every enforcement action tagged with a DSA-applicable policy rule. These records are batched and submitted to the DSA Transparency Database via its regulatory API within 24 hours of the enforcement action.

### Transparency Reports

Public quarterly transparency reports aggregate moderation activity across all DSA-regulated surfaces. The system's reporting module generates these reports from the audit log, covering:

- Total content items actioned by category
- Automation rate (automated vs. human decisions)
- Appeals received, resolved by tier, overturned rate
- Reviewer headcount and throughput
- False positive rate estimates (derived from appeals outcomes and calibration audits)
- SLA compliance rates

Reports are published in both human-readable PDF format and machine-readable JSON format. The JSON schema is versioned to allow external researchers and civil society organizations to process reports programmatically.

### NetzDG 24-Hour Removal SLA

German law requires removal of clearly illegal content within 24 hours of receiving a valid complaint. The system implements NetzDG compliance through:

1. **Complaint intake tagging**: All user reports originating from German users (or reports explicitly tagged as NetzDG complaints) receive a geo-scope tag in the report record
2. **SLA calculation**: NetzDG-tagged items have their SLA deadline set to 24 hours from complaint receipt
3. **Priority boosting**: NetzDG items receive an automatic priority boost in the review queue proportional to elapsed SLA fraction
4. **SLA breach prevention**: When NetzDG items reach 80% of their SLA window unresolved, an escalation alert fires; reviewer managers are notified and emergency assignment occurs
5. **Compliance logging**: Every NetzDG-relevant decision is logged with complaint receipt timestamp, decision timestamp, and delta for audit purposes

---

## NCMEC Reporting Architecture

### Mandatory CyberTipline Reporting

Platforms in applicable jurisdictions are legally required to report confirmed CSAM to the National Center for Missing and Exploited Children (NCMEC) via the CyberTipline API within 24 hours of detection. The system automates this process:

```
CSAM confirmed detection flow:
  1. Hash match against NCMEC or Technology Coalition hash DB → CSAM_CONFIRMED signal
  2. Action Executor: REMOVE content immediately (does not wait for human review)
  3. NCMEC Filer service queued with:
     - Platform content identifier
     - User account identifier (encrypted)
     - Detection timestamp
     - Perceptual hash(es) matched
     - Hash database source
     - Content type metadata
     - IP address and device metadata (if available and legally permissible)
  4. NCMEC API submission within 60 seconds of detection
  5. CyberTipline report ID stored in moderation_decision record
  6. Content preserved in forensic archive (not deleted until NCMEC/law enforcement
     confirms it is no longer needed as evidence)
```

### Forensic Preservation vs. Data Minimization Tension

A critical design tension: GDPR and similar privacy regulations require data minimization—platforms should not retain user data longer than necessary. But NCMEC reporting and law enforcement investigations require preservation of evidence for potentially months or years. The system resolves this tension through a forensic hold mechanism:

- When NCMEC-reportable content is detected, a forensic hold is placed on all associated data (content, metadata, account data)
- The hold prevents normal data deletion routines from operating on this data
- Holds are reviewed quarterly; data is released when the investigation is closed or the hold period expires under applicable law
- All holds are logged in the audit trail with legal basis, expiry date, and any law enforcement requests

---

## Access Control and Data Security

### Role-Based Access Control

| Role | Access Level | Restrictions |
|---|---|---|
| Standard Reviewer | Can view assigned content items; submit decisions | Cannot view CSAM unblurred; cannot access other reviewers' items |
| CSAM-Cleared Reviewer | Can view CSAM (blurred by default); submit CSAM decisions | Subject to exposure caps; access logged |
| Senior Reviewer | Can view any content item; access appeals queue | Cannot modify audit log |
| Reviewer Manager | Access to reviewer performance data; queue management | Cannot view reviewer wellness data |
| Policy Administrator | Can create and modify policy rules | Changes require dual approval; logged |
| Compliance Officer | Read access to transparency reports and audit log | Cannot trigger enforcement actions |
| Forensic Investigator | Access to forensic archive under multi-party authorization | Every access logged with justification |

### Audit Log Integrity

The audit log uses cryptographic chaining to provide tamper evidence. Each log entry contains:
- SHA-256 hash of the previous entry's content
- Entry content (decision details, action details)
- Timestamp (from a trusted time source)
- Entry-level HMAC signed with a hardware security module (managed HSM)

To verify log integrity, auditors run a chain verification tool that re-computes hashes from entry N onward and compares to stored values. Any modification of a historical entry breaks the chain at that point.

### Encryption Strategy

| Data | At Rest | In Transit |
|---|---|---|
| Content items | AES-256 via object storage server-side encryption | TLS 1.3 |
| Perceptual hashes (sensitive) | AES-256; key managed by managed KMS with HSM backing | TLS 1.3 |
| Reviewer notes | AES-256 with reviewer-specific key derivation | TLS 1.3 |
| Wellness data | AES-256; separate key hierarchy from moderation data | TLS 1.3 |
| Audit log | AES-256; HMAC-signed entries | TLS 1.3 |
| Forensic archive | AES-256; keys escrowed with legal team | TLS 1.3; SFTP for law enforcement transfers |

### Key Rotation Schedule

| Key Type | Rotation Period | Rotation Method | Impact During Rotation |
|---|---|---|---|
| TLS certificates | 90 days | Automated via certificate authority; dual-cert overlap | Zero downtime; new cert active before old expires |
| Object storage encryption keys | 365 days | Re-encryption of new writes with new key; old data re-wrapped on read | Transparent; managed by KMS |
| Hash DB encryption keys | 180 days | Full re-encryption batch job during low-traffic window | 2-4 hour window of elevated CPU; hash matching unaffected |
| Audit log HMAC keys | 365 days | New key for new entries; old entries verifiable with escrowed old key | Chain verification crosses key boundary; tool handles this |
| Reviewer session keys | 24 hours | Auto-expire; re-authenticate at shift start | Reviewer re-login required; session state preserved server-side |
| API authentication tokens | 30 days | Rolling rotation with 48-hour overlap period | Consumers must handle dual-token validation during overlap |
| Forensic archive escrow keys | Never auto-rotated | Manual rotation only under legal team authorization | Requires re-encryption of all held evidence; legal sign-off required |

### Compliance Certification Matrix

| Certification | Scope | Renewal | Key Controls |
|---|---|---|---|
| SOC 2 Type II | Moderation pipeline + reviewer platform | Annual | Access controls, audit logging, incident response |
| ISO 27001 | Information security management | Annual (3-year cycle) | Risk assessment, security controls, continuous improvement |
| DSA compliance | EU content moderation obligations | Continuous (auditable at any time) | Transparency reports, appeal mechanisms, OCSDS access |
| NCMEC compliance | CSAM reporting obligations | Continuous | CyberTipline integration, forensic preservation, reporting SLA |
| GDPR | Data protection for EU data subjects | Continuous | Erasure pipeline, consent management, data residency |

---

## Advanced Threat Scenarios

### Threat 1: Model Inversion Attack on Classifiers

An adversary probes the moderation system by submitting crafted content items and observing the enforcement action (or lack thereof). By iterating, the adversary can map the model's decision boundary for a specific category, enabling them to craft content that is just below the detection threshold.

**Defenses:**
1. **Non-deterministic response**: Add small random noise to the zone boundary for borderline content. Items near the threshold receive stochastic treatment (sometimes allowed, sometimes queued for review). This prevents adversaries from precisely mapping the boundary.
2. **Rate limiting probing behavior**: Track per-account submission patterns that resemble boundary probing (rapid submission of similar content with small variations) and escalate the account's trust risk score.
3. **Canary features**: Include classification features that are not used for enforcement but are monitored. If an adversary starts optimizing against these features, it reveals their probing behavior without affecting real enforcement.
4. **Delayed enforcement feedback**: Do not immediately reveal enforcement actions for borderline content. Add a random delay (1-60 minutes) before applying visibility restrictions on near-threshold items.

### Threat 2: Insider Threat — Reviewer Abuse

A malicious reviewer deliberately approves violating content or deliberately removes legitimate content for ideological, financial, or personal reasons.

**Defenses:**
1. **Calibration injection**: The 5-10% calibration injection rate catches systematic bias. A reviewer who approves known-violating calibration items is immediately flagged.
2. **Decision pattern analysis**: Anomaly detection on per-reviewer decision distributions. A reviewer whose decisions deviate significantly from cohort averages triggers investigation.
3. **Dual-review for high-sensitivity**: CSAM decisions and terrorism decisions require confirmation by a second reviewer. Single-reviewer approvals are not final for these categories.
4. **Rotation**: Reviewers are periodically rotated across content categories and queue partitions to prevent sustained influence over a specific content stream.

### Threat 3: Mass Report Attack (Report Bombing)

A coordinated group submits thousands of false reports against a targeted content creator's account, triggering automated escalation and potentially causing account suspension.

**Defenses:**
1. **Reporter credibility scoring**: Reports from accounts with a history of accurate reports carry more weight than reports from new or low-accuracy accounts.
2. **Velocity-based deduplication**: If > 100 reports target the same content item within 5 minutes, the system treats them as a single signal and triggers a CIB investigation rather than treating each report independently.
3. **Appeal fast-track for mass-reported content**: Content subject to mass reporting that is overturned is flagged for immediate appeal processing, not standard SLA.

---

## Data Classification Matrix

| Data Element | Classification | Retention | Access | Erasure |
|---|---|---|---|---|
| Content item (text) | Internal | 30 days after removal + audit hold | Reviewers with assignment | Delete after retention expires |
| Content item (image/video) | Confidential | Deleted immediately on removal; hash preserved | Reviewers with assignment; CSAM: supervisor approval | Immediate delete; hash retained |
| CSAM content | Regulated/Criminal | Forensic hold until law enforcement release | Multi-party authorization; CSAM-cleared only | Only on law enforcement or legal release |
| Model classification scores | Internal | 1 year | Moderation pipeline; ML team | Standard delete |
| Reviewer decisions | Internal | 7 years (audit) | Reviewer managers; compliance | Non-deletable (audit requirement) |
| Reviewer wellness data | Confidential (HR) | 2 years | HR and wellness program only | Delete on reviewer departure + 2 years |
| Audit log entries | Regulated | Indefinite | Compliance officers; legal (read-only) | Non-deletable |
| Hash DB entries (CSAM) | Regulated/Criminal | Indefinite (source-controlled) | Hash matching service only | Only if source removes |
| Policy rules | Internal | All versions retained | Policy administrators | Archival, not deletion |
| Appeal records | Regulated | 7 years (DSA) | Compliance; appeals reviewers | Non-deletable |
| NCMEC reports | Regulated/Criminal | Indefinite | Forensic investigators; legal | Only on NCMEC confirmation |

---

## Breach Response Playbook

### Detection Phase (0-15 minutes)

```
Alert types that trigger incident response:
  - Unauthorized access to hash database (forensic sensitivity)
  - Anomalous reviewer decision patterns (potential insider threat)
  - CSAM content access outside moderation workflow
  - Audit log integrity check failure
  - Mass data exfiltration from moderation decision store

Step 1: Validate alert
  - Confirm alert is not a false positive (check for known deployments, tests)
  - Identify scope: which data, which system, which accounts affected
  - If CSAM-related: escalate immediately to legal and law enforcement liaison
```

### Containment Phase (15-60 minutes)

```
Step 2: Isolate the threat
  - Revoke access for compromised credentials
  - If reviewer account compromised: lock account; invalidate session
  - If hash database exfiltration suspected: rotate hash DB encryption keys
  - If audit log tampered: freeze all moderation enforcement actions
    pending integrity restoration

Step 3: Preserve evidence
  - Snapshot all relevant system state (audit logs, access logs, network logs)
  - Do NOT attempt to "fix" the compromised state; preserve for forensic analysis
  - For CSAM-related breaches: preserve per NCMEC and law enforcement requirements
```

### Notification Phase (1-72 hours)

```
Step 4: Assess regulatory notification requirements
  - If CSAM data was exposed: mandatory law enforcement notification
  - If user PII was exposed: GDPR notification (72 hours)
  - If hash database was compromised: notify NCMEC, GIFCT, Technology Coalition
  - If reviewer data was exposed: notify affected reviewers

Step 5: Public communication (if required)
  - Prepare incident summary for transparency report
  - Coordinate messaging with legal, communications, and trust & safety
```

### Recovery Phase (1-30 days)

```
Step 6: Remediate
  - Patch the vulnerability that enabled the breach
  - Restore hash database from verified backup if compromised
  - Verify audit log chain integrity from last known-good entry
  - Re-review moderation decisions made during the breach window

Step 7: Post-incident
  - Root cause analysis and published (internal) postmortem
  - Update threat model with new attack vector
  - Implement additional monitoring for the attack pattern
  - Update staff training to cover new threat scenario
```

---

## Supply Chain Security for ML Models

### Model Provenance and Integrity

ML models are a critical attack surface: a tampered model could systematically miss certain content categories or produce biased decisions. The system enforces model provenance controls:

- **Signed model artifacts**: Every model binary is cryptographically signed by the ML training pipeline. The inference fleet verifies signatures before loading any model.
- **Training data audit trail**: Each model version links to the exact training data snapshot, hyperparameters, and evaluation metrics used during training. This enables root-cause analysis if a model produces unexpected decisions.
- **Immutable model registry**: Model versions are stored in an append-only registry. A model cannot be overwritten; only new versions can be added. Rollback points to a specific previous version by ID.
- **Third-party model validation**: For models incorporating pre-trained components (e.g., BERT base weights), the system verifies the checksum of upstream weights against published checksums from the model provider.
- **Canary validation before deployment**: Every model must pass a standardized evaluation suite including adversarial examples, known edge cases, and bias tests before it is eligible for canary deployment.
