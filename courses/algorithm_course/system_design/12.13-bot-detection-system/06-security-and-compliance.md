# 06 — Security & Compliance: Bot Detection System

## Adversarial ML Defense

### The Model Inversion Problem

Bot detection ML models face a unique adversarial threat: sophisticated bot operators can probe the system systematically to reverse-engineer the model's decision boundary. By sending thousands of crafted requests with slightly varied signals and observing whether each receives a challenge or passes, an attacker can reconstruct the feature weights that matter most, then specifically optimize their bot to score favorably on those features.

Defenses against model inversion attacks:

**1. Response opacity:** Never return the raw risk score to the client. Return only a binary challenge-or-not decision. Even challenge timing can leak information (responding faster when confident), so deliberate jitter is added to challenge response times.

**2. Score noise injection:** Add calibrated Gaussian noise to internal scores before thresholding. The noise is large enough to make per-request inference by the attacker noisy (± 0.05 score units), but small enough not to materially affect legitimate traffic. Over hundreds of probes, the attacker cannot recover precise feature weights.

**3. Model rotation:** Periodically (every 2–4 weeks) deploy a model with different feature weightings, even if accuracy is similar. An attacker who has reverse-engineered Model A will find their optimized bot suddenly detectable again when Model B is deployed, requiring them to restart the reconnaissance process.

**4. Canary features:** Deliberately include a small set of features that carry zero predictive weight in the real model but are observable by an attacker. If these features are over-represented in a session (suggesting the attacker is optimizing for them), it reveals that the session is conducting model probing, which is itself a strong bot signal.

### Honeypot Signal Injection

Honeypot signals are invisible traps embedded in application responses that legitimate users never trigger but automated scrapers reliably do:

**Honeypot links:** Hidden `<a>` tags in page HTML, styled with `display:none` and `visibility:hidden`. Search engine crawlers with JavaScript disabled will follow them; sophisticated scrapers that parse raw HTML without rendering it will also follow them. A session that requests the honeypot URL is flagged with near-certainty as a bot.

**CSS honeypot forms:** A form field hidden via CSS with `display:none`. Browsers don't autofill hidden fields, and humans don't see them. Bots that programmatically fill all form fields on a page will populate the honeypot field, which when submitted is a reliable bot signal.

**Timing traps:** A deliberately slow endpoint (500ms response delay injected server-side) that humans wouldn't notice but automated scrapers will avoid by timing out prematurely, revealing their timeout configuration.

**Honeypot API paths:** Fake API endpoints documented in a `robots.txt` disallow comment that only a bot reading the file carefully would discover. Any request to these paths is bot behavior.

### Feature Obfuscation

The JavaScript challenge script is obfuscated to prevent reverse engineering of the signal collection logic:

```
Obfuscation layers applied to challenge JS:
1. Variable and function name mangling (random identifiers)
2. Control flow obfuscation (insert dead branches, flatten loops)
3. String encryption (all literal strings encoded, decoded at runtime)
4. Anti-debugging detection:
   - Measure time to execute a code block; > 1000ms indicates DevTools paused execution
   - Check for debugger statement breakpoints
   - Detect unusual call stack depths (debugger-injected frames)
5. Dynamic code generation: some probe logic assembled from fragments at runtime
6. Integrity self-check: hash the script body at runtime; deviation indicates tampering

Important: Obfuscation is defense-in-depth, not a primary control. Determined attackers
will deobfuscate the script. Its value is raising the cost and time required.
```

### Anti-Replay Protections for Challenge Tokens

Challenge tokens are designed to be single-use, time-limited, and session-bound:

```
Token properties:
  - Single-use: verified via atomic compare-and-swap in token store (solved: false → true)
  - Time-limited: 5-minute TTL; expired tokens rejected even if unsolved
  - Session-bound: HMAC includes session_id; token cannot be transferred to another session
  - IP-bound (optional, configurable): HMAC includes client IP; token invalid from different IP
  - Request-bound (for high-security endpoints): HMAC includes specific request URL; token
    cannot be used for a different endpoint than the one that issued it

Replay attack scenario:
  1. Bot captures a valid challenge token from one session
  2. Attempts to use it in a different session
  Result: session_id mismatch → token rejected + session flagged as bot (token theft signal)
```

---

## Fingerprint Privacy and GDPR Compliance

### What Is Collected and Why

Device fingerprinting involves collecting technical characteristics of a browser and device that, when combined, can uniquely identify a device. This is privacy-sensitive data under GDPR (Article 4, definition of "personal data" includes online identifiers that relate to an identifiable natural person).

**Legal basis options:**
1. **Legitimate interests (Article 6(1)(f)):** Fraud prevention and security are recognized legitimate interests under GDPR recital 47. The key test is that the legitimate interest is not overridden by the data subject's fundamental rights—security and fraud prevention typically pass this test.
2. **Consent (Article 6(1)(a)):** For non-essential cookies and tracking, explicit consent via cookie banner is required. Fingerprinting for bot detection (security purpose) can be distinguished from fingerprinting for advertising (commercial purpose).

### Data Minimization Implementation

The system applies data minimization throughout:

**Hashing before storage:** Raw canvas pixel arrays, WebGL parameter sets, and audio buffers are never stored. Only their SHA-256 hashes are stored. The hash enables consistent re-identification without storing recoverable behavioral data.

**Signal aggregation before transmission:** Mouse trajectories are aggregated into statistical features (mean velocity, variance) before transmission to the server. Raw (x, y, t) sequences are processed in-browser and immediately discarded after feature extraction.

**Short retention periods:** Session state: 30-minute TTL. Fingerprint records: 1-year TTL (required for long-term bot pattern analysis) with anonymization after 90 days (IP addresses redacted). Raw behavioral event streams: 90-day retention for model training, then deleted.

**Pseudonymization:** Session IDs and fingerprint hashes are secondary identifiers, not directly linked to user accounts unless the user authenticates. Unauthenticated bot detection data is pseudonymous.

### Privacy Impact Assessment Dimensions

| Signal | Privacy Sensitivity | Retention | Minimization Applied |
|---|---|---|---|
| Canvas hash | High (device-unique) | 1 year | Stored as hash only, never raw pixels |
| WebGL renderer string | Medium (GPU-unique) | 1 year | Aggregated with other hardware signals |
| IP address | High (location-sensitive) | 90 days | Redacted from fingerprint record after 90 days |
| Mouse trajectory | High (behavioral biometric) | 30 days | Aggregated to statistics in-browser |
| Keystroke timing | High (biometric) | 30 days | Only inter-key timing, never key identities |
| User-agent string | Low | 30 days | Stored for analysis, no minimization needed |
| TLS fingerprint | Low | 30 days | Technical signal, not user-specific |

### Right to Access and Erasure

GDPR Articles 15 and 17 require providing access to and erasure of personal data:

**Access:** Users can request a report of what fingerprint data is associated with their account (if authenticated). The report includes the fingerprint hash, session count, first/last seen dates, and any bot flags. Raw signals are not stored, so raw data cannot be provided.

**Erasure:** On erasure request, the fingerprint record is deleted from the database and the hash is added to an erasure blocklist. Any future request from a device producing this fingerprint hash will not restore the record; the session starts fresh with no prior history.

**Limitation:** Fingerprint records are not linked to user accounts for unauthenticated sessions. Erasure of unauthenticated fingerprint records requires device-side proof (submitting the fingerprint payload from the device in question), preventing third-party erasure of other users' records.

---

## False Positive Management

### The Cost of False Positives

Every incorrectly challenged or blocked legitimate user represents measurable harm:
- **E-commerce conversion loss:** A challenged user at checkout has a 35-60% abandonment rate
- **Accessibility harm:** Users with disabilities using assistive technology (screen readers, eye-tracking, switch access) produce behavioral signals that can superficially resemble bots
- **Legitimate automation harm:** Test automation, monitoring scripts, and performance testing tools need to operate without triggering bot detection

### Allowlisting Framework

**Tier 1 – Verified Search Engine Crawlers:**
Major search engine crawlers publish signed IP ranges and unique TLS fingerprints. The system maintains a continuously updated allowlist from these published sources and verifies:
1. Request IP matches published crawler IP range
2. User-agent string matches expected crawler UA
3. TLS fingerprint matches known crawler fingerprint
4. DNS reverse lookup of IP matches crawler hostname pattern

All four checks must pass; any mismatch indicates a bot impersonating a crawler.

**Tier 2 – API Key Bypass:**
Customers can provision API keys for their legitimate automation (testing, monitoring). Requests bearing a valid API key in the `X-Bot-Bypass-Key` header bypass all scoring. Keys are:
- Per-customer, per-environment (separate keys for staging vs production)
- Rate-limited to prevent abuse as a bypass mechanism
- Logged for audit purposes
- Rotatable at any time

**Tier 3 – IP Range Allowlisting:**
Customers can allowlist their own monitoring and testing IP ranges. Requests from these ranges are scored but with a strong negative prior (starting score of 0.1 rather than 0.5).

**Tier 4 – Challenge Success Bypass:**
Users who have recently (within last 24 hours) successfully solved a CAPTCHA are issued a long-lived cookie that reduces their starting score to 0.15, ensuring they are not challenged again in the same browsing session.

### Accessibility Accommodations

Assistive technology users produce behavioral signals that can trigger false positives:
- Screen reader users make no mouse movements at all (zero behavioral data → slight bot lean)
- Switch access users make extremely slow, deliberate clicks (could look like bot timing)
- Voice control users produce unusual text entry patterns (dictation speed vs. typing speed)

Accommodations:
1. **Accessibility-first scoring:** Sessions where behavioral data is entirely absent get a lower default bot lean (0.35 instead of 0.40), acknowledging that no-mouse-movement is consistent with assistive technology use
2. **Accessibility mode cookie:** Websites can set an `Accessibility-Mode: 1` cookie or header that reduces behavioral signal weight to near-zero for that session
3. **CAPTCHA accessibility:** Interactive CAPTCHAs must include audio alternatives and must not rely solely on mouse interaction; keyboard-navigable alternatives are required

### False Positive Feedback Loop

```
False Positive Escalation Path:
    User challenged incorrectly
         │
         ↓
    User clicks "I'm not a robot" / appeal link
         │
         ↓
    Appeal Flow:
    1. Present email verification or SMS OTP
    2. If verified: issue human_verified token, unblock session immediately
    3. Record as confirmed false positive: (session_id, fingerprint_hash, timestamp)
         │
         ↓
    Model Retraining Feedback:
    - Confirmed FP sessions added to "human" label set with weight 0.95
    - Features of FP sessions analyzed: which features led to miscalssification?
    - If FP clusters around specific feature: reduce that feature's weight in next training
         │
         ↓
    Threshold Adjustment:
    - If FP rate exceeds SLO (> 0.1% of human traffic): automatically raise
      challenge threshold by 0.05 until FP rate returns to target
    - Alert fires to operations team with FP rate trend data
```

---

## Bot Operator Arms Race Management

### Threat Intelligence Sharing

The detection system integrates external threat intelligence to gain early warning of new bot tooling and attack campaigns:

**IP Reputation Feeds:** Multiple commercial and open-source feeds provide lists of known-malicious IPs, datacenter IP ranges, Tor exit nodes, VPN exit nodes, and residential proxy pools. Feeds are ingested every 15 minutes and merged via union policy (any feed flagging an IP causes action).

**Bot Signature Database:** Crowdsourced database of known bot identifiers: headless browser UA patterns, CDP API signatures, automation framework fingerprints. New signatures are added by participating vendors and deployed within 15 minutes.

**Dark Web Monitoring:** Continuous monitoring of bot-as-a-service marketplaces for new tools claiming to bypass the detection system. When a new tool is announced, it is purchased and analyzed in a sandbox environment, and detection rules for its specific fingerprint are added before it gains wide adoption.

### Adversarial Model Red Teaming

Quarterly red team exercises use commercial bot-as-a-service platforms to attempt to bypass detection:

```
Red Team Protocol:
1. Purchase current top-5 bot services (residential proxy + headless browser farms)
2. Attempt to:
   a. Browse protected endpoints without triggering challenges
   b. Solve CAPTCHAs at scale using human CAPTCHA farms and vision models
   c. Simulate human behavior to evade behavioral analysis
   d. Clone known-good fingerprints to evade fingerprint detection
3. Measure bypass rate: % of bot sessions that complete a target action
   without being challenged
4. Target bypass rate for high-security endpoints: < 2%
5. Document which signals successfully identified the bots
6. Identify any gaps and add new detection signals before next red team
```

---

## LLM-Era CAPTCHA Defense

### The CAPTCHA Obsolescence Problem

As of 2025–2026, vision-language models (GPT-4o, Claude, Gemini) can solve traditional image-based CAPTCHAs at 80–90% accuracy. This fundamentally changes the challenge system design:

| Challenge Type | Human Solve Rate | Bot Solve Rate (2023) | Bot Solve Rate (2026) | Status |
|---------------|-----------------|----------------------|----------------------|--------|
| Text recognition | >95% | ~70% (OCR) | ~98% (LLM) | **Obsolete** |
| Image selection ("select traffic lights") | >95% | ~40% (CV) | ~85% (VLM) | **Weakened** |
| Semantic reasoning | >90% | ~20% | ~60% (VLM) | **Still viable** |
| 3D rotation / spatial tasks | >88% | ~10% | ~30% | **Effective** |
| Real-time interaction (drag, draw) | >92% | ~5% | ~15% | **Most effective** |
| PoW + behavioral analysis | N/A | ~50% | ~50% | **Unchanged** |

### Next-Generation Challenge Design

```
Post-CAPTCHA challenge strategies:

1. Behavioral Interaction Challenges:
   - "Drag the circle to the star" — simple task, but the HOW matters
   - Measure: mouse acceleration profile, path curvature, overshoot correction
   - LLMs can identify the answer but cannot produce natural drag behavior
   - Solve time + solve trajectory are the signals, not the answer itself

2. Temporal Attention Challenges:
   - "Watch this 3-second animation and answer a question"
   - Requires real-time video processing at bot scale (expensive)
   - The bot must process video AND produce a response within the time window
   - At $0.01/API-call, solving 1000 challenges/sec costs $10/sec = $864K/day

3. Platform Attestation (Zero-Challenge Path):
   - Apple Private Access Tokens: device attests to its legitimacy cryptographically
   - WebAuthn: hardware security key proves physical presence
   - Play Integrity: Android platform vouches for app authenticity
   - No user interaction required; strongest signal available

4. Economic PoW Escalation:
   - If LLMs solve cognitive challenges cheaply, make the cost computational
   - PoW difficulty scaled to make each solve cost > the value of the bot action
   - e.g., bot scraping $0.001-value data pays $0.01 in compute per PoW solve
```

---

## Bot-as-a-Service (BaaS) Threat Landscape

### Known BaaS Categories (2025–2026)

| Category | Capability | Scale | Detection Approach |
|----------|-----------|-------|-------------------|
| **Browser farm** | Real Chromium on real hardware, residential IPs | 100K concurrent sessions | Cross-session behavioral clustering; population-level anomaly |
| **CAPTCHA solving** | Human workers + LLM solving; <5s response time | 10K solves/min | Post-solve behavioral analysis; solve-event trajectory scoring |
| **Residential proxy** | 100M+ residential IPs with clean reputation | Unlimited IP diversity | Behavioral + fingerprint signals (IP becomes unreliable) |
| **Anti-detect browser** | Spoofed canvas, WebGL, AudioContext, TLS fingerprint | Per-session cost ~$0.01 | Hardware timing analysis; cross-session fingerprint clustering |
| **Credential stuffing** | Automated login with stolen credential databases | 1M attempts/hour | Velocity limits; failed-login rate; IP-fingerprint diversity ratio |

---

## Compliance Frameworks Beyond GDPR

### Multi-Jurisdiction Requirements

| Regulation | Region | Key Requirements | Implementation |
|-----------|--------|-----------------|----------------|
| **GDPR** | EU/EEA | Data minimization, consent, right to erasure | Hash-before-store, in-browser aggregation, erasure API |
| **CCPA/CPRA** | California | Right to know, right to delete, opt-out of "sale" | Fingerprint data not "sold"; opt-out UI for collection |
| **LGPD** | Brazil | Similar to GDPR; legitimate interests available | Regional data residency; Portuguese privacy notice |
| **POPIA** | South Africa | Data minimization, consent, cross-border restrictions | Process SA data in-region |
| **ePrivacy Directive** | EU | Cookie consent for non-essential tracking | Session cookies for security are exempt; fingerprinting requires consent |
| **ADA/WCAG 2.2** | US/Global | CAPTCHAs must be accessible | Audio CAPTCHA, keyboard navigation, PoW, accessibility mode |

### Data Processing Records (GDPR Article 30)

| Processing Activity | Purpose | Legal Basis | Retention |
|---------------------|---------|------------|-----------|
| IP address collection | Bot detection, security | Legitimate interest (Art. 6(1)(f)) | 90 days |
| Device fingerprinting | Device re-identification | Legitimate interest | 1 year (hashed) |
| Behavioral telemetry | Bot behavioral analysis | Legitimate interest | 30 days (aggregated) |
| CAPTCHA interaction | Challenge verification | Legitimate interest | 7 days |
| Session state | Security context | Legitimate interest | 30 min TTL |
| Training data | ML model improvement | Legitimate interest | 90 days (anonymized) |

### Automated Decision-Making (GDPR Article 22)

Bot detection makes automated decisions (block/challenge) that affect users:

1. **Challenge path**: Blocked users can solve a CAPTCHA to override the automated decision
2. **Appeal mechanism**: Users can submit an appeal for manual review
3. **Transparency**: Privacy policy describes automated bot detection and the appeal process
4. **Non-discriminatory**: Scoring does not use protected characteristics as features

---

## Supply Chain Security for ML Models

### Model Integrity Verification

ML models deployed to 5,000+ edge nodes are a high-value target for supply chain attacks. A compromised model could silently allow all bot traffic or block all legitimate users:

```
Model Integrity Chain:
  Training Pipeline (GPU cluster)
    ├─ Training completes → model artifact produced
    ├─ Model hash: SHA-256 of serialized model weights
    ├─ Signing: model hash signed with training pipeline's HSM key
    └─ Model artifact + signature stored in Model Registry

  Model Registry
    ├─ Stores versioned model artifacts with cryptographic signatures
    ├─ Access control: only training pipeline can write; only deployment can read
    └─ Audit log: every read/write recorded with timestamp and principal

  Edge Deployment
    ├─ Edge node pulls model from regional CDN cache
    ├─ Verifies signature against training pipeline's public key
    ├─ Verifies SHA-256 hash of downloaded artifact
    ├─ If verification fails: reject model, retain current model, alert
    └─ If verification passes: hot-swap model into inference process
```

### Challenge Script Integrity

The JavaScript challenge script injected into protected pages must not be tampered with in transit:

| Threat | Mitigation |
|--------|-----------|
| **MITM modification** | Script served with Subresource Integrity (SRI) hash; browser rejects modified scripts |
| **CDN cache poisoning** | Script URL includes content hash; any modification produces cache miss |
| **Extension interference** | Script detects presence of known bot-assist browser extensions (auto-form-fillers, anti-CAPTCHA) |
| **DevTools tampering** | Runtime integrity self-check: script hashes its own source and compares against expected hash |
| **Reverse engineering** | Obfuscation layers (variable mangling, control flow flattening, string encryption) raise analysis cost |

---

## Incident Response for Bot Attacks

### Bot Attack Severity Classification

| Severity | Criteria | Response Time | Responders |
|----------|---------|---------------|-----------|
| **P1 (Critical)** | False positive rate >1% OR blocking >5% of legitimate traffic | 15 min | On-call + ML team + management |
| **P2 (High)** | Sustained attack >10x baseline OR detection rate <80% | 1 hour | On-call + ML team |
| **P3 (Medium)** | New bot tool detected bypassing >50% of checks | 4 hours | ML team (business hours) |
| **P4 (Low)** | Single customer reports elevated bot traffic | 1 business day | Support + customer success |

### Incident Response Runbook

```
Step 1: Assess Impact (first 5 minutes)
  ├─ Check FP rate: is legitimate traffic affected?
  ├─ Check detection rate: are bots getting through?
  ├─ Check challenge rate: has it spiked or dropped?
  └─ Identify affected endpoints and customers

Step 2: Immediate Mitigation (5-15 minutes)
  ├─ If FP spike: widen challenge thresholds (+0.1 to challenge score)
  ├─ If detection failure: raise PoW difficulty (+2 bits)
  ├─ If model issue: rollback to last known-good model (< 5 min)
  └─ If targeted attack: enable endpoint-specific rate limiting

Step 3: Root Cause Analysis (15-60 minutes)
  ├─ Identify attack source (ASN, IP ranges, fingerprint clusters)
  ├─ Analyze behavioral signatures of bypassing sessions
  ├─ Check model drift metrics: is model stale or miscalibrated?
  └─ Compare current traffic distribution to 24h baseline

Step 4: Targeted Response (1-4 hours)
  ├─ Add attack-specific detection rules to edge
  ├─ Update threat intelligence with new signatures
  ├─ If novel evasion: schedule emergency model retraining
  └─ Notify affected customers with status update

Step 5: Post-Incident (within 48 hours)
  ├─ Publish post-mortem with timeline and root cause
  ├─ Update detection signatures in bot signature database
  ├─ Retrain model with labeled attack sessions
  └─ Update chaos engineering scenarios based on attack vector
```
