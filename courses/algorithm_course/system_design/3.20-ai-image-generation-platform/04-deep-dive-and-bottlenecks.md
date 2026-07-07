# Deep Dive & Bottlenecks

## Deep Dive 1: GPU Warm Pool Management

### Why This Is Critical

GPU model loading is the single largest latency contributor in image generation:

```
Cold Start Impact:
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Without Warm Pool:                                             │
│  ┌──────────────────┬────────────┬────────────┬──────────────┐ │
│  │   Model Load     │  Generate  │   Safety   │   Deliver    │ │
│  │    15-30s        │   8-10s    │    0.2s    │    0.5s      │ │
│  └──────────────────┴────────────┴────────────┴──────────────┘ │
│  Total: 24-41 seconds (UNACCEPTABLE)                           │
│                                                                 │
│  With Warm Pool:                                                │
│  ┌──────────────────┬────────────┬──────────────┐              │
│  │   Generate       │   Safety   │   Deliver    │              │
│  │    8-10s         │    0.2s    │    0.5s      │              │
│  └──────────────────┴────────────┴──────────────┘              │
│  Total: 9-11 seconds (ACCEPTABLE)                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Warm Pool Architecture

```mermaid
flowchart TB
    subgraph WarmPoolStrategy["Warm Pool Management Strategy"]
        direction TB

        subgraph Tier1["Tier 1: Always Hot (Never Evict)"]
            SDXL_Base["SDXL 1.0 Base<br/>20 GPUs"]
            SDXL_Popular["+ Top 5 LoRAs<br/>(Pre-merged)"]
            Common_VAE["SDXL VAE<br/>(Always loaded)"]
        end

        subgraph Tier2["Tier 2: Frequently Used (LRU with High Priority)"]
            SD3_Pool["SD3 Medium<br/>8 GPUs"]
            Flux_Pool["Flux Schnell<br/>8 GPUs"]
            Popular_CN["Popular ControlNets<br/>(Depth, Canny)"]
        end

        subgraph Tier3["Tier 3: On-Demand (Load when needed)"]
            Rare_Models["Specialized Models"]
            Custom_LoRA["User LoRAs"]
            Rare_CN["Rare ControlNets"]
        end

        subgraph ColdPool["Cold Pool (Spot Instances)"]
            Reserve["Reserve Capacity<br/>Auto-scale"]
        end
    end

    subgraph Policies["Loading Policies"]
        Predictive["Predictive Loading<br/>(Time-of-day patterns)"]
        LRU["LRU Eviction<br/>(Priority-weighted)"]
        Preemption["Request Preemption<br/>(Higher tier wins)"]
    end

    Tier1 --> Tier2 --> Tier3 --> ColdPool
    Policies --> WarmPoolStrategy

    classDef hot fill:#ffebee,stroke:#c62828,stroke-width:2px
    classDef warm fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef cold fill:#e3f2fd,stroke:#1565c0,stroke-width:2px

    class SDXL_Base,SDXL_Popular,Common_VAE hot
    class SD3_Pool,Flux_Pool,Popular_CN warm
    class Rare_Models,Custom_LoRA,Rare_CN,Reserve cold
```

### VRAM Budget Analysis

**Single A100 80GB Worker:**

```
VRAM Allocation Strategy:
┌─────────────────────────────────────────────────────────────┐
│                     A100 80GB Layout                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Base Model (SDXL)           │   10 GB     │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │           Text Encoders (CLIP+T5)     │    4 GB     │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │           VAE Decoder                 │    2 GB     │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │           LoRA Workspace              │    2 GB     │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │           ControlNet Reserve          │    4 GB     │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │           Latent Tensors (batch=4)    │    8 GB     │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │           Safety Models               │    4 GB     │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │           CUDA Overhead & Buffers     │    6 GB     │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │           ▓▓▓ Safety Margin ▓▓▓       │   10 GB     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Total Allocated: 50 GB                                     │
│  Safety Margin: 30 GB (for spikes, fragmentation)           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### VRAM Fragmentation Problem

```
Problem: Non-contiguous Free Memory
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  Before (Fragmented):                                          │
│  ┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐          │
│  │SDXL│Free│LoRA│Free│ CN │Free│VAE │Free│Safe│Free│          │
│  │10GB│2GB │1GB │3GB │4GB │1GB │2GB │2GB │4GB │5GB │          │
│  └────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘          │
│                                                                │
│  Free: 13GB total, but largest contiguous: 5GB                │
│  Cannot load new 8GB model despite "having space"             │
│                                                                │
│  After Defragmentation:                                        │
│  ┌────┬────┬────┬────┬────┬─────────────────────────┐         │
│  │SDXL│LoRA│ CN │VAE │Safe│      Free Space         │         │
│  │10GB│1GB │4GB │2GB │4GB │        13GB             │         │
│  └────┴────┴────┴────┴────┴─────────────────────────┘         │
│                                                                │
│  Free: 13GB contiguous - can load new models                  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Model Loading Strategy

```
ALGORITHM PredictiveModelLoading

FUNCTION predict_model_demand(time_window_minutes=30):
    # Analyze recent request patterns
    recent_requests = get_requests(last_minutes=60)

    # Count model usage
    model_counts = {}
    FOR request IN recent_requests:
        model = request.generation_config.model
        model_counts[model] = model_counts.get(model, 0) + 1

    # Time-of-day adjustment (learned patterns)
    current_hour = get_current_hour()
    time_weights = get_hourly_weights(current_hour)

    # Combine historical and recent
    predictions = {}
    FOR model, count IN model_counts:
        historical_weight = time_weights.get(model, 1.0)
        predictions[model] = count * historical_weight

    RETURN sorted(predictions, reverse=True)

FUNCTION preload_models():
    IF NOT is_low_traffic():
        RETURN  # Only preload during quiet periods

    predicted = predict_model_demand()

    FOR model IN predicted[:5]:  # Top 5 predicted
        idle_workers = get_idle_workers_without_model(model)

        IF idle_workers AND should_preload(model):
            worker = select_best_preload_target(idle_workers)
            async load_model(worker, model)

FUNCTION eviction_score(worker, model):
    # Higher score = more likely to evict

    score = 0

    # Time since last use (older = higher score)
    last_used = model_cache[model].last_used
    hours_idle = (now() - last_used).hours
    score += hours_idle * 10

    # Usage frequency (less used = higher score)
    use_count = model_cache[model].use_count_last_24h
    score -= use_count * 5

    # Model tier (lower tier = higher score for eviction)
    IF model IN TIER1_MODELS:
        score -= 1000  # Never evict tier 1
    ELIF model IN TIER2_MODELS:
        score -= 100

    # Current queue demand for this model
    queue_demand = count_queued_requests_for_model(model)
    score -= queue_demand * 20

    RETURN score
```

### Failure Modes and Recovery

| Failure Mode | Detection | Recovery | Prevention |
|--------------|-----------|----------|------------|
| OOM during generation | CUDA OOM exception | Retry with smaller batch, different worker | VRAM budget enforcement |
| Model corruption | Checksum mismatch | Re-download from registry | Periodic integrity checks |
| Worker crash | Heartbeat timeout | Reassign request, replace worker | Health monitoring |
| VRAM fragmentation | Allocation failures | Scheduled defragmentation | Periodic cleanup |
| Cold start storm | Queue depth spike | Auto-scale, priority promotion | Predictive loading |

---

## Deep Dive 2: Multi-Step Diffusion Optimization

### Denoising Process Visualization

```
Diffusion Denoising Process:
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  Step 0: Pure Noise                                            │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │     │
│  │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │     │
│  │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Step 10: Rough shapes emerge                                  │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ ░░░░░░▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │     │
│  │ ░░░░▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │     │
│  │ ░░░░░░▓▓▓▓░░░░░░░░░▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Step 25: Details forming                                      │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ ░░░░░█████░░░░░░░░░░░░░░░░░░░░░▓▓▓░░░░░░░░░░░░░░░░░ │     │
│  │ ░░░░███████░░░░░░░░░░░░░░░░░░░▓▓▓▓▓░░░░░░░░░░░░░░░░ │     │
│  │ ░░░░░█████░░░░░░░░███████░░░░░░▓▓▓░░░░░░░░░░░░░░░░░ │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Step 50: Final image                                          │
│  ┌──────────────────────────────────────────────────────┐     │
│  │       🏰                            🌄                │     │
│  │      🏰🏰🏰      🐉             🌄🌄🌄               │     │
│  │     🏰🏰🏰🏰   🐉🐉🐉        🌄🌄🌄🌄🌄             │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Step Count vs Quality Trade-off

```
Quality vs Steps Analysis:
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  Quality                                                       │
│  Score                                                         │
│    100% ────────────────────────────────────────────● 50 steps│
│                                                 ●              │
│     95% ────────────────────────────────────●                  │
│                                                                │
│     90% ────────────────────────────●  30 steps               │
│                                                                │
│     80% ────────────────────●  20 steps                       │
│                                                                │
│     70% ────────────●  LCM 4 steps                            │
│                                                                │
│     50% ────●  SDXS 1 step                                    │
│         │                                                      │
│         └──────────────────────────────────────────────────▶  │
│           1    4    10    20    30    40    50         Steps  │
│                                                                │
│  Diminishing returns after ~30 steps for most prompts         │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Scheduler Comparison

| Scheduler | Min Steps | Quality | Speed | Best Use Case |
|-----------|-----------|---------|-------|---------------|
| **DDIM** | 20 | Good | Medium | Deterministic, reproducible |
| **DPM++ 2M** | 20 | Very Good | Fast | Default recommendation |
| **DPM++ 2M Karras** | 20 | Excellent | Fast | High quality default |
| **Euler** | 25 | Good | Fast | Fast iterations |
| **Euler Ancestral** | 25 | Creative | Fast | Artistic, varied |
| **LCM** | 4 | Moderate | Very Fast | Previews, rapid iteration |
| **UniPC** | 15 | Excellent | Medium | Photorealism |

### Classifier-Free Guidance (CFG) Deep Dive

```
CFG Mechanism:
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  Input: Latent at timestep t                                  │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                      UNet                                 │ │
│  │                                                          │ │
│  │   ┌─────────────────┐    ┌─────────────────┐            │ │
│  │   │  Unconditional  │    │   Conditional    │            │ │
│  │   │  (empty prompt) │    │  (user prompt)   │            │ │
│  │   └────────┬────────┘    └────────┬────────┘            │ │
│  │            │                      │                      │ │
│  │            ▼                      ▼                      │ │
│  │      ε_uncond                ε_cond                      │ │
│  │                                                          │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  CFG Formula:                                                  │
│  ε_guided = ε_uncond + guidance_scale × (ε_cond - ε_uncond)  │
│                                                                │
│  guidance_scale effects:                                       │
│  - 1.0: No guidance (unconditional)                           │
│  - 7.0-8.0: Balanced (recommended)                            │
│  - 15.0+: Strong adherence, may oversaturate                  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**CFG Trade-offs:**

| CFG Scale | Prompt Adherence | Image Quality | Artifacts |
|-----------|------------------|---------------|-----------|
| 1.0 | None | High | None |
| 3.0 | Low | High | None |
| 7.0 | Medium | High | Minimal |
| 7.5 | Good | High | Minimal |
| 10.0 | Strong | Medium | Some |
| 15.0 | Very Strong | Low | Significant |
| 20.0+ | Extreme | Poor | Severe |

### DistriFusion for High-Resolution

```
DistriFusion Parallel Inference:
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  Standard Inference (Single GPU):                              │
│  ┌──────────────────────────────────────────────────────┐     │
│  │              Full Image Latent                        │     │
│  │         (Processing sequentially)                     │     │
│  │    ┌───────────────────────────────────────────────┐ │     │
│  │    │                   GPU 0                        │ │     │
│  │    │            All Computations                    │ │     │
│  │    └───────────────────────────────────────────────┘ │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  DistriFusion (4 GPUs):                                       │
│  ┌──────────────────────────────────────────────────────┐     │
│  │  ┌─────────┬─────────┬─────────┬─────────┐           │     │
│  │  │ Patch 0 │ Patch 1 │ Patch 2 │ Patch 3 │           │     │
│  │  │  GPU 0  │  GPU 1  │  GPU 2  │  GPU 3  │           │     │
│  │  └─────────┴─────────┴─────────┴─────────┘           │     │
│  │       ↕         ↕         ↕         ↕                │     │
│  │  Feature sharing from previous timestep              │     │
│  │  (Displaced Patch Parallelism)                       │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Performance (High-Resolution 2048x2048):                      │
│  - 1 GPU:  120 seconds                                        │
│  - 4 GPUs:  35 seconds (3.4x speedup)                         │
│  - 8 GPUs:  20 seconds (6.0x speedup)                         │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Latency Optimization Techniques

| Technique | Speedup | Quality Impact | When to Use |
|-----------|---------|----------------|-------------|
| **torch.compile** | 1.3-2x | None | Always (first run slower) |
| **Flash Attention** | 1.2-1.5x | None | Always |
| **FP16/BF16** | 1.5-2x | Minimal | Standard practice |
| **INT8 Quantization** | 1.5-2x | Slight decrease | Cost optimization |
| **LCM-LoRA** | 10-12x | Moderate decrease | Previews, iterations |
| **SDXS/Turbo** | 50-100x | Significant decrease | Real-time, previews |
| **VAE Tiling** | - | None | High resolution |
| **Attention Slicing** | Slower | None | Low VRAM situations |

---

## Deep Dive 3: ControlNet Integration

### ControlNet Architecture

```mermaid
flowchart TB
    subgraph Input["Input Processing"]
        Prompt["Text Prompt"]
        CondImage["Conditioning Image<br/>(Depth, Pose, Canny)"]
    end

    subgraph Encoders["Encoding"]
        TextEnc["Text Encoder<br/>(CLIP/T5)"]
        ControlEnc["ControlNet<br/>Encoder"]
    end

    subgraph UNet["UNet Architecture"]
        subgraph DownBlocks["Down Blocks"]
            Down1["Down Block 1"]
            Down2["Down Block 2"]
            Down3["Down Block 3"]
        end

        MidBlock["Mid Block"]

        subgraph UpBlocks["Up Blocks"]
            Up1["Up Block 1"]
            Up2["Up Block 2"]
            Up3["Up Block 3"]
        end
    end

    subgraph ControlNet["ControlNet (Parallel)"]
        CN_Down1["CN Down 1"]
        CN_Down2["CN Down 2"]
        CN_Down3["CN Down 3"]
        CN_Mid["CN Mid"]
    end

    Prompt --> TextEnc --> Down1
    CondImage --> ControlEnc --> CN_Down1

    CN_Down1 -->|"+ residual"| Down1
    CN_Down2 -->|"+ residual"| Down2
    CN_Down3 -->|"+ residual"| Down3
    CN_Mid -->|"+ residual"| MidBlock

    Down1 --> Down2 --> Down3 --> MidBlock
    MidBlock --> Up1 --> Up2 --> Up3

    classDef input fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef encoder fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef unet fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef controlnet fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px

    class Prompt,CondImage input
    class TextEnc,ControlEnc encoder
    class Down1,Down2,Down3,MidBlock,Up1,Up2,Up3 unet
    class CN_Down1,CN_Down2,CN_Down3,CN_Mid controlnet
```

### ControlNet Types and Use Cases

| Type | Input | Use Case | Memory | Strength Range |
|------|-------|----------|--------|----------------|
| **Canny** | Edge detection | Precise outlines, logos | 2 GB | 0.5-1.0 |
| **Depth** | Depth map | 3D structure, scenes | 2 GB | 0.3-0.8 |
| **OpenPose** | Skeleton | Character poses | 2 GB | 0.5-1.0 |
| **Scribble** | Rough sketch | Quick concepts | 2 GB | 0.3-0.7 |
| **Tile** | Low-res image | Upscaling | 2.5 GB | 0.5-1.0 |
| **Lineart** | Line drawing | Anime, illustrations | 2 GB | 0.4-0.8 |
| **IP-Adapter** | Reference image | Style transfer | 3 GB | 0.3-0.7 |
| **Reference** | Reference image | Consistency | 2.5 GB | 0.4-0.8 |

### Multi-ControlNet Composition

```
Multi-ControlNet Strategy:
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  Example: Character in specific pose with depth-aware scene   │
│                                                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │
│  │  OpenPose   │  │    Depth    │  │ IP-Adapter  │           │
│  │  weight:0.8 │  │  weight:0.5 │  │  weight:0.4 │           │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘           │
│         │                │                │                   │
│         └────────────────┼────────────────┘                   │
│                          │                                    │
│                          ▼                                    │
│              ┌───────────────────────┐                        │
│              │   Combined Residuals   │                        │
│              │   (Weighted Sum)       │                        │
│              └───────────────────────┘                        │
│                          │                                    │
│                          ▼                                    │
│                    UNet + Residuals                           │
│                                                                │
│  Total VRAM: Base (10GB) + Pose (2GB) + Depth (2GB) + IP (3GB)│
│            = 17 GB                                            │
│                                                                │
│  Best Practices:                                               │
│  - Limit to 2-3 simultaneous ControlNets                      │
│  - Lower weights when combining                                │
│  - Complementary types work better than redundant             │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### ControlNet Timing and Strength

```
ControlNet Temporal Application:
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  Strength over Denoising Steps:                                │
│                                                                │
│  Strength                                                      │
│    1.0 │████████████████████████                              │
│        │████████████████████████                              │
│    0.8 │████████████████████░░░░                              │
│        │████████████████░░░░░░░░                              │
│    0.5 │████████████░░░░░░░░░░░░  ← End at 70% (recommended)  │
│        │████████░░░░░░░░░░░░░░░░                              │
│    0.2 │████░░░░░░░░░░░░░░░░░░░░                              │
│        │░░░░░░░░░░░░░░░░░░░░░░░░                              │
│    0.0 └────────────────────────▶                              │
│          0%   25%   50%   75%   100%   Denoising Progress     │
│                                                                │
│  start_percent: When to start applying (default: 0)           │
│  end_percent: When to stop applying (default: 100)            │
│                                                                │
│  Strategies:                                                   │
│  - Full (0-100%): Strong structure adherence                  │
│  - Early (0-50%): Set composition, allow detail variation     │
│  - Late (50-100%): Add detail conditioning without composition│
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Slowest part of the process Analysis

### Slowest part of the process 1: Model Loading Latency

```
Model Loading Breakdown:
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  Component              Load Time        Mitigation            │
│  ─────────────────────────────────────────────────────────────│
│  SDXL UNet             8-15s            Warm pool (Tier 1)    │
│  SD3 UNet              10-18s           Warm pool (Tier 2)    │
│  Flux UNet             12-20s           Warm pool (Tier 2)    │
│  Text Encoders         2-4s             Always loaded         │
│  VAE                   1-2s             Always loaded         │
│  LoRA (per adapter)    0.5-2s           Weight caching        │
│  ControlNet            2-4s             Lazy loading          │
│                                                                │
│  Worst Case Cold Start (Flux + CN + LoRA):                    │
│  20s + 4s + 2s + 2s = 28 seconds (before generation!)        │
│                                                                │
│  Mitigations:                                                  │
│  1. Warm pool covering 80%+ of requests                       │
│  2. Predictive loading based on queue analysis                │
│  3. Weight caching in CPU RAM for fast GPU reload             │
│  4. Model registry with local NVMe caching                    │
│  5. Quantized models for faster loading                       │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Slowest part of the process 2: VRAM Limits for Complex Compositions

```
VRAM Pressure Scenarios:
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  Scenario A: A10G 24GB - Standard SDXL                        │
│  ┌────────────────────────────────────────────────┐           │
│  │ SDXL │ Text │ VAE │ Workspace │ Safety │ Free │           │
│  │ 10GB │ 1.5GB│ 2GB │   4GB     │  2GB   │ 4.5GB│           │
│  └────────────────────────────────────────────────┘           │
│  Status: ✅ Comfortable                                       │
│                                                                │
│  Scenario B: A10G 24GB - SDXL + 2 LoRA + ControlNet           │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ SDXL │Text│VAE│ LoRA │  CN  │Workspace│Safety│ Free │     │
│  │ 10GB │1.5G│2GB│ 0.4GB│ 3GB  │  4GB    │ 2GB  │ 1.1GB│     │
│  └──────────────────────────────────────────────────────┘     │
│  Status: ⚠️ Tight, may fragment                              │
│                                                                │
│  Scenario C: A10G 24GB - SDXL + 4 LoRA + 2 ControlNet         │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ SDXL │Text│VAE│LoRA│ CN  │ CN  │Workspace│Safety│ OOM │   │
│  │ 10GB │1.5G│2GB│0.8G│ 3GB │ 3GB │  4GB    │ 2GB  │-2.3G│   │
│  └────────────────────────────────────────────────────────┘   │
│  Status: ❌ Out of Memory                                     │
│                                                                │
│  Solutions:                                                    │
│  1. Limit adapter count per tier (Free: 1 LoRA, Pro: 3)      │
│  2. Sequential ControlNet processing (time vs memory)         │
│  3. Route complex requests to A100 workers                    │
│  4. Quantization (INT8 saves ~50% VRAM)                       │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Slowest part of the process 3: Queue Starvation

```
Starvation Scenario:
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  Time: Peak Hours (10:00 AM)                                  │
│                                                                │
│  Turbo Queue: ████████ 80 requests (Turbo users generating)   │
│  Fast Queue:  ██████████████████████████ 260 requests         │
│  Relax Queue: ████████████████████████████████████ 1200 req   │
│                                                                │
│  GPU Allocation (weighted scheduling):                         │
│  - Turbo gets: 10 × 80 = 800 weight units                     │
│  - Fast gets:  5 × 260 = 1300 weight units                    │
│  - Relax gets: 1 × 1200 = 1200 weight units                   │
│                                                                │
│  Result: Relax gets ~36% of GPU time despite 77% of requests  │
│  → Relax wait time grows to 15+ minutes (SLO violation)       │
│                                                                │
│  Mitigations:                                                  │
│  1. Reserved capacity (20% GPUs always for Relax)             │
│  2. Starvation promotion (>5 min wait → boost priority)       │
│  3. Dynamic weight adjustment based on wait time              │
│  4. Off-peak batch processing for Relax backlog               │
│  5. Auto-scale during sustained high demand                   │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Slowest part of the process Summary Table

| Slowest part of the process | Impact | Detection | Mitigation |
|------------|--------|-----------|------------|
| Cold start | 15-30s latency | Cache miss rate | Warm pool, predictive loading |
| VRAM exhaustion | OOM failures | VRAM utilization >90% | Adapter limits, worker routing |
| VRAM fragmentation | Allocation failures | Fragmentation ratio <0.7 | Scheduled defragmentation |
| Queue starvation | SLO violation | Wait time percentiles | Reserved capacity, promotion |
| Safety classifier | Latency spike | P95 safety time | Classifier batching, caching |
| CDN upload | Delivery delay | Upload duration | Async upload, regional storage |

---

## Case Study 1: Large-Scale Model Migration (UNet to DiT)

### Context

A major image generation platform serving 10M+ daily generations needed to migrate from SDXL (UNet, 860M params) to a Flux-class DiT model (12B params) without service disruption.

### Challenge

The DiT model required 2.5x more VRAM per worker (40 GB vs 16 GB) but generated images 3x faster per step with 7.5x fewer steps needed. This inverted the traditional capacity model:

```
Old Model (SDXL UNet):
  - 16 GB VRAM per worker → 5 workers per A100 80GB (with overhead)
  - 30 steps × 200ms/step = 6s generation
  - Throughput: 5 × (60/6) = 50 images/min per A100

New Model (DiT + Flow Matching):
  - 40 GB VRAM per worker → 1 worker per A100 80GB
  - 4 steps × 750ms/step = 3s generation
  - Throughput: 1 × (60/3) = 20 images/min per A100
```

Despite faster per-image generation, the larger model reduced per-GPU throughput by 60% because model packing density dropped from 5:1 to 1:1.

### Solution: Hybrid Fleet with Traffic-Based Routing

```
Migration Architecture:
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  Router Decision Logic:                                        │
│  ┌─────────────────────────────────────────────┐              │
│  │ IF user_tier == "turbo" AND model == "flux": │              │
│  │   → Route to DiT fleet (A100 80GB)           │              │
│  │ ELIF model == "sdxl" AND adapters <= 2:      │              │
│  │   → Route to UNet fleet (A10G 24GB)           │              │
│  │ ELIF model == "sdxl" AND adapters > 2:       │              │
│  │   → Route to UNet fleet (A100 80GB)           │              │
│  │ ELSE:                                        │              │
│  │   → Route to overflow fleet                   │              │
│  └─────────────────────────────────────────────┘              │
│                                                                │
│  Fleet Composition (Phased):                                   │
│  ├── Week 1-2: 90% UNet A10G, 10% DiT A100                   │
│  ├── Week 3-4: 70% UNet, 30% DiT                              │
│  ├── Week 5-8: 40% UNet, 60% DiT                              │
│  └── Week 9+:  20% UNet (legacy), 80% DiT                     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Key Lessons

1. **Per-image latency improved but per-GPU throughput dropped** — capacity planning must use throughput, not latency
2. **LoRA ecosystem lagged** — existing SDXL LoRAs were incompatible with DiT architecture, requiring a parallel LoRA training pipeline
3. **Mixed fleets are operationally expensive** — two model architectures means two warm pool strategies, two VRAM budget models, and two sets of operational runbooks
4. **Quality difference drove organic migration** — users switched to DiT voluntarily once they saw the quality improvement, simplifying the forced migration timeline

---

## Case Study 2: Safety Classifier False Positive Incident (2025)

### Context

A platform's NSFW classifier was updated with a new training dataset to reduce false negatives. The updated model was deployed to 100% of traffic in a single rollout.

### What Happened

The new classifier raised the false positive rate from 0.3% to 4.7% — a 15x increase. Legitimate artwork, medical imagery, and historical art reproductions were blocked. The impact:

- **12 hours** before the issue was detected (alert thresholds were set for false negatives, not positives)
- **180,000 legitimate images blocked** across the platform
- **Significant user backlash** from professional artists whose work was incorrectly flagged

### Root Cause Analysis

```
Root Causes:
1. No canary rollout for safety model updates
   (Treated as "only makes things safer" — no downside testing)

2. Monitoring gap: Tracked false negative rate (safety)
   but not false positive rate (user experience)

3. Training data imbalance: New dataset over-represented
   artistic nudity in the "block" category

4. No A/B comparison: Couldn't compare old vs new classifier
   side-by-side on production traffic
```

### Fix Applied

| Change | Before | After |
|--------|--------|-------|
| Rollout strategy | 100% instant | 1% → 5% → 25% → 100% over 7 days |
| Monitoring | False negative rate only | False positive + false negative + user appeal rate |
| Evaluation | Offline test set | Shadow mode on production traffic for 48h before activation |
| Rollback | Manual revert | Automatic rollback if false positive rate exceeds 2x baseline |

### Generalized Lesson

Safety model updates are NOT monotonically "safer" — they trade false negatives for false positives. Every safety model change must be treated as a potential regression in user experience, not just as a security improvement. The same staged rollout discipline applied to generation models must apply to safety classifiers.
