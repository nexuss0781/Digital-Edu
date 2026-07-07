# Security & Compliance

## 1. Authentication & Authorization

### 1.1 Authentication Architecture

| Actor | Auth Method | Token Type | Session Duration |
|-------|-----------|-----------|-----------------|
| **Customer** | Email/password, social OAuth, phone OTP | JWT access token (15 min) + refresh token (30 days) | Device-bound; revokable per device |
| **Restaurant** | Email/password with 2FA (SMS/TOTP) | JWT access token (1h) + refresh token (90 days) | Tablet-bound; shared device login |
| **Driver** | Phone OTP + government ID verification at onboarding | JWT access token (8h, aligned with shift) + refresh token (30 days) | Device-bound with biometric re-auth |
| **Internal (service-to-service)** | mTLS + service identity tokens | Short-lived tokens (5 min, auto-rotated) | Per-request authentication |

### 1.2 Authorization Model

```
Role-Based Access Control (RBAC) with resource scoping:

Customer:
  - Can read/write own orders, addresses, payment methods
  - Can read restaurant menus (public)
  - Cannot access other customers' data, driver data, or restaurant admin data

Restaurant:
  - Can manage own menu, hours, and orders assigned to their restaurant
  - Cannot access other restaurants' data, customer PII, or driver data

Driver:
  - Can see assigned order details (pickup address, delivery address, customer first name)
  - Can update own location, order status for assigned orders
  - Cannot access customer phone/email directly (communication through masked relay)

Platform Admin:
  - Tiered access: L1 support (read orders), L2 (modify orders), L3 (access PII with audit log)
  - All admin actions logged with actor, timestamp, and justification
```

### 1.3 Phone Number Masking

When a driver needs to contact a customer (or vice versa), calls are routed through a **masked relay number**:

```
Customer real phone:   +1-555-123-4567
Masked relay number:   +1-555-900-XXXX (temporary, order-scoped)
Driver calls relay → system routes to customer's real phone
Relay number expires 30 minutes after delivery

Benefit: Neither party sees the other's real phone number
```

---

## 2. Driver Identity Verification

### 2.1 Onboarding Verification

| Check | Method | Frequency |
|-------|--------|-----------|
| **Government ID** | Document scan + selfie match (AI-powered liveness detection) | At onboarding |
| **Background check** | Criminal record, driving record, sex offender registry | At onboarding + annual renewal |
| **Vehicle verification** | Vehicle registration, insurance, photos | At onboarding + annual |
| **Right to work** | Work authorization document verification | At onboarding |

### 2.2 Ongoing Verification

| Check | Method | Trigger |
|-------|--------|---------|
| **Periodic selfie check** | In-app selfie matched against ID photo using facial recognition | Random (once per week on average) |
| **Device integrity** | Check for rooted/jailbroken device, GPS spoofing apps | Every app launch |
| **License status** | Automated check against DMV/licensing authority database | Quarterly |

---

## 3. Location Privacy

### 3.1 Data Minimization Principles

| Data | Who Can See | Retention | Purpose |
|------|------------|-----------|---------|
| **Driver real-time location** | Matched customer only (during active order) | Until delivery + 30 min | Order tracking |
| **Driver location history** | Internal only (support, ops) | 7 days full resolution; 90 days sampled | Dispute resolution |
| **Customer delivery address** | Assigned driver only (during active order) | Order record (3 years); driver view expires post-delivery | Delivery navigation |
| **Restaurant address** | Public (listed on platform) | Permanent | Discovery and navigation |
| **Customer home address** | Customer only; not exposed to restaurant or driver beyond current delivery | Stored encrypted; deletable by user | Pre-fill delivery address |

### 3.2 Location Data Protection

- **Encryption at rest**: All location data encrypted with AES-256 in the database and time-series store
- **Encryption in transit**: TLS 1.3 for all API and WebSocket connections
- **Geofencing**: Driver location updates are only accepted within the driver's registered operating city ± buffer zone
- **Access logging**: Every query of location history is logged with requester identity and reason
- **Right to deletion**: Customer can request deletion of all address data; driver can request deletion of location history (with regulatory retention exceptions)

---

## 4. Payment Security

### 4.1 PCI-DSS Compliance

| Requirement | Implementation |
|------------|---------------|
| **Cardholder data** | Never stored in platform systems; tokenized through payment processor |
| **Token vault** | Payment processor stores card details; platform stores only tokens and last-4 digits |
| **Authorization flow** | At order placement: `platform → payment processor → card network → issuing bank` |
| **Capture flow** | At delivery confirmation: `platform → payment processor → capture authorized amount` |
| **3D Secure 2** | Triggered for first-time cards, high-value orders (>$100), or risk-flagged transactions |
| **Network segmentation** | Payment service runs in isolated network segment; no direct access from other services |

### 4.2 Financial Reconciliation

```
Daily reconciliation process:
1. Export all order payments (authorized, captured, refunded) from platform DB
2. Export all transactions from payment processor
3. Compare: every captured order must have matching processor transaction
4. Flag discrepancies: authorized but not captured, captured but no order, amount mismatches
5. Automated resolution for common cases (delayed capture, partial refund)
6. Manual review queue for unresolved discrepancies
```

### 4.3 Tip Handling

- Tips are collected at order placement (pre-delivery) or within 2 hours after delivery
- 100% of tip goes to the driver; platform does not take a cut
- Tips are a separate payment transaction from the delivery fee
- Post-delivery tip modifications are allowed within 2 hours (increase or decrease)

---

## 5. Fraud Detection

### 5.1 Threat Model

| Threat | Actor | Detection Method | Response |
|--------|-------|-----------------|----------|
| **Fake delivery claim** | Driver marks delivered but didn't actually deliver | GPS validation: driver must be within 200m of delivery address at delivery time; photo proof of delivery | Suspend driver; refund customer; flag for review |
| **GPS spoofing** | Driver uses fake GPS app to inflate distance or fake location | Server-side trajectory validation: speed check (>150 kph = impossible), route plausibility, sudden location jumps (>5km in 1 second) | Block delivery; require in-person verification |
| **Stolen payment method** | Fraudster uses stolen credit card to order food | ML fraud scoring at order placement: new account + new card + high value + delivery to new address = high risk | Block order; require additional verification (3DS2, phone OTP) |
| **Promo abuse** | User creates multiple accounts to get first-order discount repeatedly | Device fingerprinting, delivery address clustering, phone number pattern matching | Block duplicate accounts; revoke promos; ban device |
| **Restaurant fraud** | Restaurant marks orders as accepted then never prepares them | Pattern detection: high reject rate after confirm, customer complaints, long time between confirm and ready | Reduce restaurant ranking; suspend after threshold |
| **Collusion** | Driver and customer collude to claim non-delivery for refund | Cross-reference: same driver + same customer in multiple refund claims; GPS shows delivery was completed | Flag for manual review; ban both parties if confirmed |
| **Account takeover** | Attacker gains access to customer/driver account | Anomaly detection: login from new device + new city; multiple address changes; large order from usually-small account | Require re-authentication; temporary account lock |

### 5.2 Real-Time Fraud Scoring

Every order is scored at placement:

```
FUNCTION computeFraudScore(order, customer):
    features = {
        account_age_days: customer.created_at.daysAgo(),
        order_count: customer.total_orders,
        is_new_payment_method: isNewCard(order.payment_method_id),
        is_new_delivery_address: isNewAddress(order.delivery_address),
        order_value_cents: order.total_cents,
        time_of_day: currentHour(),
        device_fingerprint_matches: checkDeviceFingerprint(order.device_id),
        velocity: ordersInLast24Hours(customer.id),
        address_cluster_score: checkAddressCluster(order.delivery_address)
    }
    score = fraudModel.predict(features)  // 0.0 = safe, 1.0 = fraudulent

    IF score > 0.8: BLOCK order, require additional verification
    IF score > 0.5: ALLOW but flag for post-delivery review
    IF score <= 0.5: ALLOW normally
```

---

## 6. Server-Side GPS Trajectory Validation

A critical anti-fraud mechanism that validates driver location data:

```
FUNCTION validateTrajectory(driver_id, new_location, timestamp):
    previous = getLastKnownLocation(driver_id)

    IF previous IS NULL:
        RETURN VALID  // first update of session

    timeDelta = timestamp - previous.timestamp
    distance = haversine(previous.lat, previous.lng, new_location.lat, new_location.lng)
    speed = distance / timeDelta  // km/s → convert to kph

    // Physical impossibility checks
    IF speed > MAX_VEHICLE_SPEED_KPH:  // e.g., 150 kph in urban area
        flagAnomaly(driver_id, "IMPOSSIBLE_SPEED", speed)
        RETURN INVALID

    // Teleportation check: large distance in short time
    IF distance > 5 km AND timeDelta < 10 seconds:
        flagAnomaly(driver_id, "TELEPORTATION", distance, timeDelta)
        RETURN INVALID

    // Jitter check: GPS noise should not exceed typical accuracy
    IF distance < 5 meters AND timeDelta < 3 seconds:
        RETURN DUPLICATE  // skip update, GPS noise

    RETURN VALID
```

---

## 7. Regulatory Compliance

### 7.1 GDPR (EU Markets)

| Requirement | Implementation |
|------------|---------------|
| **Right to access** | Customer can export all personal data (orders, addresses, ratings) in JSON format |
| **Right to deletion** | Delete PII within 30 days of request; anonymize order records (keep for financial reporting) |
| **Data portability** | Export in machine-readable format |
| **Consent management** | Explicit opt-in for location tracking (driver), marketing emails, push notifications |
| **Data Processing Agreement** | Contracts with all sub-processors (payment, mapping, notification providers) |
| **Breach notification** | Automated alerting if PII access anomaly detected; notify authority within 72 hours |

### 7.2 Local Regulations

| Regulation | Markets | Implementation |
|-----------|---------|---------------|
| **Gig worker classification** | US (California AB5), EU | Configurable worker model per market; different payment/tax handling |
| **Food safety** | All markets | Restaurant health inspection score displayed; food handling certifications for drivers in applicable markets |
| **Alcohol delivery** | US, EU, AU | Age verification at delivery (driver confirms ID); restricted hours per jurisdiction |
| **Tipping transparency** | US | Clear display that 100% of tip goes to driver |
| **Data localization** | India, China | All user data stored within country borders; separate infrastructure deployment |

---

## 8. API Security

### 8.1 Rate Limiting Strategy

| Endpoint Group | Rate Limit | Key | Rationale |
|---------------|-----------|-----|-----------|
| **Order placement** | 5 orders/min per customer | `customer_id` | Prevents automated order flooding |
| **Menu browsing** | 100 req/min per IP | `IP + user_agent` | Allows normal browsing; blocks scrapers |
| **Driver location updates** | 15/min per driver | `driver_id` | Expected: 12/min (every 5s); buffer for retries |
| **Offer accept/decline** | 10/min per driver | `driver_id` | Normal: 2-3/min; prevents automated acceptance bots |
| **Restaurant menu updates** | 60/min per restaurant | `restaurant_id` | Normal: <5/min; allows bulk updates but prevents abuse |
| **Search queries** | 60/min per user | `user_id` or `IP` | Prevents search scraping for competitive intelligence |

### 8.2 Input Validation

```
Critical validation points:
1. Order items: validate each item_id exists, is_available, and price matches current menu
2. Delivery address: validate geocoding succeeds and is within restaurant's delivery radius
3. GPS coordinates: validate lat ∈ [-90, 90] and lng ∈ [-180, 180]; reject NaN, Infinity
4. Payment tokens: validate against payment processor before creating order
5. Promo codes: validate against promotions service (not client-side)
6. Image uploads (delivery photos): validate file type (JPEG/PNG only), max size (5 MB), strip EXIF metadata
```

### 8.3 Delivery Photo Security

Delivery confirmation photos (proof of delivery):
- Stripped of EXIF metadata (GPS coordinates, device info) before storage
- Stored in object storage with signed URLs (time-limited access, 24 hours)
- Accessible only to: the customer (via order details), support agents (via support tool), and automated fraud review
- Auto-deleted after 90 days (configurable per market regulation)

---

## 9. Supply Chain Integrity

### 9.1 Restaurant Verification

| Verification | Method | Frequency |
|-------------|--------|-----------|
| **Business license** | Document upload + automated verification against government registry | At onboarding; annual renewal |
| **Food safety certification** | Health inspection score from local authority API or manual upload | At onboarding; when inspection occurs |
| **Kitchen photos** | Photo verification of food preparation area | At onboarding |
| **Menu accuracy audit** | Random order photo comparison against menu description | Monthly sample (5% of restaurants) |
| **Hygiene rating display** | Mandatory display of health score where regulations require | Continuous sync with health authority |

### 9.2 Secure Communication Channels

All actor-to-actor communication is mediated through the platform:

```
Customer ↔ Driver:
  Voice: Masked relay number (expires 30 min post-delivery)
  Chat: In-app chat through platform servers (stored for dispute resolution, 30 days)
  No direct contact info exchanged

Customer ↔ Restaurant:
  Voice: Masked relay number (expires 30 min post-delivery)
  Chat: In-app (limited to order-specific context)

Driver ↔ Restaurant:
  Communication not typically needed (order details visible in app)
  If needed: platform-mediated call through masked relay
```

---

## 10. Incident Response for Food Safety

| Severity | Trigger | Response | Timeline |
|----------|---------|----------|----------|
| **Critical** | Customer reports foodborne illness affecting multiple orders from same restaurant | Suspend restaurant immediately; notify health authority; contact all affected customers | Within 1 hour of pattern detection |
| **High** | Single foodborne illness report with medical documentation | Investigate restaurant; increase inspection frequency; offer customer compensation | Within 4 hours |
| **Medium** | Multiple complaints about food quality (wrong temperature, wrong items) | Flag restaurant for quality review; adjust restaurant ranking | Within 24 hours |
| **Low** | Single quality complaint without health impact | Log complaint; adjust restaurant rating; standard refund process | Standard support SLA |

**Automated detection**: If 3+ customers report illness/allergic reaction from the same restaurant within a 24-hour window, automatically:
1. Suspend the restaurant from receiving new orders
2. Alert the food safety team
3. Notify affected customers with health advisory
4. Preserve all order and communication records for investigation

---

## 11. Data Encryption Architecture

| Data Type | At Rest | In Transit | Key Management |
|-----------|---------|------------|---------------|
| **Customer PII** (name, email, phone) | AES-256 with envelope encryption | TLS 1.3 | Per-customer encryption key; master key in HSM |
| **Delivery addresses** | AES-256 (field-level encryption) | TLS 1.3 | Per-customer key; plaintext only at query time |
| **Payment tokens** | Stored at payment processor (not in platform DB) | TLS 1.3 + mutual auth | Payment processor manages |
| **Driver location (real-time)** | Not encrypted at rest (Redis, performance-critical) | TLS 1.3 (WebSocket) | Short-lived data (overwritten every 5s) |
| **Driver location (history)** | AES-256 in time-series DB | TLS 1.3 | Per-driver key; auto-deleted per retention policy |
| **Order data** | AES-256 (database-level encryption) | TLS 1.3 | Partition-level keys, rotated quarterly |
| **Delivery photos** | AES-256 in object storage (server-side encryption) | TLS 1.3 + signed URLs | Object-level keys |

---

## 12. Autonomous Delivery Security

As robot and drone delivery become integrated, new security considerations emerge:

| Threat | Mitigation |
|--------|-----------|
| **Robot tampering / theft** | Secure compartment with OTP-based lock (customer receives code via app); tamper detection sensors; real-time video monitoring |
| **Drone hijacking** | Encrypted command channel; geofenced flight paths; automatic return-to-base on communication loss |
| **Robot GPS spoofing** | Dual positioning: GPS + visual odometry; anomaly detection on trajectory vs. expected route |
| **Unauthorized order retrieval** | Two-factor delivery verification: OTP + proximity check (customer's phone must be within 10m of robot/drone) |
| **Physical obstruction** | Real-time obstacle detection; automatic rerouting; alert to operations center if stuck for >5 minutes |

---

## 13. Audit Trail Architecture

All security-relevant actions are recorded in an append-only audit log:

| Event | Logged Fields | Retention |
|-------|--------------|-----------|
| **Admin access to PII** | admin_id, data_type, customer_id, justification, timestamp | 7 years |
| **Driver identity verification** | driver_id, verification_type, result, timestamp | Duration of driver's active status + 3 years |
| **Fraud detection trigger** | order_id, fraud_score, features, action_taken, timestamp | 5 years |
| **Payment authorization/capture** | order_id, amount, token (masked), result, timestamp | 7 years (financial compliance) |
| **Data deletion request** | requester_id, data_types, completion_timestamp | Permanent (proof of compliance) |
| **Location data access** | accessor_id, driver_id, time_range_queried, purpose, timestamp | 3 years |

The audit log is write-once (append-only), stored in a separate database from operational data, and backed up to immutable object storage daily.
