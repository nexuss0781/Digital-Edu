# Security & Compliance — P2P File Sharing Network

## Authentication and Identity

### Info-Hash Verification

The info-hash is the cryptographic anchor of trust in the P2P network. It uniquely identifies a torrent's content and serves as the primary authentication mechanism:

| Aspect | Details |
|---|---|
| **Computation** | SHA-256 of the bencoded info dictionary (v2); SHA-1 for v1 |
| **Purpose** | Verifies that two peers are sharing the same content |
| **Enforcement** | Validated during peer handshake; mismatched info-hash → connection rejected |
| **Immutability** | Any modification to file content changes the info-hash; tampering is detectable |
| **Distribution** | Included in .torrent files, magnet links, and DHT queries |

### Peer Identity

P2P networks use lightweight, pseudonymous identity:

| Component | Format | Purpose |
|---|---|---|
| **Peer ID** | 20 bytes (client prefix + random) | Identifies a client instance; used in handshake and tracker |
| **Node ID** | 20 bytes (random or IP-derived) | Identifies a DHT node; used for Kademlia routing |
| **IP:Port** | Network address | Physical endpoint for connections |

**No centralized identity authority exists.** Peer IDs are self-assigned and can change between sessions. This provides privacy but creates challenges for accountability (see Sybil attacks below).

---

## Data Security

### Piece-Level Hash Verification

Every piece of data is cryptographically verified before acceptance:

```
VERIFICATION PIPELINE:

1. Receive all blocks (16 KiB each) for a piece
2. Concatenate blocks in order
3. Compute SHA-256 hash of the assembled piece
4. Compare against expected hash from torrent metadata
5. IF match → accept piece, mark in bitfield, announce HAVE
   IF mismatch → discard piece, re-request from different peer, flag sender

// v2 Enhancement: Merkle tree enables block-level verification
// A single corrupted 16 KiB block can be identified and re-downloaded
// without discarding the entire piece (up to 4 MiB)
```

**Verification guarantees:**
- Corruption detection: 100% (SHA-256 collision probability: 2^-128)
- Tamper detection: 100% (any modification changes the hash)
- Granularity: 16 KiB in v2 (Merkle tree), piece-level in v1
- Overhead: ~0.2% of data bandwidth for hash metadata

### Encryption: Message Stream Encryption (MSE/PE)

BitTorrent supports optional encryption to prevent ISP traffic identification and throttling:

| Feature | Details |
|---|---|
| **Key Exchange** | Diffie-Hellman over the wire; SKEY = info-hash (shared secret) |
| **Cipher** | RC4 (after initial 1024-byte discard for security) |
| **Modes** | Plaintext, encrypt handshake only, full stream encryption |
| **Negotiation** | Peers advertise support in handshake reserved bits; negotiate strongest mutual |
| **Purpose** | Traffic obfuscation (prevent ISP detection), NOT end-to-end security |
| **Performance** | 2-5% CPU overhead for full stream encryption |

**Important**: MSE/PE provides **obfuscation, not security**. It prevents passive traffic classification by ISPs but does not provide authentication, forward secrecy, or protection against active man-in-the-middle attacks. The info-hash is the real authentication mechanism — if a peer can produce pieces that match the expected hashes, the data is authentic regardless of transport security.

---

## Threat Model

### Threat 1: Sybil Attack

**Description**: An attacker creates thousands of fake DHT nodes with strategically chosen IDs to control routing for specific info-hashes. By positioning Sybil nodes close (in XOR distance) to a target info-hash, the attacker can intercept `get_peers` queries and return manipulated peer lists.

**Impact**:
- Prevent legitimate peers from finding each other (denial of service)
- Return only attacker-controlled peers (content poisoning)
- Monitor who is accessing specific content (surveillance)

**Scale**: Research has identified ~300,000 Sybil nodes in the Mainline DHT at any given time.

**Mitigations**:

| Mitigation | Mechanism | Effectiveness |
|---|---|---|
| **IP-based rate limiting** | Limit DHT nodes per IP address to 1-3 | Prevents mass Sybil from single IP; ineffective against botnet |
| **Node ID binding to IP** | Require node_id to be derived from IP (BEP 42) | Prevents free ID selection; limits Sybil placement precision |
| **Prefer old nodes** | k-bucket eviction prefers long-lived nodes | Newly created Sybil nodes cannot easily displace established nodes |
| **Query verification** | Verify responses are consistent across multiple lookup paths | Detect if different paths return wildly different results |
| **Multi-source discovery** | Use tracker + DHT + PEX simultaneously | Even if DHT is compromised, tracker and PEX provide correct peers |

### Threat 2: Eclipse Attack

**Description**: An attacker isolates a target node by filling its routing table entirely with attacker-controlled nodes. The target node then routes ALL queries through the attacker, who can selectively drop, delay, or modify responses.

**Impact**:
- Target node effectively disconnected from the legitimate DHT
- All lookups routed through attacker (surveillance)
- Target cannot find legitimate peers for any torrent

**Mitigations**:

| Mitigation | Mechanism |
|---|---|
| **Diverse bucket sampling** | Ensure routing table nodes come from diverse IP ranges and ASNs |
| **Routing table persistence** | Keep long-lived nodes across restarts; harder to replace entire table |
| **Parallel lookups via multiple interfaces** | Query through different network paths when possible |
| **Detect anomalous routing** | Alert if routing table composition changes dramatically in short period |
| **Bootstrap from hardcoded trusted nodes** | Periodically validate routing table against known-good nodes |

### Threat 3: DHT Poisoning

**Description**: Attacker nodes respond to `get_peers` queries with fake peer addresses — either non-existent peers (causing connection timeouts) or attacker-controlled peers that serve garbage data.

**Impact**:
- Wasted connection attempts to non-existent peers
- Slower peer discovery (must filter out fake peers)
- Potential content poisoning if attacker peers serve data that passes hash verification (only possible if attacker knows the content)

**Mitigations**:
- Peer addresses are verified upon connection (handshake with info-hash)
- Non-responsive peer addresses are quickly discarded (connection timeout)
- Token-based announce prevents arbitrary peer injection (`announce_peer` requires a valid token from a prior `get_peers` response)
- Piece-level hash verification catches any corrupted data

### Threat 4: Content Poisoning

**Description**: A peer in the swarm intentionally sends corrupted piece data that fails hash verification, wasting the downloader's bandwidth and time.

**Impact**:
- Wasted bandwidth downloading invalid pieces
- Slowed downloads as corrupted pieces must be re-fetched
- In extreme cases, repeated poisoning can make a torrent nearly undownloadable

**Mitigations**:

| Mitigation | Mechanism | Details |
|---|---|---|
| **Hash verification** | SHA-256 per piece | Every piece validated; corrupted data always detected |
| **Peer banning** | Track hash failures per peer | After N hash failures from same peer, ban for 1+ hours |
| **Block-level verification (v2)** | Merkle tree proof per 16 KiB block | Identify exact corrupted block; re-download only 16 KiB instead of entire piece |
| **Peer reputation** | Weight peer selection by history | Prefer peers with zero hash failures; avoid peers with history of bad data |

### Threat 5: Man-in-the-Middle (MITM)

**Description**: An ISP or network operator intercepts BitTorrent connections and modifies piece data in transit, injects reset packets to kill connections, or redirects connections to attacker-controlled peers.

**Impact**:
- Connection disruption (injected RST packets)
- Modified piece data (detected by hash verification)
- Traffic analysis (knowing what content a user is accessing)

**Mitigations**:
- Piece hash verification catches any data modification
- MSE/PE encryption prevents passive traffic identification
- uTP over UDP is harder to intercept than TCP
- DHT queries over UDP are lightweight and can be retried through alternative paths

### Threat 6: Free-Riding

**Description**: A peer downloads content while contributing zero or minimal upload bandwidth. They modify their client to always choke (never upload) or claim artificially low bandwidth.

**Impact**:
- Unfair load distribution — cooperative peers subsidize free-riders
- At scale, too many free-riders degrade swarm health
- Tragedy of the commons — if free-riding is rational, everyone does it

**Mitigations**:

| Mitigation | Mechanism | Effectiveness |
|---|---|---|
| **Tit-for-tat** | Choke peers who don't reciprocate | Free-riders get only optimistic unchoke bandwidth (~20% of max) |
| **Private trackers with ratio** | Require upload/download ratio ≥ 1.0 | Eliminates free-riding entirely (requires identity) |
| **Optimistic unchoke limit** | Only 1 optimistic slot per 30 seconds | Limits the bandwidth available to non-contributing peers |
| **Anti-leech clients** | Detect and penalize known free-rider client signatures | Cat-and-mouse game; partially effective |

### Threat 7: Traffic Analysis and Surveillance

**Description**: Third parties (ISPs, government agencies, copyright holders) monitor P2P traffic to identify what content users are accessing. Techniques range from passive traffic classification (deep packet inspection) to active participation in swarms to collect peer IP addresses.

**Impact**:
- User privacy compromised — content access habits exposed
- Legal threats from copyright holders who join swarms and log IPs
- ISP throttling of detected P2P traffic

**Mitigations**:

| Mitigation | Mechanism | Privacy Level |
|---|---|---|
| **MSE/PE encryption** | Obfuscates BitTorrent protocol headers from DPI | Low — known patterns still detectable |
| **VPN tunnel** | Routes all traffic through encrypted tunnel to VPN exit node | Medium — VPN provider can still see traffic |
| **I2P integration** | Routes BitTorrent over anonymous overlay network | High — multi-hop encryption, hidden endpoints |
| **Tor integration** | Routes tracker/DHT traffic through Tor (NOT data transfer) | Medium — protects discovery but not swarm participation |
| **Protocol obfuscation** | Randomize packet sizes and timing to defeat statistical traffic analysis | Medium — defeats signature-based DPI |

### Threat 8: Index Poisoning

**Description**: Attackers flood torrent index sites or DHT with fake torrents that have valid-looking metadata but contain malicious, misleading, or empty content.

**Impact**:
- Users download incorrect or malicious content
- Erosion of trust in content discovery
- Resource waste (bandwidth, storage)

**Mitigations**:
- Info-hash verification confirms the EXACT content the user intended to download
- Community reputation systems on index sites (verified uploaders, comment systems)
- Content size verification (metadata declares file sizes; mismatches detectable before full download)
- Multi-source validation (check info-hash against multiple trusted sources)

---

## Advanced Security: Node ID Hardening (BEP 42)

BEP 42 addresses Sybil attacks by binding DHT node IDs to IP addresses:

```
FUNCTION generate_bep42_node_id(ip_address):
    // Node ID must be derived from IP, preventing free ID selection
    // This limits an attacker's ability to position Sybil nodes near target info-hashes

    rand = random_byte()
    // CRC32C of IP with random byte mixed in
    crc = crc32c(ip_address[0] & 0x03, ip_address[1] & 0x0f,
                  ip_address[2] & 0x3f, ip_address[3] & 0xff)

    // First 3 bytes of node ID derived from CRC (IP-dependent)
    node_id[0] = (crc >> 24) & 0xff
    node_id[1] = (crc >> 16) & 0xff
    node_id[2] = ((crc >> 8) & 0xf8) | (rand & 0x07)

    // Remaining bytes are random (uniqueness within IP)
    node_id[3..18] = random_bytes()
    node_id[19] = rand

    RETURN node_id

// Enforcement: nodes receiving messages verify sender's node ID
// against sender's IP using the same formula
// Non-compliant nodes are deprioritized in routing tables
```

**Effectiveness**: Reduces Sybil attack effectiveness by ~95% — an attacker controlling a single IP can only generate IDs in a narrow range of the 160-bit ID space, limiting their ability to target specific info-hashes.

---

## Security Properties Summary

| Property | Mechanism | Guarantee Level |
|---|---|---|
| **Data integrity** | SHA-256 piece/block hashing | Cryptographic (2^-128 collision probability) |
| **Content authenticity** | Info-hash verifies torrent identity | Cryptographic |
| **Availability** | Decentralized replication across swarm | Probabilistic (proportional to seed count) |
| **Confidentiality** | MSE/PE + VPN | Optional; not built into base protocol |
| **Anonymity** | Not provided by base protocol | Requires overlay (I2P, Tor) |
| **Accountability** | Not provided (pseudonymous IDs) | By design — privacy trade-off |
| **Sybil resistance** | BEP 42 IP binding + k-bucket eviction | Moderate (not perfect) |
| **DoS resistance** | Decentralized; no single target | High (inherent to P2P architecture) |

---

## Compliance

### Copyright and DMCA

P2P file sharing technology is protocol-agnostic regarding content legality. The protocol itself has numerous legitimate uses (distributing open-source software, sharing public domain content, Linux distribution ISOs, game updates, etc.). However, the same protocol can be used for copyright infringement.

| Aspect | Consideration |
|---|---|
| **Protocol neutrality** | The BitTorrent protocol does not distinguish legal from illegal content |
| **Safe harbor** | Tracker operators may qualify for safe harbor provisions if they respond to takedown notices |
| **Content identification** | Info-hashes can be used to identify specific content; copyright holders monitor DHT for known info-hashes |
| **Notice and takedown** | Trackers that receive valid DMCA notices should remove the torrent from their index |
| **Peer identification** | Copyright holders can join swarms and log peer IP addresses; this is a known privacy concern |
| **Jurisdiction** | Tracker, seeder, and leecher may all be in different legal jurisdictions |

### Privacy Considerations

| Component | Privacy Impact | Mitigation |
|---|---|---|
| **Tracker** | Logs IP addresses, info-hashes, and timestamps | No-log tracker policies; encrypted tracker connections (HTTPS) |
| **DHT** | Queries are visible to intermediate nodes; announce reveals IP + content | DHT queries don't reveal the querier's interest (could be routing) |
| **Swarm** | All peers' IP addresses visible to other peers in the same swarm | VPN usage; I2P/Tor integration (limited) |
| **ISP** | Can detect BitTorrent traffic patterns | MSE/PE encryption; VPN; protocol obfuscation |

### Data Protection Implications

| Regulation | Relevant Aspect | Consideration |
|---|---|---|
| **GDPR** | IP addresses are personal data | Tracker operators must handle IP data per GDPR requirements |
| **Data retention** | Some jurisdictions require ISP traffic logging | Affects trackers hosted in those jurisdictions |
| **Right to erasure** | Users may request removal of their data from trackers | Announce data should expire naturally (30-min TTL) |

---

## Legitimate Use Cases for P2P Distribution

It is important to contextualize that P2P file sharing technology has extensive legitimate applications:

| Use Case | Examples | Why P2P Is Ideal |
|---|---|---|
| **Open-source software distribution** | Linux ISOs, game engines, development tools | Reduces server costs for non-profit projects; scales with popularity |
| **Scientific data sharing** | Genome databases, astronomical survey data, climate datasets | Petabyte-scale datasets cannot be served economically from single origin |
| **Game updates and patches** | Major game studios distribute multi-GB patches via P2P | Flash crowd of millions of players at launch managed by protocol |
| **Content delivery for creators** | Independent artists, filmmakers, podcasters distributing large media files | Zero infrastructure cost for creators; fans become distributors |
| **Archival and preservation** | Digital archive distribution, cultural heritage preservation | Distributed redundancy prevents single-point data loss |
| **Emergency communication** | Decentralized file sharing when centralized infrastructure is compromised | Functions without servers; resilient to infrastructure damage |

---

## Security Architecture Decision Matrix

| Design Decision | Security Impact | Performance Impact | Recommendation |
|---|---|---|---|
| **Enable BEP 42 (ID hardening)** | Reduces Sybil attacks by ~95% | Minimal (CRC32C computation) | Enable — essential for DHT security |
| **Require MSE/PE encryption** | Prevents ISP throttling | 2-5% CPU overhead | Opportunistic — encrypt when both peers support it |
| **Peer ban list persistence** | Prevents re-connection from known bad peers | Disk I/O for ban list | Enable — store ban list across sessions |
| **k-bucket IP diversity** | Prevents eclipse attacks from single ASN | Slightly slower routing table fill | Enable — require IP diversity in k-buckets |
| **Announce token validation** | Prevents announce spoofing | Negligible (token generation is fast) | Always enable — part of standard BEP 5 |
| **Multi-source piece verification** | Detect if specific peer consistently sends bad data | Slight request overhead | Enable for first piece from each new peer |

---

## Incident Response: Coordinated Attack on Specific Content

When an attacker attempts to disrupt distribution of specific content:

| Attack Phase | Attacker Action | System Response |
|---|---|---|
| **1. Sybil deployment** | Create thousands of nodes near target info-hash in DHT | BEP 42 limits effective placement; prefer-old-nodes policy resists displacement |
| **2. Peer poisoning** | Return fake peer addresses from Sybil DHT nodes | Clients verify peers via handshake with info-hash; fake peers rejected on connect |
| **3. Content poisoning** | Sybil swarm peers send corrupt piece data | SHA-256 hash verification rejects every corrupt piece; bad peers banned |
| **4. Resource exhaustion** | Flood target swarm with connection attempts | Connection rate limiting; drop connections that fail handshake; prioritize established peers |
| **5. Tracker disruption** | DDoS tracker serving this info-hash | DHT + PEX provide complete fallback; multi-tracker announce in torrent metadata |

**Key resilience insight**: The layered defense architecture means an attacker must compromise ALL discovery layers (tracker AND DHT AND PEX) AND break the cryptographic hash verification to actually prevent content distribution. Each layer independently provides a complete fallback path.

---

## Protocol Security Evolution: v1 vs v2

| Security Property | v1 (SHA-1) | v2 (SHA-256 Merkle) | Improvement |
|---|---|---|---|
| **Hash algorithm** | SHA-1 (theoretical collision attacks exist) | SHA-256 (no known practical attacks) | Long-term cryptographic security |
| **Verification granularity** | Piece-level only (256 KiB-4 MiB) | Block-level (16 KiB Merkle leaf) | 16-256× finer corruption detection; less re-download on failure |
| **Cross-torrent dedup** | Impossible (different info-hash per torrent) | Same file across torrents shares Merkle root | Reduces storage of duplicate content |
| **Info-hash space** | 20 bytes (160 bits) | 32 bytes (256 bits) | Larger address space; no collision risk |
| **Backward compatibility** | N/A | Hybrid v1+v2 torrents supported | Gradual ecosystem migration |
