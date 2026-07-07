# 03 — Low-Level Design: Bot Detection System

## Data Models

### Session Record

```
SessionRecord {
    session_id:        bytes[16]        // random 128-bit identifier
    fingerprint_hash:  bytes[32]        // SHA-256 of device fingerprint vector
    created_at:        timestamp
    last_seen_at:      timestamp
    request_count:     int32
    risk_score:        float32          // current session risk score [0.0, 1.0]
    score_confidence:  float32          // model confidence in score
    challenge_state:   enum {
                           NONE,
                           JS_CHALLENGE_ISSUED,
                           JS_CHALLENGE_PASSED,
                           POW_ISSUED,
                           POW_PASSED,
                           CAPTCHA_ISSUED,
                           CAPTCHA_PASSED,
                           BLOCKED
                       }
    challenge_issued_at: timestamp
    challenge_token:   bytes[32]        // HMAC token for server-side verification
    human_verified_at: timestamp        // time of last positive human verification
    ip_history:        []IPRecord       // last 10 IPs seen in session
    user_agent:        string
    session_tags:      []string         // e.g., "search_bot_allowlisted", "api_key_bypass"
    behavioral_summary: BehavioralFeatures
    ttl:               duration         // expires after 30 min inactivity
}

IPRecord {
    ip_address:    string
    first_seen:    timestamp
    asn:           int32
    country_code:  string
    reputation_score: float32           // from threat intel feeds, 0=clean 1=malicious
    is_residential: bool
    is_datacenter:  bool
    is_tor_exit:    bool
    is_vpn:         bool
}
```

### Device Fingerprint

```
DeviceFingerprint {
    fingerprint_hash:   bytes[32]       // primary key: SHA-256 of canonical feature vector
    raw_signals: {
        // Browser Environment
        user_agent:          string
        accept_language:     string
        platform:            string     // navigator.platform
        hardware_concurrency: int32     // navigator.hardwareConcurrency
        device_memory:       float32    // navigator.deviceMemory (GB)
        screen_resolution:   [int32, int32]
        color_depth:         int32
        timezone_offset:     int32
        timezone_name:       string
        do_not_track:        string

        // Graphics Fingerprints
        canvas_hash:         bytes[32]  // SHA-256 of canvas pixel array
        webgl_vendor:        string     // renderer.vendor
        webgl_renderer:      string     // full renderer string
        webgl_extensions:    []string
        webgl_params_hash:   bytes[32]  // hash of ~40 WebGL parameter values
        webgpu_adapter_info: string     // WebGPU adapter description if available

        // Audio Fingerprint
        audio_context_hash:  bytes[32]  // SHA-256 of AudioContext oscillator output vector

        // Font & Plugin Enumeration
        installed_fonts:     []string   // subset of measured fonts
        plugin_count:        int32
        mime_type_count:     int32

        // API Availability Probes
        has_webdriver:       bool       // navigator.webdriver flag
        has_chrome_runtime:  bool       // window.chrome.runtime presence
        has_permissions_api: bool
        has_notification_api: bool
        worker_types:        []string   // SharedWorker, ServiceWorker, etc.

        // Timing Characteristics
        performance_timing:  PerformanceTiming
        crypto_timing:       float32    // time to execute standard PBKDF2 operation (ms)
    }
    consistency_score:   float32        // internal consistency of signals (0=inconsistent, 1=consistent)
    bot_probability:     float32        // model-assigned bot probability for this fingerprint
    first_seen:          timestamp
    last_seen:           timestamp
    session_count:       int32
    ip_diversity:        int32          // number of distinct IPs that used this fingerprint
    known_bot:           bool
    allowlisted:         bool
}
```

### Risk Score Record

```
RiskScoreRecord {
    request_id:          string         // UUID for this evaluation
    session_id:          bytes[16]
    fingerprint_hash:    bytes[32]
    timestamp:           timestamp
    risk_score:          float32        // final score after fusion
    score_breakdown: {
        behavioral_score:  float32     // contribution from behavioral signals
        fingerprint_score: float32     // contribution from device fingerprint
        network_score:     float32     // contribution from IP/TLS/ASN
        session_score:     float32     // contribution from session history
    }
    model_version:       string
    features_used:       int32         // number of features available for this request
    action_taken:        enum { ALLOW, JS_CHALLENGE, CAPTCHA, BLOCK }
    challenge_type:      string        // if challenge issued: "pow" | "interactive_v1" | ...
    evaluation_tier:     enum { EDGE, CLOUD_DEEP }
    latency_ms:          float32       // time taken to produce score
}
```

### Challenge Record

```
ChallengeRecord {
    token:               bytes[32]      // HMAC-SHA256 token, primary key
    session_id:          bytes[16]
    issued_at:           timestamp
    expires_at:          timestamp      // typically 5 minutes after issuance
    challenge_type:      enum { JS_PROBE, PROOF_OF_WORK, INTERACTIVE_IMAGE, INTERACTIVE_AUDIO }
    challenge_params:    ChallengeParams
    solved:              bool
    solved_at:           timestamp
    solve_duration_ms:   int32          // time taken by client to solve
    solve_attempt_count: int32
    environment_report:  EnvironmentReport  // JS probe results from client
}

ChallengeParams {
    // For PROOF_OF_WORK:
    nonce:           bytes[16]
    difficulty:      int32              // leading zero bits required in hash
    algorithm:       string             // "sha256" or "argon2id"

    // For INTERACTIVE_IMAGE:
    task_type:       string             // "select_objects" | "rotation" | "pattern_match"
    image_set_id:    string
    correct_answers: []int32            // encrypted, server-side only
}
```

---

## API Design

### Signal Ingestion API (Client → Beacon Collector)

```
POST /v1/beacon
Content-Type: application/octet-stream   // protobuf-encoded payload

Request {
    session_token:      bytes[32]        // signed session identifier
    sequence_number:    int32            // monotonically increasing per session
    timestamp_ms:       int64
    mouse_events:       []MouseEvent
    keystroke_events:   []KeystrokeEvent
    scroll_events:      []ScrollEvent
    touch_events:       []TouchEvent
    environment_probe:  EnvironmentProbe // first beacon only
}

MouseEvent {
    timestamp_ms:  int32    // relative to session start
    x:             int16
    y:             int16
    event_type:    enum { MOVE, CLICK, MOUSEDOWN, MOUSEUP, ENTER, LEAVE }
    button:        int8     // 0=left, 1=middle, 2=right
}

KeystrokeEvent {
    timestamp_ms:  int32
    key_code:      int16
    event_type:    enum { KEYDOWN, KEYUP }
    // Note: actual key character never sent for privacy
}

Response {
    session_token:  bytes[32]   // refreshed token
    next_beacon_ms: int32       // suggested interval for next beacon
    challenge:      Challenge   // if system wants to issue a challenge
}
```

### Scoring API (Internal: Edge → Cloud)

```
POST /internal/v1/score
Authorization: service-mesh-mTLS

Request {
    request_id:        string
    session_id:        bytes[16]
    fingerprint_hash:  bytes[32]
    ip_address:        string
    user_agent:        string
    tls_fingerprint:   string    // JA4 hash
    http2_settings:    bytes     // serialized HTTP/2 SETTINGS frame
    endpoint_id:       string    // identifies which product endpoint was hit
    request_features:  RequestFeatures
    session_snapshot:  SessionSnapshot   // cached session state from edge
}

Response {
    request_id:    string
    risk_score:    float32
    confidence:    float32
    action:        enum { ALLOW, JS_CHALLENGE, POW_CHALLENGE, CAPTCHA, BLOCK }
    reasoning:     []string    // human-readable signal contributions (for operators)
    model_version: string
    ttl_ms:        int32       // how long this score can be cached for this session
}
```

### Challenge Verification API (Client → Challenge Verifier)

```
POST /v1/challenge/verify

Request {
    session_token:   bytes[32]
    challenge_token: bytes[32]
    challenge_type:  string
    solution: {
        // For PROOF_OF_WORK:
        nonce_solution: bytes[8]     // discovered nonce producing valid hash
        hash_proof:     bytes[32]    // resulting hash with required leading zeros

        // For INTERACTIVE_IMAGE:
        answer_indices: []int32
        solve_events:   []SolveInteractionEvent   // click positions, timing during solve
    }
}

Response {
    verified:          bool
    new_session_token: bytes[32]    // upgraded token with human-verified flag
    score_reduction:   float32      // how much risk score was reduced by solving
    next_challenge:    Challenge    // if score still above threshold after solve
}
```

### Management API (Operator Interface)

```
GET  /admin/v1/sessions/{session_id}       // inspect session state
POST /admin/v1/sessions/{session_id}/unblock  // manual unblock for false positives
GET  /admin/v1/fingerprints/{hash}         // inspect fingerprint record
POST /admin/v1/allowlist/fingerprints      // add fingerprint to allowlist
POST /admin/v1/allowlist/ips               // add IP range to allowlist
GET  /admin/v1/metrics/realtime            // streaming detection metrics (SSE)
POST /admin/v1/models/rollback             // rollback to previous model version
```

---

## Core Algorithms

### Risk Score Fusion Algorithm

```
FUNCTION fuse_risk_score(session, request_context, threat_intel):
    features = []

    // --- Network Signals ---
    ip_rep = threat_intel.lookup_ip(request_context.ip)
    features.append(ip_rep.malicious_probability)
    features.append(ip_rep.is_datacenter ? 0.6 : 0.0)
    features.append(ip_rep.is_tor_exit ? 0.8 : 0.0)
    features.append(ip_rep.is_vpn ? 0.3 : 0.0)

    tls_anomaly = compute_tls_anomaly_score(
        request_context.tls_fingerprint,
        request_context.user_agent
    )
    features.append(tls_anomaly)  // TLS/UA mismatch is strong bot signal

    // --- Device Fingerprint Signals ---
    fp = fingerprint_db.lookup(session.fingerprint_hash)
    IF fp NOT NULL:
        features.append(fp.bot_probability)
        features.append(compute_consistency_score(fp.raw_signals))
        features.append(fp.ip_diversity > 50 ? 0.7 : fp.ip_diversity / 100.0)
        features.append(fp.has_webdriver ? 0.95 : 0.0)
        features.append(compute_environment_anomaly(fp.raw_signals))
    ELSE:
        features.append(0.5)  // neutral prior for unknown fingerprint

    // --- Behavioral Signals ---
    IF session.behavioral_summary NOT NULL:
        behavior = session.behavioral_summary
        features.append(compute_mouse_bot_score(behavior.mouse_trajectory))
        features.append(compute_keystroke_bot_score(behavior.keystroke_timing))
        features.append(compute_scroll_entropy(behavior.scroll_pattern))
        features.append(behavior.interaction_count == 0 ? 0.4 : 0.0)
    ELSE:
        features.append(0.4)  // slight bot lean for no behavioral data

    // --- Session History Signals ---
    features.append(session.request_count > 500 ? 0.7 : 0.0)  // excessive requests
    features.append(compute_navigation_speed_score(session))   // superhuman page transitions
    features.append(session.ip_history.diversity_score())      // IP rotation within session
    features.append(session.human_verified_at != NULL ? -0.5 : 0.0)  // trust boost

    // --- ML Inference ---
    IF evaluation_tier == EDGE:
        score = edge_model.predict(features)
    ELSE:
        full_features = enrich_features(features, session)  // add 400+ more features
        score = deep_model.predict(full_features)

    // --- Post-processing ---
    score = calibrate(score)   // isotonic regression calibration
    score = clamp(score, 0.0, 1.0)

    RETURN RiskScore {
        score: score,
        confidence: deep_model.confidence(full_features),
        signal_count: len(features)
    }
```

### Fingerprint Matching and Consistency Scoring

```
FUNCTION compute_fingerprint_consistency(raw_signals):
    score = 1.0
    anomalies = []

    // Check 1: WebDriver flag
    IF raw_signals.has_webdriver == TRUE:
        anomalies.append("webdriver_exposed")
        score -= 0.8

    // Check 2: Chrome runtime absent in Chrome UA
    IF "Chrome" in raw_signals.user_agent AND NOT raw_signals.has_chrome_runtime:
        anomalies.append("chrome_runtime_missing")
        score -= 0.7

    // Check 3: Canvas/WebGL renderer mismatch with platform
    IF raw_signals.platform == "Win32" AND "Apple" in raw_signals.webgl_vendor:
        anomalies.append("platform_webgl_mismatch")
        score -= 0.5

    // Check 4: Hardware concurrency inconsistent with device
    IF raw_signals.hardware_concurrency > 64 OR raw_signals.hardware_concurrency == 0:
        anomalies.append("implausible_cpu_count")
        score -= 0.4

    // Check 5: AudioContext timing implausibility
    // Real hardware takes 5-15ms for PBKDF2; headless takes <1ms or >100ms
    IF raw_signals.crypto_timing < 1.0 OR raw_signals.crypto_timing > 200.0:
        anomalies.append("implausible_crypto_timing")
        score -= 0.5

    // Check 6: Font set implausibility
    // Real Windows has 100+ fonts; headless usually has <20
    IF raw_signals.platform == "Win32" AND len(raw_signals.installed_fonts) < 20:
        anomalies.append("minimal_font_set")
        score -= 0.3

    // Check 7: Screen resolution implausibility
    w, h = raw_signals.screen_resolution
    IF w == 0 OR h == 0 OR (w == 800 AND h == 600):  // default headless resolution
        anomalies.append("default_screen_resolution")
        score -= 0.5

    // Check 8: Plugin count for modern browser
    IF "Firefox" in raw_signals.user_agent AND raw_signals.plugin_count == 0:
        anomalies.append("no_plugins_modern_firefox")
        score -= 0.2

    RETURN max(0.0, score), anomalies
```

### Behavioral Analysis: Mouse Trajectory Scoring

```
FUNCTION compute_mouse_bot_score(trajectory):
    // trajectory = list of (x, y, timestamp_ms) tuples

    IF len(trajectory) < 10:
        RETURN 0.3   // insufficient data, slight bot lean

    scores = []

    // --- Feature 1: Curvature variance (humans have variable curvature) ---
    angles = []
    FOR i = 1 TO len(trajectory) - 1:
        dx = trajectory[i].x - trajectory[i-1].x
        dy = trajectory[i].y - trajectory[i-1].y
        angles.append(atan2(dy, dx))
    angle_variance = variance(angles)
    // Bots: near-zero variance (straight lines or perfectly smooth curves)
    IF angle_variance < 0.01:
        scores.append(0.9)   // very bot-like
    ELSE IF angle_variance > 0.5:
        scores.append(0.1)   // very human-like
    ELSE:
        scores.append(1.0 - angle_variance / 0.5)

    // --- Feature 2: Velocity distribution (humans have Fitts's Law pattern) ---
    velocities = []
    FOR i = 1 TO len(trajectory) - 1:
        dt = trajectory[i].t - trajectory[i-1].t
        IF dt > 0:
            dist = sqrt((trajectory[i].x - trajectory[i-1].x)^2 +
                        (trajectory[i].y - trajectory[i-1].y)^2)
            velocities.append(dist / dt)
    velocity_skewness = skewness(velocities)
    // Human mouse movement follows characteristic acceleration-deceleration profile
    IF abs(velocity_skewness) < 0.3:   // too symmetric = bot
        scores.append(0.7)
    ELSE:
        scores.append(0.2)

    // --- Feature 3: Micro-jitter (humans have hand tremor, bots don't) ---
    micro_movements = count_where(
        i: abs(trajectory[i].x - trajectory[i-1].x) == 1 OR
           abs(trajectory[i].y - trajectory[i-1].y) == 1
    )
    jitter_ratio = micro_movements / len(trajectory)
    IF jitter_ratio < 0.02:   // too smooth = bot
        scores.append(0.8)
    ELSE IF jitter_ratio > 0.15:   // natural jitter range
        scores.append(0.1)

    // --- Feature 4: Timing regularity (bots often move at fixed intervals) ---
    intervals = [trajectory[i].t - trajectory[i-1].t FOR i = 1 TO len(trajectory) - 1]
    interval_cv = std_dev(intervals) / mean(intervals)   // coefficient of variation
    IF interval_cv < 0.05:   // very regular = bot
        scores.append(0.9)
    ELSE:
        scores.append(max(0.0, 1.0 - interval_cv * 2))

    RETURN mean(scores)

FUNCTION compute_keystroke_bot_score(keystroke_events):
    IF len(keystroke_events) < 10:
        RETURN 0.3

    // Dwell times: time between keydown and keyup
    dwell_times = [keyup.t - keydown.t
                   FOR (keydown, keyup) in pair_events(keystroke_events)]

    // Flight times: time between consecutive keydowns
    flight_times = [keystroke_events[i+1].t - keystroke_events[i].t
                    FOR i = 0 TO len(keystroke_events) - 2
                    IF keystroke_events[i].type == KEYDOWN]

    // Human dwell times: 50-200ms with high variance
    // Bot dwell times: perfectly uniform or near-zero
    dwell_cv = std_dev(dwell_times) / mean(dwell_times)
    flight_cv = std_dev(flight_times) / mean(flight_times)

    bot_score = 0.0
    IF dwell_cv < 0.1:     bot_score += 0.4   // too uniform
    IF flight_cv < 0.1:    bot_score += 0.4   // too uniform
    IF mean(dwell_times) < 10:  bot_score += 0.3  // impossibly fast key press
    IF mean(flight_times) < 5:  bot_score += 0.3  // impossibly fast typing

    RETURN clamp(bot_score, 0.0, 1.0)
```

### Challenge Token Generation and Verification

```
FUNCTION generate_challenge_token(session_id, challenge_type, params):
    nonce = random_bytes(16)
    issued_at = current_timestamp_ms()
    expires_at = issued_at + CHALLENGE_TTL_MS   // 5 minutes

    message = concat(
        session_id,          // 16 bytes
        challenge_type,      // 1 byte enum
        encode_params(params),
        nonce,
        encode_int64(expires_at)
    )

    token = HMAC_SHA256(CHALLENGE_SECRET_KEY, message)

    store_challenge(ChallengeRecord {
        token: token,
        session_id: session_id,
        issued_at: issued_at,
        expires_at: expires_at,
        challenge_type: challenge_type,
        challenge_params: params,
        solved: FALSE
    })

    RETURN token, nonce, expires_at


FUNCTION verify_challenge_response(token, session_id, solution):
    record = challenge_store.get(token)

    IF record == NULL:
        RETURN VerifyResult { valid: FALSE, reason: "token_not_found" }

    IF record.solved == TRUE:
        RETURN VerifyResult { valid: FALSE, reason: "token_already_used" }

    IF current_timestamp_ms() > record.expires_at:
        RETURN VerifyResult { valid: FALSE, reason: "token_expired" }

    IF record.session_id != session_id:
        RETURN VerifyResult { valid: FALSE, reason: "session_mismatch" }

    // Verify the solution based on challenge type
    IF record.challenge_type == PROOF_OF_WORK:
        required_hash = concat(record.challenge_params.nonce, solution.nonce_solution)
        hash = SHA256(required_hash)
        leading_zeros = count_leading_zero_bits(hash)
        valid = leading_zeros >= record.challenge_params.difficulty

    ELSE IF record.challenge_type == INTERACTIVE_IMAGE:
        valid = solution.answer_indices == record.challenge_params.correct_answers
        // Also verify solve duration is plausible (2-60 seconds)
        IF record.solved_at - record.issued_at < 2000 OR > 60000:
            valid = FALSE

    IF valid:
        record.solved = TRUE
        record.solved_at = current_timestamp_ms()
        challenge_store.update(record)
        session_store.reduce_risk_score(session_id, delta=0.3)

    RETURN VerifyResult { valid: valid }
```

### Session Trust Score Update

```
FUNCTION update_session_score(session_id, new_signal_score, signal_type, weight):
    session = session_store.get(session_id)
    IF session == NULL:
        session = new_session(session_id)

    // Exponential decay since last update
    idle_seconds = (current_time - session.last_seen_at).seconds
    decay_factor = exp(-DECAY_LAMBDA * idle_seconds)  // DECAY_LAMBDA = 0.001/sec

    current_score = session.risk_score
    decayed_score = 0.5 + (current_score - 0.5) * decay_factor  // decay toward neutral 0.5

    // Bayesian update: weight new signal by confidence
    updated_score = (decayed_score * (1 - weight)) + (new_signal_score * weight)

    session.risk_score = clamp(updated_score, 0.0, 1.0)
    session.last_seen_at = current_time
    session.request_count += 1

    session_store.set(session_id, session, ttl=SESSION_TTL)

    RETURN session.risk_score
```

### TLS Fingerprint Analysis

```
FUNCTION compute_tls_anomaly_score(tls_fingerprint, user_agent):
    // TLS fingerprint (JA4 hash) encodes cipher suites, extensions,
    // and handshake parameters that differ between browser implementations

    expected_ja4 = get_expected_ja4_for_ua(user_agent)
    // e.g., Chrome 120 on Windows should produce JA4 = "t13d1517h2_..."

    IF expected_ja4 == NULL:
        // Unknown user-agent; cannot validate
        RETURN 0.3  // slight suspicion

    IF tls_fingerprint == expected_ja4:
        RETURN 0.0  // perfect match, no anomaly

    // Partial match: same cipher suites but different extension order
    similarity = compute_ja4_similarity(tls_fingerprint, expected_ja4)

    IF similarity > 0.8:
        RETURN 0.1  // minor deviation (browser update, plugin interference)
    ELSE IF similarity > 0.5:
        RETURN 0.4  // moderate deviation (possible spoofing with wrong TLS stack)
    ELSE:
        RETURN 0.8  // major deviation (TLS stack doesn't match claimed browser)

    // Known headless browser TLS patterns
    IF tls_fingerprint IN KNOWN_HEADLESS_JA4_HASHES:
        RETURN 0.95  // strong headless browser signal

    // HTTP/2 SETTINGS frame ordering is also browser-specific
    h2_anomaly = compute_h2_settings_anomaly(
        request_context.h2_settings,
        user_agent
    )
    RETURN max(tls_anomaly, h2_anomaly)


FUNCTION compute_ja4_similarity(actual, expected):
    // JA4 is structured: TLSVersion_Ciphers_Extensions_SignatureAlgorithms
    parts_actual = split(actual, "_")
    parts_expected = split(expected, "_")

    scores = []
    FOR i = 0 TO min(len(parts_actual), len(parts_expected)) - 1:
        IF parts_actual[i] == parts_expected[i]:
            scores.append(1.0)
        ELSE:
            // Jaccard similarity of the set elements within each part
            set_a = set(split(parts_actual[i], ","))
            set_b = set(split(parts_expected[i], ","))
            jaccard = len(set_a ∩ set_b) / len(set_a ∪ set_b)
            scores.append(jaccard)

    RETURN mean(scores)
```

### Population-Level Bot Farm Detection

```
FUNCTION detect_bot_farm_clusters(sessions_window, time_range):
    // Cross-session clustering to detect coordinated bot farms
    // that individually look plausible but share statistical signatures

    // Step 1: Extract behavioral feature vectors for all sessions
    feature_vectors = {}
    FOR session IN sessions_window:
        IF session.behavioral_summary != NULL:
            features = extract_clustering_features(session)
            feature_vectors[session.id] = features

    // Step 2: Compute pairwise similarity within IP neighborhoods
    // (Sessions from different IPs but similar behavior = bot farm signal)
    suspicious_clusters = []

    // Group by fingerprint similarity first (reduce comparison space)
    fp_groups = group_by_fingerprint_similarity(feature_vectors, threshold=0.7)

    FOR group IN fp_groups:
        IF len(group) < 3:
            CONTINUE  // need at least 3 sessions to form a cluster

        // Check behavioral similarity across different IPs
        unique_ips = count_unique_ips(group)
        IF unique_ips < 2:
            CONTINUE  // same IP = same user, not a farm

        behavioral_similarity = compute_group_behavioral_similarity(group)

        IF behavioral_similarity > 0.85 AND unique_ips > 5:
            // High behavioral similarity across many IPs = bot farm
            suspicious_clusters.append(Cluster {
                session_ids: group.session_ids,
                ip_count: unique_ips,
                similarity_score: behavioral_similarity,
                confidence: min(0.95, behavioral_similarity * unique_ips / 10)
            })

    // Step 3: Apply cluster scores back to individual sessions
    FOR cluster IN suspicious_clusters:
        FOR session_id IN cluster.session_ids:
            session_store.boost_risk_score(
                session_id,
                delta = cluster.confidence * 0.4,
                reason = "bot_farm_cluster"
            )

    RETURN suspicious_clusters


FUNCTION extract_clustering_features(session):
    b = session.behavioral_summary
    RETURN FeatureVector {
        mouse_velocity_mean:     b.mouse_velocity_mean,
        mouse_velocity_variance: b.mouse_velocity_variance,
        mouse_curvature_entropy: b.curvature_entropy,
        keystroke_dwell_mean:    b.keystroke_dwell_mean,
        keystroke_flight_cv:     b.keystroke_flight_cv,
        scroll_entropy:          b.scroll_entropy,
        interaction_density:     b.interaction_count / session.duration_sec,
        page_transition_speed:   b.avg_page_transition_ms,
        click_precision:         b.click_target_accuracy
    }
```

### IP Reputation Scoring with Temporal Decay

```
FUNCTION compute_ip_reputation(ip_address, threat_intel, session_history):
    reputation = IPReputation {
        malicious_probability: 0.0,
        signals: []
    }

    // --- External feed signals ---
    feeds = threat_intel.lookup_all_feeds(ip_address)
    FOR feed IN feeds:
        IF feed.listed:
            age_hours = hours_since(feed.listed_at)
            // Decay: old listings are less relevant
            recency_weight = exp(-age_hours / 168)  // half-life = 1 week
            reputation.malicious_probability += feed.confidence * recency_weight * 0.3
            reputation.signals.append(feed.name + ":" + feed.reason)

    // --- IP classification ---
    ip_class = classify_ip(ip_address)
    SWITCH ip_class:
        CASE DATACENTER:
            reputation.malicious_probability += 0.3  // datacenter IPs are inherently suspicious
            reputation.signals.append("datacenter_ip")
        CASE TOR_EXIT:
            reputation.malicious_probability += 0.5
            reputation.signals.append("tor_exit_node")
        CASE VPN:
            reputation.malicious_probability += 0.15
            reputation.signals.append("vpn_exit")
        CASE RESIDENTIAL:
            // Residential IPs are low-suspicion individually
            // But check if this IP is in a known residential proxy pool
            IF ip_address IN threat_intel.residential_proxy_pool:
                reputation.malicious_probability += 0.4
                reputation.signals.append("residential_proxy")

    // --- Historical behavior from this IP ---
    history = session_history.get_ip_stats(ip_address, lookback_days=7)
    IF history != NULL:
        IF history.blocked_session_ratio > 0.5:
            reputation.malicious_probability += 0.4
            reputation.signals.append("high_block_rate")
        IF history.distinct_fingerprints > 20:
            reputation.malicious_probability += 0.3
            reputation.signals.append("high_fingerprint_diversity")
        IF history.challenge_fail_ratio > 0.3:
            reputation.malicious_probability += 0.2
            reputation.signals.append("high_challenge_failure")

    reputation.malicious_probability = clamp(reputation.malicious_probability, 0.0, 1.0)
    RETURN reputation
```

### Scroll Entropy and Engagement Scoring

```
FUNCTION compute_scroll_entropy(scroll_events):
    IF len(scroll_events) < 5:
        RETURN 0.3  // insufficient data

    // Humans scroll in irregular bursts; bots scroll uniformly

    // Feature 1: Scroll velocity entropy
    velocities = []
    FOR i = 1 TO len(scroll_events) - 1:
        dt = scroll_events[i].t - scroll_events[i-1].t
        IF dt > 0:
            dy = abs(scroll_events[i].position - scroll_events[i-1].position)
            velocities.append(dy / dt)

    velocity_entropy = shannon_entropy(quantize(velocities, bins=20))
    // High entropy = varied speeds = human-like
    // Low entropy = constant speed = bot-like

    // Feature 2: Scroll-pause pattern
    pauses = count_where(i: scroll_events[i].t - scroll_events[i-1].t > 500)
    pause_ratio = pauses / len(scroll_events)
    // Humans pause to read; bots scroll continuously

    // Feature 3: Scroll direction changes
    direction_changes = 0
    FOR i = 2 TO len(scroll_events) - 1:
        d1 = scroll_events[i-1].position - scroll_events[i-2].position
        d2 = scroll_events[i].position - scroll_events[i-1].position
        IF sign(d1) != sign(d2):
            direction_changes += 1
    reversal_ratio = direction_changes / len(scroll_events)
    // Some reversals = human (re-reading); zero reversals = bot

    // Combine
    bot_score = 0.0
    IF velocity_entropy < 1.5:  bot_score += 0.3   // too uniform
    IF pause_ratio < 0.05:      bot_score += 0.3   // never pauses
    IF reversal_ratio == 0:     bot_score += 0.2   // never scrolls back

    RETURN clamp(bot_score, 0.0, 1.0)
```
