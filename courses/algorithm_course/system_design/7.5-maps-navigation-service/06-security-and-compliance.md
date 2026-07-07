# Security & Compliance — Maps & Navigation Service

## Authentication & Authorization

### API Key Model (B2B Clients)

| Client Type | Authentication | Access |
|---|---|---|
| Business API consumers | API key in header (`X-API-Key`) | Tile, Route, Geocode, Search APIs |
| Premium partners | API key + IP allowlist | Higher rate limits, SLA guarantees |
| Internal services | mTLS (mutual TLS) | Full access, no rate limits |

### End-User Authentication (B2C Apps)

| Feature | Authentication | Rationale |
|---|---|---|
| Map viewing (tiles) | None (public) | Tiles are public data; unauthenticated for performance |
| Routing | None or light (device fingerprint) | Low-risk, stateless queries |
| Navigation sessions | OAuth2 bearer token | Stateful sessions tied to user account |
| Saved places / history | OAuth2 bearer token | Personal data requires authentication |
| Traffic reporting | OAuth2 or anonymous + device ID | Balance contribution ease with abuse prevention |

---

## Rate Limiting

### Per-API Rate Limits

| API | Free Tier | Standard Tier | Enterprise Tier |
|---|---|---|---|
| Tile API | 1,000 req/min | 10,000 req/min | 100,000 req/min |
| Route API | 50 req/min | 500 req/min | 5,000 req/min |
| Geocode API | 50 req/min | 500 req/min | 5,000 req/min |
| Search API | 100 req/min | 1,000 req/min | 10,000 req/min |
| Traffic API | 20 req/min | 200 req/min | 2,000 req/min |
| Navigation API | 10 sessions/min | 100 sessions/min | 1,000 sessions/min |

### Abuse Protection

| Threat | Detection | Mitigation |
|---|---|---|
| Tile scraping (bulk download) | High tile request rate from single key/IP | Progressive rate limiting → CAPTCHA → block |
| Route API abuse (competitor data harvesting) | Unusual origin/destination patterns | Anomaly detection; require API key with billing |
| Geocoding enumeration | Sequential address queries | Rate limit per IP; require authentication for bulk |
| GPS spoofing (fake traffic probes) | Speed/location inconsistencies | Validate probe physics (max acceleration, speed limits) |
| DDoS on tile origin | Sudden cache-miss spike | CDN absorbs; origin auto-scales; serve stale on overload |

### Hotspot Protection

Popular locations generate disproportionate tile traffic. For example, a major event (concert, sports game) causes thousands of users to view the same area simultaneously:

- **CDN naturally handles this**: popular tiles are cached at every edge node
- **Thundering herd on new tiles**: Use request coalescing at origin — if 100 simultaneous requests arrive for the same uncached tile, only 1 triggers generation; the other 99 wait for the result
- **Rate limit per geographic cell**: Prevent one area from monopolizing origin tile generation capacity

---

## Privacy

### Probe Vehicle Data Privacy

GPS traces from probe vehicles are the most sensitive data in the system. A raw trace reveals where a person drove, when, and how fast.

**Anonymization pipeline:**

```
Raw probe data:
  { user_id: "abc123", trace: [(lat, lng, time), ...] }

Step 1 — Strip user identity:
  { probe_id: random_uuid(), trace: [(lat, lng, time), ...] }
  // probe_id rotates every session; no link to user account

Step 2 — Truncate trace endpoints:
  Remove first 200m and last 200m of trace
  // Prevents identification of home/work addresses

Step 3 — Temporal fuzzing:
  Add random offset ±30 seconds to timestamps
  // Prevents exact timeline reconstruction

Step 4 — Aggregate before storage:
  Convert trace to per-segment speeds
  Store only: { edge_id, timestamp_bucket, speed_kmh }
  // Individual traces are NEVER stored long-term
```

### Navigation History

| Data | Retention | User Control |
|---|---|---|
| Active navigation session | Duration of trip | Auto-deleted on session end |
| Recent destinations | 90 days | User can view and delete |
| Search history | 90 days | User can view and delete |
| Saved/favorite places | Indefinite | User can manage |
| Probe GPS traces | Aggregated to speeds immediately; raw deleted within 24h | Opt-out available |

### Data Subject Rights (GDPR/CCPA)

| Right | Implementation |
|---|---|
| Right to access | Export all personal data (saved places, history, sessions) as JSON |
| Right to deletion | Delete all personal data within 30 days; anonymized aggregates retained |
| Right to portability | Standard format export of saved places and route history |
| Right to object | Opt out of probe data collection; navigation still works without contributing |
| Data minimization | Only collect data necessary for service delivery |

---

## Geopolitical Compliance

### Disputed Territory Rendering

Maps must respect territorial disputes and render borders differently based on the **user's country of access**:

| Disputed Region | View from Country A | View from Country B | Neutral View |
|---|---|---|---|
| Region with competing claims | Shown as part of Country A | Shown as part of Country B | Shown with disputed boundary (dashed line) |

**Implementation:**
1. Determine user's country from IP geolocation or device locale setting
2. Tile server selects the appropriate **border variant** for that country
3. Pre-generate border-variant tiles for disputed regions (typically < 100 affected tiles per variant)
4. Routing near borders must also respect the user's perspective (some roads may not be shown)

### Map Data Licensing

| Data Source | License | Requirements |
|---|---|---|
| OpenStreetMap | ODbL (Open Database License) | Attribution required; share-alike for derived databases |
| Government datasets | Varies by country | Some require attribution; some restrict commercial use |
| Satellite imagery | Commercial license | Display-only; no redistribution |
| User contributions | Contributor agreement | Users grant platform usage rights |

**Attribution compliance**: Map tiles must include "© OpenStreetMap contributors" (or appropriate attribution) visible on every map view.

---

## Data Security

### Encryption

| Data State | Encryption | Details |
|---|---|---|
| In transit | TLS 1.3 | All API communication; HSTS enforced |
| Tile serving | TLS at CDN edge | CDN terminates TLS; origin connection also TLS |
| At rest (tiles) | Server-side encryption | Object storage default encryption |
| At rest (user data) | AES-256 | Navigation history, saved places |
| At rest (traffic) | Not encrypted | Aggregated, anonymized speed data |
| Probe GPS traces | AES-256 (short-lived) | Encrypted in Kafka; deleted after processing |

### Access Control

| System | Access Model |
|---|---|
| Object storage (tiles) | Public read via CDN; write restricted to pipeline service accounts |
| Road graph (in-memory) | Internal only; no external access |
| Spatial DB (geocoding) | Internal read replicas; write restricted to data pipeline |
| Redis (traffic) | Internal only; VPC-restricted |
| User data (sessions, history) | Per-user isolation; API enforces ownership checks |

---

## Compliance Matrix

| Regulation | Applicability | Key Requirements |
|---|---|---|
| GDPR | European users | Consent for probe collection; data deletion; DPO appointed |
| CCPA | California users | Do-not-sell opt-out; data disclosure on request |
| China cybersecurity law | Chinese users | Map data stored on Chinese servers; government review of map accuracy |
| India geospatial policy | Indian users | Certain map data requires government approval for export |
| Export controls | Global | Certain high-resolution mapping data may have export restrictions |

---

## Security Incident Response

| Scenario | Response | RTO |
|---|---|---|
| API key compromise | Revoke key immediately; issue new key; audit usage logs | < 5 min |
| Probe data breach | Notify affected users (if identifiable); data is anonymized, limiting impact | < 1 hour |
| CDN compromise | Switch to backup CDN; invalidate all edge caches; re-validate origin | < 30 min |
| GPS spoofing attack (mass fake traffic) | Anomaly detection flags inconsistent probes; quarantine suspicious sources; rollback affected speed data | < 15 min |
| Tile data poisoning (tampered map data) | Validate tile checksums at CDN edge; regenerate affected tiles from trusted source | < 2 hours |
| Graph data tampering | Checksum verification on graph load; rollback to last known good; rebuild from source | < 6 hours |

---

## Zero-Trust Architecture

### Service Mesh Communication

All internal service-to-service communication uses mutual TLS (mTLS) with short-lived certificates:

| Communication Path | Authentication | Authorization | Encryption |
|---|---|---|---|
| API Gateway → Backend Services | mTLS (service identity) | Service-level RBAC | TLS 1.3 |
| Route Service → Redis | mTLS + password | Read/Write per service | TLS 1.3 |
| Traffic Pipeline → Kafka | mTLS (consumer identity) | ACL per topic/partition | TLS 1.3 |
| Tile Service → Object Storage | IAM role (short-lived tokens) | Bucket-level policy | TLS 1.3 |
| CDN → Origin | Origin pull certificate | IP allowlist + secret header | TLS 1.3 |

### Privileged Access Management

| Access Level | Who | Controls |
|---|---|---|
| **L1: Read-only operations** | On-call engineers | Read dashboards, logs, metrics; no data access |
| **L2: Service management** | Service owners | Restart services, scale instances, trigger graph redeploy |
| **L3: Data access** | Data engineers + approval | Access raw probe data, geocoding indexes; audit-logged |
| **L4: Infrastructure admin** | Platform team + MFA + peer approval | Modify CDN config, Kafka ACLs, object storage policies |

---

## Location Privacy Deep Dive

### Differential Privacy for Aggregate Traffic

When publishing traffic data to third-party consumers (city planning APIs, congestion reports), apply differential privacy:

```
FUNCTION publishTrafficWithPrivacy(segmentSpeeds, epsilon=1.0):
    // Add Laplacian noise to aggregate speed data
    FOR EACH segment IN segmentSpeeds:
        sensitivity = segment.maxSpeed - segment.minSpeed  // data range
        noise = laplacianNoise(scale = sensitivity / epsilon)
        segment.publishedSpeed = segment.avgSpeed + noise

        // Suppress segments with too few probes (k-anonymity)
        IF segment.probeCount < 5:
            segment.publishedSpeed = NULL  // suppress; not enough diversity

    RETURN segmentSpeeds
```

### On-Device Privacy Processing

Modern navigation platforms increasingly process sensitive data on-device rather than server-side:

| Data | On-Device Processing | Server Receives |
|---|---|---|
| **Location history** | Stored and managed locally | Only during active navigation session |
| **Frequent places** | ML model learns on-device (federated learning) | Aggregated model updates (no individual data) |
| **Speed observations** | Computed on-device | Anonymized per-segment speed only |
| **Search history** | Stored locally with user-controlled deletion | Hashed query for autocomplete improvement |
| **Offline routes** | Computed entirely on-device | Nothing (no network involved) |

---

## Anti-Scraping Protection

### Map Data as Intellectual Property

Map data is expensive to produce (satellite imagery, ground truth surveys, user contributions). Competitors scraping tiles or routing data undermines this investment.

| Attack Vector | Detection Method | Response |
|---|---|---|
| **Systematic tile download** (grid pattern) | Access pattern analysis: sequential z/x/y requests; low zoom diversity | Progressive throttle → CAPTCHA → API key revocation |
| **Routing data harvesting** | High volume of diverse O-D pairs from single key; no navigation sessions | Rate limit routing API; require billing for bulk |
| **Geocoding enumeration** | Sequential address queries (incrementing house numbers) | Detect sequential patterns; require auth for bulk |
| **POI scraping** | Grid-based search queries covering entire city | Limit search radius; require auth; monitor coverage patterns |

### Tile Watermarking

Invisible watermarks embedded in vector tile geometry (sub-meter coordinate perturbations) allow tracing leaked tiles back to the API key that downloaded them. The perturbations are small enough to be invisible on the map but unique enough to identify the source.

---

## Geopolitical Compliance Deep Dive

### Country-Specific Map Requirements

| Country | Requirement | Implementation |
|---|---|---|
| **China** | All map data must be stored on servers in China; GCJ-02 coordinate system required (offset from WGS84) | Separate deployment in Chinese data centers; coordinate transformation layer |
| **India** | Map data export requires government approval; certain border areas restricted | India-specific tile variants; export controls on geocoding data |
| **Russia** | High-resolution mapping requires FSB license; Western sanctions limit data sharing | Separate data pipeline for Russian territory; sanctions compliance checks |
| **South Korea** | Map data cannot be exported; local servers required | Dedicated South Korean deployment; no cross-border data flow |
| **EU** | GDPR applies to all probe data; right to erasure for location history | Probe anonymization pipeline; 24h raw data deletion; user data export API |

### Disputed Territory Rendering — Implementation Detail

```
FUNCTION selectTileVariant(tileAddress, userCountry):
    // Check if this tile intersects any disputed region
    disputedRegions = getDisputedRegions(tileAddress)

    IF disputedRegions IS EMPTY:
        RETURN defaultTile(tileAddress)

    // Select variant based on user's country
    FOR EACH dispute IN disputedRegions:
        IF userCountry IN dispute.claimantA_countries:
            RETURN tileVariant(tileAddress, dispute.id, variant="A")
        ELSE IF userCountry IN dispute.claimantB_countries:
            RETURN tileVariant(tileAddress, dispute.id, variant="B")
        ELSE:
            RETURN tileVariant(tileAddress, dispute.id, variant="NEUTRAL")
    // Neutral variant shows dashed borders for disputed areas

// CDN implementation: User country determined at edge via IP geolocation
// Tile URL becomes: /tiles/{z}/{x}/{y}.mvt?cc={country_code}
// CDN varies cache key by country_code for disputed-area tiles only
```

---

## Security Testing Program

| Test Type | Frequency | Scope | Owner |
|---|---|---|---|
| API penetration testing | Quarterly | All public APIs (Tile, Route, Geocode, Search, Traffic) | Security team |
| GPS spoofing simulation | Monthly | Traffic pipeline validation and anomaly detection | Traffic team |
| CDN configuration audit | Monthly | Cache headers, TLS config, origin protection, access logs | Infrastructure team |
| Tile integrity verification | Daily (automated) | Random sample of tiles checked against source data checksums | Data pipeline team |
| Rate limit testing | Weekly (automated) | Verify rate limits enforced correctly per tier per API | API team |
| Data privacy audit | Quarterly | Probe anonymization, retention compliance, GDPR/CCPA | Legal + Engineering |
| Geopolitical compliance review | Monthly | Disputed territory rendering verified per jurisdiction | Compliance team |
| Dependency vulnerability scan | Weekly (automated) | All service dependencies checked against CVE databases | Security team |

---

## Tile Integrity and Supply Chain Security

### Tile Signing

Vector tiles delivered via CDN can be tampered with in transit if the CDN edge is compromised. To prevent this:

1. **Tile content hash**: Each tile's ETag is a SHA-256 hash of its content. Client verifies hash matches response body
2. **Tile manifest signing**: The tile generation pipeline produces a signed manifest listing all valid tile hashes. CDN edge nodes can verify tiles against the manifest before caching
3. **Source data provenance**: Each tile embeds a `source_version` field linking it to the specific map data version used for generation, enabling audit trails

### API Key Security Best Practices

| Practice | Implementation |
|---|---|
| Key rotation | Automatic rotation every 90 days; grace period for old key |
| Key scoping | Per-API restrictions (tile-only key, route-only key) |
| Referrer restrictions | Tile API keys restricted to specific domains (web) or app bundle IDs (mobile) |
| Usage alerts | Notify when key usage exceeds 80% of tier limit |
| Key hierarchy | Master key generates scoped sub-keys; revoke master to invalidate all sub-keys |

---

## Audit Logging

| Event | Logged Fields | Retention | Purpose |
|---|---|---|---|
| API key creation/revocation | key_id, creator, scope, timestamp | 2 years | Security audit trail |
| Rate limit exceeded | key_id, API, limit_hit, request_count | 90 days | Abuse detection |
| Geopolitical variant served | tile_address, detected_country, variant_id | 1 year | Compliance proof |
| Probe data deletion | batch_id, record_count, deletion_timestamp | 5 years | GDPR compliance evidence |
| Graph deployment | version_id, deployer, checksum, regions | 2 years | Change tracking |
| CDN configuration change | change_type, old_value, new_value, approver | 2 years | Infrastructure audit |
| Disputed territory override | admin_id, dispute_id, change_description, approval_chain | Indefinite | Legal compliance |
