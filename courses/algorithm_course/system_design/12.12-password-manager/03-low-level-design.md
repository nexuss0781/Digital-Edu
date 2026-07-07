# 03 — Low-Level Design: Password Manager

## Data Models

### Vault Item (stored server-side as ciphertext)

```
VaultItem {
  id:                UUID            // globally unique, generated client-side (UUIDv7 for time-ordering)
  vault_id:          UUID            // parent vault identifier
  owner_account_id:  UUID
  schema_version:    integer         // for forward compatibility (current: 3)
  item_type:         enum            // login, secure_note, card, identity, ssh_key, passkey, totp
  created_at:        timestamp       // server-received time (opaque — server cannot correlate to content)
  modified_at:       timestamp       // last server-received modification time
  client_modified_at: timestamp      // client-reported modification time (inside encrypted_data)
  version_vector:    map<device_id, integer>  // CRDT vector clock for conflict resolution
  encrypted_data:    bytes           // AES-256-GCM ciphertext of ItemPayload (all content + metadata)
  encrypted_item_key: bytes          // item key wrapped in vault key (AES-256-GCM key wrap)
  data_nonce:        bytes           // 12-byte GCM nonce for encrypted_data
  auth_tag:          bytes           // 16-byte GCM authentication tag
  integrity_sig:     bytes           // Ed25519 signature over (id, vault_id, encrypted_data, encrypted_item_key)
  device_sig_key_id: UUID            // which device key signed this item
  is_deleted:        boolean         // tombstone flag (true = soft-deleted, retained for CRDT sync)
  tombstone_expiry:  timestamp?      // tombstones garbage-collected after all devices confirm sync
  folder_id:         UUID?           // optional folder/collection grouping (encrypted in ItemPayload)
  size_bytes:        integer         // ciphertext size for quota enforcement
}
```

**ItemPayload (encrypted content — everything inside is ciphertext on the server):**
```
ItemPayload {
  title:           string            // encrypted — server never sees item names
  username:        string?
  password:        string?
  totp_secret:     string?           // Base32-encoded TOTP seed
  urls:            list<URLRecord>   // encrypted — server never sees URLs
  custom_fields:   list<CustomField>
  notes:           string?
  card_number:     string?
  expiry:          string?
  cvv:             string?
  ssh_private_key: string?
  passkey_credential: PasskeyRecord? // full FIDO2 credential (see PasskeyCredential model)
  tags:            list<string>      // encrypted — server cannot categorize items
  favorite:        boolean           // inside encrypted payload (no metadata leak)
  folder_name:     string?           // folder resolved client-side from encrypted payload
  password_history: list<PasswordHistoryEntry>  // previous passwords with rotation timestamps
  client_modified_at: timestamp
  client_created_at:  timestamp
}

URLRecord {
  url:         string
  match_type:  enum       // exact, domain, starts_with, regex
  label:       string?    // user-assigned label ("Work login", "Admin panel")
}

CustomField {
  name:        string
  value:       string
  field_type:  enum       // text, hidden, boolean, linked (auto-fill target)
}

PasswordHistoryEntry {
  password:    string
  rotated_at:  timestamp
}
```

---

### Account Key Envelope (stored server-side, never decryptable by server)

```
AccountKeyEnvelope {
  account_id:          UUID
  email_hash:          string        // SHA-256 of email for lookup; real email stored separately
  opaque_record:       bytes         // OPAQUE server-side registration record (256 bytes)
  encrypted_account_key: bytes       // account key encrypted with KDF-derived key; server cannot decrypt
  account_key_nonce:   bytes
  secret_key_verifier: bytes         // HMAC of secret key — allows server to verify secret key
                                     // possession without learning the key itself
  vault_key_envelopes: list<VaultKeyEnvelope>
  device_key_envelopes: list<DeviceKeyEnvelope>
  public_key:          bytes         // X25519 public key (32 bytes, for receiving shared items)
  signing_public_key:  bytes         // Ed25519 public key (32 bytes, for verifying item signatures)
  pq_encapsulation_key: bytes        // ML-KEM-768 encapsulation key (1,184 bytes, for post-quantum sharing)
  key_generation:      integer       // incremented on password change; used to detect stale key envelopes
  created_at:          timestamp
  last_auth_at:        timestamp
  last_password_change_at: timestamp
  mfa_config:          MFAConfig
  sentinel_config:     SentinelConfig  // anomaly detection preferences
}

VaultKeyEnvelope {
  vault_id:              UUID
  vault_role:            enum        // owner, admin, editor, viewer (for organization vaults)
  encrypted_vault_key:   bytes       // vault key wrapped in account key (AES-256-GCM)
  vault_key_nonce:       bytes
  key_rotation_version:  integer     // incremented on vault key rotation
  previous_key_versions: list<EncryptedVaultKey>  // retained for decrypting older items/backups
}

DeviceKeyEnvelope {
  device_id:             UUID
  device_name:           string
  platform:              enum        // browser_extension, mobile_ios, mobile_android, desktop_macos,
                                     // desktop_windows, desktop_linux
  encrypted_session_key: bytes       // short-lived session key wrapped in account key
  device_public_key:     bytes       // Ed25519 public key for device-specific signatures
  created_at:            timestamp
  last_seen_at:          timestamp
  last_ip_hash:          string      // SHA-256 of last known IP (for anomaly detection)
  trusted:               boolean
  revoked:               boolean     // soft-revoke: device must re-authenticate to regain access
}

MFAConfig {
  totp_enabled:       boolean
  totp_secret_hash:   string         // server stores hash for replay detection, not the TOTP seed itself
  webauthn_credentials: list<WebAuthnCredentialRef>
  recovery_codes_hash: string        // hash of recovery codes; actual codes encrypted in vault
  preferred_method:    enum           // totp, webauthn, push
}

SentinelConfig {
  enabled:             boolean
  alert_new_device:    boolean
  alert_new_geo:       boolean
  alert_bulk_export:   boolean
  alert_rapid_sharing: boolean
  notification_email:  string?       // encrypted email for out-of-band alerts
}
```

---

### Shared Item Record

```
SharedItemRecord {
  id:                     UUID
  item_id:                UUID            // the VaultItem being shared
  source_account_id:      UUID            // Alice's account
  target_account_id:      UUID            // Bob's account
  encrypted_item_key:     bytes           // item key wrapped via hybrid key exchange
  classical_ephemeral_pk: bytes           // X25519 ephemeral public key (32 bytes)
  pq_ciphertext:          bytes           // ML-KEM-768 ciphertext (1,088 bytes)
  key_nonce:              bytes           // AES-256-GCM nonce for the wrapped key
  key_auth_tag:           bytes           // AES-256-GCM auth tag
  permissions:            enum            // read_only, can_edit, can_reshare
  share_type:             enum            // individual_item, vault_membership, passkey_group
  granted_at:             timestamp
  expires_at:             timestamp?
  revoked_at:             timestamp?
  revocation_reason:      enum?           // manual, key_rotation, org_policy
}
```

---

### Emergency Access Record

```
EmergencyAccessRecord {
  id:                   UUID
  grantor_account_id:   UUID         // vault owner (Alice)
  grantee_account_id:   UUID         // trusted contact (Bob)
  key_share:            bytes        // one Shamir share, encrypted with Bob's public key
  share_index:          integer      // which share (1 of n)
  threshold:            integer      // minimum shares needed (k)
  wait_period_days:     integer      // 1-30 days
  status:               enum         // pending_invite, active, request_sent, approved, cancelled
  request_sent_at:      timestamp?
  auto_approve_at:      timestamp?   // wait_period_days after request_sent_at
  approved_at:          timestamp?
}
```

---

### Passkey Credential (stored encrypted inside ItemPayload.passkey_credential)

```
PasskeyCredential {
  credential_id:      bytes           // WebAuthn credential ID (server-assigned, opaque)
  rp_id:              string          // relying party identifier (e.g., "example.com")
  rp_name:            string          // human-readable RP name
  user_handle:        bytes           // WebAuthn user handle (RP-assigned user identifier)
  user_name:          string          // username associated with passkey at RP
  user_display_name:  string          // display name
  private_key:        bytes           // COSE private key (ECDSA P-256 or Ed25519)
  public_key:         bytes           // COSE public key (for reference/export)
  key_algorithm:      enum            // ES256 (P-256), EdDSA (Ed25519)
  sign_count:         integer         // monotonic counter incremented on each assertion
  discoverable:       boolean         // true = resident credential (conditional UI eligible)
  created_at:         timestamp
  last_used_at:       timestamp
  backup_eligible:    boolean         // BE flag per WebAuthn spec
  backup_state:       boolean         // BS flag — true if synced across devices
  attestation_format: string?         // "none", "packed", "tpm" — stored for audit
  extensions:         map<string, bytes>  // WebAuthn extensions (hmac-secret, credBlob, etc.)
}
```

**Key size reference for passkey credentials:**
| Algorithm | Private Key | Public Key | Signature | Total per Credential |
|---|---|---|---|---|
| ECDSA P-256 (ES256) | 32 bytes | 65 bytes | 64 bytes | ~400 bytes encrypted |
| Ed25519 (EdDSA) | 32 bytes | 32 bytes | 64 bytes | ~350 bytes encrypted |

---

### CXF Export Record (Credential Exchange Format)

```
CXFExportPayload {
  format_version:     string          // "cxf-draft-01"
  exporter_name:      string          // name of exporting password manager
  export_timestamp:   timestamp
  credentials:        list<CXFCredential>
  metadata:           CXFMetadata
}

CXFCredential {
  credential_type:    enum            // password, passkey, totp, card, note
  // For password type:
  origin:             string?         // URL origin (e.g., "https://example.com")
  username:           string?
  password:           string?
  display_name:       string?
  notes:              string?
  // For passkey type:
  rp_id:              string?
  credential_id:      bytes?
  private_key_cose:   bytes?          // full COSE key for portability
  user_handle:        bytes?
  user_name:          string?
  // For TOTP type:
  totp_secret:        string?         // Base32-encoded
  totp_algorithm:     string?         // SHA1, SHA256, SHA512
  totp_digits:        integer?        // 6 or 8
  totp_period:        integer?        // typically 30
  // Common fields:
  created_at:         timestamp?
  modified_at:        timestamp?
  tags:               list<string>
}

CXFMetadata {
  total_credentials:  integer
  credential_counts:  map<string, integer>  // e.g., {"password": 450, "passkey": 30}
  export_reason:      string?               // "user_initiated", "account_closure"
}
```

**CXF transport envelope (HPKE-encrypted):**
```
CXFTransportEnvelope {
  hpke_kem_id:         integer        // ML-KEM-768 or X25519 KEM identifier
  hpke_kdf_id:         integer        // HKDF-SHA256
  hpke_aead_id:        integer        // AES-256-GCM
  encapsulated_key:    bytes          // HPKE encapsulated key
  encrypted_payload:   bytes          // HPKE-encrypted CXFExportPayload
  signature:           bytes          // Ed25519 signature from exporting manager
  exporter_public_key: bytes          // for signature verification
}
```

---

### Audit Log Entry (append-only)

```
AuditLogEntry {
  id:               UUID
  account_id:       UUID
  event_type:       enum   // vault_unlock, item_create, item_update, item_delete, share_grant,
                           // share_revoke, emergency_access_request, emergency_access_approve,
                           // emergency_access_cancel, login_success, login_failure,
                           // mfa_challenge, mfa_failure, export_performed, import_performed,
                           // breach_check, password_changed, key_rotated, device_registered,
                           // device_revoked, passkey_assertion, sentinel_alert
  device_id:        UUID?
  ip_hash:          string  // SHA-256 of IP; not plaintext to limit PII
  geo_region:       string? // coarse geo (country-level) for sentinel anomaly detection
  user_agent_hash:  string
  item_id:          UUID?   // if event relates to a specific item
  metadata:         bytes   // minimal encrypted context (no plaintext credentials)
  risk_score:       float?  // sentinel-computed risk (0.0 - 1.0)
  timestamp:        timestamp
  prev_entry_hash:  bytes   // SHA-256 of previous entry (hash chain for tamper detection)
  entry_hash:       bytes   // SHA-256(account_id || event_type || timestamp || prev_entry_hash || metadata)
}
```

---

## API Design

### Authentication

```
POST /v1/auth/register/start
  Body: { email_hash: string, opaque_request: bytes }
  Response: { opaque_response: bytes, session_id: UUID }

POST /v1/auth/register/finish
  Body: { session_id: UUID, opaque_finish: bytes,
          encrypted_account_key: bytes, public_key: bytes, signing_public_key: bytes }
  Response: { account_id: UUID }

POST /v1/auth/login/start
  Body: { email_hash: string, opaque_request: bytes }
  Response: { opaque_response: bytes, session_id: UUID }

POST /v1/auth/login/finish
  Body: { session_id: UUID, opaque_finish: bytes, device_id: UUID, mfa_token: string? }
  Response: { access_token: JWT, refresh_token: string,
              encrypted_account_key: bytes, vault_key_envelopes: list<VaultKeyEnvelope> }

POST /v1/auth/refresh
  Body: { refresh_token: string }
  Response: { access_token: JWT, refresh_token: string }

POST /v1/auth/logout
  Headers: Authorization: Bearer <access_token>
  Body: { device_id: UUID }
  Response: 204 No Content
```

### Vault Operations

```
GET /v1/vaults/{vault_id}/items
  Headers: Authorization: Bearer <access_token>
  Query: { since_version: integer?, page_cursor: string? }
  Response: {
    items: list<VaultItemEnvelope>,  // ciphertext + metadata only
    next_cursor: string?,
    vault_version: integer
  }

POST /v1/vaults/{vault_id}/items
  Headers: Authorization: Bearer <access_token>
  Body: VaultItem  (fully encrypted)
  Response: { id: UUID, modified_at: timestamp, server_version: integer }

PUT /v1/vaults/{vault_id}/items/{item_id}
  Headers: Authorization: Bearer <access_token>
  Body: VaultItem  (fully encrypted, includes version_vector for conflict detection)
  Response: { modified_at: timestamp, server_version: integer }
  Error 409: ConflictResponse { server_item: VaultItem }  // client must merge

DELETE /v1/vaults/{vault_id}/items/{item_id}
  Headers: Authorization: Bearer <access_token>
  Body: { version_vector: map<device_id, integer> }
  Response: 200  (tombstone set; item retained until sync propagation confirmed)

POST /v1/vaults/{vault_id}/sync
  Headers: Authorization: Bearer <access_token>
  Body: { device_id: UUID, last_sync_version: integer }
  Response: { changes: list<VaultItem>, server_version: integer }
```

### Sharing

```
GET /v1/accounts/{account_id}/public-key
  Response: { account_id, public_key: bytes, signing_public_key: bytes }

POST /v1/shares
  Body: SharedItemRecord
  Response: { share_id: UUID }

DELETE /v1/shares/{share_id}
  Response: 204 No Content  (server removes; client should re-encrypt item with new key)

GET /v1/shares/received
  Response: list<SharedItemRecord>  (filtered to calling account's shares)
```

### Emergency Access

```
POST /v1/emergency-access/invite
  Body: { grantee_email_hash, key_shares: list<EncryptedShare>, threshold, wait_period_days }
  Response: { access_id: UUID }

POST /v1/emergency-access/{access_id}/request
  Response: { auto_approve_at: timestamp }

POST /v1/emergency-access/{access_id}/cancel
  Response: 204 No Content

GET /v1/emergency-access/{access_id}/shares
  Headers: Authorization: Bearer <grantee_token>
  Response: list<EncryptedShare>  (only after wait_period elapsed or owner approved)
```

### Passkey Operations

```
POST /v1/passkeys/register-begin
  Headers: Authorization: Bearer <access_token>
  Body: { rp_id: string, rp_name: string, user_handle: bytes, user_name: string,
          attestation_preference: string }
  Response: { creation_options: PublicKeyCredentialCreationOptions }
  // Client generates key pair, encrypts private key in vault, returns attestation

POST /v1/passkeys/register-finish
  Headers: Authorization: Bearer <access_token>
  Body: { attestation_response: AuthenticatorAttestationResponse,
          encrypted_vault_item: VaultItem }  // passkey stored as encrypted vault item
  Response: { credential_id: bytes, item_id: UUID }

POST /v1/passkeys/authenticate-begin
  Body: { rp_id: string }
  Response: { assertion_options: PublicKeyCredentialRequestOptions }

POST /v1/passkeys/authenticate-finish
  Body: { assertion_response: AuthenticatorAssertionResponse }
  Response: { verified: boolean, user_handle: bytes }
  // Assertion signing happens client-side; server only verifies public key
```

### Credential Export/Import (CXF)

```
POST /v1/export/cxf/prepare
  Headers: Authorization: Bearer <access_token>
  Body: { credential_ids: list<UUID>, recipient_hpke_public_key: bytes }
  Response: { export_id: UUID, requires_mfa: boolean }
  // Requires re-authentication + MFA before proceeding

POST /v1/export/cxf/confirm
  Headers: Authorization: Bearer <access_token>
  Body: { export_id: UUID, mfa_token: string }
  Response: { cxf_envelope: CXFTransportEnvelope }
  // Client decrypts items, serializes to CXF, HPKE-encrypts, returns envelope

POST /v1/import/cxf
  Headers: Authorization: Bearer <access_token>
  Body: { cxf_envelope: CXFTransportEnvelope }
  Response: { imported_count: integer, skipped_duplicates: integer,
              items: list<{ id: UUID, credential_type: string }> }
  // Client HPKE-decrypts, re-encrypts each item with local vault key, uploads

POST /v1/import/csv
  Headers: Authorization: Bearer <access_token>
  Body: { csv_data: string, source_manager: string? }
  Response: { imported_count: integer, parse_errors: list<{ row: integer, error: string }> }
  // Client parses CSV, encrypts each item, uploads in batch
```

### Breach Detection

```
GET /v1/breach/check/{hash_prefix}
  Query: { hash_prefix: string }  // first 5 hex characters of SHA-1 hash (k-anonymity)
  Response: { hashes: list<{ suffix: string, count: integer }> }
  // Client checks locally if full hash is in the list

POST /v1/breach/check-batch
  Body: { prefixes: list<string> }  // batch of up to 100 prefixes
  Response: { results: map<string, list<{ suffix: string, count: integer }>> }
  // For vault-wide breach audit: client generates all prefixes, queries in batch
```

### Sentinel Monitoring

```
GET /v1/sentinel/alerts
  Headers: Authorization: Bearer <access_token>
  Query: { since: timestamp?, status: string? }
  Response: { alerts: list<SentinelAlert> }

POST /v1/sentinel/alerts/{alert_id}/dismiss
  Headers: Authorization: Bearer <access_token>
  Response: 204 No Content

SentinelAlert {
  id:           UUID
  alert_type:   enum    // new_device, new_geo, bulk_export, rapid_sharing,
                        // brute_force_attempt, concurrent_sessions_anomaly
  severity:     enum    // info, warning, critical
  details:      string  // human-readable description (no sensitive data)
  ip_hash:      string
  geo_region:   string
  created_at:   timestamp
  dismissed_at: timestamp?
}
```

---

## Core Algorithms (Step-by-step plan in plain English)

### Key Derivation Hierarchy

```
function deriveAccountKey(masterPassword, email, params):
  // Argon2id stretches master password; email is salt input
  salt = SHA256(email.toLowerCase())
  stretchedKey = Argon2id(
    password  = masterPassword,
    salt      = salt,
    memory    = 65536 KB,   // 64 MB
    iterations = 3,
    parallelism = 4,
    outputLen = 64           // 512 bits
  )
  // Split into two 256-bit halves
  authKey      = stretchedKey[0:32]   // used in OPAQUE
  accountKey   = stretchedKey[32:64]  // used for key encryption

  return (authKey, accountKey)

function deriveVaultKey(accountKey, vaultId):
  // HKDF expands accountKey into vault-specific key
  vaultKey = HKDF-Expand(
    prk  = accountKey,
    info = "vault-key-v1:" + vaultId,
    len  = 32
  )
  return vaultKey

function deriveItemKey():
  // Item keys are random, not derived — enables independent rotation
  return SecureRandom(32)  // 256-bit random key
```

### Encrypt / Decrypt Item

```
function encryptItem(itemPayload, itemKey):
  nonce     = SecureRandom(12)         // 96-bit GCM nonce
  plaintext = Serialize(itemPayload)   // canonical JSON or protobuf
  (ciphertext, tag) = AES-256-GCM-Encrypt(
    key       = itemKey,
    nonce     = nonce,
    plaintext = plaintext,
    aad       = ""                     // additional authenticated data if needed
  )
  return { ciphertext, nonce, tag }

function decryptItem(envelope, itemKey):
  (plaintext, valid) = AES-256-GCM-Decrypt(
    key        = itemKey,
    nonce      = envelope.nonce,
    ciphertext = envelope.ciphertext,
    tag        = envelope.tag
  )
  if not valid:
    raise IntegrityError("Decryption failed — vault data may be tampered")
  return Deserialize(plaintext)

function wrapKey(keyToWrap, wrappingKey):
  nonce = SecureRandom(12)
  (wrapped, tag) = AES-256-GCM-Encrypt(
    key       = wrappingKey,
    nonce     = nonce,
    plaintext = keyToWrap
  )
  return { wrapped, nonce, tag }

function unwrapKey(wrappedEnvelope, wrappingKey):
  (rawKey, valid) = AES-256-GCM-Decrypt(
    key        = wrappingKey,
    nonce      = wrappedEnvelope.nonce,
    ciphertext = wrappedEnvelope.wrapped,
    tag        = wrappedEnvelope.tag
  )
  if not valid: raise IntegrityError()
  return rawKey
```

### OPAQUE Registration (Client Side)

```
function opaqueRegisterStart(masterPassword, email):
  (authKey, accountKey) = deriveAccountKey(masterPassword, email, defaultParams)

  // OPAQUE blind: client generates OPRF input from authKey
  (blindInput, blindingFactor) = OPRF.blind(authKey)

  state = { blindingFactor, accountKey }
  return { opaqueRequest: blindInput, clientState: state }

function opaqueRegisterFinish(opaqueResponse, clientState, email):
  // Evaluate blinded OPRF output
  oprfOutput = OPRF.unblind(opaqueResponse.evaluatedBlind, clientState.blindingFactor)

  // Derive OPAQUE registration key material
  exportKey = OPAQUE.finalizeRegistration(oprfOutput, email)

  // Encrypt account key with exportKey (server never sees accountKey or masterPassword)
  encryptedAccountKey = wrapKey(clientState.accountKey, exportKey)

  return {
    opaqueRecord:       opaqueResponse.serverRecord,
    encryptedAccountKey: encryptedAccountKey,
    publicKey:           X25519.publicKey(clientState.accountKey),
    signingPublicKey:    Ed25519.publicKey(clientState.accountKey)
  }
```

### CRDT Vault Sync — Merge Logic

```
function mergeVaultChanges(localItems, serverChanges):
  merged = copy(localItems)

  for serverItem in serverChanges:
    localItem = merged.get(serverItem.id)

    if localItem is null:
      // New item from another device
      merged[serverItem.id] = serverItem

    elif serverItem.is_deleted and not localItem.is_deleted:
      // Delete wins over edit in add-wins CRDT with delete tombstones
      // Only if server delete vector dominates local edit vector
      if vectorDominates(serverItem.version_vector, localItem.version_vector):
        merged[serverItem.id] = serverItem  // apply tombstone
      // else: local edit happened after delete — keep local (conflict logged)

    elif not serverItem.is_deleted and localItem.is_deleted:
      // Local deleted, server has newer edit — server edit wins if it dominates
      if vectorDominates(serverItem.version_vector, localItem.version_vector):
        merged[serverItem.id] = serverItem  // resurrect item
      // else: keep local tombstone

    else:
      // Both exist, both modified — merge by highest timestamp within each device clock
      mergedVector = mergeClock(localItem.version_vector, serverItem.version_vector)
      if localItem.client_modified_at >= serverItem.client_modified_at:
        merged[serverItem.id] = localItem
        merged[serverItem.id].version_vector = mergedVector
      else:
        merged[serverItem.id] = serverItem
        merged[serverItem.id].version_vector = mergedVector

  return merged

function vectorDominates(v1, v2):
  // v1 dominates v2 if v1[d] >= v2[d] for all d, and v1[d] > v2[d] for at least one d
  for device in union(v1.keys, v2.keys):
    if v1.get(device, 0) < v2.get(device, 0):
      return false
  return v1 != v2
```

### Shamir's Secret Sharing — Emergency Access

```
function splitAccountKey(accountKey, n, k):
  // Split 256-bit key into n shares, requiring k to reconstruct
  // Using GF(2^8) polynomial secret sharing
  prime = large_prime  // Shamir's uses prime field
  secret = BigInt(accountKey)

  // Generate random polynomial of degree k-1
  coefficients = [secret] + [SecureRandom(256 bits) for _ in range(k-1)]

  shares = []
  for i in 1..n:
    x = i
    y = evaluatePolynomial(coefficients, x, prime)
    shares.append({ index: i, value: y })

  return shares

function reconstructAccountKey(shares, k, prime):
  // Lagrange interpolation at x=0 to recover secret (constant term)
  assert len(shares) >= k
  selectedShares = shares[0:k]
  secret = lagrangeInterpolationAtZero(selectedShares, prime)
  return Bytes(secret)

function encryptShareForContact(share, contactPublicKey):
  // Ephemeral X25519 key exchange
  ephemeralPrivate = X25519.generateKeyPair()
  sharedSecret = X25519.DH(ephemeralPrivate.private, contactPublicKey)
  encryptionKey = HKDF(sharedSecret, "emergency-share-v1")
  return {
    ephemeralPublic: ephemeralPrivate.public,
    encryptedShare:  AES-256-GCM-Encrypt(encryptionKey, Serialize(share))
  }
```

### k-Anonymity Breach Check

```
function checkPasswordBreach(plainPassword):
  // HIBP-style k-anonymity: only send first 5 hex chars of SHA-1 hash
  sha1Hash = SHA1(plainPassword).hex().toUpperCase()
  prefix   = sha1Hash[0:5]
  suffix   = sha1Hash[5:]

  // Query server with prefix only — server learns nothing about actual password
  allSuffixes = BreachAPI.getHashes(prefix)  // returns all matching suffixes

  for entry in allSuffixes:
    if entry.hash_suffix == suffix:
      return { breached: true, count: entry.prevalence_count }

  return { breached: false }
```

### Autofill Origin Matching

```
function findMatchingCredentials(currentUrl, vault):
  candidates = []
  currentDomain = extractRegistrableDomain(currentUrl)   // e.g., "bank.com"
  currentOrigin = extractOrigin(currentUrl)               // e.g., "https://bank.com"

  for item in vault.loginItems():
    for urlRecord in item.urls:
      match = false
      switch urlRecord.match_type:
        case exact:
          match = (currentUrl == urlRecord.url)
        case domain:
          itemDomain = extractRegistrableDomain(urlRecord.url)
          match = (currentDomain == itemDomain)
        case starts_with:
          match = currentUrl.startsWith(urlRecord.url)
        case regex:
          match = Regex(urlRecord.url).test(currentUrl)

      // Always enforce same registrable domain — prevent subdomain hijack
      itemDomain = extractRegistrableDomain(urlRecord.url)
      if itemDomain != currentDomain:
        match = false  // cross-domain never matches regardless of rule

      if match:
        candidates.append(item)
        break

  // Sort: passkeys first (if conditional UI), then by last-used recency, then alphabetically
  return sortByPasskeyPriorityThenRecency(candidates)
```

### Hybrid Post-Quantum Key Exchange (for Sharing and Key Transport)

```
function hybridKeyExchange(recipientClassicalPK, recipientPQPK):
  // Step 1: Classical X25519 ECDH
  ephemeralX25519 = X25519.generateKeyPair()
  classicalSecret = X25519.DH(ephemeralX25519.private, recipientClassicalPK)  // 32 bytes

  // Step 2: Post-quantum ML-KEM-768 encapsulation
  (pqSecret, pqCiphertext) = ML_KEM_768.encapsulate(recipientPQPK)  // 32-byte secret, 1088-byte ct

  // Step 3: Combine shared secrets via HKDF
  combinedInput = classicalSecret || pqSecret  // 64 bytes
  combinedKey = HKDF-Expand(
    prk  = HKDF-Extract(salt = "hybrid-kex-v1", ikm = combinedInput),
    info = "password-manager-share",
    len  = 32  // 256-bit combined key
  )

  return {
    sharedKey:          combinedKey,
    ephemeralPublicKey: ephemeralX25519.public,  // 32 bytes — sent to recipient
    pqCiphertext:       pqCiphertext             // 1,088 bytes — sent to recipient
  }

function hybridKeyDecapsulate(ephemeralPK, pqCiphertext, recipientX25519Private, recipientPQPrivate):
  // Reverse of hybridKeyExchange
  classicalSecret = X25519.DH(recipientX25519Private, ephemeralPK)
  pqSecret = ML_KEM_768.decapsulate(recipientPQPrivate, pqCiphertext)

  combinedInput = classicalSecret || pqSecret
  combinedKey = HKDF-Expand(
    prk  = HKDF-Extract(salt = "hybrid-kex-v1", ikm = combinedInput),
    info = "password-manager-share",
    len  = 32
  )

  return combinedKey
```

**Why hybrid?** If ML-KEM is broken (new mathematical attack), X25519 still protects. If X25519 falls to quantum computers, ML-KEM protects. Neither failure mode alone compromises the combined key.

### Passkey Assertion Signing (WebAuthn Authenticator)

```
function performPasskeyAssertion(rpId, challenge, allowedCredentials, vault):
  // Step 1: Find matching passkey in encrypted vault
  matchingPasskeys = []
  for item in vault.passkeyItems():
    pk = item.passkey_credential
    if pk.rp_id == rpId:
      if allowedCredentials is empty:
        // Discoverable credential — no allowList filter
        matchingPasskeys.append(pk)
      elif pk.credential_id in allowedCredentials:
        matchingPasskeys.append(pk)

  if matchingPasskeys is empty:
    return null  // no matching passkey found

  // Step 2: User selects passkey (if multiple matches)
  selectedPasskey = promptUserSelection(matchingPasskeys)

  // Step 3: Increment sign counter
  selectedPasskey.sign_count += 1

  // Step 4: Construct authenticator data
  rpIdHash = SHA256(rpId)
  flags = buildFlags(
    userPresent = true,
    userVerified = true,  // biometric or master password confirms identity
    backupEligible = selectedPasskey.backup_eligible,
    backupState = selectedPasskey.backup_state
  )
  authenticatorData = rpIdHash || flags || BigEndian32(selectedPasskey.sign_count)

  // Step 5: Sign the challenge
  clientDataHash = SHA256(clientDataJSON(challenge, rpId))
  signatureInput = authenticatorData || clientDataHash

  switch selectedPasskey.key_algorithm:
    case ES256:
      signature = ECDSA_P256.sign(selectedPasskey.private_key, signatureInput)
    case EdDSA:
      signature = Ed25519.sign(selectedPasskey.private_key, signatureInput)

  // Step 6: Update sign counter in vault and sync
  updateVaultItem(selectedPasskey)

  return {
    credentialId:      selectedPasskey.credential_id,
    authenticatorData: authenticatorData,
    signature:         signature,
    userHandle:        selectedPasskey.user_handle
  }
```

### Session Management (Manifest V3 Service Worker)

```
function initializeSession(masterPassword, secretKey):
  // Called on extension startup or service worker activation
  (authKey, accountKey) = deriveAccountKey(masterPassword, secretKey, defaultParams)

  // Authenticate via OPAQUE
  sessionToken = performOPAQUELogin(authKey)

  // Store session key in extension session storage (not localStorage — not JS-accessible)
  extensionSessionStorage.set("session_key", {
    token:      sessionToken,
    accountKey: accountKey,        // held in memory during session
    expiresAt:  now() + 15_MINUTES
  })

  return sessionToken

function onServiceWorkerActivation():
  // Manifest V3: service workers restart frequently
  // Session key must be re-derived or retrieved from secure storage
  sessionData = extensionSessionStorage.get("session_key")

  if sessionData is null or sessionData.expiresAt < now():
    // Session expired — user must re-enter master password
    promptUnlock()
    return

  // Session still valid — restore vault from local encrypted cache
  encryptedCache = localVaultCache.get()
  if encryptedCache is not null:
    vaultKey = unwrapVaultKey(sessionData.accountKey)
    decryptedVault = decryptVaultFromCache(encryptedCache, vaultKey)
    populateAutofillIndex(decryptedVault)

function onSessionExpiry():
  // Clear all sensitive material from memory
  extensionSessionStorage.clear()
  wipeMemory(accountKey)
  wipeMemory(vaultKey)
  clearAutofillIndex()
  // Vault ciphertext remains in local cache for next unlock
  // No plaintext persists anywhere

function validateAutofillTrigger(event):
  // Defend against AI agent programmatic autofill
  if not event.isTrusted:
    logSecurityEvent("untrusted_autofill_trigger", event)
    return false  // block programmatic triggers

  if event.source != "user_interaction":
    logSecurityEvent("non_user_autofill_trigger", event)
    return false

  return true
```

### Dual-Key Derivation (Master Password + Secret Key)

```
function deriveAccountKeyDualKey(masterPassword, secretKey, email, params):
  // The dual-key model combines master password (memorized) with secret key (device-stored)
  // This prevents server-side brute-force: even with encrypted vault,
  // attacker needs both the password AND the 128-bit secret key

  // Step 1: Derive stretched key from master password (memory-hard)
  salt = SHA256(email.toLowerCase() || secretKey)  // secret key mixed into salt
  stretchedKey = Argon2id(
    password    = masterPassword,
    salt        = salt,
    memory      = 65536 KB,   // 64 MB
    iterations  = 3,
    parallelism = 4,
    outputLen   = 64           // 512 bits
  )

  // Step 2: Mix in secret key via HKDF
  // This ensures the output depends on BOTH inputs
  combinedKey = HKDF-Expand(
    prk  = HKDF-Extract(salt = "dual-key-v1", ikm = stretchedKey || secretKey),
    info = "account-key-derivation",
    len  = 64  // 512 bits
  )

  // Step 3: Split into auth key and account key
  authKey    = combinedKey[0:32]    // used in OPAQUE
  accountKey = combinedKey[32:64]   // used for key encryption

  return (authKey, accountKey)

function generateSecretKey():
  // Generated once at account creation; stored on device, printed in recovery kit
  // 128 bits of entropy — equivalent to a 39-character alphanumeric string
  rawKey = SecureRandom(16)  // 128 bits

  // Format as human-readable groups: A3-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX
  // First group is a version/checksum prefix
  formatted = formatAsGroups(rawKey, groupSize = 5, separator = "-", prefix = "A3")

  return { raw: rawKey, formatted: formatted }
```

### Vault-Wide Breach Audit

```
function auditAllCredentials(vault):
  // Batch breach check for all passwords in vault
  results = []
  batchPrefixes = {}

  // Step 1: Collect all unique SHA-1 prefixes
  for item in vault.loginItems():
    if item.password is null: continue
    sha1Hash = SHA1(item.password).hex().toUpperCase()
    prefix = sha1Hash[0:5]
    suffix = sha1Hash[5:]

    if prefix not in batchPrefixes:
      batchPrefixes[prefix] = []
    batchPrefixes[prefix].append({ item: item, suffix: suffix })

  // Step 2: Batch query (up to 100 prefixes per request)
  for batch in chunked(batchPrefixes.keys(), 100):
    serverResults = BreachAPI.checkBatch(batch)

    for prefix in batch:
      suffixList = serverResults[prefix]
      for entry in batchPrefixes[prefix]:
        for serverEntry in suffixList:
          if serverEntry.suffix == entry.suffix:
            results.append({
              item:  entry.item,
              count: serverEntry.count,
              severity: categorizeSeverity(serverEntry.count)
            })

  // Step 3: Also check for password reuse across vault items
  passwordHashes = {}
  for item in vault.loginItems():
    if item.password is null: continue
    hash = SHA256(item.password)
    if hash in passwordHashes:
      results.append({
        item: item,
        reused_with: passwordHashes[hash],
        severity: "high"
      })
    else:
      passwordHashes[hash] = item

  return sortBySeverityDesc(results)

function categorizeSeverity(breachCount):
  if breachCount > 100000: return "critical"
  if breachCount > 10000:  return "high"
  if breachCount > 100:    return "medium"
  return "low"
```
