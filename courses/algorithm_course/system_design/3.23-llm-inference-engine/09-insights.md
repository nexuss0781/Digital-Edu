# Key Insights: LLM Inference Engine

## Insight 1: PagedAttention Trades 5% Latency for 4-10x Throughput

**Category:** Data Structures
**One-liner:** Borrowing OS-style virtual memory paging for KV cache management eliminates 60-95% memory waste from pre-allocation, enabling 4-10x more concurrent requests at the cost of an indirect block table lookup per attention computation.

**Why it matters:** Traditional attention implementations allocate contiguous memory for the maximum sequence length (e.g., 4K tokens) per request, but average usage is only 500 tokens -- wasting 87.5% of GPU memory. PagedAttention divides KV cache into fixed-size blocks (16 tokens each) and allocates on demand through a block table that maps logical positions to physical blocks. The kernel must now perform an indirection per block -- looking up the physical block ID from the block table before loading K/V data -- which adds 5-10% latency overhead. But this overhead is dwarfed by the throughput gain: near-zero waste means the same GPU memory can serve 4-10x more concurrent requests. The block table also enables copy-on-write for beam search (shared prefix blocks between beams) and non-contiguous allocation (any free block can map to any logical position). The key insight is that PagedAttention doesn't need physical contiguity -- some implementations incorrectly try to find contiguous free regions, causing false OOM errors when scattered free blocks exist.

---

## Insight 2: Disaggregated Prefill/Decode Exploits the Compute-Memory Asymmetry

**Category:** Scaling
**One-liner:** Prefill is compute-bound (60-80% GPU compute utilization) while decode is memory-bound (10-30% compute utilization) -- running them on the same GPU means neither workload runs optimally, and separating them yields 30-50% throughput improvement.

**Why it matters:** A combined serving architecture alternates between compute-heavy prefill and memory-heavy decode on the same GPU, achieving poor utilization of both resources. Worse, a long prefill request blocks decode iterations for all co-batched sequences, causing unpredictable latency spikes (head-of-line blocking). Disaggregated architecture dedicates separate GPU pools to each phase: prefill workers are optimized for large-batch matrix multiplications, decode workers are optimized for high-concurrency memory-bandwidth workloads. The critical engineering challenge is KV cache transfer between pools -- 328 MB for a 1000-token prompt on a 70B model. NVLink within a node transfers this in 0.4ms, RDMA cross-node in 7ms, and PCIe + network in 26ms. The trade-off is explicit: TTFT increases by 5-15ms (transfer overhead) but throughput improves 30-50% and latency variance drops dramatically. This disaggregation principle applies broadly -- whenever two phases of a pipeline have fundamentally different resource profiles, separating them allows independent optimization.

---

## Insight 3: Memory-Boundedness Makes Batching the Primary Optimization Lever

**Category:** System Modeling
**One-liner:** Decode-phase inference is memory-bound by 300x (21ms to read weights vs 0.07ms to compute), meaning the GPU spends virtually all its time moving data, not computing -- and the only way to amortize this is by processing more sequences per weight read.

**Why it matters:** For a 70B INT8 model on an H100, reading 70 GB of weights takes 21ms at 3.35 TB/s memory bandwidth, while the actual computation (140 GFLOPs) takes only 0.07ms at 1,979 TFLOPS. This 300:1 ratio means the GPU sits idle for 99.7% of a single-sequence decode step. Increasing batch size from 1 to 8 doesn't increase the memory read time (still 21ms to read the same weights) but produces 8 tokens instead of 1, raising throughput from 47 to 380 tokens/sec. This is why continuous batching is so impactful -- by adding new sequences to the batch every iteration (instead of waiting for the entire batch to finish), it maximizes batch size at every step. The practical implication is that any optimization that increases effective batch size (continuous batching, removing padding, preempting long sequences to admit short ones) directly translates to proportional throughput gains, while optimizations that reduce per-token compute have negligible impact.

---

## Insight 4: Per-Worker Block Pools Eliminate Allocation Contention

**Category:** Contention
**One-liner:** A single global free list for KV cache blocks creates 10-50% scheduler overhead from lock contention at high concurrency -- per-worker pools with work-stealing reduce allocation latency from 500ns to 50ns.

**Why it matters:** The continuous batching scheduler allocates and frees KV cache blocks at extremely high frequency -- every token generation for every active sequence. With a single mutex-protected global free list, every allocation/deallocation contends for the same lock across all scheduler threads. At high load, threads spend more time waiting for the lock than doing useful work. The per-worker pool design gives each scheduler thread its own local pool (fast path: pop from local pool, no lock required). When a local pool is empty, the thread steals half the blocks from another worker's pool (infrequent, 1-5 microsecond overhead). Only when all worker pools are depleted does the system fall back to the global pool under a lock (extremely rare). This is the same pattern used in jemalloc (per-thread arenas) and Go's goroutine scheduler (per-P run queues with work stealing), applied to GPU memory management.

---

## Insight 5: SLRU Hybrid Policy Prevents Prefix Cache Eviction Storms

**Category:** Caching
**One-liner:** Pure LRU eviction causes cache storms where a burst of new requests evicts all warm prefix entries at once -- a segmented LRU with probationary and protected segments ensures frequently-used system prompts survive traffic bursts.

**Why it matters:** Prefix caching (RadixAttention) stores computed KV cache for shared prefixes like system prompts, avoiding redundant prefill computation. Under LRU eviction, a sudden burst of requests with new prefixes evicts all existing warm entries, causing cache hit rate to drop to zero and forcing recomputation of common system prompts for every subsequent request until the cache re-warms. The SLRU hybrid assigns new entries to a probationary segment (20% of cache) and promotes them to the protected segment (80%) only after a second access. Eviction always targets probationary entries first. This means a burst of one-time prefixes cycles through the probationary segment without touching the protected segment's warm entries. Hit rate improves 20-30% for bursty workloads, and the critical shared system prompts (which are accessed repeatedly across many requests) remain cached through traffic spikes.

---

## Insight 6: CUDA Graphs Reduce Decode Iteration Overhead by 10x

**Category:** Scaling
**One-liner:** Python scheduler overhead (200-500 microseconds) between GPU decode iterations causes 30-50% GPU idle time -- pre-recording the entire decode step as a CUDA graph replays it in 50 microseconds with a single kernel launch.

**Why it matters:** Each decode iteration involves dozens of CUDA kernel launches (attention, feed-forward, normalization), each with 5-20 microseconds of launch overhead from the Python runtime. For small batch sizes where the actual GPU computation is fast (under 1ms), this launch overhead dominates -- the GPU finishes work and idles while Python prepares the next iteration. CUDA graphs record the entire sequence of GPU operations during a warmup pass, then replay the recorded graph with a single dispatch. The trade-off is rigidity: graphs require fixed batch sizes and memory layouts, so the engine pre-captures graphs for common batch sizes (1, 4, 8, 16, 32) and falls back to eager execution for unusual sizes. The practical impact is most significant at low batch sizes and small models, where GPU compute time per iteration is shortest and Python overhead is proportionally largest. At batch size 1, CUDA graphs can double effective throughput.

---

## Insight 7: Speculative Decoding is Temperature-Gated

**Category:** System Modeling
**One-liner:** Speculative decoding achieves 2-3x speedup at greedy/low temperature (85-95% acceptance rate) but degrades to near-useless at temperature above 0.7 (25-40% acceptance rate) -- making it a conditional optimization, not a universal one.

**Why it matters:** Speculative decoding uses a small draft model to propose K tokens, then verifies all K in a single target model forward pass. When verification accepts most draft tokens, you generate K+1 tokens for the cost of 1 target forward pass -- a dramatic speedup. But acceptance follows the formula min(1, p_target/p_draft), and at high temperature both distributions flatten, causing frequent mismatches. At temperature 1.5, acceptance drops to 25-40%, meaning the draft model's computation is mostly wasted and the verification pass adds overhead for minimal token gain. The practical implication is that the engine must dynamically enable/disable speculation based on sampling parameters: greedy decoding (code generation, factual QA) gets full speculative benefit, while creative tasks (storytelling, brainstorming at high temperature) should bypass it. Furthermore, draft model quality degrades on certain domains (code, math) where the draft model's training distribution differs from the target -- the engine should monitor rolling acceptance rates and disable speculation when they drop below 50%.

---

## Insight 8: Virtual Contiguity Eliminates False OOM

**Category:** Data Structures
**One-liner:** Some KV cache implementations incorrectly require contiguous physical blocks for allocation, reporting out-of-memory when scattered free blocks exist -- PagedAttention's block table provides virtual contiguity, making any free block usable for any logical position.

**Why it matters:** This is a subtle but critical implementation bug. After many allocations and deallocations, free blocks become scattered across physical memory. An incorrect implementation that searches for N contiguous free blocks will fail to find them even though N total free blocks exist -- reporting a false OOM error and rejecting requests unnecessarily. The entire point of PagedAttention's block table is to provide virtual-to-physical mapping, exactly like a page table in an operating system. Any free block can map to any logical position in a sequence. The correct implementation simply pops N blocks from the free list regardless of their physical locations and stores them in the sequence's block table. The kernel handles the indirection during attention computation. This insight is important because some forks and custom implementations introduce this bug, and it manifests only under sustained load where fragmentation accumulates -- making it difficult to reproduce in testing but devastating in production.

---

## Insight 9: Multi-Head Latent Attention Compresses KV Cache by 10-20x at the Model Level

**Category:** Data Structures
**One-liner:** Instead of caching full key-value projections per head, Multi-head Latent Attention (MLA) compresses KV into a low-rank latent vector during training, reducing per-token KV cache from hundreds of kilobytes to tens of kilobytes -- shifting the optimization from runtime memory management to model architecture itself.

**Why it matters:** PagedAttention and KV cache quantization optimize how memory is managed at the engine level, but MLA (pioneered by DeepSeek-V2/V3) addresses KV cache size at the model architecture level. Instead of storing separate K and V tensors for each attention head, MLA projects them into a shared low-rank latent space during training. At inference time, the engine stores only this compressed latent vector per token, then reconstructs full K and V on the fly using learned up-projection matrices. For DeepSeek-V3 (671B MoE), this reduces per-token KV cache from ~1.2 MB (standard multi-head attention) to ~60-100 KB -- a 10-20x compression that fundamentally changes capacity planning. The trade-off is additional compute for the up-projection during attention, but since decode is memory-bound by 300x, trading a small amount of compute for massive memory savings is overwhelmingly positive. This insight reveals a broader principle: the most impactful optimizations often come from co-designing the model architecture with inference constraints, not just optimizing the runtime.

---

## Insight 10: Prefix-Aware Scheduling Turns Cache Hit Rate from Passive Metric to Active Optimization

**Category:** Scheduling
**One-liner:** Standard schedulers treat prefix cache hits as lucky coincidences, but prefix-aware scheduling actively routes requests to maximize cache reuse -- transforming a 30-50% passive hit rate into 60-80% by clustering requests with shared prefixes on the same instances.

**Why it matters:** In a multi-instance deployment, a standard load balancer distributes requests across instances based on load (least-outstanding-requests), ignoring prefix similarity. If 100 requests share a system prompt, they might scatter across 8 instances, each computing and caching the same prefix independently. A prefix-aware scheduler hashes the system prompt (or the first N tokens) and routes requests with identical prefixes to the same instance, maximizing cache hits. This is analogous to consistent hashing in distributed caches -- the routing decision considers data locality, not just load balance. The implementation adds a prefix-hash-to-instance mapping at the load balancer, with fallback to load-based routing when the preferred instance is overloaded. The 2025-2026 era saw this pattern formalized in orchestration layers: rather than treating routing and caching as separate concerns, production systems now co-optimize them, recognizing that the cheapest prefill is the one you never compute.

---

## Insight 11: Zero-Overhead Scheduling Eliminates Python as the Slowest part of the process Between GPU Iterations

**Category:** Contention
**One-liner:** Python-based schedulers in first-generation inference engines (vLLM v0, TGI) added 100-500 microseconds between GPU forward passes -- the 2025 generation of engines (SGLang, vLLM V1) moved scheduling logic to overlap with GPU execution, achieving near-zero CPU overhead between iterations.

**Why it matters:** In early inference engine architectures, the scheduling loop was synchronous: GPU executes forward pass → CPU runs scheduler (Python) → GPU executes next forward pass. The CPU scheduling step -- even optimized Python -- takes 100-500 microseconds due to interpreter overhead, GIL contention, memory allocation decisions, and block table updates. For small-batch decode where GPU work finishes in under 1 millisecond, this CPU gap represents 10-50% of the total iteration time. The zero-overhead approach overlaps scheduling with GPU execution: while the GPU runs forward pass N, the CPU prepares the batch for forward pass N+1 in a separate thread. The scheduler's decisions for iteration N+1 (which sequences to add/remove, which blocks to allocate) are finalized before the GPU finishes iteration N, so the next forward pass can launch immediately. Combined with CUDA graphs for the GPU portion, this eliminates the CPU-GPU serialization gap entirely. The broader lesson is that in heterogeneous CPU+GPU systems, the critical optimization is often not making either component faster, but pipelining them so neither waits for the other.

---

## Insight 12: Expert Parallelism Creates a Third Dimension of Model Sharding for MoE Inference

**Category:** Scaling
**One-liner:** Mixture-of-Experts models activate only a fraction of parameters per token (e.g., 37B of 671B in DeepSeek-V3), making traditional tensor parallelism wasteful -- expert parallelism distributes experts across GPUs and routes tokens dynamically, requiring all-to-all communication but dramatically reducing per-GPU memory and compute.

**Why it matters:** Standard tensor parallelism shards every layer's weights evenly across GPUs, which works well for dense models. But MoE models have a fundamentally different structure: a shared attention layer (dense) plus a routing layer that selects 2-8 experts out of hundreds. With TP, each GPU holds a fraction of every expert but only a fraction of experts are active per token -- most of the sharded weights sit idle. Expert parallelism (EP) instead assigns complete experts to specific GPUs. When a token is routed to expert 5, which lives on GPU 2, the token's hidden states are sent to GPU 2 via all-to-all communication, processed, and sent back. This requires dynamic communication patterns (unlike TP's fixed AllReduce) but means each GPU only holds and processes the experts assigned to it. For DeepSeek-V3 with 256 experts on 8 GPUs, each GPU holds 32 experts -- using 32/256 = 12.5% of expert memory versus 100% with TP. Production deployments combine EP for the MoE layers with TP for the dense attention layers, creating a hybrid parallelism strategy. The challenge is load balancing: if routing is skewed (some experts are "popular"), their host GPUs become hotspots. Solutions include expert replication (place popular experts on multiple GPUs) and auxiliary loss functions during training that encourage balanced routing.
