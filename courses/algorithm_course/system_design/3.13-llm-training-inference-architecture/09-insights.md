# Key Insights: LLM Training & Inference Architecture

## Insight 1: 4D Parallelism Maps Communication Patterns to Hardware Topology

**Category:** Partitioning
**One-liner:** Tensor parallelism uses NVLink within a node while data parallelism uses InfiniBand across nodes because placing high-frequency communication on the fastest interconnect is the key to distributed training efficiency.

**Why it matters:** A 70B model requires ~890 GB of memory (weights + optimizer + gradients + activations), far exceeding any single GPU's 80 GB. 4D parallelism partitions computation along four axes, each matched to the optimal network fabric. Tensor parallelism (TP=8) requires AllReduce at every layer and must use NVLink (900 GB/s intra-node). Pipeline parallelism (PP=2) communicates activations only at micro-batch boundaries via point-to-point sends. Data parallelism (DP=4) performs gradient AllReduce once per step over InfiniBand. Expert parallelism (EP) uses All-to-All for MoE token routing. The result: 890 GB distributed to ~45 GB per GPU across 64 GPUs. Misaligning parallelism dimensions to hardware topology can increase communication overhead from under 30% to over 50% of step time.

---

## Insight 2: LLM Inference Is Memory-Bandwidth Bound, Not Compute-Bound

**Category:** Contention
**One-liner:** Decoding a single token from a 70B model requires reading 280 GB of weights from memory, making GPU memory bandwidth the Slowest part of the process rather than FLOPs.

**Why it matters:** This counterintuitive Slowest part of the process explains why adding more compute alone does not speed up inference. An H100 with 3.35 TB/s bandwidth produces only ~12 tokens/second for a single request on a 70B FP16 model. Batching amortizes weight reads across requests (batch=8 yields ~96 tokens/sec total), and quantization (INT8/INT4) directly doubles or quadruples effective bandwidth. Speculative decoding exploits this by verifying K tokens in a single forward pass (same memory read cost as generating 1 token). Systems that treat inference as compute-bound will overinvest in FLOPs while neglecting the memory-bandwidth optimizations that actually improve throughput.

---

## Insight 3: PagedAttention Applies OS Virtual Memory Concepts to KV Cache

**Category:** Data Structures
**One-liner:** By mapping logical KV blocks to non-contiguous physical GPU memory blocks via a block table, PagedAttention reduces memory waste from 50% to under 5% during inference.

**Why it matters:** KV cache for a 70B model consumes ~5.2 MB per token. With a 32K context, that is 167 GB per request. Naive static allocation pre-allocates for maximum sequence length, wasting 50% of GPU memory on shorter sequences. PagedAttention maps logical blocks to non-contiguous physical blocks via a block table (16 tokens per block), allocating only as tokens are generated. This enables prefix caching (sharing system prompt KV across requests via reference counting for 10-30% memory reduction) and copy-on-write semantics. Preemption strategies (FCFS, priority, LRU) mirror OS process scheduling for memory reclamation. Without paged allocation, long-context serving is practically impossible at scale.

---

## Insight 4: Pipeline Bubbles Create Irreducible Idle Time Proportional to Stage Count

**Category:** Scaling
**One-liner:** Pipeline parallelism wastes (num_stages - 1) / num_microbatches of total compute in warmup and cooldown bubbles, making microbatch count the critical tuning knob.

**Why it matters:** With 4 pipeline stages and 8 microbatches, the bubble fraction is 3/8 = 37.5%, meaning over a third of GPU time is wasted. The 1F1B (one-forward-one-backward) schedule keeps memory constant but does not eliminate bubbles. Practical mitigations include increasing microbatches far beyond stage count, virtual pipeline stages (more fine-grained chunks per GPU), and interleaved schedules. The key design tension is that more pipeline stages reduce memory per GPU but increase the bubble fraction, typically targeting under 10% waste. Architects who add stages for memory relief without proportionally increasing microbatches will see MFU plummet below the 50% target.

---

## Insight 5: Speculative Decoding Trades Draft Model Accuracy for Latency Reduction

**Category:** Cost Optimization
**One-liner:** A small draft model generates multiple candidate tokens cheaply, and the large target model verifies them all in a single forward pass, achieving 2-3x latency reduction while maintaining the exact output distribution.

**Why it matters:** The mathematical guarantee is critical: acceptance probability min(1, q(x)/p(x)) ensures the output distribution is identical to the target model alone. The sweet spot is a draft model around 10% the size of the target (7B draft for 70B target), with K=4-8 draft tokens per verification. This works best for predictable outputs (code, structured data) where draft-target alignment is high (90%+ acceptance rate), but hurts for high-temperature creative generation. Variants like Medusa (multiple prediction heads, 2x speedup), EAGLE-3 (autoregressive head, 2.5x), and self-speculative (early exit from target model, 1.5x) offer different memory-speed tradeoffs.

---

## Insight 6: ZeRO Sharding Progressively Trades Communication for Memory at Three Distinct Stages

**Category:** Scaling
**One-liner:** ZeRO Stage 1 shards optimizer states for a 4x memory reduction, Stage 2 adds gradient sharding for 8x, and Stage 3 shards parameters for Nx reduction, each adding more communication overhead.

**Why it matters:** A 70B model needs 140 GB for weights, 140 GB for gradients, and 560 GB for Adam optimizer states. ZeRO-1 alone reduces optimizer memory from 560 GB to 560/N GB per GPU, often enough to fit on available hardware. ZeRO-3 distributes everything but requires gather operations for every forward and backward pass. Choosing the right ZeRO stage is about finding the minimum communication overhead that allows the model to fit. Over-sharding (using ZeRO-3 when ZeRO-1 suffices) adds unnecessary all-gather latency. Combined with gradient checkpointing (50%+ activation memory savings at the cost of recomputation), these techniques make trillion-parameter training possible on commodity GPU clusters.

---

## Insight 7: Communication-Computation Overlap Hides AllReduce Latency

**Category:** Scaling
**One-liner:** Starting the AllReduce for layer N's gradients while computing the backward pass for layer N-1 can hide up to 100% of communication latency, converting a 35% overhead into near-zero visible cost.

**Why it matters:** For a 70B model on 64 GPUs, AllReduce takes ~5.5 seconds per step against 10 seconds of compute, producing a 35% overhead. By starting AllReduce for each layer's gradients immediately after they are computed during the backward pass, communication overlaps with computation. Combined with hierarchical AllReduce (intra-node NVLink first, then inter-node InfiniBand) and gradient compression (2-10x data size reduction), communication overhead can drop from 35% to under 10%. Without overlap, distributed training throughput scales sub-linearly with GPU count, making large-scale training economically unviable.

---

## Insight 8: Continuous Batching with Preemption Maximizes GPU Utilization During Inference

**Category:** Streaming
**One-liner:** Iteration-level scheduling adds new requests to an in-flight batch at every decode step rather than waiting for the entire batch to complete, eliminating padding waste and enabling preemption for priority requests.

**Why it matters:** Static batching pads all sequences to the longest in the batch. If one request generates 10 tokens and another generates 1000, the short request's GPU slot is idle for 990 steps. Continuous batching inserts a new request into the freed slot immediately. Combined with chunked prefill (splitting long prefills into chunks interleaved with decode steps to prevent latency spikes) and preemption strategies (FCFS, priority-based, LRU), this enables SLA differentiation and 2-10x throughput improvement over static batching. Double-buffering prevents race conditions between batch building and execution.

---

## Insight 9: Barrier-Based Distributed Checkpointing Prevents Inconsistent Recovery

**Category:** Consensus
**One-liner:** All GPU ranks must reach a synchronization barrier before writing their local checkpoint state, because unsynchronized snapshots capture the model at different training steps and produce an irrecoverable inconsistent checkpoint.

**Why it matters:** In distributed training, each rank holds a different shard of weights, optimizer states, and gradients. If ranks checkpoint at different steps, the restored model mixes parameters from step N with optimizer states from step N+1, producing corrupt gradients. The barrier protocol ensures: Rank 0 broadcasts "checkpoint" signal, all ranks complete the current micro-batch, all call barrier(), each saves local state, Rank 0 saves global metadata, all call barrier() again, then resume. With checkpoint sizes of ~280 GB for a 70B model and 10-30 minute intervals, async checkpointing overlaps I/O with training while maintaining consistency guarantees.

---

## Insight 10: Disaggregated Prefill-Decode Architecture Exploits Phase-Specific Bottlenecks

**Category:** Partitioning
**One-liner:** Separating prefill (compute-bound) and decode (memory-bandwidth-bound) into independent GPU pools with KV cache transfer eliminates interference between phases and enables 70-85% utilization versus 40-60% in colocated serving.

**Why it matters:** In colocated serving, a long prefill for one request delays token generation for all concurrent decode requests, creating TTFT spikes. The fundamental insight is that prefill and decode have opposite resource bottlenecks: prefill saturates compute (FLOPs) while decode saturates memory bandwidth. Disaggregated architectures assign compute-optimized GPUs (high FP8 TFLOPS) to prefill and memory-optimized GPUs (high HBM bandwidth) to decode. The cost is KV cache transfer between pools (~20-50ms via RDMA for a 70B model with 1K context). At scale (>50 instances), the utilization improvement and independent scaling yield 20-40% cost savings despite transfer overhead.

---

## Insight 11: MoE Routing Creates a Communication-Compute Trade-off Unique to Expert Architectures

**Category:** Contention
**One-liner:** All-to-All communication for expert routing at every MoE layer can consume 10-20% of step time, making expert placement and load balancing the defining challenges of MoE training at scale.

**Why it matters:** Dense transformer training has well-understood communication patterns (AllReduce for gradients, P2P for pipeline). MoE adds All-to-All: every token must be dispatched to its assigned expert, potentially on a different GPU, and results collected. For DeepSeek-V3 with 256 experts across 16 GPU groups, each MoE layer transfers ~900 MB of token activations. With 60 MoE layers per step, that is 54 GB of All-to-All traffic. Without auxiliary loss or dynamic bias terms, routing becomes imbalanced: popular experts are overloaded while others are idle. The shared-expert pattern (2 always-active experts + 6 routed) provides a stable baseline that reduces routing sensitivity. Expert parallelism (EP) must be co-designed with tensor and data parallelism to minimize cross-node All-to-All traffic.

---

## Insight 12: Radix Attention Trees Enable Hierarchical Prefix Sharing Beyond Hash-Based Caching

**Category:** Caching
**One-liner:** A radix tree (trie) over token sequences enables automatic multi-level prefix sharing — matching system prompts, conversation history, and partial turns — achieving 3-5x cache hit rates compared to hash-based prefix matching.

**Why it matters:** Hash-based prefix caching (used in early vLLM) matches only exact prefix strings. In multi-turn chat, each turn shares the entire conversation history with the previous turn, but a hash mismatch on any token invalidates the entire prefix. Radix attention stores KV cache blocks in a trie keyed by token sequences, enabling automatic longest-prefix matching. Request A with tokens [system, turn1, turn2] and Request B with tokens [system, turn1, turn3] share the [system, turn1] prefix automatically. LRU eviction operates at leaf nodes, preserving popular prefixes. For multi-turn chat workloads, this raises cache hit rates from 10-30% (hash) to 40-80% (radix), reducing redundant prefill computation proportionally. The memory overhead is ~100 bytes per radix node — negligible compared to the KV blocks it indexes.

---
