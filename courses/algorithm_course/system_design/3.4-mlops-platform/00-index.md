# MLOps Platform

## Overview

The **MLOps Platform** is an end-to-end infrastructure for managing the machine learning training lifecycle, from experimentation to production-ready model artifacts. It orchestrates training pipelines, tracks experiments with rich metadata, and maintains a versioned model registry with governance capabilities. Unlike serving infrastructure (covered in [3.2 ML Models Deployment System](../3.2-ml-models-deployment-system/00-index.md)), this system focuses on **reproducibility, collaboration, and the iterative nature of ML development**.

**Key Differentiator:** Comprehensive training lifecycle management with pipeline orchestration, experiment tracking supporting 100K+ runs per experiment, and a model registry with atomic alias management (@champion/@production) - enabling data scientists to iterate rapidly while maintaining production-grade governance.

---

## Autonomy Classification

**Tier: B — AI-Augmented**

| Boundary | Description |
|----------|-------------|
| **What AI decides alone** | Hyperparameter search space exploration, experiment metric logging, artifact deduplication, compute resource scheduling for training jobs |
| **What AI recommends** | Best model candidates from experiment runs, early stopping decisions, resource allocation suggestions, feature importance rankings |
| **What requires human approval** | Model promotion to production (@champion alias swap), experiment design and launch, pipeline DAG modifications, governance policy changes, training budget allocation |
| **Deterministic source of truth** | Model registry (versioned artifacts, aliases, stage transitions) and experiment metadata store — automated training produces candidates; data scientists and ML engineers control promotion and governance |
| **Rollback path** | Atomic alias rollback in model registry (@champion repoint to previous version); pipeline checkpoint resume; experiment run replay from stored parameters; artifact restore from versioned storage |

---

## System Characteristics

| Characteristic | Value | Implication |
|----------------|-------|-------------|
| Traffic Pattern | Compute-intensive, bursty (training jobs) | Dynamic resource allocation, job queuing, spot instances |
| Latency Target | N/A (batch processing), <100ms for API | Optimize for throughput, not inference latency |
| Consistency Model | Strong (registry/aliases), Eventual (metrics) | ACID for model governance, buffered metric writes |
| Availability Target | 99.9% platform, jobs have retry/checkpoint | Graceful job recovery, checkpoint resumption |
| Resource Type | GPU/TPU clusters, distributed compute | Heterogeneous scheduling, cost optimization |
| Scale Target | 10K+ concurrent experiments, 100K+ runs | Horizontal scaling, tiered storage |

---

## Complexity Rating

| Component | Rating | Justification |
|-----------|--------|---------------|
| **Overall** | High | Multi-component orchestration + distributed training + metadata management |
| Pipeline Orchestrator | High | DAG scheduling, dependency resolution, distributed execution, checkpointing |
| Model Registry | Medium | Version control, artifact storage, alias management, stage transitions |
| Experiment Tracker | Medium | High-cardinality metrics, flexible schema, comparison tools |
| Feature Store Integration | High | Training-serving skew prevention, point-in-time retrieval |
| Hyperparameter Tuning | High | Search algorithms, early stopping, resource optimization |
| Artifact Storage | Medium | Large file handling, deduplication, lineage tracking |
| Compute Scheduler | High | GPU memory, distributed training, preemptible instances |

---

## Quick Navigation

| Document | Description |
|----------|-------------|
| [01 - Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning, SLOs |
| [02 - High-Level Design](./02-high-level-design.md) | Architecture, data flow, key decisions |
| [03 - Low-Level Design](./03-low-level-design.md) | Data model, APIs, core algorithms |
| [04 - Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | Scheduler, tracker, registry internals |
| [05 - Scalability & Reliability](./05-scalability-and-reliability.md) | Scaling strategy, fault tolerance |
| [06 - Security & Compliance](./06-security-and-compliance.md) | Model governance, access control, compliance |
| [07 - Observability](./07-observability.md) | Metrics, drift detection, alerting |
| [08 - Interview Guide](./08-interview-guide.md) | 45-minute pacing, trap questions, trade-offs |

---

## Core Modules

| Module | Responsibility | Key Challenge |
|--------|----------------|---------------|
| **Pipeline Orchestrator** | DAG execution, scheduling, retries, distributed coordination | Checkpoint recovery, resource-aware placement |
| **Experiment Tracker** | Run logging, metric/artifact storage, comparison | High-cardinality data, flexible GenAI schema |
| **Model Registry** | Version control, aliases, staging workflow | Atomic alias updates, governance enforcement |
| **Artifact Store** | Binary storage, deduplication, CDN | Large files (100GB+ LLMs), efficient retrieval |
| **Metadata Store** | Lineage, parameters, environment capture | Queryable history, reproducibility |
| **Compute Scheduler** | Resource allocation, job placement, preemption | Heterogeneous hardware, cost optimization |
| **Feature Store Connector** | Training-serving consistency, point-in-time joins | Skew prevention, freshness management |

---

## Architecture Overview

```mermaid
flowchart TB
    subgraph Clients["Client Layer"]
        SDK["Python/R SDKs"]
        CLI["CLI Tools"]
        WebUI["Web Dashboard"]
        CICD["CI/CD Systems"]
    end

    subgraph Gateway["API Gateway"]
        RESTAPI["REST API"]
        gRPCAPI["gRPC API"]
        AuthService["Auth Service"]
        RateLimiter["Rate Limiter"]
    end

    subgraph Orchestration["Pipeline Orchestration"]
        DAGParser["DAG Parser"]
        TaskScheduler["Task Scheduler"]
        DependencyResolver["Dependency Resolver"]
        CheckpointManager["Checkpoint Manager"]
    end

    subgraph Executors["Execution Layer"]
        K8sExecutor["Kubernetes Executor"]
        SparkExecutor["Spark Executor"]
        RayExecutor["Ray Executor"]
    end

    subgraph Tracking["Experiment Tracking"]
        TrackingServer["Tracking Server"]
        MetricStore[("Metric Store")]
        ParamStore[("Parameter Store")]
        RunComparator["Run Comparator"]
    end

    subgraph Registry["Model Registry"]
        RegistryAPI["Registry API"]
        VersionManager["Version Manager"]
        AliasManager["Alias Manager"]
        StageController["Stage Controller"]
    end

    subgraph Storage["Storage Layer"]
        ArtifactStorage[("Artifact Storage<br/>Object Store")]
        MetadataDB[("Metadata DB<br/>PostgreSQL")]
        MetricDB[("Metric Store<br/>ClickHouse")]
    end

    subgraph Compute["Compute Infrastructure"]
        GPUPool["GPU Pools"]
        CPUPool["CPU Pools"]
        SpotPool["Spot/Preemptible"]
    end

    Clients --> Gateway
    Gateway --> Orchestration
    Gateway --> Tracking
    Gateway --> Registry

    Orchestration --> Executors
    Executors --> Compute
    Executors --> Tracking

    Tracking --> Storage
    Registry --> Storage

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef storage fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef compute fill:#fffde7,stroke:#f57f17,stroke-width:2px

    class SDK,CLI,WebUI,CICD client
    class RESTAPI,gRPCAPI,AuthService,RateLimiter gateway
    class DAGParser,TaskScheduler,DependencyResolver,CheckpointManager,TrackingServer,RunComparator,RegistryAPI,VersionManager,AliasManager,StageController service
    class ArtifactStorage,MetadataDB,MetricDB,MetricStore,ParamStore storage
    class GPUPool,CPUPool,SpotPool,K8sExecutor,SparkExecutor,RayExecutor compute
```

---

## MLOps Platform vs ML Deployment System

| Aspect | MLOps Platform (This Design) | ML Deployment System (3.2) |
|--------|------------------------------|----------------------------|
| **Focus** | Training lifecycle, experimentation | Inference, real-time serving |
| **Primary Users** | Data scientists, ML engineers | ML engineers, SREs |
| **Latency Requirements** | N/A (batch), <100ms API | <100ms p99 inference |
| **Key Components** | Pipeline orchestrator, experiment tracker, model registry | Inference gateway, A/B router, model server |
| **Resource Optimization** | Training throughput, GPU utilization | Inference latency, dynamic batching |
| **Consistency Priority** | Strong for registry metadata | Eventual for model updates |
| **Scaling Triggers** | Job queue depth, concurrent experiments | QPS, GPU memory utilization |
| **Monitoring Focus** | Job success rate, resource utilization | Latency, prediction drift |

---

## MLOps Maturity Levels

| Level | Description | Platform Capabilities |
|-------|-------------|----------------------|
| **Level 0** | Manual ML | Jupyter notebooks, manual deployment |
| **Level 1** | ML Pipeline | Automated training, basic versioning |
| **Level 2** | CI/CD for ML | Automated testing, model validation |
| **Level 3** | Full MLOps | Continuous training, drift detection, auto-retraining |

This design targets **Level 2-3** capabilities with extensibility for advanced automation.

---

## When to Use This Design

**Use MLOps Platform When:**
- Multiple data scientists collaborating on experiments
- Need reproducibility and auditability
- Complex multi-step training pipelines
- Model governance and approval workflows required
- Hyperparameter tuning at scale
- Integration with feature stores needed
- CI/CD for ML models required

**Do NOT Use When:**
- Single-model, infrequent training (manual suffices)
- No reproducibility requirements
- Real-time inference focus (use 3.2 instead)
- Limited engineering resources for platform ops
- Small scale (<10 experiments/week)

---

## Technology Stack Reference

| Layer | Technology Options | Selection Criteria |
|-------|-------------------|-------------------|
| **Pipeline Orchestration** | Airflow, Dagster, Prefect, Kubeflow Pipelines | Maturity, asset-centric, K8s-native |
| **Experiment Tracking** | MLflow, Weights & Biases, Neptune.ai | Open-source vs managed, scale, UI |
| **Model Registry** | MLflow Registry, Kubeflow Model Registry | Integration, governance features |
| **Artifact Storage** | Object Storage (S3-compatible) | Durability, cost, CDN support |
| **Metadata Database** | PostgreSQL, MySQL | ACID, JSONB support |
| **Metric Storage** | ClickHouse, TimescaleDB, InfluxDB | High-cardinality, query performance |
| **Compute Orchestration** | Kubernetes, Ray, Spark | Distributed training, GPU support |
| **Feature Store** | Feast, Tecton, Hopsworks | Online/offline serving, freshness |

---

## Key Numbers

| Metric | Value | Context |
|--------|-------|---------|
| Pipeline submission latency | <5s | User experience |
| Experiment log write latency | <100ms | Real-time feedback during training |
| Model registry query latency | <200ms | API responsiveness |
| Artifact download throughput | >100MB/s | Large model retrieval |
| Concurrent experiments | 10,000+ | Enterprise scale |
| Runs per experiment | 100,000+ | Hyperparameter sweeps |
| Model versions | 1,000,000+ | Long-term storage |
| Checkpoint interval | 10-30 min | Recovery vs overhead trade-off |
| PSI drift threshold | 0.2 | Training-serving skew detection |

---

## Interview Readiness Checklist

- [ ] Can explain difference between MLOps (training) and ML Deployment (serving)
- [ ] Understand DAG scheduling and topological sort for pipelines
- [ ] Know experiment tracking data model (experiments, runs, metrics, artifacts)
- [ ] Can design model registry with aliases and stage transitions
- [ ] Understand training-serving skew and feature store role
- [ ] Know checkpoint strategies for long-running distributed training
- [ ] Can discuss trade-offs: Git vs custom versioning, YAML vs Python pipelines
- [ ] Understand high-cardinality metric storage challenges
- [ ] Can design for reproducibility (code, data, environment versioning)
- [ ] Know real-world MLOps platforms (Michelangelo, Metaflow, FBLearner)

---

## Real-World References

| Company | System | Key Innovation |
|---------|--------|----------------|
| **Uber** | Michelangelo | End-to-end ML platform, feature store, model serving |
| **Netflix** | Metaflow | Human-centric ML, Python-native, versioned data |
| **Airbnb** | Bighead | Unified training and serving, Zipline feature store |
| **Meta** | FBLearner Flow | Declarative workflows, massive scale (1M+ models) |
| **Google** | TFX / Vertex AI | Pipeline components, managed infrastructure |
| **LinkedIn** | Pro-ML | Feature marketplace, model governance |
| **Spotify** | Luigi + MLflow | Orchestration + tracking combination |
| **DoorDash** | Sibyl | Real-time features, model deployment |

---

## Quick Reference Card

```
+-----------------------------------------------------------------------+
|          MLOPS PLATFORM - QUICK REFERENCE                              |
+-----------------------------------------------------------------------+
|                                                                        |
|  CORE COMPONENTS                   KEY PATTERNS                        |
|  ----------------                  -------------                        |
|  * Pipeline Orchestrator           * DAG-based execution               |
|  * Experiment Tracker              * Immutable run artifacts           |
|  * Model Registry                  * Alias-based deployment            |
|  * Artifact Store                  * Checkpoint recovery               |
|  * Metadata Store                  * Tiered metric storage             |
|  * Compute Scheduler               * Feature store integration         |
|                                                                        |
+-----------------------------------------------------------------------+
|                                                                        |
|  SCALE TARGETS                     LATENCY TARGETS                     |
|  --------------                    ----------------                    |
|  * 10K+ concurrent experiments     * Pipeline submit: <5s              |
|  * 100K+ runs/experiment           * Metric write: <100ms              |
|  * 1M+ model versions              * Registry query: <200ms            |
|  * PB-scale artifact storage       * Artifact download: >100MB/s       |
|  * 99.9% platform availability                                         |
|                                                                        |
+-----------------------------------------------------------------------+
|                                                                        |
|  INTERVIEW KEYWORDS                                                    |
|  ------------------                                                    |
|  DAG orchestration, topological sort, experiment tracking,             |
|  model versioning, alias (@champion), stage transitions,               |
|  training-serving skew, feature store, point-in-time joins,            |
|  checkpoint recovery, distributed training, hyperparameter tuning,     |
|  reproducibility, lineage tracking, GitOps for ML, model governance    |
|                                                                        |
+-----------------------------------------------------------------------+
```

---

## Related Patterns

| Pattern | Relationship | Key Insight |
|---------|-------------|-------------|
| [ML Models Deployment System](../3.2-ml-models-deployment-system/) | **Downstream consumer** | MLOps produces versioned model artifacts; deployment system serves them. Model registry @champion alias is the handoff contract |
| [Netflix Runway Model Lifecycle](../3.7-netflix-runway-model-lifecycle/) | **Reference implementation** | Runway exemplifies model lifecycle management with canary evaluation and automated promotion patterns |
| [Feature Store](../3.16-feature-store/) | **Training data provider** | Feature store provides point-in-time correct features for training; prevents training-serving skew |
| [Open Source ML Platform](../3.10-open-source-ml-platform/) | **Architecture reference** | Open-source platforms (Kubeflow, MLflow) define community-standard APIs and abstractions |
| [Distributed Job Scheduler](../2.6-distributed-job-scheduler/) | **Scheduling foundation** | Pipeline orchestrator extends job scheduling with DAG dependencies, GPU-aware placement, and checkpoint recovery |
| [AI Model Evaluation & Benchmarking](../3.26-ai-model-evaluation-benchmarking-platform/) | **Quality gate** | Evaluation platform validates models before registry promotion; benchmark results feed stage transition governance |
| [LLM Gateway & Prompt Management](../3.21-llm-gateway-prompt-management/) | **LLMOps convergence** | LLM prompt versioning and A/B testing follow similar lifecycle patterns to traditional model versioning |
| [AI Observability & LLMOps](../3.25-ai-observability-llmops-platform/) | **Production monitoring** | LLMOps observability extends MLOps monitoring with token-level metrics, prompt drift, and hallucination detection |

---

## Emerging Trends (2025-2026)

| Trend | Impact on MLOps | Design Implication |
|-------|----------------|-------------------|
| **LLMOps Convergence** | Foundation model fine-tuning, prompt versioning, and adapter management join the MLOps lifecycle | Model registry must handle LoRA adapters, prompt templates, and evaluation datasets as first-class artifacts |
| **GPU Cluster Scheduling** | Multi-tenant GPU clusters with heterogeneous hardware (H100, A100, L4) require topology-aware scheduling | Scheduler must understand NVLink topology, PCIe bandwidth, and network fabric for distributed training placement |
| **Compound AI Systems** | Production ML systems chain multiple models, retrievers, and agents | Pipeline orchestrator must support mixed-modality DAGs with model → retriever → model chains |
| **Continuous Evaluation** | Models evaluated continuously against live data, not just at training time | Evaluation-as-a-service integrated into the model lifecycle with automated retraining triggers |
| **Cost-Aware Training** | GPU costs dominate ML budgets; organizations demand cost attribution and optimization | Per-experiment cost tracking, spot instance orchestration, and training efficiency metrics become core platform features |
| **Reproducibility Standards** | Regulatory requirements (EU AI Act, FDA GMLP) mandate full training reproducibility | Lineage tracking must capture code version, data snapshot, environment hash, and random seeds as atomic units |
| **Multi-Cloud Training** | Organizations distribute training across cloud providers to access GPU capacity | Pipeline orchestrator must support cross-cloud execution with unified artifact storage and metric collection |

---

## Related Systems (Legacy Links)

- [3.5 Uber Michelangelo](../3.5-uber-michelangelo-ml-platform/) - Uber's ML platform case study
- [3.6 Netflix Metaflow](../3.6-netflix-metaflow-ml-workflow-platform/) - Netflix's ML workflow platform
- [1.5 Distributed Log-Based Broker](../1.5-distributed-log-based-broker/) - Event streaming for ML events
