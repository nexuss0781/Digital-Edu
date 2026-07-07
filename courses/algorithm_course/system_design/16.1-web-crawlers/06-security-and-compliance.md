# Security & Compliance — Web Crawlers

## Authentication & Authorization

### AuthN Mechanism

The crawler itself does not authenticate with target websites (it crawls the public web). However, the crawler's internal APIs (admin, monitoring, frontier management) require authentication:

| Interface | AuthN Method | Details |
|-----------|-------------|---------|
| Admin API | OAuth2 + OIDC | Operators authenticate via identity provider; short-lived access tokens |
| Internal gRPC (frontier ↔ fetcher) | Mutual TLS (mTLS) | Both client and server present certificates; prevents unauthorized workers from joining the fleet |
| Monitoring dashboards | SSO via OIDC | Integrated with corporate identity provider |
| Seed URL injection | API key + IP allowlist | Restricted to authorized automation systems |

### AuthZ Model (RBAC)

| Role | Permissions |
|------|------------|
| **Crawler Admin** | Full access: pause/resume crawling, inject seeds, modify blocklists, manage frontier partitions |
| **Crawler Operator** | Monitor: view crawl stats, query URL status, view trap detections. Modify: adjust host priorities, add hosts to blocklist |
| **Viewer** | Read-only: view dashboards, query crawl statistics |
| **Automation (CI/CD)** | Seed injection, frontier status queries, crawl trigger |

### Token Management

- Internal services use mTLS with certificates rotated every 90 days
- Human operators use OIDC tokens with 1-hour expiry and refresh tokens
- API keys for automation are scoped per function and rotated every 30 days

---

## Data Security

### Encryption at Rest

| Data | Encryption | Key Management |
|------|-----------|----------------|
| URL database | AES-256 | Managed key rotation (90 days) |
| Crawled page content | AES-256 | Content-addressed keys; per-bucket encryption in object storage |
| Crawl logs | AES-256 | Same as URL database |
| Frontier state (disk checkpoints) | AES-256 | Node-local encryption keys |
| Bloom filter checkpoints | Not encrypted | Contains only hashes; no sensitive data |

### Encryption in Transit

- **Fetcher ↔ target hosts:** HTTPS where available; HTTP for hosts that do not support TLS
- **Internal communication:** mTLS for all service-to-service communication (frontier ↔ fetcher, fetcher ↔ content store, etc.)
- **Cross-region traffic:** VPN tunnels or private interconnects for frontier ↔ fetcher communication across regions

### PII Handling

The crawler inevitably fetches pages containing personal information (social media profiles, public directories, personal websites). Handling strategies:

| Concern | Strategy |
|---------|----------|
| PII in fetched content | Content is stored as-is (it is publicly available); PII extraction and masking is the indexer's responsibility, not the crawler's |
| PII in URLs | Some URLs contain email addresses or names (e.g., `/profile/john.doe@example.com`); the URL database does not specifically handle PII in URLs |
| Cookies and session data | The crawler does not store or forward cookies; each request is stateless |
| IP logging | Fetcher worker IP addresses are logged in target server access logs; this is expected behavior for web crawlers |

### Data Masking / Anonymization

- **Crawl logs:** Anonymize any user-agent strings that might reveal internal infrastructure details
- **Admin access logs:** Log operator identity and actions for audit trail; anonymize for external reporting

---

## Threat Model

### Top Attack Vectors

#### 1. Malicious Content Injection (Poisoning the Index)

**Threat:** An adversary creates web pages designed to exploit the crawler's parser, causing buffer overflows, code execution, or corrupted data in the content store.

**Mitigation:**
- Parse HTML in a sandboxed environment with resource limits (memory, CPU, execution time)
- Validate content type headers against actual content (reject mismatched types)
- Limit fetched page size (max 10 MB per page)
- Strip executable content (JavaScript, embedded objects) during parsing

#### 2. Crawler Trap / Resource Exhaustion

**Threat:** An adversary creates a spider trap (infinite URL generator) to consume the crawler's bandwidth and storage budget, diverting resources from legitimate pages.

**Mitigation:**
- Per-host URL budget (max 500,000 URLs per host in the frontier)
- URL depth and length limits
- Repeating path segment detection
- Content uniqueness monitoring per host (low unique content ratio triggers trap flag)
- Manual blocklist for confirmed adversarial hosts

#### 3. Denial of Service via Redirect Chains

**Threat:** A host returns an infinite chain of redirects, causing the fetcher to follow them indefinitely and waste connections.

**Mitigation:**
- Maximum redirect depth (e.g., 10 redirects per initial URL)
- Redirect loop detection (track visited URLs in the redirect chain)
- Timeout on total fetch time including all redirects (30 seconds)

#### 4. IP Spoofing / Impersonation of Crawler

**Threat:** An adversary impersonates the crawler's User-Agent to bypass access controls on target sites, or the crawler's IP ranges are used in abuse campaigns.

**Mitigation:**
- Publish official crawler IP ranges for site owners to verify
- Use consistent, well-documented User-Agent strings
- Respond to reverse DNS lookups (verify that the crawler's IP resolves to the expected domain)
- Monitor for unauthorized use of the crawler's User-Agent

#### 5. Internal Infrastructure Compromise

**Threat:** An attacker gains access to the crawler's control plane and uses it to target specific hosts (effectively weaponizing the crawler as a DDoS tool).

**Mitigation:**
- mTLS for all internal communication
- RBAC with least-privilege principle
- Rate limits on admin API (prevent mass host targeting)
- Audit logging of all administrative actions
- Anomaly detection on crawl patterns (sudden increase in requests to a single host)

#### 6. DNS Cache Poisoning

**Threat:** An attacker compromises DNS responses, causing the crawler to resolve legitimate hostnames to attacker-controlled IPs. The crawler then fetches malicious content that poisons the index while believing it came from a trusted host.

**Mitigation:**
- Validate DNSSEC where available (verify signature chain)
- Cross-validate DNS results against known IP ranges for high-value hosts
- Monitor for sudden IP changes on previously stable hosts — trigger a re-verification before continuing to crawl
- Implement DNS response sanity checks (reject results pointing to private/reserved IP ranges: 10.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16)

#### 7. Crawl Infrastructure as Attack Amplifier

**Threat:** An attacker injects URLs pointing to a victim server into the crawler's seed or link graph. The crawler, operating at high throughput, unknowingly participates in a DDoS attack against the victim.

**Mitigation:**
- Per-host and per-IP request rate limits enforce politeness regardless of how many URLs point to a target
- Monitor for hosts receiving unusually rapid URL discovery (thousands of new URLs from multiple sources in a short time window — may indicate coordinated injection)
- Rate limit seed URL injection through the admin API
- Cross-reference target IP against known CDN/hosting ranges — sudden appearance of a new target with massive URL volume is suspicious

#### 8. Data Exfiltration via Crawler Output

**Threat:** An attacker positions pages on the web containing encoded sensitive data (stolen credentials, internal documents) and uses the crawler's indexing pipeline to exfiltrate this data through the search index.

**Mitigation:**
- Content sanity checks at the parsing stage (detect pages with anomalously high density of structured data patterns like email addresses, credit card numbers, social security numbers)
- Flag hosts with high PII density for manual review before indexing
- Content store access controls — limit who can query stored page content

### Rate Limiting & DDoS Protection

| Protection | Implementation |
|-----------|---------------|
| Per-host rate limiting | Politeness engine (primary defense — see Deep Dive) |
| Per-IP aggregate rate limiting | IP-based throttling across all hosts on shared IPs |
| Self-protection: admin API rate limit | 100 RPS per authenticated user |
| Self-protection: frontier API rate limit | Per-worker connection limits; mTLS prevents unauthorized workers |
| Outbound DDoS prevention | Global crawl throughput ceiling; cannot exceed configured pages/sec |

---

## AI Crawling Compliance (2025-2026)

### The AI Training Opt-Out Landscape

The rapid growth of LLM training on web-scraped data has created a new compliance dimension for web crawlers. As of 2025, multiple parallel standards exist for publishers to communicate AI-related crawl preferences:

| Mechanism | Status (2025) | How It Works | Crawler Obligation |
|-----------|--------------|--------------|-------------------|
| **robots.txt (AI-specific user agents)** | Widely adopted | Publishers add `User-agent: GPTBot`, `User-agent: CCBot`, etc. with Disallow directives | Honor directives for all AI-specific user agents; maintain a registry of known AI crawler identifiers |
| **ai.txt** | Emerging standard (not yet RFC) | Site-level file at `/ai.txt` specifying permitted uses (training, search, RAG, etc.) | Parse and honor; treat as complementary to robots.txt |
| **TDM (Text and Data Mining) reservation** | EU DSM Directive (Article 4) | Publishers declare opt-out from TDM via metadata or headers (`X-TDM-Reservation: 1`) | Must check and honor; legally binding in EU jurisdictions |
| **C2PA content credentials** | Growing adoption | Content metadata includes provenance and licensing information | Extract and forward to indexer; do not strip credentials during processing |
| **Meta robots tags** | Standard | `<meta name="robots" content="noai, noimageai">` | Parse and honor `noai` and `noimageai` directives |

### Implementation Architecture

```
FUNCTION check_ai_crawl_compliance(host, url, content_headers):
    // Step 1: Check robots.txt for AI-specific user agents
    ai_robots = get_robots_directives(host, user_agent = CRAWLER_AI_AGENT)
    IF NOT ai_robots.is_allowed(url.path):
        RETURN BLOCK(reason = "robots.txt AI agent disallow")

    // Step 2: Check ai.txt (if present)
    ai_txt = get_ai_txt(host)
    IF ai_txt IS NOT NULL:
        IF NOT ai_txt.permits_use(intended_use = CRAWLER_PURPOSE):
            RETURN BLOCK(reason = "ai.txt restriction")

    // Step 3: Check TDM reservation header
    IF content_headers["X-TDM-Reservation"] == "1":
        mark_content_as_tdm_reserved(url)
        // Still fetch for search indexing; block from training pipelines

    // Step 4: Check meta robots (post-fetch)
    // This is checked during HTML parsing, not pre-fetch
    RETURN ALLOW
```

### Data Classification

| Data Category | Sensitivity | Handling Requirement |
|---------------|------------|---------------------|
| Publicly accessible HTML content | Low | Standard storage; retention per policy |
| robots.txt files | Low | Cache with TTL; log directive changes |
| PII discovered in page content | High | Pass-through to indexer with PII flag; do not store separately |
| Authentication tokens in URLs | Critical | Strip from URL before storage; never log |
| Crawl access logs (internal) | Medium | Retain 90 days; anonymize IP addresses for long-term storage |
| Host crawl statistics | Low | Retain indefinitely; used for scheduling optimization |
| Fetcher worker identities | Medium | Internal only; never expose in external requests beyond User-Agent |
| Seed URL lists | Medium | Access-controlled; may contain business-sensitive coverage strategy |
| Blocklist/allowlist configuration | Medium | Version-controlled; audit trail for all changes |
| Content hash indices | Low | Rebuild-capable from content store; no PII |
| DNS resolution results | Low | Cache only; no long-term retention |
| Error/failure logs | Medium | Retain 30 days; may contain target host information |

---

## Compliance

### robots.txt as a Legal/Ethical Standard

The Robots Exclusion Protocol (`robots.txt`) is not legally binding in all jurisdictions, but it is the de facto standard for communicating crawl preferences. The crawler treats robots.txt compliance as a hard requirement:

- **Always fetch before crawling:** Never crawl a host without a valid (or confirmed 404) robots.txt
- **Honor all directives:** Disallow, Allow, Crawl-delay, even if the site's content would be valuable
- **Respect meta tags:** `<meta name="robots" content="noindex, nofollow">` and `X-Robots-Tag` HTTP headers
- **Support opt-out:** Provide a mechanism for site owners to request complete removal from the index

### GDPR Considerations

| Requirement | Crawler Impact | Implementation |
|-------------|---------------|----------------|
| Right to erasure | Site owner requests removal of their content from the index | Provide a removal request endpoint; block the host and delete stored content |
| Data minimization | Only collect data necessary for indexing | Do not store cookies, login credentials, or form data; only store publicly accessible page content |
| Lawful basis | Legitimate interest in indexing publicly available information | Document the legitimate interest assessment; provide opt-out via robots.txt |
| Cross-border transfer | Fetcher workers in multiple countries fetch content from different jurisdictions | Content storage centralized in a GDPR-compliant region; fetcher workers do not persist content locally beyond buffering |

### Copyright and Content Licensing

| Concern | Strategy |
|---------|----------|
| Copyrighted content | The crawler fetches and stores publicly available content for indexing purposes; fair use / fair dealing applies in most jurisdictions |
| AI training opt-out | Respect `robots.txt` directives targeting AI crawlers (e.g., `User-agent: GPTBot`, `User-agent: CCBot`); honor the emerging `ai.txt` standard |
| Content licensing headers | Detect and store `X-Robots-Tag` and `<meta>` licensing directives; pass to the indexer for compliance |
| DMCA takedown requests | Integrate with a content removal pipeline for processing legal takedown notices |

### Legal Landscape by Jurisdiction (2025-2026)

| Jurisdiction | Key Regulation | Crawler Impact | Compliance Action |
|-------------|---------------|----------------|-------------------|
| **European Union** | DSM Directive Art. 3-4 (TDM exception) | TDM permitted for research; commercial TDM only if publisher has not opted out | Honor `X-TDM-Reservation` header; respect `robots.txt` for commercial crawling |
| **European Union** | AI Act (effective Aug 2025) | General-purpose AI models must document training data sources; copyright-infringing data prohibited | Maintain crawl provenance logs; respect all opt-out mechanisms |
| **United States** | No federal AI crawling law (as of 2025) | robots.txt not legally binding but industry standard; CFAA (unauthorized access) applies to sites that explicitly block crawlers | Honor robots.txt; respect terms of service; do not bypass technical access controls |
| **Japan** | Copyright Act Art. 30-4 | Broad exception for computational analysis (including AI training) | More permissive; still honor explicit opt-outs as ethical practice |
| **Australia** | Proposed AI regulation (2025) | Expected to follow EU model with TDM opt-out mechanism | Prepare for opt-out compliance; monitor regulatory developments |
| **India** | Digital Personal Data Protection Act 2023 | Applies to personal data processing; publicly available data has limited exemptions | Minimize PII collection; honor data principal rights |

### Incident Response Plan

| Incident Type | Severity | Response Timeline | Actions |
|--------------|----------|-------------------|---------|
| robots.txt violation detected | Critical | Immediate | Stop all crawling of affected host; investigate root cause; notify compliance team; retain evidence |
| Publisher complains about crawl rate | High | 4 hours | Verify politeness compliance; adjust rate if necessary; communicate with publisher |
| DMCA takedown notice received | High | 24 hours | Remove content from store; block URL from recrawl; acknowledge receipt |
| GDPR erasure request received | High | 72 hours | Identify all stored content from the data subject; delete from content store, URL database, and crawl logs |
| Crawler IP blocked by major host | Medium | 24 hours | Investigate cause; verify compliance; contact host's abuse team if blocking is erroneous |
| AI training opt-out not honored | Critical | Immediate | Block affected content from downstream AI pipelines; audit compliance pipeline; notify legal team |
| Crawl budget exhaustion attack detected | Medium | 4 hours | Block offending hosts; review trap detection thresholds; adjust URL budgets |

### Compliance Checklist: Pre-Deployment Gate

| Check | Verification Method | Blocking? |
|-------|--------------------|-----------|
| robots.txt parser handles all edge cases (RFC 9309 compliant) | Automated test suite against 50+ Edge Case (Unusual or extreme situation) robots.txt files | Yes |
| Per-host rate limiting enforced at infrastructure level | Load test against a mock host; verify requests never exceed configured delay | Yes |
| AI-specific user agents handled correctly | Test against robots.txt files with GPTBot, CCBot directives | Yes |
| Meta robots tags (noindex, nofollow, noai) parsed and honored | HTML parsing test suite with tag variants | Yes |
| GDPR erasure pipeline functional | End-to-end test: submit erasure request, verify content deleted within 72h | Yes |
| DMCA takedown pipeline functional | End-to-end test: submit takedown, verify content removed within 24h | Yes |
| Crawl provenance logging active | Verify every fetched page has source URL, timestamp, user-agent logged | Yes |
| Cross-region data transfer compliant | Verify content storage in GDPR-compliant region; fetcher local buffers cleared after write | Yes |
| Admin access audit trail active | Verify all admin API actions logged with operator identity | Yes |
| Emergency crawl stop mechanism tested | Test `/api/v1/crawl/pause` endpoint; verify all fetchers stop within 30 seconds | Yes |

---

## Content Safety Pipeline

### Malicious Content Handling

| Content Type | Detection Method | Action |
|-------------|-----------------|--------|
| Malware-hosting pages | URL reputation database; content pattern matching | Block URL; flag host for review; do not store content |
| Phishing pages | URL pattern analysis; known phishing domain lists | Block URL; report to phishing database; do not index |
| Deceptive redirects | Redirect chain analysis; final domain != initial domain | Log redirect chain; flag for review; enforce redirect depth limit |
| SEO spam / link farms | Low content uniqueness ratio; high outbound link density | Deprioritize host; reduce crawl budget allocation; flag for quality review |
| Illegal content detection | Hash-based matching against known illegal content databases (e.g., NCMEC hash lists) | Immediately block; do not store; report to relevant authority; purge from all caches |
| Excessively large files | Content-Length header check; streaming body size limit | Abort download at 10 MB threshold; log truncation |

### Content Validation at Fetch Time

```
FUNCTION validate_fetched_content(url, response):
    // Check 1: Content type matches expected
    declared_type = response.headers["Content-Type"]
    actual_type = detect_content_type(response.body[:1024])
    IF declared_type != actual_type:
        log_warning("content_type_mismatch", url, declared_type, actual_type)
        // Continue with actual_type for safety

    // Check 2: Body size within limits
    IF response.content_length > MAX_PAGE_SIZE:  // 10 MB
        abort_download(url)
        RETURN REJECTED("oversized")

    // Check 3: Encoding validation
    IF NOT is_valid_encoding(response.body, response.encoding):
        log_warning("encoding_error", url)
        // Attempt UTF-8 fallback

    // Check 4: Known malicious content hash
    content_hash = compute_hash(response.body)
    IF is_known_malicious(content_hash):
        block_url(url)
        flag_host(url.host, reason="malicious_content")
        RETURN REJECTED("malicious")

    RETURN ACCEPTED

```

---

## Operational Security

### Access Control for Crawl Infrastructure

| Component | Access Level | Authentication | Audit |
|-----------|-------------|---------------|-------|
| Seed URL injection | Restricted (Crawler Admin only) | API key + IP allowlist + MFA | Full audit trail |
| Host blocklist management | Restricted (Crawler Admin only) | OAuth2 + OIDC with MFA | Full audit trail; requires 2-person approval for removing blocks |
| Frontier pause/resume | Restricted (Crawler Admin, Crawler Operator) | OAuth2 + OIDC | Full audit trail |
| Crawl statistics viewing | Open (all roles) | SSO | Access logging |
| Fetcher worker fleet management | Restricted (Crawler Admin) | mTLS + RBAC | Full audit trail |
| Configuration changes (politeness settings, thresholds) | Restricted (Crawler Admin) | Version-controlled; PR-based approval | Git audit trail |

### Secret Management

| Secret | Storage | Rotation | Usage |
|--------|---------|----------|-------|
| mTLS certificates (worker ↔ frontier) | Certificate manager | 90 days automatic rotation | Every internal gRPC call |
| Admin API tokens | Secrets manager | 30 days | Admin operations |
| Monitoring platform credentials | Secrets manager | 90 days | Metric/log export |
| Object storage access keys | IAM roles (no static keys) | Continuous (role-based) | Content store writes |
| DNS resolver configuration | Configuration management | On infrastructure change | DNS fallback chain |

---

## Network Security

### Outbound Traffic Controls

The crawler is an unusual system in that its primary traffic flow is outbound (to the web). This creates unique security considerations:

| Control | Implementation | Purpose |
|---------|---------------|---------|
| Outbound IP allowlisting | Fetcher workers use a published, fixed IP range | Site owners can verify legitimate crawler traffic |
| Reverse DNS verification | Crawler IPs resolve to the organization's domain | Standard verification mechanism used by site operators |
| User-Agent consistency | All fetcher workers use identical, documented User-Agent string | Enables site owners to identify and control crawler access |
| TLS certificate validation | Strict certificate chain validation for HTTPS | Prevent MITM attacks on fetched content |
| Private IP blocking | Reject DNS results pointing to private/reserved IP ranges | Prevent SSRF (Server-Side Request Forgery) attacks via crafted DNS records |
| Internal network isolation | Fetcher workers cannot access internal services (only outbound to public web) | Prevent compromised fetcher from being used as a pivot point |

### Fetcher Worker Hardening

| Hardening Measure | Purpose |
|-------------------|---------|
| Minimal OS installation | Reduce attack surface; no unnecessary packages |
| Read-only root filesystem | Prevent persistent malware installation |
| Network namespace isolation | Each worker's network stack is isolated |
| Content parsing in sandbox | HTML parsing runs in a resource-limited sandbox (CPU, memory, time) |
| No outbound connections except HTTP/HTTPS + DNS | Firewall blocks all other protocols from fetcher workers |
| Automated vulnerability scanning | Weekly scan of worker images for known CVEs |
| Immutable infrastructure | Workers are replaced, never patched in-place |
