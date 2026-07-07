# 01 — Requirements & Estimations: Password Manager

## Functional Requirements

| # | Requirement | Notes |
|---|---|---|
| FR1 | **Account creation & authentication** | Register with email; authenticate using OPAQUE protocol (master password never transmitted) |
| FR2 | **Master password key derivation** | Client-side Argon2id derivation (64 MB, 3 iterations, 4 parallel) produces account key and authentication credential |
| FR3 | **Dual-key account model** | Master password + 128-bit secret key generated at signup; both required for key derivation — server compromise alone cannot enable brute-force |
| FR4 | **Vault item CRUD** | Create, read, update, delete passwords, secure notes, credit cards, TOTP seeds, SSH keys, passkeys |
| FR5 | **Client-side encryption/decryption** | All item content and metadata encrypted on device before upload; server stores only ciphertext |
| FR6 | **Multi-device sync** | Vault changes propagate to all authenticated devices within seconds; offline-first with CRDT merge |
| FR7 | **Browser extension autofill** | Detect login forms, suggest matching credentials, fill username/password with origin verification; isTrusted event validation to block AI agent triggers |
| FR8 | **Password and passphrase generator** | Generate passwords/passphrases with configurable length, character sets, word lists, entropy display |
| FR9 | **Secure sharing** | Share individual items or vaults with other users via asymmetric re-encryption; shared passkey groups for family/team |
| FR10 | **Emergency access** | Designate trusted contacts who can request access after a configurable time delay (1-30 days); Shamir's Secret Sharing threshold scheme |
| FR11 | **Breach detection** | Check credentials against breach databases using k-anonymity (no full hash sent); proactive monitoring with breach-detection obligations per NIST SP 800-63B-4 |
| FR12 | **Multi-factor authentication** | TOTP, hardware security keys (FIDO2/WebAuthn), push-based 2FA; phishing-resistant authenticators preferred |
| FR13 | **Passkey storage and autofill** | Store FIDO2 passkeys; perform WebAuthn assertion signing as a platform authenticator; conditional UI mediation; discoverable credentials |
| FR14 | **Audit log** | Tamper-evident, hash-chained log of access events (metadata only, no plaintext); exportable for compliance |
| FR15 | **Import/export via CXP/CXF** | Import from CSV and other managers; export via FIDO Alliance Credential Exchange Format (CXF) with HPKE-based secure transport; plaintext export with confirmation gate |
| FR16 | **Organization vaults** | Shared vaults for teams with role-based access (viewer, editor, admin); SCIM provisioning for enterprise SSO integration |
| FR17 | **Metadata encryption** | All metadata (URLs, titles, notes, timestamps) encrypted end-to-end — server sees only opaque ciphertext, no item structure |
| FR18 | **Sentinel monitoring** | Real-time anomaly detection on account activity (login from new geo, bulk export, rapid sharing); user-configurable alerts |

---

## Out of Scope

- Full privileged access management (PAM) with session recording and just-in-time access provisioning
- Secret scanning across code repositories (CI/CD integration)
- Hardware Security Module (HSM) management for enterprise root-of-trust (mentioned architecturally but not detailed)
- Mobile SDK for third-party application integration
- Real-time collaboration/editing on shared vault items
- Built-in VPN or network privacy features
- Email alias generation (mentioned as integration point, not core)

---

## Edge Cases & Boundary Conditions

| Scenario | Handling |
|---|---|
| **User forgets master password** | No server-side recovery (zero-knowledge); only emergency access via Shamir shares or pre-configured account recovery kit (encrypted PDF with secret key) |
| **Secret key lost** | Without the 128-bit secret key, account is unrecoverable even with correct master password; users must store the recovery kit securely |
| **Concurrent edits on same item from two devices** | CRDT merge: vector clock comparison determines winner; if concurrent (neither dominates), last client_modified_at wins with conflict logged for user review |
| **Vault with 10,000+ items** | Paginated sync with delta compression; full vault download streamed in chunks; client-side index built lazily |
| **Emergency access during grantor's death** | k-of-n threshold contacts gather shares after wait period expires; shares auto-approve if grantor does not cancel |
| **Browser extension in private/incognito mode** | Vault data not persisted to local storage; session keys held in memory only; vault re-locked on window close |
| **Passkey for site that also has a password** | Both credentials displayed; user chooses; passkey preferred in sort order if conditional UI is active |
| **Import of 50,000+ credentials from CSV** | Batch processing with progress indicator; deduplication by URL + username; client-side encryption parallelized across web workers |
| **Argon2id exceeds memory on low-end device** | Adaptive KDF parameters: detect available memory; fall back to reduced memory (32 MB) with increased iterations (6) to maintain equivalent resistance |
| **Server unreachable for > 7 days** | Client operates fully offline; sync backlog queued; on reconnect, full delta sync with server; conflict resolution applied to all queued mutations |
| **Vault key rotation with 100K-member org** | Lazy re-encryption: new vault key issued; items re-encrypted on next client access; old key retained (read-only) until migration completes |
| **CXF export to competing manager** | All credentials serialized to CXF JSON; HPKE-encrypted to recipient manager's public key; passkeys exported as full key material |

---

## Non-Functional Requirements

### Immutability & Integrity

| Property | Requirement |
|---|---|
| **Vault integrity** | Each vault item carries an AEAD authentication tag; tampering is detectable client-side |
| **Audit log integrity** | Append-only, hash-chained audit entries; deletion or modification is cryptographically detectable |
| **Key history** | Previous vault key versions retained (encrypted) to allow decryption of older backups |
| **Metadata immutability** | Encrypted metadata (URLs, titles) versioned alongside item content; no server-side mutation possible |

### Performance

| Operation | Target Latency (p99) |
|---|---|
| Vault unlock (local decrypt after auth) | < 500ms on mid-range device |
| Vault sync (incremental, online) | < 2s end-to-end |
| Autofill suggestion render | < 100ms after page load |
| Password generation | < 50ms |
| Passkey assertion signing | < 200ms |
| Breach check (k-anonymity query) | < 1s |
| Full vault initial download (500 items) | < 5s |
| CXF export (1,000 credentials) | < 10s |
| Argon2id key derivation (64 MB, 3 iter) | 300-800ms depending on device |
| Shamir share reconstruction (k=3) | < 100ms |

### Scalability

| Dimension | Requirement |
|---|---|
| **Users** | 50M registered accounts, 10M daily active users |
| **Vaults** | Horizontal scaling with consistent hashing across vault shards |
| **Sync throughput** | 50,000 vault change events per second at peak |
| **Organization vaults** | Support orgs with up to 100,000 members sharing vaults |
| **Passkey credentials** | Average 20 passkeys per user growing 5x YoY; 1 billion passkeys at scale |
| **Reads vs. writes** | Read-heavy (10:1 ratio); optimize for fast ciphertext retrieval |
| **Breach database** | Index of 15+ billion compromised credential hashes, updated daily |

### Availability

| Dimension | Requirement |
|---|---|
| **Uptime** | 99.95% monthly availability for sync and auth services |
| **Offline operation** | Full read/write capability offline; sync on reconnect |
| **Degraded mode** | If sync is unavailable, local encrypted cache allows continued operation; autofill works entirely from local vault |
| **Recovery RTO** | < 1 hour for region failover |
| **Recovery RPO** | < 5 minutes of data loss on catastrophic failure |
| **Extension resilience** | Manifest V3 service worker restarts must re-derive session state within 200ms |

### Security

| Control | Requirement |
|---|---|
| **Zero-knowledge** | Server never possesses master password, account key, vault key, or item metadata in plaintext |
| **Dual-key model** | Master password + 128-bit secret key; server cannot brute-force vault without both |
| **Transport security** | TLS 1.3 with certificate pinning in mobile apps |
| **Encryption algorithms** | AES-256-GCM, X25519, Ed25519, Argon2id, HKDF-SHA256 |
| **Post-quantum readiness** | Hybrid key exchange (X25519 + ML-KEM-768) for sharing and key transport; AES-256 vault encryption is quantum-resistant |
| **Key storage** | Per-device session keys in OS secure storage (Keychain, Keystore, OS secret service); Secure Enclave integration where available |
| **Brute-force protection** | Server-side rate limiting on auth; client-side Argon2id + secret key makes offline attacks computationally infeasible |
| **Session management** | Short-lived JWT session tokens (15-min expiry); refresh tokens rotate on use; binding to device fingerprint |
| **AI agent defense** | isTrusted event validation on all autofill triggers; block programmatic form submission by browser AI agents |
| **Penetration testing** | Annual third-party audit (e.g., Cure53-style); continuous automated scanning; public bug bounty program |

### Compliance

| Standard | Requirement |
|---|---|
| **SOC 2 Type II** | Annual audit covering security, availability, and confidentiality trust service criteria |
| **GDPR** | User data deletion on request; data residency options for EU users; right to portability via CXF export |
| **HIPAA** | Business Associate Agreement (BAA) available for enterprise health-sector customers |
| **CCPA** | California consumer privacy rights: access, deletion, opt-out |
| **NIST SP 800-63B-4** | Phishing-resistant authenticators; syncable passkeys as AAL2; stronger KDF requirements; breach-detection obligations |
| **FIDO Alliance CXP** | Credential Exchange Protocol compliance for interoperable import/export |
| **NIST FIPS 203/204** | Post-quantum algorithm readiness; ML-KEM and ML-DSA support in hybrid mode |

---

## Capacity Estimations

### Users & Vaults

```
Registered users:              50,000,000
Daily active users (DAU):      10,000,000  (20% of registered)
Monthly active users (MAU):    25,000,000  (50% of registered)
Avg vault items per user:      150
  - Passwords:                 ~100 (67%)
  - Passkeys:                  ~20  (13%)  — growing 5x YoY
  - Secure notes:              ~10  (7%)
  - Credit cards:              ~5   (3%)
  - TOTP seeds:                ~10  (7%)
  - SSH keys / identities:     ~5   (3%)
Total vault items:             50M × 150 = 7.5 billion items
Avg ciphertext per item:       ~2 KB (all fields + all metadata encrypted)
  - Password items:            ~1.5 KB
  - Passkey items:             ~3 KB (includes COSE key material, rpId, userHandle)
  - Secure notes:              ~4 KB (larger content field)
  - Credit cards:              ~1 KB
Total vault storage:           7.5B × 2 KB = 15 TB of ciphertext
Audit log entries/day:         10M DAU × 20 events = 200M entries/day
Audit log storage/year:        200M × 500 bytes × 365 = ~36 TB/year
```

### Key Material Storage

```
Per-user key material:
  - Account key envelope:            512 bytes
  - OPAQUE registration record:      256 bytes
  - X25519 public key:               32 bytes
  - Ed25519 signing public key:      32 bytes
  - ML-KEM-768 encapsulation key:    1,184 bytes (post-quantum, hybrid mode)
  - Vault key envelopes (avg 3):     3 × 128 bytes = 384 bytes
  - Device key envelopes (avg 4):    4 × 256 bytes = 1,024 bytes
  Total per user:                    ~3.4 KB

Total key material:  50M × 3.4 KB = 170 GB
  - Fits entirely in memory for hot-path serving
  - Replicated across 3 regions for availability
```

### Operations & Throughput

```
Vault sync events:
  10M DAU × 5 changes/day = 50M changes/day
  Peak factor 3x:           150M changes/day at peak
  Average per-second:       50M / 86,400 ≈ 579/s
  Peak per-second:          150M / 86,400 ≈ 1,736/s average over 24h
  Morning burst (8-10 AM):  ~50,000/s (devices syncing after overnight)

Auth events:
  10M DAU × 2 auth/day = 20M auth events/day
  OPAQUE cost:             2 round trips × 20M = 40M protocol messages/day
  Average per-second:      ~231 auth/s
  Peak per-second:         ~5,000/s (Monday morning burst)

Passkey assertions:
  10M DAU × 3 passkey auths/day = 30M assertions/day (growing rapidly)
  WebAuthn signing:        ~350 assertions/s average

Breach checks:
  10M DAU × 1 check/day = 10M breach queries/day
  k-anonymity lookups:     ~116/s average, ~2,000/s burst

Read/write ratio:           10:1 (most operations are reads during autofill)

CXF exports:
  ~10,000 exports/day (low volume, high security sensitivity)
  Average export size:     500 credentials × 2 KB = 1 MB per export
```

### Storage Summary

```
                              Current       Year 1        Year 3
Vault ciphertext:             15 TB         18 TB         26 TB   (20% YoY)
Passkey growth factor:                      3x passkeys   10x passkeys
Audit logs:                   —             36 TB         108 TB  (linear)
Key material:                 170 GB        204 GB        295 GB
Session/token store:          5 GB          6 GB          8.7 GB
Breach database (hashed):    10 TB         12 TB         15 TB   (daily deltas)
Total:                        ~25 TB        ~66 TB        ~158 TB
```

### Bandwidth

```
Vault sync:
  50M changes/day × 2 KB/change = 100 GB/day upload
  Reads (10×):                   = 1 TB/day download
  Total:                         ~1.1 TB/day, ~13 MB/s average

Auth (OPAQUE 2-round):
  20M × 4 KB (2 round trips) = 80 GB/day

Passkey assertions:
  30M × 1 KB = 30 GB/day

Breach checks:
  10M × 50 KB (full prefix response) = 500 GB/day download

Browser extension:
  Autofill suggestions (10M DAU × 10 page loads × 200 bytes) = 20 GB/day
  Extension updates (weekly, 50M users × 5 MB / 7) = ~36 GB/day

CXF exports:
  10K × 1 MB = 10 GB/day

Daily total:               ~1.84 TB/day
Peak bandwidth (10×):      ~213 MB/s inbound + outbound
CDN cache for static assets: reduces origin traffic by ~60%
```

### Compute Cost Drivers

```
Argon2id (server-side verification is zero — client-side only):
  - Zero server CPU cost for key derivation — this is the zero-knowledge advantage
  - Client cost: 300-800ms per unlock on mid-range device

OPAQUE protocol (server-side):
  - 1 OPRF evaluation per auth: ~0.5ms per operation
  - 5,000 burst auth/s × 0.5ms = 2.5 CPU-seconds/s = 3 cores at burst

WebAuthn assertion verification (server-side for passkey relying party):
  - ECDSA P-256 verify: ~0.3ms per operation
  - 350/s × 0.3ms = 0.1 CPU-seconds/s = negligible

Breach database (k-anonymity prefix lookup):
  - Hash prefix → suffix list lookup: O(1) with hash-partitioned index
  - 2,000/s burst: fully in-memory, negligible CPU

Encryption/decryption (all client-side):
  - AES-256-GCM: hardware-accelerated on all modern devices (AES-NI)
  - 500-item vault decrypt: ~50ms with AES-NI, ~200ms without
```

---

## Service Level Objectives (SLOs)

### Latency SLOs

| SLO | Target | Measurement Window |
|---|---|---|
| Authentication success latency p50 | < 200ms | Rolling 1 hour |
| Authentication success latency p99 | < 500ms | Rolling 1 hour |
| Vault sync propagation p50 | < 1s | Rolling 1 hour |
| Vault sync propagation p95 | < 3s | Rolling 1 hour |
| Autofill suggestion render p99 | < 100ms | Rolling 1 hour |
| Breach check response p99 | < 1.5s | Rolling 1 hour |
| Passkey assertion signing p99 | < 200ms | Rolling 1 hour |
| CXF export generation p99 | < 30s (for 5,000 credentials) | Per request |

### Availability SLOs

| SLO | Target | Measurement Window |
|---|---|---|
| Sync service availability | 99.95% | Monthly |
| Auth service availability | 99.99% | Monthly |
| Autofill suggestion availability | 99.9% (offline-capable — local vault is primary) | Monthly |
| Breach check service availability | 99.9% | Monthly |
| Audit log write durability | 99.999% | Annually |

### Durability & Correctness SLOs

| SLO | Target | Measurement Window |
|---|---|---|
| Vault data durability | 99.9999999% (9-nines) | Annually |
| Sync conflict resolution correctness | 99.99% (no silent data loss) | Monthly |
| Passkey authentication success rate | > 99.5% | Daily |
| Emergency access grant latency | < 24h after wait period (human-gated) | Per request |
| Mean time to detect breach | < 15 min | Per incident |
| Post-quantum hybrid handshake success rate | > 99.9% | Daily |

### Error Budget Policy

```
Monthly error budget for sync service (99.95%):
  Total minutes in 30 days:    43,200
  Allowed downtime:            43,200 × 0.0005 = 21.6 minutes/month

If > 50% of monthly error budget consumed in a single incident:
  → Freeze non-critical deployments
  → Mandatory post-incident review within 48 hours

If > 100% of monthly error budget consumed:
  → All engineering priorities shift to reliability
  → No feature work until budget recovers next month
```
