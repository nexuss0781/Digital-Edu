# Security & Compliance — Polling/Voting System

## 1. Threat Model

### Threat Actors

| Actor | Motivation | Capability | Target |
|---|---|---|---|
| **Casual cheater** | Win a poll for fun | Browser dev tools, multiple accounts | Vote count manipulation |
| **Bot operator** | Influence poll outcomes at scale | Bot networks, CAPTCHA solvers, residential proxies | Mass ballot stuffing |
| **Competitor** | Discredit the platform | Sophisticated automation, API abuse | Platform integrity, trust |
| **Hacktivist** | Disrupt high-profile polls | DDoS tools, social media coordination | Availability, result integrity |
| **Insider** | Financial or political gain | Database access, admin credentials | Vote records, result tampering |
| **Nation-state** | Influence public opinion polls | Advanced persistent threats, zero-days | Vote integrity, data exfiltration |

### Attack Surface Map

| Surface | Attack Vectors | Severity |
|---|---|---|
| **Vote API** | Ballot stuffing, replay attacks, rate limit bypass, parameter tampering | Critical |
| **Authentication** | Account farming, credential stuffing, session hijacking | High |
| **Client** | Request forgery, fingerprint spoofing, automated voting scripts | High |
| **Dedup store** | Timing attacks to infer voting behavior, cache poisoning | Medium |
| **Admin interface** | Privilege escalation, unauthorized result modification | Critical |
| **Network** | DDoS, man-in-the-middle, DNS hijacking | High |

---

## 2. Vote Integrity

### Defense Against Double-Voting

| Layer | Mechanism | Coverage | Bypass Difficulty |
|---|---|---|---|
| **Application-level dedup** | User ID + Poll ID unique check in distributed set | All authenticated votes | Requires new account |
| **Database constraint** | UNIQUE index on (poll_id, user_id) in vote audit log | Safety net for all votes | Cannot bypass (DB enforced) |
| **Idempotency key** | Client-generated UUID prevents accidental double-submission | Network retries | Requires new key (intentional only) |
| **Rate limiting** | 1 vote per user per poll per 5 seconds | Prevents rapid fire attempts | Requires waiting |

### Defense Against Ballot Stuffing (Multiple Accounts)

| Defense | Mechanism | Effectiveness |
|---|---|---|
| **Phone verification** | Require phone number for poll voting; each number votes once | High (phone numbers are expensive to farm) |
| **Email verification** | Verified email required; rate-limit new account creation | Medium (disposable emails exist) |
| **Account age requirement** | Only accounts older than N days can vote on specific polls | High (prevents rush account creation) |
| **IP rate limiting** | Max N votes from same IP per poll (configurable, default 5) | Medium (VPNs and proxies bypass) |
| **Device fingerprinting** | Track canvas hash, WebGL renderer, timezone, screen resolution | Medium (fingerprint spoofing possible) |
| **Behavioral analysis** | Detect automated voting patterns (uniform timing, no mouse movement) | High (hard to replicate human behavior) |
| **CAPTCHA challenges** | Require CAPTCHA after N votes from same network | Medium-High (CAPTCHA farms exist but are costly) |

### Vote Integrity Verification

```
FUNCTION verify_vote_integrity(poll_id):
    // Cross-check three independent data sources
    dedup_count = DEDUP_STORE.SCARD(FORMAT("voted:%s", poll_id))
    shard_total = aggregate_all_shards(poll_id).total_votes
    audit_count = COUNT(*) FROM votes WHERE poll_id = poll_id

    // All three should match (within tolerance for in-flight votes)
    IF poll.status == 'closed':
        // After close, all three must be exact
        ASSERT dedup_count == shard_total == audit_count
    ELSE:
        // During active poll, allow small discrepancy (in-flight votes)
        tolerance = MAX(10, shard_total * 0.001)  // 0.1% or 10 votes
        ASSERT ABS(dedup_count - shard_total) < tolerance
        ASSERT ABS(dedup_count - audit_count) < tolerance

    RETURN {
        dedup_count: dedup_count,
        shard_total: shard_total,
        audit_count: audit_count,
        integrity: "PASS" or "FAIL"
    }
```

---

## 3. Authentication & Authorization

### Authentication Tiers

| Tier | Method | Can Create Polls | Can Vote | Vote Weight |
|---|---|---|---|---|
| **Anonymous** | Session cookie + device fingerprint | No | On open polls only | 1× (best-effort dedup) |
| **Basic** | Email + password or social login | Yes (limited) | Yes | 1× |
| **Verified** | Email + phone verification | Yes | Yes | 1× (trusted) |
| **Premium** | Verified + paid subscription | Yes (unlimited) | Yes | Configurable |
| **Organizational** | SSO / SAML / OIDC via employer | Yes (within org) | Yes (within org) | Configurable |

### Authorization Model

| Action | Allowed By | Conditions |
|---|---|---|
| Create poll | Authenticated user (Basic+) | Rate limited: 10 polls/day (Basic), 100/day (Premium) |
| Cast vote | Depends on poll settings | Must meet voter_eligibility setting |
| View results | Any user (if show_results = true) | Some polls hide results until close |
| Close poll | Poll creator OR admin | Only active/paused polls |
| Delete poll | Poll creator OR admin | Soft delete; audit trail preserved |
| View analytics | Poll creator | Detailed breakdown of their own polls |
| Modify vote | Voter who cast original vote | Only if allow_vote_change = true |
| Admin actions | Admin role | Requires MFA + audit logging |

---

## 4. Bot Detection & Prevention

### Multi-Signal Bot Detection

```
FUNCTION assess_vote_legitimacy(request, user):
    score = 100  // Start with full legitimacy score

    // Signal 1: Account age
    IF user.account_age < 1_HOUR:
        score = score - 30
    ELSE IF user.account_age < 1_DAY:
        score = score - 15

    // Signal 2: Voting pattern
    recent_votes = GET user's votes in last 1 hour
    IF LENGTH(recent_votes) > 20:
        score = score - 25  // Voting on too many polls rapidly

    // Signal 3: Request characteristics
    IF request.has_valid_referer == FALSE:
        score = score - 10
    IF request.user_agent IN known_bot_signatures:
        score = score - 40

    // Signal 4: Client-side signals
    IF request.mouse_movement_entropy < THRESHOLD:
        score = score - 20  // No mouse movement = likely automated
    IF request.time_on_page < 2_SECONDS:
        score = score - 15  // Too fast to have read the poll

    // Signal 5: Network signals
    IF request.ip IN known_datacenter_ranges:
        score = score - 25
    IF request.ip IN known_vpn_ranges:
        score = score - 10

    // Signal 6: Behavioral consistency
    IF user.historical_vote_pattern IS anomalous:
        score = score - 20

    // Decision
    IF score >= 70:
        RETURN ACCEPT
    ELSE IF score >= 40:
        RETURN CHALLENGE_CAPTCHA
    ELSE:
        RETURN REJECT
```

### Coordinated Attack Detection

| Pattern | Detection Method | Response |
|---|---|---|
| **Vote spike from single IP range** | IP clustering analysis on votes/minute | Block IP range; flag votes for review |
| **Uniform timing between votes** | Statistical analysis of inter-vote intervals | CAPTCHA challenge for affected accounts |
| **New account surge before poll** | Track new account registrations correlated with poll creation | Age requirement for voting on that poll |
| **Social media coordination** | Detect shared referrer URLs or identical vote timing | Alert; manual review of affected poll |
| **CAPTCHA farm activity** | High CAPTCHA solve rate from geographic cluster | Increase CAPTCHA difficulty; switch to proof-of-work |

---

## 5. DDoS Protection

### Layer-by-Layer Defense

| Layer | Protection | Mechanism |
|---|---|---|
| **Network (L3/L4)** | Volumetric attack mitigation | Anycast routing, traffic scrubbing, BGP blackholing |
| **Transport (L4)** | SYN flood protection | SYN cookies, connection rate limiting |
| **Application (L7)** | HTTP flood protection | Rate limiting, WAF rules, behavioral fingerprinting |
| **API** | Endpoint-specific rate limiting | Token bucket per user, per IP, per poll |
| **Business logic** | Vote velocity limiting | Cap max votes/sec per poll; queue excess |

### Rate Limiting Configuration

| Scope | Limit | Window | Action on Exceed |
|---|---|---|---|
| Per user, per poll | 1 vote | Per poll lifetime | 409 Conflict |
| Per user, global | 60 votes | 1 minute | 429 + 30s cooldown |
| Per IP, per poll | 10 votes | 1 minute | 429 + CAPTCHA required |
| Per IP, global | 120 votes | 1 minute | 429 + 60s block |
| Per poll, global | Adaptive | Rolling 10s window | Queue excess; degrade result freshness |
| Platform-wide | 500,000 votes/sec | Rolling 1s window | Activate backpressure; reject lowest-priority traffic |

---

## 6. Audit Trail & Forensics

### What's Logged

| Event | Data Captured | Retention |
|---|---|---|
| **Vote cast** | user_id (hashed), poll_id, option_id, timestamp, IP hash, fingerprint hash, idempotency key | 1 year |
| **Vote changed** | Previous + new option, change timestamp | 1 year |
| **Duplicate rejected** | user_id, poll_id, rejection reason, timestamp | 90 days |
| **Bot detected** | All signals, score, decision (accept/challenge/reject) | 90 days |
| **Poll created/modified** | Creator, all settings, modification history | 3 years |
| **Poll closed** | Final results, reconciliation report, integrity check | 3 years |
| **Admin action** | Admin user, action, target, justification | 5 years (immutable) |

### Tamper-Evident Audit Log

```
FUNCTION append_audit_entry(entry):
    // Hash chain: each entry includes hash of previous entry
    previous_hash = GET latest_hash FROM audit_chain WHERE poll_id = entry.poll_id
    entry.previous_hash = previous_hash
    entry.entry_hash = HASH(entry.data + entry.previous_hash + entry.timestamp)

    INSERT INTO audit_log VALUES entry

    // Periodically anchor chain hash to external timestamping service
    IF entry_count % 1000 == 0:
        anchor_hash = HASH(entry.entry_hash + external_timestamp)
        PUBLISH anchor_hash TO external_timestamping_service
```

---

## 7. Privacy

### Anonymous vs Identified Voting

| Aspect | Anonymous Poll | Identified Poll |
|---|---|---|
| **Voter identity** | Not stored; only session/fingerprint hash | user_id stored with vote |
| **Vote auditability** | Limited; can verify total but not individual votes | Full; voter can verify their own vote |
| **Result visibility** | Creator sees aggregates only | Creator sees who voted for what (optional) |
| **Deduplication** | Best-effort (session + fingerprint) | Exact (user_id) |
| **GDPR compliance** | Easier (minimal PII) | Requires consent; must support deletion |

### Data Minimization

| Data Point | Stored As | Purpose | Can Be Deleted |
|---|---|---|---|
| **Voter identity** | Hashed user_id | Deduplication | Yes (after poll close + retention) |
| **IP address** | One-way hash | Fraud detection | Yes (after 90 days) |
| **Device fingerprint** | One-way hash | Bot detection | Yes (after 90 days) |
| **Vote choice** | Encrypted option_id (for anonymous polls) | Result integrity | No (needed for verification) |
| **Timestamp** | UTC timestamp | Analytics, audit | No (needed for audit) |

### GDPR / Privacy Compliance

| Requirement | Implementation |
|---|---|
| **Right to access** | User can query all their votes and poll data |
| **Right to deletion** | Delete user's PII from vote records; keep anonymized vote counts |
| **Data portability** | Export user's polls and vote history as structured data |
| **Consent** | Explicit consent for data processing at account creation; per-poll consent for identified voting |
| **Data retention** | Automated deletion of PII after retention period; vote counts preserved anonymously |
| **Breach notification** | Automated breach detection; 72-hour notification pipeline |

---

## 8. Secure Vote Transmission

| Measure | Implementation |
|---|---|
| **Transport encryption** | TLS 1.3 for all API traffic; certificate pinning for mobile apps |
| **Request signing** | HMAC signature on vote payload prevents tampering in transit |
| **Replay prevention** | Idempotency key + timestamp window (reject votes older than 5 minutes) |
| **Client attestation** | For high-stakes polls, require client-side proof of execution environment integrity |
| **API key rotation** | Embedded widget API keys rotate monthly; immediate rotation on suspected compromise |

---

## 9. Cryptographic Commitment for High-Integrity Anonymous Polls

For polls requiring both anonymity and verifiability, a cryptographic commitment scheme allows voters to prove their vote was counted without revealing their identity.

### Commitment Protocol

```
FUNCTION commit_anonymous_vote(voter_secret, option_id, poll_id):
    // Phase 1: Voter generates commitment
    nonce = RANDOM_BYTES(32)
    commitment = HASH(voter_secret + option_id + nonce + poll_id)

    // Phase 2: Voter submits commitment (vote is hidden)
    STORE commitment IN commitment_log

    // Phase 3: After poll closes, voter reveals (option_id, nonce)
    // System verifies: HASH(voter_secret + revealed_option + nonce + poll_id) == commitment
    // This proves the vote wasn't changed after submission

    RETURN { commitment: commitment, nonce: nonce }
```

**Use cases:** Corporate board votes, shareholder resolutions, or any poll where voters need to verify their vote was correctly recorded without trusting the platform operator.

**Limitations:** Adds complexity; requires voter to retain their nonce; reveal phase delays final results.

---

## 10. Embedded Widget Security

Third-party websites embed polls via JavaScript widgets. This creates unique security challenges:

| Threat | Attack Vector | Mitigation |
|---|---|---|
| **Clickjacking** | Invisible iframe overlaying poll widget | `X-Frame-Options: ALLOW-FROM` whitelist; frame-busting JavaScript |
| **Cross-origin data leakage** | Malicious host page reading poll results or voter data | Widget runs in sandboxed iframe; `postMessage` for controlled communication only |
| **API key theft** | Host page JavaScript reads widget's API key | Domain-locked API keys; server-side referrer validation; short-lived tokens |
| **Vote injection** | Host page scripts forge vote requests | CSRF tokens per widget session; server-side origin validation |
| **Widget impersonation** | Fake widget mimics real poll UI | Widget integrity hash verification; subresource integrity (SRI) tags |

### Widget API Key Model

| Key Property | Value | Rationale |
|---|---|---|
| **Scope** | Single domain (e.g., `news.example.com`) | Prevents key reuse across unauthorized domains |
| **Rate limit** | 1,000 votes/minute per key | Caps total votes from any single embed |
| **Rotation** | Monthly auto-rotation; immediate on compromise | Limits exposure window |
| **Verification** | Server checks `Referer` + `Origin` headers match key's domain | Prevents key theft from network inspection |

---

## 11. Incident Response

| Severity | Definition | Response Time | Actions |
|---|---|---|---|
| **P1 — Vote integrity breach** | Double-votes detected; vote counts don't match dedup | < 15 min | Pause affected poll; investigate root cause; rebuild from audit log; notify poll creator |
| **P2 — Active bot attack** | Bot detection rate > 50% on a poll; coordinated ballot stuffing | < 30 min | Enable CAPTCHA; block suspicious IP ranges; increase account age requirement |
| **P3 — Data exposure** | Voter identity leaked; PII in logs | < 1 hour | Rotate affected tokens; purge leaked data; activate breach notification pipeline |
| **P4 — Service degradation** | Result freshness > 10s; vote latency > 200ms | < 2 hours | Scale infrastructure; activate load shedding; communicate via status page |

### Post-Incident Actions

| Step | Action | Owner |
|---|---|---|
| **1** | Stabilize: stop the bleeding (pause poll, block IPs, scale up) | On-call engineer |
| **2** | Root cause analysis within 24 hours | Incident commander |
| **3** | Remediation: fix the underlying vulnerability | Engineering team |
| **4** | Communication: notify affected poll creators | Customer support |
| **5** | Post-mortem: document findings, action items, prevention plan | Engineering leadership |

---

## 12. Security Checklist

| # | Check | Category | Frequency |
|---|---|---|---|
| 1 | All vote API endpoints require authentication or session token | AuthN | Every release |
| 2 | Rate limits enforced at API gateway level per user, IP, and poll | DDoS | Every release |
| 3 | Dedup store accessible only from ingestion tier (network segmentation) | Network | Quarterly |
| 4 | Admin actions require MFA and produce audit log entries | Access Control | Every release |
| 5 | No raw PII (user_id, IP, email) in application logs | Privacy | Monthly scan |
| 6 | Idempotency keys validated for format and uniqueness | Integrity | Every release |
| 7 | TLS 1.3 enforced on all external endpoints | Transport | Quarterly |
| 8 | Vote audit log is append-only with hash chaining verified | Integrity | Weekly |
| 9 | CAPTCHA integration tested with automated solve detection | Bot Prevention | Quarterly |
| 10 | Widget API keys domain-locked and auto-rotated | Embed Security | Monthly |
| 11 | Cross-region dedup sync lag monitored and alerted | Consistency | Continuous |
| 12 | Reconciliation runs on every poll close with zero-tolerance mismatch | Integrity | Continuous |
| 13 | Behavioral analysis model retrained on latest bot patterns | Bot Prevention | Monthly |
| 14 | Data retention policies enforced via automated purge jobs | Compliance | Weekly |
| 15 | Penetration test against vote manipulation scenarios | Integrity | Semi-annually |

---

## 13. Compliance Matrix

| Regulation | Requirement | Implementation | Verification |
|---|---|---|---|
| **GDPR (EU)** | Right to deletion; data minimization; consent | Crypto-shredding voter PII; minimal data collection; consent at vote time | Quarterly audit of data retention policies |
| **CCPA (California)** | Right to know; right to delete; opt-out of sale | Data export API; deletion pipeline; no vote data sold | Annual compliance review |
| **SOC 2 Type II** | Security controls; availability; processing integrity | Access controls; monitoring; audit trails; change management | Annual third-party audit |
| **WCAG 2.1 AA** | Accessible voting interface for disabled users | ARIA labels; keyboard navigation; screen reader support; color contrast | Automated + manual accessibility testing |
| **Children's privacy (COPPA)** | Parental consent for under-13 users | Age gate; no data collection from minors without consent | Policy review; age verification mechanisms |
