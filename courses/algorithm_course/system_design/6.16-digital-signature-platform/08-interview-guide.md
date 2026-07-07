# Interview Guide

## 45-Minute Pacing Guide

| Time | Phase | Focus | Key Points |
|------|-------|-------|------------|
| 0-5 min | **Clarify & Scope** | Ask questions, define boundaries | Clarify: SES vs AES vs QES? One jurisdiction or global? Bulk send in scope? What scale (envelopes/day)? |
| 5-10 min | **Core Concepts** | Establish the envelope model and signing lifecycle | Envelope = documents + signers + fields + routing. Lifecycle: DRAFT → SENT → SIGNING → COMPLETED → SEALED |
| 10-20 min | **High-Level Architecture** | Draw the system diagram | Core services, HSM, audit trail, object storage. Emphasize: audit trail is not optional, it is the legal foundation |
| 20-35 min | **Deep Dive** | Pick 1-2 critical components | Best choices: tamper-evident audit trail OR document sealing OR multi-party routing. Show hash chaining or PDF signature embedding |
| 35-42 min | **Scale & Trade-offs** | Address bottlenecks, failure modes | HSM throughput limits, PDF processing pipeline, bulk send fan-out. Discuss eIDAS levels as architectural differences |
| 42-45 min | **Wrap Up** | Summary, handle follow-ups | Reiterate: this is a legal/compliance system first, a software system second |

---

## Opening Talking Points

### Lead with Legal Non-Repudiation

**Do NOT** start with "it's a document upload and signing service." Instead:

> "A digital signature platform is fundamentally a **legal evidence generation system** that happens to have a document workflow attached to it. The core architectural challenge is not moving documents around---it's generating **mathematically provable evidence** that a specific person signed a specific document at a specific time, and that this evidence has not been tampered with after the fact. Every design decision---from the audit trail to the HSM to the PDF sealing---flows from this requirement."

### Establish the Envelope as the Core Abstraction

> "The central entity is the **envelope**, which bundles one or more documents with a set of signers, a routing order, and placed fields. The envelope is the atomic unit of a signing transaction---it has a clear lifecycle from draft to sealed, and all data (documents, signers, fields, signatures, audit events) is scoped to a single envelope. This makes it the natural sharding key."

### Highlight What Makes This Different from File Storage

> "This is **not** a document management system with a signing feature bolted on. The key differences are: (1) immutability after completion---signed documents are cryptographically sealed and cannot be modified, (2) a hash-chained audit trail that is tamper-evident, not just tamper-resistant, (3) HSM-based cryptographic operations for legally binding signatures, and (4) multi-party routing with sequential, parallel, and hybrid ordering."

---

## 10 Likely Interview Questions

### Q1: How do you ensure the audit trail is tamper-evident?

**Key answer**: Hash-chain every event within an envelope. Each event's hash is computed over the event data + the previous event's hash. Any modification (insert, delete, reorder, alter) breaks the chain and is mathematically detectable. Supplement with periodic anchoring to a public RFC 3161 Time Stamping Authority for temporal proof.

**Why interviewers ask**: Tests whether you understand the difference between "logging" and "legal evidence." A simple audit table with auto-increment IDs is trivially modifiable by anyone with database access.

### Q2: How does multi-party signing order work?

**Key answer**: Routing groups define the signing order. Groups execute sequentially; signers within a group execute in parallel. A state machine tracks which group is active and advances when the group's completion condition is met (all sign, any one signs, or minimum N sign). Race conditions in parallel groups are handled via optimistic concurrency on the routing step.

### Q3: What's the difference between SES, AES, and QES?

**Key answer**: These are not UI toggles---they are architecturally different systems.
- **SES**: Click-to-sign, platform records the action. No cryptographic signing of the document hash.
- **AES**: Certificate-based signature. HSM signs the document hash with a key uniquely linked to the signer, activated by MFA.
- **QES**: AES + identity verified by a Qualified Trust Service Provider + key stored on a certified QSCD (HSM meeting FIPS 140-2 L3). Legally equivalent to a handwritten signature in the EU.

### Q4: How do you handle signer authentication?

**Key answer**: Signers are not platform users. They authenticate via a time-limited, single-use token sent by email. Additional authentication (OTP, KBA, ID verification) is layered based on the configured security level. The token is bound to a specific envelope and signer. Token hash (not plaintext) is stored in the database.

### Q5: What happens when the HSM is unavailable?

**Key answer**: SES signatures (80% of volume) use a software path and are unaffected. AES/QES signatures fail gracefully: circuit breaker opens, signing requests are queued with user notification, and the system fails over to a secondary HSM cluster. If both clusters are down, AES/QES signing is temporarily unavailable while SES continues. This is an acceptable degradation because AES/QES is a minority of traffic.

### Q6: How do you seal a document after signing?

**Key answer**: Signatures are embedded into the PDF using PKCS#7/CAdES format via incremental saves. Each signer's signature covers all previous content (including previous signers' signatures). The platform adds a final seal with its own HSM key. The sealed PDF is self-verifying---any standard PDF reader can validate the signatures without platform involvement.

### Q7: How does bulk send work at scale (1 template → 10K recipients)?

**Key answer**: Fan-out architecture. The bulk send request is broken into chunks (e.g., 100 recipients per message) and enqueued. Worker processes create individual envelopes from the template with per-recipient customization. Idempotency keys prevent duplicate envelope creation on retries. Progress is tracked via atomic counters. Email delivery is throttled to avoid provider rate limits.

### Q8: How do you handle document integrity?

**Key answer**: Three layers: (1) SHA-256 hash of every document at upload time, (2) PKCS#7 signatures embed a signed hash that covers the document bytes, and (3) the certificate of completion records all document hashes. Any post-signing modification is detectable by recomputing the hash and comparing against the stored/signed hash. Content-addressed storage in object storage provides additional integrity.

### Q9: How do you comply with eIDAS across all three levels?

**Key answer**: The platform supports all three levels with different code paths:
- SES: Standard signing flow, platform audit trail provides evidence
- AES: Certificate-based signing through HSM, signer authenticated via MFA
- QES: Integration with Qualified Trust Service Providers for identity verification and qualified certificate issuance, signing on certified QSCDs
The choice of level is configured per signer in the envelope, not globally.

### Q10: How do you ensure data residency compliance?

**Key answer**: Organizations are assigned to a data region (US, EU, APAC) at creation. All data (documents, audit logs, encryption keys) stays within that region. The global routing layer directs API requests to the correct region. Cross-region envelopes (signer in a different region than the data) route the signer's signing session through the data region. HSM clusters are replicated per region.

---

## Proactive Trade-Offs to Raise

| Trade-Off | Option A | Option B | Recommendation |
|-----------|----------|----------|----------------|
| **Audit trail storage** | Global hash chain (single chain for all envelopes) | Per-envelope hash chains | **Per-envelope**: Enables parallel writes; global chain creates a serialization Slowest part of the process |
| **Signature verification** | Verify on every download | Verify on demand (user requests verification) | **On demand**: Verification is CPU-intensive; most downloads trust the platform |
| **PDF rendering** | Server-side (platform renders, sends images) | Client-side (browser renders PDF) | **Server-side**: Prevents PDF injection attacks where displayed content differs from signed content |
| **Signer authentication** | Platform manages all identity verification | Delegate to external Identity Providers | **Hybrid**: Platform manages email/OTP; delegate ID verification and QES certificate issuance to QTSPs |
| **HSM key model** | Per-signer keys (each signer has unique key) | Per-org keys (org key signs on behalf of signers) | **Per-org for AES**: Simpler key management. **Per-signer for QES**: Required by eIDAS for unique linkage to signatory |
| **Bulk send concurrency** | Synchronous (create all envelopes before returning) | Asynchronous fan-out (return batch ID, process in background) | **Async**: Synchronous creation of 10K envelopes would time out any API call |

---

## Key Numbers to Memorize

| Metric | Value | Context |
|--------|-------|---------|
| DocuSign market share | ~67% | Dominant player; validates the problem space |
| DocuSign customers | ~1M organizations | Scale target for a mature platform |
| Envelopes per day (target) | 5-6M | Including bulk send |
| Documents per envelope (avg) | 2.5 | Typical contract packages |
| Signers per envelope (avg) | 2.3 | Sender + 1-2 counterparties |
| HSM signing latency | 50-200ms | Compared to <1ms for software signing |
| PDF size (average) | 2MB | Standard contracts with images |
| Audit events per envelope | ~15 | Create, send, view, sign, complete, seal, download |
| eIDAS signature levels | 3 | SES, AES, QES |
| US electronic signature laws | 2 | ESIGN Act (federal), UETA (state) |
| SHA-256 hash size | 32 bytes / 64 hex chars | Used for document hashing and audit chain |
| FIPS 140-2 Level 3 | HSM certification for QES | Tamper-resistant, key zeroization |

---

## "How Is This Different from File Storage with Access Control?"

This is the most common simplification trap. Here is the complete answer:

| Dimension | File Storage + Access Control | Digital Signature Platform |
|-----------|------------------------------|--------------------------|
| **Immutability** | Files can be overwritten; versions can be deleted | Signed documents are cryptographically sealed; modification is mathematically detectable |
| **Audit trail** | Access logs (who opened what) | Hash-chained event log proving who did what, when, with what IP, and that no record has been tampered with |
| **Non-repudiation** | None---a user can claim they didn't open a file | Mathematical proof: signer's key signed the document hash; the hash chain proves the signing event was not inserted after the fact |
| **Multi-party workflow** | No native concept of signing order | State machine with sequential/parallel/hybrid routing, decline handling, reminders, expiry |
| **Cryptographic operations** | Encryption at rest (optional) | Document hash signing (RSA/ECDSA), PKCS#7 embedding, certificate chain, HSM key management |
| **Legal compliance** | Data protection (GDPR, HIPAA) | Data protection + electronic signature law (ESIGN, eIDAS, UETA) + signature creation device certification (FIPS 140-2) |
| **Identity verification** | Username/password or SSO | Per-signer multi-factor authentication (email OTP, SMS OTP, KBA, government ID verification) |
| **Self-verifying documents** | No---rely on platform to confirm authenticity | Sealed PDFs are self-verifying by any PDF reader without platform involvement |
| **Certificate of completion** | No | Standalone PDF with signer details, document hashes, audit chain summary, platform seal |

---

## Common Anti-Patterns to Avoid

| Anti-Pattern | Why It's Wrong | Correct Approach |
|-------------|---------------|-----------------|
| "Just use a database audit table" | Trivially modifiable by DB admins; no legal non-repudiation | Hash-chained audit trail with external timestamping |
| "Store private keys in encrypted files" | Keys exist in plaintext in memory during signing; extractable | HSM for all digital signature operations |
| "Client-side PDF rendering" | Attacker can manipulate what the signer sees vs. what is signed | Server-side rendering; signer sees platform-generated images |
| "One global signing key" | Single point of failure; all signatures compromised if key leaks | Key hierarchy with per-org or per-signer keys |
| "Synchronous bulk send" | 10K envelope creation will timeout any API call | Async fan-out with progress tracking |
| "Same auth for sender and signer" | Signers are often not platform users | Separate token-based auth for signers with configurable MFA |
| "eIDAS levels are just UI toggles" | SES and QES have fundamentally different cryptographic requirements | Separate code paths for each signature level |
| "Strong consistency for everything" | Notifications and search don't need strong consistency | Strong for signatures and audit; eventual for notifications and search |

---

## Follow-Up Topics (If Time Permits)

1. **Long-term signature validation (LTV)**: How to verify a signature 10 years later when the certificate has expired and the CA no longer exists
2. **Regulatory arbitrage**: An envelope created in the US, signed by someone in Germany---which law applies?
3. **Mobile signing UX**: How to render PDF pages and capture signatures on small screens
4. **API-first signing**: Embedded signing iFrames and how to prevent clickjacking
5. **Signature appearance customization**: Company branding on signature images and certificate of completion

---

## Variant Interview Questions

| Variant | Key Twist | Architecture Difference from Base |
|---------|----------|----------------------------------|
| **Notarization Platform** | Requires live video witness + identity verification by a commissioned notary | Add real-time video infrastructure (WebRTC/SFU), notary session scheduling, and state-specific notary commission verification; RON compliance varies by US state |
| **Healthcare Consent Management** | HIPAA BAA, patient consent revocation rights, guardian signing for minors | Add consent revocation workflow (unique to healthcare---most signatures are irrevocable), minor/guardian relationship model, PHI encryption isolation |
| **Real Estate Closing Platform** | Multi-document packages (30-50 docs), wet-ink fallback, title company escrow integration | Envelope complexity explodes (50 docs × 5 signers × 20 fields each); requires document package ordering, page-level field navigation, and integration with title/escrow systems |
| **Government Procurement Signing** | Authority-to-sign verification, appropriation limits, multi-level approval chains | Add delegation-of-authority checks (signer must have authority for this dollar amount), appropriation fund verification, and government-specific PKI (e.g., PIV/CAC card integration) |
| **Cross-Border Trade Documents** | Bills of lading, letters of credit, customs declarations | Each document type has different legal framework (UCP 600, Hague-Visby Rules); multi-jurisdiction compliance per document within the same envelope; integration with trade finance platforms |

---

## Red Flags by Experience Level

| Red Flag | Junior | Mid | Senior | Staff+ |
|----------|--------|-----|--------|--------|
| Treats audit trail as optional logging | | | | |
| Stores signer tokens in plaintext | | | | |
| Proposes client-side PDF rendering without discussing security | | | | |
| Cannot distinguish SES from AES from QES | | | | |
| Designs global hash chain (serialization Slowest part of the process) | | | | |
| No mention of HSM for digital signatures | | | | |
| Proposes synchronous bulk send | | | | |
| No discussion of PDF ByteRange or incremental saves | | | | |
| Ignores data residency entirely | | | | |
| Treats eIDAS levels as UI configuration | | | | |

**Reading the table**: A flag at Junior level means it is expected and coachable. The same flag at Senior/Staff+ level indicates a serious gap in distributed systems or security understanding.

---

## System Evolution Discussion

| Phase | Timeline | Key Additions | Architecture Impact |
|-------|----------|--------------|-------------------|
| **Phase 1: Post-Quantum Ready** | 2026--2028 | Dual-signing (RSA + ML-DSA), hybrid certificates, PQC-ready HSMs | Signature format must support multiple algorithm OIDs; HSM firmware upgrades; sealed PDF format change for dual signatures |
| **Phase 2: Decentralized Identity** | 2027--2029 | DID/Verifiable Credential signer authentication, EUDI wallet integration, self-sovereign signing | QTSP dependency reduced; signer presents VC instead of platform-managed certificate; wallet-to-platform signing protocol |
| **Phase 3: AI-Native Document Intelligence** | 2028--2030 | AI field detection, contract clause analysis, risk-aware routing, intelligent reminders | ML inference pipeline for document analysis; risk scoring influences authentication requirements; adaptive reminder scheduling |

---

## Key Differentiators for Top Candidates

| Quality | What It Looks Like |
|---------|-------------------|
| **Legal-first thinking** | Starts with "this is a legal evidence system" not "this is a document upload system"; every design decision references non-repudiation |
| **Cryptographic precision** | Distinguishes between visual signature embedding and PKCS#7 cryptographic signing; explains ByteRange mechanism; understands why self-verifying PDFs matter |
| **eIDAS depth** | Explains SES/AES/QES as different infrastructure, not different UI flows; mentions QSCD, QTSP, and the qualified certificate chain |
| **Audit trail sophistication** | Proposes hash chaining with TSA anchoring; explains why per-envelope chains beat global chains; understands the full-chain recomputation attack |
| **Security nuance** | Designs signer auth as hash-only storage, single-use, envelope-bound tokens; discusses the email transport problem and layered MFA |
| **Scale awareness** | Separates bulk send from interactive signing; proposes async fan-out with idempotency; discusses month-end/quarter-end spikes |

---

## Domain Vocabulary Quick Reference

| Term | Definition |
|------|-----------|
| **Envelope** | The atomic unit of a signing transaction: documents + signers + fields + routing order + audit trail |
| **PKCS#7 / CMS** | Cryptographic Message Syntax standard for encapsulating digital signatures with certificate chains |
| **CAdES** | CMS Advanced Electronic Signatures---extends PKCS#7 with timestamps, revocation data, and long-term validation |
| **PAdES** | PDF Advanced Electronic Signatures---CAdES adapted for native PDF embedding |
| **ByteRange** | PDF mechanism specifying which bytes are covered by a signature (excludes the signature value itself) |
| **HSM** | Hardware Security Module---tamper-resistant device for cryptographic key storage and operations |
| **QSCD** | Qualified Signature Creation Device---HSM certified for eIDAS Qualified Electronic Signatures |
| **QTSP** | Qualified Trust Service Provider---EU-supervised entity that issues qualified certificates |
| **SES / AES / QES** | Simple / Advanced / Qualified Electronic Signature---three eIDAS signature levels with increasing legal weight |
| **RFC 3161 TSA** | Time Stamping Authority per RFC 3161---provides cryptographic proof that data existed at a specific time |
| **Incremental Save** | PDF technique where each signature appends data without modifying existing bytes |
| **Hash Chain** | Sequential hash computation where each event's hash includes the previous event's hash, creating a tamper-evident chain |
| **Certificate of Completion** | Standalone document summarizing all signers, timestamps, document hashes, and audit chain summary |
| **Non-Repudiation** | Mathematical proof that a specific person performed a specific action; the signer cannot credibly deny having signed |
| **Content-Addressed Storage** | Storage where the key is derived from the content hash; provides built-in deduplication and integrity verification |
| **LTV (Long-Term Validation)** | Embedding OCSP responses, CRLs, and timestamps into a signature so it remains verifiable after certificate expiry |
| **FIPS 140-2 Level 3** | HSM certification standard requiring physical tamper resistance and key zeroization on tamper detection |
| **ESIGN Act** | US federal law (2000) establishing legal validity of electronic signatures in interstate commerce |
| **eIDAS** | EU regulation defining three electronic signature levels (SES/AES/QES) and trust service provider framework |
| **Envelope Routing DAG** | Directed acyclic graph defining the multi-party signing order with sequential, parallel, conditional, and threshold nodes |

---

## Estimation Quick Reference for Whiteboard

```
Key numbers to derive during the interview:

Envelopes/day:    670K organic + 5M bulk = 5.7M
Signatures/day:   5.7M × 2.3 signers = 13M
HSM ops/day:      13M × 20% AES/QES + 5.7M seals = 8.3M
HSM ops/sec:      8.3M / 86400 ≈ 96 avg, 288 peak
Storage/day:      5.7M × 2.5 docs × 2MB = 28.4 TB
Storage/year:     ~10 PB
Audit events/day: 5.7M × 15 = 85M
Emails/day:       5.7M × 2.3 × 3 = 39M
Bandwidth:        upload ~8 Gbps peak, download ~3 Gbps peak
```

---

## "But Isn't This Just a CRUD App with a Signing Button?"

This is the second most common trap (after "file storage with access control"). Complete rebuttal:

| CRUD App Property | Digital Signature Platform Reality |
|------------------|----------------------------------|
| Data is mutable | Signed documents and audit trails are immutable; mutation = legal evidence destruction |
| Reads > Writes | Write-heavy during signing; every action generates audit events with hash chain computation |
| Simple auth | Three completely different auth systems: sender (OAuth/SAML), signer (token + MFA), HSM (mTLS + key ceremony) |
| Stateless | Envelope routing is a stateful DAG execution engine; signing sessions maintain state across multiple interactions |
| Single database | Relational DB + object storage + append-only audit log + HSM + distributed cache + search index |
| Standard scaling | HSM is a hardware-constrained Slowest part of the process; cannot simply "add more servers" for cryptographic operations |
| No external dependencies | QTSP integration, TSA anchoring, email provider, identity verification service, certificate revocation checking |

---

## Advanced Follow-Up Questions (Staff+ Level)

1. **Post-quantum migration**: How would you migrate a platform with 10 years of RSA-2048 signed documents to quantum-resistant algorithms without invalidating existing signatures?
2. **Multi-jurisdiction conflict**: A document signed under eIDAS QES by an EU signer must be verified in a US court. How do you bridge the trust frameworks?
3. **Platform-as-defendant**: If your platform is sued and the court questions whether you fabricated audit records, what architectural evidence can you present?
4. **Key ceremony failure**: During an HSM key ceremony, the M-of-N quorum cannot be achieved because one custodian is unavailable. How does the system degrade gracefully?
5. **Retroactive LTV**: A customer discovers that 50,000 documents signed 2 years ago lack LTV data because the QTSP's OCSP responder was down during signing. How do you remediate?

---

## Interview Scoring Rubric

| Dimension | Weak (1-2) | Adequate (3) | Strong (4) | Exceptional (5) |
|-----------|-----------|-------------|-----------|----------------|
| **Core abstraction** | No mention of envelope model | Describes envelope but misses lifecycle states | Clear envelope lifecycle with state transitions | Envelope as sharding key + natural consistency boundary + legal entity |
| **Cryptographic understanding** | Confuses visual signature with digital signature | Mentions hashing and HSM | Explains PKCS#7, ByteRange, hash chains | LTV, archive timestamps, PQC migration awareness |
| **Compliance depth** | No mention of legal frameworks | Names ESIGN/eIDAS | Distinguishes SES/AES/QES architecturally | QTSP integration, QSCD certification, cross-jurisdiction analysis |
| **Security design** | Standard session auth for signers | Mentions token-based auth | Hash-only storage, single-use, envelope-bound tokens | Email transport problem, resend race condition, defense-in-depth |
| **Scale reasoning** | No scale discussion | Mentions HSM as Slowest part of the process | Separates SES/AES/QES paths; async bulk send | Calendar spike planning, HSM partitioning, idempotent fan-out |

---

## Time Management Tips

| If You Have Extra Time | Discuss |
|----------------------|---------|
| 5 minutes | Long-term validation (LTV) and what happens when certificates expire after 10 years |
| 10 minutes | Post-quantum cryptography migration path: dual-signing with RSA + ML-DSA |
| 15 minutes | Cross-border signing: which jurisdiction's law applies when sender is US and signer is EU |
