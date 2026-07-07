# Deep Dive and Bottlenecks

## Deep Dive 1: Wake Word Detection

### Why This Component is Critical

Wake word detection is the entry point to the entire voice assistant experience. It must:
- Run continuously 24/7 on battery-constrained devices
- Achieve near-instant response (<200ms) when triggered
- Maintain extremely low false positive rates (privacy)
- Work reliably across diverse acoustic environments

**Failure Impact:**
- False accepts → Privacy violations, unwanted activations
- False rejects → Frustration, perceived unresponsiveness
- High latency → Unnatural conversation start
- High power → Battery drain on mobile devices

### Architecture Deep Dive

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Wake Word Detection Pipeline                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    ALWAYS-ON AUDIO FRONTEND                              ││
│  │                                                                          ││
│  │   Microphone     VAD           Ring Buffer                              ││
│  │      │           (Energy)         │                                     ││
│  │      ▼           │                ▼                                     ││
│  │   ┌─────┐    ┌───┴───┐    ┌──────────────┐                             ││
│  │   │ ADC │───▶│ Gate  │───▶│ 2-sec Audio  │                             ││
│  │   └─────┘    └───────┘    │   Buffer     │                             ││
│  │   16kHz                   └──────────────┘                             ││
│  │                                  │                                      ││
│  │   Power: ~0.5mW (DSP)           │                                      ││
│  └──────────────────────────────────│──────────────────────────────────────┘│
│                                     │                                       │
│                                     ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    FEATURE EXTRACTION (DSP)                              ││
│  │                                                                          ││
│  │   ┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐       ││
│  │   │   Pre-    │   │  Hamming  │   │   FFT     │   │   Mel     │       ││
│  │   │ Emphasis  │──▶│  Window   │──▶│  256pt    │──▶│ Filterbank│       ││
│  │   │  α=0.97   │   │   25ms    │   │           │   │  26 bands │       ││
│  │   └───────────┘   └───────────┘   └───────────┘   └───────────┘       ││
│  │                                                          │              ││
│  │                                                          ▼              ││
│  │                                               ┌───────────────┐         ││
│  │                                               │     MFCC      │         ││
│  │                                               │   13 coeffs   │         ││
│  │                                               │  + Δ + ΔΔ     │         ││
│  │                                               │   = 39 feats  │         ││
│  │                                               └───────────────┘         ││
│  │   Power: ~1mW (DSP)                                  │                  ││
│  └──────────────────────────────────────────────────────│──────────────────┘│
│                                                         │                   │
│                                                         ▼                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    NEURAL NETWORK INFERENCE (NPU)                        ││
│  │                                                                          ││
│  │   Context Window: 75 frames (1.5 seconds)                               ││
│  │                                                                          ││
│  │   ┌─────────────────────────────────────────────────────────────────┐   ││
│  │   │                     CNN Architecture                             │   ││
│  │   │                                                                  │   ││
│  │   │   Input: [75 × 39]                                              │   ││
│  │   │      │                                                          │   ││
│  │   │      ▼                                                          │   ││
│  │   │   Conv2D(32, 3×3) + ReLU + BatchNorm                           │   ││
│  │   │      │                                                          │   ││
│  │   │   MaxPool(2×2)                                                  │   ││
│  │   │      │                                                          │   ││
│  │   │   Conv2D(64, 3×3) + ReLU + BatchNorm                           │   ││
│  │   │      │                                                          │   ││
│  │   │   MaxPool(2×2)                                                  │   ││
│  │   │      │                                                          │   ││
│  │   │   Conv2D(128, 3×3) + ReLU                                      │   ││
│  │   │      │                                                          │   ││
│  │   │   GlobalAvgPool                                                 │   ││
│  │   │      │                                                          │   ││
│  │   │   Dense(64) + ReLU                                             │   ││
│  │   │      │                                                          │   ││
│  │   │   Dense(2) + Softmax → [P(wake_word), P(not_wake_word)]        │   ││
│  │   │                                                                  │   ││
│  │   └─────────────────────────────────────────────────────────────────┘   ││
│  │                                                                          ││
│  │   Model Size: 14KB (INT8 quantized)                                     ││
│  │   Inference: ~5ms on DSP, ~50ms on CPU                                  ││
│  │   Power: ~10mW (NPU/DSP)                                                ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│                                     │                                       │
│                                     ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    POST-PROCESSING & DECISION                            ││
│  │                                                                          ││
│  │   Confidence Score ─────▶ Threshold (0.95)                              ││
│  │          │                      │                                       ││
│  │          │         ┌────────────┴────────────┐                          ││
│  │          │         │                         │                          ││
│  │          ▼         ▼                         ▼                          ││
│  │   ┌─────────────────────┐         ┌─────────────────────┐              ││
│  │   │  score >= 0.95      │         │  score < 0.95       │              ││
│  │   │  + debounce (2s)    │         │  Continue monitoring│              ││
│  │   │         │           │         └─────────────────────┘              ││
│  │   │         ▼           │                                               ││
│  │   │  TRIGGER DETECTED   │                                               ││
│  │   │  • LED on           │                                               ││
│  │   │  • Wake main CPU    │                                               ││
│  │   │  • Start streaming  │                                               ││
│  │   └─────────────────────┘                                               ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Model Architecture Comparison

| Model Type | Size | Accuracy | Power | Latency | Best For |
|------------|------|----------|-------|---------|----------|
| **CNN + MFCC** | 14KB | 95% | ~1mW | 100ms | Smart speakers, IoT |
| **CRNN** | 50KB | 96% | ~3mW | 120ms | Multi-word wake phrases |
| **Conformer-S** | 5MB | 98% | ~10mW | 150ms | High-end devices |
| **Transformer** | 20MB | 99% | ~50mW | 200ms | Cloud fallback |

### False Accept/Reject Trade-off

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    False Accept Rate vs False Reject Rate                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  FA Rate │                                                                   │
│  (per    │ ████                                                             │
│  device  │ ████████                                                         │
│  per     │ ████████████                                                     │
│  day)    │ ████████████████                                                 │
│          │ ████████████████████                                             │
│    10    │ ████████████████████████                                         │
│          │ ████████████████████████████                                     │
│          │ ████████████████████████████████                                 │
│     1    ├──────────────────────────────────█████ ← Operating Point         │
│          │                                   │    │   (threshold=0.95)      │
│    0.1   │                                   │    │                         │
│          │                                   │    │                         │
│   0.01   │                                   │    │████████                 │
│          └───────────────────────────────────┴────┴─────────────────────────│
│          0%        5%        10%       15%       20%       25%   FR Rate    │
│                                                                              │
│  Goal: FA < 1/week/device (0.14/day), FR < 5%                              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Adversarial Attack Vectors

| Attack Type | Description | Mitigation |
|-------------|-------------|------------|
| **Ultrasonic** | Inaudible high-frequency signals | Lowpass filter at 8kHz |
| **Replay Attack** | Recorded wake word playback | Liveness detection, environment fingerprint |
| **Near-Miss** | Similar-sounding words ("Alexis", "Election") | Anti-trigger training |
| **Dolphin Attack** | Modulated ultrasound commands | Hardware filtering, anomaly detection |
| **Hidden Voice** | Commands hidden in music/noise | Multi-channel analysis |

### Slowest part of the process Analysis

| Slowest part of the process | Impact | Mitigation |
|------------|--------|------------|
| Power consumption | Battery drain on mobile | Tiered detection (VAD → CNN) |
| False accepts | Privacy, annoyance | Higher threshold, cloud verification |
| Environmental noise | Missed triggers | Noise-robust features, beamforming |
| Near-miss words | False triggers | Negative training examples |
| Multi-speaker overlap | Wrong user detected | Voice profile before trigger |

---

## Deep Dive 2: Streaming ASR Pipeline

### Why This Component is Critical

ASR is the largest latency contributor in the voice pipeline and directly impacts perceived system quality. Users expect:
- Real-time transcription (see words appear as they speak)
- High accuracy across accents, noise levels, and vocabularies
- Low latency (<300ms from speech end to transcript)

### Streaming Architecture (RNN-T)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Streaming ASR Architecture (RNN-Transducer)               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Audio Input (16kHz, Opus)                                                  │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    FEATURE EXTRACTION                                    ││
│  │                                                                          ││
│  │   Opus Decode → Mel Spectrogram (80 bins, 10ms hop)                     ││
│  │                                                                          ││
│  │   Output: [T × 80] where T = num_frames                                 ││
│  └──────────────────────────────────┬──────────────────────────────────────┘│
│                                     │                                       │
│                                     ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    ENCODER (Conformer)                                   ││
│  │                                                                          ││
│  │   ┌─────────────────────────────────────────────────────────────────┐   ││
│  │   │                    Conformer Block × 12                          │   ││
│  │   │                                                                  │   ││
│  │   │   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   │   ││
│  │   │   │  Feed    │   │  Self    │   │  Conv    │   │  Feed    │   │   ││
│  │   │   │ Forward  │──▶│ Attention│──▶│  Module  │──▶│ Forward  │   │   ││
│  │   │   │  (FF)    │   │ (Causal) │   │ (Depthw) │   │  (FF)    │   │   ││
│  │   │   └──────────┘   └──────────┘   └──────────┘   └──────────┘   │   ││
│  │   │                                                                  │   ││
│  │   │   Causal attention: each frame only attends to past frames      │   ││
│  │   │   Context window: 64 frames (~640ms look-back)                  │   ││
│  │   └─────────────────────────────────────────────────────────────────┘   ││
│  │                                                                          ││
│  │   Output: encoder_output [T × 512]                                      ││
│  └──────────────────────────────────┬──────────────────────────────────────┘│
│                                     │                                       │
│       ┌─────────────────────────────┴─────────────────────────────┐        │
│       │                                                           │        │
│       ▼                                                           ▼        │
│  ┌───────────────────────┐                         ┌───────────────────────┐│
│  │   JOINT NETWORK       │                         │   PREDICTION NETWORK  ││
│  │   (Joiner)            │                         │   (Decoder)           ││
│  │                       │                         │                       ││
│  │   Combines encoder    │◀────────────────────────│   LSTM (2 layers)     ││
│  │   and decoder states  │                         │   Input: prev token   ││
│  │                       │                         │   Output: decoder_out ││
│  │   joint = tanh(       │                         │   [512]               ││
│  │     W_enc × enc_out + │                         │                       ││
│  │     W_dec × dec_out   │                         │                       ││
│  │   )                   │                         │                       ││
│  └───────────┬───────────┘                         └───────────────────────┘│
│              │                                                              │
│              ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    OUTPUT PROJECTION                                     ││
│  │                                                                          ││
│  │   Linear(512 → vocab_size + 1)                                          ││
│  │                                                                          ││
│  │   vocab_size = 4096 (wordpieces) + 1 (blank)                           ││
│  │                                                                          ││
│  │   Decoding Loop:                                                        ││
│  │   FOR each encoder frame:                                               ││
│  │     WHILE output != blank:                                              ││
│  │       joint = joiner(encoder_frame, decoder_state)                      ││
│  │       token = argmax(output_projection(joint))                          ││
│  │       IF token == blank: BREAK                                          ││
│  │       emit(token)                                                       ││
│  │       decoder_state = decoder(token, decoder_state)                     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  Streaming Output:                                                          │
│  • Partial transcripts emitted every ~100ms                                │
│  • Final transcript after end-of-utterance detection                       │
│  • Optional: LM rescoring for final hypothesis                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Latency Waterfall

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ASR Latency Breakdown                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Component                 Latency (ms)                                     │
│  ─────────────────────────────────────                                      │
│                                                                              │
│  Audio capture (frame)     |████|                                    20ms   │
│                                                                              │
│  Network to gateway        |██████|                                  30ms   │
│                                                                              │
│  Feature extraction        |██|                                       5ms   │
│                                                                              │
│  Encoder forward           |████████████████████████████|            50ms   │
│  (per frame, batched)                                                       │
│                                                                              │
│  Joint + Decoder           |████|                                    10ms   │
│                                                                              │
│  ────────────────────────────────────                                       │
│  Per-frame total           ~115ms                                           │
│                                                                              │
│  End-of-utterance wait     |████████████████████████████████████|   800ms  │
│  (silence detection)                                                        │
│                                                                              │
│  LM rescoring (optional)   |████████████████|                        50ms   │
│                                                                              │
│  ════════════════════════════════════                                       │
│  Time to first partial:    ~150ms                                           │
│  Time to final transcript: ~300-500ms after speech ends                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Contextual Biasing

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Contextual Biasing System                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Problem: "Call John Smith" transcribes as "Call John Smyth"               │
│  Solution: Boost probability of user's contact names                        │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  Context Sources                                                        ││
│  │                                                                          ││
│  │  • User contacts: ["John Smith", "Jane Doe", ...]                       ││
│  │  • Music library: ["The Beatles", "Billie Eilish", ...]                 ││
│  │  • Smart home devices: ["Living Room Lights", "Bedroom Fan", ...]       ││
│  │  • Recent queries: ["pizza places", "weather tomorrow", ...]            ││
│  │  • Current skill context: ["rock", "pop", "jazz"] (in music skill)      ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  Biasing Mechanism                                                       ││
│  │                                                                          ││
│  │  1. Build prefix tree (trie) from context phrases                       ││
│  │  2. During decoding, track active trie nodes                            ││
│  │  3. When partial hypothesis matches trie prefix, boost logits:          ││
│  │                                                                          ││
│  │     biased_logits[token] = logits[token] + λ × trie_bonus               ││
│  │                                                                          ││
│  │     where λ = context_weight (tunable, ~0.3-0.5)                        ││
│  │           trie_bonus = 1.0 if token continues valid prefix              ││
│  │                                                                          ││
│  │  4. Result: "John Smith" probability boosted when user speaks it        ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### ASR Slowest part of the process Analysis

| Slowest part of the process | Impact | Mitigation |
|------------|--------|------------|
| Network latency | +30-100ms RTT | Edge ASR deployment |
| Encoder compute | Main latency source | GPU batching, model Cutting off unnecessary steps |
| OOV words | High WER on names | Contextual biasing |
| Noisy environments | Accuracy degradation | Noise-robust training, beamforming |
| Accents | Higher WER for non-native | Multi-accent training data |
| Long utterances | Memory growth | Chunked processing |

---

## Deep Dive 3: NLU Intent + Slot Classification

### Why This Component is Critical

NLU determines which skill handles the request and extracts parameters. Errors here cascade:
- Wrong intent → Wrong skill invoked → Bad user experience
- Missing slots → Skill can't execute → Follow-up prompts needed
- Wrong slot values → Incorrect action → User frustration

### Joint Model Architecture (JointBERT)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    JointBERT Architecture                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Input: "play jazz music on spotify"                                        │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    TOKENIZATION                                          ││
│  │                                                                          ││
│  │  [CLS]  play  jazz  music  on  spot  ##ify  [SEP]                       ││
│  │    ↓     ↓     ↓     ↓     ↓    ↓      ↓      ↓                         ││
│  │  101   2377  11370  2189  1006  3962   9020  102                        ││
│  └──────────────────────────────────┬──────────────────────────────────────┘│
│                                     │                                       │
│                                     ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    BERT ENCODER                                          ││
│  │                                                                          ││
│  │   ┌───────────────────────────────────────────────────────────────────┐ ││
│  │   │  Transformer Encoder × 12 layers                                  │ ││
│  │   │                                                                    │ ││
│  │   │  • Hidden size: 768                                               │ ││
│  │   │  • Attention heads: 12                                            │ ││
│  │   │  • Parameters: 110M (or 66M for DistilBERT)                       │ ││
│  │   └───────────────────────────────────────────────────────────────────┘ ││
│  │                                                                          ││
│  │   Output:                                                                ││
│  │   • pooled_output: [768] (from [CLS])                                   ││
│  │   • sequence_output: [seq_len × 768] (all tokens)                       ││
│  └──────────────────────────────────┬──────────────────────────────────────┘│
│                                     │                                       │
│              ┌──────────────────────┴──────────────────────┐               │
│              │                                             │               │
│              ▼                                             ▼               │
│  ┌───────────────────────────┐             ┌───────────────────────────┐  │
│  │   INTENT CLASSIFIER       │             │   SLOT CLASSIFIER         │  │
│  │                           │             │                           │  │
│  │   Input: pooled_output    │             │   Input: sequence_output  │  │
│  │   [768]                   │             │   [seq_len × 768]         │  │
│  │                           │             │                           │  │
│  │   Linear(768 → 256)       │             │   Linear(768 → 256)       │  │
│  │   ReLU                    │             │   ReLU                    │  │
│  │   Dropout(0.1)            │             │   Dropout(0.1)            │  │
│  │   Linear(256 → num_intents)│            │   Linear(256 → num_tags)  │  │
│  │                           │             │                           │  │
│  │   Output: [num_intents]   │             │   Output: [seq_len × tags]│  │
│  └─────────────┬─────────────┘             └─────────────┬─────────────┘  │
│                │                                         │                 │
│                ▼                                         ▼                 │
│  ┌───────────────────────────┐             ┌───────────────────────────┐  │
│  │   Intent: PlayMusicIntent │             │   Slot Tags (BIO):        │  │
│  │   Confidence: 0.96        │             │                           │  │
│  │                           │             │   [CLS]  → O              │  │
│  │   Alternatives:           │             │   play   → O              │  │
│  │   • SearchMusicIntent 0.02│             │   jazz   → B-genre        │  │
│  │   • GetInfoIntent 0.01    │             │   music  → O              │  │
│  │                           │             │   on     → O              │  │
│  │                           │             │   spot   → B-app          │  │
│  │                           │             │   ##ify  → I-app          │  │
│  │                           │             │   [SEP]  → O              │  │
│  └───────────────────────────┘             └───────────────────────────┘  │
│                                                                            │
│  Final Output:                                                             │
│  • Intent: PlayMusicIntent (confidence: 0.96)                             │
│  • Slots: [{name: "genre", value: "jazz"}, {name: "app", value: "spotify"}]│
│                                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Hierarchical Classification for Scale

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Hierarchical NLU for 100K+ Skills                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Problem: Flat classification over 100K+ intents is infeasible             │
│  Solution: Two-stage hierarchical classification                            │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  Stage 1: Domain Classification (~50 domains)                           ││
│  │                                                                          ││
│  │   ┌──────────────────────────────────────────────────────────────┐      ││
│  │   │  "play jazz music on spotify"                                │      ││
│  │   │              │                                                │      ││
│  │   │              ▼                                                │      ││
│  │   │   ┌─────────────────────┐                                    │      ││
│  │   │   │  Domain Classifier  │                                    │      ││
│  │   │   │  (50 classes)       │                                    │      ││
│  │   │   └─────────────────────┘                                    │      ││
│  │   │              │                                                │      ││
│  │   │              ▼                                                │      ││
│  │   │   Domain: MUSIC (0.92)                                       │      ││
│  │   │   Candidates: [MUSIC, SEARCH, GENERAL]                       │      ││
│  │   └──────────────────────────────────────────────────────────────┘      ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                     │                                       │
│                                     ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  Stage 2: Domain-Specific Intent Classification                         ││
│  │                                                                          ││
│  │   ┌──────────────────────────────────────────────────────────────┐      ││
│  │   │  MUSIC Domain Model                                          │      ││
│  │   │  (loaded on-demand)                                          │      ││
│  │   │                                                               │      ││
│  │   │  Intents:                                                    │      ││
│  │   │  • PlayMusicIntent                                           │      ││
│  │   │  • SearchMusicIntent                                         │      ││
│  │   │  • AddToPlaylistIntent                                       │      ││
│  │   │  • LikeSongIntent                                            │      ││
│  │   │  • GetSongInfoIntent                                         │      ││
│  │   │  • ... (20-50 per domain)                                    │      ││
│  │   │                                                               │      ││
│  │   │  Slots: [genre, artist, song, playlist, app, ...]            │      ││
│  │   └──────────────────────────────────────────────────────────────┘      ││
│  │                                                                          ││
│  │   Result:                                                                ││
│  │   • Intent: MUSIC.PlayMusicIntent                                       ││
│  │   • Slots: {genre: "jazz", app: "spotify"}                              ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  Benefits:                                                                  │
│  • Domain model loaded only when needed (memory efficient)                 │
│  • Domain classifier is small and fast (~5ms)                              │
│  • Domain-specific models can be updated independently                      │
│  • Third-party skills can add new intents to their domain                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### NLU Slowest part of the process Analysis

| Slowest part of the process | Impact | Mitigation |
|------------|--------|------------|
| BERT inference | 50-100ms latency | DistilBERT, ONNX optimization |
| Intent ambiguity | Wrong skill routing | Hierarchical classification, confidence thresholds |
| Slot extraction errors | Missing parameters | CRF layer, slot carryover |
| Out-of-domain queries | User confusion | Fallback intent, LLM routing |
| Entity normalization | "tomorrow" → date | Custom normalizers per slot type |

---

## Deep Dive 4: LLM Integration (Modern Assistants)

### Why This Component is Critical

Modern voice assistants (Alexa+, Gemini-powered Google Assistant) integrate LLMs for:
- Open-ended conversations
- Complex multi-step reasoning
- Natural follow-ups without rigid intents
- Handling queries that don't match any skill

### LLM Routing Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LLM Routing Decision System                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  NLU Output                                                                  │
│      │                                                                       │
│      ▼                                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    ROUTING DECISION ENGINE                               ││
│  │                                                                          ││
│  │   Input:                                                                 ││
│  │   • intent_confidence: float                                            ││
│  │   • intent_name: string                                                 ││
│  │   • query_type: enum [command, question, conversation]                  ││
│  │   • user_preference: enum [traditional, llm_enabled]                    ││
│  │                                                                          ││
│  │   Decision Logic:                                                       ││
│  │                                                                          ││
│  │   IF intent_confidence >= 0.90 AND intent in DETERMINISTIC_INTENTS:    ││
│  │       route = TRADITIONAL_SKILL                                         ││
│  │   ELSE IF intent_confidence >= 0.70 AND intent has required_slots:     ││
│  │       route = HYBRID (skill + LLM for conversation)                     ││
│  │   ELSE IF user_preference == llm_enabled:                               ││
│  │       route = FULL_LLM                                                  ││
│  │   ELSE:                                                                 ││
│  │       route = FALLBACK_RESPONSE                                         ││
│  │                                                                          ││
│  │   DETERMINISTIC_INTENTS = {                                             ││
│  │       SetTimerIntent, SetAlarmIntent, TurnOnIntent, TurnOffIntent,      ││
│  │       PlayMusicIntent (basic), GetWeatherIntent, ...                    ││
│  │   }                                                                      ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│              ┌─────────────────────┬─────────────────────┐                 │
│              │                     │                     │                 │
│              ▼                     ▼                     ▼                 │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐      │
│  │  TRADITIONAL      │  │  HYBRID           │  │  FULL LLM         │      │
│  │  SKILL PATH       │  │  PATH             │  │  PATH             │      │
│  │                   │  │                   │  │                   │      │
│  │  • Timer: 5 min   │  │  • Weather +      │  │  • "What caused   │      │
│  │  • Lights: off    │  │    follow-up      │  │    the French     │      │
│  │  • Alarm: 7 AM    │  │  • Music +        │  │    Revolution?"   │      │
│  │                   │  │    conversation   │  │  • Creative tasks │      │
│  │  Latency: <500ms  │  │                   │  │  • Reasoning      │      │
│  │  Cost: ~$0        │  │  Latency: 500ms-2s│  │                   │      │
│  │  Reliability: 99% │  │  Cost: ~$0.001    │  │  Latency: 1-5s    │      │
│  │                   │  │  Reliability: 95% │  │  Cost: ~$0.01     │      │
│  │                   │  │                   │  │  Reliability: 90% │      │
│  └───────────────────┘  └───────────────────┘  └───────────────────┘      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### LLM Integration Challenges

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LLM Integration Challenges & Mitigations                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  CHALLENGE 1: LATENCY                                                       │
│  ───────────────────                                                        │
│  Problem: LLM inference takes 1-5 seconds                                   │
│  Impact: Unnatural conversation flow                                        │
│                                                                              │
│  Mitigations:                                                               │
│  • Streaming TTS: Start speaking before full response ready                 │
│  • Filler audio: "Let me think..." or "Hmm..."                             │
│  • Speculative execution: Pre-warm likely skill paths                       │
│  • Model selection: Use smaller models for simple queries                   │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  CHALLENGE 2: HALLUCINATION                                                 │
│  ────────────────────────────                                               │
│  Problem: LLMs generate plausible but false information                     │
│  Impact: User misinformation, lost trust                                    │
│                                                                              │
│  Mitigations:                                                               │
│  • Grounding: RAG with authoritative sources                               │
│  • Fact-checking: Cross-reference critical claims                           │
│  • Uncertainty expression: "I'm not certain, but..."                       │
│  • Domain restriction: Refuse to answer medical/legal definitively         │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  CHALLENGE 3: SKILL EXECUTION FROM LLM                                      │
│  ──────────────────────────────────────                                     │
│  Problem: LLM needs to invoke structured skills (set timer, play music)    │
│  Impact: Can't execute actions, only generate text                          │
│                                                                              │
│  Mitigations:                                                               │
│  • Function calling: LLM returns structured tool invocations               │
│  • Hybrid execution: LLM generates intent, traditional pipeline executes   │
│  • Action confirmation: "I'll set a timer for 5 minutes. Is that right?"   │
│                                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                              │
│  CHALLENGE 4: COST                                                          │
│  ────────────────                                                           │
│  Problem: $0.01+ per LLM query vs ~$0 for traditional                      │
│  Impact: At 10B queries/day, LLM for all = $100M/day                       │
│                                                                              │
│  Mitigations:                                                               │
│  • Selective routing: Only complex queries go to LLM                       │
│  • Response caching: Cache common LLM responses                             │
│  • Model tiering: Small model for simple, large for complex                │
│  • User tier: Premium users get more LLM access                            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Deep Dive 5: Speech-to-Speech Architecture (2025-2026 Evolution)

### Why This Component is Critical

The traditional six-stage pipeline (wake word → ASR → NLU → dialogue → NLG → TTS) introduces cumulative latency from sequential processing and loses prosodic information when converting audio to text and back. Speech-to-speech models process raw audio directly into audio responses through a unified transformer, eliminating intermediate text representations and reducing end-to-end latency by 40-60%.

### Architecture Comparison

```
┌─────────────────────────────────────────────────────────────────────────────┐
│              Traditional Pipeline vs. Speech-to-Speech Architecture          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  TRADITIONAL (6 stages, ~750-1000ms):                                       │
│                                                                              │
│  Audio → ASR → Text → NLU → Intent → Skill → Text → TTS → Audio            │
│           │              │                      │              │              │
│           └─ Loses       └─ Fixed               └─ Loses      └─ Recreates  │
│              prosody        intent set              context       prosody    │
│                                                                              │
│  SPEECH-TO-SPEECH (unified model, ~300-500ms):                              │
│                                                                              │
│  Audio Input → Audio Encoder → Shared Latent Space → Audio Decoder → Audio  │
│                                       │                                      │
│                                       ├── Reasoning (unified)               │
│                                       ├── Emotion preservation              │
│                                       └── Natural turn-taking               │
│                                                                              │
│  HYBRID PRODUCTION (pragmatic, 2025-2026):                                  │
│                                                                              │
│  Audio Input ──┬──▶ Speech-to-Speech Model ──▶ Audio Response (primary)     │
│                │                                                             │
│                └──▶ Shadow ASR Pipeline ──▶ Transcript (logging/compliance) │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Neural Audio Codec Foundation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Neural Audio Codec Architecture                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Key innovation: Tokenize audio into discrete codes, enabling                │
│  language-model-style sequence prediction over audio                         │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  Audio Encoding                                                         ││
│  │                                                                          ││
│  │  Waveform (24kHz) ──▶ Encoder CNN ──▶ Residual VQ ──▶ Discrete Tokens  ││
│  │                                       (8 codebooks)                      ││
│  │                                                                          ││
│  │  Example: 1 second of audio ≈ 75 tokens per codebook × 8 codebooks     ││
│  │         = 600 tokens total (vs ~16,000 raw samples per second)          ││
│  │                                                                          ││
│  │  Compression: ~10-50× reduction while preserving speaker identity,      ││
│  │  emotion, and acoustic detail                                            ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  Speech-to-Speech Prediction                                            ││
│  │                                                                          ││
│  │  Input audio tokens ──▶ Transformer LLM ──▶ Output audio tokens        ││
│  │                              │                                           ││
│  │                              ├── Understands semantics from audio        ││
│  │                              ├── Reasons in latent space                 ││
│  │                              └── Generates response as audio tokens     ││
│  │                                                                          ││
│  │  Output tokens ──▶ Decoder CNN ──▶ Waveform (response audio)           ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  Advantages:                                                                │
│  • Preserves tone, emotion, emphasis throughout processing                  │
│  • Natural interruption handling (model "hears" overlapping speech)         │
│  • Cross-lingual capability without explicit translation stage              │
│  • Sub-500ms end-to-end latency for conversational responses               │
│                                                                              │
│  Challenges:                                                                │
│  • No intermediate text for debugging ("why did it say that?")             │
│  • Harder to audit for compliance (regulators want text logs)              │
│  • Cannot easily integrate structured skill execution                      │
│  • Larger compute requirements than individual pipeline stages              │
│  • Hallucination in audio space is harder to detect and filter             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Production Deployment Pattern

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Dual-Path Production Architecture                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Design principle: Use speech-to-speech for conversational quality,         │
│  but maintain traditional pipeline for determinism and observability         │
│                                                                              │
│  Audio Input                                                                │
│      │                                                                       │
│      ├──▶ Wake Word Detection (always on-device, unchanged)                 │
│      │                                                                       │
│      ├──▶ Complexity Classifier (should this be a simple command?)          │
│      │        │                                                              │
│      │        ├── HIGH confidence, simple command ──▶ Traditional Pipeline  │
│      │        │   "set timer 5 minutes"                                     │
│      │        │   Advantages: Deterministic, fast, reliable                 │
│      │        │                                                              │
│      │        └── LOW confidence or conversational ──▶ Speech-to-Speech    │
│      │            "tell me about the French Revolution"                      │
│      │            Advantages: Natural, preserves tone, lower latency        │
│      │                                                                       │
│      └──▶ Shadow ASR (always running for logging)                           │
│           Transcript → Compliance logs, quality monitoring, debugging       │
│                                                                              │
│  Cost implication at scale:                                                 │
│  • Traditional path: ~$0 per query (pre-provisioned)                       │
│  • Speech-to-speech: ~$0.005-0.02 per query (GPU inference)                │
│  • Shadow ASR: ~$0.001 per query (already have the infrastructure)         │
│  • At 10B queries/day, speech-to-speech for all = $50-200M/day            │
│  • Selective routing (20% through speech-to-speech) = $10-40M/day          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Speech-to-Speech Slowest part of the process Analysis

| Slowest part of the process | Impact | Mitigation |
|------------|--------|------------|
| Model size | Requires high-end GPUs (80GB+ VRAM) | Quantization (INT4), model distillation |
| Latency for first token | 200-400ms cold start | Speculative decoding, KV cache warmup |
| Debugging without text | Cannot inspect intermediate reasoning | Shadow ASR pipeline, attention visualization |
| Skill integration | Cannot extract structured intents from audio | Parallel intent extraction head on audio embeddings |
| Compliance/auditing | No text logs for regulatory review | Mandatory shadow transcription for regulated domains |
| Multi-language | Code-switching harder without explicit language ID | Multilingual codec training, language-conditioned generation |

---

## Slowest part of the process Mitigation Matrix

| Component | Critical Slowest part of the process | Primary Mitigation | Secondary Mitigation | Fallback |
|-----------|--------------------|--------------------|---------------------|----------|
| **Wake Word** | False accepts | Threshold tuning, 2-stage | Anti-trigger training | Cloud verification |
| **Wake Word** | Power consumption | DSP/NPU offload | Tiered detection (VAD first) | Reduce frequency |
| **ASR** | Latency | Streaming RNN-T | Edge deployment | Cached responses |
| **ASR** | Accuracy (OOV) | Contextual biasing | User vocabulary | Spell check |
| **NLU** | Intent ambiguity | Hierarchical classification | Confidence thresholds | LLM fallback |
| **NLU** | Slot errors | CRF, entity linking | Slot carryover | Clarification prompt |
| **Dialogue** | Context loss | Session persistence | Summarization | Start fresh |
| **Skills** | Third-party latency | Timeout + fallback | Caching | "Try again later" |
| **TTS** | First audio delay | Streaming synthesis | Pre-generation | Canned responses |
| **LLM** | Latency | Streaming, filler audio | Model selection | Traditional skills |
| **LLM** | Cost | Routing, caching | Model tiering | Disable for free tier |
| **LLM** | Hallucination | RAG grounding | Fact-check | Refuse uncertain |

---

## Concurrency and Race Conditions

### Critical Concurrent Scenarios

| Scenario | Race Condition | Resolution |
|----------|---------------|------------|
| **Simultaneous wake words** | Multiple devices hear same wake word | Leader election per room, "I heard that on another device" |
| **Overlapping commands** | User speaks before TTS finishes | Barge-in detection, cancel current response |
| **Multi-user concurrent** | Two users speak to same device | Speaker identification, queue or reject |
| **Skill timeout vs response** | Skill responds after timeout | Idempotent operations, response window |
| **State update during turn** | Dialogue state modified mid-turn | Optimistic locking, session versioning |
| **Device offline sync** | Offline changes sync when online | CRDT for preferences, last-write-wins for state |

---

## Case Study: LLM Integration Into Production Voice Assistant (2025)

### Context

A major voice platform integrated LLM capabilities alongside its existing deterministic skill pipeline, serving 500M+ active devices with 10B+ daily queries.

### Architecture Decisions

```
┌────────────────────────────────────────────────────────────────────┐
│ LLM Integration Architecture                                        │
├────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                     INTENT ROUTER                             │   │
│  │                                                               │   │
│  │   Query Classification (< 5ms):                               │   │
│  │   ┌─────────────────────────────────────────────────────────┐ │   │
│  │   │ Confidence > 0.90 AND known intent → Deterministic Path │ │   │
│  │   │ Confidence < 0.70 OR open-ended    → LLM Path           │ │   │
│  │   │ 0.70 ≤ Confidence ≤ 0.90           → Hybrid Path       │ │   │
│  │   └─────────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Route Distribution (Observed):                                      │
│  • Deterministic: 78% of queries (timers, alarms, smart home)       │
│  • Hybrid: 12% (weather + follow-up, music + conversation)          │
│  • LLM: 10% (open-ended Q&A, creative tasks, complex requests)     │
│                                                                      │
│  Cost Impact:                                                        │
│  • Before LLM: ~$0.001 avg cost/query                               │
│  • With LLM (all): ~$0.012 avg cost/query (12x increase)           │
│  • With routing: ~$0.002 avg cost/query (2x, not 12x)              │
│                                                                      │
│  Latency Impact:                                                     │
│  • Deterministic path: 450ms P50 (unchanged)                        │
│  • Hybrid path: 800ms P50 (slight increase)                         │
│  • LLM path: 2.1s P50 (streaming TTS masks to ~1.2s perceived)     │
│                                                                      │
└────────────────────────────────────────────────────────────────────┘
```

### Key Learnings

| Challenge | Solution | Outcome |
|-----------|----------|---------|
| LLM hallucination on factual queries | RAG grounding with structured knowledge base | 40% reduction in factual errors |
| Function calling reliability | Schema validation + retry with rephrased prompt | 95% → 99.2% tool invocation success |
| User expectation mismatch | Explicit mode indicators ("Let me think about that...") | 30% reduction in user abandonment during LLM queries |
| Cost runaway | Token budget per query class + response caching | Kept total cost increase under 2x |

---

## Emerging Patterns (2025-2026)

### Voice-to-Voice Models

End-to-end models that process audio directly to audio response, bypassing the traditional ASR→NLU→NLG→TTS pipeline:

```
Traditional:  Audio → [ASR] → Text → [NLU] → Intent → [NLG] → Text → [TTS] → Audio

Voice-to-Voice: Audio → [Single Multimodal Model] → Audio
                 Latency: ~400ms (vs ~1000ms traditional)
                 Trade-off: Less controllable, harder to debug, no intermediate text
```

**Impact on architecture:** Voice-to-voice models eliminate pipeline stage boundaries but require new safety mechanisms -- without intermediate text, content filtering must operate on audio embeddings rather than text, and skill invocation requires the model to emit structured function calls alongside audio output.

### Multimodal Voice Assistants

Smart displays and phone assistants combine voice with visual output, requiring synchronized audio-visual response generation:

| Modality Combination | Example | Architectural Impact |
|----|---------|----------------------|
| Voice + Screen | "Show me pasta recipes" | TTS + UI rendering pipeline, visual search |
| Voice + Camera | "What plant is this?" | Image understanding + voice response |
| Voice + AR | Navigation overlay | Spatial audio + visual overlay synchronization |
| Voice + Gesture | Wave to dismiss | Gesture recognition + voice state coordination |

### On-Device LLM Inference

NPU advances enable running 3-7B parameter language models directly on-device:

| Metric | Cloud LLM | On-Device LLM (2025) | On-Device LLM (2026 est.) |
|--------|-----------|----------------------|---------------------------|
| Model Size | 70B+ params | 3-7B params | 7-13B params |
| Latency (TTFT) | 500ms-2s | 200-500ms | 100-300ms |
| Quality (MMLU) | 85%+ | 60-70% | 70-80% |
| Privacy | Audio sent to cloud | Fully on-device | Fully on-device |
| Cost per query | $0.01-0.03 | ~$0 (compute only) | ~$0 |

**Hybrid strategy:** Route privacy-sensitive queries (health, finance) and simple queries to the on-device model, while complex reasoning and multi-step tasks use the cloud model. This preserves privacy for sensitive interactions while maintaining quality for complex ones.
