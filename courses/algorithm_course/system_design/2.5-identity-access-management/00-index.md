# Identity & Access Management (IAM) System - System Design

## System Overview

An **Identity & Access Management (IAM) System** is a centralized platform that handles authentication (verifying who users are), authorization (determining what they can do), and user lifecycle management across applications and services. Modern IAM systems support multiple authentication protocols (OAuth2, OIDC, SAML), diverse authorization models (RBAC, ABAC, ReBAC), phishing-resistant multi-factor authentication (WebAuthn/Passkeys), and automated user provisioning (SCIM).

The architecture separates a **control plane** responsible for policy administration, user directory management, identity provider configuration, and tenant management from a **data plane** that handles high-volume authentication flows, token validation, and authorization decisions. The key technical challenges include achieving sub-10ms policy evaluation latency at scale, maintaining strong security guarantees while enabling seamless user experiences, supporting complex multi-tenant architectures, and ensuring regulatory compliance across jurisdictions.

---

## Autonomy Classification

**Tier: A — AI-Assisted**

| Boundary | Description |
|----------|-------------|
| **What AI decides alone** | Risk scoring for login attempts, anomaly flagging on session behavior, policy cache pre-warming decisions |
| **What AI recommends** | Adaptive MFA step-up triggers, suspicious IP blocking suggestions, policy optimization recommendations |
| **What requires human approval** | Policy creation/modification, role assignments, identity provider federation configuration, account recovery overrides |
| **Deterministic source of truth** | User Directory (identity store) and Policy Store (authorization rules) — AI augments but never overrides deterministic policy evaluation |
| **Rollback path** | Git-versioned policies with instant rollback; session revocation via token blacklist; MFA device deregistration via admin console |

---

## Key Characteristics

| Characteristic | Value | Implication |
|----------------|-------|-------------|
| **Traffic Pattern** | Bimodal: login bursts + steady token validation | Cold path (auth) and warm path (validation) optimization |
| **Consistency Model** | Strong for auth decisions, eventual for sessions | Revocation propagation window trade-off |
| **Security Posture** | Zero-trust, defense-in-depth | Every request authenticated and authorized |
| **Scale Asymmetry** | 100:1 validation-to-login ratio | Token validation must be highly optimized |
| **Multi-tenancy** | Strong isolation between tenants | Separate encryption keys, audit trails |
| **Compliance** | SOC2, HIPAA, GDPR, FedRAMP | Data residency, audit logging, retention policies |

---

## Complexity Rating

**Very High**

- Multi-protocol authentication (OAuth2, OIDC, SAML, WebAuthn)
- Multiple authorization models (RBAC, ABAC, ReBAC) with policy engine
- Token management with multiple strategies (JWT, opaque, refresh rotation)
- Phishing-resistant MFA (WebAuthn/Passkeys, TOTP fallback)
- User provisioning and lifecycle (SCIM, JIT provisioning)
- Multi-tenant architecture with tenant isolation
- Federated identity with external IdPs
- Compliance requirements (SOC2, HIPAA, GDPR)
- Sub-10ms p99 authorization decisions at scale
- Credential security (Argon2id, HSM-backed signing)

---

## Quick Navigation

| Document | Description |
|----------|-------------|
| [01 - Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/Non-functional requirements, capacity planning, SLOs |
| [02 - High-Level Design](./02-high-level-design.md) | Architecture, authentication/authorization flows, key decisions |
| [03 - Low-Level Design](./03-low-level-design.md) | Data model, API design, algorithm Step-by-step plan in plain English |
| [04 - Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Policy engine, session management, token lifecycle, MFA deep dives |
| [05 - Scalability & Reliability](./05-scalability-and-reliability.md) | Multi-region, policy caching, graceful degradation |
| [06 - Security & Compliance](./06-security-and-compliance.md) | Threat model, credential security, compliance mapping |
| [07 - Observability](./07-observability.md) | Metrics, logging, security dashboards, brute-force detection |
| [08 - Interview Guide](./08-interview-guide.md) | 45-min pacing, trade-offs, trap questions, common mistakes |

---

## Core Components Summary

| Component | Responsibility | Criticality |
|-----------|---------------|-------------|
| **Identity Provider (IdP)** | User authentication, SSO, protocol translation | Critical - gateway to all identity |
| **Policy Engine (PDP)** | Evaluate authorization policies, make access decisions | Critical - security enforcement |
| **Policy Enforcement Point (PEP)** | Intercept requests, call PDP, enforce decisions | Critical - access control boundary |
| **User Directory** | Store identities, attributes, group memberships | Critical - source of identity truth |
| **Session Manager** | Create, validate, revoke sessions and tokens | Critical - stateful identity context |
| **MFA Service** | Multi-factor authentication (WebAuthn, TOTP, SMS) | Critical - authentication security |
| **Provisioning Service** | User lifecycle, SCIM integration, JIT provisioning | Important - identity automation |
| **Audit Logger** | Security event logging, compliance reporting | Important - compliance and forensics |

---

## Algorithm Summary

| Algorithm/Pattern | Purpose | Complexity | Key Insight |
|-------------------|---------|------------|-------------|
| **Policy Evaluation (OPA/Rego)** | Evaluate ABAC/ReBAC policies | O(policy size) | Graph traversal for relationship-based rules |
| **JWT Validation** | Verify token signatures and claims | O(1) | Local validation with cached public keys |
| **Token Introspection** | Check opaque token validity | O(1) network | Centralized revocation check |
| **Refresh Token Rotation** | Issue new tokens, detect reuse | O(1) | Family-based rotation with reuse detection |
| **Password Hashing (Argon2id)** | Secure credential storage | O(memory × iterations) | Memory-hard to resist GPU attacks |
| **WebAuthn Challenge-Response** | Phishing-resistant authentication | O(1) | Asymmetric cryptography with origin binding |
| **Session Clustering** | Distributed session management | O(1) with consistent hashing | Sticky sessions with failover |

---

## Architecture Trade-offs at a Glance

```
Stateless Tokens (JWT) ←――――――――→ Stateful Tokens (Opaque)
          ↑                              ↑
    No server lookup               Instant revocation
    Self-contained claims          Central authority needed
    Cannot revoke instantly        Lookup per request
    (External APIs)                (Internal services)

Centralized Policy Engine ←―――――→ Distributed Policy Cache
          ↑                              ↑
    Single source of truth         Lower latency
    Always consistent              Eventually consistent
    Network hop required           Local evaluation
    (Write path, complex rules)    (Read path, hot policies)

RBAC (Role-Based) ←―――――――――――――→ ReBAC (Relationship-Based)
          ↑                              ↑
    Simpler to understand          Fine-grained permissions
    Fewer entities                 Scales with relationships
    Role explosion at scale        Complex policy language
    (Enterprise apps)              (Collaborative apps)
```

---

## Protocol Comparison

| Protocol | Purpose | Token Format | Best For |
|----------|---------|--------------|----------|
| **OAuth 2.0** | Authorization delegation | Access/Refresh tokens | API access, 3rd-party apps |
| **OIDC** | Authentication + OAuth2 | ID Token (JWT) | User authentication, SSO |
| **SAML 2.0** | Federated SSO | XML assertions | Enterprise SSO, legacy systems |
| **WebAuthn/FIDO2** | Passwordless MFA | Public key credentials | Phishing-resistant auth |
| **SCIM** | User provisioning | JSON REST | User lifecycle automation |

---

## Authorization Model Comparison

| Model | Access Based On | Complexity | Best For |
|-------|-----------------|------------|----------|
| **RBAC** | User's assigned roles | Low | Enterprise apps with clear hierarchies |
| **ABAC** | User/resource/environment attributes | Medium | Dynamic access rules, compliance |
| **ReBAC** | Relationships between entities | High | Collaborative apps (Google Docs-like) |
| **Hybrid** | Combination of above | High | Complex enterprise requirements |

---

## Real-World References

| Provider | Architecture | Key Innovation |
|----------|------------|----------------|
| **Okta** | Cloud-native, event-sourced | Universal Directory, Workforce Identity |
| **Auth0** | Developer-first, extensible | Actions (serverless hooks), Rules |
| **Zitadel** | Event-sourced, self-hosted option | CQRS architecture, open source |
| **Keycloak** | Self-hosted, Red Hat backed | Extensive protocol support |
| **AWS IAM** | Policy-based, resource-centric | Fine-grained policies, principal hierarchy |
| **Google Zanzibar** | ReBAC at scale | Relationship tuples, global consistency |

---

## 2025-2026 Platform Evolution

### Key Industry Shifts

| Shift | Description | Impact |
|-------|-------------|--------|
| **OAuth 2.1 Consolidation** | PKCE mandatory for all clients, implicit and ROPC grants removed, refresh token rotation required | Simplified, more secure authorization — fewer grant types to implement and audit |
| **Passkeys / FIDO2 Mainstream** | Platform authenticators (Touch ID, Windows Hello) + synced passkeys (iCloud Keychain, Google Password Manager) reach critical mass | Passwordless becomes the default, not the exception — fundamentally changes auth UX |
| **Policy-as-Code (OPA/Cedar)** | Authorization policies defined in code (Rego, Cedar), version-controlled, testable, auditable | Authorization becomes a software engineering discipline, not an admin task |
| **ITDR (Identity Threat Detection)** | Dedicated identity-layer threat detection beyond traditional SIEM — session anomaly detection, credential stuffing ML models, impossible travel heuristics | Identity attacks (80%+ of breaches) get purpose-built detection infrastructure |
| **Decentralized Identity** | EU eIDAS 2.0 mandates digital identity wallets, W3C Verifiable Credentials, SD-JWT for selective disclosure | Users control their identity attributes — IAM systems become verifiers, not stores |
| **Zero Trust Identity Fabric** | CAEP (Continuous Access Evaluation Protocol) for real-time session revocation, step-up authentication as standard | Every access decision considers real-time risk signals, not just initial auth |

### Platform Updates (2025-2026)

| Platform | Key Updates | Significance |
|----------|-------------|--------------|
| **Keycloak 26+** | Organizations multi-tenancy support, first-class passkey support, improved admin UI | Self-hosted IAM becomes viable for multi-tenant SaaS |
| **Zitadel** | Cloud-native CQRS/event-sourced architecture, built-in OIDC/SAML/passkeys, Actions v2 | Modern alternative to Keycloak with better cloud-native fit |
| **OpenFGA** | Okta-backed open-source ReBAC engine (Zanzibar-inspired), SDKs for 10+ languages | Enterprise-grade fine-grained authorization without building from scratch |
| **SpiceDB** | AuthZed's open-source Zanzibar implementation, strong consistency, distributed graph | Production-proven ReBAC at scale (used by major tech companies) |
| **Cedar** | AWS-backed policy language with formal verification, static analysis of policies | Provably correct authorization policies — if it compiles, it's consistent |

---

## Related Systems

| System | Relationship |
|--------|-------------|
| [1.14 API Gateway Design](../1.14-api-gateway-design/00-index.md) | First integration point for IAM — token validation, rate limiting per identity |
| [2.10 Zero Trust Security Architecture](../2.10-zero-trust-security-architecture/00-index.md) | IAM as the foundation layer for zero trust — every request authenticated and authorized |
| [2.11 Service Mesh Design](../2.11-service-mesh-design/00-index.md) | mTLS and authorization enforcement at service-to-service level |
| [2.16 Secret Management System](../2.16-secret-management-system/00-index.md) | Credential storage, HSM-backed signing keys, dynamic secrets for service auth |
| [15.3 Log Aggregation System](../15.3-log-aggregation-system/00-index.md) | Security audit log aggregation and SIEM integration |
| [15.6 Incident Management System](../15.6-incident-management-system/00-index.md) | Identity incident response workflows (compromised accounts, credential breaches) |
| [15.7 AI-Native Cybersecurity Platform](../15.7-ai-native-cybersecurity-platform/00-index.md) | ITDR integration — ML-based identity threat detection |
| [3.10 Open-Source ML Platform](../3.10-open-source-ml-platform/00-index.md) | IAM provides multi-tenant auth for ML platform users and service accounts |

---

## References

- [OAuth 2.1 Draft Specification (IETF)](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1)
- [FIDO Alliance - Passkeys](https://fidoalliance.org/passkeys/)
- [Google Zanzibar Paper](https://research.google/pubs/pub48190/)
- [Open Policy Agent (OPA)](https://www.openpolicyagent.org/)
- [Cedar Policy Language](https://www.cedarpolicy.com/)
- [OpenFGA - Fine-Grained Authorization](https://openfga.dev/)
- [Keycloak Documentation](https://www.keycloak.org/documentation)
- [Zitadel Documentation](https://zitadel.com/docs)
- [NIST SP 800-63-4 Digital Identity Guidelines](https://pages.nist.gov/800-63-4/)
- [EU eIDAS 2.0 Regulation](https://digital-strategy.ec.europa.eu/en/policies/eidas-regulation)

---

> **Vendor freshness**: Product names and version numbers quoted in this document reflect publicly available information as of the document's last-updated date and may have changed since.
