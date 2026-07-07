# Interview Guide — Package Registry

## 1. Interview Pacing (45-Minute Format)

| Phase | Duration | Focus | Deliverables |
|---|---|---|---|
| **Requirements** | 5 min | Clarify scope: single ecosystem or multi? Scale? Security posture? | FR list, NFR priorities, scale numbers |
| **High-Level Design** | 10 min | Metadata-artifact split, CDN-first architecture, publish/install flows | Architecture diagram, data flow |
| **Deep Dive: Immutability & Storage** | 8 min | Content-addressable blob storage, version uniqueness, CDN caching strategy | Storage architecture, caching model |
| **Deep Dive: Security Pipeline** | 8 min | Scan pipeline, typosquatting detection, provenance, dependency confusion | Security architecture, threat model |
| **Dependency Resolution** | 7 min | NP-completeness, SAT solving / PubGrub, resolution performance | Algorithm sketch, complexity discussion |
| **Scale & Reliability** | 5 min | CDN economics, hot package mitigation, origin failover | Scaling strategy, failure modes |
| **Wrap-Up** | 2 min | Trade-offs summary, questions for interviewer | Clear articulation of design decisions |

### Phase-by-Phase Strategy

**Requirements phase (5 min):** Open by establishing the two fundamental properties that define a package registry: **immutability** (published versions never change) and **supply chain trust** (the registry is the root of trust for all downstream software). Then ask clarifying questions:

- Single ecosystem (npm-style) or multi-ecosystem (supporting multiple languages)?
- What's the expected scale? Millions of packages? Billions of downloads/month?
- Is this a public open registry or a private enterprise registry?
- How critical is security scanning? Just malware, or also supply chain provenance?
- Do we need dependency resolution on the server side, or is that client-side?

Establish scale: 3M packages, 50M versions, 200B downloads/month, 50K publishes/day.

**High-level design (10 min):** Draw the metadata-artifact split architecture immediately—this is the single most important architectural decision. Name the key components:

1. **CDN / Edge Layer** — serves 98%+ of download traffic, global PoPs
2. **Download API** — metadata and artifact serving (CDN origin)
3. **Publish API** — authenticated write path with validation pipeline
4. **Blob Storage** — content-addressed, immutable artifact storage
5. **Metadata Store** — packages, versions, dependencies, users (relational DB)
6. **Security Pipeline** — async scanning: malware, typosquatting, provenance verification
7. **Search Service** — full-text search with popularity-weighted ranking
8. **Transparency Log** — append-only cryptographic log of all publish events

Show both flows: **Publish** (author → auth → validate → store blob → write metadata → enqueue scan → respond) and **Install** (client → CDN → metadata fetch → resolve deps → download artifacts → verify integrity).

**Deep dive: Immutability & Storage (8 min):** This is where you demonstrate systems depth. Explain:

- **Content-addressable storage**: artifacts keyed by SHA-512 hash, enabling deduplication, tamper detection, and infinite CDN TTL
- **Version uniqueness**: database-level unique constraint on `(package_name, version)`, enforced transactionally
- **Unpublish policy**: time-bounded window (≤72h, zero dependents), never allowed for adopted packages — explain why
- **CDN caching model**: artifacts get `Cache-Control: immutable` (infinite TTL), metadata gets 5-minute TTL with `stale-while-revalidate`
- **Integrity verification**: every client verifies SHA-512 hash against lockfile/metadata on every install

**Deep dive: Security Pipeline (8 min):** Supply chain security is the differentiating concern. Cover:

- **Async scanning**: non-blocking publish → scan → quarantine-on-detection
- **Typosquatting detection**: edit distance, keyboard adjacency, homoglyph comparison against top 50K packages
- **Dependency confusion**: scoped namespaces prevent public/private name collision
- **Sigstore/provenance**: keyless signing via OIDC, transparency log, SLSA attestation
- **Malware scanning**: install script analysis, behavioral sandbox, YARA signatures

**Dependency resolution (7 min):** Show you understand this is an NP-complete problem:

- The problem is reducible to 3-SAT (proven in 2005)
- Production resolvers use CDCL (conflict-driven clause learning) or PubGrub
- PubGrub advantage: human-readable error messages when resolution fails
- Real-world optimization: version ordering heuristics, metadata prefetching, partial solution caching
- Lockfiles bypass resolution entirely (just verify + download)

**Scale & reliability (5 min):** Focus on CDN economics:

- 30 PB/month bandwidth cannot be served from origin
- CDN absorbs 98%+ of traffic; origin handles only 600 TB/month
- Origin shield pattern prevents cache stampede
- Hot package preloading (top 300 packages pushed to all PoPs)
- CDN-as-bunker: during origin outage, CDN serves cached content with stale headers

---

## 2. Meta-Commentary

### What Makes This System Unique in Interviews

**1. Immutability is the architectural foundation, not an afterthought.** Most systems use mutable data as the default. A package registry inverts this: published artifact bytes are permanently immutable. This single property enables content-addressable storage, infinite CDN TTL, lockfile reproducibility, and supply chain integrity. When the interviewer asks about updates, the answer is "you don't update; you publish a new version."

**2. The security model protects the ecosystem, not just the system.** Unlike most systems where security protects the system from users, a package registry must protect all users from each other. A single malicious package can compromise millions of downstream applications. This makes supply chain security (typosquatting, dependency confusion, provenance) a first-order architectural concern, not a feature.

**3. Download scale dwarfs most systems candidates have encountered.** 200B downloads/month puts this in the top tier of internet-scale systems. The interviewer wants to see that you recognize CDN is not optional—it's the primary serving infrastructure. Origin servers are just the "system of record" that CDN falls back to.

**4. Dependency resolution is a genuine computer science problem.** Most system design interviews focus on distributed systems. This question uniquely tests algorithmic knowledge: NP-completeness, SAT solving, constraint satisfaction. Candidates who can discuss PubGrub, CDCL, and version constraint algebra stand out.

---

## 3. Trade-offs Discussion

| Trade-off | Option A | Option B | Discussion Points |
|---|---|---|---|
| **Immutability vs Unpublish** | Never allow unpublish (Maven model) | Time-bounded unpublish (npm model) | Maven prioritizes ecosystem stability; npm balances with author control. Discuss the `left-pad` incident (2016): single unpublish broke thousands of builds. |
| **Blocking vs Async Scan** | Block publish until scan completes | Publish immediately, scan async | Blocking adds 30s-5min latency to every publish. Async has a ~10min malware exposure window. Which risk is worse? |
| **Client-side vs Server-side Resolution** | Resolver runs in client (npm, cargo) | Resolver runs on server | Client-side: no server compute cost, works offline. Server-side: can cache resolution results, ensures reproducibility across clients. |
| **Flat vs Scoped Namespaces** | Flat namespace (`lodash`) | Scoped (`@org/lodash`) | Flat: simpler, short names, but enables dependency confusion. Scoped: verbose, but prevents namespace attacks. npm uses both. |
| **CDN Freshness vs Latency** | Short TTL (1 min) — always fresh | Long TTL (1 hour) — always fast | Artifacts are immutable → infinite TTL. Metadata needs balance: 5-min TTL + stale-while-revalidate is the standard approach. |
| **Per-version vs Per-package Security** | Scan every version independently | Scan package holistically (diff-based) | Per-version is thorough but expensive. Diff-based is faster for patch releases but might miss cross-version attacks. |

---

## 4. Trap Questions

| Trap | Why It's a Trap | Strong Answer |
|---|---|---|
| **"How would you handle a package update?"** | There are no updates. Artifacts are immutable. | "Published versions are immutable. To change code, you publish a new version. The old version remains available forever. This is a fundamental design constraint, not a limitation—it enables content-addressable storage, CDN caching, and lockfile reproducibility." |
| **"Can't you just use a relational database for everything?"** | Conflates metadata (relational) with artifacts (blob storage) | "Metadata (packages, versions, dependencies) goes in a relational DB for transactional integrity. Artifacts (tarballs) go in content-addressed blob storage for immutability and deduplication. Serving 200B downloads/month requires CDN, not database queries." |
| **"Just use greedy resolution—pick the latest version"** | Ignores that dependency resolution is NP-complete | "Greedy resolution fails on diamond dependency conflicts where two packages require incompatible versions of a shared dependency. Real resolvers use SAT-solving techniques (PubGrub, CDCL) with backtracking and conflict learning." |
| **"Why not scan before publishing?"** | Sounds safer but has massive UX cost | "Blocking scans add 30s-5min to every publish. 99.9%+ of publishes are legitimate. The async approach limits malware exposure to ~10 minutes while keeping publish instant. Critical-path scanning would slow the entire ecosystem." |
| **"How would you delete a malicious package?"** | Tests understanding of immutability trade-offs | "We quarantine, not delete. The version is marked as quarantined in metadata, removed from resolution candidates, and CDN cache is purged. The artifact blob may be retained for forensic analysis. Dependents are notified. We never silently delete—that breaks lockfiles." |
| **"Why not store everything in the CDN?"** | CDN is a cache, not a database | "CDN caches content but doesn't guarantee persistence. CDN PoPs evict content under storage pressure. The blob storage is the source of truth with multi-region replication and 11-nines durability. CDN is a serving optimization, not a storage solution." |
| **"How do you handle circular dependencies?"** | Tests understanding of dependency graph constraints | "Most ecosystems explicitly forbid circular dependencies (directed acyclic graph requirement). The publish validator rejects packages that would create cycles. In ecosystems that allow them (rare), the resolver must detect cycles and either break them deterministically or report an error." |

---

## 5. Common Mistakes

| Mistake | Why It's Wrong | What to Do Instead |
|---|---|---|
| **Ignoring CDN** | Origin cannot serve 200B downloads/month | Make CDN the primary serving layer from the start; design origin as fallback |
| **Mutable artifacts** | Breaks lockfile reproducibility, CDN caching, supply chain trust | Enforce immutability as a hard architectural constraint |
| **Skipping security scanning** | Supply chain security is THE differentiating concern for package registries | Discuss the async scan pipeline, typosquatting, dependency confusion, provenance |
| **Treating resolution as trivial** | Dependency resolution is NP-complete | Acknowledge the complexity; discuss SAT solving or PubGrub; cover error messages |
| **No content addressing** | Loses deduplication, tamper detection, and CDN optimization | Key artifacts by cryptographic hash (SHA-512) |
| **Synchronous download counting** | Can't do atomic increment at 150K RPS | Use in-memory batching with periodic flush to time-series store |
| **Flat namespace only** | Enables dependency confusion attacks | Support scoped namespaces (@org/pkg) for organizational ownership |
| **No transparency log** | No way to audit or detect unauthorized publishes | Append-only Merkle tree log for all publish events |

---

## 6. Questions to Ask the Interviewer

These questions demonstrate depth and clarify scope:

1. **"Should we support a single ecosystem (npm-style) or multiple package formats?"** — Determines data model complexity and whether the manifest schema is fixed or extensible.

2. **"Is server-side dependency resolution required, or do clients resolve locally?"** — Major architectural difference: server-side requires maintaining resolution state; client-side pushes compute to the edge.

3. **"What's the unpublish policy?"** — Tests whether the interviewer wants Maven-style (never unpublish) or npm-style (time-bounded window). Each has dramatically different implications for immutability guarantees.

4. **"Are we designing the public registry or also supporting private registries/mirrors?"** — If private registries are in scope, need to design a mirroring protocol and handle dependency confusion across public/private boundaries.

5. **"How important is provenance attestation? Is this a post-2024 security-conscious design?"** — Signals awareness of SLSA, Sigstore, and modern supply chain security practices.

6. **"Should we discuss the CDN contract details, or can we assume a CDN exists as a black box?"** — Clarifies whether the interviewer wants depth on CDN edge caching, origin shields, and cache invalidation.

---

## 7. Scoring Rubric (What Interviewers Look For)

| Signal | Junior | Mid-Level | Senior/Staff |
|---|---|---|---|
| **Architecture** | "Upload files and serve them" | Metadata-artifact split, basic CDN | Content-addressed storage, CDN tiers, origin shield, metadata materialization |
| **Immutability** | Not mentioned | "Versions can't be changed" | Explains why immutability enables CDN, lockfiles, integrity verification, and trust |
| **Security** | "We'll scan for viruses" | Discusses malware scanning | Full supply chain security: provenance, typosquatting, dependency confusion, Sigstore, transparency log |
| **Resolution** | "Pick the latest version" | Acknowledges version constraints | Discusses NP-completeness, PubGrub/CDCL, conflict-driven learning, error messages |
| **Scale** | Single server | "We need a CDN" | CDN economics (30 PB/month), hot package mitigation, origin shield, stale-while-revalidate, download counter batching |
| **Trade-offs** | No trade-off discussion | 1-2 trade-offs mentioned | Immutability vs unpublish, blocking vs async scan, client vs server resolution, flat vs scoped namespaces |

---

## 8. Whiteboard Walkthrough

### Step-by-Step Diagram Sequence

**Minute 5-7: Initial Architecture Sketch**

Draw the metadata-artifact split as two separate columns:

```
[Client / CLI] → [CDN Edge] → [Origin API]
                                    ├── [Metadata DB] (small, mutable, short TTL)
                                    └── [Blob Storage] (large, immutable, infinite TTL)
```

Narrate: "The single most important architectural decision is separating metadata from artifacts. They have fundamentally different properties—metadata is small and mutable, artifacts are large and immutable—so they need different storage, caching, and replication strategies."

**Minute 7-10: Expand with Publish and Install Flows**

Add the publish path (left side) and install path (right side):

```
PUBLISH:                             INSTALL:
Author → Auth → Validate             Client → CDN Edge
           → Store Blob                  → (hit) Serve cached
           → Write Metadata              → (miss) Origin → Blob Storage
           → Enqueue Scan
           → Respond
```

Narrate: "Publish is synchronous through blob storage and metadata write, then async for security scanning. Install is CDN-first—98%+ of traffic never reaches origin."

**Minute 10-15: Add Security Pipeline**

Draw the async scanning pipeline branching off publish:

```
Publish → Scan Queue → [Malware Scanner]
                     → [Typosquat Scorer]
                     → [Provenance Verifier]
                     → [SBOM Generator]
                           → Verdict Engine → Clean / Quarantine / Review
```

Narrate: "Security scanning is non-blocking. The package is available immediately after publish, but if scanning detects malware, it's quarantined retroactively within 5-10 minutes."

---

## 9. Advanced Discussion Points

### For Staff/Principal-Level Interviews

| Topic | What to Discuss | Why It Impresses |
|---|---|---|
| **Ecosystem governance** | Who decides unpublish policy? How do you balance author rights vs ecosystem stability? The `left-pad` incident broke thousands of builds. | Shows product thinking beyond pure systems |
| **Registry as critical infrastructure** | Single point of failure for the entire language ecosystem. How do you ensure the registry itself isn't compromised? | Shows threat modeling at organizational level |
| **Economics of free downloads** | 30 PB/month bandwidth isn't free. Sponsorship model, rate limiting for commercial users, tiered SLAs. | Shows business awareness |
| **Migration path** | How would you migrate from flat namespace to scoped namespace without breaking existing packages? | Shows incremental evolution thinking |
| **Multi-registry federation** | How should private registries interact with the public registry? Scope-based routing, dependency confusion prevention. | Shows enterprise architecture awareness |
| **Transparency vs privacy** | Download stats are public (useful for ecosystem health) but reveal which companies use which packages (competitive intel). | Shows privacy/security trade-off awareness |

### Case Study Discussion: The xz-utils Backdoor (2024)

A sophisticated multi-year supply chain attack where a malicious contributor gained trust as a maintainer, then inserted a backdoor into a critical compression library. Discuss:

1. **Why automated scanning failed**: The backdoor was introduced across multiple innocent-looking commits, not in a single malicious publish. Individual changes passed review.
2. **Social engineering vector**: The attacker built trust over years of legitimate contributions before inserting malicious code—no technical control detects this.
3. **Detection**: Discovered by a developer who noticed unusual SSH performance degradation, not by automated scanning.
4. **Architectural lessons**: (a) Provenance attestation alone doesn't help if the trusted maintainer is the attacker. (b) Behavioral monitoring (post-install system call tracing) may catch what static analysis misses. (c) Critical package designation with enhanced review requirements for deep-infrastructure packages.
5. **Registry response options**: Mandatory multi-maintainer approval for critical packages, time-delayed publishing for new maintainer contributions, community watchdog programs.

---

## 10. Estimation Practice

### Quick Estimation Exercise

**Question:** "How much storage do we need for all package metadata?"

**Walkthrough:**
- 3M packages × ~17 versions each = ~50M version records
- Each version record: version string, dependency list, integrity hash, timestamps ≈ 2 KB
- 50M × 2 KB = 100 GB for version records
- Package-level metadata (README, description, keywords, all versions aggregated): 3M × 50 KB = 150 GB
- Search index: 3M × 5 KB = 15 GB
- Total metadata: ~265 GB — fits comfortably on a single modern database server

**Question:** "What's the CDN bandwidth bill?"

**Walkthrough:**
- 200B downloads/month × 150 KB average = 30 PB/month
- CDN bandwidth pricing varies: ~$0.01-0.04/GB at scale
- 30 PB = 30,000 TB
- At $0.02/GB: 30,000,000 GB × $0.02 = $600,000/month
- With committed-use discounts: ~$200-300K/month
- This is the single largest infrastructure cost for a package registry

---

## 11. Technology Awareness Signals

Mentioning these demonstrates up-to-date industry knowledge:

| Signal | What It Shows |
|---|---|
| **PubGrub algorithm** | You know the state-of-the-art in dependency resolution (used by Dart, Rust, and newer Python resolvers) |
| **Sigstore / Fulcio / Rekor** | You're aware of modern keyless signing and transparency logs |
| **SLSA framework (levels 1-4)** | You understand build provenance and supply chain integrity levels |
| **npm provenance** | You know npm ships provenance attestation linked to GitHub Actions builds |
| **PyPI Trusted Publishers** | You know PyPI uses OIDC for CI/CD-based publishing without long-lived tokens |
| **Cargo sparse index** | You know crates.io replaced git-clone-based index with HTTP-based sparse protocol for faster resolution |
| **The Update Framework (TUF)** | You know the framework for secure software update systems (used by PyPI, Rust) |
| **xz-utils incident (2024)** | You're aware of the most sophisticated supply chain attack and its implications for maintainer trust |
| **OpenSSF Scorecard** | You know about automated security health assessment for open source projects |
| **Socket.dev** | You're aware of behavioral analysis tools that detect malicious packages by what they do, not what they look like |

---

## 12. Red Flags to Avoid

| Red Flag | Why It's Bad | What to Say Instead |
|---|---|---|
| **"We can just store packages in a database"** | Conflates metadata with artifacts; 8 TB of blobs don't belong in a relational DB | "Metadata in a relational DB; artifacts in content-addressed blob storage" |
| **"Scan every package synchronously before publish"** | Shows no understanding of the UX vs security trade-off at scale | "Async scanning with retroactive quarantine; <10 min exposure window" |
| **"Use a UUID for each artifact"** | Misses the key insight of content-addressable storage | "Key artifacts by SHA-512 hash for dedup, tamper detection, and CDN cacheability" |
| **"Allow version overwrites for bug fixes"** | Violates the core immutability Rule that never changes | "Publish a new version; old version remains immutable for lockfile reproducibility" |
| **"Let's build our own CDN"** | Unrealistic; even major tech companies use third-party CDNs for this | "Use a CDN provider; focus architecture on origin + cache strategy" |
| **"Just check package names for exact matches"** | Misses typosquatting entirely | "Use edit distance, keyboard adjacency, and homoglyph detection against popular packages" |
| **"We don't need a transparency log"** | Misses a major modern supply chain security primitive | "Transparency log enables third-party audit and makes registry compromise detectable" |

---

## 13. Quick Reference: Key Numbers

Keep these numbers in mind for estimation discussions:

| Metric | Value | Context |
|---|---|---|
| Total packages | 3M+ | npm is ~2.5M, PyPI ~500K, crates.io ~150K |
| Monthly downloads | 200B+ | npm alone; other registries are 10-100× smaller |
| Peak RPS | 150K+ | Downloads; metadata fetches are 5-10× this |
| CDN hit rate | 98%+ | Artifacts: near 100%; metadata: ~95% |
| CDN bandwidth/month | 30 PB | Single largest infrastructure cost |
| Average package size | 150 KB | Varies: 10 KB (micro-lib) to 50 MB (bundled) |
| Publish latency target | P99 < 10s | Including validation, blob store, metadata commit |
| Scan completion target | 99% < 10 min | From publish to verdict |
| Dependency tree depth | 12+ average | Modern JS/TS projects |
| Typical transitive deps | 500-1500 | React app: ~1200; Express server: ~300 |
