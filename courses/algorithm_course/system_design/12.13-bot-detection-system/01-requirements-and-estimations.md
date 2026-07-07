# 01 — Requirements & Estimations: Bot Detection System

## Functional Requirements

| # | Requirement | Description |
|---|---|---|
| FR-01 | **Request Evaluation** | Evaluate every inbound HTTP request and produce a bot probability score [0.0, 1.0] within p99 < 50ms |
| FR-02 | **Signal Collection** | Collect behavioral signals (mouse dynamics, keystroke timing, scroll patterns, touch events) via injected JavaScript |
| FR-03 | **Device Fingerprinting** | Generate a stable device fingerprint from canvas hash, WebGL renderer, AudioContext output, font enumeration, and browser API characteristics |
| FR-04 | **Network Signal Analysis** | Evaluate IP reputation, ASN classification, TLS fingerprint (JA3/JA4 hash), HTTP/2 frame ordering, and request timing patterns |
| FR-05 | **Risk Scoring** | Combine 100+ features into a calibrated risk score using a multi-tier ML ensemble (edge lightweight model + cloud deep model) |
| FR-06 | **Progressive Challenge Issuance** | Issue challenges matched to risk score: invisible passive JS → proof-of-work → interactive CAPTCHA → hard block |
| FR-07 | **Session Reputation Tracking** | Maintain per-session trust scores that accumulate across request sequences and decay over idle time |
| FR-08 | **Allowlisting** | Support verified crawler allowlisting (search engines via signed IP ranges), API key bypass, and customer-configured automation exceptions |
| FR-09 | **Challenge Verification** | Server-side verify challenge responses with cryptographic tokens; reject replayed or forged tokens |
| FR-10 | **Threat Intelligence Integration** | Ingest and act on external IP reputation feeds, bot signature databases, and dark-web threat reports |
| FR-11 | **Model Management** | Support A/B testing of model versions, shadow scoring (new model runs but doesn't act), and rollback within 5 minutes |
| FR-12 | **False Positive Reporting** | Provide an appeal path for challenged or blocked users; feed confirmed false positives back into model retraining |
| FR-13 | **Dashboard & Alerting** | Expose real-time detection rate, challenge rate, block rate, false positive rate, and model drift metrics to operators |
| FR-14 | **Bot Taxonomy Classification** | Classify detected bots by type: simple script, headless browser, browser farm, residential proxy botnet |

---

## Out of Scope

- **DDoS volumetric mitigation** — rate-limit and bandwidth-based flood defense is handled by a separate traffic scrubbing layer
- **Application-layer WAF rules** — SQL injection, XSS, and injection attack detection handled by a dedicated WAF
- **Authenticated session management** — post-login fraud signals (account takeover) are handled by a dedicated fraud scoring system
- **Content scraping legal enforcement** — bot detection identifies and blocks scrapers; legal action is out of scope
- **Network-level firewall** — IP blocking at the BGP/Anycast layer is handled by network infrastructure, not this system

---

## Non-Functional Requirements

### Performance
| Metric | Target |
|---|---|
| Edge decision latency (p50) | < 2ms |
| Edge decision latency (p99) | < 5ms |
| Full ML evaluation latency (p99) | < 50ms |
| Challenge token verification latency (p99) | < 20ms |
| Signal collection JS payload size | < 15KB minified + gzipped |
| Signal beacon upload latency (p99) | < 100ms |

### Availability & Reliability
| Metric | Target |
|---|---|
| System availability | 99.99% (< 52 min/year downtime) |
| Edge evaluation availability (independent of cloud) | 99.999% via cached models |
| Graceful degradation | Allow all traffic on scoring system failure (fail open) |
| Model update rollout time | < 5 minutes to all edge nodes |
| Challenge verification uptime | 99.99% with multi-region replication |

### Accuracy
| Metric | Target |
|---|---|
| Bot detection rate (recall) | > 95% of known bot traffic |
| False positive rate | < 0.1% of human sessions challenged incorrectly |
| False negative rate | < 5% of bot sessions pass undetected |
| Challenge solve rate by humans | > 99% (accessibility constraint) |
| Challenge solve rate by bots | < 5% for interactive CAPTCHA tier |

### Scale
| Metric | Target |
|---|---|
| Peak request throughput | 5 million requests/second globally |
| Concurrent sessions tracked | 500 million active sessions |
| Signal events collected | 50 billion events/day |
| ML inference calls/day | 5 billion (edge) + 500 million (cloud deep model) |

---

## Capacity Estimations

### Traffic Volume

```
Global peak web traffic (2026): ~5M req/sec
  ├─ 51% bot traffic = 2.55M bot req/sec
  ├─ 37% malicious bots = 1.85M req/sec
  └─ 14% benign bots (crawlers, monitors) = 0.7M req/sec

Per customer (large e-commerce): ~50,000 req/sec peak
Per customer (mid-market SaaS): ~5,000 req/sec peak
```

### Signal Collection Volume

```
Behavioral signals per session:
  - Mouse events: ~200 events/min × 5 min avg session = 1,000 events
  - Keystroke events: ~150 keystrokes/min × 5 min = 750 events
  - Scroll events: ~50 events/min × 5 min = 250 events
  Total: ~2,000 behavioral events/session

Sessions/day: 500M active sessions
Events/day: 500M × 2,000 = 1 trillion events/day (raw)
After aggregation to features: 50B feature vectors/day
```

### Signal Beacon Payload

```
Per beacon (sent every 30 sec):
  - Mouse trajectory: 300 events × 3 floats (x, y, t) = 900 floats = 3.6KB raw
  - Keystroke timing: 75 events × 2 floats (key, t) = 150 floats = 600B
  - Scroll data: 25 events × 2 floats (pos, t) = 200B
  - Device fingerprint: one-time, ~2KB
  Compressed payload: ~1.5KB per beacon

Total beacon bandwidth: 500M sessions × 10 beacons × 1.5KB = 7.5 TB/day ingested
```

### ML Inference Compute

```
Edge lightweight model (gradient boosted tree, 100 features):
  - Inference time: ~0.5ms per request
  - At 5M req/sec: 5M × 0.5ms = 2,500 CPU-seconds/sec = 2,500 cores sustained
  - Model size: ~5MB, fits in L2 cache

Cloud deep model (neural network, 500 features):
  - Invoked for borderline scores (0.3–0.7 range): ~20% of requests = 1M req/sec
  - Inference time: ~10ms per request
  - At 1M req/sec: GPU-accelerated, ~500 A100-equivalent GPU-seconds/sec
  - Model size: ~200MB, served from GPU memory

Daily training (cloud):
  - Training dataset: 50B feature vectors/day × 200B each = 10TB
  - Training time: ~4 hours on 64 GPU cluster
  - Model validation + shadow scoring: 1 hour
  - Total pipeline: ~5 hours/day
```

### Storage

```
Session state (Redis-compatible distributed cache):
  - Per session: session ID (16B) + risk score (4B) + feature snapshot (500B) + challenge state (100B) ≈ 620B
  - 500M concurrent sessions × 620B = 310GB hot storage (in-memory)
  - TTL: 30 minutes inactive

Fingerprint database:
  - Per fingerprint: hash (32B) + metadata (200B) + first-seen/last-seen (16B) + risk tag (4B) ≈ 252B
  - Unique fingerprints seen: ~5B (many reused across sessions)
  - Total: 5B × 252B = 1.26TB (cold storage with hot cache for recent 100M)

Event store (behavioral telemetry):
  - 50B feature vectors/day × 200B = 10TB/day
  - Retention: 90 days for model retraining = 900TB total
  - Compressed at 3:1 ratio = 300TB

Threat intelligence:
  - IP blocklist: 500M IPs × 20B = 10GB
  - Bot signatures: 1M signatures × 500B = 500GB
  Total threat intelligence: ~5TB
```

---

## Service Level Objectives (SLOs)

| SLO | Target | Measurement |
|---|---|---|
| Edge scoring P99 latency | ≤ 5ms | 99th percentile over 1-minute windows |
| Challenge issuance rate for human users | ≤ 2% | % of human-verified sessions receiving any challenge |
| Bot block rate for verified bot traffic | ≥ 90% | % of known bot sessions blocked or hard-challenged |
| System availability | ≥ 99.99% | Uptime measured per edge PoP; any PoP degradation triggers alert |
| Model freshness | ≤ 6 hours | Time since last successful model deployment to all edge nodes |
| False positive appeal resolution | ≤ 1 hour | Time from human appeal submission to unblock |
| Threat intelligence feed lag | ≤ 15 minutes | Time from IP flagged in external feed to enforcement |

---

## Derived Requirements from Scale

### Signal Processing Budget

```
Per-request latency budget at edge (target: < 5ms total):
  ├─ Session cache lookup:       0.3ms  (in-process LRU)
  ├─ IP reputation lookup:       0.2ms  (in-process bloom filter + local table)
  ├─ Fingerprint cache lookup:   0.5ms  (regional cache, < 1ms p99)
  ├─ Feature vector assembly:    0.5ms  (concatenate cached features)
  ├─ Edge ML inference:          1.5ms  (GBT in-process, 100 features)
  ├─ Decision + token gen:       0.5ms  (threshold check + HMAC if challenge)
  └─ Response encoding:          0.2ms
  Total:                         3.7ms  (budget: 5ms p99, 1.3ms headroom)

For cloud deep model escalation (target: < 50ms total):
  ├─ Edge → cloud network hop:  10ms   (intra-region)
  ├─ Feature enrichment:         5ms   (add 400 features from feature store)
  ├─ Batch accumulation wait:    5ms   (max wait for batch fill)
  ├─ GPU inference:             15ms   (neural net, batch of 128)
  ├─ Result return:             10ms   (network return)
  └─ Edge decision application:  1ms
  Total:                        46ms   (budget: 50ms p99)
```

### Behavioral Data Processing Budget

```
50B feature vectors/day = 579K feature vectors/sec
  ├─ Each vector: ~200 bytes (100 floats × 2 bytes compressed)
  ├─ Ingestion bandwidth: 579K × 200B = 116 MB/sec sustained
  ├─ Peak (Monday 9 AM, attacks): 5x = 580 MB/sec
  ├─ Feature workers needed (10K events/sec per worker): ~58 workers
  └─ With 3x headroom for bursts: 174 feature workers

Behavioral feature latency budget (beacon → session score update):
  ├─ Beacon receipt → publish to stream:  5ms
  ├─ Stream → feature worker delivery:   10ms
  ├─ Feature computation (rolling stats): 2ms
  ├─ Session score update (cache write):  3ms
  Total: 20ms (well within 1-second freshness target)
```

### Model Retraining Compute Budget

```
Daily retraining pipeline:
  ├─ Data extraction: 10TB from event store, columnar scan → 1 hour
  ├─ Feature engineering: 50B vectors → normalized features → 1 hour
  ├─ Edge model training (GBT, 100 features, 100 trees):
  │   └─ 64 GPUs × 30 min = 32 GPU-hours
  ├─ Deep model training (ensemble + NN, 500 features):
  │   └─ 64 GPUs × 3 hours = 192 GPU-hours
  ├─ Calibration (isotonic regression on held-out set): 15 min
  ├─ Validation (AUC, FPR, latency checks): 30 min
  ├─ Shadow scoring (5% traffic, 1 hour): 1 hour
  └─ Edge propagation (5,000+ PoPs): 5 min
  Total pipeline: ~7.5 hours end-to-end
  Daily GPU cost: ~224 GPU-hours × $2/GPU-hour = ~$448/day
```

---

## AI-Era Bot Detection Requirements (2025–2026)

### LLM-Powered Bot Threats

| Threat | Description | Detection Approach |
|--------|-------------|-------------------|
| **LLM CAPTCHA solvers** | Vision-language models solve image CAPTCHAs at 80–90% accuracy | Shift to temporal/behavioral challenges; require sustained real-time interaction |
| **LLM-guided scraping** | LLMs parse page structure to extract data without brittle selectors | Content watermarking; honeypot content traps; request pattern analysis |
| **AI-synthesized behavioral data** | Neural networks generate realistic mouse trajectories and keystroke timing | Cross-session population clustering; second-order statistical artifacts |
| **Automated social engineering** | LLM-powered bots conduct convincing multi-turn interactions | Post-interaction fraud correlation; velocity checks on high-value actions |

### Platform Attestation Requirements

| Platform | Attestation Signal | Confidence | Integration |
|----------|-------------------|------------|-------------|
| **Apple devices** | Private Access Tokens (PAT) via Privacy Pass | Very High | Token presented in HTTP header; cryptographic proof of genuine device |
| **Android devices** | Play Integrity API attestation | High | Signed verdict from platform; verifies unmodified OS and app |
| **Windows devices** | TPM-based attestation | High | Hardware-bound identity; available in Edge and enterprise browsers |
| **WebAuthn-capable** | FIDO2 passkey attestation | Very High | Hardware security key or platform authenticator; near-certain human |
| **No attestation** | Fingerprint + behavioral only | Medium | Legacy path; relies on statistical detection without platform guarantees |
