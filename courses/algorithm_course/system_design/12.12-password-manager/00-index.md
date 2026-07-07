# 12.12 Password Manager

## System Overview

A password manager is a security-critical application that generates, stores, and auto-fills credentials on behalf of users — protecting hundreds of secrets behind a single master password. At scale, a production password manager serves tens of millions of users, each holding vaults of 50–500+ encrypted items (passwords, TOTP seeds, credit cards, secure notes, passkeys), synchronized across browsers, mobile devices, and desktop clients in near real time.

The central design challenge is **zero-knowledge encryption**: the server stores only ciphertext and never possesses the keys needed to decrypt it — meaning even a full server compromise yields no plaintext credentials. This requires a layered key hierarchy derived entirely on the client, authentication protocols that never transmit the master password, conflict-free vault synchronization across offline-capable devices, secure sharing and emergency access without exposing root secrets, and browser extensions capable of autofill while resisting DOM-based injection attacks.

The landscape has shifted significantly since 2024. The FIDO Alliance's **Credential Exchange Protocol (CXP)** enables standardized, secure credential portability between password managers. NIST finalized **post-quantum cryptography standards** (FIPS 203/204), forcing the industry to adopt hybrid key exchange to counter harvest-now-decrypt-later threats. The **OPAQUE** asymmetric PAKE protocol is approaching RFC status, replacing SRP as the gold standard for zero-knowledge authentication. And **passkeys** — synced FIDO2 credentials — are fundamentally reshaping what a password manager stores and replays, blurring the line between password vault and authenticator.

Getting any one of these wrong does not merely degrade user experience — it catastrophically erodes user trust and potentially exposes billions of credentials. The lessons from high-profile breaches (metadata exposure, inconsistent KDF parameters, shared cloud infrastructure) have pushed the industry toward an encrypt-everything posture where the server is intentionally blinded to all content and metadata.

At its core, a password manager is a **client-side cryptographic engine** backed by a **dumb sync server**. This document series explores how to build one at world-class quality.

---

## Key Characteristics

| Characteristic | Description |
|---|---|
| **Architecture Style** | Client-heavy, zero-knowledge; server acts as encrypted blob storage and sync coordinator |
| **Core Abstraction** | Hierarchical key envelope: master password → account key → vault key → item key |
| **Dual-Key Model** | Master password + device-bound secret key for defense-in-depth against server compromise |
| **Encryption Standard** | AES-256-GCM for symmetric encryption; X25519 for asymmetric operations; Argon2id for key derivation |
| **Post-Quantum Readiness** | Hybrid key exchange (X25519 + ML-KEM-768) for sharing/sync; AES-256 vault encryption is quantum-resistant |
| **Authentication Protocol** | OPAQUE (aPAKE) — authenticates without transmitting the master password to the server |
| **Sync Model** | CRDT-based or vector-clock optimistic sync with per-item versioning; offline-first |
| **Sharing Model** | Asymmetric re-encryption: shared vault keys encrypted with recipient's public key |
| **Extension Model** | Manifest V3 browser extension with content script isolation; autofill via Practical rule of thumb DOM analysis |
| **Emergency Access** | Time-delayed key escrow or Shamir's Secret Sharing threshold scheme |
| **Passkey Integration** | FIDO2/WebAuthn: stores and replays passkey credentials; shared passkey groups for teams/families |
| **Credential Portability** | FIDO Alliance CXP/CXF protocol for secure import/export between password managers |
| **Threat Model** | Server-side adversary, network adversary, malicious extension, compromised device, quantum adversary, AI agent autofill abuse |

---

## Quick Navigation

| Document | Focus Area |
|---|---|
| [01 - Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning, SLOs |
| [02 - High-Level Design](./02-high-level-design.md) | System architecture, key design decisions, data flow diagrams |
| [03 - Low-Level Design](./03-low-level-design.md) | Data models, API design, core algorithms in Step-by-step plan in plain English |
| [04 - Deep Dives & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Zero-knowledge crypto, vault sync, browser extension, emergency access |
| [05 - Scalability & Reliability](./05-scalability-and-reliability.md) | Horizontal scaling, replication, conflict resolution, disaster recovery |
| [06 - Security & Compliance](./06-security-and-compliance.md) | Threat model, key management, breach response, SOC2/GDPR |
| [07 - Observability](./07-observability.md) | Metrics, secret-safe logging, tracing, alerting, security dashboards |
| [08 - Interview Guide](./08-interview-guide.md) | 45-min pacing, trap questions, scoring rubric |
| [09 - Insights](./09-insights.md) | 8 key architectural insights |

---

## What Differentiates This System

| Dimension | Naive Password Store | Production Password Manager |
|---|---|---|
| **Encryption** | Server-side encryption with server-held keys | Client-side AES-256-GCM; server stores only ciphertext |
| **Authentication** | Password hash comparison (bcrypt/scrypt) | OPAQUE aPAKE — master password never transmitted |
| **Key Derivation** | Single hashed password as key | Layered hierarchy: Argon2id → account key → vault key → per-item key |
| **Dual-Key Defense** | Single factor — master password only | Master password + 128-bit secret key; both required for derivation |
| **Sync** | Last-write-wins with version number | CRDT-based per-item sync with vector clocks; offline-first |
| **Sharing** | Share plaintext or re-encrypt on server | Asymmetric re-encryption: share encrypted vault key, server never decrypts |
| **Emergency Access** | Admin password reset (breaks zero-knowledge) | Time-delayed access with threshold cryptography; user controls expiry |
| **Browser Autofill** | Direct DOM injection, no origin checks | Practical rule of thumb DOM analysis with origin binding, clickjacking defenses, isTrusted event validation |
| **Breach Detection** | Manual or none | k-Anonymity API against breach databases (no full hash sent) |
| **Audit** | Server-side logs of plaintext operations | Tamper-evident audit log of encrypted operation metadata only |
| **Passkeys** | Separate authenticator app | Integrated passkey storage with synced credentials and shared passkey groups |
| **Metadata Protection** | URLs and titles stored in plaintext | All metadata (URLs, titles, timestamps) encrypted end-to-end |
| **Credential Portability** | CSV export, plaintext | CXP/CXF protocol with HPKE-based secure transport |
| **Quantum Resilience** | None | Hybrid X25519 + ML-KEM-768 for key exchange; AES-256 for vault encryption |

---

## What Makes This System Unique

### 1. The Server as a Blind Storage Layer

Unlike most distributed systems where the server contains business logic over meaningful data, a zero-knowledge password manager deliberately blinds the server. The server orchestrates storage, sync, and sharing — but processes only opaque ciphertext envelopes. This inversion of the usual server-as-authority pattern means correctness guarantees that would normally be enforced server-side (e.g., "this user owns this vault entry") must instead be verified cryptographically by the client.

Every architectural decision ripples from this constraint: key management, authentication, sharing, and even observability must work without the server ever touching plaintext. The 2022 LastPass breach demonstrated the consequences of incomplete zero-knowledge: metadata (URLs, titles) stored unencrypted leaked the structure of users' digital lives even though passwords remained safe. Modern architectures encrypt all metadata end-to-end — the server sees only opaque byte arrays and cannot even determine what type of credential an item contains.

### 2. Hierarchical Key Envelopes Enable Granular Access Control

The key hierarchy — master password → stretched account key → vault key → per-item key — is not merely organizational. Each level of wrapping enables a specific capability:

- **Rotating a vault key** without re-encrypting every item (only the vault-to-item key wrappings change)
- **Sharing a subset of items** by re-encrypting only those item keys with the recipient's public key
- **Revoking a device** by invalidating only its copy of the account key
- **Recovering an account** without transmitting the master password

This envelope model is the core architectural primitive that makes fine-grained, zero-knowledge access control tractable at scale. The dual-key model (master password + 128-bit secret key) adds defense-in-depth: even a compromised server with the encrypted vault cannot begin offline brute-force attacks because the secret key introduces 128 bits of entropy independent of password strength.

### 3. Offline-First Sync Without Conflicts

Password managers must function on aircraft, subways, and in remote areas. Clients maintain a full local copy of the encrypted vault and apply mutations optimistically. When connectivity returns, a conflict-free merge strategy — using either CRDT semantics for additive operations (adding/updating items) or last-write-wins with vector-clock tiebreaking for deletes — reconciles diverged replicas.

The challenge is that merge logic must operate entirely on ciphertext metadata (timestamps, item IDs, version vectors), never on decrypted content, because the sync server cannot decrypt. This means the server cannot intelligently resolve conflicts — it can only relay version vectors and let clients make the final merge decision.

### 4. Browser Extension as High-Value Attack Surface

The browser extension sits at the intersection of the most hostile environment (arbitrary web pages) and the highest-value assets (all user credentials). DOM-based clickjacking attacks can invisibly manipulate autofill interactions. The emergence of AI browser agents introduces a new threat: programmatic autofill triggers that bypass user intent, requiring `isTrusted` event validation on all credential fill operations.

The migration to Manifest V3 replaces persistent background pages with service workers, fundamentally changing how vault state is managed — session keys must be stored in the extension's session storage or re-derived on each service worker activation. Origin-bound credential scoping (ensuring passwords for `bank.com` never autofill on `bank.com.evil.com`), content script isolation via extension messaging APIs, and anti-phishing heuristics (visual similarity detection, certificate transparency checks) are all required defenses.

### 5. Post-Quantum Migration as Existential Requirement

With NIST finalizing ML-KEM (FIPS 203) and ML-DSA (FIPS 204) in August 2024, password managers face a unique urgency: encrypted vaults intercepted today can be stored and decrypted years from now when quantum computers mature — the harvest-now-decrypt-later (HNDL) threat. Since vault data has a multi-decade secrecy lifespan (banking credentials, identity documents, SSH keys), the migration to post-quantum cryptography is not hypothetical — it is an active engineering priority.

The practical approach is hybrid key exchange (classical X25519 + post-quantum ML-KEM-768) for all key transport operations (sharing, sync, device enrollment), while AES-256 vault encryption is already quantum-resistant. This hybrid model ensures forward security without depending entirely on new algorithms that may still have undiscovered weaknesses.

### 6. From Password Vault to Universal Credential Manager

The rise of passkeys (synced FIDO2/WebAuthn credentials) transforms the password manager from a store of shared secrets into a universal credential authority. Passkeys are asymmetric key pairs — the manager holds the private key in the encrypted vault and performs WebAuthn assertion signing on behalf of the user.

This is architecturally distinct from storing a password string: the manager must implement a full WebAuthn authenticator, handle conditional UI mediation (where the browser suggests passkeys before the user even clicks a field), support shared passkey groups for family and team contexts, and export credentials via the FIDO Alliance Credential Exchange Protocol (CXP) with HPKE-based secure transport. The password manager becomes the user's portable identity infrastructure — not merely a convenience tool, but a critical security layer that replaces phishable passwords with cryptographic authentication.

---

## Key Metrics at a Glance

| Metric | Value |
|---|---|
| **Scale** | 50M registered users, 10M DAU, 7.5B vault items |
| **Storage** | 15 TB vault ciphertext, 36 TB/year audit logs |
| **Peak throughput** | 50K sync events/s, 5K auth events/s |
| **Vault unlock** | < 500ms (Argon2id + decrypt on mid-range device) |
| **Sync latency** | < 2s end-to-end for incremental changes |
| **Availability** | 99.95% sync, 99.99% auth; full offline operation |
| **Durability** | 9-nines (99.9999999%) for vault data |

---

## Related Patterns

A password manager's architecture draws from and contributes to many system design domains — zero-knowledge encryption, offline-first sync, threshold cryptography, and credential management all appear in other contexts. Understanding these connections strengthens both the password manager design and the broader architectural toolkit.

The most direct parallels are with end-to-end encrypted messaging (identical zero-knowledge model) and secrets management (envelope encryption, key rotation). The sync subsystem mirrors distributed file sync problems, while the audit chain shares DNA with blockchain immutability patterns.

| Related System | Relationship | Key Shared Pattern |
|---|---|---|
| [End-to-End Encrypted Messaging](../11.1-end-to-end-encrypted-messaging/) | Same zero-knowledge architecture — server stores ciphertext, clients hold keys | Client-side encryption, key hierarchy, device key management |
| [Authentication & SSO Platform](../9.1-authentication-sso/) | OPAQUE, passkey/WebAuthn, MFA orchestration, session management | Identity protocols, token lifecycle, federated authentication |
| [Secrets Management System](../2.8-secrets-management/) | Envelope encryption, key rotation, audit logging, access control | Key envelope model, transit encryption, policy-based access |
| [Distributed File Sync](../6.3-collaborative-document-editor/) | Offline-first CRDT sync, conflict resolution, multi-device consistency | Vector clocks, optimistic replication, eventual consistency |
| [Payment Processing Platform](../8.1-payment-processing/) | Zero-tolerance for data loss, PCI-level security, tamper-evident audit trails | Compliance-driven architecture, encryption at rest, audit immutability |
| [Content Delivery Network](../2.4-cdn/) | Edge caching of static assets, extension update distribution | Cache invalidation, geo-distributed delivery |
| [Identity Verification System](../9.4-identity-verification/) | Biometric unlock flows, document-based account recovery | Multi-factor assurance levels, liveness detection integration |
| [Blockchain & Distributed Ledger](../1.7-blockchain/) | Tamper-evident hash chains in audit logs, threshold cryptography | Cryptographic integrity, Shamir's Secret Sharing, consensus on immutable state |

Each of these relationships is explored in greater depth within the relevant deep-dive and design-decision sections throughout this document series.
