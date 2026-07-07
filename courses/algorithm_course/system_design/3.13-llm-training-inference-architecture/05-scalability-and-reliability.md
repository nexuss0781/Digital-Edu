# Scalability and Reliability

## Training Scalability

### Horizontal Scaling Strategy

#### GPU Scaling Dimensions

| Scale Dimension | Method | Efficiency | Limit |
|-----------------|--------|------------|-------|
| **Add GPUs (same node)** | Increase TP | 90%+ | 8 GPUs (NVLink) |
| **Add nodes (same cluster)** | Increase DP/PP | 70-90% | Network bandwidth |
| **Add clusters (multi-region)** | Federated training | 50-70% | WAN latency |

#### Scaling Efficiency Analysis

```
Strong Scaling (fixed problem size):
- Ideal: Time ∝ 1/N
- Reality: Time ∝ 1/N + C × communication
- Efficiency = T₁ / (N × Tₙ)

Weak Scaling (problem size grows with N):
- Ideal: Time constant
- Reality: Time ∝ 1 + C × log(N)
- Efficiency = T₁ / Tₙ
```

**Measured Scaling Efficiency:**

| GPUs | TP | PP | DP | MFU | Efficiency vs 8 |
|------|-----|-----|-----|-----|-----------------|
| 8 | 8 | 1 | 1 | 58% | 100% |
| 64 | 8 | 2 | 4 | 54% | 93% |
| 512 | 8 | 4 | 16 | 51% | 88% |
| 4096 | 8 | 8 | 64 | 47% | 81% |

### Auto-Scaling for Training

Training jobs typically don't auto-scale mid-job, but cluster can scale:

```
POLICY: Elastic Training Support

FUNCTION handle_node_failure(failed_node):
    # Option 1: Restart from checkpoint (preferred)
    if checkpoint_available():
        remove_node(failed_node)
        reconfigure_parallelism(num_nodes - 1)
        resume_from_checkpoint()

    # Option 2: Continue with fewer nodes
    else if elastic_training_enabled:
        repartition_data(num_nodes - 1)
        continue_training()

    # Option 3: Wait for replacement
    else:
        pause_training()
        wait_for_replacement_node()
        resume_training()
```

### Multi-Cluster and Cross-Datacenter Training

```
MULTI_CLUSTER_TRAINING:

Challenge: Single datacenter may not have 10K+ GPUs available.
Solution: Federated training across clusters with hierarchical aggregation.

Architecture:
    Cluster A (4096 GPUs): Local DP/TP/PP training
    Cluster B (4096 GPUs): Local DP/TP/PP training
    │
    └── WAN connection (100 Gb/s)
        │
        └── Gradient aggregation server
            - Compress gradients (10-100x)
            - Hierarchical AllReduce: local first, then WAN
            - Asynchronous SGD with bounded staleness

Trade-offs:
    - 5-15% convergence slowdown vs single cluster
    - Enables access to more total compute
    - Requires careful learning rate scaling
    - Checkpoint coordination across clusters
```

### Scaling Bottlenecks and Mitigations

| Slowest part of the process | Scale Threshold | Mitigation |
|------------|-----------------|------------|
| AllReduce bandwidth | >256 GPUs | Hierarchical AllReduce, gradient compression |
| Checkpoint I/O | >1000 GPUs | Parallel writes, async checkpoint |
| Data loading | Any | Prefetch, distributed filesystem |
| Memory per GPU | Model-dependent | ZeRO-3, offloading |
| Pipeline bubbles | PP > 8 | More microbatches, interleaved schedule |
| MoE All-to-All | >128 experts | Expert grouping, hierarchical routing |
| WAN latency | Multi-cluster | Gradient compression, async SGD |

---

## Inference Scalability

### Horizontal Scaling Strategy

```mermaid
flowchart TB
    subgraph Scaling["Inference Scaling Dimensions"]
        direction LR

        subgraph Throughput["Throughput Scaling"]
            AddInstances["Add Model Instances"]
            IncBatch["Increase Batch Size"]
            Quantize["Apply Quantization"]
        end

        subgraph Latency["Latency Scaling"]
            TP["Tensor Parallelism"]
            SpecDec["Speculative Decoding"]
            Optimize["Kernel Optimization"]
        end

        subgraph Memory["Memory Scaling"]
            Pages["PagedAttention"]
            KVQuant["KV Cache Quantization"]
            Offload["CPU Offloading"]
        end
    end

    classDef throughput fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef latency fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef memory fill:#fff3e0,stroke:#e65100,stroke-width:2px

    class AddInstances,IncBatch,Quantize throughput
    class TP,SpecDec,Optimize latency
    class Pages,KVQuant,Offload memory
```

### Auto-Scaling Policies

```
POLICY: Request-Based Scaling

TRIGGERS:
    scale_up_threshold:
        - queue_depth > 100 for 30 seconds
        - p99_latency > 2 * SLO for 60 seconds
        - gpu_utilization > 85% for 5 minutes

    scale_down_threshold:
        - queue_depth < 10 for 5 minutes
        - gpu_utilization < 30% for 10 minutes

CONSTRAINTS:
    min_instances: 2  # High availability
    max_instances: 100
    cooldown_period: 300 seconds
    scale_increment: 2 instances

FUNCTION auto_scale():
    metrics = collect_metrics()

    if any(scale_up_threshold.triggered(metrics)):
        if current_instances < max_instances:
            add_instances(scale_increment)
            wait(cooldown_period)

    elif all(scale_down_threshold.triggered(metrics)):
        if current_instances > min_instances:
            remove_instances(scale_increment)
            wait(cooldown_period)
```

### Scaling by Model Size

| Model Size | Typical TP | Instances per 100 QPS | Memory Strategy |
|------------|------------|----------------------|-----------------|
| 7B | 1 | 2-3 | Single GPU, INT8 |
| 13B | 1-2 | 4-5 | Single/Dual GPU, INT8 |
| 70B | 2-4 | 10-15 | Multi-GPU, INT8 or FP8 |
| 405B | 8 | 30-50 | Multi-node, INT8 |
| 671B MoE | 8-16 | 15-25 | Expert offloading, FP8 (37B active) |

### Disaggregated Scaling Strategy

```
DISAGGREGATED_SCALING:

Prefill Pool:
    - Scale based on: incoming request rate × avg prompt length
    - GPU type: Compute-optimized (B200, high FP8 TFLOPS)
    - Target utilization: 80-90% compute
    - Auto-scale trigger: prefill queue depth > 50

Decode Pool:
    - Scale based on: concurrent decoding sequences × avg output length
    - GPU type: Memory-optimized (H200, high HBM bandwidth)
    - Target utilization: 70-80% memory bandwidth
    - Auto-scale trigger: decode batch fullness > 85%

KV Transfer Network:
    - Scale based on: KV transfer throughput demand
    - Must provision: prefill_qps × avg_kv_size < network_bandwidth × 0.7
    - RDMA network must not become Slowest part of the process

EXAMPLE:
    10,000 QPS, 1K avg prompt, 200 avg output, 70B model:
    Prefill demand: 10K × 1K × 2 FLOPS = 1.4e16 FLOPS/s
    Prefill GPUs: 1.4e16 / (4.5e15 × 0.5) = 7 B200 GPUs

    Decode demand: 10K × 200 / 50 = 40K concurrent sequences
    KV per sequence: 5.2 MB × 1.2K = 6.2 GB
    Decode GPUs: (40K × 6.2 GB) / (141 GB - 70 GB) = ~3,500 GPUs
    (This is why quantization is essential for decode at scale)
```

---

## Training Reliability

### Fault Tolerance Architecture

```mermaid
flowchart TB
    subgraph Detection["Fault Detection"]
        Heartbeat["Heartbeat Monitor<br/>(every 30s)"]
        LossWatch["Loss Anomaly<br/>Detector"]
        NCCLWatch["NCCL Timeout<br/>Monitor"]
        HWMonitor["Hardware Health<br/>Monitor"]
    end

    subgraph Classification["Failure Classification"]
        Transient["Transient<br/>(retry)"]
        Recoverable["Recoverable<br/>(checkpoint restart)"]
        Fatal["Fatal<br/>(human intervention)"]
    end

    subgraph Recovery["Recovery Actions"]
        Retry["Retry Operation"]
        Restart["Restart from<br/>Checkpoint"]
        NodeReplace["Replace Node"]
        Escalate["Escalate to<br/>On-Call"]
    end

    Heartbeat --> Classification
    LossWatch --> Classification
    NCCLWatch --> Classification
    HWMonitor --> Classification

    Classification -->|"timeout < 60s"| Transient
    Classification -->|"GPU/Node failure"| Recoverable
    Classification -->|"data corruption"| Fatal

    Transient --> Retry
    Recoverable --> Restart
    Recoverable --> NodeReplace
    Fatal --> Escalate

    classDef detect fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef classify fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef recover fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px

    class Heartbeat,LossWatch,NCCLWatch,HWMonitor detect
    class Transient,Recoverable,Fatal classify
    class Retry,Restart,NodeReplace,Escalate recover
```

### Checkpoint Strategy

#### Checkpoint Types

| Type | Contents | Size | Frequency | Use Case |
|------|----------|------|-----------|----------|
| **Full** | Model + Optimizer + RNG | 2-3x model | Every 30 min | Recovery |
| **Delta** | Changed parameters only | 10-20% of full | Every 10 min | Fast save |
| **In-Memory** | Replicated to peer GPUs | Model size | Every step | ByteRobust |
| **Async** | Background write | Full size | Continuous | Low overhead |

#### ByteRobust Pattern (Production-Grade)

```
ALGORITHM ByteRobust_Checkpointing

CONCEPT:
- Each GPU maintains copy of neighbor's critical state
- On failure, recover from neighbor (milliseconds) vs storage (minutes)
- Background persistence to storage for durability

STRUCTURES:
    ReplicationGroup:
        primary: GPU_id
        replicas: List[GPU_id]  # Usually 2-3 neighbors

FUNCTION checkpoint_with_replication():
    # Step 1: Local snapshot
    local_state = {
        model_shard: model.state_dict(),
        optimizer_shard: optimizer.state_dict(),
        rng_state: get_rng_state(),
        step: global_step
    }

    # Step 2: Replicate to neighbors (GPU memory, fast)
    for replica in replication_group.replicas:
        async_gpu_copy(local_state, replica.backup_buffer)

    # Step 3: Async persist to storage (background)
    async_write_storage(local_state, checkpoint_path)

    # Step 4: Verify replication
    barrier()
    verify_checksums()

FUNCTION recover_from_failure(failed_gpu):
    # Step 1: Try neighbor recovery (fast path)
    for replica in failed_gpu.replication_group.replicas:
        if replica.has_backup(failed_gpu):
            state = replica.get_backup(failed_gpu)
            return restore_state(state)  # <1 minute

    # Step 2: Fall back to storage (slow path)
    state = load_from_storage(latest_checkpoint)
    return restore_state(state)  # ~10 minutes

METRICS:
    - Recovery from neighbor: <1 minute
    - Recovery from storage: 5-10 minutes
    - Checkpoint overhead: <1% of step time
    - Storage writes: Async, no training impact
```

### Recovery Time Objectives

| Failure Type | Detection Time | Recovery Time | Total Downtime |
|--------------|----------------|---------------|----------------|
| Single GPU | <30 seconds | <2 minutes | <3 minutes |
| Single Node | <1 minute | <5 minutes | <6 minutes |
| Network partition | <1 minute | <10 minutes | <11 minutes |
| Storage failure | <2 minutes | <30 minutes | <32 minutes |
| Datacenter failure | <5 minutes | <2 hours | <2.1 hours |

---

## Inference Reliability

### High Availability Architecture

```mermaid
flowchart TB
    subgraph Region1["Region 1 (Primary)"]
        LB1["Load Balancer"]
        subgraph Pool1["Instance Pool"]
            I1_1["Instance 1"]
            I1_2["Instance 2"]
            I1_N["Instance N"]
        end
    end

    subgraph Region2["Region 2 (Secondary)"]
        LB2["Load Balancer"]
        subgraph Pool2["Instance Pool"]
            I2_1["Instance 1"]
            I2_2["Instance 2"]
        end
    end

    subgraph Global["Global Layer"]
        DNS["GeoDNS"]
        HealthCheck["Health Checker"]
    end

    DNS --> LB1
    DNS --> LB2
    HealthCheck --> LB1
    HealthCheck --> LB2

    LB1 --> Pool1
    LB2 --> Pool2

    classDef lb fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef instance fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef global fill:#e1f5fe,stroke:#01579b,stroke-width:2px

    class LB1,LB2 lb
    class I1_1,I1_2,I1_N,I2_1,I2_2 instance
    class DNS,HealthCheck global
```

### Circuit Breaker Pattern

```mermaid
stateDiagram-v2
    [*] --> Closed: Initial state

    Closed --> Open: Failure threshold exceeded
    Closed --> Closed: Request succeeds

    Open --> HalfOpen: Timeout expires
    Open --> Open: Reject requests

    HalfOpen --> Closed: Test request succeeds
    HalfOpen --> Open: Test request fails

    note right of Closed
        Normal operation
        Track failure rate
    end note

    note right of Open
        Fail fast
        No requests to service
    end note

    note right of HalfOpen
        Test with single request
        Decide next state
    end note
```

**Circuit Breaker Configuration:**

```
CircuitBreakerConfig:
    failure_threshold: 5  # Failures to trip
    success_threshold: 3  # Successes to close
    timeout: 30 seconds  # Open state duration
    half_open_requests: 1  # Test requests

States:
    CLOSED: Normal operation, count failures
    OPEN: Reject all requests immediately
    HALF_OPEN: Allow limited test requests
```

### Graceful Degradation

| Degradation Level | Trigger | Action | User Impact |
|-------------------|---------|--------|-------------|
| **Normal** | All healthy | Full service | None |
| **Level 1** | High latency | Disable speculative decoding | Slightly slower |
| **Level 2** | Memory pressure | Reduce max context length | Truncated context |
| **Level 3** | Capacity exceeded | Queue with timeout | Delayed response |
| **Level 4** | Partial outage | Route to backup region | Higher latency |
| **Level 5** | Major outage | Return cached/fallback | Degraded quality |

### Request Retry Strategy

```
ALGORITHM ExponentialBackoffRetry

CONSTANTS:
    MAX_RETRIES = 3
    BASE_DELAY = 100 ms
    MAX_DELAY = 10 seconds
    JITTER_FACTOR = 0.2

FUNCTION retry_with_backoff(request):
    for attempt in range(MAX_RETRIES):
        try:
            return execute_request(request)
        except RetryableError as e:
            if attempt == MAX_RETRIES - 1:
                raise e

            delay = min(BASE_DELAY * (2 ** attempt), MAX_DELAY)
            jitter = delay * JITTER_FACTOR * random()
            sleep(delay + jitter)
        except NonRetryableError as e:
            raise e  # Don't retry

RETRYABLE_ERRORS:
    - Timeout
    - 503 Service Unavailable
    - 429 Too Many Requests
    - Network errors

NON_RETRYABLE_ERRORS:
    - 400 Bad Request
    - 401 Unauthorized
    - 413 Request Too Large
```

---

## Disaster Recovery

### Training Disaster Recovery

| Scenario | RPO | RTO | Strategy |
|----------|-----|-----|----------|
| Single GPU failure | 0 (in-memory) | <3 min | ByteRobust recovery |
| Node failure | <10 min | <10 min | Checkpoint restart |
| Cluster failure | <30 min | <2 hours | Cross-cluster resume |
| Region failure | <1 hour | <4 hours | Cross-region checkpoint |
| Data corruption | 0 | <1 hour | Checkpoint versioning |

### Inference Disaster Recovery

| Scenario | RPO | RTO | Strategy |
|----------|-----|-----|----------|
| Instance failure | N/A | <30 sec | Load balancer failover |
| Node failure | N/A | <1 min | Auto-scaling replacement |
| Cluster failure | N/A | <5 min | Cross-cluster routing |
| Region failure | N/A | <15 min | GeoDNS failover |
| Model corruption | N/A | <30 min | Rollback to previous version |

### Backup Strategy

```
BACKUP_POLICY:

    Training Checkpoints:
        frequency: Every 30 minutes
        retention:
            - Last 10 checkpoints: Hot storage
            - Last 30 days: Warm storage
            - Milestone checkpoints: Cold storage (permanent)
        replication: 3 regions
        verification: Checksum + test load

    Model Weights:
        frequency: On completion + milestones
        retention: Permanent
        replication: 3 regions
        verification: Inference test

    Configuration:
        frequency: On change
        retention: 90 days
        replication: 2 regions
        verification: Syntax check
```

### Multi-Region Architecture

```
                    ┌─────────────────────────────────────────┐
                    │           Global Traffic Manager         │
                    │        (GeoDNS + Health Checks)          │
                    └─────────────────┬───────────────────────┘
                                      │
            ┌─────────────────────────┼─────────────────────────┐
            │                         │                         │
    ┌───────▼───────┐        ┌───────▼───────┐        ┌───────▼───────┐
    │   US-East     │        │   EU-West     │        │   Asia-Pac    │
    │   (Primary)   │        │  (Secondary)  │        │  (Secondary)  │
    ├───────────────┤        ├───────────────┤        ├───────────────┤
    │ 20 instances  │        │ 10 instances  │        │ 10 instances  │
    │ 70B model x4  │        │ 70B model x2  │        │ 70B model x2  │
    │ Full capacity │        │ 50% capacity  │        │ 50% capacity  │
    └───────────────┘        └───────────────┘        └───────────────┘
            │                         │                         │
            └─────────────────────────┼─────────────────────────┘
                                      │
                    ┌─────────────────▼───────────────────────┐
                    │       Shared Model Registry              │
                    │    (Cross-region replicated)             │
                    └─────────────────────────────────────────┘

    Failover Behavior:
    - Primary failure → Traffic routes to secondaries
    - Secondary scales up automatically
    - Recovery: Restore primary, scale down secondaries
```

---

## Capacity Planning

### Training Capacity Planning

```
FORMULA: Training Time Estimation

training_time_hours = (6 * params * tokens) / (num_gpus * gpu_flops * mfu * 3600)

Example: 70B model, 2T tokens, 256 H100s, 50% MFU
= (6 * 70e9 * 2e12) / (256 * 1.98e15 * 0.5 * 3600)
= 8.4e23 / 9.1e20
= 923 hours ≈ 38 days
```

### Inference Capacity Planning

```
FORMULA: Instance Count for Target QPS

instances = ceil(target_qps / (instance_throughput * availability_factor))

Example: 10,000 QPS target, 500 TPS per instance, 80% availability
= ceil(10000 / (500 * 0.8))
= ceil(25)
= 25 instances (minimum)

With 2x headroom for spikes: 50 instances
```

### Cost Optimization

| Strategy | Savings | Trade-off |
|----------|---------|-----------|
| Spot instances (training) | 60-70% | Interruption risk |
| Reserved capacity | 30-50% | Commitment |
| Quantization (inference) | 50-75% | Slight quality loss |
| Batching optimization | 30-50% | Latency variance |
| Off-peak scheduling | 20-30% | Timing constraints |
| Right-sizing | 10-20% | Monitoring overhead |

---

## AI Release Ladder

Every AI-driven capability in LLM infrastructure (model weights, quantization policies, routing strategies, batching optimizers) must progress through these stages before reaching full autonomy.

| Stage | Gate Criteria | Rollback Trigger | Typical Duration |
|-------|--------------|------------------|------------------|
| **1. Offline Evaluation** | Benchmark scores (MMLU, HumanEval, etc.) >= baseline; no regression on safety evaluations | N/A -- not serving traffic | 1-4 weeks |
| **2. Shadow Mode** | Shadow model outputs match production quality >= 90% agreement; TTFT/TPS within SLO budget | Quality divergence > 15% from production model for 2 hours | 1-2 weeks |
| **3. Canary (1-5% traffic)** | TTFT p99 within SLO; output quality stable; GPU utilization within expected range | TTFT SLO breach for 10 min, quality regression detected by online evaluator, or OOM errors | 1-2 weeks |
| **4. Human-Reviewed Production** | Human evaluation on sampled outputs; safety team sign-off; cost-per-token within budget | Safety evaluation failure, quality score drop > 5%, or cost anomaly | 1-2 weeks |
| **5. Autonomous Production** | Full traffic with continuous monitoring; auto-scaling active; speculative decoding tuned | Any SLO breach, MFU drop > 20%, training loss anomaly, or safety flag | Ongoing |
| **6. Instant Rollback** | Weight version pointer swap to previous model; quantized variant fallback available | Triggered manually or by automated quality/safety monitor | < 1 minute (pointer swap) |

> **LLM Infrastructure specifics:** Stage 1 is extended for training infrastructure changes -- a full evaluation suite (safety, accuracy, bias, toxicity) must pass before any new model weights enter shadow mode. For inference optimizations (quantization, batching), stages 2-3 can be compressed since they don't change model behavior.
