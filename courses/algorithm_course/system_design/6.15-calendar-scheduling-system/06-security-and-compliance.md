# Security & Compliance

## Calendar ACL Model

### Permission Hierarchy

| Role | View Free-Busy | View Event Details | Create Events | Edit Events | Manage Sharing |
|------|---------------|-------------------|---------------|-------------|----------------|
| **freeBusyReader** | Yes | No | No | No | No |
| **reader** | Yes | Yes (respecting visibility) | No | No | No |
| **writer** | Yes | Yes | Yes | Yes (own events) | No |
| **owner** | Yes | Yes | Yes | Yes (all events) | Yes |

### Visibility Levels per Event

| Visibility | freeBusyReader sees | reader sees | writer sees | owner sees |
|-----------|--------------------|-----------|-----------|-----------|
| **public** | "Busy" | Full details | Full details | Full details |
| **default** | "Busy" | Full details | Full details | Full details |
| **private** | "Busy" | "Private event" (no details) | "Private event" | Full details |
| **confidential** | "Busy" | Title only | Title only | Full details |

### Permission Evaluation

```
Step-by-step plan in plain English: Calendar Permission Check

FUNCTION check_calendar_access(user_id, calendar_id, required_role):
    // Step 1: Check if user is the calendar owner
    calendar = get_calendar(calendar_id)
    IF calendar.owner_id == user_id:
        RETURN GRANTED (owner)

    // Step 2: Check explicit ACL entries
    acl_entry = SELECT role FROM calendar_acl
                WHERE calendar_id = calendar_id
                  AND grantee_id = user_id
                  AND grantee_type = 'user'

    IF acl_entry AND role_satisfies(acl_entry.role, required_role):
        RETURN GRANTED

    // Step 3: Check group-based ACL
    user_groups = get_user_groups(user_id)
    group_acl = SELECT MAX(role) FROM calendar_acl
                WHERE calendar_id = calendar_id
                  AND grantee_id IN (user_groups)
                  AND grantee_type = 'group'

    IF group_acl AND role_satisfies(group_acl, required_role):
        RETURN GRANTED

    // Step 4: Check domain-level sharing (organizational default)
    user_domain = get_user_domain(user_id)
    domain_acl = SELECT role FROM calendar_acl
                 WHERE calendar_id = calendar_id
                   AND grantee_type = 'domain'
                   AND grantee_id = user_domain

    IF domain_acl AND role_satisfies(domain_acl, required_role):
        RETURN GRANTED

    // Step 5: Check public sharing
    IF calendar.is_public AND required_role == 'freeBusyReader':
        RETURN GRANTED

    RETURN DENIED
```

### Organizational Defaults

| Sharing Scope | Default Permission | Override |
|--------------|-------------------|----------|
| Same organization | freeBusyReader (can see busy/free) | Admin can change to reader or none |
| External users | None | Calendar owner can share explicitly |
| Public (unauthenticated) | None | Calendar owner can enable public iCal feed |
| Resource calendars | freeBusyReader for org members | Resource admin can restrict |

---

## Authentication & Authorization

### OAuth 2.0 Scopes

| Scope | Access Level |
|-------|-------------|
| `calendar.readonly` | Read events and calendar metadata |
| `calendar.events` | Read and write events |
| `calendar.settings` | Read and modify calendar settings |
| `calendar.acl` | Manage calendar sharing |
| `calendar.freebusy` | Query free-busy information |
| `calendar.booking` | Manage booking links and reservations |
| `calendar.resources` | Manage resource calendars |

### Token Strategy

| Token Type | Lifetime | Storage | Usage |
|-----------|----------|---------|-------|
| **Access token** | 1 hour | In-memory (client) | API authentication |
| **Refresh token** | 90 days | Encrypted in DB | Access token renewal |
| **CalDAV session token** | 24 hours | Server-side session store | CalDAV client authentication |
| **Booking page token** | None (public) | N/A | Anonymous slot viewing |
| **Booking confirmation token** | 1 hour | Signed JWT | Guest booking verification |

### API Key Authentication (Integrations)

```
Integration authentication flow:
  1. Admin creates API key in organization settings
  2. API key is scoped to specific calendars + permission levels
  3. API key has rate limits independent of user rate limits
  4. API key can be rotated without affecting other integrations
  5. All API key usage is logged in audit trail
```

---

## Data Encryption

### Encryption at Rest

| Data Category | Encryption | Key Management |
|--------------|------------|----------------|
| Event data (title, description, location) | AES-256 at storage layer | Per-tenant encryption keys |
| Attendee emails | AES-256 field-level encryption | Separate key from event data |
| Booking link configuration | AES-256 at storage layer | Per-tenant keys |
| Free-busy bitmaps (cache) | Not encrypted (ephemeral, no PII) | N/A |
| Audit logs | AES-256 at storage layer | Dedicated audit key (admin cannot access) |
| Backups | AES-256 with separate backup key | Backup keys stored in key management service |

### Encryption in Transit

| Channel | Protocol | Certificate |
|---------|----------|-------------|
| Client ↔ API Gateway | TLS 1.3 (minimum TLS 1.2) | Public CA certificate |
| Service ↔ Service | mTLS | Internal CA |
| Service ↔ Database | TLS 1.2+ | Internal CA |
| CalDAV sync | TLS 1.2+ | Public CA certificate |
| Notification delivery (push) | TLS 1.3 to provider API | Provider's CA |
| Notification delivery (email) | STARTTLS | Public CA |

---

## Privacy & Data Protection

### Free-Busy Privacy

A key privacy requirement: users querying free-busy should only see whether time slots are busy or free---never the event details:

```
Step-by-step plan in plain English: Free-Busy Privacy Filter

FUNCTION get_free_busy_for_viewer(target_user_id, viewer_user_id, time_range):
    // Check if viewer has at least freeBusyReader access
    access_level = check_calendar_access(viewer_user_id, target_user_id)

    IF access_level < FREEBUSY_READER:
        RAISE PermissionDenied

    // Return only busy intervals, never event details
    busy_intervals = []
    events = get_events_in_range(target_user_id, time_range)

    FOR event IN events:
        IF event.transparency == "opaque":
            busy_intervals.append({
                start: event.start_time,
                end: event.end_time
                // NO title, description, attendees, or location
            })

    // Merge overlapping intervals to prevent information leakage
    // (knowing exact event boundaries reveals meeting structure)
    merged = merge_overlapping_intervals(busy_intervals)

    RETURN merged
```

**Why merge intervals**: If a user has two back-to-back meetings (9:00-10:00 and 10:00-11:00), returning two separate busy intervals reveals that there are two meetings. Merging them into a single 9:00-11:00 busy block prevents this information leakage.

### Attendee Email Protection

- External attendee emails are stored encrypted and only decrypted for invitation delivery and organizer display
- Email addresses are not included in CalDAV sync responses to non-organizer attendees
- Booking page guest emails are visible only to the host, not to other guests

### Data Minimization

| Feature | Data Collected | Retention | Deletion |
|---------|---------------|-----------|----------|
| Event creation | Title, time, attendees, location | Until user deletes | Soft delete → 30-day trash → hard delete |
| RSVP tracking | Response status, timestamp | Until event is deleted | Cascaded with event |
| Booking page | Guest name, email, answers | Until host deletes | Configurable auto-delete after N days |
| Notification delivery | Delivery status, timestamp | 90 days | Auto-purge |
| Free-busy cache | Busy/free bitmap (no event details) | 10-minute TTL | Auto-expire |

---

## Compliance

### GDPR

| Requirement | Implementation |
|------------|----------------|
| **Right to access** | Export all calendar data as iCal file; export booking history |
| **Right to deletion** | Delete all events, calendars, booking links, and audit records on request |
| **Data portability** | iCal (RFC 5545) export of all events; CSV export of booking history |
| **Consent** | Booking page guests consent to data processing at booking time |
| **Data Processing Agreement** | Organizational calendars covered by organizational DPA |
| **Cross-border transfer** | Data residency options; EU data stays in EU region |

### HIPAA (Healthcare Scheduling)

| Requirement | Implementation |
|------------|----------------|
| **PHI in events** | Healthcare appointment titles/descriptions may contain PHI; field-level encryption |
| **Access logging** | All event access (read, write, share) logged to audit trail |
| **Minimum necessary** | Free-busy queries never expose event content |
| **Business Associate Agreement** | Required for healthcare organization tenants |

### SOC 2

| Control | Implementation |
|---------|----------------|
| **Access control** | OAuth 2.0 + RBAC; MFA for admin operations |
| **Audit logging** | Immutable audit log of all calendar mutations, ACL changes, and admin actions |
| **Encryption** | AES-256 at rest, TLS 1.2+ in transit |
| **Change management** | All infrastructure changes via CI/CD with approval gates |

---

## Threat Model

### Top Attack Vectors

| Threat | Description | Mitigation |
|--------|-------------|------------|
| **Calendar enumeration** | Attacker queries free-busy for all org users to map meeting patterns | Rate limiting on free-busy API; require authentication; monitor for enumeration patterns |
| **Booking page abuse** | Automated bots flood booking pages with fake reservations | CAPTCHA on booking confirmation; rate limit by IP; require email verification |
| **ICAL injection** | Malicious iCal feed contains crafted VEVENT with XSS in description | Sanitize all imported iCal data; strip HTML/script tags; CSP headers on calendar UI |
| **ACL escalation** | User exploits sharing API to gain elevated access to other calendars | Server-side ACL enforcement; validate grantee_id is not self-referential; audit ACL changes |
| **Notification spoofing** | Fake calendar invitations that appear legitimate | DKIM/SPF/DMARC on outgoing invitation emails; clear sender identification; report abuse flow |

### Rate Limiting for Security

| Endpoint | Limit | Purpose |
|----------|-------|---------|
| Free-busy query (per user) | 200/min | Prevent calendar enumeration |
| Booking reservation (per IP) | 5/min | Prevent slot hoarding |
| Booking reservation (per email) | 3/hour per booking link | Prevent duplicate bookings |
| Calendar share (per user) | 20/hour | Prevent ACL abuse |
| iCal import (per user) | 5/hour | Prevent injection at scale |

---

## Booking Page Security

### Anti-Bot Protection for Public Booking Pages

Public booking pages are exposed to the internet without authentication, making them targets for automated abuse:

```
Step-by-step plan in plain English: Booking Anti-Abuse Pipeline

FUNCTION validate_booking_request(request, booking_link):
    // Layer 1: Rate limiting by IP
    IF rate_exceeded(request.ip, limit=5/min):
        RETURN 429 "Rate limited"

    // Layer 2: Proof-of-work challenge
    IF NOT verify_pow_token(request.pow_token, difficulty=18):
        RETURN 403 "Invalid challenge response"

    // Layer 3: Email validation
    IF is_disposable_email(request.guest_email):
        RETURN 400 "Please use a permanent email address"
    IF is_known_spam_email(request.guest_email):
        RETURN 400 "Email blocked"

    // Layer 4: Behavioral scoring
    interaction_score = evaluate_interaction(
        request.session_signals,  // mouse movement, time on page, scroll
        min_interaction_time = 3s  // must spend at least 3s on page
    )
    IF interaction_score < THRESHOLD:
        RETURN 403 "Suspicious interaction detected"

    // Layer 5: Duplicate booking prevention
    IF has_recent_booking(booking_link.id, request.guest_email, window=24h):
        RETURN 409 "You already have a booking with this host"

    RETURN proceed_with_booking()
```

### Booking Cancellation Security

| Threat | Mitigation |
|--------|------------|
| Unauthorized cancellation | Cancellation link contains signed JWT (HMAC-SHA256) with booking_id + guest_email |
| Cancellation link forwarding | JWT is single-use; once clicked, requires email confirmation |
| Mass cancellation attack | Rate limit cancellations per host per hour; alert host on unusual cancellation rate |
| Rescheduling abuse | Max 3 reschedules per booking; each generates new confirmation |

---

## Privacy-Preserving Availability Sharing

### Minimal Disclosure Scheduling

When scheduling across organizational boundaries, the system shares the minimum information necessary:

```
Step-by-step plan in plain English: Cross-Organization Availability Exchange

FUNCTION share_availability_external(requester_org, target_user, time_range):
    // Step 1: Verify federation agreement exists
    IF NOT has_federation_agreement(requester_org, target_user.org):
        RETURN PermissionDenied("No scheduling federation configured")

    // Step 2: Compute availability — return only free/busy status
    bitmap = get_free_busy_bitmap(target_user.id, time_range)

    // Step 3: Apply privacy rules
    //   - Merge all busy intervals to prevent meeting-count inference
    //   - Quantize to 30-min slots (reduce precision)
    //   - Apply jitter: randomly extend some busy blocks by ±15 min
    //     to prevent exact schedule reconstruction
    privacy_bitmap = apply_privacy_filters(bitmap,
        merge_adjacent = true,
        slot_size = 30,      // Coarser than internal 15-min
        jitter_minutes = 15
    )

    // Step 4: Return opaque availability
    RETURN ExternalAvailability(
        user_hint = target_user.display_name,  // No email
        availability = privacy_bitmap,
        timezone = target_user.timezone,
        expires_at = now() + 1 HOUR  // Short-lived to limit exposure
    )
```

### GDPR Data Subject Rights

| Right | Calendar-Specific Implementation |
|-------|----------------------------------|
| **Right to Access** | Export all calendars + events as iCalendar (.ics); export booking history as CSV; include all metadata (RSVP history, sharing settings) |
| **Right to Erasure** | Delete all events, calendars, booking links, reminders; anonymize audit log entries (replace user_id with hash); remove from all attendee lists; propagate cancellation to attendees |
| **Right to Portability** | iCalendar (RFC 5545) is the standard portable format; JMAP Calendar (RFC 8984) export for modern clients; JSON export of booking configuration and history |
| **Right to Rectification** | Update personal details across all organizer fields; re-send invitations with corrected information |
| **Data Retention** | Soft-deleted events: 30-day trash period, then hard delete; cancelled bookings: configurable auto-purge (7-90 days); audit logs: minimum retention per compliance requirement |

### Data Processing Records

```
Processing activities register (GDPR Article 30):

| Activity | Legal Basis | Data Categories | Retention |
|----------|------------|-----------------|-----------|
| Event storage | Contract (service provision) | Name, email, event details | Until user deletion |
| Reminder delivery | Contract | User ID, event time, notification channel | 90 days after delivery |
| Free-busy sharing | Legitimate interest (scheduling) | Busy/free bitmap (no PII) | 10-minute TTL |
| Booking page data | Consent (guest provides info) | Guest name, email, form answers | Configurable by host |
| Analytics | Legitimate interest | Aggregated, anonymized metrics | 2 years |
| Audit logging | Legal obligation (compliance) | User ID, action, timestamp | 7 years |
```
