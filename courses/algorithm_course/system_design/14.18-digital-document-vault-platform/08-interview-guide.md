# Interview Guide — Digital Document Vault Platform

## 45-Minute Pacing Guide

| Time | Phase | Focus | Key Deliverable |
|---|---|---|---|
| **0:00–3:00** | Clarify Requirements | Ask about scale (how many users, documents), document types, key operations, consistency vs. availability priorities | Confirm: this is a national-scale document vault, not a simple file storage system |
| **3:00–5:00** | Establish Scope | Define what's in (issuance, storage, sharing, verification) vs. out (document creation, payment). State the trilateral model explicitly | Written scope on whiteboard |
| **5:00–10:00** | Capacity Estimation | Calculate DAU (~15M), document retrievals/day (~45M), consent operations (~3M), storage (~500TB). Call out the read-heavy ratio (50:1) | Numbers that inform design decisions |
| **10:00–20:00** | High-Level Design | Draw the trilateral architecture: Issuers → Platform ← Requesters, with Subscribers at the center. Explain the URI reference model (most documents are pointers, not copies). Show the Consent Engine as the trust broker. Include the AI pipeline for self-uploads | Architecture diagram with data flows |
| **20:00–32:00** | Deep Dives (pick 2-3) | PKI verification at scale, Consent Engine concurrency, URI resolution with issuer failover, Offline mode. Interviewer will likely probe one of these | Detailed design for 2-3 critical components |
| **32:00–38:00** | Scalability & Reliability | Multi-region deployment, cascading cache strategy, circuit breakers per issuer, exam day surge handling. Reference the December 2024 outage as motivation | Scaling strategy with concrete numbers |
| **38:00–42:00** | Security & Compliance | Threat model (SIM swap, issuer compromise, data exfiltration), PKI chain, DPDP Act consent requirements, immutable audit trail | Security posture appropriate for government-grade system |
| **42:00–45:00** | Trade-offs & Extensions | URI reference vs. document copy trade-off, offline mode limitations, eventual vs. strong consistency for consent records | Demonstrate architectural maturity |

---

## Common Interviewer Questions with Strong Answers

### Q1: "Why not just store copies of all documents in the vault?"

**Strong Answer:** "The URI reference model is a deliberate trade-off. With 9.4 billion documents and 550 million users, storing copies would mean ~1.4 PB of document storage that must be kept in sync with 1,900+ issuer systems. When an issuer corrects a document—say, fixing a spelling error in a degree certificate—every copy in every affected vault must be updated. With URI references, the correction is instant because the URI resolves to the current version in the issuer's repository. The vault stores only metadata (~500 bytes per document vs. ~150 KB for a PDF copy), reducing storage by 300×. The trade-off is issuer availability dependency—if an issuer's API is down, citizens can't access those documents. We mitigate this with a three-tier cache (in-memory, distributed, persistent) achieving 85%+ hit rate, circuit breakers per issuer, and graceful degradation that serves cached documents with a 'pending verification' flag. The December 2024 outage was a data center failure, not an issuer availability issue—our multi-region architecture addresses that separately."

### Q2: "How do you handle consent revocation when a requester has already fetched the document?"

**Strong Answer:** "This is the fundamental limitation of any consent-based sharing system—once the requester has the document bytes, we can't un-deliver them. Our system provides three layers of protection: First, the access token is invalidated within 1 second of revocation, preventing further fetches. Second, the immutable audit trail records exactly what was accessed, creating legal evidence if the requester misuses the data. Third, the DPDP Act creates legal obligations for requesters to delete data when consent is withdrawn—our audit trail provides the evidence needed for regulatory enforcement. For sensitive scenarios, we support field-level consent where possible: if a bank only needs income verification, we return only the income field, not the full tax return, limiting the data exposed. In the future, we could explore trusted execution environments where the requester's system can verify document attributes without receiving the full document—but that requires requester-side infrastructure changes."

### Q3: "What happens during an outage? Citizens rely on this for legal documents."

**Strong Answer:** "Legal equivalence makes availability existential for this system—it's not like a social media platform where a few hours of downtime is just inconvenient. Our strategy has three layers: First, the mobile app pre-caches up to 10 'critical documents' on-device with offline verification bundles—PKI verification works offline because the subscriber's app stores the issuer's public key and pre-computed certificate chain. The offline presentation includes a QR code that requesters can verify retroactively when connectivity returns. Second, multi-region active-passive architecture with synchronous replication for consent records and < 15-minute RTO for full service restoration. Third, degraded-mode operation: when an issuer is down, we serve the last cached version with a 'verification pending' flag and the timestamp of last verification. The requester decides if the staleness is acceptable for their use case—a hospital accepting an insurance card might tolerate a 6-hour-old verification, while a property registration might not."

### Q4: "How does PKI verification scale to millions of checks per day?"

**Strong Answer:** "Raw PKI operations are expensive: RSA-2048 signature verification takes ~0.5ms per verification, and a full chain walk with CRL check adds network round-trips. At 8 million verification requests per day (300 peak QPS), doing the full PKI flow on every request would require significant compute. We optimize at three levels: First, verification result caching—once a document's signature is verified, the result is cached with a TTL tied to the CRL update frequency (typically 6 hours). This eliminates 95%+ of redundant PKI operations. Second, CRL pre-fetching: instead of querying OCSP responders on each verification, we periodically download CRLs from all ~20 government CAs and index them locally by certificate serial number, turning revocation checks into sub-millisecond local lookups. Third, certificate chain pre-validation: when an issuer onboards, we validate their full certificate chain once and store the result. During document verification, we only verify the document signature against the already-validated issuer certificate, avoiding the chain walk. The result: the amortized cost of PKI verification drops from ~50ms (full flow) to ~2ms (cached result lookup)."

### Q5: "Walk me through the consent flow end-to-end."

**Strong Answer:** "The flow has two phases—request and fulfillment—designed for different latency profiles. Request phase (async): A bank calls our Consent API specifying the subscriber's identifier, requested document types, stated purpose ('KYC for personal loan'), duration (72 hours), and access count (1). We validate the requester's authorization, check they're allowed to request these document types, and send a push notification to the subscriber's device. The subscriber sees: 'Bank-XYZ requests access to your PAN Card and Income Tax Return for KYC verification. Valid for 72 hours, single access.' The subscriber can modify terms (reduce duration, remove a document) before approving with step-up MFA. Upon approval, we generate a time-bound, scope-limited access token, deliver it to the bank's callback URL, and write an immutable consent record with HMAC signature. Fulfillment phase (sync): The bank calls our Document Fetch API with the consent token. We validate the token across five dimensions—time, revocation, requester match, document scope, and access count—resolve the document URI, verify the signature, and return the document with verification metadata. Each access decrements the count atomically using compare-and-swap to handle concurrent access race conditions. Every event—request, approval, access, expiration—is logged in the immutable audit trail."

---

## Trap Questions and How to Handle Them

### Trap 1: "Can't you just encrypt everything and not worry about authorization?"

**Why it's a trap:** Conflates encryption (data confidentiality) with authorization (access control). A system can be fully encrypted and still have terrible access control.

**Response:** "Encryption protects data at rest and in transit—it ensures that a database breach doesn't expose document content. But encryption doesn't solve the consent problem: the question isn't whether the data is encrypted, it's who gets the decryption key and under what conditions. A requester with a valid consent token gets access to the decrypted document; encryption doesn't help if the consent model is flawed. We need both: AES-256 encryption for all stored data, AND the multi-dimensional consent engine that controls who can decrypt what, for what purpose, for how long. They're orthogonal concerns."

### Trap 2: "Why not use blockchain for the consent trail?"

**Why it's a trap:** Blockchain adds complexity without clear benefit for this use case. The platform is a centralized trust broker—it doesn't have the distributed trust problem that blockchain solves.

**Response:** "The immutability requirement is real—consent records must be tamper-proof for legal compliance. But blockchain solves a specific problem: distributed consensus among mutually distrusting parties. In our system, the platform is the trusted intermediary—both subscribers and requesters trust the platform to maintain consent records honestly. An append-only database with hash-chained entries and HMAC signatures provides the same tamper-evidence guarantee with much better performance: sub-millisecond writes vs. seconds for blockchain consensus. We also need strong consistency for consent records (a revocation must be immediately visible everywhere), which conflicts with blockchain's eventual consistency model. If an interviewer pushes on this, I'd note that blockchain could add value in a federated model where multiple independent vault providers need to share consent state without trusting each other—but that's not the current architecture."

### Trap 3: "With 550 million users, you need a NoSQL database for scale."

**Why it's a trap:** Assumes that scale automatically means NoSQL. The choice depends on data model and access patterns, not just scale.

**Response:** "Scale is a consideration but not the only one. Consent records have strong consistency requirements and relational integrity (consent references subscriber, requester, and document IDs). A partitioned relational database with 256 shards handles our throughput: ~3 million consent operations per day is ~35 QPS per shard—easily within relational DB capabilities. For document metadata, the access pattern is simple key-value-style lookups by subscriber_id, which works well with either relational or document databases. The real scaling challenge isn't the data store—it's the issuer fan-out for URI resolution, which is an HTTP client scaling problem, not a database scaling problem. I'd use relational for consent records (ACID for legal compliance), a document store for flexible document metadata, and object storage for self-uploaded files."

### Trap 4: "How do you guarantee 100% uptime?"

**Response:** "We don't—and no system can. Our SLO is 99.95%, which means we accept ~22 minutes of downtime per month. What we guarantee is graceful degradation: the system is never completely unavailable. If the primary region is down, the secondary takes over (< 15 min RTO). If an issuer is down, we serve cached documents. If the internet is down for the subscriber, the offline mode provides cached documents with offline verification. The question isn't 'can we prevent all outages' but 'can we ensure citizens always have some level of access to their documents.' The December 2024 outage was a lesson: a centralized architecture with no failover turned a power failure into two days of total blackout. Our multi-region design means the blast radius of any single failure is bounded."

---

## Trade-off Discussions

### Trade-off 1: Document Freshness vs. Availability

| Approach | Freshness | Availability | Complexity |
|---|---|---|---|
| **Always fetch from issuer** | Perfect (real-time) | Depends on issuer uptime | Low |
| **Cache with short TTL (5 min)** | Near-real-time | High (cache absorbs outages) | Medium |
| **Cache with long TTL (24 hr)** | Stale by up to 24 hours | Very high | Medium |
| **Our approach: adaptive TTL** | TTL based on document type volatility | High with degradation | Higher |

We use adaptive TTLs: identity documents (rarely change) get 24-hour cache TTL; tax returns (annual) get 1-week TTL; documents marked as "recently updated" by issuers get 5-minute TTL. This optimizes for the common case while maintaining freshness where it matters.

### Trade-off 2: Consent Record Storage Model

| Approach | Consistency | Performance | Auditability |
|---|---|---|---|
| **Mutable records (update in place)** | Simple | Fast reads | No history |
| **Event sourcing (append-only)** | Complex | Slower reads (need replay) | Complete history |
| **Our approach: event log + materialized view** | Complex but correct | Fast reads via view | Complete history in log |

We write every consent event to an append-only log (complete audit trail) and maintain a materialized view of current consent state for fast authorization checks. The materialized view is rebuilt from the event log if ever suspected of corruption.

### Trade-off 3: Offline Mode Scope

| Approach | User Experience | Security Risk | Complexity |
|---|---|---|---|
| **No offline mode** | Useless during outage | Lowest | Lowest |
| **Cache all documents** | Best UX | Highest (device theft exposure) | Medium |
| **Cache selected documents** | Good UX for common cases | Moderate | Higher (selection logic) |
| **Our approach: user-selected critical docs** | Subscriber controls exposure | Moderate, explicit | Medium |

### Trade-off 4: PKI Verification Model

| Approach | Security | Performance | Availability |
|---|---|---|---|
| **Verify every access** | Highest (catches revocations immediately) | Slowest (50ms per verification) | Depends on CRL/OCSP availability |
| **Verify once, cache forever** | Lowest (misses revocations) | Fastest | Highest (no external dependency) |
| **Our approach: verify + cache with CRL-aligned TTL** | High (catches revocations within CRL period) | Fast (2ms amortized via cache) | High (CRL pre-fetched locally) |

The CRL-aligned TTL is the key insight: if the CA publishes CRLs every 6 hours, caching verification results for 6 hours means we'll catch any revocation within one CRL period while reducing PKI operations by 95%.

### Trade-off 5: Offline Mode Trust Boundary

| Aspect | Online Verification | Offline Verification |
|---|---|---|
| **Signature Check** | Real-time against current issuer certificate | Against cached issuer certificate |
| **CRL Check** | Real-time against latest CRL | Cannot check (certificate may have been revoked since last online) |
| **Document Freshness** | Current version from issuer | Snapshot at cache time (may be stale) |
| **Tamper Detection** | Full hash verification against issuer | Local hash check only |
| **Attestation** | Platform provides real-time attestation | Platform attestation at time of caching |

The honest answer for interviewers: offline verification proves the document *was* authentic at time T, not that it *is* authentic now. This is an acceptable trade-off because the alternative (no document at all during outage) is worse for the citizen.

---

## Additional Probing Questions

### Q6: "How do you handle the cold start problem for a new issuer?"

**Strong Answer:** "When a new issuer onboards, they have zero documents in any subscriber's vault cache. If 50,000 students try to access their university certificates on day one, every request is a cache miss that fans out to the issuer's API—essentially a thundering herd on a system that's never been tested at this scale. Our approach: (1) Pre-push coordination: before the issuer goes live, they batch-push all historical document URIs through the Push API, populating the metadata DB and warming L3 persistent cache. (2) Controlled rollout: new issuers start with a subset of document types before full activation. (3) Request coalescing: multiple requests for the same issuer in a short window are coalesced into a single API call. (4) Synthetic load testing: we run load tests against the issuer's API in their sandbox before production activation, establishing baseline latency and capacity."

### Q7: "What happens when the DPDP Act requires you to delete a subscriber's data?"

**Strong Answer:** "Right-to-erasure creates a cascade of data operations. For self-uploaded documents: straightforward—delete from object storage, remove metadata, remove search index entries. For issuer-pushed documents: we delete the URI reference and metadata from the vault, but the document still exists in the issuer's repository—the vault can't delete from issuer systems. For consent records: this is the hard part—DPDP Act requires data deletion, but regulatory compliance requires consent records to be retained for 7 years. The resolution: we pseudonymize the consent record (replace subscriber identifiers with non-reversible hashes) rather than deleting it. The audit trail remains intact for regulatory purposes but can no longer be linked to the individual. For audit logs: same pseudonymization approach. For cache: immediate invalidation across all cache layers."

### Q8: "How would you design this for cross-border interoperability?"

**Strong Answer:** "This is the direction the EU Digital Identity Wallet (eIDAS 2.0) is heading. The challenge is that different countries have different PKI hierarchies, different consent models, and different legal equivalence frameworks. The architectural approach: (1) W3C Verifiable Credentials as the interchange format—self-contained cryptographic proofs that don't depend on access to the issuing country's PKI infrastructure. (2) DID (Decentralized Identifier) resolution for issuer identity across borders. (3) Bilateral trust agreements where each country's root CA is added to the other's trust store. (4) Consent translation layer that maps between different consent frameworks (GDPR consent vs. DPDP Act consent). The key constraint: data sovereignty—document content never leaves national borders. Only verification results and VCs can cross borders."

---

## What Separates Senior from Staff-Level Answers

### Senior-Level Answer Characteristics
- Draws the full architecture with correct component separation
- Explains the URI reference model and why it's better than copying documents
- Designs the consent flow with proper OAuth 2.0 patterns
- Handles PKI verification with caching
- Addresses scaling with standard horizontal scaling patterns

### Staff-Level Answer Characteristics (What Sets You Apart)
- **Explains the legal equivalence constraint** and how it changes the failure mode calculus: this isn't just an availability number, it's a fundamental system constraint that drives offline mode, multi-region deployment, and degraded operation protocols
- **Identifies the consent-as-distributed-transaction problem**: consent isn't a simple permission check—it's a multi-party flow with legal implications, concurrent access race conditions, revocation timing issues, and immutable audit requirements
- **Understands the issuer availability dependency**: the URI model is elegant but creates a distributed system where the vault's SLA depends on the worst-performing issuer. Articulates the circuit breaker, bulkhead, and cache strategy as a cohesive availability pattern, not just individual techniques
- **Discusses the DPDP Act's impact on architecture**: purpose limitation isn't just a checkbox—it requires the consent token to encode the purpose, the audit trail to record it, and the platform to provide evidence for regulatory enforcement. Field-level consent requires issuers to support fine-grained data extraction, creating an API versioning challenge
- **Addresses the exam-day thundering herd**: doesn't just say "scale horizontally" but designs pre-push coordination with issuers, request coalescing for single-issuer hotspots, and progressive notification rollout
- **Brings up the SIM swap attack vector proactively**: demonstrates understanding that national-scale identity systems attract sophisticated attacks; proposes device binding, telecom partnership for SIM change detection, and behavioral anomaly detection
- **Discusses the offline verification trust model**: acknowledges that offline verification cannot check CRL (certificate might have been revoked since last online check) and explains the trust boundary: offline verification proves the document was authentic at time T, not necessarily at the current moment
- **Mentions post-quantum cryptography proactively**: documents signed today must be verifiable for decades; dual-signing strategy (RSA + PQC) is not a future concern but a present architectural requirement

---

## Architectural Decision Justification Cheat Sheet

Use these concise justifications when the interviewer asks "why did you choose X?"

| Decision | One-Sentence Justification |
|---|---|
| **URI references, not copies** | "With 9.4B documents across 550M users, storing copies would require 1.4 PB plus a sync problem across 1,900 issuers; URIs reduce storage 300× and ensure documents are always current." |
| **Synchronous replication for consent** | "Consent revocation is legally binding under DPDP Act—a 500ms replication lag that allows post-revocation access creates the same legal liability as a deliberate violation." |
| **Append-only consent log + materialized view** | "Legal compliance requires complete audit history (append-only log), but authorization checks need sub-millisecond reads (materialized view)—we need both." |
| **Per-issuer circuit breakers + bulkheads** | "1,900 issuers with varying reliability means some issuer is always down; per-issuer isolation prevents a single slow issuer from exhausting the platform's connection pool." |
| **Hash-partitioned by subscriber_id** | "All operations for a subscriber (documents, consent, audit) hit one shard—no cross-shard joins. 256 shards at 2.1M subscribers each keeps per-shard load trivial." |
| **Offline verification bundles** | "Legal equivalence means the platform must provide 'physical document in your pocket' availability; offline bundles are the constitutional backstop." |
| **Device binding over OTP-only** | "The February 2025 SIM swap campaign compromised 38M accounts via OTP interception; device binding makes the device itself a factor independent of the telecom channel." |
| **Adaptive cache TTLs per document type** | "A driving license valid for 20 years needs a different cache strategy than a frequently-updated vehicle registration; one-size-fits-all TTL either wastes bandwidth or serves stale data." |

---

## Common Mistakes to Avoid in the Interview

| Mistake | Why It's Wrong | Correct Approach |
|---|---|---|
| Designing the vault as a simple file storage system | The vault stores mostly references, not files; the hard problem is URI resolution and issuer fan-out, not storage | Start with the URI reference model and explain the distributed system implications |
| Treating consent as a boolean permission | Consent is multi-dimensional (scope, purpose, duration, count, revocation) with legal implications | Design consent as a first-class entity with its own lifecycle, consistency requirements, and audit trail |
| Ignoring the offline mode requirement | The December 2024 outage proved offline access is essential, not optional | Design offline mode as a core architectural capability, not an afterthought |
| Assuming all issuers have reliable APIs | Government IT systems have wildly varying availability (92% to 99.9%) | Design the cache as the primary serving path, not as an optimization layer |
| Using blockchain for the audit trail | The platform is a centralized trust broker; blockchain adds complexity without benefit | Explain that append-only logs with hash chaining provide the same tamper-evidence with better performance |
| Saying "just scale horizontally" for exam days | The Slowest part of the process is the single issuer's API, not the platform's capacity | Propose pre-push coordination, request coalescing, and demand shaping |
| Ignoring post-quantum implications | Documents signed today must be verifiable for decades | Mention dual-signing as a future-proofing strategy |

---

## Quick Whiteboard Sketch Sequence

For a 45-minute interview, here's what should be on the whiteboard at each milestone:

**By minute 10** (Capacity):
```
550M users | 15M DAU | 9.4B docs
45M retrievals/day | 1,500 peak QPS
Read:Write = 50:1 | ~500 TB storage
```

**By minute 20** (Architecture):
```
[Issuers 1,900+] --Push API--> [API Setu] ---> [Vault Service] <--- [Subscribers 550M]
                  <--Pull URI--  [URI Resolver]                       [Mobile/Web/USSD]
[Requesters 2,400+] --Consent--> [Consent Engine] --> [Audit Log]
                                       ↑
                              [Auth Service + MFA]
```

**By minute 32** (Deep Dive):
```
URI Resolution: L1→L2→L3→Issuer (85% cache hit)
Consent: 7 dimensions × immutable log × CAS for access count
Circuit breaker per issuer: CLOSED→OPEN→HALF_OPEN
```

**By minute 42** (Scale + Security):
```
3 regions: Active-Active-DR | RTO < 15 min
Consent: synchronous replication (strong consistency)
SIM swap defense: device binding + telecom partnership
Offline: pre-cached + PKI bundle + QR retroactive verification
```

---

## System Comparison Guide

When the interviewer asks "how is this different from X?", use these comparisons:

| Comparison | Key Difference | Architectural Implication |
|---|---|---|
| **vs. Dropbox/Google Drive** | Vault stores *references*, not files; documents are legally binding, not personal files; trilateral trust model (issuer-subscriber-requester) | URI resolution + PKI verification on every access; consent engine is the core differentiator, not storage |
| **vs. OAuth 2.0 Authorization Server** | Consent is not just an access token—it's a legal record with audit trail; consent has 7 dimensions, not just scope + expiry | Append-only consent log with HMAC + hash chaining; synchronous replication; purpose limitation enforcement |
| **vs. PKI Certificate Authority** | The vault doesn't issue certificates—it *verifies* them at scale (millions/day) against multiple CAs | Verification result caching, CRL pre-fetching, certificate chain pre-validation to amortize PKI cost |
| **vs. eIDAS 2.0 Digital Wallet** | eIDAS uses W3C VCs (self-contained proofs); vault uses URI references (issuer dependency) | eIDAS eliminates issuer availability dependency but requires complete re-architecture of document format |
| **vs. Singapore MyInfo** | MyInfo pre-computes verified attributes; vault resolves on-demand from issuer repositories | MyInfo has larger storage footprint but faster access; vault has smaller footprint but issuer dependency |
| **vs. Blockchain-based document systems** | Vault is centralized trust broker; blockchain solves distributed trust among mutually distrusting parties | Append-only log with hash chaining gives same tamper-evidence; blockchain adds latency without benefit for this trust model |

---

## Deep Dive Selection Strategy

When the interviewer asks you to "pick a component to dive deep on," choose based on the interview signal:

| If Interviewer Seems Interested In... | Choose This Deep Dive | Why |
|---|---|---|
| **Distributed systems** | URI Resolution + Issuer Availability | Showcases circuit breakers, cascading cache, graceful degradation, distributed dependency management |
| **Security** | SIM Swap Defense + Consent Integrity | Demonstrates attack chain analysis, multi-layered defense, zero-trust thinking |
| **Consistency / correctness** | Consent Engine Concurrency | Shows race conditions, CAS operations, two-phase verification, strong consistency trade-offs |
| **Scale / performance** | PKI Verification at Scale + Exam Day Thundering Herd | Demonstrates amortized cost analysis, hotspot management, pre-push coordination |
| **Legal / compliance** | DPDP Act + Legal Equivalence | Shows regulatory-driven architecture, consent as legal artifact, offline mode as constitutional obligation |
| **AI / ML** | OCR Pipeline + Fraud Detection | Demonstrates confidence-aware systems, multi-script challenges, cross-validation pipelines |

---

## Red Flags That Indicate a Weak Answer

| Red Flag | What It Signals | Better Approach |
|---|---|---|
| "Just use a CDN for document delivery" | Misunderstands that documents are dynamic (URI-resolved, consent-scoped) not static | Explain the URI resolution path and why document delivery depends on issuer availability |
| "Use Kafka for the consent log" | Over-engineers with distributed messaging when an append-only DB with hash chaining suffices | Explain that the consent log needs strong consistency, not high-throughput messaging |
| "Encrypt everything with AES-256" | Confuses encryption with authorization | Clarify that encryption protects at-rest data; consent engine controls who gets the decryption key |
| "99.999% availability" | Unrealistic for a system depending on 1,900+ external issuers | Be honest about 99.95% SLO with graceful degradation and offline mode |
| No mention of offline mode | Misses the core requirement driven by legal equivalence | Proactively bring up offline mode as the reliability backstop |
| "Shard by document type" | Creates cross-shard joins for subscriber vault operations | Explain that subscriber_id partitioning ensures all subscriber operations hit one shard |

---

## Extension Topics (If Time Remains)

If the interviewer asks "what would you add next?" or "how would you evolve this system?", here are strong extension topics:

### Extension 1: Verifiable Credentials Migration
"The current URI reference model creates an issuer availability dependency. W3C Verifiable Credentials embed the cryptographic proof directly in the document, eliminating the need to contact the issuer for verification. This enables true offline verification and cross-border interoperability with EU Digital Identity Wallets. The migration challenge: dual-format support during transition, DID infrastructure for issuer identity, and re-issuing existing documents as VCs."

### Extension 2: Zero-Knowledge Proofs for Selective Disclosure
"Instead of sharing the full tax return for income verification, the subscriber could prove 'my income exceeds ₹5 lakhs' without revealing the exact amount. ZKPs on Verifiable Credentials enable attribute-level proofs without document sharing. The architectural impact: proof generation on the subscriber's device, verification at the requester, and no document content ever leaves the subscriber's control."

### Extension 3: AI-Powered Predictive Document Preparation
"When a subscriber starts a loan application on a bank's website, the platform could predict which documents will be needed (PAN, ITR, address proof) and pre-fetch them into cache, pre-generate offline bundles, and pre-draft the consent screen—reducing the end-to-end consent flow from 30 seconds to 5 seconds. This requires integration with requester applications to receive context signals."

### Extension 4: Federated Vault Architecture
"Instead of a single centralized platform, multiple vault providers (government, private sector) could operate independently but share a consent protocol and verification standard. This eliminates the single-point-of-failure risk demonstrated by the December 2024 outage. The challenge: distributed consent state management across independent providers—this is where blockchain-style consensus might actually be useful."

### Extension 5: Post-Quantum PKI Migration
"Documents signed today with RSA-2048 must be verifiable in 2065. Quantum computers expected by 2035 could forge these signatures retroactively. We need dual-signing now: every new document carries both RSA-2048 and CRYSTALS-Dilithium signatures. For the 9.4 billion existing documents, we create timestamped platform attestations: 'we verified this RSA signature at time T when RSA was still secure,' signed with PQC. This is not a future concern—it's a present requirement for any system where signed documents outlive the signing algorithm's security guarantees."

---

## Five-Minute "Elevator Pitch" Version

If you only have 5 minutes to explain the system (e.g., follow-up question in a behavioral interview):

"This is a national-scale digital document vault serving 550 million citizens. The unique architectural challenge is the trilateral trust model: 1,900 government issuers push digitally signed documents into citizens' vaults, and 2,400 requesters can access them with citizen consent. The key design decision is that the vault stores URI references, not document copies—documents are fetched from issuers on demand and verified via PKI. This eliminates storage duplication but creates an issuer availability dependency that we handle with a three-tier cache serving 85% of reads. Consent is the hardest part—it's a legally binding record under the DPDP Act requiring synchronous cross-region replication and immutable audit trails. The system must handle extreme surge events (22× traffic during exam results) and provide offline access via pre-cached documents with PKI verification bundles, because legal equivalence means an outage directly blocks citizens from exercising legal rights."
