# Compliance First, AI Native Cloud SaaS AI-Powered Clinical Decision Support

## System Overview

An AI-native Clinical Decision Support System (CDSS) that integrates seamlessly into clinical workflows to provide real-time, evidence-based decision support at the point of care. The system delivers **drug interaction alerts**, **diagnosis suggestions**, **clinical guideline recommendations**, and **predictive risk scoring** while maintaining strict regulatory compliance across multiple jurisdictions (FDA SaMD, EU MDR/AI Act, HIPAA, GDPR).

Built on a **Compliance First** architecture with multi-framework regulatory adherence, **Privacy First** data handling with consent-aware processing, and **AI Native** design with explainable machine learning models that augment—never replace—clinical judgment.

---

## Autonomy Classification

**Tier: B — AI-Augmented (Regulated Domain)**

This is a **regulated system with an AI intelligence layer**, not an autonomous AI system. The deterministic transactional core owns all writes and final decisions. AI accelerates discovery, triage, recommendation, and explanation.

| Boundary | AI Role | Human/System Authority |
|----------|---------|----------------------|
| **System of Record** | Cannot write directly | Deterministic transactional core |
| **System of Intelligence** | Recommendations, ranking, extraction, reasoning with evidence | AI layer |
| **Action Boundary** | Proposes actions, never executes without validation | Deterministic validation gate |
| **Human Override** | Clinician reviews all CDS recommendations; AI is assistive per FDA CDS guidance (Jan 2026) and EU AI Act high-risk medical device rules (Aug 2026) | Required for all high-stakes decisions |
| **Rollback Path** | AI recommendations reversible | Full audit trail preserved |

---

## Key Characteristics

| Characteristic | Description |
|---------------|-------------|
| **Workload Type** | Read-heavy (alert checks on every prescription), Low-latency critical |
| **Data Sensitivity** | Extremely High (PHI/PII with patient safety implications) |
| **Consistency Model** | Strong consistency for alerts (patient safety), Eventual for analytics |
| **Availability Target** | 99.99% (safety-critical system) |
| **Latency Sensitivity** | Very High (DDI check p99 < 200ms, Diagnosis p99 < 2s) |
| **Geographic Scope** | Multi-region with data residency requirements |
| **AI Integration** | Native (drug interactions, diagnosis, risk scoring, guideline matching) |
| **Compliance Scope** | FDA SaMD, EU MDR/AI Act, HIPAA, GDPR, ABDM, NHS Digital |
| **Integration Pattern** | CDS Hooks + FHIR R4 for EHR integration |

---

## Complexity Rating

**Very High**

This system combines:
- Multi-framework regulatory compliance (FDA SaMD classification, EU MDR + AI Act dual compliance)
- Real-time clinical alerting with patient safety implications
- Explainable AI requirements for medical decision support
- Alert fatigue mitigation while maintaining clinical sensitivity
- Privacy-preserving ML (federated learning, differential privacy)
- Healthcare interoperability standards (CDS Hooks, FHIR R4, CQL)
- Multi-region data residency with cross-border transfer controls
- Predetermined Change Control Plans (PCCP) for model updates

---

## Quick Navigation

| Document | Description |
|----------|-------------|
| [01 - Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/Non-functional requirements, capacity planning, SLOs |
| [02 - High-Level Design](./02-high-level-design.md) | System architecture, data flows, key decisions |
| [03 - Low-Level Design](./03-low-level-design.md) | Data model, API design, core algorithms |
| [04 - Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Drug interaction engine, explainable AI, alert fatigue |
| [05 - Scalability & Reliability](./05-scalability-and-reliability.md) | Scaling strategy, fault tolerance, disaster recovery |
| [06 - Security & Compliance](./06-security-and-compliance.md) | FDA SaMD, EU MDR/AI Act, threat model, PCCP |
| [07 - Observability](./07-observability.md) | Metrics, logging, tracing, compliance dashboards |
| [08 - Interview Guide](./08-interview-guide.md) | 45-min pacing, trap questions, trade-offs |

---

## Core Capabilities

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│              AI-POWERED CLINICAL DECISION SUPPORT SYSTEM                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                    1. DRUG INTERACTION ALERTS                            │   │
│  │  • Real-time drug-drug interaction (DDI) detection                      │   │
│  │  • Multi-drug interaction analysis (3+ medications)                     │   │
│  │  • Drug-condition contraindication checking                             │   │
│  │  • Patient-context severity adjustment (age, renal function, pregnancy) │   │
│  │  • Evidence-based recommendations with literature citations             │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                    2. DIAGNOSIS SUGGESTIONS                              │   │
│  │  • Symptom-to-diagnosis ML models with confidence scores                │   │
│  │  • Vital signs pattern recognition                                      │   │
│  │  • Differential diagnosis ranking                                       │   │
│  │  • Rare disease flagging                                                │   │
│  │  • Explainable AI with feature attribution (SHAP/LIME)                  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                    3. CLINICAL GUIDELINE RECOMMENDATIONS                 │   │
│  │  • ADA (American Diabetes Association) Standards of Care                │   │
│  │  • WHO clinical protocols                                               │   │
│  │  • ICMR (Indian Council of Medical Research) guidelines                 │   │
│  │  • ESC (European Society of Cardiology) recommendations                 │   │
│  │  • CQL-encoded guidelines with automatic patient matching               │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                    4. PREDICTIVE RISK SCORING                            │   │
│  │  • Cardiovascular risk: PREVENT, QRISK3/QR4, ASCVD                      │   │
│  │  • Diabetes risk: HbA1c-based, Finnish Diabetes Risk Score              │   │
│  │  • Hypertension risk with lifestyle factor integration                  │   │
│  │  • Chronic kidney disease progression                                   │   │
│  │  • 30-day readmission risk                                              │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## CDS Integration Model

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         EHR INTEGRATION LAYER                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────┐    ┌────────────────┐    ┌────────────────┐             │
│  │ Epic           │    │ Oracle Cerner  │    │ MEDITECH       │             │
│  │ Best Practices │    │ Millennium     │    │ Expanse        │             │
│  └───────┬────────┘    └───────┬────────┘    └───────┬────────┘             │
│          │                     │                     │                       │
│          └─────────────────────┼─────────────────────┘                       │
│                                │                                             │
│                    ┌───────────▼───────────┐                                │
│                    │     CDS HOOKS v2.0     │                                │
│                    │  • medication-prescribe │                                │
│                    │  • order-sign           │                                │
│                    │  • patient-view         │                                │
│                    │  • encounter-start      │                                │
│                    └───────────┬───────────┘                                │
│                                │                                             │
│                    ┌───────────▼───────────┐                                │
│                    │    AI-NATIVE CDSS      │                                │
│                    │  (This System)         │                                │
│                    └───────────┬───────────┘                                │
│                                │                                             │
│                    ┌───────────▼───────────┐                                │
│                    │    FHIR R4 Response    │                                │
│                    │  • Cards (suggestions)  │                                │
│                    │  • SystemActions        │                                │
│                    │  • Links (evidence)     │                                │
│                    └────────────────────────┘                                │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Alert Severity Classification

| Severity | Trigger Criteria | Display Mode | Override Requirement |
|----------|------------------|--------------|---------------------|
| **Critical** | Life-threatening DDI, Contraindicated in current condition | Hard stop, Interruptive | Attending physician + Clinical justification + Pharmacy review |
| **High** | Serious DDI, Major contraindication | Interruptive alert | Physician acknowledgment + Reason code |
| **Moderate** | Moderate DDI, Dose adjustment needed | Passive alert (sidebar) | Optional acknowledgment |
| **Low** | Minor DDI, Informational | Non-interruptive nudge | No override needed |

---

## Knowledge Sources Integration

| Source | Coverage | Use Case | Update Frequency |
|--------|----------|----------|------------------|
| **DrugBank** | 14,000+ drugs | DDI severity, mechanisms, evidence | Monthly |
| **RxNorm** | US drug nomenclature | Drug normalization, ingredient mapping | Weekly |
| **First Databank (FDB)** | Commercial DDI | Clinical severity, management | Real-time subscription |
| **SNOMED CT** | Clinical terminology | Diagnosis codes, conditions | Bi-annual |
| **ICD-10** | Diagnosis classification | Billing, condition matching | Annual |
| **LOINC** | Lab observations | Lab result interpretation | Semi-annual |
| **ADA Standards** | Diabetes guidelines | Glycemic management protocols | Annual (December) |
| **WHO Guidelines** | Global health protocols | Treatment recommendations | As published |
| **ICMR Guidelines** | India-specific protocols | Regional treatment standards | As published |

---

## Target Users

| User Type | Primary Use Cases | Alert Preferences |
|-----------|-------------------|-------------------|
| **Prescribing Physicians** | DDI checks at order entry, Diagnosis support | Interruptive for critical, Passive for moderate |
| **Clinical Pharmacists** | DDI review, Medication reconciliation | Comprehensive alerts, Batch review |
| **Primary Care Providers** | Risk scoring, Preventive care guidelines | Integrated dashboard, Trending alerts |
| **Specialists** | Disease-specific guidelines, Complex interactions | Filtered by specialty |
| **Nurses** | Medication administration alerts | Critical only, Quick acknowledge |
| **Care Coordinators** | Risk stratification, Guideline adherence | Population-level summaries |

---

## Regulatory Compliance Summary

| Regulation | Scope | Key Requirements | Status |
|------------|-------|------------------|--------|
| **FDA SaMD** | US market | 510(k) or De Novo, GMLP, PCCP | Required for US |
| **EU MDR 2017/745** | EU market | CE marking, Clinical evaluation | Required for EU |
| **EU AI Act** | AI systems in EU | High-risk AI compliance, Transparency | Aug 2027 deadline |
| **HIPAA** | US PHI | Security Rule, Breach notification | Required for US |
| **GDPR** | EU personal data | Consent, Data minimization, Portability | Required for EU |
| **21st Century Cures** | CDS exemptions | Four criteria for non-device CDS | Narrow exemption |

---

## Related Patterns

| Pattern | Relationship | Key Insight |
|---------|-------------|-------------|
| [Cloud-Native EHR](../10.2-cloud-native-ehr/) | **Primary integration target** | CDSS consumes EHR data via CDS Hooks; EHR owns patient record, CDSS owns clinical intelligence |
| [Compliance-First EMR/EHR/PHR](../2.23-compliance-first-ai-native-emr-ehr-phr/) | **Shared compliance framework** | Both systems navigate FDA SaMD, HIPAA, and GDPR; shared consent management and audit patterns |
| [Compliance-First Pharmacy OS](../2.25-compliance-first-ai-native-pharmacy-os/) | **Downstream consumer** | Pharmacy system receives DDI alerts and override decisions; shares drug knowledge base and formulary data |
| [AI Guardrails & Safety System](../3.22-ai-guardrails-safety-system/) | **Safety layer analogue** | Both implement AI output validation, confidence thresholds, and human-in-the-loop patterns for high-stakes AI |
| [ML Models Deployment System](../3.2-ml-models-deployment-system/) | **Model lifecycle infrastructure** | CDSS model registry, versioning, and PCCP-compliant rollout follow MLOps deployment patterns |
| [AI-Native Enterprise Knowledge Graph](../3.32-ai-native-enterprise-knowledge-graph/) | **Knowledge graph patterns** | Drug interaction graph (drugs → ingredients → enzymes → interactions) applies entity-relationship modeling and multi-hop traversal at clinical latency |
| [Identity & Access Management](../2.5-identity-access-management/) | **Authentication foundation** | SMART on FHIR OAuth 2.0 extends standard IAM with healthcare-specific scopes and patient-context launch |
| [RAG System](../3.15-rag-system/) | **Clinical evidence retrieval** | LLM-augmented guideline retrieval uses RAG patterns to surface relevant clinical literature and treatment protocols at point of care |

---

## Emerging Trends (2025-2026)

| Trend | Impact on CDSS | Design Implication |
|-------|---------------|-------------------|
| **LLM-Augmented CDS** | Foundation models summarize clinical evidence and generate natural language explanations alongside SHAP values | Hybrid architecture: deterministic rules for safety-critical DDI + LLM for contextual guideline synthesis |
| **Multimodal Clinical AI** | Models combining structured EHR data with unstructured clinical notes, lab reports, and imaging | Feature engineering pipeline must ingest FHIR resources, CDA documents, and free-text chief complaints |
| **EU AI Act Enforcement (Aug 2026)** | High-risk AI classification triggers mandatory conformity assessments, post-market monitoring, and incident reporting | Dual compliance pipeline (MDR + AI Act) with harmonized technical file and single Notified Body |
| **FDA PCCP Maturation** | More granular pre-authorized change categories with automated validation pipelines | CI/CD for regulated AI: automated performance gates replace manual FDA submissions for approved change types |
| **Federated Learning at Scale** | Privacy-preserving model improvement across hospital networks without centralizing PHI | Secure aggregation protocols, differential privacy budgets, and heterogeneous data handling across institutions |
| **CDS Hooks v2.1 + SMART App Launch v2.0** | Richer hook context with medication administration events and care plan triggers | New hook types (medication-administer, care-plan-review) expand CDS touchpoints beyond prescribing |
| **Clinical Foundation Models** | Domain-specific models (Med-PaLM, BioGPT successors) trained on biomedical corpora | Fine-tuned clinical LLMs for differential diagnosis with built-in medical reasoning chains |
| **Real-World Evidence Integration** | Post-market surveillance using real-world data from deployed CDSS | Closed-loop learning: treatment outcomes feed back into risk models and guideline recommendations |

---

## References

- [CDS Hooks HL7 Specification v2.0](https://cds-hooks.hl7.org/)
- [Clinical Quality Language (CQL) v1.5.3](https://cql.hl7.org/)
- [FDA AI/ML-Based SaMD Action Plan](https://www.fda.gov/medical-devices/software-medical-device-samd)
- [EU MDCG 2025-6: MDR/AI Act Interplay](https://health.ec.europa.eu/medical-devices-sector)
- [DrugBank Drug Interaction Database](https://go.drugbank.com/)
- [ADA Standards of Care 2025](https://diabetesjournals.org/care)
- [PREVENT Cardiovascular Risk Calculator](https://professional.heart.org/)
- [Good Machine Learning Practice for Medical Devices](https://www.fda.gov/medical-devices/software-medical-device-samd/good-machine-learning-practice-medical-device-development-guiding-principles)
- [EU AI Act Official Text (Regulation 2024/1689)](https://eur-lex.europa.eu/eli/reg/2024/1689)
- [SMART App Launch v2.0 Implementation Guide](https://hl7.org/fhir/smart-app-launch/)
- [HL7 FHIR Clinical Reasoning Module](https://hl7.org/fhir/clinicalreasoning-module.html)
