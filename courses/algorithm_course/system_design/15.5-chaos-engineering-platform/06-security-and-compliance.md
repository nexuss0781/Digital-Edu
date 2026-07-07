# Security & Compliance — Chaos Engineering Platform

## The Security Paradox

A chaos engineering platform occupies a unique position in the security landscape: it is an **authorized tool for causing system failures.** The same capabilities that make it valuable for resilience testing — injecting network partitions, killing processes, corrupting state — make it a devastating attack vector if compromised. A hostile actor with access to the chaos platform can cause arbitrary production outages that look like "chaos experiments." Security is therefore not just a compliance concern — it is an existential design requirement.

---

## Authentication & Authorization

### Who Can Run Chaos Experiments?

The platform uses a tiered authorization model that gates access based on environment sensitivity and blast radius:

```
RBAC Model for Chaos Engineering Platform:

Roles:
  - platform-admin:
      Permissions: manage platform configuration, create/modify guardrails,
                   manage agent fleet, create/delete teams, override blast radius limits
      Cannot: approve their own experiments (separation of duties)

  - chaos-engineer:
      Permissions: create experiments for any environment, execute approved experiments,
                   create experiment templates, run GameDays
      Requires: approval from team-lead or platform-admin for production experiments

  - team-lead:
      Permissions: approve experiments for their team's services,
                   set team-level guardrails, view all team experiment results
      Cannot: approve experiments targeting services outside their team

  - developer:
      Permissions: create and execute experiments in development/staging
                   for their own services, view experiment results
      Cannot: target production, target other teams' services

  - viewer:
      Permissions: view experiment results, dashboards, and reports
      Cannot: create, modify, or execute any experiment

  - ci-cd-service-account:
      Permissions: execute pre-approved experiment templates in CI/CD pipelines
      Constraints: limited to approved templates, staging environment only
                   (unless promoted to production via approval)
```

### Environment-Based Access Control

| Environment | Who Can Run | Approval Required | Blast Radius Limit |
|------------|-------------|-------------------|-------------------|
| Development | Developer (own services) | None | 100% of dev instances |
| Staging | Developer, Chaos Engineer | None (pre-approved templates) | 50% of staging instances |
| Pre-production | Chaos Engineer | Team lead approval | 25% of instances |
| Production | Chaos Engineer | Team lead + platform admin | Organization-defined (typically 5-10%) |
| Production (GameDay) | Chaos Engineer | VP-level approval + GameDay checklist | Up to 25% (with enhanced monitoring) |

### Separation of Duties

Critical safety rule: **the person who creates an experiment cannot be the sole approver.** This prevents a single compromised account or malicious insider from injecting arbitrary faults into production.

```
Approval Workflow:
  1. Creator submits experiment
  2. System validates blast radius (automated)
  3. If production target:
     a. Team lead reviews and approves
     b. If blast radius > 10%: additional platform-admin approval
     c. If targeting shared infrastructure (databases, queues):
        additional approval from infrastructure team
  4. Experiment is marked "approved" only after all required approvals
  5. Creator (or scheduler) can then execute the approved experiment
  6. All approvals are recorded in the audit log with approver identity and timestamp
```

### Agent Authentication

- Agents authenticate to the control plane using **mutual TLS (mTLS)** with certificates issued by the organization's PKI or a Kubernetes cert-manager
- Certificate Common Name (CN) encodes the agent's host identity and deployment region
- Certificates rotate automatically every 24 hours with zero-downtime rollover
- The control plane maintains an allowlist of valid certificate fingerprints — revoked agents cannot reconnect
- Agent-to-agent communication is not permitted (agents only communicate with the control plane)

### API Authentication

- All API endpoints require authentication via OIDC tokens or API keys
- API keys are scoped to specific permissions (e.g., a CI/CD key can only execute pre-approved templates)
- API keys have configurable expiration (default: 90 days) and are rotatable without downtime
- Rate limiting: 100 requests/minute per user, 1,000 requests/minute per CI/CD service account

---

## Audit Trail

### What Is Audited

Every action in the platform is recorded in an immutable, append-only audit log:

| Event Category | Events Captured | Retention |
|---------------|-----------------|-----------|
| **Experiment lifecycle** | Created, approved, rejected, started, completed, failed, aborted | 7 years |
| **Fault injection** | Fault applied (agent, target, type, parameters), fault reverted (trigger reason) | 7 years |
| **Blast radius** | Blast radius calculated, approved, rejected (with full computation details) | 7 years |
| **Hypothesis evaluation** | Every metric query result, hypothesis pass/fail, grace period state | 1 year |
| **Access control** | Login, logout, role changes, API key creation/revocation | 7 years |
| **Configuration changes** | Guardrail changes, template changes, agent fleet changes | 7 years |
| **GameDay events** | Start, phase transitions, participant actions, abort, debrief notes | 7 years |
| **Agent lifecycle** | Registration, heartbeats (summary), autonomous reverts, crashes | 1 year |

### Audit Log Properties

- **Immutability:** Once written, audit entries cannot be modified or deleted. The storage layer enforces append-only semantics using WORM (Write Once Read Many) storage or cryptographic chaining.
- **Tamper evidence:** Each audit entry includes a cryptographic hash of the previous entry (hash chain). Any modification to historical entries breaks the chain and is detectable.
- **Non-repudiation:** All entries include the authenticated identity of the actor (user, service account, or system component). Actors cannot deny performing recorded actions.

### Audit Log Schema

```
AuditEntry:
    entry_id:         string (UUID)
    previous_hash:    string (hash chain)
    timestamp:        timestamp (microsecond precision, UTC)
    actor_id:         string (user ID, service account, or "system")
    actor_ip:         string
    action:           string (e.g., "experiment.created", "fault.injected")
    resource_type:    string (e.g., "experiment", "agent", "guardrail")
    resource_id:      string
    details:          map<string, any> (action-specific metadata)
    environment:      string
    outcome:          string ("success", "denied", "error")
```

---

## Compliance Considerations

### SOC2 Implications of Intentional Fault Injection

Chaos engineering creates a unique compliance challenge: **SOC2 requires controls to prevent unauthorized system disruption, yet the chaos platform's purpose is authorized disruption.** The key distinction for auditors:

| SOC2 Concern | How the Platform Addresses It |
|-------------|------------------------------|
| **Unauthorized access** | RBAC with environment-based gating; production requires multi-party approval |
| **Uncontrolled changes** | All experiments are pre-validated (blast radius), time-bounded, and automatically rolled back |
| **Audit trail** | Every action is logged immutably with actor identity, timestamp, and full context |
| **Availability impact** | Blast radius limits prevent experiments from exceeding organizational risk tolerance |
| **Change management** | Experiments follow the same approval workflow as production changes (with additional safety controls) |
| **Incident response** | Platform integrates with incident management; experiments auto-abort during active incidents |

### Compliance-Relevant Features

1. **Experiment pre-registration:** All experiments must be defined and approved before execution. Ad-hoc fault injection (without a corresponding experiment record) is impossible through the platform.

2. **Automatic incident correlation:** The platform publishes experiment timelines to the organization's incident management system. If an incident occurs during an experiment, the timeline is immediately available for RCA.

3. **Exclusion windows:** The platform supports "freeze periods" (code freezes, compliance audit windows, peak business periods) during which all experiments are automatically suspended.

4. **Geographic restrictions:** Experiments can be restricted to specific regions for data sovereignty compliance (e.g., EU-only experiments cannot affect infrastructure in non-EU regions).

5. **Data protection:** The chaos platform does not access, modify, or transmit application data. Fault injection operates at the infrastructure level (network, compute, storage) and does not interact with business data.

### Regulatory Framework Mapping

| Framework | Relevant Controls | Platform Compliance Mechanism |
|-----------|------------------|------------------------------|
| SOC2 (CC6.1) | Logical and physical access controls | RBAC, mTLS, audit logging |
| SOC2 (CC7.2) | System operations monitoring | Continuous hypothesis monitoring, automated rollback |
| SOC2 (CC8.1) | Change management | Experiment approval workflows, blast radius validation |
| ISO 27001 (A.12.1) | Operational procedures | Documented experiment templates, runbooks, GameDay procedures |
| PCI DSS (6.4) | Change control processes | Production gating, multi-party approval |
| HIPAA (164.312) | Audit controls | Immutable audit log, 7-year retention |

---

## Threat Model

### Attack Vectors

| Threat | Attack Description | Mitigation |
|--------|-------------------|------------|
| **Compromised user account** | Attacker uses stolen credentials to create destructive experiments | MFA required for production experiments; multi-party approval; anomaly detection on experiment patterns |
| **Compromised CI/CD pipeline** | Malicious code injects chaos experiments via CI/CD integration | CI/CD keys scoped to approved templates only; templates cannot be modified via CI/CD |
| **Compromised agent** | Attacker gains control of a fault injector agent | Agent cannot initiate experiments (only execute commands from authenticated control plane); mTLS with certificate pinning |
| **Insider threat** | Malicious employee creates experiments designed to cause outages | Separation of duties; approval workflow; blast radius limits; audit trail; anomaly detection |
| **Supply chain attack** | Compromised experiment template in the community library | Template review and approval before import; templates execute in a sandbox before production use |
| **Denial of service against the platform** | Attacker floods the experiment API to prevent legitimate experiments | Rate limiting; authentication required for all endpoints |

### Security Monitoring

The platform itself should be monitored for suspicious activity:

| Signal | Trigger | Response |
|--------|---------|----------|
| Experiment targeting critical infrastructure | Experiment targets databases, message queues, or the chaos platform itself | Elevated approval (infrastructure team + VP) |
| Unusual experiment frequency | >5 experiments/hour by a single user (vs. baseline of 1-2/day) | Alert to platform admin; auto-block after threshold |
| Experiment outside business hours | Production experiment created at 3 AM on a weekend | Require additional approval; alert on-call |
| Failed approval attempts | >3 rejected experiments for the same target in 24 hours | Alert to security team; investigate intent |
| Agent anomaly | Agent reporting faults that don't match any experiment | Quarantine agent; investigate for compromise |

---

## SOC 2 Implications of Chaos Engineering

### The Compliance Paradox

Chaos engineering intentionally degrades production systems — which seems to directly conflict with SOC 2's availability and security controls. The resolution is framing chaos engineering as a control that strengthens resilience:

| SOC 2 Control | How Chaos Engineering Supports It |
|---|---|
| **CC7.1: Identify and assess risks** | Chaos experiments proactively identify resilience gaps before they cause outages |
| **CC7.2: Monitor system components** | Steady-state hypothesis monitoring validates observability effectiveness |
| **CC7.4: Respond to identified risks** | Chaos experiment results drive remediation work; tracked to completion |
| **A1.2: Recovery mechanisms** | Chaos experiments validate that recovery mechanisms (failover, circuit breakers) actually work |
| **CC8.1: Change management** | Chaos experiments integrated into CI/CD validate that changes don't regress resilience |

### Compliance Documentation Requirements

For each chaos experiment in production, the platform generates compliance evidence:
- **Pre-experiment:** Approval record (who approved, when, justification), blast radius declaration, steady-state hypothesis
- **During experiment:** Continuous steady-state evaluation results, blast radius adherence confirmation
- **Post-experiment:** Result (pass/fail), any SLO budget consumed, duration, rollback timing
- **Audit trail:** Immutable log of all state transitions, commands, and agent responses

### Regulatory Considerations for Regulated Industries

| Industry | Constraint | Platform Adaptation |
|---|---|---|
| **Financial services** | Cannot intentionally disrupt transaction processing during market hours | Time-window restrictions; staging-first requirement |
| **Healthcare** | Patient safety systems cannot be chaos-tested in production | Isolated simulation environment; shadow traffic only |
| **Government** | FedRAMP requires pre-authorization for any infrastructure changes | Experiment pre-registration with change advisory board |
| **E-commerce** | Revenue-impacting experiments require finance team approval | Revenue-impact estimator in blast radius controller |

---

## Multi-Tenant Security Model

For organizations operating the chaos platform as a shared service across multiple teams:

### Isolation Boundaries

```
Tenant isolation model:
  Level 1: Namespace isolation
    - Each team has a namespace (e.g., "payments-team", "checkout-team")
    - Experiments within a namespace can only target services owned by that team
    - Ownership determined by service registry + RBAC mapping

  Level 2: Blast radius isolation
    - Each team's blast radius is capped independently
    - Team A's experiments cannot consume Team B's blast radius budget
    - Organization-level ceiling caps the sum of all team blast radii

  Level 3: Agent isolation
    - Agents are labeled with their owning team
    - An agent will only execute commands from experiments in its namespace
    - Cross-namespace experiments require explicit approval from both teams

  Level 4: Results isolation
    - Experiment results are visible only within the owning namespace
    - Organization admins can see all experiments (audit role)
    - Cross-team experiment results shared only for approved GameDay events
```

### Privilege Escalation Prevention

The platform must prevent a team member from escalating their blast radius or bypassing approval:

```
FUNCTION validate_experiment_authorization(experiment, submitter):
  // Check 1: Submitter has permission to run experiments
  IF NOT has_permission(submitter, "chaos:experiment:create"):
    RETURN DENY("INSUFFICIENT_PERMISSIONS")

  // Check 2: All target services are in submitter's namespace
  FOR target IN experiment.targets:
    IF NOT service_owned_by(target.service, submitter.namespace):
      RETURN DENY("CROSS_NAMESPACE_TARGET:" + target.service)

  // Check 3: Blast radius within team's allocation
  team_budget = get_team_blast_radius_budget(submitter.namespace)
  IF experiment.blast_radius > team_budget.remaining:
    RETURN DENY("TEAM_BLAST_RADIUS_EXCEEDED")

  // Check 4: Production experiments require additional approval
  IF experiment.environment == "production":
    IF NOT has_approval(experiment, required_approver=team_lead):
      RETURN DENY("PRODUCTION_APPROVAL_REQUIRED")

  // Check 5: Critical infrastructure targets require VP approval
  IF any_target_is_critical_infrastructure(experiment.targets):
    IF NOT has_approval(experiment, required_approver=vp_engineering):
      RETURN DENY("CRITICAL_INFRA_APPROVAL_REQUIRED")

  RETURN ALLOW()
```

---

## Breach Response: Chaos Platform Compromise

### Attack Scenario: Malicious Experiment Injection

If an attacker gains access to the chaos platform, they can create experiments that cause legitimate-looking production outages — the perfect attack vector because the damage looks like a "failed chaos test" rather than a security breach.

### Detection Signals

| Signal | Indicator | Response |
|---|---|---|
| Experiment created without preceding API authentication | Direct database insertion | Immediate lockdown; revoke all agent credentials |
| Blast radius exceeding organization ceiling | Bypassed guardrail | All agents execute emergency revert |
| Experiment targeting chaos platform infrastructure | Self-targeting attack | Circuit breaker prevents execution; alert security team |
| Agent receiving commands from unknown control plane | MITM or rogue control plane | Agent rejects unauthenticated commands; reports anomaly |

### Emergency Lockdown Procedure

1. **Global abort:** Send "REVERT_ALL" command to every agent in the fleet
2. **Agent lockdown:** Agents enter read-only mode; reject all new inject commands
3. **Credential rotation:** Rotate all agent-to-control-plane mTLS certificates
4. **Audit review:** Examine all experiments created in the last 24 hours for anomalies
5. **Communication:** Notify all team leads that chaos engineering is paused pending investigation

---

## Advanced Security Threats

### Threat 1: Timing Attack via Experiment Scheduling

**Attack:** An attacker who can schedule experiments (but not target production) schedules a staging experiment at the exact time a production deployment occurs. The staging experiment consumes observability backend capacity, degrading the deployment's monitoring — effectively creating a blind spot for the production rollout.

**Mitigation:** Deployment pipeline integration: the chaos platform checks for in-progress deployments before starting experiments that target the same observability backend. Experiments are delayed until deployment monitoring completes.

### Threat 2: Blast Radius Manipulation via Service Registry

**Attack:** An attacker modifies the service registry to reduce the apparent instance count of a service, making the BRC believe that "10% of instances" is 2 hosts instead of 20. The experiment then affects a disproportionate percentage of the actual service.

**Mitigation:** Cross-reference the service registry instance count with the agent fleet's self-reported membership. If the registry says 20 instances but only 5 agents report for that service, use the maximum of the two counts for blast radius calculation (pessimistic estimation).

### Threat 3: Agent Impersonation

**Attack:** An attacker deploys a rogue process that impersonates a fault injector agent, registers with the control plane, and receives experiment commands. The rogue agent then applies faults differently than intended (e.g., applying permanent damage instead of reversible faults).

**Mitigation:** Agent attestation: each agent binary includes a cryptographic hash that is verified during registration. The control plane maintains an allowlist of valid binary hashes. Binary integrity is verified at startup and periodically during operation using kernel-level attestation (TPM/secure boot chain where available).

### Threat 4: Experiment Data Exfiltration

**Attack:** An attacker creates experiments that inject network faults routing traffic through a compromised proxy, enabling data interception during the fault window.

**Mitigation:** Experiment templates are validated to ensure fault parameters do not include traffic redirection. Network faults can only add latency, drop packets, or block traffic — never redirect it. This constraint is enforced at the agent level, not just the API level.

---

## Zero-Trust Agent Enrollment

### Agent Lifecycle Security

```
FUNCTION enroll_agent(agent_binary_hash, host_attestation):
    // Step 1: Verify binary integrity
    IF agent_binary_hash NOT IN approved_binary_hashes:
        RETURN REJECT("BINARY_NOT_APPROVED")

    // Step 2: Verify host attestation (TPM measurement or container image hash)
    IF NOT verify_host_attestation(host_attestation):
        RETURN REJECT("HOST_ATTESTATION_FAILED")

    // Step 3: Issue short-lived mTLS certificate (24-hour validity)
    cert = issue_agent_certificate(
        cn = host_attestation.host_id,
        validity = 24 HOURS,
        allowed_operations = ["receive_commands", "send_heartbeat", "report_revert"]
    )

    // Step 4: Register agent with capabilities
    register_agent(
        agent_id = generate_agent_id(),
        host_id = host_attestation.host_id,
        binary_version = agent_binary_hash,
        capabilities = detect_agent_capabilities(),  // network, compute, I/O, etc.
        cert_fingerprint = cert.fingerprint
    )

    // Step 5: Set up automatic certificate rotation
    schedule_cert_rotation(agent_id, interval = 12 HOURS)

    RETURN EnrollmentResult(
        status = ENROLLED,
        certificate = cert,
        next_rotation = NOW() + 12 HOURS
    )
```

### Certificate Rotation Protocol

```
FUNCTION rotate_agent_certificate(agent_id):
    // Non-disruptive rotation: issue new cert before old expires
    old_cert = get_current_certificate(agent_id)

    // Issue new certificate with overlap period
    new_cert = issue_agent_certificate(
        cn = old_cert.cn,
        validity = 24 HOURS,
        allowed_operations = old_cert.allowed_operations
    )

    // Both old and new certs are valid during overlap window (1 hour)
    add_to_valid_certs(agent_id, new_cert)

    // Agent receives new cert via secure command channel
    send_cert_rotation_command(agent_id, new_cert)

    // After agent acknowledges, revoke old cert
    WHEN agent_ack_received(agent_id, "cert_rotation"):
        revoke_certificate(old_cert)
        remove_from_valid_certs(agent_id, old_cert)
```

---

## Data Classification for Chaos Engineering

| Data Category | Classification | Examples | Handling |
|---------------|---------------|----------|----------|
| **Experiment definitions** | Internal | Fault types, target selectors, thresholds | Encrypted at rest; role-based access |
| **Blast radius calculations** | Internal | Service dependency graph, impact percentages | Cached in memory; not persisted beyond experiment lifetime |
| **Experiment results** | Internal | Pass/fail, metric values during experiment | 7-year retention for compliance |
| **Audit trail** | Confidential | User identities, approval decisions, timestamps | WORM storage; tamper-evident chain |
| **Agent credentials** | Restricted | mTLS certificates, enrollment tokens | Hardware-backed storage where available; auto-rotation |
| **Service dependency graph** | Internal | Inter-service call patterns, dependency weights | Derived from observability; cached with TTL |
| **Organizational guardrails** | Confidential | Blast radius ceilings, risk appetite declarations | Version-controlled; change requires admin approval |
