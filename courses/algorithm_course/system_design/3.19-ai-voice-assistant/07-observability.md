# Observability

## Metrics Framework

### Infrastructure Metrics (USE Method)

```yaml
# USE: Utilization, Saturation, Errors

compute_metrics:
  asr_gpu_cluster:
    - name: asr_gpu_utilization
      type: gauge
      description: "GPU compute utilization percentage"
      labels: [cluster, gpu_id, model_version]
      target: "<80%"

    - name: asr_gpu_memory_utilization
      type: gauge
      description: "GPU memory utilization percentage"
      labels: [cluster, gpu_id]
      target: "<85%"

    - name: asr_request_queue_depth
      type: gauge
      description: "Requests waiting for GPU"
      labels: [cluster]
      alert_threshold: ">50"

    - name: asr_inference_errors_total
      type: counter
      description: "Total ASR inference errors"
      labels: [cluster, error_type]

  tts_gpu_cluster:
    - name: tts_gpu_utilization
      type: gauge
      labels: [cluster, gpu_id, voice_id]
      target: "<75%"

    - name: tts_synthesis_queue_depth
      type: gauge
      labels: [cluster]
      alert_threshold: ">30"

  gateway_cluster:
    - name: gateway_connection_count
      type: gauge
      description: "Active WebSocket connections"
      labels: [region, instance]

    - name: gateway_connection_saturation
      type: gauge
      description: "Connections / max capacity"
      labels: [region, instance]
      alert_threshold: ">0.9"

network_metrics:
  - name: audio_bandwidth_bytes
    type: counter
    description: "Audio bytes transferred"
    labels: [direction, region, codec]

  - name: network_latency_ms
    type: histogram
    description: "Network RTT to device"
    labels: [region, device_type]
    buckets: [10, 25, 50, 100, 200, 500]
```

### Service Metrics (RED Method)

```yaml
# RED: Rate, Errors, Duration

voice_request_metrics:
  - name: voice_requests_total
    type: counter
    description: "Total voice requests processed"
    labels: [region, device_type, intent, status]

  - name: voice_request_errors_total
    type: counter
    description: "Voice request errors"
    labels: [region, error_type, component]

  - name: voice_request_duration_seconds
    type: histogram
    description: "End-to-end request duration"
    labels: [region, device_type]
    buckets: [0.2, 0.5, 0.8, 1.0, 1.5, 2.0, 3.0, 5.0]

component_latency_metrics:
  - name: wake_word_latency_ms
    type: histogram
    description: "Wake word detection latency"
    labels: [device_type, model_version]
    buckets: [50, 100, 150, 200, 300, 500]

  - name: asr_latency_ms
    type: histogram
    description: "ASR processing latency"
    labels: [region, model, locale]
    buckets: [100, 200, 300, 500, 800, 1000]

  - name: nlu_latency_ms
    type: histogram
    description: "NLU processing latency"
    labels: [region, domain]
    buckets: [20, 50, 100, 150, 200, 300]

  - name: skill_execution_latency_ms
    type: histogram
    description: "Skill execution latency"
    labels: [skill_type, skill_id]
    buckets: [100, 200, 500, 1000, 2000, 5000]

  - name: tts_time_to_first_audio_ms
    type: histogram
    description: "TTS time to first audio chunk"
    labels: [region, voice_id]
    buckets: [20, 50, 100, 150, 200, 300]
```

### Voice Assistant Quality Metrics

```yaml
quality_metrics:
  wake_word:
    - name: wake_word_false_accept_rate
      type: gauge
      description: "False accepts per device per day"
      target: "<0.14"  # Less than 1 per week
      measurement: "Count of unintended triggers / active devices"

    - name: wake_word_false_reject_rate
      type: gauge
      description: "Percentage of missed wake words"
      target: "<5%"
      measurement: "Missed triggers / total triggers (from user feedback)"

  asr:
    - name: asr_word_error_rate
      type: gauge
      description: "Word Error Rate percentage"
      labels: [locale, domain]
      target: "<5%"

    - name: asr_sentence_error_rate
      type: gauge
      description: "Utterances with any error"
      labels: [locale]
      target: "<15%"

  nlu:
    - name: nlu_intent_accuracy
      type: gauge
      description: "Correct intent classification rate"
      labels: [domain]
      target: ">95%"

    - name: nlu_slot_f1_score
      type: gauge
      description: "Slot extraction F1 score"
      labels: [domain, slot_type]
      target: ">90%"

    - name: nlu_fallback_rate
      type: gauge
      description: "Queries routed to fallback"
      target: "<10%"

  skill_execution:
    - name: skill_completion_rate
      type: gauge
      description: "Successfully fulfilled requests"
      labels: [skill_type]
      target: ">90%"

    - name: skill_timeout_rate
      type: gauge
      description: "Skills exceeding timeout"
      labels: [skill_id]
      target: "<1%"

  user_satisfaction:
    - name: implicit_negative_signal_rate
      type: gauge
      description: "Retry, cancel, or rephrase rate"
      target: "<10%"
      measurement: "Users who retry same intent within 30s"

    - name: session_completion_rate
      type: gauge
      description: "Multi-turn sessions completed successfully"
      target: ">85%"
```

---

## Distributed Tracing

### Trace Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Voice Request Trace Timeline                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  trace_id: abc-123-def-456                                                  │
│  user_id: user_789                                                          │
│  device_id: device_012                                                      │
│                                                                              │
│  Time (ms)  Span                           Duration  Status                 │
│  ─────────────────────────────────────────────────────────────────────────  │
│  0          ├── device.wake_word_triggered      -     OK                    │
│  0-50       ├── device.audio_capture_start      50    OK                    │
│  50-80      ├── gateway.request_received        30    OK                    │
│  80-85      │   └── auth.device_verify           5    OK                    │
│  85-90      │   └── routing.region_select        5    OK                    │
│  90-350     ├── asr.streaming_transcribe       260    OK                    │
│  90-120     │   ├── asr.feature_extraction      30    OK                    │
│  120-300    │   ├── asr.encoder_forward        180    OK                    │
│  300-340    │   ├── asr.decoder_emit            40    OK                    │
│  340-350    │   └── asr.lm_rescore              10    OK                    │
│  350-420    ├── nlu.understand                  70    OK                    │
│  350-370    │   ├── nlu.tokenize                20    OK                    │
│  370-400    │   ├── nlu.bert_forward            30    OK                    │
│  400-415    │   ├── nlu.intent_classify         15    OK                    │
│  415-420    │   └── nlu.slot_extract             5    OK                    │
│  420-450    ├── dialogue.process                30    OK                    │
│  420-435    │   ├── dialogue.state_retrieve     15    OK                    │
│  435-445    │   ├── dialogue.policy_select      10    OK                    │
│  445-450    │   └── dialogue.skill_route         5    OK                    │
│  450-650    ├── skill.execute                  200    OK                    │
│  450-470    │   ├── skill.cold_start            20    - (warm)              │
│  470-600    │   ├── skill.business_logic       130    OK                    │
│  600-650    │   └── skill.response_format       50    OK                    │
│  650-700    ├── tts.synthesize                  50    OK                    │
│  650-660    │   ├── tts.text_normalize          10    OK                    │
│  660-690    │   ├── tts.vocoder_generate        30    OK                    │
│  690-700    │   └── tts.audio_encode            10    OK                    │
│  700-730    ├── gateway.response_stream         30    OK                    │
│  730-750    └── device.audio_playback_start     20    OK                    │
│                                                                              │
│  Total E2E Latency: 750ms                                                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Span Attributes

```yaml
span_attributes:
  voice_request:
    - request_id: uuid
    - session_id: uuid
    - device_id: string
    - user_id: string (hashed)
    - locale: string
    - device_type: string

  asr_span:
    - transcript: string
    - confidence: float
    - word_count: integer
    - audio_duration_ms: integer
    - model_version: string
    - streaming: boolean

  nlu_span:
    - intent: string
    - intent_confidence: float
    - slot_count: integer
    - domain: string
    - model_version: string

  skill_span:
    - skill_id: string
    - skill_type: string
    - cold_start: boolean
    - response_type: string

  tts_span:
    - text_length: integer
    - voice_id: string
    - audio_duration_ms: integer
    - streaming: boolean
```

### Trace Sampling Strategy

```yaml
sampling_config:
  default_rate: 0.01  # 1% of all requests

  rules:
    # Higher sampling for errors
    - condition: "status == ERROR"
      rate: 1.0  # 100%

    # Higher sampling for high latency
    - condition: "duration > 2000ms"
      rate: 0.5  # 50%

    # Higher sampling for new features
    - condition: "feature_flag.new_asr_model == true"
      rate: 0.1  # 10%

    # Higher sampling for specific skills
    - condition: "skill_id IN monitored_skills"
      rate: 0.2  # 20%

    # Lower sampling for high-volume, stable paths
    - condition: "intent == 'SetTimerIntent'"
      rate: 0.001  # 0.1%

  head_sampling: true  # Decision made at trace start

  propagation:
    format: "w3c-tracecontext"  # traceparent, tracestate headers
```

---

## Logging Strategy

### Log Levels and Content

```yaml
log_levels:
  DEBUG:
    - Feature extraction details
    - Model inference internals
    - Audio chunk processing
    retention: 1 day
    enabled: dev/staging only

  INFO:
    - Request lifecycle events
    - Skill invocations
    - User interactions (anonymized)
    retention: 7 days

  WARN:
    - Retry attempts
    - Degraded service responses
    - Near-threshold latencies
    retention: 30 days

  ERROR:
    - Service failures
    - Skill timeouts
    - Authentication failures
    retention: 90 days

  CRITICAL:
    - System outages
    - Security incidents
    - Data integrity issues
    retention: 1 year
```

### Structured Log Format

```json
{
  "timestamp": "2026-01-27T10:30:00.123Z",
  "level": "INFO",
  "service": "voice-gateway",
  "trace_id": "abc-123-def-456",
  "span_id": "span-789",
  "request_id": "req-012",

  "event": "voice_request_completed",

  "context": {
    "device_id": "device_abc",
    "user_id_hash": "sha256:xxx",
    "region": "us-east-1",
    "device_type": "echo_dot"
  },

  "metrics": {
    "e2e_latency_ms": 750,
    "asr_latency_ms": 260,
    "nlu_latency_ms": 70,
    "skill_latency_ms": 200
  },

  "result": {
    "intent": "PlayMusicIntent",
    "intent_confidence": 0.96,
    "skill_id": "music-skill",
    "status": "success"
  }
}
```

### Sensitive Data Handling

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Log Data Classification                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  NEVER LOG                                                                  │
│  ─────────                                                                  │
│  • Raw audio data                                                          │
│  • Voice biometric embeddings                                              │
│  • Full user IDs (use hash)                                                │
│  • Full transcripts (use intent/slot summary)                              │
│  • PII (names, addresses, phone numbers)                                   │
│  • Authentication tokens                                                   │
│  • Payment information                                                     │
│                                                                              │
│  LOG WITH REDACTION                                                        │
│  ──────────────────                                                         │
│  • Slot values: "[SLOT:name]", "[SLOT:phone]"                             │
│  • Device IDs: Log, but not linkable to user externally                   │
│  • Error messages: Redact any included PII                                 │
│                                                                              │
│  SAFE TO LOG                                                                │
│  ───────────                                                                │
│  • Intent names                                                            │
│  • Latency metrics                                                         │
│  • Error types/codes                                                       │
│  • Device types (not IDs)                                                  │
│  • Regional information                                                    │
│  • Skill IDs                                                               │
│  • Model versions                                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Alerting Configuration

### Alert Severity Levels

```yaml
alerts:
  # P0: Page immediately, customer-facing outage
  critical:
    - name: asr_service_down
      condition: "asr_success_rate < 90% for 2m"
      severity: P0
      action: Page on-call, auto-failover

    - name: tts_service_down
      condition: "tts_success_rate < 90% for 2m"
      severity: P0
      action: Page on-call, auto-failover

    - name: gateway_connection_failures
      condition: "connection_error_rate > 10% for 1m"
      severity: P0
      action: Page on-call, check network

    - name: high_wake_word_false_accepts
      condition: "false_accept_rate > 1/device/hour"
      severity: P0
      action: Page on-call, potential security issue

  # P1: Page during business hours, significant degradation
  high:
    - name: asr_latency_degraded
      condition: "asr_p99_latency > 500ms for 5m"
      severity: P1
      action: Page during hours, investigate

    - name: skill_error_spike
      condition: "skill_error_rate > 5% for 5m"
      severity: P1
      action: Notify team, check specific skill

    - name: nlu_accuracy_drop
      condition: "intent_accuracy < 90% for 10m"
      severity: P1
      action: Check model, traffic patterns

    - name: e2e_latency_sla_breach
      condition: "e2e_p99 > 1500ms for 5m"
      severity: P1
      action: Identify Slowest part of the process component

  # P2: Notify, investigate during business hours
  medium:
    - name: asr_wer_elevated
      condition: "word_error_rate > 7% for 30m"
      severity: P2
      action: Investigate, may be regional

    - name: third_party_skill_degraded
      condition: "skill_timeout_rate > 10% for skill"
      severity: P2
      action: Notify skill developer

    - name: capacity_approaching_limit
      condition: "gpu_utilization > 80% for 15m"
      severity: P2
      action: Evaluate auto-scaling, capacity

  # P3: Track, review weekly
  low:
    - name: model_version_drift
      condition: "devices_on_old_model > 5%"
      severity: P3
      action: Review OTA deployment

    - name: low_engagement_region
      condition: "queries_per_device < 5/day for region"
      severity: P3
      action: Investigate regional issues
```

### Alert Routing

```yaml
routing:
  P0:
    channels:
      - pagerduty: "voice-platform-critical"
      - slack: "#voice-incidents"
      - phone: "on-call-manager"
    escalation:
      - after: 5m
        action: "escalate to secondary"
      - after: 15m
        action: "escalate to manager"

  P1:
    channels:
      - pagerduty: "voice-platform-high"
      - slack: "#voice-alerts"
    business_hours_only: true

  P2:
    channels:
      - slack: "#voice-alerts"
      - email: "voice-team@example.com"

  P3:
    channels:
      - slack: "#voice-metrics"
    digest: weekly
```

---

## Dashboards

### Executive Dashboard

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Voice Assistant Executive Dashboard                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  KEY METRICS (Last 24h)                                                  ││
│  │                                                                          ││
│  │  Daily Active Devices    Voice Requests      Availability    SLA Status ││
│  │      485.2M                 9.8B              99.97%          ✅ MET    ││
│  │      ▲ 2.1%               ▲ 3.5%             Target: 99.95%            ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  USER SATISFACTION INDICATORS                                            ││
│  │                                                                          ││
│  │  Skill Completion Rate    Retry Rate    Avg E2E Latency   Error Rate   ││
│  │       94.2%                7.8%            723ms            1.2%        ││
│  │       ▲ 0.5%              ▼ 0.3%         ▼ 15ms           ▼ 0.1%       ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌──────────────────────────────────┐  ┌──────────────────────────────────┐│
│  │  REQUESTS BY CATEGORY            │  │  REGIONAL HEALTH                 ││
│  │                                   │  │                                  ││
│  │  Smart Home     ████████ 35%     │  │  US-East   ✅ 99.98%             ││
│  │  Music          ██████   25%     │  │  US-West   ✅ 99.97%             ││
│  │  Timers         ████     15%     │  │  EU-West   ✅ 99.96%             ││
│  │  Weather        ███      10%     │  │  AP-South  ⚠️ 99.91%             ││
│  │  Questions      ███      10%     │  │  AP-NE     ✅ 99.95%             ││
│  │  Other          ██        5%     │  │                                  ││
│  └──────────────────────────────────┘  └──────────────────────────────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Operations Dashboard

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Voice Platform Operations Dashboard                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  LATENCY BREAKDOWN (P50 / P95 / P99)                                    ││
│  │                                                                          ││
│  │  Component        P50      P95      P99     Status                      ││
│  │  ───────────────────────────────────────────────────                    ││
│  │  Wake Word        95ms    140ms    180ms    ✅                          ││
│  │  ASR             180ms    280ms    350ms    ✅                          ││
│  │  NLU              45ms     80ms    120ms    ✅                          ││
│  │  Skill Exec      150ms    350ms    800ms    ⚠️                          ││
│  │  TTS              35ms     55ms     80ms    ✅                          ││
│  │  ───────────────────────────────────────────────────                    ││
│  │  E2E             550ms    850ms   1100ms    ✅                          ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌──────────────────────────────────┐  ┌──────────────────────────────────┐│
│  │  GPU CLUSTER UTILIZATION          │  │  ERROR RATE BY COMPONENT        ││
│  │                                   │  │                                  ││
│  │  ASR Cluster                      │  │  Gateway    ▏ 0.1%              ││
│  │  ████████████████░░░░ 78%        │  │  ASR        ▏ 0.3%              ││
│  │                                   │  │  NLU        ▏ 0.2%              ││
│  │  TTS Cluster                      │  │  Skills     ████ 1.8%           ││
│  │  █████████████░░░░░░░ 65%        │  │  TTS        ▏ 0.1%              ││
│  │                                   │  │                                  ││
│  │  Queue Depth: 12 (ASR), 5 (TTS)  │  │  Target: < 2%                   ││
│  └──────────────────────────────────┘  └──────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  ACTIVE INCIDENTS                                                        ││
│  │                                                                          ││
│  │  🔴 P1: Skill "weather-premium" timeout rate elevated (investigating)   ││
│  │  🟡 P2: AP-South latency 10% above baseline (monitoring)                ││
│  │                                                                          ││
│  │  Recent: 2 incidents resolved in last 24h                               ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Quality Dashboard

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Voice Quality Monitoring Dashboard                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  ASR QUALITY METRICS                                                     ││
│  │                                                                          ││
│  │  Word Error Rate by Locale:                                             ││
│  │  en-US   ███   3.2%   ✅                                                ││
│  │  en-GB   ███   3.5%   ✅                                                ││
│  │  es-ES   ████  4.8%   ✅                                                ││
│  │  de-DE   ████  4.5%   ✅                                                ││
│  │  ja-JP   █████ 5.8%   ⚠️ (above 5% target)                              ││
│  │  hi-IN   ██████ 6.2%  ⚠️                                                ││
│  │                                                                          ││
│  │  Target: < 5% WER                                                       ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌──────────────────────────────────┐  ┌──────────────────────────────────┐│
│  │  NLU ACCURACY                     │  │  WAKE WORD PERFORMANCE          ││
│  │                                   │  │                                  ││
│  │  Intent Accuracy: 96.2%          │  │  False Accept: 0.08/device/day  ││
│  │  ████████████████████░ ✅        │  │  ▏ Target: < 0.14              ││
│  │                                   │  │                                  ││
│  │  Slot F1 Score: 91.5%            │  │  False Reject: 3.2%             ││
│  │  ██████████████████░░░ ✅        │  │  ███ Target: < 5%              ││
│  │                                   │  │                                  ││
│  │  Fallback Rate: 8.5%             │  │  Model Coverage: 99.2%          ││
│  │  ████████░░░░░░░░░░░░ ✅        │  │  (devices on latest model)      ││
│  └──────────────────────────────────┘  └──────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  TOP MISUNDERSTOOD INTENTS (Last 24h)                                   ││
│  │                                                                          ││
│  │  Intended → Recognized          Count    Fix Status                     ││
│  │  ──────────────────────────────────────────────────                     ││
│  │  PlayMusic → SearchMusic        12,340   Training data added            ││
│  │  SetAlarm → SetTimer             8,120   Disambiguation added           ││
│  │  SmartHome → General             6,890   Investigating                  ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Runbooks

### High ASR Latency Investigation

```yaml
runbook: high_asr_latency
trigger: asr_p99_latency > 500ms for 5m
severity: P1

steps:
  1_check_gpu_health:
    action: "Check GPU cluster utilization and errors"
    command: |
      kubectl top pods -n asr-cluster
      kubectl logs -n asr-cluster -l app=asr --tail=100 | grep ERROR
    expected: "Utilization < 90%, no OOM errors"
    if_failed: "Scale up ASR cluster, check for memory leaks"

  2_check_model_loading:
    action: "Verify model is loaded correctly"
    command: |
      curl http://asr-service/health/model
    expected: "model_loaded: true, version: expected_version"
    if_failed: "Restart ASR pods, check model registry"

  3_check_network:
    action: "Check network latency to ASR cluster"
    command: |
      kubectl exec gateway-pod -- ping asr-service
    expected: "RTT < 5ms within same region"
    if_failed: "Check network policies, DNS resolution"

  4_check_request_patterns:
    action: "Analyze incoming request patterns"
    command: |
      SELECT locale, avg(audio_duration_ms), count(*)
      FROM asr_requests
      WHERE timestamp > NOW() - INTERVAL 10m
      GROUP BY locale
    expected: "No unusual spikes in specific locales"
    if_failed: "Check for traffic anomaly, possible attack"

  5_enable_debug_sampling:
    action: "Increase trace sampling for investigation"
    command: |
      kubectl patch configmap sampling-config -p '{"data":{"asr_sample_rate":"0.1"}}'
    duration: "15 minutes, then revert"

  escalation:
    if_unresolved_after: 30m
    action: "Escalate to ASR team lead, consider failover to backup region"
```

### Wake Word False Positive Spike

```yaml
runbook: wake_word_false_positives
trigger: false_accept_rate > 0.5/device/day
severity: P0

steps:
  1_assess_scope:
    action: "Determine if regional or global"
    query: |
      SELECT region, device_type, count(*) as false_accepts
      FROM wake_word_events
      WHERE event_type = 'false_accept' AND timestamp > NOW() - INTERVAL 1h
      GROUP BY region, device_type
    assess: "Is it specific to region/device type?"

  2_check_for_attack:
    action: "Look for coordinated attack patterns"
    indicators:
      - Same audio fingerprint across devices
      - Unusual geographic clustering
      - Known adversarial audio patterns
    if_attack: "Enable enhanced filtering, notify security team"

  3_check_model_deployment:
    action: "Verify wake word model version"
    command: |
      SELECT device_type, wake_word_model_version, count(*)
      FROM devices
      GROUP BY device_type, wake_word_model_version
    expected: "All devices on approved model version"
    if_failed: "Rollback to previous model version"

  4_analyze_audio_samples:
    action: "Review false accept audio (with privacy controls)"
    process:
      - Sample 10 false accepts from affected region
      - Analyze in secure environment
      - Identify trigger pattern (TV, similar word, etc.)

  5_deploy_hotfix:
    action: "If pattern identified, deploy anti-trigger update"
    options:
      - Add negative example to model
      - Adjust threshold temporarily
      - Enable cloud verification for low-confidence triggers

  communication:
    internal: "Slack #voice-incidents with findings every 15m"
    external: "If widespread, prepare customer communication"
```

## AI Observability Standards

This system's AI components inherit patterns from:
- **[3.25 AI Observability & LLMOps](../3.25-ai-observability-llmops-platform/00-index.md)** — distributed tracing, token accounting, prompt-completion linkage
- **[3.26 AI Model Evaluation & Benchmarking](../3.26-ai-model-evaluation-benchmarking-platform/00-index.md)** — eval taxonomy, regression testing, quality metrics
