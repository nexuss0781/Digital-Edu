# 14.9 AI-Native MSME Marketing & Social Commerce Platform — Security & Compliance

## Authentication and Authorization

### Identity Architecture

```
MSME Authentication Flow:
  1. Registration: Phone number + OTP (primary for Indian MSMEs)
     OR email + password (secondary)
  2. Session: JWT with 24-hour expiry; refresh token with 30-day expiry
  3. MFA: Optional TOTP for premium accounts; mandatory for ad spend > ₹10,000/month
  4. Device binding: Trusted device registration for mobile app

Role-Based Access Control:
  OWNER:    Full access — content approval, ad budget, billing, team management
  MANAGER:  Content creation and scheduling; limited ad budget (up to daily cap set by owner)
  CREATOR:  Content drafting only; cannot publish or manage ads
  VIEWER:   Analytics dashboard read-only access
```

### Social Platform OAuth Token Management

The platform stores OAuth tokens for 5+ social platforms per MSME, making token management a critical security surface:

**Token Storage:**
- All OAuth tokens encrypted at rest using AES-256 with per-MSME encryption keys
- Encryption keys stored in a managed key service (HSM-backed), separate from the application database
- Token access logged with full audit trail (who accessed which token, when, and for what operation)

**Token Lifecycle:**
```
Token acquisition:
  1. MSME initiates platform connection via OAuth consent flow
  2. Platform redirects to our callback URL with authorization code
  3. Server exchanges code for access token + refresh token
  4. Tokens encrypted and stored; metadata (scope, expiry) stored separately
  5. Immediate test call to verify token validity

Token refresh:
  1. Background job checks token expiry daily
  2. Tokens expiring within 7 days are proactively refreshed
  3. If refresh fails: retry 3 times over 24 hours
  4. If still failing: notify MSME to re-authenticate
  5. Never expose refresh tokens to client applications

Token revocation:
  1. MSME disconnects platform: immediate token revocation via platform API
  2. MSME deletes account: cascade revoke all platform tokens
  3. Security incident: bulk revocation capability for all tokens of affected MSMEs
  4. Platform deauthorization webhook: handle cases where user revokes from platform side
```

**Scope Management:**
```
Minimum required scopes per platform:
  Instagram: instagram_basic, instagram_content_publish, instagram_manage_insights
  Facebook:  pages_manage_posts, pages_read_engagement, ads_management (if ad features used)
  YouTube:   youtube.upload, youtube.readonly
  WhatsApp:  business_messaging, catalog_management

Principle: Request minimum scopes; escalate only when MSME enables specific features
Example: ads_management scope requested only when MSME first creates an ad campaign
```

---

## Data Security

### Data Classification

| Classification | Examples | Storage | Access | Retention |
|---|---|---|---|---|
| **Critical** | OAuth tokens, payment methods, API keys | Encrypted (AES-256), HSM-backed keys | Service accounts only; logged | Until revocation |
| **Sensitive** | Product photos, business descriptions, customer demographic hints | Encrypted at rest | MSME owner + authorized roles | MSME-controlled; default 2 years |
| **Internal** | Content metadata, scheduling data, engagement metrics | Standard encryption | Application services | 2 years active; then archived |
| **Aggregated** | Category-level performance benchmarks, model training data | Anonymized; no PII | Analytics services, ML pipeline | Indefinite |

### Content Isolation

Each MSME's data is logically isolated:

- **Database level**: Row-level security enforced by msme_id on all queries; no cross-MSME query capability in the application layer
- **Storage level**: Media assets stored in MSME-specific prefixed paths in object storage; IAM policies prevent cross-prefix access
- **Cache level**: Cache keys prefixed with msme_id; eviction policies per-MSME
- **ML pipeline**: Individual MSME data never used to generate content for other MSMEs; only anonymized aggregates used for model training

### Data in Transit

- All client-to-server communication over TLS 1.3
- Inter-service communication over mTLS within the service mesh
- Platform API calls over HTTPS (enforced by all major platforms)
- Media uploads: client-side pre-signed URL upload directly to object storage (server never handles raw media in transit)

---

## Threat Model

### Threat 1: OAuth Token Theft

**Attack vector:** Attacker compromises the database or application server and extracts encrypted OAuth tokens. With tokens, attacker can post content, manage ads, or access MSME's social accounts.

**Mitigations:**
1. Token encryption keys stored in HSM, not in the application database
2. Token decryption requires service identity + operation context (no bulk decryption capability)
3. All token usage logged with anomaly detection (unusual posting patterns, sudden scope escalation)
4. Token rotation: access tokens rotated every 30 days proactively
5. Platform-side monitoring: webhook subscription for deauthorization events

### Threat 2: Malicious Content Generation

**Attack vector:** Attacker manipulates input (adversarial product images or descriptions) to generate content containing hate speech, NSFW material, brand-damaging content, or content that violates platform advertising policies.

**Mitigations:**
1. **Input sanitization**: Product descriptions stripped of HTML, script injection, and prompt injection patterns
2. **Output safety gate**: All generated content passes through toxicity classifier, NSFW detector, and cultural sensitivity filter before being shown to MSME for approval
3. **Human-in-the-loop**: MSMEs must approve all content before publishing (no fully autonomous publishing)
4. **Post-publish monitoring**: Content published through the platform is monitored for platform policy violations; automatic takedown if flagged
5. **Adversarial input detection**: Detect known adversarial patterns in uploaded images (steganographic content, adversarial perturbations targeting the generation model)

### Threat 3: Ad Budget Manipulation

**Attack vector:** Attacker gains access to MSME account and drains ad budget through fraudulent campaigns, or exploits the optimization engine to redirect budget to attacker-controlled properties.

**Mitigations:**
1. **Budget caps**: Hard daily and monthly budget limits enforced at the database level (not just application logic)
2. **Velocity checks**: Alert on budget increases >50% from previous day; require re-authentication for budget changes >₹5,000
3. **Campaign allowlisting**: New ad campaigns require MSME approval before spending begins (no auto-approved campaigns)
4. **Spend anomaly detection**: ML model trained on historical spend patterns flags unusual spend velocity (e.g., 80% of daily budget spent in 1 hour)
5. **Separation of concerns**: Budget modification API requires a different auth scope than campaign creation API

### Threat 4: Influencer Data Scraping

**Attack vector:** Competitor platform uses our influencer discovery API to scrape our authenticated influencer database, bypassing our investment in data collection and scoring.

**Mitigations:**
1. **Rate limiting**: Influencer search API rate-limited to 50 queries/hour per MSME
2. **Result limiting**: Maximum 20 results per query; no bulk export capability
3. **Watermarking**: Search results include subtle per-MSME watermarks in the response data (unique ordering, slightly varied scores) enabling leak detection
4. **Access patterns**: Anomaly detection on search patterns (automated scraping shows different query patterns than human usage)
5. **Contractual**: Terms of service prohibit systematic data extraction; API key revocation for violators

### Threat 5: WhatsApp Business API Exploitation

**Attack vector:** Attacker uses MSME accounts on the platform to send spam via WhatsApp Business API, exploiting the platform's API access to reach customers who haven't opted in. This degrades the platform's WhatsApp quality rating and risks API suspension for all MSMEs.

**Mitigations:**
1. **Opt-in verification**: Broadcast recipients must have explicit opt-in records; platform independently verifies opt-in before allowing broadcast
2. **Template pre-screening**: All broadcast templates pass through spam classifier before WhatsApp template approval submission
3. **Velocity controls**: Maximum 3 broadcasts per MSME per week; maximum 500 recipients per broadcast for accounts under 30 days old
4. **Quality rating monitoring**: Per-MSME quality rating tracked; if an MSME's quality rating drops to "Yellow," broadcasts are paused pending review; "Red" results in automatic suspension
5. **Platform-wide quality budget**: Aggregate quality metrics across all MSMEs; if platform-wide block rate exceeds 1%, tighten content screening thresholds for all broadcasts until rate normalizes

### Threat 6: AI-Generated Deepfake or Misleading Content

**Attack vector:** Malicious actor crafts product descriptions or images that cause the AI content generator to produce misleading marketing claims (fake reviews, counterfeit product representations, price manipulation), damaging consumer trust and violating advertising regulations.

**Mitigations:**
1. **Claim detection**: NLP pipeline identifies factual claims in generated captions ("100% organic," "fastest delivery," "lowest price") and flags for MSME verification
2. **Product image verification**: Reverse image search against known counterfeit product databases; flag when uploaded product images match established brand products the MSME is unlikely to sell
3. **Price reasonableness check**: Cross-reference mentioned prices against category averages; flag extreme discounts (>80% off) for verification
4. **Disclaimer auto-insertion**: Automatically append required disclaimers for regulated categories (food health claims, financial products, cosmetics)
5. **Post-generation audit trail**: Store the exact prompt, input images, and generation parameters for every creative, enabling forensic review if content is later found to be misleading

### Threat 7: Platform API Abuse Through Our System

**Attack vector:** Malicious actor creates MSME accounts to abuse social platform APIs through our system (spam posting, automated engagement, policy-violating ads).

**Mitigations:**
1. **Account verification**: Phone number verification + business verification for premium features
2. **Publishing rate limits**: Per-MSME publishing limits aligned with platform best practices (not just API limits)
3. **Content review**: Random sampling of published content for policy compliance
4. **Platform trust score**: Maintain a quality rating with each platform; proactively suspend MSMEs that degrade our platform-wide quality score
5. **Progressive access**: New accounts start with limited publishing capability (3 posts/day); increased based on account age and compliance history

---

## Compliance

### Advertising Standards

| Regulation | Scope | Platform Compliance Approach |
|---|---|---|
| ASCI (Advertising Standards Council of India) | All ads targeting Indian audiences | Content safety gate checks for prohibited claims (miracle cures, misleading discounts); industry-specific disclaimer templates auto-attached |
| Platform-specific ad policies | Each social platform has its own ad policies | Per-platform policy validator runs before campaign submission; common violations pre-checked (housing discrimination, alcohol, health claims) |
| Consumer Protection Act, 2019 | Misleading advertisements | Price comparison claims validated against verifiable data; "best" and "first" claims flagged for MSME verification |
| IT Act, 2000 (India) | Digital content intermediary obligations | Content takedown mechanism; designated grievance officer; compliance reports |

### Data Protection

| Requirement | Implementation |
|---|---|
| Personal Data Protection Act (India) | Explicit consent for data collection; data localization (Indian MSME data stored in Indian region); right to erasure honored within 30 days; data processing agreements with platform API providers |
| Platform-specific data policies | Instagram/Facebook data usage limited to providing service to MSME; no cross-MSME data sharing; compliance with platform data deletion callbacks |
| GDPR (for international MSMEs) | Consent-based data processing; data portability export in standard format; right to be forgotten cascade to all downstream systems |
| Cookie/tracking compliance | Analytics SDK compliant with local tracking regulations; opt-in consent for cross-platform tracking |

### Content Safety Standards

```
Content Safety Pipeline:
  1. Pre-generation: Input sanitization (remove injection patterns, validate image content)
  2. Post-generation: Multi-model safety scoring
     a. Toxicity classifier (hate speech, harassment, threats)
     b. NSFW detector (explicit content, violence)
     c. Cultural sensitivity filter (per-language, per-region)
     d. Brand safety check (no association with controversial topics)
     e. Platform policy pre-check (per-platform prohibited content)
  3. Post-publish: Continuous monitoring via platform webhooks
     a. Platform flags content → auto-pause + notify MSME
     b. User reports → escalate to human review
     c. Policy change → re-scan all active content against new policies

Safety thresholds:
  Toxicity score > 0.3: block and regenerate
  NSFW score > 0.1: block and regenerate
  Cultural sensitivity flag: warn MSME; require explicit approval
  Platform policy pre-check fail: block with specific violation explanation
```

### Intellectual Property

- **Generated content ownership**: Content generated by the platform is owned by the MSME (clearly stated in ToS)
- **Template licensing**: Templates used in generation are licensed for commercial use by MSMEs
- **Stock media**: Background images, icons, and decorative elements sourced from commercially licensed libraries
- **Music licensing**: Short-form video background music from royalty-free libraries with commercial use rights
- **Brand protection**: Generated content must not infringe on third-party trademarks; automated trademark screening for text content

### WhatsApp Business API Compliance

| Requirement | Implementation |
|---|---|
| **Opt-in compliance** | Customers must explicitly opt in to receive business-initiated messages; opt-in source (website form, in-store QR, WhatsApp reply) recorded and auditable; opt-out processed within 24 hours |
| **Template message approval** | All broadcast templates submitted to WhatsApp for approval before use; templates versioned and archived; rejection reasons tracked for pattern analysis |
| **24-hour messaging window** | Customer-initiated conversations allow free-form responses for 24 hours; after 24 hours, only approved template messages allowed; system enforces this constraint at the adapter level |
| **Data handling** | WhatsApp conversation data stored on Indian servers; conversation transcripts available to MSME owner only; platform uses only aggregate conversation metrics for optimization |
| **Quality rating maintenance** | Continuous monitoring of block/report rates; proactive content moderation before broadcast; automatic suspension at "Red" quality rating with guided remediation steps |

### Video Content Compliance

| Requirement | Implementation |
|---|---|
| **Music licensing** | Background music sourced exclusively from royalty-free libraries with commercial use rights; track usage logged per creative for audit; no user-uploaded music without license verification |
| **Platform content policies** | Generated videos checked against platform-specific rules (Instagram: no graphic violence; YouTube: age-appropriate content); text overlay percentage validated (Instagram flags >20% text in video thumbnails) |
| **Accessibility** | Auto-generated captions for all videos (required by some platform policies); caption accuracy verified by language-specific model; alt text generated for thumbnail images |
| **Deepfake prevention** | No face generation or face swapping in marketing videos; product-only video synthesis with clear "AI-generated" metadata tag where required by regulation |

---

## Incident Response

### Security Incident Classification

| Severity | Definition | Response Time | Example |
|---|---|---|---|
| **SEV-1** | Platform-wide data breach; mass token compromise; WhatsApp API suspension | < 15 min | Attacker exfiltrates OAuth tokens for >100 MSMEs |
| **SEV-2** | Single-MSME account compromise; ad budget drain; content safety bypass | < 1 hour | MSME account used to publish offensive content |
| **SEV-3** | Elevated fraud signals; quality rating degradation; API quota abuse | < 4 hours | WhatsApp quality rating drops to "Yellow" for cluster of MSMEs |
| **SEV-4** | Policy violation notification from platform; minor compliance issue | < 24 hours | Instagram flags a generated ad for missing disclaimer |

### SEV-1 Response Procedure

```
STEP 1: Containment (< 5 minutes)
  - Pause all outbound publishing and broadcast operations
  - Rotate API credentials for affected platform integrations
  - Enable emergency read-only mode for affected MSME accounts

STEP 2: Assessment (< 15 minutes)
  - Determine scope: how many MSMEs affected?
  - Identify attack vector: API exploit, credential theft, insider?
  - Check if attacker has active sessions or pending scheduled actions

STEP 3: Remediation (< 1 hour)
  - Revoke compromised tokens and force re-authentication
  - Review and rollback any unauthorized content published during window
  - Notify affected MSMEs with plain-language explanation and remediation steps

STEP 4: Recovery (< 4 hours)
  - Re-enable publishing with enhanced monitoring
  - Verify all MSME accounts have valid, uncompromised tokens
  - Confirm no residual attacker access (check for persistent sessions, backdoor API keys)

STEP 5: Post-Incident (< 48 hours)
  - Root cause analysis document
  - Platform trust score verification with each social platform
  - Security improvement actions tracked to completion
```

---

## Audit and Compliance Reporting

### Audit Log Schema

```
AuditEvent {
    event_id: uuid
    timestamp: datetime
    msme_id: uuid
    actor: { type: "user" | "system" | "platform_webhook", id: string }
    action: string    // "content.published", "ad.budget_changed", "token.refreshed"
    resource: { type: string, id: string }
    details: {
        before: jsonb,    // previous state (for mutations)
        after: jsonb,     // new state
        platform: string, // affected social platform
        ip_address: string,
        user_agent: string
    }
    compliance_tags: string[]  // ["pii_access", "financial", "content_publish"]
}
```

### Compliance Dashboards

- **Token health**: OAuth token validity status across all MSMEs and platforms; expiring tokens; revoked tokens
- **Content safety**: Daily content safety gate statistics (pass/fail rates, common violation types)
- **Ad compliance**: Campaign rejection rates by platform; common policy violations; MSME compliance scores
- **Data access**: PII access frequency; unauthorized access attempts; data deletion requests
- **Platform trust**: Our application's trust score with each platform; rate limit utilization; policy violation trends
- **WhatsApp quality**: Per-MSME quality rating distribution; block rate trends; template approval/rejection rates
- **Video compliance**: Music license utilization; accessibility compliance (caption generation); deepfake detection results

### Data Retention and Deletion

| Data Type | Active Retention | Archive Retention | Deletion Trigger |
|---|---|---|---|
| MSME profile and brand kit | While account active | 30 days post-deletion request | MSME deletion request or 1 year inactivity |
| Generated creatives (media files) | 90 days hot; 1 year warm | 2 years cold archive | MSME deletion cascade; storage tiering policy |
| Published post metadata | 2 years | 5 years (compliance) | Data retention policy; regulatory hold |
| Ad campaign data and spend records | 2 years | 7 years (financial audit) | Regulatory retention requirement |
| WhatsApp conversation transcripts | 90 days | 1 year (compliance) | Customer data deletion request; retention policy |
| Influencer profile data (public) | Until next refresh cycle | None (derived from public data) | Profile deletion from source platform |
| OAuth tokens | Until revocation or expiry | None (security hygiene) | Token rotation; account disconnection |
| Audit logs | 1 year | 7 years | Regulatory retention; never deleted early |

### Cross-Border Data Considerations

For MSMEs serving international customers or operating near border regions:

- **Data localization**: Indian MSME data stored exclusively in Indian data centers per DPDP Act requirements
- **Cross-border transfers**: If platform serves MSMEs in multiple countries, data residency enforced per-country; no cross-border data mixing
- **Platform API data flows**: Social platform API responses may transit through international servers; platform caches processed results domestically only
- **Encryption in transit**: All data crossing network boundaries encrypted; no plaintext data in cross-zone replication

### AI Model Security

| Risk | Mitigation |
|---|---|
| **Prompt injection via product descriptions** | Input sanitization strips injection patterns; description length limited to 500 chars; adversarial input detector trained on known injection patterns |
| **Model extraction via API probing** | Rate limiting on content generation API; response watermarking; no raw model outputs exposed (only rendered creatives) |
| **Training data poisoning** | Community corrections reviewed before inclusion in training pipeline; minimum contribution history required; automated anomaly detection on correction patterns |
| **Adversarial product images** | Image classifier detects known adversarial perturbation patterns; out-of-distribution detection flags unusual image characteristics |
| **Generated content hallucination** | Fact-checking pipeline for price claims, availability claims, and comparative statements; cross-reference against MSME's catalog data |
