# Requirements & Estimations

## Functional Requirements

### Core: Git Hosting

| Feature | Description |
|---------|-------------|
| **Repository Management** | Create, delete, archive, transfer, fork repositories |
| **Git Operations** | Push, fetch, clone, shallow clone, partial clone via smart HTTP and SSH |
| **Branches & Tags** | Create, delete, list branches and tags; default branch configuration |
| **Commits** | View commit history, diff, blame, file browsing at any ref |
| **Merge Operations** | Merge commit, squash merge, rebase merge with conflict detection |
| **Large File Support** | LFS protocol for binary assets (models, images, videos) |
| **Repository Settings** | Visibility (public/private/internal), description, topics, license |

### Core: Pull Requests & Code Review

| Feature | Description |
|---------|-------------|
| **PR Lifecycle** | Create, update, close, reopen, merge pull requests |
| **Code Review** | Line-level comments, review threads, suggested changes, approval/request-changes |
| **Review Assignment** | CODEOWNERS-based auto-assignment, team reviewers, load balancing |
| **Merge Rules** | Required reviewers, status checks, linear history, signed commits |
| **Branch Protection** | Restrict push, require PR, require up-to-date branch, dismiss stale reviews |
| **Conflict Resolution** | Web-based conflict editor, merge conflict detection |
| **Draft PRs** | Work-in-progress PRs that cannot be merged |

### Core: CI/CD Actions

| Feature | Description |
|---------|-------------|
| **Workflow Definition** | YAML-based workflow files with event triggers |
| **Event Triggers** | Push, PR, schedule, manual dispatch, repository dispatch, webhook |
| **Job Orchestration** | DAG-based job dependencies, matrix builds, conditional execution |
| **Runner Management** | Hosted runners (Linux, macOS, Windows), self-hosted runners |
| **Artifact Management** | Upload/download build artifacts, retention policies |
| **Caching** | Dependency caching across workflow runs (keyed by lockfile hash) |
| **Secrets Management** | Encrypted secrets at org/repo/environment level |
| **Environments** | Deployment environments with protection rules and wait timers |
| **Reusable Workflows** | Shared workflow templates across repositories |
| **Marketplace** | Community-contributed Actions with versioning |

### Core: Code Search

| Feature | Description |
|---------|-------------|
| **Keyword Search** | Full-text search across repository code, file names, paths |
| **Regex Search** | Regular expression search within repositories |
| **Symbol Search** | Find function/class/method definitions and references |
| **Scope Filtering** | Filter by language, file extension, path, repository, organization |
| **Code Navigation** | Jump-to-definition, find-references, hover documentation |
| **Search Ranking** | Relevance scoring based on code quality signals, repository popularity |

### Supporting Features

| Feature | Description |
|---------|-------------|
| **Issues & Projects** | Issue tracking, labels, milestones, project boards (Kanban) |
| **Packages** | Package registry for npm, Maven, Docker, NuGet, RubyGems |
| **Wiki** | Per-repository wiki backed by a Git repository |
| **Discussions** | Forum-style discussions per repository |
| **Notifications** | In-app, email, mobile push notifications for subscribed events |
| **Webhooks** | HTTP callbacks for repository events |
| **GitHub Pages** | Static site hosting from repository branches |
| **Copilot Integration** | AI-assisted code completion and chat |

---

## Non-Functional Requirements

| Requirement | Target | Rationale |
|-------------|--------|-----------|
| **Availability** | 99.99% for git operations | Developers' work is blocked if they can't push/pull |
| **Durability** | 99.999999999% (11 nines) for git data | Git data is irreplaceable; losing commits is catastrophic |
| **Push Latency** | p50 < 200ms, p99 < 2s (for typical pushes) | Developer flow; CI/CD pipeline trigger responsiveness |
| **Clone Latency** | Time-to-first-byte < 500ms | Developer experience for starting work |
| **Search Latency** | p50 < 100ms, p99 < 500ms | Interactive search experience |
| **PR Merge Latency** | < 5s end-to-end | Fast merge feedback in review workflow |
| **Actions Queue Time** | p50 < 30s, p99 < 5min for hosted runners | Developer productivity; CI feedback loop |
| **Webhook Delivery** | p50 < 2s, 99.9% delivered within 1 hour | Integration reliability |
| **Consistency** | Linearizable for ref updates; eventual for derived data | Correctness for git operations; freshness for UI |
| **Scalability** | Support 10x growth over 3 years | Platform growth trajectory |

---

## Scale Estimations

### User & Repository Scale

| Metric | Value |
|--------|-------|
| Registered users | 400M+ |
| Monthly active users | 100M+ |
| Daily active users | 30M+ |
| Total repositories | 500M+ |
| Public repositories | 200M+ |
| Active repositories (push in last 90 days) | 50M+ |
| Organizations | 15M+ |
| Average repos per active user | 8-12 |

### Traffic Estimations

| Operation | Volume | Notes |
|-----------|--------|-------|
| Git pushes | 50M/day (~580/sec) | Bursty; 3x during business hours |
| Git fetches/clones | 500M/day (~5,800/sec) | 10:1 read:write ratio |
| API requests (REST + GraphQL) | 5B/day (~58K/sec) | Includes bot/CI traffic |
| PR events (create, update, merge) | 10M/day | Reviews, comments, status updates |
| Actions workflow runs | 30M/day | Growing rapidly |
| Actions job executions | 100M/day | Multiple jobs per workflow |
| Code search queries | 50M/day | Interactive + API |
| Webhook deliveries | 3B/day | Massive fan-out for popular repos |
| Page views (web UI) | 2B/day | Repository browsing, PR review |

### Storage Estimations

| Data Type | Volume | Growth Rate |
|-----------|--------|-------------|
| Git objects (total) | 100PB+ | ~500TB/month |
| Git objects (unique after dedup) | ~30PB | Fork COW deduplication |
| LFS objects | 20PB+ | Binary assets (growing fast) |
| Actions artifacts | 10PB+ | 90-day default retention |
| Actions caches | 5PB+ | 7-day retention |
| Package registry | 5PB+ | Container images dominate |
| Search index | 2PB+ | Trigram index for all public code |
| Database (metadata) | 500TB+ | PRs, issues, users, permissions |
| Audit logs | 100TB+ | Compliance requirements |

### Bandwidth Estimations

| Traffic Type | Bandwidth |
|-------------|-----------|
| Git clone/fetch egress | 500 Gbps sustained |
| Release/LFS downloads | 200 Gbps |
| Web/API responses | 100 Gbps |
| Actions runner communication | 50 Gbps |
| **Total egress** | **~1 Tbps** |

---

## Capacity Planning

### Compute

| Component | Instance Count | Sizing |
|-----------|---------------|--------|
| Git servers (smart HTTP/SSH) | 2,000+ | CPU-heavy (pack computation) |
| API servers (REST/GraphQL) | 5,000+ | Memory-moderate |
| WebSocket servers (live updates) | 500+ | Connection-heavy |
| Actions orchestrators | 200+ | Event processing |
| Hosted runners (Linux) | 100,000+ concurrent | Ephemeral VMs (2-4 vCPU) |
| Hosted runners (macOS) | 5,000+ concurrent | Dedicated hardware |
| Search indexers | 500+ | CPU + disk I/O heavy |
| Search query servers | 300+ | Memory-heavy (index in memory) |
| Webhook delivery workers | 1,000+ | Network I/O heavy |

### Database

| Database | Use Case | Sizing |
|----------|----------|--------|
| Relational (primary) | Users, repos, PRs, issues | 100+ nodes, sharded |
| Relational (read replicas) | Read-heavy queries | 500+ replicas |
| Key-value store | Session, cache, rate limiting | 200+ nodes |
| Document store | Search metadata, flexible schemas | 100+ nodes |
| Time-series DB | Metrics, audit logs | 50+ nodes |
| Message queue | Event processing, webhooks | 100+ brokers |

---

## SLOs / SLAs

### Tier 1: Critical Path (99.99% availability)

| Service | Latency SLO | Error Budget |
|---------|-------------|-------------|
| Git push | p99 < 5s | 52.6 min/year downtime |
| Git fetch/clone | p99 < 10s | 52.6 min/year downtime |
| Repository page load | p99 < 3s | 52.6 min/year downtime |
| Authentication | p99 < 500ms | 52.6 min/year downtime |

### Tier 2: Important (99.95% availability)

| Service | Latency SLO | Error Budget |
|---------|-------------|-------------|
| PR creation/merge | p99 < 10s | 4.38 hr/year downtime |
| Code search | p99 < 2s | 4.38 hr/year downtime |
| API (REST/GraphQL) | p99 < 5s | 4.38 hr/year downtime |
| Notifications | p99 < 30s delivery | 4.38 hr/year downtime |

### Tier 3: Best Effort (99.9% availability)

| Service | Latency SLO | Error Budget |
|---------|-------------|-------------|
| Actions workflow start | p99 < 5min queue | 8.77 hr/year downtime |
| Webhook delivery | 99.9% within 1 hour | 8.77 hr/year downtime |
| Package registry | p99 < 5s | 8.77 hr/year downtime |
| Search index freshness | < 5min from push to searchable | 8.77 hr/year downtime |

---

## Key Constraints & Assumptions

1. **Git protocol compatibility**: Must support standard Git clients without modification
2. **Repository size**: 99th percentile < 5GB; must handle outliers up to 100GB+ (monorepos)
3. **Fork ratio**: ~30% of repositories are forks; must not duplicate storage
4. **Bot traffic**: 40%+ of API traffic is from bots and CI systems
5. **Geographic distribution**: Users span all continents; must optimize for global latency
6. **Regulatory**: Some enterprise customers require data residency (EU, Australia)
7. **Open source**: Public repos must be free; monetization via private repos, enterprise features, Actions minutes

---

## Derived Throughput Calculations

### Git Backend Load

```
Push processing (peak):
  50M pushes/day × 3x business-hour concentration = ~1,740 pushes/sec peak
  Average push size: 5 objects × 10KB = 50KB
  Push throughput: 1,740 × 50KB = ~87 MB/sec ingest
  Ref updates: 1,740 CAS operations/sec (distributed across repo shards)

Clone/fetch serving (peak):
  500M fetches/day × 2x business-hour concentration = ~11,600 fetches/sec peak
  Average clone size: 50MB (compressed pack)
  Clone bandwidth: 11,600 × 50MB = ~580 GB/sec → served primarily from CDN
  CDN cache hit rate for popular repos: ~85%
  Origin clone load: 11,600 × 0.15 = ~1,740 fetches/sec from origin
```

### Actions Compute Budget

```
Hosted runner demand:
  30M workflow runs/day × 3.3 jobs/workflow = ~100M jobs/day
  Average job duration: 8 minutes
  Total compute-minutes: 100M × 8 = 800M compute-minutes/day
  Concurrent runners needed (assuming 80% utilization):
    800M minutes / 1,440 minutes per day / 0.8 = ~694,444 runner-minutes concurrently
    → Peak: ~100,000 concurrent VMs (bursty, 2-3x during business hours)

  Runner provisioning SLO:
    p50 queue time < 30s → warm pool must cover p50 demand
    Warm pool size: ~60,000 pre-booted VMs
    Cold start time: ~45 seconds (boot + image pull + checkout)
```

### Webhook Delivery Infrastructure

```
Webhook fan-out:
  50M pushes/day × 2 webhooks/push average = 100M from pushes
  10M PR events/day × 3 webhooks/event = 30M from PRs
  Other events (issues, releases, etc.): 70M/day
  Total: ~3B webhook deliveries/day (including retries)

  3B / 86,400 = ~35,000 webhooks/sec sustained
  Peak: ~100,000 webhooks/sec

  Delivery workers: 100K/sec ÷ 50 deliveries/sec/worker = ~2,000 workers at peak
  Retry queue: ~5% initial failure rate → 150M retries/day
  Retry strategy: exponential backoff (10s, 60s, 5min, 30min, 2hr, 6hr)
  Delivery SLO: 99.9% delivered within 1 hour
```

### Search Index Sizing

```
Search corpus:
  200M+ public repos indexed
  Average repo size (code files only): 5MB
  Total source corpus: 200M × 5MB = ~1PB
  Trigram index size: ~5-8x corpus = ~5-8 PB
  With deduplication (identical files across forks): ~2PB effective index

  Index sharding: 2PB / 100GB per shard = ~20,000 index shards
  Query fan-out: scatter to relevant shards (usually 50-500 based on scope filters)
  Index update rate: 50M pushes/day → ~250M file changes/day
  Re-index throughput: 250M files / 86,400 = ~2,900 files/sec
```
