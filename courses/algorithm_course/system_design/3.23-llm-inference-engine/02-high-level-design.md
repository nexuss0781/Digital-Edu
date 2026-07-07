# High-Level Design

## System Architecture

An LLM Inference Engine consists of three core subsystems working together to serve requests efficiently:

1. **Scheduler**: Manages request queues, batching decisions, and preemption
2. **Memory Manager**: Allocates/deallocates KV cache blocks, handles prefix caching
3. **Executor**: Runs model forward passes, coordinates multi-GPU execution

```mermaid
flowchart TB
    subgraph ExternalInterface["External Interface"]
        API["API Server<br/>(HTTP/gRPC)"]
        Tokenizer["Tokenizer"]
    end

    subgraph Scheduler["Scheduler Subsystem"]
        WaitQueue["Waiting Queue"]
        RunBatch["Running Batch"]
        SwapQueue["Swap Queue"]
        Policy["Scheduling Policy<br/>(FCFS / Priority)"]
    end

    subgraph MemoryManager["Memory Manager Subsystem"]
        BlockAlloc["Block Allocator"]
        BlockTable["Block Table Manager"]
        PrefixCache["Prefix Cache<br/>(RadixTree)"]
        SwapCtrl["Swap Controller"]
    end

    subgraph Executor["Executor Subsystem"]
        PrefillExec["Prefill Executor"]
        DecodeExec["Decode Executor"]
        SpecExec["Speculative Executor"]
        AttnBackend["Attention Backend<br/>(Flash Attention)"]
    end

    subgraph GPUMemory["GPU Memory"]
        Weights["Model Weights"]
        KVPool["KV Cache Pool"]
        Activations["Activation Buffers"]
    end

    API --> Tokenizer
    Tokenizer --> WaitQueue
    WaitQueue --> Policy
    Policy --> BlockAlloc
    Policy --> RunBatch

    RunBatch --> PrefillExec
    RunBatch --> DecodeExec

    BlockAlloc --> BlockTable
    BlockTable --> KVPool
    PrefixCache --> BlockTable

    SwapCtrl --> SwapQueue
    SwapQueue --> RunBatch

    PrefillExec --> AttnBackend
    DecodeExec --> AttnBackend
    SpecExec --> AttnBackend
    AttnBackend --> Weights
    AttnBackend --> KVPool

    classDef interface fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef scheduler fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef memory fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef executor fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef gpu fill:#fffde7,stroke:#f57f17,stroke-width:2px

    class API,Tokenizer interface
    class WaitQueue,RunBatch,SwapQueue,Policy scheduler
    class BlockAlloc,BlockTable,PrefixCache,SwapCtrl memory
    class PrefillExec,DecodeExec,SpecExec,AttnBackend executor
    class Weights,KVPool,Activations gpu
```

---

## Core Components

### 1. Scheduler Subsystem

The scheduler makes iteration-level decisions about which sequences to process.

| Component | Responsibility |
|-----------|---------------|
| **Waiting Queue** | Holds incoming requests not yet allocated GPU memory |
| **Running Batch** | Sequences actively being processed (have KV cache allocated) |
| **Swap Queue** | Preempted sequences whose KV cache was moved to CPU |
| **Scheduling Policy** | Determines admission, preemption, and execution order |

**Scheduling Policies:**

| Policy | Description | Best For |
|--------|-------------|----------|
| **FCFS** | First-come, first-served | Fair, predictable latency |
| **Priority** | Higher priority requests processed first | SLA differentiation |
| **Shortest Job First** | Process shorter prompts first | Minimize average latency |
| **Preemptive Priority** | Pause low-priority for high-priority | Real-time applications |

### 2. Memory Manager Subsystem

The memory manager handles KV cache allocation using PagedAttention.

| Component | Responsibility |
|-----------|---------------|
| **Block Allocator** | Manages pool of physical blocks (free list, ref counting) |
| **Block Table Manager** | Maps logical blocks to physical blocks per sequence |
| **Prefix Cache** | Stores computed KV for reusable prefixes (hash-based lookup) |
| **Swap Controller** | Handles GPU↔CPU memory transfers for preemption |

**Memory Hierarchy:**

```
┌──────────────────────────────────────────────────────────────┐
│                    GPU HBM (80 GB)                           │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                 KV Cache Pool (6 GB)                    │ │
│  │  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┐     │ │
│  │  │Blk 0│Blk 1│Blk 2│Blk 3│ ... │Blk N│     │     │     │ │
│  │  └─────┴─────┴─────┴─────┴─────┴─────┴─────┴─────┘     │ │
│  │  Each block: 16 tokens × 320 KB = 5.12 MB              │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                              │
                              │ Swap (preemption)
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    CPU RAM (Swap Space)                      │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              Swapped KV Cache Blocks                    │ │
│  │  (Sequences preempted due to memory pressure)          │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 3. Executor Subsystem

The executor runs model forward passes with different optimizations.

| Component | Responsibility |
|-----------|---------------|
| **Prefill Executor** | Process prompt tokens (compute-bound, batch across tokens) |
| **Decode Executor** | Generate output tokens (memory-bound, batch across sequences) |
| **Speculative Executor** | Run draft-verify pipeline for latency reduction |
| **Attention Backend** | Execute attention (Flash Attention, PagedAttention kernel) |

---

## Data Flow Diagrams

### Path A: Standard Request (No Caching)

```mermaid
sequenceDiagram
    participant Client
    participant API as API Server
    participant Sched as Scheduler
    participant Mem as Memory Manager
    participant Exec as Executor
    participant GPU

    Client->>API: POST /generate (prompt)
    API->>API: Tokenize prompt
    API->>Sched: add_request(tokens, params)
    Sched->>Sched: Enqueue to waiting_queue

    loop Scheduler Iteration
        Sched->>Mem: Can allocate blocks?
        Mem-->>Sched: Yes (N blocks available)
        Sched->>Mem: allocate_blocks(seq, N)
        Mem->>Mem: Pop from free_list
        Mem->>Mem: Create block_table
        Mem-->>Sched: block_table

        Sched->>Sched: Move seq to running_batch
        Sched->>Exec: Execute batch (prefill + decode)

        Exec->>GPU: Prefill forward pass
        GPU->>Mem: Store KV cache in blocks
        GPU-->>Exec: Hidden states

        loop Decode Loop
            Exec->>GPU: Decode forward pass
            GPU->>Mem: Append KV to last block
            GPU-->>Exec: Next token logits
            Exec->>Exec: Sample token
            Exec-->>API: Stream token (SSE)

            alt Sequence finished
                Exec->>Mem: free_blocks(seq)
                Mem->>Mem: Return to free_list
            end
        end
    end

    API-->>Client: Complete response
```

### Path B: Prefix Cache Hit

```mermaid
sequenceDiagram
    participant Client
    participant Sched as Scheduler
    participant Cache as Prefix Cache
    participant Mem as Memory Manager
    participant Exec as Executor

    Client->>Sched: Request with common prefix
    Sched->>Sched: Compute prefix_hash(tokens[:N])
    Sched->>Cache: lookup(prefix_hash)
    Cache-->>Sched: cache_hit: block_ids [0,1,2]

    Note over Sched,Mem: Copy-on-Write Fork
    Sched->>Mem: fork_blocks([0,1,2])
    Mem->>Mem: Increment ref_count for [0,1,2]
    Mem->>Mem: Create new block_table pointing to [0,1,2]
    Mem-->>Sched: block_table (shared blocks)

    Note over Sched,Exec: Skip prefix prefill
    Sched->>Mem: allocate_blocks(suffix_tokens)
    Mem-->>Sched: new block_ids [7]

    Sched->>Exec: Prefill ONLY suffix tokens
    Exec->>Exec: Start KV write at position N

    Note over Exec: Decode continues normally
    Exec->>Exec: Decode loop with full context
```

### Path C: Speculative Decoding

```mermaid
sequenceDiagram
    participant Sched as Scheduler
    participant Draft as Draft Model
    participant Target as Target Model
    participant Mem as Memory Manager

    Note over Sched: Speculative iteration (k=4)

    Sched->>Draft: Generate 4 draft tokens
    Draft->>Draft: Autoregressive decode (fast)
    Draft-->>Sched: draft_tokens [t1, t2, t3, t4]
    Draft-->>Sched: draft_probs [p1, p2, p3, p4]

    Sched->>Target: Verify k+1 positions (SINGLE forward pass)
    Target->>Target: Forward pass with draft tokens
    Target-->>Sched: target_logits [5 positions]

    loop Verification (i = 0 to 3)
        Sched->>Sched: Compute acceptance: min(1, target_p/draft_p)
        alt Accept
            Sched->>Sched: accepted.append(draft_tokens[i])
        else Reject
            Sched->>Sched: Sample from residual distribution
            Sched->>Sched: Break loop
        end
    end

    alt All 4 accepted
        Sched->>Sched: Sample position 5 from target
        Sched->>Sched: accepted.append(bonus_token)
    end

    Sched->>Mem: Update KV cache (only accepted tokens)
    Sched-->>Sched: Emit accepted tokens (1-5 tokens)
```

---

## Framework-Specific Architectures

### vLLM Architecture

```
vLLM (Python-based, CUDA kernels)
├── LLMEngine (Main entry point)
│   ├── Scheduler
│   │   ├── SchedulerConfig (max_num_seqs, max_model_len)
│   │   ├── BlockSpaceManager
│   │   │   ├── BlockAllocator (GPU)
│   │   │   ├── BlockAllocator (CPU - for swap)
│   │   │   └── SlidingWindowBlockAllocator (optional)
│   │   └── SchedulingPolicy (FCFS, Priority)
│   │
│   ├── ModelRunner
│   │   ├── ModelLoader (HuggingFace, SafeTensors)
│   │   ├── CUDAGraphRunner (for decode optimization)
│   │   └── WorkerBase (single-GPU worker)
│   │
│   ├── TokenizerGroup
│   │   └── Tokenizer (HuggingFace tokenizers)
│   │
│   └── OutputProcessor
│       ├── Sampler (temperature, top_p, top_k)
│       └── StopChecker (stop sequences, EOS)
│
└── Attention Backend
    ├── PagedAttention (vLLM custom kernel)
    ├── FlashAttention (when available)
    └── FlashInfer (alternative backend)
```

**Key Design Decisions (vLLM):**
- Python scheduler for flexibility
- CUDA kernels for performance-critical paths
- Block size of 16 tokens (balance between fragmentation and overhead)
- CUDA graphs for decode iteration (reduces Python overhead)

### TensorRT-LLM Architecture

```
TensorRT-LLM (C++ runtime, TensorRT compiler)
├── GptSession (Main inference session)
│   ├── Executor
│   │   ├── RequestQueue
│   │   ├── InferRequest
│   │   └── SchedulerPolicy
│   │
│   ├── TensorRT Runtime
│   │   ├── Engine (compiled model)
│   │   ├── ExecutionContext
│   │   └── Plugin Registry
│   │       ├── GptAttentionPlugin
│   │       ├── QuantizationPlugin (FP8/INT8)
│   │       └── LoraPlugin
│   │
│   ├── KV Cache Manager
│   │   ├── BlockManager
│   │   └── PagingConfig
│   │
│   └── NCCL Communicator
│       └── AllReduce, AllGather
│
└── Build Pipeline
    ├── Model Converter (HuggingFace → TRTLLM)
    ├── TensorRT Optimizer
    └── Engine Compiler
```

**Key Design Decisions (TensorRT-LLM):**
- C++ runtime for minimal overhead
- TensorRT compilation for kernel fusion
- Native FP8/FP4 support (Hopper/Blackwell)
- Inflight batching (iteration-level scheduling)

### SGLang Architecture

```
SGLang (Python runtime, FlashInfer backend)
├── Runtime
│   ├── Scheduler
│   │   ├── RadixCache (prefix caching)
│   │   │   ├── RadixTree
│   │   │   └── EvictionPolicy (LRU)
│   │   ├── ChunkPrefillScheduler
│   │   └── TreeAttentionScheduler
│   │
│   ├── ModelRunner
│   │   ├── FlashInferBackend
│   │   │   ├── BatchPrefillKernel
│   │   │   └── BatchDecodeKernel
│   │   └── TokenAttention
│   │
│   ├── Interpreter
│   │   ├── ConstrainedDecoding
│   │   └── StructuredOutput (JSON schema)
│   │
│   └── PrefillDecodeDisaggregation
│       ├── PrefillWorker
│       ├── DecodeWorker
│       └── KVCacheTransfer (RDMA)
│
└── Frontend
    ├── SGLProgram (DSL for structured generation)
    └── OpenAI-compatible API
```

**Key Design Decisions (SGLang):**
- RadixAttention for efficient prefix sharing
- Zero-overhead CPU scheduler
- First-class disaggregated prefill/decode support
- Native structured output (JSON mode)

---

## Key Architectural Decisions

### Decision 1: Continuous Batching vs Static Batching

| Aspect | Static Batching | Continuous Batching |
|--------|----------------|---------------------|
| **Batch Composition** | Fixed at start | Changes every iteration |
| **Padding** | Required for variable lengths | Not needed |
| **Head-of-Line Blocking** | Yes (long sequences block short) | No |
| **GPU Utilization** | Lower (idle during short seq completion) | Higher |
| **Implementation Complexity** | Low | Medium |
| **Throughput** | Baseline | 2-3x improvement |

**Recommendation:** Continuous batching for production. Static batching only for benchmarking.

### Decision 2: PagedAttention vs Contiguous Allocation

| Aspect | Contiguous Allocation | PagedAttention |
|--------|----------------------|----------------|
| **Memory Waste** | 60-90% (max_len - actual_len) | <5% fragmentation |
| **Concurrent Requests** | Few (memory limited) | Many (4-10x more) |
| **Allocation Overhead** | None | ~5% (block table lookup) |
| **Implementation Complexity** | Low | High |
| **Copy-on-Write** | Not possible | Supported |

**Recommendation:** PagedAttention for production. Contiguous only for very short contexts.

### Decision 3: Prefill/Decode Combined vs Disaggregated

| Aspect | Combined | Disaggregated |
|--------|----------|---------------|
| **Architecture** | Single worker pool | Separate prefill and decode workers |
| **TTFT** | Lower (no transfer) | Higher (+5-10ms KV transfer) |
| **Throughput** | Lower | 30-50% higher |
| **GPU Utilization** | Suboptimal (mixed compute/memory) | Optimal (specialized workers) |
| **Complexity** | Lower | Higher (KV cache transfer, routing) |
| **Best For** | Latency-sensitive | Throughput-maximizing |

**Recommendation:** Combined for latency-sensitive workloads. Disaggregated for cost-optimized batch processing.

### Decision 4: Speculative Decoding Usage

| Scenario | Use Speculative? | Reason |
|----------|------------------|--------|
| Greedy decoding (temp=0) | Yes | High acceptance rate (80%+) |
| Low temperature (temp<0.5) | Yes | Good acceptance rate (70%+) |
| High temperature (temp>0.7) | No | Low acceptance rate (<50%) |
| Good draft model available | Yes | Quality draft = high acceptance |
| No draft model | No | Cannot speculate |
| Batch size > 1 | Maybe | Benefits reduce with larger batches |

**Recommendation:** Enable speculative decoding for greedy/low-temperature with matched draft model.

---

## Architecture Pattern Checklist

| Decision | Options | Recommendation |
|----------|---------|----------------|
| Batching Strategy | Static / Continuous | Continuous batching |
| Memory Allocation | Contiguous / Paged | PagedAttention |
| Prefill/Decode | Combined / Disaggregated | Combined (default), Disaggregated (high throughput) |
| Prefix Caching | Disabled / Enabled | Enabled for repetitive workloads |
| Speculative Decoding | Disabled / Enabled | Enabled for low-temperature |
| Multi-GPU Strategy | Tensor Parallel / Pipeline | TP for latency, PP for large models |
| Quantization | FP16 / INT8 / FP8 | FP8 (Hopper), INT8 (Ada), FP16 (baseline) |
| CUDA Graphs | Disabled / Enabled | Enabled for decode |

---

## Multi-GPU Architecture

### Tensor Parallelism (TP)

Tensor parallelism shards model layers across GPUs within a node.

```mermaid
flowchart LR
    subgraph Node["Single Node (8x H100, NVLink)"]
        subgraph Layer["Attention Layer (TP=8)"]
            Q["Q Heads<br/>0-7 on GPU0"]
            K["K Heads<br/>8-15 on GPU1"]
            V["V Heads<br/>..."]
            O["Output<br/>AllReduce"]
        end

        GPU0["GPU 0"]
        GPU1["GPU 1"]
        GPU7["GPU 7"]

        Q --> GPU0
        K --> GPU1
        V --> GPU7

        GPU0 --> O
        GPU1 --> O
        GPU7 --> O
    end
```

**TP Communication:**
- AllReduce after every attention and MLP layer
- Uses NVLink (900 GB/s) within node
- Latency: ~10-50μs per AllReduce

### Pipeline Parallelism (PP)

Pipeline parallelism distributes layers across nodes.

```mermaid
flowchart TB
    subgraph Node1["Node 1 (Layers 0-39)"]
        L0["Layers 0-39"]
    end

    subgraph Node2["Node 2 (Layers 40-79)"]
        L1["Layers 40-79"]
    end

    Input["Input Tokens"] --> L0
    L0 -->|"InfiniBand<br/>400 Gb/s"| L1
    L1 --> Output["Output Logits"]
```

**PP Communication:**
- Point-to-point send after each stage
- Uses InfiniBand (400 Gb/s) between nodes
- Pipeline bubbles reduce efficiency

### Recommended Configuration

| Model Size | TP | PP | GPUs | Rationale |
|------------|----|----|------|-----------|
| 7B | 1 | 1 | 1 | Fits on single GPU |
| 70B (INT8) | 1 | 1 | 1 | Fits with quantization |
| 70B (FP16) | 2 | 1 | 2 | Requires sharding |
| 405B (INT8) | 8 | 1 | 8 | Full node TP |
| 405B (FP16) | 8 | 2 | 16 | Multi-node required |

**Best Practice:** TP = GPUs per node, PP = number of nodes.

---

## 2025-2026 Architectural Advances

### NVIDIA Dynamo: Disaggregated Orchestration Layer

NVIDIA Dynamo (open-sourced 2025) provides a production-grade orchestration layer for disaggregated inference across multiple nodes.

```
Dynamo Architecture
├── Router
│   ├── PrefixAwareRouter (hash-based routing for cache hits)
│   ├── LoadAwareRouter (least-outstanding-requests fallback)
│   └── KVCacheAwareRouter (routes to nodes with available KV memory)
│
├── Prefill Workers
│   ├── Batched prefill execution (compute-optimized)
│   ├── KV cache generation
│   └── Transfer initiation (RDMA / NVLink)
│
├── Decode Workers
│   ├── Continuous batching (memory-optimized)
│   ├── KV cache reception
│   └── Token streaming
│
├── KV Cache Transfer Manager
│   ├── GPU Direct RDMA (cross-node)
│   ├── NVLink (intra-node)
│   └── Pipelining (overlap transfer with decode)
│
└── Autoscaler
    ├── Prefill/Decode ratio adjustment
    ├── Instance scaling based on queue depth
    └── Expert-aware placement (MoE models)
```

**Key innovation:** Dynamo treats prefill and decode as first-class independently-scalable services with a smart router that considers prefix locality, KV memory availability, and request characteristics when making routing decisions.

### Zero-Overhead Scheduler Pattern

The 2025 generation of inference engines eliminates CPU-GPU serialization.

```
TRADITIONAL SCHEDULER (Serialized):
────────────────────────────────────
GPU:  [Forward N] [IDLE............] [Forward N+1] [IDLE..]
CPU:  [.........] [Schedule N+1....] [..........] [Sched..]
                   ↑ 100-500μs gap

ZERO-OVERHEAD SCHEDULER (Pipelined):
─────────────────────────────────────
GPU:  [Forward N] [Forward N+1] [Forward N+2] ...
CPU:  [Sched N+1] [Sched N+2.] [Sched N+3.] ...
       ↑ Overlapped — GPU never waits for CPU

IMPLEMENTATION APPROACH:
    Thread 1 (GPU): Execute forward pass for batch N
    Thread 2 (CPU): While GPU executes N:
        1. Collect finished sequences from batch N-1
        2. Run scheduling algorithm for batch N+1
        3. Allocate blocks for new sequences
        4. Build batch N+1 metadata
        5. Stage inputs for batch N+1

    Synchronization: Barrier between iterations
        GPU finishes N → signals CPU
        CPU has N+1 ready → launches immediately

REQUIREMENTS:
- Double-buffered batch metadata
- Lock-free communication between scheduler and executor
- Deterministic scheduling (decisions for N+1 don't depend on N's output tokens)
```

### Expert Parallelism for MoE Models

MoE models like DeepSeek-V3 (671B, 256 experts) require a hybrid parallelism approach.

```mermaid
flowchart TB
    subgraph Input["Input Processing"]
        Tokens["Token Batch"]
    end

    subgraph AttentionTP["Attention Layer (Tensor Parallel)"]
        G0_A["GPU 0: Heads 0-7"]
        G1_A["GPU 1: Heads 8-15"]
        G7_A["GPU 7: Heads 56-63"]
        AR["AllReduce"]
    end

    subgraph Router["Expert Router"]
        R["Top-K Gate<br/>(select 2 of 256)"]
    end

    subgraph ExpertEP["Expert Layer (Expert Parallel)"]
        G0_E["GPU 0: Experts 0-31"]
        G1_E["GPU 1: Experts 32-63"]
        G7_E["GPU 7: Experts 224-255"]
        A2A["All-to-All"]
    end

    Tokens --> AttentionTP
    G0_A --> AR
    G1_A --> AR
    G7_A --> AR
    AR --> Router
    R -->|"Route tokens"| A2A
    A2A --> G0_E & G1_E & G7_E
    G0_E --> A2A
    G1_E --> A2A
    G7_E --> A2A

    classDef input fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef tp fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef router fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef ep fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class Tokens input
    class G0_A,G1_A,G7_A,AR tp
    class R router
    class G0_E,G1_E,G7_E,A2A ep
```

**Communication pattern comparison:**
- **Tensor Parallelism**: Fixed AllReduce after every layer (predictable, symmetric)
- **Expert Parallelism**: Dynamic All-to-All based on routing decisions (variable, asymmetric)
- **Hybrid (TP + EP)**: AllReduce for attention, All-to-All for experts (production standard for large MoE)
