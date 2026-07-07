# GitHub --- Git Hosting, Pull Requests, Actions, Code Search

## System Overview

GitHub is a developer platform built around Git version control that provides collaborative code hosting, pull request-based code review, CI/CD automation (Actions), and large-scale code search. At its core, GitHub wraps the Git content-addressable object store with web-based collaboration primitives---pull requests, issues, projects---and extends it with a distributed task execution system (Actions) and a code search engine indexing 200M+ repositories. The system must handle bursty git operations (pushes, clones, fetches) with sub-second latency, orchestrate millions of concurrent CI/CD workflow runs, and serve code search across petabytes of source code while maintaining strong durability guarantees for git data (every commit is sacred) and eventual consistency for derived data (search indexes, CI status).

---

## Key Characteristics

| Characteristic | Description |
|---------------|-------------|
| **Read/Write Pattern** | Read-heavy for fetches/clones (10:1 read:write); write-heavy for CI/CD event processing |
| **Latency Sensitivity** | High for git operations (<500ms push, <2s clone start); moderate for search (<200ms); tolerant for CI/CD (seconds) |
| **Consistency Model** | Strong consistency for git refs (linearizable ref updates); eventual consistency for search indexes, CI status |
| **Concurrency Level** | Thousands of concurrent pushes per second; millions of concurrent workflow runs |
| **Data Volume** | 500M+ repositories, 3B+ git objects/day created, 100PB+ total storage |
| **Architecture Model** | Service-oriented with Git object store as the foundational data layer |
| **Offline Support** | Git is inherently offline-first; server is the coordination point for collaboration features |
| **Security Model** | Supply chain security: secret scanning, dependency vulnerability detection, code scanning (SAST), signed commits, branch protection rules |
| **AI Integration** | Code completion (Copilot), PR review assistance, natural language code search, vulnerability remediation suggestions |
| **Complexity Rating** | **Very High (9/10)** |

---

## Quick Navigation

| Document | Description |
|----------|-------------|
| [01 - Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning, SLOs |
| [02 - High-Level Design](./02-high-level-design.md) | Architecture diagrams, data flow, key decisions |
| [03 - Low-Level Design](./03-low-level-design.md) | Git object model, data schemas, API design, merge algorithms |
| [04 - Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Pack files, monorepos, fork graphs, Actions lifecycle, search at scale |
| [05 - Scalability & Reliability](./05-scalability-and-reliability.md) | Sharding, replication, autoscaling, disaster recovery |
| [06 - Security & Compliance](./06-security-and-compliance.md) | Auth, secret scanning, dependency scanning, supply chain security |
| [07 - Observability](./07-observability.md) | Metrics, tracing, logging, alerting, dashboards |
| [08 - Interview Guide](./08-interview-guide.md) | 45-min pacing, trap questions, trade-offs, whiteboard diagrams |
| [09 - Insights](./09-insights.md) | Key architectural insights and non-obvious lessons |

---

## What Makes This System Unique

1. **Git as the Foundation**: Unlike most web applications that design their data model from scratch, GitHub builds on top of Git's content-addressable object store---a Merkle DAG of blobs, trees, and commits. This immutable, content-addressed foundation provides natural deduplication, integrity verification, and a distributed replication model, but imposes constraints on how data is accessed and indexed.

2. **Fork Graph and Copy-on-Write Semantics**: Forks don't copy repository data. A fork shares the same object store as its upstream repository, with new objects added only when the fork diverges. This copy-on-write model saves petabytes of storage but creates complex object ownership, garbage collection, and access control challenges.

3. **Actions as a Distributed Task Execution System**: CI/CD workflows are event-driven, heterogeneous task graphs executed on ephemeral runners. The system must schedule millions of concurrent jobs across different operating systems, architectures, and security contexts while providing deterministic caching and artifact management.

4. **Code Search Across 200M+ Repositories**: Searching all public code requires a custom search engine with trigram indexing, incremental index updates, and ranking algorithms that balance code relevance with repository signals (stars, recency, language).

5. **Git Protocol as an API**: Unlike typical REST/GraphQL APIs, a significant portion of traffic uses the Git smart HTTP and SSH protocols---binary, stateful, streaming protocols that require specialized handling at the load balancer and application layers.

6. **Merge Queue as a Throughput Optimizer**: When CI takes 30 minutes and 20 PRs are waiting, serial merge-test-merge cycles take 10 hours. The merge queue speculatively batches PRs, tests them together, and bisects failures—transforming a serialization Slowest part of the process into a parallel throughput problem.

7. **Supply Chain Security at Ingest**: Every push is scanned in real-time for 200+ patterns of leaked credentials (API keys, tokens, passwords). The dependency graph is rebuilt on every push to the default branch, matching against vulnerability advisories and auto-generating Dependabot PRs. This security pipeline runs asynchronously but must complete before the push event is considered "processed."

8. **AI-Assisted Development Integration**: Code completion models (Copilot) require real-time repository context (current file, open files, dependency graph) with sub-200ms response times. PR review AI operates in batch mode with larger context windows. Both require architectural separation between model inference (GPU clusters), context retrieval (code search + repo state), and response delivery (streaming via WebSocket).

---

## Algorithm & Approach Comparison

| Problem | Approach A | Approach B | GitHub's Approach |
|---------|-----------|-----------|-------------------|
| **Object storage** | One file per object (loose) | Pack files with delta compression | Hybrid: loose objects for recent writes, periodic packing |
| **Merge strategy** | 3-way merge | Recursive merge with rename detection | Recursive merge (default), squash, rebase options |
| **Search indexing** | Inverted index (token-based) | Trigram index (substring matching) | Trigram index with symbol extraction and ranking |
| **Ref updates** | Optimistic locking (CAS) | Pessimistic locking | Compare-and-swap on ref values |
| **CI/CD orchestration** | Centralized scheduler | Distributed worker pools | Event-driven with distributed runner pools and job queuing |
| **Fork storage** | Full copy per fork | Shared object store (COW) | Shared object store with alternates |

---

## Key Technology References

| Component | Real-World Example |
|-----------|-------------------|
| Git object store | Content-addressable Merkle DAG (SHA-256 transition) |
| Pack file format | Git pack-objects, delta compression, multi-pack indexes |
| Merge algorithms | 3-way merge, recursive merge, patience diff |
| Code search | Trigram indexing (inspired by Zoekt/Sourcegraph), semantic search |
| CI/CD orchestration | Event-driven DAG execution, ephemeral containers |
| API layer | REST v3, GraphQL v4, Git smart HTTP/SSH protocols |
| Webhook delivery | At-least-once delivery with exponential backoff |

---

## Related Patterns

| System | Relationship | Shared Insight |
|---|---|---|
| [1.5 — Distributed Log-Based Broker](../1.5-distributed-log-based-broker/) | **Event backbone** — GitHub's push event triggers a massive fan-out (webhooks, CI, search, notifications) that requires log-based message broker patterns for reliable async delivery | Both use append-only event logs with consumer groups; GitHub's webhook delivery system is a specialized message delivery pipeline with at-least-once semantics |
| [1.12 — Blob Storage System](../1.12-blob-storage-system/) | **Object storage foundation** — Git's content-addressable object store is structurally a blob storage system where the key is the SHA hash of the content | Both use content-addressing for deduplication; Git extends this with Merkle DAG structure for integrity verification across the entire commit graph |
| [12.9 — Code Execution Sandbox](../12.9-code-execution-sandbox/) | **Runner security** — Actions' ephemeral runner model shares sandboxing challenges with code execution platforms: untrusted code must run in isolation | Both use ephemeral VMs destroyed after execution; Actions adds workflow DAG orchestration, secret injection, and artifact management on top of basic sandboxing |
| [6.14 — Customer Support Platform](../6.14-customer-support-platform/) | **Issue tracking** — GitHub Issues and Projects share workflow management patterns with ticket/case management systems | Both model stateful workflows with assignment, labels/tags, and lifecycle transitions; GitHub adds code-level linking (commit references, PR associations) |
| [12.17 — Content Moderation System](../12.17-content-moderation-system/) | **Supply chain security** — Secret scanning, dependency vulnerability detection, and code scanning share content analysis patterns with moderation systems | Both perform automated content analysis at ingest time; GitHub applies this to code-specific threats (leaked credentials, known-vulnerable dependencies, malicious commits) |
| [6.1 — Slack / Real-Time Messaging](../6.1-slack/) | **Notification fan-out** — A single push event can trigger notifications to thousands of repository watchers, requiring the same fan-out infrastructure as messaging platforms | Both solve the write-amplification problem of notifying many subscribers of a single event; GitHub's notification system serves web, email, and mobile channels |

## Core Architectural Challenges

| Challenge | Difficulty | Why It's Hard |
|---|---|---|
| **Fork network garbage collection** | Very High | Cannot delete any object referenced by any fork in a network of potentially 50,000+ repositories; root deletion requires atomic reparenting of all alternates |
| **Monorepo performance** | High | Repositories with millions of files break standard git operations (status, diff, clone); requires partial clone, sparse checkout, and virtual filesystem support |
| **Push event fan-out** | High | A single push to a popular repo triggers 50,000+ webhook deliveries, multiple CI workflows, search index updates, and notifications—all asynchronously without blocking the push |
| **Code search freshness** | Medium-High | Keeping trigram indexes updated across 200M+ repositories within minutes of each push, while the index is 5-10x the size of the source corpus |
| **Actions runner scaling** | Medium-High | 100,000+ concurrent ephemeral VMs across Linux, macOS, and Windows with sub-30-second queue times; each VM is destroyed after a single job |
| **Secret sprawl detection** | Medium | Scanning every push across all repositories for leaked credentials (API keys, tokens, passwords) in real-time without blocking the push flow |
| **Pack file optimization** | Medium | Balancing delta compression ratio (storage savings) against pack access latency (read performance); repack operations on large repos can take hours |
| **Webhook traffic shaping** | Medium | Platform generates 3B+ webhooks/day; must rate-limit per-destination to prevent overwhelming small receiver services; circuit breaking for failing endpoints |
| **AI context retrieval** | Medium | Code completion requires sub-200ms repo context retrieval; must balance context window size against latency; pre-computed file embeddings for semantic search |

## Prerequisites & Related Designs

| Related Design | Relationship |
|---------------|-------------|
| Distributed File System | Git object storage shares content-addressable design principles |
| Task Queue / Job Scheduler | Actions builds on distributed task execution patterns |
| Search Engine | Code search is a specialized search engine problem |
| CDN / Edge Caching | Release assets, clone caching, and static content delivery |
| Event-Driven Architecture | Webhooks, Actions triggers, and notification fan-out |

---

## What Differentiates Naive vs. Production

| Dimension | Naive Approach | Production Reality |
|---|---|---|
| **Fork storage** | Full copy per fork | Copy-on-write via Git alternates; 50K forks of Linux kernel = 4.5TB instead of 200TB |
| **Search** | Full-text search engine (token-based) | Trigram indexing for substring and regex matching; 2PB+ index across 200M+ repos |
| **CI/CD** | Persistent build servers | Ephemeral VMs destroyed after each job; fresh environment eliminates state contamination |
| **Webhooks** | Fire-and-forget HTTP calls | At-least-once with exponential backoff; per-destination rate limiting; circuit breaking for failed receivers |
| **Merge safety** | Test PR branch in isolation | Merge queue batches PRs, tests combined result, bisects failures; required for busy repos with CI gates |
| **Monorepo support** | Standard git clone | Partial clone (skip blobs), sparse checkout, virtual filesystem, pre-computed pack files |
| **Security scanning** | Periodic batch scans | Real-time push-time scanning for 200+ secret patterns; dependency graph rebuild on every default branch push |

---

## Sources

- Git Internals documentation (git-scm.com)
- GitHub Engineering Blog --- scaling git infrastructure, Actions architecture, code search
- GitHub Code Search technical deep-dive (2023)
- Git protocol specification (pack protocol, smart HTTP, SSH)
- GitHub API documentation (REST v3, GraphQL v4)
- Industry statistics: 100M+ developers, 400M+ repositories (2024-2025)
- Open-source search engines: Zoekt (trigram-based code search)
- Git hash function transition plan (SHA-1 to SHA-256)
- Distributed systems papers on content-addressable storage and Merkle trees
