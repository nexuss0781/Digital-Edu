# 07 — Observability: Password Manager

## Observability Philosophy

Password manager observability is uniquely constrained: the system must surface operational health and security signals **without ever logging plaintext credentials, URLs, or decryptable vault content**. Every log line, metric label, and trace span must be designed with the assumption that observability data itself could be subpoenaed, breached, or accessed by insiders. The guiding principle is: **observe behavior, never content**.

This constraint forces a metadata-only observability model:
- Log _that_ a vault item was accessed, not _which_ item or _what_ it contained
- Record _that_ an autofill occurred, not _for which website_
- Track _that_ a sync happened, not _what changed_
- Alert on _anomalous patterns_, not _plaintext values_

---

## Metrics

### Service-Level Metrics

```
# Authentication
auth_login_attempts_total{result="success|failure|mfa_required", region}
auth_login_duration_seconds{quantile="0.5|0.95|0.99", region}
auth_opaque_rounds_total{phase="start|finish"}
auth_mfa_challenges_total{type="totp|webauthn|push", result}
auth_session_refresh_total{result}
auth_active_sessions_gauge{region}

# Vault Sync
vault_sync_requests_total{device_platform, result="success|conflict|error"}
vault_sync_duration_seconds{quantile}
vault_sync_items_per_request_histogram{bucket}
vault_conflict_resolutions_total{resolution_type="auto_merge|user_required"}
vault_pending_queue_depth_gauge{region}  // offline write queue depth

# Vault Operations
vault_item_operations_total{op_type="create|update|delete", vault_type="personal|shared|org"}
vault_item_ciphertext_bytes_histogram  // detect abnormally large items
vault_key_rotation_events_total{trigger="manual|password_change|member_revocation"}

# Sharing & Emergency Access
shares_created_total
shares_revoked_total
emergency_access_requests_total{status="pending|approved|cancelled|expired"}
emergency_access_wait_period_days_histogram

# Breach Detection
breach_check_requests_total
breach_check_positive_rate_gauge  // % of checked passwords found in breach DB
breach_check_duration_seconds{quantile}
breach_db_freshness_hours_gauge  // time since last breach DB update

# Extension Autofill
autofill_suggestions_served_total{platform="chrome|firefox|safari|edge"}
autofill_filled_total{trigger="user_click|keyboard_shortcut"}
autofill_blocked_total{reason="mismatch|locked_vault|no_match|clickjack_detected"}
autofill_generator_used_total{strength="strong|custom"}

# Passkey / FIDO2 Operations
passkey_auth_total{result="success|failure|user_cancelled", rp_id_hash, platform}
passkey_creation_total{type="discoverable|non_discoverable", platform}
passkey_auth_duration_seconds{quantile="0.5|0.95|0.99"}
passkey_conditional_ui_triggered_total{platform}  // browser conditional mediation API
passkey_sync_operations_total{direction="upload|download", result}
passkey_hardware_bound_total{transport="usb|nfc|ble|internal"}
passkey_cxp_export_total{result="success|failure|cancelled"}  // Credential Exchange Protocol
passkey_cxp_import_total{result="success|duplicate|failure"}
passkey_rp_id_mismatch_total  // relying party ID validation failures

# Post-Quantum Migration Tracking
pq_hybrid_handshake_total{result="success|fallback_classic|failure"}
pq_vault_reencrypt_progress_gauge{status="pending|in_progress|completed"}
pq_key_exchange_algorithm_gauge{algorithm="x25519|ml_kem_768|hybrid_x25519_ml_kem"}
pq_share_rekey_total{result="success|failure"}
pq_migration_batch_duration_seconds{quantile}
pq_classic_only_sessions_gauge  // sessions still using pre-quantum-only key exchange

# AI Agent Detection
agent_autofill_requests_total{source="user_initiated|programmatic", result}
agent_is_trusted_validation_total{result="trusted|untrusted|indeterminate"}
agent_blocked_programmatic_fill_total{reason="no_user_gesture|untrusted_event|sandbox_violation"}
agent_credential_access_scope_total{scope="single_item|bulk_read|export"}
```

### Infrastructure Metrics

```
# Database
vault_db_connections_active{shard}
vault_db_query_duration_seconds{operation="read|write|delete", shard, quantile}
vault_db_replication_lag_seconds{replica_region}
vault_db_write_conflicts_total{shard}
vault_db_tombstone_count_gauge{shard}  // track tombstone accumulation

# Key Store
key_store_latency_seconds{operation="get|put", quantile}
key_store_availability_gauge{region}
key_envelope_fetches_total{envelope_type="account|vault|device"}
key_rotation_batch_duration_seconds  // org vault key rotation jobs

# Sync Queue
sync_queue_depth_gauge{queue="write|fanout"}
sync_queue_consumer_lag_seconds
sync_fanout_recipients_histogram  // how many devices receive each change
sync_websocket_connections_gauge{region}
```

---

## Logging (Secret-Safe)

### Log Schema

All log lines follow a structured schema that explicitly prohibits sensitive fields:

```json
{
  "timestamp": "2026-03-10T14:22:33.447Z",
  "level": "INFO",
  "service": "vault-sync",
  "trace_id": "3f9a2c1d-...",
  "span_id": "7b4e...",
  "account_id_hash": "sha256:a3f9...",
  "device_id": "d83b-...",
  "event_type": "vault_item_created",
  "vault_id": "v-9c2a-...",
  "item_id": "i-4f1d-...",
  "item_type": "login",
  "ciphertext_size_bytes": 1842,
  "duration_ms": 47,
  "result": "success",
  "region": "us-east-1"
}
```

**Prohibited fields in any log line:**
- `password`, `master_password`, `plaintext`, `decrypted_*`
- `url`, `title`, `username`, `credential_*`
- Raw IP address (use IP hash or geohash for rate limiting logs)
- Email address (use email hash for lookup; never raw in logs)
- `key`, `secret`, `token` values (only token IDs allowed)

### Log Categories

**Application Logs** (retained 90 days):
- Auth events: login start/finish, MFA challenges, session refresh
- Vault operations: item create/update/delete (item_id only, no content)
- Sharing events: share creation, revocation, acceptance
- Sync events: sync requests, conflicts, resolution outcomes

**Security Logs** (retained 1 year):
- Failed authentication attempts with rate context
- Permission denials (unauthorized vault access attempts)
- Emergency access lifecycle events
- Export events (account export, bulk download)
- Admin access events (internal team access to infrastructure)
- Anomaly detection triggers

**Audit Logs** (retained 7 years for compliance, hash-chained):
- Same events as security logs but in tamper-evident format
- Stored in append-only audit store; write-once bucket policy
- Accessible only to compliance team with dual-control approval

### Anomaly Detection on Logs

Streaming log analysis identifies:
- Sudden spike in failed auth for one account (credential stuffing)
- Account accessing vault from new country/device/IP range (ATO detection)
- Large batch of item deletes (ransomware or data destruction)
- Emergency access requests from multiple contacts to same account (coordinated social engineering)
- Extension reporting autofill to an unusually high number of distinct domains (extension compromise)
- Programmatic autofill requests without preceding user gesture (`isTrusted=false` events)
- CXP export operations followed by immediate account deletion (credential theft via portability)
- Passkey creation bursts from a single account (potential credential stuffing of FIDO2 keys)

---

## Distributed Tracing

### Trace Propagation

Traces propagate via W3C Trace Context headers (`traceparent`, `tracestate`) across all service boundaries. Sensitive context (account_id, vault_id) flows as hashed values in span attributes only:

```
Root Span: "vault.sync.request"
  Attributes:
    account_id_hash: sha256(account_id)[0:16]  // partial hash for trace correlation
    device_platform: "browser_extension"
    sync_version_from: 1047
    sync_version_to: 1089
  Duration: 340ms

  Child Span: "vault_db.shard_query"
    Attributes:
      shard_id: 2
      query_type: "items_since_version"
      items_returned: 12
    Duration: 28ms

  Child Span: "sync_queue.publish"
    Attributes:
      recipient_device_count: 3
      queue_depth_before: 127
    Duration: 5ms
```

### Critical Paths to Trace

| User Flow | Trace Coverage |
|---|---|
| Vault unlock (auth → key fetch → local decrypt) | End-to-end from client to server and back |
| Vault item creation (encrypt → upload → sync fan-out) | Full write path including async fan-out latency |
| Autofill (extension DOM scan → credential fetch → fill) | Client-side only (no server trace for autofill performance) |
| Emergency access request → approval → key retrieval | Multi-request trace correlated by access_id |
| Breach check (extension → breach API → response) | Full round trip including cache hit rate |

---

## Alerting

### Critical Alerts (Page On-Call Immediately)

| Alert | Condition | Runbook |
|---|---|---|
| Auth service down | Auth success rate < 90% for 2 min | Restart pods; check DB connectivity; regional failover |
| Key store unreachable | Key store availability < 99% for 1 min | Circuit breaker active; alert DBA; potential DR invocation |
| Vault DB replication lag | Replication lag > 60s for any replica | Check replica health; pause non-critical traffic to lagging replica |
| Mass auth failures | Auth failure rate > 500/min from distinct IPs | DDoS or credential stuffing; activate enhanced rate limiting |
| Emergency key release unauthorized | Emergency access released before wait period expired | Immediate investigation; potential system compromise |
| Tamper detected in audit log | Hash chain validation failure | Security incident declared; forensic investigation |

### Warning Alerts (Notify On-Call, Non-Paging)

| Alert | Condition | Action |
|---|---|---|
| Breach check availability | Breach check error rate > 5% for 5 min | Check breach DB connectivity; switch to cached results |
| Sync conflict rate spike | Conflict rate > 1% of sync operations for 10 min | Investigate CRDT merge correctness; check for clock skew |
| Tombstone accumulation | Tombstone count growth > 10% in 24h | Review tombstone Cutting off unnecessary steps job; check for deletion storm |
| Extension autofill blocked rate | Blocked rate > 20% of autofill attempts for 30 min | Possible DOM clickjacking campaign; review blocked reason distribution |
| Session token anomalies | Refresh token reuse detected | Potential token theft; invalidate affected sessions |
| Passkey auth failure spike | passkey_auth failure rate > 10% for 5 min | Check WebAuthn assertion validation; verify RP ID matching; check authenticator compatibility |
| Agent programmatic fill spike | agent_blocked_programmatic_fill > 100/min | Possible AI agent credential harvesting; review source distribution; tighten isTrusted enforcement |
| CXP export volume anomaly | CXP exports > 5x baseline for 1 hour | Possible mass credential exfiltration; review account-level export counts |
| Post-quantum fallback rate | pq_hybrid_handshake fallback_classic > 20% for 15 min | ML-KEM negotiation failing; check client version distribution; potential downgrade attack |

### SLO Burn Rate Alerts

```
# 1-hour burn rate for vault sync availability
alert: VaultSyncSLOFast
  condition: burn_rate_1h > 14.4  # consuming 30-day budget in 2 hours
  severity: critical

# 6-hour burn rate (sustained degradation)
alert: VaultSyncSLOSlow
  condition: burn_rate_6h > 6  # consuming 30-day budget in 5 days
  severity: warning
```

---

## Security Monitoring Dashboards

### Dashboard 1: Authentication Health

```
┌────────────────────────────────────────────────────────────┐
│ Authentication Overview — Real-Time (Last 1 Hour)          │
├──────────────┬──────────────┬────────────┬─────────────────┤
│ Auth/min     │ Success Rate │ MFA Rate   │ New Devices/hr  │
│   8,240      │   99.2%      │   71.3%    │   1,847         │
├──────────────┴──────────────┴────────────┴─────────────────┤
│ [Time series: auth attempts colored by region]             │
│ [Geo heatmap: login origins (country level)]               │
│ [Failed auth heatmap: brute-force detection]               │
├────────────────────────────────────────────────────────────┤
│ Top accounts by failed auth (hashed IDs) — rate limiting   │
│ Anomalous login patterns (new country, new device)         │
└────────────────────────────────────────────────────────────┘
```

### Dashboard 2: Vault Operations Health

```
┌────────────────────────────────────────────────────────────┐
│ Vault Operations — Last 24 Hours                           │
├──────────┬──────────┬──────────────┬────────────────────── │
│ Sync/s   │ Items/s  │ Conflict %   │ Queue Depth           │
│ 12,400   │ 58,200   │ 0.08%        │ 2,340                 │
├──────────┴──────────┴──────────────┴────────────────────── │
│ [Latency p50/p95/p99 per shard]                           │
│ [Conflict resolution outcomes pie chart]                   │
│ [Tombstone count trend per shard]                          │
│ [Sync queue depth per region]                              │
└────────────────────────────────────────────────────────────┘
```

### Dashboard 3: Security Events

```
┌────────────────────────────────────────────────────────────┐
│ Security Events — Real-Time                                │
├──────────────────────────────────────────────────────────  │
│ [Timeline: security events by type, color-coded severity]  │
│ [Rate limiting triggers map]                               │
│ [Emergency access events: request/approve/cancel counts]   │
│ [Export events per hour — spikes indicate bulk download]   │
│ [Breach check positive rate trend]                         │
│ [Anomaly detection alerts — last 100 events]               │
└────────────────────────────────────────────────────────────┘
```

### Dashboard 4: Extension Health

```
┌────────────────────────────────────────────────────────────┐
│ Browser Extension — Autofill Health (Last 7 Days)          │
├──────────────┬───────────────┬────────────────────────────┤
│ Fills/day    │ Fill Rate     │ Block Rate                  │
│ 24M          │ 87.3%         │ 4.2%                        │
├──────────────┴───────────────┴────────────────────────────┤
│ [Breakdown by platform: Chrome/Firefox/Safari/Edge]        │
│ [Fill trigger type: user_click vs keyboard]                │
│ [Block reason distribution: pie chart]                     │
│ [Autofill latency distribution histogram]                  │
│ [Extension version distribution — detect old versions]     │
└────────────────────────────────────────────────────────────┘
```

### Dashboard 5: Passkey & FIDO2 Operations

```
┌────────────────────────────────────────────────────────────┐
│ Passkey Operations — Real-Time (Last 24 Hours)             │
├──────────────┬───────────────┬────────────────────────────┤
│ Creations/hr │ Auth Success  │ CXP Exports/day             │
│ 3,420        │ 98.7%         │ 847                         │
├──────────────┴───────────────┴────────────────────────────┤
│ [Passkey auth vs password auth ratio — trend over 30 days] │
│ [Conditional UI trigger rate by platform]                   │
│ [Passkey type distribution: discoverable vs non-disc.]     │
│ [Hardware-bound vs synced passkey ratio]                    │
│ [CXP import/export volume with success rate overlay]       │
│ [RP ID mismatch events — phishing detection signal]        │
└────────────────────────────────────────────────────────────┘
```

### Dashboard 6: Post-Quantum Migration & AI Agent Monitoring

```
┌────────────────────────────────────────────────────────────┐
│ Migration & Agent Security — Real-Time                     │
├──────────────────────────────────────────────────────────  │
│ PQ Migration Progress:                                     │
│ [Gauge: % vaults re-encrypted with hybrid ML-KEM keys]     │
│ [Key exchange algorithm distribution: classic vs hybrid]    │
│ [Fallback-to-classic rate trend — should approach zero]     │
│ [Re-keying batch job duration and throughput]               │
├──────────────────────────────────────────────────────────  │
│ AI Agent Detection:                                        │
│ [Programmatic vs user-initiated autofill ratio]            │
│ [isTrusted validation outcomes: trusted/untrusted/indet.]  │
│ [Blocked programmatic fills by reason code]                │
│ [Agent credential access scope distribution]               │
└────────────────────────────────────────────────────────────┘
```

---

## On-Call Runbooks

### Vault Sync Degraded

```
1. Check vault_sync_requests_total error rate by region
2. Check vault_db_connections_active — DB pool exhaustion?
3. Check vault_db_replication_lag_seconds — replica too far behind?
4. If DB issue: scale read replicas; page DBA
5. If queue issue: check sync_queue_depth_gauge; restart queue consumers
6. If pod OOM: increase memory limits; scale out pods
7. Communicate to status page: "Vault sync experiencing delays"
```

### Mass Authentication Failure

```
1. Check auth_login_attempts_total{result="failure"} rate by region
2. Check if rate limiting is active: auth_rate_limited_total spike?
3. Identify source: same IPs? Same account IDs? New country?
4. If credential stuffing: activate IP block list; increase CAPTCHA threshold
5. If DDoS: activate traffic scrubbing; engage CDN provider
6. Check if OPAQUE service is healthy: opaque_evaluation_latency?
7. If legitimate auth failure: check OPAQUE server record DB connectivity
```

### Passkey Authentication Failures

```
1. Check passkey_auth_total{result="failure"} rate and distribution by platform
2. Compare against passkey_auth_duration_seconds — latency-related timeouts?
3. Check passkey_rp_id_mismatch_total — if spiking, possible phishing or RP ID
   configuration error in a recent deployment
4. If platform-specific: check browser/OS version distribution; known WebAuthn
   regression in specific browser version?
5. If hardware-bound only: check passkey_hardware_bound_total by transport type;
   USB/NFC connectivity issues for security keys
6. If conditional UI failures: check passkey_conditional_ui_triggered_total rate;
   verify credential list endpoint health
7. If CXP-related: check passkey_cxp_import_total for recent imports with
   incompatible key formats
8. Communicate to status page: "Passkey authentication may be temporarily
   unavailable; password login remains operational"
```

### Suspected AI Agent Credential Harvesting

```
1. Check agent_blocked_programmatic_fill_total spike rate and reason distribution
2. Check agent_is_trusted_validation_total{result="untrusted"} trend
3. If isTrusted=false spike: identify extension version — Manifest V3 service
   worker handling change? Or external agent injecting synthetic events?
4. Check agent_credential_access_scope_total{scope="bulk_read"} — bulk access
   attempts suggest automated harvesting rather than single-item autofill
5. If isolated to specific accounts: check if accounts recently installed
   third-party browser extensions or AI assistants with DOM access
6. If widespread: issue emergency extension update to tighten user gesture
   validation; require explicit vault unlock for each fill operation
7. Alert security team for forensic analysis of autofill request patterns
8. If confirmed harvesting: activate kill switch to disable programmatic
   autofill globally; require click-to-fill only
```

### Post-Quantum Migration Stall

```
1. Check pq_vault_reencrypt_progress_gauge — what % of vaults remain pending?
2. Check pq_migration_batch_duration_seconds — are batch jobs timing out?
3. If batch failures: check for vaults with unusually large item counts
   causing re-encryption timeout; increase batch size limits
4. Check pq_hybrid_handshake_total{result="fallback_classic"} — high fallback
   indicates client-side ML-KEM library incompatibility
5. Check client version distribution — old clients may not support ML-KEM;
   compute % of active sessions on pre-PQ clients
6. If key exchange negotiation failures: verify ML-KEM parameter compatibility
   between client and server; check for certificate chain issues with
   hybrid key exchange
7. If stalled at high %: prioritize high-value enterprise accounts for
   forced migration; notify remaining users with client upgrade prompt
```
