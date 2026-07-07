# 12.18 Marketplace Platform — Security & Compliance

## Payment Security: PCI-DSS

The marketplace handles card payments at scale, making PCI-DSS compliance a structural design requirement, not an afterthought.

### Cardholder Data Isolation

The fundamental PCI-DSS strategy is to minimize cardholder data (CHD) scope—ideally, raw card numbers never touch the marketplace's servers:

```
Tokenization flow:
  1. Buyer enters card details in checkout UI
  2. JavaScript SDK from the payment processor transmits card data
     DIRECTLY to the processor's servers (never to marketplace servers)
  3. Processor returns a token (e.g., "tok_abc123") to the marketplace
  4. Marketplace stores the token, not the card number
  5. Subsequent charges use the token; only the processor knows the
     actual card number

Scope reduction:
  Without tokenization: marketplace servers, databases, and network
     are ALL in PCI scope
  With tokenization: only the checkout page UI rendering is in scope
     (SAQ-A or SAQ-A-EP, not full SAQ-D)
```

### PCI Control Implementation

| PCI Requirement | Implementation |
|---|---|
| Encrypted transmission | TLS 1.3 for all payment data in transit; HSTS enforced |
| Access control | Role-based access; engineers cannot access payment token database without approval workflow |
| Audit logging | All access to payment records logged and retained 12 months |
| Vulnerability management | Quarterly penetration testing of payment flows; continuous DAST scanning |
| Network segmentation | Payment processing services in isolated network segment; no direct internet exposure |
| Key management | Encryption keys managed in hardware security module (HSM); key rotation every 12 months |

---

## Seller Identity Verification: KYC/KYB

### Tiered Verification Model

Not all sellers require the same level of verification. Applying full KYC to a casual seller listing a few used items creates unnecessary friction. The platform uses a risk-based tiered model:

| Tier | Trigger | Verification Required | Rationale |
|---|---|---|---|
| **Tier 1 — Casual** | < $500/year GMV | Email + phone number | Minimal friction for small sellers |
| **Tier 2 — Active** | $500–$20,000/year GMV | Government ID scan + selfie match | Regulatory threshold in most jurisdictions; payout velocity check |
| **Tier 3 — Business** | > $20,000/year GMV | Business registration + beneficial owner (KYB) + tax ID | IRS 1099-K reporting threshold; marketplace facilitator obligations |
| **Tier 4 — High Risk** | Certain categories (electronics, luxury goods, pharmaceuticals) | Enhanced due diligence; category permit verification | Counterfeit and safety risk |

**KYC provider integration:** Identity verification is outsourced to a regulated KYC provider (document scanning, liveness detection, sanctions screening). The marketplace stores verification status and expiry, not raw identity documents.

### AML Transaction Monitoring

Large-volume sellers processing high GMV trigger AML (anti-money laundering) monitoring:

- **Structuring detection:** Flagging patterns where a seller splits transactions to stay below reporting thresholds
- **Velocity anomalies:** A seller's monthly GMV suddenly increasing 10× without corresponding listing or review growth
- **Geographic anomalies:** Seller's registered location inconsistent with shipping origin or payout destination
- **Sanctions screening:** Seller name and business entities screened against OFAC SDN list at onboarding and on periodic refresh

---

## Buyer Data Protection: GDPR and CCPA

### Data Minimization

The marketplace collects only the data required for the transaction:

- **Payment data:** Tokenized; raw card data never stored
- **Address data:** Stored for order fulfillment; deleted or anonymized 180 days after last order
- **Browse data:** Search and view history used for personalization; retention limited to 12 months; anonymized for analytics after 90 days
- **Communication data:** Buyer-seller messages retained for 2 years (dispute resolution requirement); access restricted to trust & safety team

### Right-to-Deletion Workflow

When a buyer requests data deletion under GDPR/CCPA:

```
Deletion request received:
  1. Immediate: anonymize buyer profile (replace name/email with hashed pseudonym)
  2. Within 30 days: delete browse history, search history, personalization data
  3. EXCEPTION: Order records retained for 7 years (tax/financial regulation)
  4. EXCEPTION: Dispute records retained for 3 years after resolution (legal claim window)
  5. EXCEPTION: Fraud signals retained in anonymized form for model training
  6. Confirmation sent to buyer with deletion certificate
```

**Cascading deletion complexity:** If a buyer deletes their account, their reviews of sellers must also be handled carefully. Reviews are public-facing content tied to seller quality scores. Policy options:
- Anonymize review author (show "verified buyer") but retain review content and score
- Delete review entirely (degrades seller quality score accuracy)

Production choice: anonymize author, retain content; inform user at deletion time.

---

## Marketplace Facilitator Tax Compliance

Marketplace facilitator laws in 45+ US states and EU VAT rules make the platform responsible for collecting and remitting sales tax on behalf of sellers—even if the seller is unaware of their state's nexus requirements.

### Tax Architecture

```
Tax calculation:
  At checkout:
    1. Determine buyer's shipping address (jurisdiction)
    2. Determine seller's nexus states (registered + economic nexus based on GMV)
    3. Query tax engine API (external provider) with:
         - item category (taxability varies by product type)
         - buyer zip code
         - seller nexus states
    4. Tax engine returns: applicable rate, tax amount, jurisdiction codes
    5. Tax amount added to buyer's total
    6. Tax funds flow into dedicated tax remittance account

Tax remittance:
  Monthly batch job:
    - Aggregate tax collected by state/jurisdiction
    - Generate filing summary
    - Initiate transfers to tax authority accounts (ACH or wire per state requirement)
    - Store filing record for audit trail

1099-K reporting (US):
  - For sellers above IRS reporting threshold ($600/year as of 2025 reporting)
  - Generate 1099-K form with platform EIN, seller SSN/EIN, gross payments
  - File electronically with IRS by January 31; deliver to seller by January 31
```

---

## Fraud and Abuse Prevention

### Defense-in-Depth Layers

| Layer | Mechanism | Latency Impact |
|---|---|---|
| **Network** | Rate limiting by IP/device fingerprint; DDoS protection at edge | None (pre-application) |
| **Authentication** | Credential stuffing detection; CAPTCHA on suspicious login; MFA for high-value actions | < 100ms |
| **Request** | Velocity checks; bot detection (headless browser signals, mouse movement entropy) | < 50ms |
| **Business logic** | Transaction fraud scoring (real-time ML model) before payment authorization | < 200ms inline |
| **Async** | Review fraud graph analysis; listing fraud deep scan; behavioral pattern analysis | Minutes (background) |
| **Manual** | Trust analyst review queue for flagged accounts and listings | Hours (human) |

### Fraud Model Architecture

Real-time transaction fraud scoring runs inline in the checkout path:

```
Input features (assembled at checkout):
  - Buyer account age, prior order count, prior dispute rate
  - Device fingerprint (new vs. known device)
  - Billing-shipping address distance
  - Order value vs. buyer's historical AOV (anomaly score)
  - Card velocity (orders on this card in last 1 hour / 24 hours)
  - IP geolocation vs. billing address (mismatch score)
  - Time-of-day (fraud peaks at unusual hours)
  - Item category risk score (electronics and gift cards are high risk)

Output:
  - Fraud probability score (0.0–1.0)
  - Risk tier: LOW / MEDIUM / HIGH / BLOCKED

Routing:
  LOW (< 0.3):    Proceed to checkout normally
  MEDIUM (0.3–0.7): 3D Secure authentication challenge required
  HIGH (0.7–0.9):  Manual review required before order completes
  BLOCKED (> 0.9): Order rejected; buyer sees generic payment failure message
```

---

## Security Incident Response

### Account Takeover Response Playbook

When ATO is detected (impossible travel, device fingerprint change, banking detail modification):

1. **Immediate:** Suspend active session; force re-authentication
2. **Immediate:** Freeze all pending payouts to unverified bank accounts
3. **Within 5 minutes:** Notify seller via all registered contact methods (email + SMS + push)
4. **Within 1 hour:** Trust analyst reviews account for scope of compromise
5. **Recovery:** Verified identity re-verification required before reinstating banking details; 72-hour hold on resumed payouts

### Seller Data Breach (Inventory/Pricing Scraping)

Bulk scraping of listing data (for competitive intelligence) is a lower-severity but common attack:

- **Detection:** Unusual request patterns (many listings/second from single IP or fingerprint)
- **Response:** Progressive rate limiting → CAPTCHA challenge → block
- **Legitimate scraping:** Public API with rate limits and terms of service for research and price comparison use cases

---

## GDPR Deep Dive: Cross-System Data Subject Rights

### Data Mapping for Marketplace

| Data Category | Systems Holding Data | Retention | GDPR Basis |
|---|---|---|---|
| Buyer profile (name, email) | User Service DB | Until deletion request | Contract performance |
| Buyer payment tokens | Payment Service (tokenized) | Until deletion + 7-year financial records | Legal obligation |
| Buyer search/browse history | Analytics pipeline, personalization cache | 12 months (anonymized after 90 days) | Legitimate interest |
| Buyer-seller messages | Messaging Service DB | 2 years | Contract + legitimate interest (dispute resolution) |
| Order records | Order Service DB | 7 years (financial regulation) | Legal obligation |
| Buyer shipping address | Order Service DB | 180 days after last order | Contract performance |
| Buyer reviews | Review Service DB | Until account deletion (anonymized, not deleted) | Legitimate interest |
| Device fingerprints | Fraud detection pipeline | 24 months | Legitimate interest (fraud prevention) |
| Buyer photos (dispute evidence) | Object Storage | 3 years after dispute resolution | Legal obligation |

### Right to Portability Implementation

```
Data export request flow:
  1. Buyer requests data export via Settings → Privacy → Export My Data
  2. System queues async export job (not real-time; may take up to 48 hours)
  3. Export job queries all systems holding buyer data:
     - User Service: profile, preferences
     - Order Service: order history (excluding seller PII)
     - Review Service: reviews authored
     - Messaging Service: messages sent (excluding counterparty PII)
     - Search Service: saved searches, wishlist
  4. Data compiled into machine-readable format (JSON + CSV)
  5. Encrypted download link emailed to verified email address
  6. Download link expires after 7 days
  7. Export event logged for GDPR audit trail
```

---

## PSD2 Strong Customer Authentication (EU)

For EU buyers, PSD2 mandates Strong Customer Authentication (SCA) for electronic payments:

| Scenario | SCA Required? | Implementation |
|---|---|---|
| Standard card payment | Yes | 3D Secure 2.0 challenge during checkout |
| Saved card (recurring) | Exemption available | Merchant-initiated transaction exemption |
| Low-value (< €30) | Exemption available | TRA exemption if fraud rate < 0.13% |
| Trusted beneficiary | Exemption available | Buyer whitelists the marketplace |
| Seller-initiated charge | No (not buyer-initiated) | Marketplace debit from seller balance |

**Implementation:** The checkout flow detects buyer's jurisdiction. EU buyers are routed through the 3DS2 flow, which may add 5–15 seconds to checkout (redirect to bank's authentication page). Non-EU buyers skip SCA.

---

## Security Lifecycle for Marketplace Components

### Secure Development Practices

| Practice | Scope | Frequency |
|---|---|---|
| Threat modeling | New features, API changes | Before design review |
| SAST (static analysis) | All code changes | Every pull request |
| DAST (dynamic scanning) | Payment and auth flows | Weekly |
| Dependency scanning | All service dependencies | Daily (automated) |
| Penetration testing | Payment service, auth, API | Quarterly (external firm) |
| Red team exercise | Full platform (focus: ATO, payment fraud) | Annually |
| Bug bounty program | All buyer/seller-facing surfaces | Continuous |

### API Security Controls

| Control | Implementation | Rationale |
|---|---|---|
| Rate limiting | Per-user, per-IP, per-endpoint; sliding window | Prevent abuse and scraping |
| Authentication | JWT with short-lived access tokens (15 min) + refresh tokens | Minimize token theft impact |
| Authorization | RBAC (buyer, seller, admin) + resource-level checks | Prevent cross-user data access |
| Input validation | Schema validation at API gateway + service-level sanitization | Prevent injection attacks |
| Output encoding | HTML entity encoding for all user-generated content in responses | Prevent XSS |
| CORS | Strict origin whitelist; no wildcard | Prevent cross-origin attacks |
| Request signing | HMAC signing for payment callbacks from processor | Prevent webhook forgery |

### Seller Data Isolation

Sellers must not access other sellers' data. Key enforcement points:

```
Access control invariants:
  1. Seller API endpoints filter ALL queries by authenticated seller_id
     (enforced at middleware level, not individual handlers)
  2. Listing updates check ownership: listing.seller_id == authenticated_seller_id
  3. Order queries for sellers return only orders where seller_id matches
  4. Seller analytics dashboards compute metrics only from seller's own data
  5. Bulk export APIs enforce per-seller scoping
  6. Admin access logged and requires approval workflow + reason code
```

---

## Money Laundering Detection Patterns

Beyond basic AML velocity checks, marketplace-specific money laundering patterns:

| Pattern | Detection Method | Risk Level |
|---|---|---|
| **Wash trading** | Same entity buying and selling between accounts they control | High: check buyer-seller shared device fingerprints, same IP ranges |
| **Structuring** | Seller splits $10K into twenty $500 transactions to avoid reporting | Medium: aggregate transaction value per seller per 24h/30d period |
| **Price manipulation** | Buyer pays $5,000 for an item worth $50; difference is laundered funds | High: price anomaly vs. category median; flagged if > 5× category median |
| **Rapid cycling** | Buyer purchases, returns (refund to different account), repurchases | High: refund-to-different-method detection; cyclic transaction graph |
| **Smurfing across sellers** | Multiple transactions to different sellers from same funding source | Medium: group transactions by payment instrument; aggregate analysis |

**Reporting obligation:** Suspicious Activity Reports (SARs) filed with FinCEN (US) or equivalent authority within 30 days of detection. Automated SAR generation for high-confidence patterns; manual review for medium-confidence.

---

## Content Moderation and Liability

### Marketplace Content Liability Framework

| Content Type | Liability Model | Platform Obligation |
|---|---|---|
| **Listing descriptions** | Section 230 / DSA notice-and-action | Remove prohibited content within 24 hours of valid notice |
| **Listing photos** | Same + DMCA for copyrighted images | Respond to DMCA takedown requests within 48 hours |
| **Reviews** | Section 230 protection for third-party content | Not required to pre-moderate; must remove illegal content on notice |
| **Buyer-seller messages** | Platform-hosted communication; monitoring permitted | NLP scan for off-platform solicitation, prohibited items, scams |
| **Counterfeit goods** | Varies by jurisdiction; contributory liability risk | Proactive detection required in EU (DSA); reactive in US |

### Prohibited Listings Detection

```
Automated detection pipeline for prohibited items:
  1. Category-based block list: weapons, drugs, stolen goods, recalled products
  2. Keyword matching: prohibited terms in title/description (localized per jurisdiction)
  3. Image classification: trained classifier for prohibited item categories
  4. Price anomaly: items priced far below category median (potential stolen goods)
  5. Regulatory database: product recall lists, sanctions lists
  6. Brand protection: trademark-flagged terms trigger brand owner notification

False positive handling:
  - Flagged listings held in "pending_review" state (not deleted)
  - Seller notified with reason code and appeal process
  - Human review target SLA: 4 hours for high-value, 24 hours for standard
  - Appeal success rate target: < 5% (indicates model calibration is correct)
```

---

## Incident Response: Data Breach Playbook

### Severity Classification

| Severity | Scope | Response Time | Notification |
|---|---|---|---|
| **P1 — Critical** | Payment data exposed; escrow compromise; mass ATO | Immediate (< 15 min) | Regulatory bodies, affected users, law enforcement |
| **P2 — High** | Seller PII exposed; buyer data accessed; fraud spike | < 1 hour | Affected users within 72 hours (GDPR), regulatory if > 500 records |
| **P3 — Medium** | Internal data exposed; employee account compromised | < 4 hours | Internal security team; no external notification unless PII involved |

### Breach Response Flow

```
Phase 1 — Contain (< 30 min):
  1. Isolate affected systems (network segmentation)
  2. Revoke compromised credentials
  3. If payment data: notify payment processor; initiate PCI forensic investigation
  4. If ATO: force logout all sessions for affected accounts

Phase 2 — Assess (< 4 hours):
  1. Determine scope: which data, how many users, what time window
  2. Identify attack vector: credential theft, SQL injection, insider threat, etc.
  3. Assess ongoing risk: is the attacker still present?

Phase 3 — Remediate (< 24 hours):
  1. Patch vulnerability
  2. Reset credentials for potentially affected accounts
  3. If payment data: begin card reissuance coordination with processor

Phase 4 — Notify (< 72 hours for GDPR):
  1. Notify regulatory bodies (DPA in EU, state AG in US)
  2. Notify affected users with: what happened, what data was involved,
     what we're doing, what they should do
  3. Update public status page
  4. File required reports (PCI DSS incident report if payment data)

Phase 5 — Post-Incident (< 2 weeks):
  1. Root cause analysis (blameless postmortem)
  2. Update threat model
  3. Implement systemic fixes (not just the specific vulnerability)
  4. Update security monitoring to detect similar attacks
```
