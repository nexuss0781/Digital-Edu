# Open-Source End-to-End ML Platform

## Autonomy Classification

| Dimension | Details |
|-----------|---------|
| **Tier** | **B -- AI-Augmented** |
| **What AI decides autonomously** | Model serving auto-scaling thresholds, feature transformation suggestions, training hyperparameter tuning, pipeline retry scheduling, data drift alert suppression |
| **What AI recommends (human approves)** | Model promotion to production, feature store schema changes, pipeline DAG modifications, A/B test traffic allocation, monitoring alert rules |
| **What requires human judgment** | Production model rollback decisions, Kubernetes infrastructure changes, data access policy updates, cost budget allocation, new tool adoption into the platform stack |
| **Escalation trigger** | Model accuracy drops below SLO threshold, feature pipeline failure rate > 5%, training job cost exceeds budget by 20%, security scan flags dependency vulnerability |

> **Rationale:** An open-source ML platform handles routine operational decisions (scaling, retries, hyperparameter search) autonomously, but model promotion and infrastructure changes carry production risk that warrants human approval gates.

---

## System Overview

An **Open-Source End-to-End ML Platform** is a production-grade machine learning infrastructure built by composing best-of-breed open-source tools rather than adopting a monolithic platform. This architecture enables organizations to build, train, deploy, and monitor ML models at scale while maintaining vendor independence, flexibility, and cost efficiency.

The platform integrates **MLflow** for experiment tracking and model registry, **Feast** for feature management, **KServe** for model serving, **Airflow/Prefect** for pipeline orchestration, and **Prometheus/Grafana** with **Evidently AI** for monitoring—all running natively on Kubernetes.

---

## Key Characteristics

| Characteristic | Description |
|----------------|-------------|
| **Architecture Style** | Modular, best-of-breed OSS composition |
| **Deployment Model** | Kubernetes-native, cloud-agnostic |
| **Primary Pattern** | Feature store-centric with train-serve consistency |
| **Workload Type** | Mixed (training pipelines + real-time inference + batch scoring) |
| **Scale Target** | 10K+ models, 100K+ features, 1M+ predictions/day |
| **Complexity Rating** | **Very High** |

---

## Core Component Stack

| Layer | Component | Purpose | Alternatives |
|-------|-----------|---------|--------------|
| **Experiment Tracking** | MLflow 3.x | Experiments, metrics, artifacts, GenAI tracing | Weights & Biases, Neptune |
| **Model Registry** | MLflow Registry | Model versioning, staging, governance | Seldon, custom registry |
| **Feature Store** | Feast | Feature management, online/offline serving | Tecton, Hopsworks |
| **Model Serving** | KServe | Serverless inference, auto-scaling, LLM support | Seldon Core, BentoML |
| **Pipeline Orchestration** | Airflow 3.x | DAG-based workflows, event-driven scheduling | Prefect 3.x, Dagster |
| **Distributed Training** | KubeRay | Ray clusters on Kubernetes | Kubeflow Training Operator |
| **Monitoring** | Prometheus + Grafana | Metrics collection, visualization, alerting | Datadog, New Relic |
| **Drift Detection** | Evidently AI | Data drift, model performance monitoring | WhyLabs, Fiddler |

---

## Quick Navigation

| Document | Description |
|----------|-------------|
| [01 - Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning, SLOs |
| [02 - High-Level Design](./02-high-level-design.md) | Architecture diagrams, data flows, key decisions |
| [03 - Low-Level Design](./03-low-level-design.md) | Data models, API design, algorithms |
| [04 - Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Feast, KServe, MLflow internals, Slowest part of the process analysis |
| [05 - Scalability & Reliability](./05-scalability-and-reliability.md) | Scaling strategies, fault tolerance, disaster recovery |
| [06 - Security & Compliance](./06-security-and-compliance.md) | AuthN/AuthZ, encryption, ML governance, EU AI Act |
| [07 - Observability](./07-observability.md) | Metrics, logging, tracing, drift detection, alerting |
| [08 - Interview Guide](./08-interview-guide.md) | 45-min strategy, trap questions, trade-offs, quick reference |

---

## Why Open-Source Composition?

### The Monolithic vs Modular Decision

| Approach | Pros | Cons |
|----------|------|------|
| **Monolithic (Kubeflow/SageMaker)** | Integrated experience, single vendor support | Vendor lock-in, all-or-nothing adoption, slower updates |
| **Modular OSS Composition** | Best-of-breed tools, no lock-in, community-driven innovation | Integration complexity, more ops overhead |

### When to Choose OSS Composition

- **Strong platform engineering team** with Kubernetes expertise
- **Diverse ML workloads** (traditional ML, deep learning, LLMs)
- **Regulatory requirements** demanding data sovereignty
- **Cost optimization** priority over managed services
- **Multi-cloud or hybrid** deployment requirements

---

## Architecture at a Glance

```mermaid
flowchart TB
    subgraph Client["Client Layer"]
        SDK[Python SDK]
        CLI[CLI Tools]
        UI[Web UIs]
    end

    subgraph Orchestration["Orchestration Layer"]
        Airflow[Airflow 3.x]
        KubeRay[KubeRay]
    end

    subgraph MLLifecycle["ML Lifecycle Layer"]
        MLflow[MLflow 3.x]
        Feast[Feast Feature Store]
    end

    subgraph Serving["Serving Layer"]
        KServe[KServe]
        FeatureServer[Feature Server]
    end

    subgraph Infrastructure["Infrastructure Layer"]
        K8s[Kubernetes]
        Storage[Object Storage]
        Redis[Redis]
        Postgres[PostgreSQL]
    end

    subgraph Monitoring["Monitoring Layer"]
        Prometheus[Prometheus]
        Grafana[Grafana]
        Evidently[Evidently AI]
    end

    SDK --> MLflow
    SDK --> Feast
    CLI --> Airflow
    UI --> MLflow
    UI --> Grafana

    Airflow --> MLflow
    Airflow --> KubeRay
    KubeRay --> Feast

    MLflow --> Storage
    MLflow --> Postgres
    Feast --> Redis
    Feast --> Storage

    KServe --> FeatureServer
    KServe --> MLflow
    FeatureServer --> Redis

    Prometheus --> KServe
    Prometheus --> Feast
    Evidently --> Prometheus
    Grafana --> Prometheus

    KServe --> K8s
    Airflow --> K8s

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef orchestration fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef lifecycle fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef serving fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    classDef infra fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef monitoring fill:#fffde7,stroke:#f57f17,stroke-width:2px

    class SDK,CLI,UI client
    class Airflow,KubeRay orchestration
    class MLflow,Feast lifecycle
    class KServe,FeatureServer serving
    class K8s,Storage,Redis,Postgres infra
    class Prometheus,Grafana,Evidently monitoring
```

---

## Component Version Matrix (2025-2026)

| Component | Recommended Version | Key Features Used |
|-----------|---------------------|-------------------|
| **MLflow** | 3.x | LoggedModel, GenAI tracing, LLM evaluation |
| **Feast** | 0.40+ | Stream feature views, on-demand transforms |
| **KServe** | 0.15+ | ModelMesh, InferenceGraph, LLM serving |
| **Airflow** | 3.x | Assets, event-driven scheduling |
| **Ray** | 2.x | Distributed training, KubeRay operator |
| **Kubernetes** | 1.28+ | Gateway API, GPU scheduling |
| **Prometheus** | 2.x | Remote write, exemplars |
| **Evidently** | 0.5+ | Test suites, monitoring dashboards |

---

## Platform Capabilities Matrix

| Capability | Component | Maturity |
|------------|-----------|----------|
| **Experiment Tracking** | MLflow Tracking | Production |
| **Model Registry** | MLflow Model Registry | Production |
| **Feature Management** | Feast | Production |
| **Online Feature Serving** | Feast Feature Server | Production |
| **Batch Scoring** | KServe + Airflow | Production |
| **Real-time Inference** | KServe | Production |
| **LLM Serving** | KServe + vLLM | GA (2025) |
| **Distributed Training** | KubeRay | Production |
| **Pipeline Orchestration** | Airflow | Production |
| **Data Drift Detection** | Evidently AI | Production |
| **GenAI Tracing** | MLflow Tracing | GA (2025) |

---

## Comparison with Proprietary Platforms

| Feature | OSS Composition | Kubeflow | SageMaker | Vertex AI |
|---------|-----------------|----------|-----------|-----------|
| **Vendor Lock-in** | None | Low | High | High |
| **Setup Complexity** | High | Medium | Low | Low |
| **Flexibility** | Maximum | High | Medium | Medium |
| **Cost Control** | Full | Full | Limited | Limited |
| **Community Support** | Excellent | Good | N/A | N/A |
| **GenAI Support** | Excellent | Good | Good | Excellent |
| **Multi-cloud** | Native | Yes | No | No |

---

## Real-World Adoption

| Company | Stack | Scale |
|---------|-------|-------|
| **Uber** | Ray + Kubernetes (migrated 2024) | 1.5-4x training speedup |
| **Lyft** | Hybrid (K8s serving + SageMaker training) | Millions predictions/sec |
| **Spotify** | Ray + custom orchestration | 42K+ pipelines |
| **Instacart** | Feast + custom serving | Production feature store |
| **Twilio** | Feast + MLflow | Feature management |

---

## Key Design Principles

1. **Feature Store-Centric**: Feast as the foundation for train-serve consistency
2. **Kubernetes-Native**: All components deploy as K8s resources
3. **GitOps-Ready**: Infrastructure and ML artifacts version-controlled
4. **Composable**: Swap components without platform rewrite
5. **Observable**: Metrics, logs, traces from every component
6. **Secure by Default**: RBAC, encryption, audit logging built-in

---

## Document Sections Summary

| Section | Key Topics | Pages |
|---------|------------|-------|
| **Requirements** | FR/NFR, capacity planning, SLOs | ~15 |
| **High-Level Design** | 5-layer architecture, data flows | ~20 |
| **Low-Level Design** | Schemas, APIs, algorithms | ~25 |
| **Deep Dives** | Feast, KServe, MLflow internals | ~25 |
| **Scalability** | Auto-scaling, DR, multi-region | ~18 |
| **Security** | AuthN/AuthZ, governance, compliance | ~15 |
| **Observability** | Metrics, drift, alerting | ~20 |
| **Interview Guide** | Pacing, traps, quick reference | ~18 |

---

## 2025-2026 Platform Evolution

### Key Component Updates

| Component | 2025-2026 Evolution | Impact |
|-----------|---------------------|--------|
| **MLflow 3.x** | LoggedModel entity, GenAI tracing, LLM-as-judge evaluation, Deployments Server (AI Gateway) | First-class LLM lifecycle support |
| **Feast** | Vector similarity search for RAG, push sources for real-time, RBAC/permissions framework | Feature store → AI feature platform |
| **KServe** | vLLM/TensorRT-LLM runtimes, Open Inference Protocol v2, GPU-aware autoscaling | Native LLM serving at scale |
| **Airflow 3.x** | Assets (dataset-driven scheduling), multi-tenant architecture, deferrable operators | Event-driven ML pipelines |
| **Ray 2.x** | KubeRay operator maturity, distributed training improvements, Ray Serve for inference | Unified compute fabric |

### Emerging OSS Tools

| Tool | Category | Why It Matters |
|------|----------|---------------|
| **vLLM** | LLM Inference | PagedAttention for high-throughput LLM serving; de facto standard |
| **Flyte** | ML Orchestration | Strong typing, immutable executions; modern alternative to Airflow for ML |
| **BentoML** | Model Packaging | OCI-compatible container packaging; simplified model deployment |
| **LiteLLM** | LLM Gateway | Unified proxy for 100+ LLM providers behind OpenAI-compatible API |
| **Langfuse** | LLM Observability | Open-source tracing and evaluation for LLM applications |

---

## Related Systems

| System | Relationship |
|--------|--------------|
| [3.2 ML Model Deployment System](../3.2-ml-models-deployment-system/00-index.md) | Model serving and deployment patterns this platform implements |
| [3.7 Netflix Runway Model Lifecycle](../3.7-netflix-runway-model-lifecycle/00-index.md) | Enterprise model lifecycle management patterns |
| [3.16 Feature Store](../3.16-feature-store/00-index.md) | Deep dive into feature store architecture (Feast is a component here) |
| [3.25 AI Observability & LLMOps Platform](../3.25-ai-observability-llmops-platform/00-index.md) | LLM observability patterns complementing MLflow Tracing |
| [3.21 LLM Gateway & Prompt Management](../3.21-llm-gateway-prompt-management/00-index.md) | MLflow Deployments Server implements this pattern |
| [3.24 Multi-Agent Orchestration Platform](../3.24-multi-agent-orchestration-platform/00-index.md) | Agent orchestration that consumes models deployed via this platform |
| [2.5 Identity & Access Management](../2.5-identity-access-management/00-index.md) | Authentication and authorization for multi-tenant ML platform |
| [15.1 Metrics & Monitoring System](../15.1-metrics-monitoring-system/00-index.md) | Prometheus/Grafana monitoring infrastructure used by the platform |

---

## References

- [MLflow 3.0 Documentation](https://mlflow.org/docs/latest/)
- [Feast Feature Store](https://feast.dev/)
- [KServe Documentation](https://kserve.github.io/website/)
- [Apache Airflow 3.0](https://airflow.apache.org/)
- [Ray on Kubernetes](https://docs.ray.io/en/latest/cluster/kubernetes/)
- [Evidently AI](https://www.evidentlyai.com/)
- [Kubeflow Architecture](https://www.kubeflow.org/docs/started/architecture/)
- [vLLM Documentation](https://docs.vllm.ai/)
- [Flyte Documentation](https://docs.flyte.org/)
- [BentoML Documentation](https://docs.bentoml.com/)

---

> **Vendor Freshness Notice:** This document references specific vendor products and model names (MLflow, Feast, KServe, Airflow, vLLM, Ray, BentoML, LiteLLM, Langfuse, Evidently AI, Kubeflow, etc.). The AI/ML tooling landscape evolves rapidly. Verify vendor capabilities, pricing, and API compatibility against official documentation before making architectural decisions. Last reviewed: 2026-03.
