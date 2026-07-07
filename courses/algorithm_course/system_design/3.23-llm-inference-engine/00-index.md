# LLM Inference Engine

## Overview

An **LLM Inference Engine** is the core runtime component that executes large language model inference on GPU hardware. It sits between the serving infrastructure (API gateways, load balancers) and the low-level GPU kernels (Flash Attention, CUDA/Tensor Cores), responsible for **scheduling requests**, **managing KV cache memory**, and **orchestrating model execution** to maximize throughput while meeting latency SLOs.

**Key Differentiator from 3.13 (LLM Training & Inference Architecture):** This document focuses DEEPLY on inference engine internals—how schedulers make iteration-level decisions, how PagedAttention allocates memory blocks, and how speculative decoding verifies draft tokens. The 3.13 document covers high-level training/inference concepts; this document provides implementation-level detail for building or understanding production inference engines.

**Key Differentiator from 3.21 (LLM Gateway):** The Gateway layer handles routing, caching, rate limiting, and multi-provider abstraction ABOVE the inference engine. This document covers what happens INSIDE a single inference engine instance.

---

## Autonomy Classification

**Tier: D — AI-Autonomous**

This is an **AI-autonomous system** operating within a sandboxed environment. AI drives core decision-making and execution autonomously, with hard boundaries preventing cross-system effects. Human supervisors monitor via dashboards and can intervene through circuit-breaker controls. The inference engine autonomously manages model serving, batching, scheduling, and hardware utilization within its resource sandbox.

| Boundary | AI Role | Human/System Authority |
|----------|---------|----------------------|
| **System of Record** | AI manages its own operational state within sandbox boundaries | Sandboxed state store |
| **System of Intelligence** | Autonomous decision-making, planning, and execution with self-correction loops | AI core with feedback loops |
| **Action Boundary** | Full autonomy within sandbox; hard limits prevent cross-boundary blast radius | Sandbox boundary enforcement |
| **Human Override** | ML platform team monitors via dashboard; circuit-breakers pause serving on anomaly detection | Domain expert |
| **Rollback Path** | Sandbox isolation contains blast radius; full state replay and checkpoint recovery available | Checkpoint + replay infrastructure |

---


## System Stack Positioning

```mermaid
flowchart TB
    subgraph ApplicationLayer["Application Layer"]
        App["Applications<br/>(Chatbots, Agents, RAG)"]
    end

    subgraph GatewayLayer["Gateway Layer (3.21)"]
        Gateway["LLM Gateway<br/>(Routing, Caching, Rate Limiting)"]
    end

    subgraph EngineLayer["Inference Engine Layer (THIS DOC)"]
        Scheduler["Continuous Batching<br/>Scheduler"]
        KVManager["KV Cache<br/>Manager"]
        Executor["Model<br/>Executor"]
    end

    subgraph KernelLayer["Kernel Layer"]
        FlashAttn["Flash Attention"]
        Quant["Quantized MatMul"]
        Comm["NCCL Communication"]
    end

    subgraph HardwareLayer["Hardware Layer"]
        GPU["GPU / TPU"]
    end

    App --> Gateway
    Gateway --> EngineLayer
    Scheduler --> KVManager
    KVManager --> Executor
    Executor --> KernelLayer
    KernelLayer --> GPU

    classDef app fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef engine fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef kernel fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef hardware fill:#fffde7,stroke:#f57f17,stroke-width:2px

    class App app
    class Gateway gateway
    class Scheduler,KVManager,Executor engine
    class FlashAttn,Quant,Comm kernel
    class GPU hardware
```

---

## Quick Navigation

| Document | Description |
|----------|-------------|
| [01 - Requirements & Estimations](./01-requirements-and-estimations.md) | Functional/non-functional requirements, capacity planning, memory math |
| [02 - High-Level Design](./02-high-level-design.md) | Architecture diagrams, data flow, framework-specific designs |
| [03 - Low-Level Design](./03-low-level-design.md) | Data structures, algorithms (Step-by-step plan in plain English), API specifications |
| [04 - Deep Dive & Bottlenecks](./04-deep-dive-and-bottlenecks.md) | PagedAttention internals, disaggregated serving, speculative decoding |
| [05 - Scalability & Reliability](./05-scalability-and-reliability.md) | Scaling strategies, tensor parallelism, fault tolerance |
| [06 - Security & Compliance](./06-security-and-compliance.md) | Memory isolation, weight protection, DoS prevention |
| [07 - Observability](./07-observability.md) | Metrics, tracing, debugging, alerting |
| [08 - Interview Guide](./08-interview-guide.md) | 45-minute pacing, trap questions, key numbers |

---

## Complexity Rating

| Component | Rating | Justification |
|-----------|--------|---------------|
| **Overall** | **Very High** | Combines OS-style memory management, GPU kernel optimization, and real-time scheduling |
| PagedAttention Memory Manager | Very High | Non-contiguous allocation with copy-on-write, reference counting |
| Continuous Batching Scheduler | High | Iteration-level decisions, preemption, priority queues |
| Speculative Decoding | High | Probability matching, draft-verify pipeline, variable acceptance |
| Prefix Caching (RadixAttention) | High | Hash-based matching, reference counting, eviction policies |
| Quantization Pipeline | Medium-High | Calibration, per-channel scaling, kernel integration |
| Multi-GPU Coordination | High | Tensor/pipeline parallelism, NCCL synchronization |
| CUDA Graph Optimization | Medium | Graph capture, fixed batch sizes, fallback logic |

---

## Framework Comparison Matrix (2025-2026)

| Framework | Developer | Primary Innovation | Language | Best For |
|-----------|-----------|-------------------|----------|----------|
| **vLLM V1** | vLLM Team | PagedAttention, V1 zero-overhead engine | Python + CUDA | High-throughput serving, general purpose |
| **TensorRT-LLM** | NVIDIA | TensorRT optimization, FP8/FP4 | C++ + Python | Lowest latency on NVIDIA hardware |
| **SGLang** | UC Berkeley | RadixAttention, Zero-overhead batch scheduler | Python + CUDA | Multi-turn conversations, shared prefixes |
| **NVIDIA Dynamo** | NVIDIA | Disaggregated serving orchestration | Python + C++ | Multi-node inference orchestration |
| **TGI** | HuggingFace | Flash-decoding, Rust HTTP layer | Rust + Python | HuggingFace ecosystem integration |
| **LMDeploy** | InternLM / SenseTime | TurboMind engine, persistent batch | Python + CUDA | InternLM models, Chinese LLM ecosystem |
| **llama.cpp** | ggml-org | GGUF format, CPU/Metal support | C++ | Edge deployment, consumer hardware |

### 2025-2026 Key Developments

| Development | Framework | Impact |
|-------------|-----------|--------|
| **V1 Architecture** | vLLM | Major refactor: zero-overhead scheduler overlaps with GPU execution; unified prefix caching; 1.7x throughput improvement |
| **Zero-Overhead Batch Scheduler** | SGLang | Scheduling runs in parallel with GPU computation; eliminates CPU-GPU serialization gap |
| **NVIDIA Dynamo** | NVIDIA (open-source) | Orchestration layer for disaggregated prefill/decode across nodes; smart routing with KV cache transfer |
| **Multi-Head Latent Attention** | DeepSeek-V2/V3 | 10-20x KV cache compression at model architecture level; changes capacity planning fundamentals |
| **Expert Parallelism** | vLLM, SGLang, TRT-LLM | Specialized parallelism for MoE models (DeepSeek-V3, Mixtral); all-to-all token routing |
| **FP4/NVFP4 Quantization** | TensorRT-LLM | Blackwell-native 4-bit inference; 2x capacity over FP8 with minimal quality loss |
| **Prefix-Aware Scheduling** | SGLang, Dynamo | Routes requests by prefix hash to maximize cache hits; 60-80% hit rate vs 30-50% passive |

### Performance Benchmarks (H100 80GB, Llama-2 70B INT8)

| Framework | Throughput (tokens/s) | TTFT (1K prompt) | TPS/request | Memory Efficiency |
|-----------|----------------------|------------------|-------------|-------------------|
| vLLM V1 | 55,000 | 88ms | 70 | 95% block utilization |
| TensorRT-LLM | 58,000 | 82ms | 72 | 91% (static allocation) |
| SGLang v0.4+ | 57,000 | 85ms | 71 | 96% (radix caching) |
| TGI v3.0 | 48,000 | 110ms | 62 | 90% |
| LMDeploy | 50,000 | 92ms | 65 | 93% |

*Benchmarks vary based on workload characteristics. Numbers represent typical high-throughput scenarios.*

---

## Core Concepts

### Why LLM Inference is Memory-Bound (Not Compute-Bound)

```
Decode Phase Analysis (70B model, batch=1):
─────────────────────────────────────────────
Model weights to read:    70 GB (INT8)
Compute operations:       ~140 GFLOPs (2 * 70B)
H100 memory bandwidth:    3.35 TB/s
H100 FP8 compute:         1,979 TFLOPS

Memory time: 70 GB / 3.35 TB/s = 21ms
Compute time: 140 GFLOPs / 1979 TFLOPS = 0.07ms

Ratio: Memory-bound by ~300x

→ Optimization focus: Increase batch size to amortize weight reads
→ With batch=8: Same 21ms produces 8 tokens = 380 TPS
```

### Key Innovation: PagedAttention

Traditional KV cache allocates contiguous memory for maximum sequence length:
- 4K max context → 4K tokens allocated per request
- 500 avg context → 87.5% memory waste

PagedAttention (vLLM) uses OS-style paging:
- Fixed-size blocks (16 tokens each)
- Allocate on demand as tokens generate
- Near-zero waste (<5% fragmentation)
- Result: **4-10x more concurrent requests**

### Key Innovation: Continuous Batching

Static batching waits for all requests in batch to complete:
- Problem 1: Short sequences wait for long sequences (head-of-line blocking)
- Problem 2: Padding waste for variable-length sequences

Continuous batching operates at iteration level:
- Every decode step: remove finished sequences, add waiting sequences
- No padding, no blocking
- Result: **2-3x throughput improvement**

---

## System Characteristics

| Characteristic | Value | Notes |
|----------------|-------|-------|
| **Traffic Pattern** | Bursty, variable sequence lengths | Enterprise: predictable; Consumer: highly variable |
| **Primary Slowest part of the process** | GPU memory bandwidth | Decode phase is memory-bound |
| **Secondary Slowest part of the process** | GPU compute | Prefill phase is compute-bound |
| **Latency Target (TTFT)** | < 200ms p99 | Time to first token |
| **Latency Target (TPS)** | > 50 tokens/sec | Per-request generation speed |
| **Consistency Model** | N/A (stateless) | Each request independent |
| **Availability Target** | 99.9% | Request success rate |
| **Memory Pattern** | Dynamic allocation (PagedAttention) | Block-based KV cache |
| **Scale Unit** | GPU instances | TP for large models, DP for throughput |

---

## When to Use Each Framework

```mermaid
flowchart TD
    Start["Select Inference Engine"] --> Q1{"Target Hardware?"}

    Q1 -->|"NVIDIA Data Center<br/>(H100, A100)"| Q2{"Priority?"}
    Q1 -->|"Consumer GPU<br/>(RTX 4090)"| Q3{"Framework Preference?"}
    Q1 -->|"Apple Silicon<br/>CPU Only"| llama["llama.cpp"]

    Q2 -->|"Lowest Latency"| TRT["TensorRT-LLM"]
    Q2 -->|"Highest Throughput"| Q4{"Workload Type?"}
    Q2 -->|"Balanced"| vllm1["vLLM"]

    Q4 -->|"Multi-turn Chat<br/>Shared Prefixes"| SGLang["SGLang"]
    Q4 -->|"Single-turn<br/>Diverse Prompts"| vllm2["vLLM"]

    Q3 -->|"HuggingFace<br/>Ecosystem"| TGI["TGI"]
    Q3 -->|"Chinese LLMs<br/>InternLM"| LMDeploy["LMDeploy"]
    Q3 -->|"General Purpose"| vllm3["vLLM"]

    classDef decision fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef framework fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px

    class Q1,Q2,Q3,Q4 decision
    class TRT,SGLang,vllm1,vllm2,vllm3,TGI,LMDeploy,llama framework
```

### Decision Matrix

| Scenario | Recommended | Reason |
|----------|-------------|--------|
| Lowest possible latency on NVIDIA | TensorRT-LLM | TensorRT compiler optimizations, FP8 |
| Maximum throughput, general workload | vLLM | PagedAttention, continuous batching |
| Multi-turn chat, RAG with long system prompts | SGLang | RadixAttention prefix caching |
| HuggingFace model, quick deployment | TGI | Native HF integration, Docker images |
| Edge deployment, MacBook, mobile | llama.cpp | GGUF quantization, Metal support |
| Disaggregated prefill/decode | SGLang or NVIDIA Dynamo | First-class P/D disaggregation support |

---

## Key Numbers Reference Card

```
┌─────────────────────────────────────────────────────────────────────┐
│           LLM INFERENCE ENGINE - KEY NUMBERS                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  MEMORY REQUIREMENTS                                                │
│  ───────────────────                                                │
│  Model weights (70B FP16):     140 GB                               │
│  Model weights (70B INT8):      70 GB                               │
│  Model weights (70B INT4):      35 GB                               │
│                                                                     │
│  KV CACHE PER TOKEN                                                 │
│  ──────────────────                                                 │
│  Formula: 2 × layers × kv_heads × head_dim × 2 bytes                │
│  Llama-2 70B: 2 × 80 × 8 × 128 × 2 = 327,680 bytes ≈ 320 KB        │
│  Llama-3 405B: ~1.2 MB per token                                    │
│                                                                     │
│  BLOCK SIZE                                                         │
│  ──────────────                                                     │
│  vLLM default:     16 tokens per block                              │
│  TensorRT-LLM:     Variable (power of 2)                            │
│  SGLang:           16 tokens (radix tree aligned)                   │
│                                                                     │
│  PERFORMANCE TARGETS                                                │
│  ───────────────────                                                │
│  TTFT (p99):           < 200ms                                      │
│  TPS per request:      > 50 tokens/sec                              │
│  Throughput (70B H100): 50,000+ tokens/sec                          │
│                                                                     │
│  OPTIMIZATION FACTORS                                               │
│  ────────────────────                                               │
│  PagedAttention overhead:      ~5% latency                          │
│  PagedAttention savings:       60-95% memory                        │
│  Speculative decoding speedup: 2-3x                                 │
│  CUDA graph overhead:          50μs (vs 500μs Python)               │
│  Prefix cache hit rate:        30-50% (typical workloads)           │
│                                                                     │
│  HARDWARE REFERENCE (H100 SXM)                                      │
│  ─────────────────────────────                                      │
│  Memory:           80 GB HBM3                                       │
│  Bandwidth:        3.35 TB/s                                        │
│  FP8 Compute:      1,979 TFLOPS                                     │
│  NVLink:           900 GB/s                                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Production Deployment Patterns

| Pattern | Description | When to Use |
|---------|-------------|-------------|
| **Single-Instance vLLM** | One engine per model, continuous batching | Simple deployment, moderate scale |
| **Multi-Instance + Load Balancer** | Multiple engines behind LOR balancer | High availability, horizontal scaling |
| **Tensor Parallel (TP)** | Model sharded across GPUs in one node | Large models (>80GB), latency-sensitive |
| **Pipeline Parallel (PP)** | Model layers distributed across nodes | Very large models (>300GB) |
| **Disaggregated P/D** | Separate prefill and decode workers | Maximum throughput, variable latency OK |
| **Speculative Decoding** | Draft model + target model | Latency-sensitive, good draft model available |

---

## Real-World References

| Company | Inference Stack | Key Innovation | Scale |
|---------|----------------|----------------|-------|
| **OpenAI** | Custom serving | Undisclosed optimizations, disaggregated P/D | Millions of requests/day |
| **Anthropic** | Custom serving | Constitutional AI safety checks, custom scheduling | Enterprise scale |
| **DeepSeek** | Custom (open-sourced) | MLA for 10-20x KV compression, FP8 training, MoE expert parallelism | Open-weight 671B model |
| **Fireworks AI** | FireAttention (proprietary) | 10T+ tokens/day, speculative + disaggregated | 10,000+ customers |
| **Together AI** | vLLM-based + custom | 200+ models, prefix-aware routing | Large-scale inference |
| **Anyscale** | Ray Serve + vLLM | Wide-EP, disaggregated serving | Enterprise |
| **Groq** | LPU hardware | Custom silicon for inference, deterministic latency | Fastest single-request latency |
| **Cerebras** | Wafer-Scale Engine | On-chip SRAM eliminates memory-bandwidth Slowest part of the process | 900+ tokens/sec per request |

### Hardware Evolution (2025-2026)

| GPU | Memory | Bandwidth | FP8 TFLOPS | Key Feature |
|-----|--------|-----------|------------|-------------|
| **H100 SXM** | 80 GB HBM3 | 3.35 TB/s | 1,979 | Current workhorse |
| **H200** | 141 GB HBM3e | 4.8 TB/s | 1,979 | 1.76x KV cache capacity |
| **B200** | 192 GB HBM3e | 8 TB/s | 4,500 | FP4 native, 2.4x bandwidth |
| **GB200 (Grace-Blackwell)** | 384 GB (2×B200) | 16 TB/s | 9,000 | CPU-GPU unified, NVLink 1.8 TB/s |

*Blackwell's 2.4x bandwidth improvement directly translates to 2.4x decode throughput for memory-bound workloads.*

---

## Interview Readiness Checklist

- [ ] Can explain why LLM inference is memory-bound, not compute-bound
- [ ] Understand PagedAttention: blocks, tables, copy-on-write, ref counting
- [ ] Know continuous batching vs static batching trade-offs
- [ ] Can design KV cache memory manager with allocation algorithm
- [ ] Understand speculative decoding: draft, verify, accept/reject
- [ ] Know when speculative decoding helps vs hurts (temperature sensitivity)
- [ ] Can explain tensor parallelism vs pipeline parallelism
- [ ] Understand prefix caching and RadixAttention
- [ ] Know key numbers: KV per token, block size, TTFT targets
- [ ] Can discuss disaggregated prefill/decode architecture

---

## Related Systems

| Topic | Relevance |
|-------|-----------|
| [3.13 LLM Training & Inference Architecture](../3.13-llm-training-inference-architecture/00-index.md) | High-level training/inference concepts; model architecture choices that affect inference (MoE, GQA, MLA) |
| [3.21 LLM Gateway / Prompt Management](../3.21-llm-gateway-prompt-management/00-index.md) | Gateway layer above inference engine; routing, semantic caching, multi-provider abstraction |
| [3.14 Vector Database](../3.14-vector-database/00-index.md) | Embedding storage for RAG pipelines that feed prompts into the inference engine |
| [3.22 AI Guardrails & Safety](../3.22-ai-guardrails-safety-system/00-index.md) | Safety layer integration; pre/post-processing guards that wrap engine calls |
| [2.13 Edge AI/ML Inference](../2.13-edge-ai-ml-inference/00-index.md) | On-device inference patterns; llama.cpp, GGUF quantization, mobile deployment |
| [3.24 Multi-Agent Orchestration Platform](../3.24-multi-agent-orchestration-platform/00-index.md) | Agent systems that issue many concurrent inference calls with tool-use patterns |
| [1.9 Consistent Hashing Ring](../1.9-consistent-hashing-ring/00-index.md) | Prefix-aware load balancing uses consistent hashing to route requests by prefix hash |
| [2.2 Container Orchestration System](../2.2-container-orchestration-system/00-index.md) | GPU scheduling, resource quotas, and autoscaling for inference workloads |

---

> **Vendor-Reference Freshness Notice:** This document references specific vendor products and frameworks that evolve rapidly. Vendor comparisons, feature matrices, and benchmark numbers were current as of the document's last update. Before making architectural decisions based on vendor capabilities, verify current pricing, features, and availability directly with vendors. Last verified: 2025-Q4.
