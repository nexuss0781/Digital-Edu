# Deep Dive & Bottlenecks — Package Registry

## Deep Dive 1: Dependency Resolution Engine

### The Fundamental Challenge

Dependency resolution is the problem of finding a set of package versions that satisfies all version constraints in a transitive dependency graph. This problem is provably NP-complete—formally equivalent to Boolean satisfiability (3-SAT). A modern project like a React application can have 1,500+ transitive dependencies with complex version constraints, and the resolver must find a compatible set or explain why no solution exists.

### Why Greedy Resolution Fails

A naive greedy algorithm (pick the latest version of each package) fails on diamond dependency conflicts:

```
Root depends on:
  pkg-A: ^2.0.0
  pkg-B: ^1.0.0

pkg-A@2.3.0 depends on:
  pkg-C: ^3.0.0

pkg-B@1.5.0 depends on:
  pkg-C: ^2.0.0        ← conflict! ^3.0.0 and ^2.0.0 have no intersection
```

A greedy resolver picks `pkg-A@2.3.0` and `pkg-B@1.5.0` (latest of each), then discovers that their `pkg-C` requirements are incompatible. The correct solution requires backtracking: try `pkg-A@2.2.0` which depends on `pkg-C: ^2.5.0`, compatible with `pkg-B`'s constraint.

### Production Resolution: PubGrub with CDCL

Production resolvers combine ideas from SAT solving (CDCL — Conflict-Driven Clause Learning) with domain-specific optimizations:

**Unit Propagation:** When a package has only one possible version (given current constraints), assign it immediately without decision.

**Conflict Analysis:** When a conflict is detected, analyze the root cause and learn a new incompatibility that prevents the same conflict in future branches. This is analogous to clause learning in CDCL SAT solvers.

**Non-Chronological Backjumping:** Instead of backtracking to the most recent decision, jump back to the decision that caused the conflict. If `pkg-C`'s conflict is caused by `pkg-A@2.3.0`, backjump to the `pkg-A` decision even if many other packages were decided after it.

**Version Ordering Practical rule of thumb:** Try versions in descending order (prefer latest), but prefer versions that minimize the number of new constraints introduced. This Practical rule of thumb resolves most real-world cases without backtracking.

**Resolution Complexity in Practice:**

| Scenario | Typical Resolution Time | Why |
|---|---|---|
| Lockfile present (all pinned) | < 100ms | No resolution needed, just verify |
| Fresh install, well-constrained | 200ms - 1s | Few conflicts, minimal backtracking |
| Version update with conflicts | 1s - 5s | Backtracking through version combinations |
| Pathological constraints | 5s - 30s | Deep diamond conflicts, many candidates |
| Truly unsatisfiable | 1s - 10s | Conflict analysis terminates early |

### Performance Optimizations

**Metadata Prefetching:** The resolver predicts which packages will be needed (based on the dependency graph shape) and prefetches metadata in parallel. A batch metadata API (`POST /metadata/batch`) reduces round trips from O(n) to O(depth).

**Version Candidate Caching:** Cache the sorted list of versions satisfying a constraint. Since constraints are repeated across projects (`^1.0.0` for a popular package), the cache hit rate is high.

**Partial Solution Caching:** If a subtree of the dependency graph was resolved successfully, cache that partial solution. Many projects share common sub-dependency trees (e.g., the `typescript` ecosystem).

**Constraint Simplification:** Before resolution, simplify overlapping constraints. If root requires `^1.0.0` and a dependency requires `>=1.2.0 <2.0.0`, the effective constraint is `>=1.2.0 <2.0.0`.

---

## Deep Dive 2: Security Scanning Pipeline

### Pipeline Architecture

```mermaid
flowchart TB
    subgraph Ingestion["Scan Ingestion"]
        PUBLISH["Version Published"]
        QUEUE["Scan Queue"]
        ROUTER["Scan Router"]
    end

    subgraph Scanners["Parallel Scanners"]
        direction LR
        subgraph Static["Static Analysis"]
            SA1["Manifest Analyzer"]
            SA2["Install Script Detector"]
            SA3["Obfuscation Detector"]
        end

        subgraph Malware["Malware Detection"]
            MW1["Signature Matching"]
            MW2["Behavioral Heuristics"]
            MW3["Yara Rules"]
        end

        subgraph Supply["Supply Chain"]
            SC1["Typosquatting Scorer"]
            SC2["Dependency Confusion<br/>Detector"]
            SC3["Maintainer Anomaly<br/>Detector"]
        end

        subgraph Compliance["Compliance"]
            CL1["License Scanner"]
            CL2["SBOM Generator"]
            CL3["Provenance Verifier"]
        end
    end

    subgraph Verdict["Verdict Engine"]
        AGG["Result Aggregator"]
        POLICY["Policy Engine"]
        DECISION{"Verdict"}
        CLEAN["Mark Clean"]
        QUARANTINE["Quarantine"]
        REVIEW["Manual Review Queue"]
    end

    PUBLISH --> QUEUE
    QUEUE --> ROUTER

    ROUTER --> SA1
    ROUTER --> SA2
    ROUTER --> SA3
    ROUTER --> MW1
    ROUTER --> MW2
    ROUTER --> MW3
    ROUTER --> SC1
    ROUTER --> SC2
    ROUTER --> SC3
    ROUTER --> CL1
    ROUTER --> CL2
    ROUTER --> CL3

    SA1 --> AGG
    SA2 --> AGG
    SA3 --> AGG
    MW1 --> AGG
    MW2 --> AGG
    MW3 --> AGG
    SC1 --> AGG
    SC2 --> AGG
    SC3 --> AGG
    CL1 --> AGG
    CL2 --> AGG
    CL3 --> AGG

    AGG --> POLICY
    POLICY --> DECISION
    DECISION -->|clean| CLEAN
    DECISION -->|malicious| QUARANTINE
    DECISION -->|uncertain| REVIEW

    classDef ingest fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef scanner fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef verdict fill:#fff3e0,stroke:#e65100,stroke-width:2px

    class PUBLISH,QUEUE,ROUTER ingest
    class SA1,SA2,SA3,MW1,MW2,MW3,SC1,SC2,SC3,CL1,CL2,CL3 scanner
    class AGG,POLICY,DECISION,CLEAN,QUARANTINE,REVIEW verdict
```

### Scanner Details

**1. Install Script Detection**

Pre-install and post-install scripts are the primary vector for malicious packages. The scanner extracts and analyzes lifecycle scripts:

```
FUNCTION detect_suspicious_install_scripts(manifest, archive_files):
    scripts = manifest.get("scripts", {})
    risk_score = 0.0
    findings = []

    // Check for lifecycle scripts
    FOR EACH hook IN ["preinstall", "postinstall", "preuninstall"]:
        IF hook IN scripts:
            script_content = scripts[hook]
            risk_score += 0.3  // Lifecycle scripts are inherently suspicious

            // Check for network calls
            IF contains_network_patterns(script_content):
                risk_score += 0.4
                findings.append("Network call in " + hook)

            // Check for file system writes outside package dir
            IF contains_external_fs_writes(script_content):
                risk_score += 0.3
                findings.append("External FS write in " + hook)

            // Check for encoded/obfuscated content
            IF contains_obfuscated_content(script_content):
                risk_score += 0.5
                findings.append("Obfuscated code in " + hook)

            // Check for environment variable exfiltration
            IF contains_env_access(script_content):
                risk_score += 0.3
                findings.append("Env var access in " + hook)

    RETURN { score: MIN(risk_score, 1.0), findings: findings }
```

**2. Typosquatting Scorer**

Compares new package names against popular packages using multiple distance metrics:

```
FUNCTION score_typosquatting_risk(new_name, popular_packages):
    best_match = NULL
    max_similarity = 0.0

    FOR EACH popular IN popular_packages:
        // Levenshtein distance (character edits)
        lev_distance = levenshtein(new_name, popular.name)
        lev_similarity = 1.0 - (lev_distance / MAX(len(new_name), len(popular.name)))

        // Keyboard adjacency distance (for fat-finger typos)
        keyboard_sim = keyboard_adjacency_similarity(new_name, popular.name)

        // Homoglyph detection (l vs 1, O vs 0, rn vs m)
        homoglyph_sim = homoglyph_similarity(new_name, popular.name)

        // Combined score, weighted by target package popularity
        popularity_weight = LOG10(popular.weekly_downloads + 1) / 10.0
        combined = MAX(lev_similarity, keyboard_sim, homoglyph_sim) * popularity_weight

        IF combined > max_similarity:
            max_similarity = combined
            best_match = popular

    // High similarity to a popular package = high risk
    RETURN {
        risk_score: max_similarity,
        similar_to: best_match.name IF max_similarity > 0.8 ELSE NULL,
        download_ratio: new_publisher_downloads / best_match.weekly_downloads
    }
```

**3. Dependency Confusion Detector**

Detects packages that share names with known private package scopes:

```
FUNCTION detect_dependency_confusion(package_name, publisher):
    // Check if an unscoped name matches known private packages
    IF NOT is_scoped(package_name):
        // Query private registry feeds that have reported their namespace
        private_matches = query_private_namespace_registry(package_name)

        IF private_matches IS NOT EMPTY:
            // Check if publisher is associated with any matching org
            FOR EACH match IN private_matches:
                IF publisher NOT IN match.organization.members:
                    RETURN {
                        risk: "HIGH",
                        reason: "Unscoped package name matches private package in " +
                                match.organization.name,
                        mitigation: "Use scoped name @" + match.organization.scope +
                                    "/" + package_name
                    }

    RETURN { risk: "NONE" }
```

### Verdict Aggregation

```
FUNCTION aggregate_scan_verdict(scan_results):
    // Any single critical finding triggers quarantine
    IF any(r.score > 0.9 AND r.type IN ["malware", "install_script"]):
        RETURN "QUARANTINE"

    // Multiple medium findings trigger manual review
    medium_findings = count(r FOR r IN scan_results IF r.score > 0.5)
    IF medium_findings >= 3:
        RETURN "MANUAL_REVIEW"

    // Typosquatting of very popular packages triggers review
    IF any(r.type == "typosquatting" AND r.similar_to.weekly_downloads > 1_000_000
           AND r.score > 0.85):
        RETURN "MANUAL_REVIEW"

    RETURN "CLEAN"
```

---

## Deep Dive 3: CDN Download Serving at Scale

### The Scale Challenge

Serving 200B+ downloads per month (150K peak RPS, ~180 Gbps peak bandwidth) requires a CDN-first architecture where the origin servers handle less than 2% of total traffic.

### CDN Caching Strategy

| Content Type | Cache Key | TTL | Invalidation |
|---|---|---|---|
| Artifact tarball | `/artifacts/{sha512}.tgz` | Infinite (immutable) | Never (content-addressed) |
| Package metadata | `/{scope}/{name}` | 5 minutes | On publish (purge) |
| Abbreviated metadata | `/{scope}/{name}` + `Accept: application/vnd.npm.install-v1+json` | 5 minutes | On publish (purge) |
| Search results | `/search?q={query}&page={page}` | 60 seconds | TTL-based only |
| Download counts | `/{scope}/{name}/downloads` | 1 hour | TTL-based only |

### The Abbreviated Metadata Optimization

Full package metadata (all versions with all fields) can be megabytes for packages with hundreds of versions. The `install` path only needs version numbers, dependency specs, and artifact hashes. An abbreviated metadata format reduces response size by 80-90%:

```
FUNCTION serve_abbreviated_metadata(package_name, accept_header):
    IF accept_header CONTAINS "application/vnd.npm.install-v1+json":
        // Abbreviated format — only fields needed for resolution
        RETURN {
            "name": package.name,
            "dist-tags": package.dist_tags,
            "versions": {
                FOR EACH version IN package.versions:
                    version.string: {
                        "version": version.string,
                        "dependencies": version.dependencies,
                        "peerDependencies": version.peer_dependencies,
                        "optionalDependencies": version.optional_dependencies,
                        "dist": {
                            "integrity": version.integrity,
                            "tarball": version.tarball_url
                        },
                        "engines": version.engines
                    }
            }
        }
        // Response: ~10 KB vs ~500 KB for full metadata
    ELSE:
        RETURN full_package_metadata(package_name)
```

### Hot Package Mitigation

The top 100 packages (react, lodash, typescript, express) account for a disproportionate share of downloads. These "hot packages" create CDN edge concentration:

```
FUNCTION optimize_hot_package_serving():
    // Tier 1: Ultra-hot packages (top 100)
    // - Preloaded at ALL CDN PoPs (push-based, not pull)
    // - Replicated to edge storage (not just cache)
    // - Served from edge compute with 0 origin lookups
    FOR EACH package IN hot_packages.tier1:
        cdn.preload_all_pops(package.latest_version.artifact_url)
        cdn.preload_all_pops(package.metadata_url)

    // Tier 2: Popular packages (top 10,000)
    // - Cached at regional PoPs with long TTL
    // - Stale-while-revalidate for metadata
    FOR EACH package IN hot_packages.tier2:
        cdn.set_regional_cache_priority(package, priority=HIGH)

    // Tier 3: All other packages
    // - Standard CDN caching, pull-through on first request
    // - Short metadata TTL, infinite artifact TTL
```

### Origin Shield Pattern

To prevent cache miss storms from hitting the origin directly, a two-tier CDN architecture is used:

```
Client → Edge PoP (200+ locations)
         ↓ (cache miss)
         Origin Shield (3-5 regional shields)
         ↓ (cache miss)
         Origin Servers
```

Benefits:
- Edge PoP misses hit the shield, not origin directly
- Shield aggregates concurrent misses for the same resource (request coalescing)
- Origin sees smoothed, reduced traffic even during cache cold-starts
- Shield can serve stale content during origin outages

---

## Slowest part of the process Analysis

### Slowest part of the process 1: Metadata Database — Read Amplification

**Problem:** Every `npm install` triggers metadata fetches for all direct and transitive dependencies. A project with 1,500 dependencies generates 1,500 metadata queries. At 20M daily installers, this creates ~30B metadata reads/day against the metadata store.

**Symptoms:**
- Database CPU saturation during US/EU business hours
- P99 metadata latency spikes above 500ms
- Connection pool exhaustion

**Mitigations:**

| Strategy | Description | Impact |
|---|---|---|
| **CDN metadata caching** | 5-min TTL on metadata, 98% hit rate | Reduces origin reads by 50× |
| **Abbreviated metadata** | 80% smaller responses for install path | Reduces bandwidth and serialization cost |
| **Batch metadata API** | Single request for multiple packages | Reduces connection overhead |
| **Read replicas** | Horizontally scaled read-only database replicas | Scales read capacity linearly |
| **Materialized metadata views** | Pre-computed JSON documents updated on publish | Eliminates per-request JOIN queries |
| **Local client cache** | Package manager caches metadata locally | Eliminates repeated fetches within TTL |

### Slowest part of the process 2: Publish Path — Transactional Write Contention

**Problem:** Publishing a version requires a transaction spanning multiple tables (version insert, dependency inserts, dist-tag update, audit log, package timestamp update). Under load (50K publishes/day, bursty during CI/CD peak hours), write contention on popular packages causes lock wait timeouts.

**Symptoms:**
- Publish latency spikes when multiple maintainers publish different packages simultaneously
- Row-level lock contention on the `PACKAGE` table (updating `updated_at` timestamp)
- Transaction rollbacks under concurrent publish

**Mitigations:**

| Strategy | Description | Impact |
|---|---|---|
| **Optimistic concurrency** | Use version number as optimistic lock; retry on conflict | Eliminates row locks for most publishes |
| **Deferred timestamp update** | Update `package.updated_at` asynchronously | Removes contention on package row |
| **Partitioned audit log** | Write audit events to separate, append-only store | Removes audit writes from critical path |
| **Publish queue serialization** | Serialize publishes to same package via queue | Eliminates concurrent write conflicts per-package |

### Slowest part of the process 3: CDN Cache Stampede on New Version Publish

**Problem:** When a popular package publishes a new version, CDN metadata caches are purged. The first requests after purge all miss the cache and flood the origin simultaneously—a thundering herd.

**Symptoms:**
- Origin traffic spikes 100× for 30-60 seconds after popular package publish
- Increased error rate during stampede
- Cascading latency increase across all metadata queries

**Mitigations:**

| Strategy | Description | Impact |
|---|---|---|
| **Stale-while-revalidate** | Serve stale metadata while revalidating in background | Eliminates stampede entirely for non-critical freshness |
| **Origin shield coalescing** | Shield deduplicates concurrent requests for same resource | Reduces origin load to 1 request per resource per shield |
| **Probabilistic early revalidation** | Random subset of requests trigger revalidation before TTL expires | Smooths revalidation over time |
| **Proactive cache warming** | After publish, proactively push updated metadata to shields | Pre-populates cache before client requests arrive |

### Slowest part of the process 4: Security Scanning Throughput

**Problem:** 50K publishes/day must each be scanned by 5+ scanners. Some scanners (behavioral analysis, SBOM generation) take 30-60 seconds per package. Total scanner capacity must sustain ~500 scan-tasks/minute.

**Symptoms:**
- Scan queue depth growing during peak publish hours
- Scan completion SLO breached (>10 min for 1%+ of publishes)
- Malware exposure window expands

**Mitigations:**

| Strategy | Description | Impact |
|---|---|---|
| **Scanner parallelism** | All scanners run in parallel per version (not sequential) | Reduces per-version scan latency to MAX(scanner times) |
| **Priority queue** | Prioritize scans for packages with high download counts | Ensures popular packages are scanned first |
| **Incremental scanning** | For minor version bumps, scan only changed files | Reduces scan work by 70% for patch releases |
| **Scanner auto-scaling** | Scale scanner fleet based on queue depth | Handles publish bursts without degradation |
| **Fast-path bypass** | Skip full scan for trusted publishers with provenance attestation | Reduces scan volume for verified CI/CD publishes |

### Slowest part of the process 5: Dependency Graph Computation at Scale

**Problem:** Reverse dependency queries ("which packages depend on vulnerable-pkg?") require traversing the entire dependency graph. With 50M+ versions and billions of dependency edges, this graph doesn't fit in memory on a single machine.

**Symptoms:**
- Vulnerability impact analysis takes hours instead of minutes
- Security advisory propagation is delayed
- "Dependents" count on package pages is stale

**Mitigations:**

| Strategy | Description | Impact |
|---|---|---|
| **Graph database** | Store dependency graph in a dedicated graph store optimized for traversal | Sub-second reverse dependency queries |
| **Materialized reverse index** | Pre-compute and maintain reverse dependency mappings | O(1) lookup for "who depends on X?" |
| **Incremental graph update** | Update graph incrementally on publish (add edges) and yank (mark edges) | Avoid full graph recomputation |
| **Partitioned BFS** | Partition graph by package namespace for parallel traversal | Enables distributed vulnerability propagation |
| **Tiered depth limits** | Limit transitive dependency traversal to depth 5 for advisory propagation | Bounds computation while covering 99%+ of real impact |

---

## Deep Dive 4: Registry Index Protocol Evolution

### The Index Freshness Problem

Package managers need to know which versions exist before resolving dependencies. The registry index protocol determines how clients discover available versions—and has dramatic performance implications.

### Index Protocol Comparison

| Protocol | How It Works | First-Install Latency | Update Latency | Bandwidth |
|---|---|---|---|---|
| **Full registry clone** (early npm) | Clone entire metadata index (~500 MB) on first install | Minutes | Seconds (incremental) | 500 MB initial, delta updates |
| **Git-based index** (crates.io v1) | Git repository with one file per package | 30-60s (git clone) | 1-5s (git pull) | ~100 MB (full clone) |
| **HTTP sparse index** (crates.io v2) | Fetch metadata only for needed packages via HTTP | 2-10s | Per-request (no pre-fetch) | Proportional to dependency count |
| **Abbreviated metadata API** (npm current) | HTTP API returning minimal metadata per package | 5-30s (depends on dep count) | Per-request | ~10 KB per package |

### Sparse Index Protocol

The sparse index protocol eliminates the need to download the entire registry index. Instead, the client fetches metadata files only for packages that appear in the dependency tree:

```
FUNCTION sparse_index_resolve(dependencies, index_url):
    needed_packages = extract_all_package_names(dependencies)
    metadata_cache = local_disk_cache()

    FOR EACH package_name IN needed_packages:
        // Compute index path: lowercase, first 2 chars as directory sharding
        // e.g., "serde" → "/se/rd/serde"
        index_path = compute_index_path(package_name)
        cache_key = index_url + "/" + index_path

        // Check local cache with ETag-based revalidation
        cached = metadata_cache.get(cache_key)
        IF cached AND NOT is_expired(cached):
            metadata[package_name] = cached.data
            CONTINUE

        // Fetch from registry with conditional request
        response = http_get(index_url + "/" + index_path, headers={
            "If-None-Match": cached.etag IF cached ELSE NULL
        })

        IF response.status == 304:  // Not modified
            metadata_cache.refresh_ttl(cache_key)
        ELSE IF response.status == 200:
            metadata[package_name] = parse_index_entry(response.body)
            metadata_cache.put(cache_key, response.body, response.etag)

    // Now resolve with fetched metadata
    RETURN resolve_with_metadata(dependencies, metadata)
```

**Why sparse indexing matters:** For a project with 500 direct+transitive dependencies out of 150K total packages in the registry, the sparse protocol fetches 500 small files (~500 KB total) instead of cloning the entire index (~100 MB). This reduces first-install time from 30+ seconds to 2-5 seconds.

### Index Consistency Guarantees

| Guarantee | Sparse Index | Full Clone Index |
|---|---|---|
| **Atomicity** | Per-package (each file is independently consistent) | Per-commit (entire index is consistent at each git commit) |
| **Freshness** | ETag-based; may see stale data for up to TTL | As fresh as last git pull |
| **Ordering** | No ordering guarantee between packages | Global ordering (git commit history) |
| **Resolution reproducibility** | Requires lockfile (index may change between requests) | Reproducible within a git commit |

---

## Deep Dive 5: Provenance Verification Pipeline

### End-to-End Provenance Chain

The provenance chain links a package artifact to its source code, build system, and publisher identity:

```mermaid
flowchart LR
    subgraph Source["Source"]
        GIT["Git Repository<br/>commit: abc123"]
    end

    subgraph Build["Build System"]
        CI["CI/CD Pipeline<br/>GitHub Actions / GitLab CI"]
        OIDC_TOKEN["OIDC Identity Token<br/>(short-lived, 10 min)"]
    end

    subgraph Sign["Signing"]
        FULCIO["Fulcio CA<br/>(issue ephemeral cert)"]
        SIGN_OP["Sign Artifact Hash<br/>(ephemeral keypair)"]
    end

    subgraph Record["Transparency"]
        REKOR["Rekor Log<br/>(append Merkle tree)"]
    end

    subgraph Registry["Registry"]
        STORE["Store Artifact +<br/>Provenance Attestation"]
    end

    GIT -->|"trigger build"| CI
    CI -->|"request OIDC token"| OIDC_TOKEN
    OIDC_TOKEN -->|"present to Fulcio"| FULCIO
    FULCIO -->|"issue cert"| SIGN_OP
    SIGN_OP -->|"record signature"| REKOR
    SIGN_OP -->|"attach attestation"| STORE
    CI -->|"build artifact"| STORE

    classDef source fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef build fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef sign fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef record fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef registry fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class GIT source
    class CI,OIDC_TOKEN build
    class FULCIO,SIGN_OP sign
    class REKOR record
    class STORE registry
```

### SLSA Level Assessment

The registry evaluates each publish against SLSA (Supply chain Levels for Software Artifacts) criteria:

| SLSA Level | Requirements | What It Proves |
|---|---|---|
| **Level 1** | Documentation of build process | Build process is defined (minimal security value) |
| **Level 2** | Version-controlled build definition + hosted build service | Build was automated, not manual |
| **Level 3** | Hardened build platform + provenance attestation | Build environment was isolated; provenance is unforgeable |
| **Level 4** | Two-person review + hermetic builds | Source was reviewed; build is fully reproducible |

```
FUNCTION assess_slsa_level(provenance_attestation):
    level = 0

    // Level 1: build process documented
    IF provenance_attestation.build_type IS NOT NULL:
        level = 1

    // Level 2: version-controlled build + hosted service
    IF provenance_attestation.source_repo IS NOT NULL
       AND provenance_attestation.builder_id IN trusted_builders:
        level = 2

    // Level 3: non-falsifiable provenance from hardened builder
    IF provenance_attestation.signature IS VALID
       AND provenance_attestation.transparency_log_entry IS VERIFIED
       AND provenance_attestation.builder_id IN hardened_builders:
        level = 3

    // Level 4 requires additional checks (hermetic build, two-person review)
    // typically verified by the build system, not the registry
    IF provenance_attestation.hermetic_build == TRUE
       AND provenance_attestation.source_reviewed == TRUE:
        level = 4

    RETURN level
```
