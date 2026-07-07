# Security & Compliance — AI-Native Mobile Money Super App Platform

## Threat Model

### Threat Matrix

| Threat | Attack Vector | Impact | Likelihood | Priority |
|---|---|---|---|---|
| **SIM Swap** | Attacker obtains victim's SIM via social engineering at MNO outlet or insider collusion | Full account takeover; wallet drained within minutes | High (47 cases per 750K swaps in Kenya, but rising 327% YoY) | P0 |
| **Social Engineering** | Phone call/SMS impersonating platform support, fake promotion, reverse transaction scam | Victim voluntarily sends money or reveals PIN | Very High (most common fraud type by volume) | P0 |
| **Agent Collusion** | Agent colludes with external fraudsters or commits fraud directly (commission farming, structuring, ghost transactions) | Financial losses, regulatory violations, network integrity damage | High (agents handle physical cash with limited oversight) | P0 |
| **Insider Threat** | Platform employee with system access modifies wallets, creates fraudulent transactions, or exfiltrates customer data | Large-scale financial loss or data breach | Medium (controlled by access management) | P1 |
| **Man-in-the-Middle on USSD** | USSD is transmitted in cleartext over SS7; attacker with SS7 access can intercept session data including PINs | PIN theft, transaction manipulation | Medium (requires telco infrastructure access) | P1 |
| **API Key Compromise** | Third-party developer's API key leaked; used to initiate unauthorized merchant payments | Unauthorized transactions billed to merchants | Medium (developer security varies widely) | P1 |
| **Denial of Service** | Flooding USSD gateway or API with requests to prevent legitimate users from transacting | Service disruption for millions of users | Medium (USSD gateways are natural Slowest part of the process) | P2 |
| **Money Laundering** | Using mobile money for layering (moving illicit funds through multiple accounts to obscure origin) | Regulatory penalties, license revocation risk | High (mobile money's ease of use attracts laundering) | P0 |

---

## Authentication Architecture

### USSD PIN Authentication

USSD provides no native encryption—the session data (including the user's PIN) is transmitted in cleartext over the MNO's SS7/SIGTRAN infrastructure. This creates an inherent security limitation that the platform mitigates through layered controls:

**PIN Design:**
- 4-digit numeric PIN (USSD keyboards are numeric-only)
- PIN is entered during every financial transaction (no "remember me" equivalent for USSD)
- PIN is hashed with bcrypt (cost factor 12) and stored; never stored in plaintext
- PIN entry attempt limit: 3 consecutive failures → wallet locked for 24 hours → unlock requires agent-assisted identity verification

**Compensating Controls for USSD Cleartext:**
- **Transaction limits:** USSD transactions have lower per-transaction and daily limits than app-based transactions (reflecting higher interception risk)
- **Behavioral biometrics:** USSD navigation patterns (time between menu selections, input speed) create a behavioral fingerprint. If the biometric profile changes significantly (suggesting a different person is using the account), additional verification is triggered
- **Session binding:** USSD sessions are bound to the MSISDN and IMSI of the originating device. If the IMSI doesn't match the registered IMSI (indicating a SIM swap), the session is terminated immediately

### App-Based Authentication

Smartphone app users have access to stronger authentication:

- **Device binding:** On first login, the app generates a device-specific key pair. The public key is registered with the platform. Subsequent authentications require proof of possession of the private key (stored in device secure enclave).
- **Biometric unlock:** Fingerprint or face authentication for transaction confirmation, using the device's biometric hardware with platform verification.
- **Session tokens:** JWT tokens with 15-minute expiry for active sessions, refresh tokens with 30-day expiry. Token refresh requires device key verification.
- **Step-up authentication:** High-value transactions (>$100 or custom threshold) require PIN entry even if biometric is enabled.

### Agent Authentication

Agents use dedicated credentials with additional controls:

- **Agent PIN + Device binding:** Agent PIN works only from registered device(s). New device registration requires head office approval.
- **Geo-fencing:** Agent transactions are validated against the agent's registered location. Transactions originating >5 km from registered location trigger alerts.
- **Daily settlement verification:** Agents must perform a daily cash count and confirm via the agent app. Discrepancies between reported cash and system-derived expected cash are flagged.

---

## SIM Swap Prevention — Multi-Layer Defense

### Layer 1: MNO Integration

The platform integrates with MNO APIs to detect SIM changes:

**Real-time SIM swap notification (where available):** The MNO sends an event when a SIM swap is processed for any MSISDN registered on the platform. The platform immediately freezes the wallet and sends an alert to the user's registered email (if available) and previously active device.

**Periodic IMSI polling (fallback):** For MNOs without real-time notification, the platform periodically queries the HLR for the current IMSI of registered MSISDNs. Frequency: every 4 hours for high-value accounts, every 24 hours for standard accounts. Any IMSI change triggers the same freeze procedure.

### Layer 2: Session-Level Detection

Every USSD session and API call includes device identifiers:

- **USSD:** The USSD gateway passes the calling party's IMSI (available in the SS7 signaling). The platform compares against the stored IMSI.
- **App:** The app transmits the device IMEI and a device fingerprint. Changes in either trigger enhanced verification.

### Layer 3: Post-Swap Behavioral Lockdown

After any detected SIM change (whether the user legitimately got a new SIM or was attacked):

1. **72-hour cooling period:** No outgoing financial transactions. Incoming credits are allowed (so the user isn't financially harmed by receiving delays).
2. **Identity re-verification:** User must visit an agent with their original KYC documents. Agent scans ID and submits verification request.
3. **Progressive access restoration:** After re-verification, transaction limits start at 10% of normal and ramp up over 7 days—providing time to detect if the re-verification itself was fraudulent.

---

## Data Protection

### Encryption Architecture

| Data State | Protection | Implementation |
|---|---|---|
| **At rest** | AES-256 encryption | All database volumes, backups, and log storage encrypted with service-managed keys rotated annually |
| **In transit (App ↔ API)** | TLS 1.3 with certificate pinning | App pins the platform's certificate; prevents MITM even if device's CA store is compromised |
| **In transit (USSD)** | SS7-level (unencrypted) | Compensated by transaction limits, behavioral biometrics, and SIM swap detection; platform cannot encrypt USSD signaling |
| **PIN storage** | Bcrypt hash (cost 12) | PINs never stored or logged in plaintext; PIN entry fields excluded from all logging |
| **PII masking** | Dynamic masking in logs/support tools | MSISDNs displayed as +254***5678 in support tools; full number requires elevated access with audit trail |
| **Backup encryption** | Separate encryption keys from production | Backup decryption requires two-person authorization (dual-control) |

### Data Retention

| Data Category | Retention Period | Regulatory Basis |
|---|---|---|
| Transaction ledger | 7 years | Kenya CBK (7 years), Tanzania BOT (10 years) — use most restrictive |
| KYC documents | Account lifetime + 5 years | AML regulations across jurisdictions |
| USSD session logs | 90 days | Operational need; no PII beyond MSISDN |
| Fraud investigation data | Duration of investigation + 2 years | Law enforcement cooperation requirements |
| Credit scoring features | 2 years from last transaction | Balance between model training needs and privacy |
| SMS notification logs | 1 year | Customer dispute resolution window |

---

## Multi-Jurisdiction Compliance

### Regulatory Landscape

| Country | Regulator | Key Requirements |
|---|---|---|
| **Kenya** | Central Bank of Kenya (CBK) | National Payment System Act; mobile money licensed as Payment Service Provider; daily transaction limit KES 300,000; mandatory monthly reporting; data must reside in Kenya |
| **Tanzania** | Bank of Tanzania (BOT) | National Payment Systems Act 2015; interoperability mandate (must support cross-network transfers); transaction data retained 10 years; quarterly AML reporting |
| **Ghana** | Bank of Ghana (BOG) | Payment Systems and Services Act 2019; mandatory interoperability via Ghana Interbank Payment and Settlement Systems (GhIPSS); mobile money levy (1.5% e-levy on transfers >GHS 100) |
| **Nigeria** | Central Bank of Nigeria (CBN) | Mobile Money Operator license required; agent banking guidelines; KYC tiered based on transaction limits; data localization mandate |
| **DRC** | Banque Centrale du Congo (BCC) | Mobile money regulations 2011 (updated 2019); biometric SIM registration mandate; limits on daily/monthly transactions |
| **Ethiopia** | National Bank of Ethiopia (NBE) | Mobile money framework 2020; only MNOs and microfinance institutions can operate; foreign ownership restrictions |
| **Mozambique** | Banco de Moçambique (BM) | E-money regulations; interoperability requirements; customer protection mandates |

### Compliance Engine Architecture

The platform implements a **rules engine** that encapsulates country-specific regulatory requirements as configurable rules rather than hardcoded logic:

```
RegulatoryRule {
    country_code:    "KE"
    rule_type:       "TRANSACTION_LIMIT"
    parameters: {
        daily_limit:  30000000,          // KES 300,000 in cents
        per_txn_limit: 15000000,         // KES 150,000
        kyc_tier:     "TIER_2"
    }
    effective_from:  "2024-01-01"
    effective_until: null                 // Currently active
}
```

When a new regulation takes effect (e.g., Ghana's e-levy change), a new rule version is added with the effective date. The engine evaluates the appropriate rule version based on the transaction timestamp—enabling retroactive compliance checks and audit trail reconstruction.

---

## AML/KYC Framework

### Tiered KYC

| Tier | Verification Level | Documents | Transaction Limits (per day) | Use Case |
|---|---|---|---|---|
| **Tier 1** | Basic registration | Phone number + name + date of birth (self-declared) | $50 equivalent | Casual users, airtime purchase, small P2P |
| **Tier 2** | ID verification | Government-issued ID (national ID, passport) + address | $500 equivalent | Regular users, bill payments, merchant payments |
| **Tier 3** | Enhanced verification | ID + biometric (fingerprint/photo) + proof of address + source of funds declaration | $5,000 equivalent | High-value users, business accounts, cross-border |
| **Agent** | Business verification | Business license + ID of owner + tax registration + physical location verification | Per-country agent limits | Cash-in/cash-out service provision |

### Transaction Monitoring

The AML monitoring system runs two layers:

**Real-time screening:**
- Every transaction is checked against sanctions lists (UN, OFAC, EU, country-specific)
- MSISDN and customer name fuzzy-matched against watchlists (accounting for naming conventions: single names, reversed order, transliteration variants)
- Politically Exposed Persons (PEP) screening for Tier 3 accounts

**Batch pattern detection (daily):**
- **Structuring detection:** Identify sequences of transactions just below reporting thresholds
- **Velocity anomalies:** Accounts with sudden volume increases (>5× historical average)
- **Circular flows:** Money moving in cycles through a network of accounts (A→B→C→A)
- **Dormant account activation:** Long-dormant accounts suddenly receiving and forwarding large sums
- **Geographic anomalies:** Cross-border patterns inconsistent with the customer's profile

### Suspicious Activity Reporting (SAR)

When the AML system identifies a suspicious pattern:
1. Case created in the compliance management system with full transaction evidence
2. Assigned to a compliance analyst for review (SLA: 24 hours for high-priority, 72 hours for standard)
3. If confirmed suspicious: SAR filed with the relevant Financial Intelligence Unit (FIU) within the regulatory deadline (typically 24–48 hours after determination)
4. Account may be frozen pending investigation (regulatory authorization required in most jurisdictions)

---

## Agent Security Controls

### Agent Fraud Prevention

| Control | Mechanism | Detection |
|---|---|---|
| **Commission farming** | Agent processes many tiny transactions to earn per-transaction commission | Statistical analysis: flag agents whose transaction amount distribution differs significantly from their peer group |
| **Split transactions** | Agent breaks large transactions into smaller ones below reporting thresholds | Pattern detection: time-clustered transactions between same parties summing to amounts near thresholds |
| **Unauthorized SIM registration** | Agent registers SIM cards using fake or stolen IDs | Biometric deduplication: same face/fingerprint across multiple registrations; dormancy analysis: newly registered accounts with no activity |
| **Float misappropriation** | Agent uses float for personal transactions or lending | Reconciliation: daily automated comparison of agent's reported cash position vs. system-derived expected position |
| **Phantom transactions** | Agent creates fake customer transactions to earn commissions | Graph analysis: transactions between a small, closed network of accounts all serviced by the same agent |

### Agent Monitoring Dashboard

Real-time monitoring of agent network health includes:
- Geographic heat map of agent activity (anomaly detection on regional patterns)
- Agent performance scorecards (transaction volume, error rate, customer complaints, float utilization)
- Peer comparison analytics (how does this agent compare to others in similar locations?)
- Whistleblower channel: anonymous reporting mechanism for agents to report fraud they observe in the network

---

## Domain-Specific Threat Model

### USSD Interception via SS7 Vulnerabilities

USSD sessions traverse the MNO's SS7 signaling network in cleartext. Attackers with SS7 access (rogue MNO employees, compromised SS7 interconnect providers, nation-state actors) can intercept PINs and session data:

**Attack surface:** SS7 was designed in the 1980s with no authentication between network nodes. An attacker with access to an SS7 gateway can send MAP (Mobile Application Part) requests to intercept USSD sessions, redirect SMS messages, or query subscriber location.

**Mitigation strategy:**
- **End-to-end encryption is impossible** on USSD (feature phones cannot run encryption)
- **Compensating controls:** USSD transaction limits capped at 60% of app-channel limits; behavioral biometric profiling detects if the USSD navigator is a different person than usual; post-transaction callback verification for amounts exceeding $50
- **Detection:** Monitor for unusual SS7 query patterns (e.g., multiple MAP-SRI queries for the same MSISDN from unusual originators). Partner with MNOs to implement SS7 firewalls that block unauthorized query sources.
- **Long-term:** Migrate high-value transactions to the app channel; promote smartphone adoption; support SIM Toolkit (STK) applications that provide basic encryption on feature phones

### Money Mule Networks

Organized crime recruits mobile money users as "mules" to receive and forward illicit funds. The mule may not know they're participating in money laundering.

**Detection signals:**
- **Rapid forwarding:** Account receives large credit → forwards 90%+ to a different account within minutes
- **Network clustering:** Multiple mule accounts all forward to the same destination
- **Account profile mismatch:** Tier 1 KYC account (low limits) receiving amounts near the daily limit from multiple sources
- **Temporal coordination:** Multiple mule accounts activate simultaneously and process similar amounts

**Graph-based detection:**
```
FUNCTION detect_mule_network(suspicious_transaction):
  // Build 2-hop transaction graph from the destination account
  destination = suspicious_transaction.receiver
  graph = build_transaction_graph(destination, hops=2, window=72_hours)

  // Identify fan-in pattern (many accounts → one account → one account)
  fan_in_ratio = count(graph.incoming_edges) / count(graph.outgoing_edges)
  IF fan_in_ratio > 5.0:
    // Many sources, few destinations — potential collection point
    FLAG as COLLECTION_POINT

  // Check for temporal clustering
  incoming_timestamps = graph.incoming_edges.map(e => e.timestamp)
  IF max(incoming_timestamps) - min(incoming_timestamps) < 4_hours:
    AND count(incoming_timestamps) > 10:
    FLAG as COORDINATED_DEPOSIT

  // Check forwarding velocity
  forwarding_delay = AVG(outgoing_edge.timestamp - nearest_incoming_edge.timestamp)
  IF forwarding_delay < 30_minutes:
    FLAG as RAPID_FORWARDING
```

### Insider Threat Controls

Platform employees with access to production systems pose a significant risk—they can modify wallet balances, create fraudulent transactions, or exfiltrate customer data.

**Layered defense:**

| Control | Mechanism |
|---|---|
| **Principle of least privilege** | Role-based access control (RBAC) with job-function-specific roles; no engineer has direct write access to production ledger |
| **Dual authorization** | Any manual ledger adjustment requires approval from two independent authorizers (maker-checker pattern) |
| **Break-glass access** | Emergency production access is logged, time-limited (1 hour), and triggers immediate review by the security team |
| **Audit trail immutability** | All administrative actions written to an append-only audit log with cryptographic chaining (each entry includes hash of previous entry); tampering detection is automatic |
| **Background checks** | All employees with production access undergo annual background verification; any adverse findings trigger immediate access revocation |
| **Session recording** | All production access sessions are recorded (keystroke-level for database access, screen-level for admin dashboards); recordings retained for 2 years |
| **Anomaly detection on admin actions** | ML model monitors admin activity: unusual query patterns, after-hours access, queries for specific customer accounts without corresponding support tickets |

---

## Privacy and Data Protection

### Data Classification

| Classification | Examples | Access Controls | Encryption |
|---|---|---|---|
| **Restricted** | PINs, biometric templates, encryption keys | No human access; system-only via HSM | AES-256 at rest; never in logs |
| **Confidential** | Wallet balances, transaction details, credit scores | Role-based access with audit trail | AES-256 at rest; TLS 1.3 in transit |
| **Internal** | Aggregated analytics, model performance metrics | Team-level access | Encrypted at rest |
| **Public** | Fee schedules, product descriptions, help content | Unrestricted | N/A |

### Cross-Border Data Transfer Controls

For multi-country operations where ML model training requires data from multiple jurisdictions:

1. **In-country processing:** Raw transaction data never leaves the country. Feature extraction runs in-country.
2. **Anonymization pipeline:** Features are anonymized before cross-border transfer: wallet IDs replaced with irreversible pseudonyms, amounts bucketed into ranges, timestamps rounded to hour granularity, geographic data aggregated to region level.
3. **Federated learning alternative:** For credit scoring models, federated learning trains the model in-country, sharing only model gradients (not raw data) with the central training coordinator. Privacy budget tracked via differential privacy guarantees (ε < 1.0).

---

## Mobile Money-Specific Compliance Requirements

### E-Money Issuance License Requirements

| Requirement | Implementation |
|---|---|
| **Ring-fenced trust account** | All customer funds held in a trust account at a prudentially regulated bank; platform cannot co-mingle customer funds with operational funds |
| **100% liquidity coverage** | Trust account balance must equal or exceed the sum of all wallet balances at all times; verified hourly via automated reconciliation |
| **Monthly regulatory reporting** | Automated generation of reports: transaction volume/value by type, active user count, agent network metrics, float utilization, fraud statistics |
| **Annual external audit** | Independent auditor verifies trust account reconciliation, system controls, and AML compliance; platform provides data extraction APIs for auditor access |
| **Consumer protection disclosures** | Transaction fees displayed before confirmation; full terms delivered via SMS for USSD channel; complaints resolution within 14 days (Kenya CBK requirement) |
| **Dormant account handling** | Accounts inactive for 12+ months flagged as dormant; balance escheatment to government after regulatory deadline (varies by jurisdiction: 5 years Kenya, 7 years Tanzania) |

### Recent Regulatory Developments (2024–2026)

| Jurisdiction | Change | Impact on Architecture |
|---|---|---|
| **Kenya** | CBK 2024 mandate for real-time IMSI verification on all USSD financial transactions | New synchronous API call to MNO HLR on every USSD transaction; adds 50-80ms to critical path |
| **Nigeria** | CBN 2025 requirement for BVN/NIN verification for all mobile money tiers | Integration with NIMC (National Identity Management Commission) API; adds identity verification step to Tier 1 registration |
| **Ghana** | E-levy revision (reduced from 1.5% to 1.0% in 2024) | Fee calculation engine updated; retroactive reporting adjusted; customer communication campaign |
| **Tanzania** | BOT 2025 interoperability mandate requiring instant cross-network settlement | Integration with Tanzania Instant Payment System (TIPS); real-time clearing for inter-operator transfers |
| **Pan-African** | PAPSS live in 18+ countries (2025) | Cross-border settlement via PAPSS reduces settlement time from days to seconds; corridor-specific fee structures replaced with PAPSS standardized pricing |
