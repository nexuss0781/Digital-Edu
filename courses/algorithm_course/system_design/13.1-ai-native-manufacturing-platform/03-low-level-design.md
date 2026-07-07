# 13.1 AI-Native Manufacturing Platform — Low-Level Design

## Data Models

### sensor_reading

The fundamental unit of telemetry ingested from the factory floor.

```
sensor_reading {
  reading_id:          uint64            -- monotonically increasing per sensor channel
  sensor_id:           string            -- globally unique: {plant_id}:{cell_id}:{machine_id}:{sensor_type}:{channel}
  timestamp:           uint64            -- nanoseconds since epoch; PTP-synchronized
  value:               float64           -- physical unit value (g, °C, Pa, mm, etc.)
  unit:                string            -- SI unit identifier
  quality_flag:        enum              -- GOOD | UNCERTAIN | BAD | SENSOR_FAULT
  sample_rate_hz:      uint32            -- actual sample rate at capture
  edge_gateway_id:     string            -- which edge gateway ingested this reading
  sequence_number:     uint64            -- per-gateway monotonic; gap detection for data loss
}
```

### digital_twin_asset

A synchronized virtual replica of a physical manufacturing asset.

```
digital_twin_asset {
  asset_id:            UUID              -- globally unique across all plants
  plant_id:            string
  cell_id:             string
  asset_type:          enum              -- CNC_MACHINE | ROBOT_ARM | CONVEYOR | PUMP | COMPRESSOR | AGV | FIXTURE
  asset_class:         string            -- manufacturer model identifier
  geometry_ref:        string            -- URI to 3D model (OpenUSD format)
  kinematics_model:    bytes             -- serialized kinematic chain definition

  -- Real-time synchronized state
  current_state: {
    operational_mode:  enum              -- RUNNING | IDLE | MAINTENANCE | FAULT | EMERGENCY_STOP
    spindle_speed_rpm: float64 | null
    feed_rate_mm_min:  float64 | null
    temperature_map:   map<string, float64>  -- {zone_id: temperature_celsius}
    vibration_rms:     map<string, float64>  -- {bearing_id: rms_g}
    power_draw_kw:     float64
    cycle_count:       uint64            -- total production cycles since last maintenance
    last_sync_at:      uint64            -- nanosecond timestamp of last sensor sync
  }

  -- Health and maintenance state
  health_state: {
    health_index:      float64           -- 0.0 (failed) to 1.0 (new); composite score
    rul_hours:         float64           -- predicted remaining useful life in operating hours
    rul_confidence:    float64           -- 0.0–1.0; confidence in RUL estimate
    rul_model_version: string
    degradation_mode:  string | null     -- detected degradation type (e.g., "bearing_wear", "spindle_imbalance")
    last_maintenance:  timestamp
    next_scheduled:    timestamp | null
    maintenance_tickets: list<ticket_ref>
  }

  -- Production context
  production_state: {
    current_job_id:    UUID | null
    current_part_id:   string | null
    parts_produced:    uint64            -- current shift
    reject_count:      uint64            -- current shift
    oee_current_shift: float64           -- 0.0–1.0
  }

  -- Metadata
  commissioned_at:     timestamp
  firmware_version:    string
  model_versions:      map<string, string>  -- {model_type: deployed_version}
  twin_version:        uint64            -- optimistic concurrency version
}
```

### quality_inspection_result

Output of the inline computer vision quality inspection pipeline.

```
quality_inspection_result {
  inspection_id:       UUID
  camera_id:           string            -- {plant_id}:{cell_id}:{camera_position}
  asset_id:            UUID              -- machine that produced the inspected part
  part_id:             string            -- production part serial number
  job_id:              UUID
  inspected_at:        timestamp         -- PTP-synchronized capture time

  image_ref:           string            -- URI to raw image in edge buffer / cloud store
  image_resolution:    string            -- e.g., "3840x2160"

  result:              enum              -- PASS | FAIL_CRITICAL | FAIL_MINOR | REVIEW
  defects_detected:    list<defect>
    -- each: {
    --   defect_type:    enum             -- CRACK | SCRATCH | DISCOLORATION | DIMENSIONAL | POROSITY | CONTAMINATION | UNKNOWN
    --   confidence:     float64          -- 0.0–1.0; model confidence
    --   bounding_box:   {x, y, width, height}  -- pixel coordinates
    --   severity:       enum             -- CRITICAL | MAJOR | MINOR | COSMETIC
    --   area_mm2:       float64 | null   -- estimated defect area in physical units
    -- }

  model_version:       string            -- CV model version that produced this result
  inference_time_ms:   float64           -- end-to-end inference latency
  edge_gateway_id:     string
  actuator_action:     enum              -- REJECT | FLAG | PASS
  actuator_latency_ms: float64           -- time from detection to actuator signal
}
```

### maintenance_ticket

Auto-generated or manually created maintenance work order linked to PdM predictions.

```
maintenance_ticket {
  ticket_id:           UUID
  asset_id:            UUID
  plant_id:            string

  trigger_type:        enum              -- PDM_PREDICTION | MANUAL | THRESHOLD_ALARM | SCHEDULED
  trigger_source: {
    pdm_model_version: string | null
    rul_at_trigger:    float64 | null    -- predicted RUL hours when ticket was generated
    rul_confidence:    float64 | null
    anomaly_type:      string | null     -- e.g., "bearing_outer_race_fault"
    sensor_evidence:   list<{sensor_id, feature, value, threshold}>
  }

  priority:            enum              -- EMERGENCY | URGENT | PLANNED | DEFERRED
  status:              enum              -- OPEN | ASSIGNED | IN_PROGRESS | COMPLETED | CANCELLED | FALSE_ALARM

  description:         string            -- auto-generated description of predicted failure mode
  recommended_action:  string            -- e.g., "Replace bearing SKF 6205 on spindle A"
  parts_required:      list<{part_number, quantity, lead_time_hours}>

  assigned_to:         string | null     -- maintenance technician ID
  created_at:          timestamp
  scheduled_for:       timestamp | null  -- planned maintenance window
  started_at:          timestamp | null
  completed_at:        timestamp | null

  -- Closed-loop feedback
  actual_condition:    enum | null       -- CONFIRMED_FAILURE | EARLY_DEGRADATION | FALSE_ALARM | DEFERRED
  technician_notes:    string | null
  replacement_parts:   list<string> | null

  cmms_external_id:    string | null     -- ID in external CMMS system
}
```

### production_schedule

Dynamic schedule produced by the RL scheduling engine.

```
production_schedule {
  schedule_id:         UUID
  plant_id:            string
  schedule_horizon:    {start: timestamp, end: timestamp}
  generated_at:        timestamp
  generator_version:   string            -- RL policy version

  jobs: list<scheduled_job>
    -- each: {
    --   job_id:          UUID
    --   order_id:        string           -- production order from MES
    --   part_type:       string
    --   quantity:        integer
    --   priority:        enum             -- RUSH | NORMAL | LOW
    --   assigned_machine: UUID            -- asset_id
    --   start_time:      timestamp
    --   end_time:        timestamp        -- estimated completion
    --   setup_time_min:  float64          -- changeover time from previous job
    --   dependencies:    list<UUID>       -- jobs that must complete first
    -- }

  objective_scores: {
    predicted_oee:       float64          -- 0.0–1.0
    predicted_makespan:  float64          -- hours
    energy_cost:         float64          -- estimated energy cost
    setup_changes:       integer          -- total changeovers
    machine_utilization: map<UUID, float64>  -- per-asset utilization
  }

  disruption_response:  string | null     -- what disruption triggered this re-plan
  status:               enum             -- PROPOSED | ACTIVE | SUPERSEDED | COMPLETED
}
```

---

## API Design

### Edge Gateway APIs (Local, Low-Latency)

```
POST /edge/v1/telemetry/ingest
  -- Batch ingestion of sensor readings from OPC-UA adapter
  Request:
    readings: list<sensor_reading>       -- batch of 100-1000 readings
    gateway_id: string
    batch_sequence: uint64
  Response:
    {accepted: integer, rejected: integer, next_sequence: uint64}
  Latency budget: ≤ 1 ms

GET /edge/v1/twin/{asset_id}/state
  -- Read current digital twin state for a local asset
  Response:
    {asset_id, current_state, health_state, production_state, twin_version}
  Latency budget: ≤ 5 ms

POST /edge/v1/inference/predict
  -- Run inference on edge model (internal, used by control loop)
  Request:
    model_id: string
    input_tensor: bytes                  -- serialized input
    deadline_ns: uint64                  -- hard deadline in nanoseconds
  Response:
    {prediction: bytes, confidence: float64, latency_ns: uint64}
    -- If deadline exceeded: {status: "TIMEOUT", fallback_action: "SAFE_STATE"}
```

### Cloud Platform APIs

```
GET /api/v1/plants/{plant_id}/assets
  Request (query params):
    asset_type: enum (optional)
    health_below: float64 (optional)     -- filter assets with health_index below threshold
    limit: integer (default 100)
  Response:
    {assets: list<{asset_id, asset_type, health_index, rul_hours, operational_mode, oee_current_shift}>}

GET /api/v1/assets/{asset_id}/health-history
  Request (query params):
    start: timestamp
    end: timestamp
    resolution: enum                     -- MINUTE | HOUR | DAY
  Response:
    {asset_id, data_points: list<{timestamp, health_index, rul_hours, vibration_rms, temperature}>}

GET /api/v1/assets/{asset_id}/maintenance-tickets
  Request (query params):
    status: enum (optional)
    limit: integer (default 20)
  Response:
    {tickets: list<maintenance_ticket>}

POST /api/v1/plants/{plant_id}/schedule/optimize
  Request:
    orders: list<{order_id, part_type, quantity, priority, due_date}>
    constraints: {
      machine_availability: map<UUID, list<time_window>>
      maintenance_windows: list<{asset_id, start, end}>
    }
  Response:
    {schedule_id, jobs: list<scheduled_job>, objective_scores}

GET /api/v1/plants/{plant_id}/quality/summary
  Request (query params):
    start: timestamp
    end: timestamp
    group_by: enum                       -- MACHINE | DEFECT_TYPE | SHIFT | PART_TYPE
  Response:
    {summary: list<{group, total_inspected, pass_count, fail_count, defect_rate, top_defect_types}>}

POST /api/v1/models/deploy
  Request:
    model_id: string
    version: string
    target: {plant_id: string, edge_gateways: list<string> | "ALL"}
    strategy: enum                       -- CANARY | ROLLING | IMMEDIATE
    canary_percentage: float64 (default 10)
  Response:
    {deployment_id, status: "INITIATED", estimated_completion: timestamp}
```

### Internal / Service APIs

```
POST /internal/twin/sync
  -- Edge-to-cloud twin state synchronization
  Request:
    asset_id: UUID
    state_delta: {changed_fields: map<string, any>}
    edge_timestamp: uint64
    edge_vector_clock: map<string, uint64>
  Response:
    {accepted: boolean, conflicts: list<{field, edge_value, cloud_value, resolution}>}

POST /internal/pdm/predict-rul
  Request:
    asset_id: UUID
    features: {
      vibration_spectrum: list<float64>  -- FFT magnitudes
      envelope_spectrum: list<float64>
      kurtosis: float64
      rms: float64
      temperature_trend: list<float64>   -- last 24h hourly readings
      operating_hours: float64
      cycle_count: uint64
      last_maintenance_hours_ago: float64
    }
  Response:
    {rul_hours: float64, confidence: float64, degradation_mode: string, risk_score: float64}

POST /internal/cv/annotate
  -- Submit human annotation for CV training pipeline
  Request:
    inspection_id: UUID
    annotations: list<{defect_type, bounding_box, severity, annotator_id}>
  Response:
    {annotation_id, added_to_training_queue: boolean}
```

---

## Core Algorithms

### Algorithm 1: Physics-Informed Remaining Useful Life Estimation

```
FUNCTION estimate_rul(asset: digital_twin_asset, feature_history: list<feature_set>) -> rul_result:

  // Step 1: Extract spectral features from raw vibration waveform
  latest_features = feature_history[-1]
  fft_spectrum = compute_fft(latest_features.raw_waveform, window=HANNING, n_fft=4096)
  envelope_spectrum = compute_envelope_analysis(latest_features.raw_waveform,
                                                 bearing_frequencies=asset.bearing_geometry)
  kurtosis = compute_kurtosis(latest_features.raw_waveform)
  rms = compute_rms(latest_features.raw_waveform)

  // Step 2: Compute health indicator (HI) using physics-based degradation model
  // Paris' law for crack growth: da/dN = C * (delta_K)^m
  // Health indicator maps spectral features to normalized degradation state
  hi_vibration = health_indicator_model.predict(fft_spectrum, envelope_spectrum, kurtosis, rms)
  hi_thermal = thermal_degradation_model.predict(asset.current_state.temperature_map)

  // Weighted fusion of health indicators
  hi_combined = 0.6 * hi_vibration + 0.3 * hi_thermal + 0.1 * normalized_cycle_count(asset)

  // Step 3: Fit degradation trajectory using Wiener process with drift
  // HI(t) = HI_0 + mu*t + sigma*W(t), where W(t) is standard Brownian motion
  historical_hi = [compute_hi(f) FOR f IN feature_history]
  mu, sigma = fit_wiener_process(historical_hi, timestamps)

  // Step 4: Compute RUL as first-passage time to failure threshold
  failure_threshold = get_failure_threshold(asset.asset_type, asset.degradation_mode)
  remaining_hi = failure_threshold - hi_combined

  IF remaining_hi <= 0:
    RETURN {rul_hours: 0, confidence: 0.95, degradation_mode: "CRITICAL"}

  // Expected first-passage time for Wiener process
  rul_expected = remaining_hi / mu  // hours
  rul_variance = (sigma^2 * remaining_hi) / (mu^3)
  rul_confidence = 1.0 - (sqrt(rul_variance) / rul_expected)  // higher confidence = narrower distribution

  // Step 5: Bayesian update with prior from fleet-wide data
  fleet_prior = get_fleet_rul_prior(asset.asset_type, asset.cycle_count)
  rul_posterior = bayesian_update(
    prior=fleet_prior,
    likelihood={mean: rul_expected, variance: rul_variance}
  )

  RETURN {
    rul_hours: rul_posterior.mean,
    confidence: clamp(rul_confidence, 0.1, 0.99),
    degradation_mode: classify_degradation(envelope_spectrum, asset.bearing_geometry),
    risk_score: 1.0 - survival_probability(rul_posterior, horizon=168)  // P(fail within 7 days)
  }
```

### Algorithm 2: Real-Time Defect Detection with Anomaly Fallback

```
FUNCTION detect_defects(image: tensor, camera_config: camera_info) -> inspection_result:

  // Step 1: Preprocess image for model input
  roi = extract_roi(image, camera_config.roi_mask)  // crop to region of interest
  normalized = normalize(roi, mean=IMAGENET_MEAN, std=IMAGENET_STD)
  resized = resize(normalized, target=(640, 640))  // model input size

  // Step 2: Run primary defect detection model (Vision Transformer, INT8 quantized)
  detections = defect_model.predict(resized)
  // detections: list of {class_id, confidence, bbox, segmentation_mask}

  // Step 3: Filter by confidence threshold (per defect type)
  confirmed_defects = []
  uncertain_detections = []
  FOR detection IN detections:
    threshold = get_confidence_threshold(detection.class_id)  // critical defects: 0.7; minor: 0.85
    IF detection.confidence >= threshold:
      confirmed_defects.append(detection)
    ELIF detection.confidence >= threshold * 0.7:  // borderline
      uncertain_detections.append(detection)

  // Step 4: Run anomaly detection for novel defect types
  // Autoencoder trained on "good" parts; reconstruction error = anomaly score
  reconstruction = anomaly_autoencoder.reconstruct(resized)
  reconstruction_error = pixel_wise_mse(resized, reconstruction)
  anomaly_regions = threshold_and_cluster(reconstruction_error, threshold=ANOMALY_THRESHOLD)

  FOR region IN anomaly_regions:
    IF NOT overlaps_any(region, confirmed_defects):  // novel anomaly not caught by classifier
      confirmed_defects.append({
        defect_type: UNKNOWN,
        confidence: anomaly_score(region),
        bbox: region.bounding_box,
        severity: MAJOR  // unknown defects default to MAJOR for safety
      })

  // Step 5: Determine action based on defect severity
  has_critical = any(d.severity == CRITICAL FOR d IN confirmed_defects)
  has_major = any(d.severity == MAJOR FOR d IN confirmed_defects)

  action = PASS
  IF has_critical:
    action = REJECT  // trigger reject actuator immediately
  ELIF has_major:
    action = FLAG    // route to human review queue
  ELIF len(uncertain_detections) > 0:
    action = FLAG    // borderline detections need human verification

  RETURN {
    result: FAIL_CRITICAL if has_critical else (FAIL_MINOR if has_major else PASS),
    defects_detected: confirmed_defects,
    actuator_action: action,
    inference_time_ms: elapsed()
  }
```

### Algorithm 3: Multi-Agent RL Production Scheduling

```
FUNCTION optimize_schedule(
    orders: list<production_order>,
    machines: list<digital_twin_asset>,
    current_schedule: production_schedule | null
) -> production_schedule:

  // Step 1: Build state representation for RL agents
  state = build_scheduling_state(
    machine_states=[{
      asset_id: m.asset_id,
      available_at: m.production_state.current_job_end_time,
      health_index: m.health_state.health_index,
      setup_state: m.production_state.current_part_type,
      capabilities: m.asset_class.supported_operations
    } FOR m IN machines],
    pending_orders=[{
      order_id: o.order_id,
      part_type: o.part_type,
      quantity: o.quantity,
      priority: o.priority,
      due_date: o.due_date,
      required_operations: o.routing
    } FOR o IN orders],
    current_time=now()
  )

  // Step 2: Each machine agent selects next job to process
  // Hierarchical MARL: job prioritization → machine assignment → sequence optimization
  job_priorities = job_priority_agent.select_actions(state)
  machine_assignments = machine_assignment_agent.select_actions(state, job_priorities)

  // Step 3: Sequence jobs on each machine considering setup times
  schedule_jobs = []
  FOR machine_id, assigned_jobs IN machine_assignments.items():
    sorted_jobs = sequence_optimizer.optimize(
      jobs=assigned_jobs,
      current_setup=machines[machine_id].production_state.current_part_type,
      setup_time_matrix=get_setup_matrix(machines[machine_id].asset_class)
    )
    FOR job IN sorted_jobs:
      schedule_jobs.append({
        job_id: job.job_id,
        assigned_machine: machine_id,
        start_time: job.computed_start,
        end_time: job.computed_end,
        setup_time_min: job.setup_time
      })

  // Step 4: Validate schedule against constraints
  violations = validate_schedule(schedule_jobs, constraints={
    maintenance_windows: get_planned_maintenance(machines),
    machine_capabilities: {m.asset_id: m.capabilities FOR m IN machines},
    order_dependencies: extract_dependencies(orders),
    shift_calendar: get_shift_calendar()
  })

  IF len(violations) > 0:
    // Re-run with constraint penalties increased
    schedule_jobs = repair_schedule(schedule_jobs, violations)

  // Step 5: Evaluate schedule in digital twin simulator
  simulated_oee = twin_simulator.evaluate(schedule_jobs, machines)

  RETURN production_schedule {
    jobs: schedule_jobs,
    objective_scores: {
      predicted_oee: simulated_oee.oee,
      predicted_makespan: simulated_oee.makespan_hours,
      energy_cost: simulated_oee.energy_cost,
      setup_changes: count_setups(schedule_jobs)
    }
  }
```

### Algorithm 4: Edge-Cloud Delta Sync Protocol

```
FUNCTION sync_edge_to_cloud(edge_state: edge_buffer, cloud_state: cloud_store) -> sync_result:

  // Step 1: Identify unsynchronized data using vector clocks
  edge_clock = edge_state.get_vector_clock()
  cloud_clock = cloud_state.get_vector_clock()

  delta_assets = []
  FOR asset_id IN edge_clock.keys():
    IF edge_clock[asset_id] > cloud_clock.get(asset_id, 0):
      delta_assets.append(asset_id)

  // Step 2: Extract deltas per asset
  sync_payload = []
  FOR asset_id IN delta_assets:
    asset_deltas = edge_state.get_changes_since(asset_id, cloud_clock.get(asset_id, 0))
    sync_payload.append({
      asset_id: asset_id,
      telemetry_deltas: asset_deltas.telemetry,    // downsampled summaries
      twin_state_deltas: asset_deltas.twin_state,
      inference_logs: asset_deltas.inference_logs,
      inspection_results: asset_deltas.inspections
    })

  // Step 3: Upload with bandwidth-aware throttling
  bandwidth_available = measure_uplink_bandwidth()
  priority_sorted = sort_by_priority(sync_payload)  // safety logs first, then anomalies, then routine

  uploaded = []
  FOR payload IN priority_sorted:
    IF estimated_size(payload) > bandwidth_available * SYNC_WINDOW_SEC:
      payload = compress_and_downsample(payload)  // reduce resolution to fit bandwidth
    result = cloud_state.apply_delta(payload)

    IF result.has_conflicts:
      // Cloud made changes during offline period (e.g., new schedule)
      FOR conflict IN result.conflicts:
        resolution = resolve_conflict(conflict, policy=EDGE_WINS_FOR_SAFETY)
        cloud_state.apply_resolution(conflict.asset_id, resolution)

    uploaded.append(payload.asset_id)

  // Step 4: Pull cloud-to-edge updates (new models, schedule changes)
  cloud_updates = cloud_state.get_pending_edge_updates(edge_state.gateway_id)
  FOR update IN cloud_updates:
    IF update.type == MODEL_UPDATE:
      verify_signature(update.model_artifact, trusted_keys)
      edge_state.stage_model_update(update)
    ELIF update.type == SCHEDULE_UPDATE:
      edge_state.apply_schedule_if_valid(update)

  RETURN {synced_assets: uploaded, conflicts_resolved: count_conflicts, cloud_updates_applied: len(cloud_updates)}
```

---

## Additional Data Models

### edge_model_deployment

Tracks the lifecycle of ML model deployments to edge devices with dual-slot atomic swap.

```
edge_model_deployment {
  deployment_id:       UUID
  model_id:            string              -- e.g., "cv-defect-vit-q8", "pdm-bearing-survival"
  model_version:       string              -- semantic version of model artifact
  target_gateway_id:   string              -- edge gateway receiving the deployment

  artifact: {
    artifact_uri:      string              -- URI in DMZ staging server
    artifact_hash:     bytes[32]           -- SHA-256 of model artifact
    signature:         bytes               -- RSA-4096 signature from HSM
    size_bytes:        uint64
    framework:         enum                -- ONNX | TFLITE | TENSORRT | OPENVINO
    quantization:      enum                -- FP32 | FP16 | INT8 | INT4
    target_accelerator: enum               -- GPU | NPU | VPU | CPU
  }

  deployment_state: {
    status:            enum                -- STAGED | DOWNLOADING | VALIDATING | DEPLOYING |
                                           -- CANARY | ACTIVE | ROLLED_BACK | FAILED
    active_slot:       enum                -- SLOT_A | SLOT_B
    deployed_at:       timestamp | null
    rolled_back_at:    timestamp | null
    rollback_reason:   string | null
  }

  canary_metrics: {
    canary_start:      timestamp | null
    canary_duration:   duration            -- how long to run before promotion
    inference_count:   uint64
    avg_latency_ms:    float64
    p99_latency_ms:    float64
    accuracy_on_ref:   float64 | null      -- accuracy on reference parts
    anomaly_rate:      float64             -- rate of anomalous outputs vs. previous model
    promotion_gate: {
      latency_ok:      boolean             -- p99 < threshold
      accuracy_ok:     boolean             -- reference accuracy ≥ previous model
      anomaly_ok:      boolean             -- anomaly rate < threshold
    }
  }

  created_at:          timestamp
  created_by:          string              -- ML engineer who initiated deployment
}
```

### sensor_feature_set

Pre-computed features extracted from raw sensor waveforms at the edge; the unit of data forwarded to cloud.

```
sensor_feature_set {
  feature_set_id:      UUID
  asset_id:            UUID
  sensor_id:           string
  window_start:        timestamp           -- beginning of extraction window
  window_end:          timestamp           -- end of extraction window
  window_duration_sec: float64             -- typically 15-60 seconds

  spectral_features: {
    fft_magnitudes:    list<float64>        -- FFT magnitude spectrum (N_FFT/2 + 1 bins)
    fft_bin_freq_hz:   list<float64>        -- frequency axis for FFT bins
    envelope_spectrum: list<float64>        -- envelope analysis result
    dominant_freqs:    list<{freq_hz: float64, amplitude: float64, harmonic_of: string | null}>
    spectral_kurtosis: list<float64>        -- per-frequency-band kurtosis
  }

  time_domain_features: {
    rms:               float64             -- root mean square
    peak:              float64             -- maximum absolute value
    crest_factor:      float64             -- peak / rms
    kurtosis:          float64             -- 4th moment; >3 indicates impulsive events
    skewness:          float64             -- 3rd moment; asymmetry indicator
    zero_crossing_rate: float64
  }

  bearing_features: {
    bpfo_amplitude:    float64 | null      -- ball pass frequency outer race
    bpfi_amplitude:    float64 | null      -- ball pass frequency inner race
    bsf_amplitude:     float64 | null      -- ball spin frequency
    ftf_amplitude:     float64 | null      -- fundamental train frequency
    -- These frequencies are computed from bearing geometry; amplitudes at these
    -- frequencies indicate specific fault locations
  }

  thermal_features: {
    avg_temperature:   float64
    max_temperature:   float64
    gradient_deg_per_min: float64          -- rate of temperature change
    ambient_delta:     float64             -- temperature above ambient
  }

  operational_context: {
    spindle_speed_rpm: float64
    feed_rate_mm_min:  float64
    load_percentage:   float64
    material_type:     string | null
    tool_wear_index:   float64 | null
  }

  quality_flags: {
    sensor_health:     enum                -- GOOD | DEGRADED | SUSPECT
    clipping_detected: boolean             -- ADC saturation in raw waveform
    aliasing_risk:     boolean             -- dominant frequency > 0.4 * sample_rate
    ptp_sync_quality:  enum                -- LOCKED | HOLDOVER | FREE_RUNNING
  }

  edge_gateway_id:     string
  extraction_model_version: string         -- version of feature extraction pipeline
}
```

### twin_conflict_event

Records every write conflict to the digital twin and how it was resolved.

```
twin_conflict_event {
  conflict_id:         UUID
  asset_id:            UUID
  detected_at:         timestamp

  writer_a: {
    subsystem:         enum                -- PDM | SCHEDULER | ENERGY_OPTIMIZER | QUALITY | OPERATOR
    operation:         string              -- e.g., "set_spindle_speed", "schedule_maintenance_window"
    proposed_value:    any                  -- the value writer A wants to set
    priority:          uint8               -- from priority hierarchy
    timestamp:         timestamp
  }

  writer_b: {
    subsystem:         enum
    operation:         string
    proposed_value:    any
    priority:          uint8
    timestamp:         timestamp
  }

  resolution: {
    winner:            enum                -- WRITER_A | WRITER_B | MERGED | ESCALATED
    resolved_value:    any
    resolution_rule:   string              -- e.g., "SAFETY_PRIORITY", "HIGHER_PRIORITY_WINS", "MERGE_COMPATIBLE"
    resolved_at:       timestamp
    escalated_to:      string | null       -- human operator if escalated
  }
}
```

---

## Algorithm 5: Digital Twin Priority-Based Write Resolution

```
FUNCTION resolve_twin_write(
    asset: digital_twin_asset,
    pending_writes: list<twin_write_request>
) -> resolution_result:

  // Priority hierarchy (highest to lowest):
  //   1. SAFETY (emergency stop, zone violation response)
  //   2. HUMAN_OVERRIDE (operator manual control)
  //   3. QUALITY (defect-triggered parameter change)
  //   4. PDM (maintenance-driven derating)
  //   5. SCHEDULER (production optimization)
  //   6. ENERGY (energy cost optimization)

  PRIORITY_ORDER = {SAFETY: 1, HUMAN_OVERRIDE: 2, QUALITY: 3, PDM: 4, SCHEDULER: 5, ENERGY: 6}

  // Group writes by the twin field they affect
  writes_by_field = group_by(pending_writes, key=lambda w: w.target_field)

  resolutions = []
  conflicts = []

  FOR field, field_writes IN writes_by_field.items():
    IF len(field_writes) == 1:
      // No conflict — apply directly
      resolutions.append({field: field, value: field_writes[0].value, writer: field_writes[0].subsystem})
      CONTINUE

    // Sort by priority (lowest number = highest priority)
    sorted_writes = sort(field_writes, key=lambda w: PRIORITY_ORDER[w.subsystem])

    // Check if writes are compatible (e.g., both want to reduce speed)
    IF are_compatible(sorted_writes):
      merged = merge_compatible_writes(sorted_writes)
      resolutions.append({field: field, value: merged, writers: [w.subsystem FOR w IN sorted_writes]})
    ELSE:
      // Incompatible writes — highest priority wins
      winner = sorted_writes[0]
      loser = sorted_writes[1]
      resolutions.append({field: field, value: winner.value, writer: winner.subsystem})

      // Log conflict event
      conflict = twin_conflict_event {
        asset_id: asset.asset_id,
        writer_a: winner,
        writer_b: loser,
        resolution: {winner: "WRITER_A", rule: "HIGHER_PRIORITY_WINS"}
      }
      conflicts.append(conflict)

      // If loser is SCHEDULER or above, notify the losing subsystem to re-plan
      IF PRIORITY_ORDER[loser.subsystem] <= 5:
        notify_subsystem(loser.subsystem, "WRITE_REJECTED", {
          asset_id: asset.asset_id,
          field: field,
          rejected_value: loser.value,
          winning_value: winner.value,
          winning_subsystem: winner.subsystem
        })

  // Apply resolutions atomically using twin_version for optimistic concurrency
  new_version = asset.twin_version + 1
  apply_atomic_update(asset.asset_id, resolutions, expected_version=asset.twin_version, new_version=new_version)

  RETURN {applied: resolutions, conflicts: conflicts, new_twin_version: new_version}
```

### Algorithm 6: Edge Model Deployment with Dual-Slot Atomic Swap

```
FUNCTION deploy_model_to_edge(
    gateway: edge_gateway,
    deployment: edge_model_deployment
) -> deployment_result:

  // Step 1: Determine inactive slot (dual-slot A/B deployment)
  active_slot = gateway.get_active_model_slot(deployment.model_id)
  inactive_slot = SLOT_B IF active_slot == SLOT_A ELSE SLOT_A

  // Step 2: Download artifact to inactive slot
  artifact = download_from_staging(deployment.artifact.artifact_uri, timeout=300_sec)
  IF artifact IS null:
    RETURN {status: FAILED, reason: "DOWNLOAD_TIMEOUT"}

  // Step 3: Verify artifact integrity
  computed_hash = sha256(artifact)
  IF computed_hash != deployment.artifact.artifact_hash:
    RETURN {status: FAILED, reason: "HASH_MISMATCH"}

  signature_valid = verify_rsa_signature(
    computed_hash, deployment.artifact.signature, gateway.trusted_public_key
  )
  IF NOT signature_valid:
    RETURN {status: FAILED, reason: "SIGNATURE_INVALID"}

  // Step 4: Load model into inactive slot (takes 2-8 seconds for large models)
  load_result = gateway.load_model_to_slot(inactive_slot, artifact, deployment.artifact.framework)
  IF NOT load_result.success:
    RETURN {status: FAILED, reason: "LOAD_FAILED", detail: load_result.error}

  // Step 5: Run validation inference on reference dataset
  reference_dataset = gateway.get_reference_dataset(deployment.model_id)
  validation_results = []
  FOR sample IN reference_dataset:
    result = gateway.run_inference_on_slot(inactive_slot, sample.input)
    validation_results.append({
      expected: sample.expected_output,
      actual: result.output,
      latency_ms: result.latency_ms
    })

  accuracy = compute_accuracy(validation_results)
  p99_latency = percentile(validation_results.map(r -> r.latency_ms), 99)

  IF accuracy < deployment.canary_metrics.promotion_gate.min_accuracy:
    gateway.unload_slot(inactive_slot)
    RETURN {status: FAILED, reason: "ACCURACY_BELOW_THRESHOLD", accuracy: accuracy}

  IF p99_latency > gateway.get_latency_budget(deployment.model_id):
    gateway.unload_slot(inactive_slot)
    RETURN {status: FAILED, reason: "LATENCY_EXCEEDS_BUDGET", p99_latency: p99_latency}

  // Step 6: Atomic swap — wait for current inference to complete, then switch
  gateway.acquire_inference_lock(deployment.model_id)  // blocks new inferences for <1ms
  gateway.set_active_slot(deployment.model_id, inactive_slot)
  gateway.release_inference_lock(deployment.model_id)

  // Step 7: Enter canary period — both slots loaded, can instant-rollback
  deployment.deployment_state.status = CANARY
  deployment.deployment_state.active_slot = inactive_slot
  deployment.deployment_state.deployed_at = now()

  // Old model remains loaded in previous slot for instant rollback
  // Unloaded only after canary period completes successfully (typically 4-24 hours)

  RETURN {status: CANARY, active_slot: inactive_slot, accuracy: accuracy, p99_latency: p99_latency}
```

### Algorithm 7: Sensor Feature Extraction Pipeline

```
FUNCTION extract_features(
    raw_waveform: list<float64>,
    sample_rate_hz: uint32,
    bearing_geometry: bearing_params | null
) -> sensor_feature_set:

  // Step 1: Validate waveform quality
  IF max(abs(raw_waveform)) >= ADC_MAX_VALUE * 0.99:
    clipping_detected = true  // ADC saturation invalidates frequency analysis

  // Step 2: Apply windowing and compute FFT
  windowed = apply_window(raw_waveform, HANNING, overlap=0.5)
  fft_complex = rfft(windowed, n=4096)
  fft_magnitudes = abs(fft_complex) / len(windowed)
  fft_freq_hz = rfftfreq(4096, d=1.0/sample_rate_hz)

  // Check for aliasing risk
  dominant_freq = fft_freq_hz[argmax(fft_magnitudes[1:])]  // skip DC
  aliasing_risk = dominant_freq > 0.4 * sample_rate_hz

  // Step 3: Compute time-domain statistical features
  rms = sqrt(mean(raw_waveform .^ 2))
  peak = max(abs(raw_waveform))
  crest_factor = peak / rms
  kurtosis = moment(raw_waveform, order=4) / (std(raw_waveform) ^ 4)
  skewness = moment(raw_waveform, order=3) / (std(raw_waveform) ^ 3)

  // Step 4: Envelope analysis for bearing fault detection
  envelope_spectrum = null
  bearing_features = null
  IF bearing_geometry IS NOT null:
    // Bandpass filter around high-frequency resonance band
    band_low = bearing_geometry.resonance_freq * 0.8
    band_high = bearing_geometry.resonance_freq * 1.2
    filtered = bandpass_filter(raw_waveform, band_low, band_high, sample_rate_hz)

    // Hilbert transform to extract envelope
    analytic_signal = hilbert_transform(filtered)
    envelope = abs(analytic_signal)

    // FFT of envelope reveals bearing fault frequencies
    envelope_fft = rfft(apply_window(envelope, HANNING), n=4096)
    envelope_spectrum = abs(envelope_fft) / len(envelope)

    // Extract amplitudes at characteristic bearing frequencies
    bpfo_hz = bearing_geometry.n_balls * bearing_geometry.shaft_speed_hz *
              (1 - bearing_geometry.ball_diameter / bearing_geometry.pitch_diameter * cos(bearing_geometry.contact_angle)) / 2
    bpfi_hz = bearing_geometry.n_balls * bearing_geometry.shaft_speed_hz *
              (1 + bearing_geometry.ball_diameter / bearing_geometry.pitch_diameter * cos(bearing_geometry.contact_angle)) / 2
    bsf_hz = bearing_geometry.pitch_diameter / bearing_geometry.ball_diameter * bearing_geometry.shaft_speed_hz *
             (1 - (bearing_geometry.ball_diameter / bearing_geometry.pitch_diameter * cos(bearing_geometry.contact_angle))^2) / 2

    bearing_features = {
      bpfo_amplitude: interpolate_spectrum(envelope_spectrum, fft_freq_hz, bpfo_hz),
      bpfi_amplitude: interpolate_spectrum(envelope_spectrum, fft_freq_hz, bpfi_hz),
      bsf_amplitude:  interpolate_spectrum(envelope_spectrum, fft_freq_hz, bsf_hz),
      ftf_amplitude:  interpolate_spectrum(envelope_spectrum, fft_freq_hz, bpfo_hz / bearing_geometry.n_balls)
    }

  // Step 5: Compute spectral kurtosis per frequency band
  n_bands = 32
  band_width = (sample_rate_hz / 2) / n_bands
  spectral_kurtosis = []
  FOR band_idx IN range(n_bands):
    band_low = band_idx * band_width
    band_high = (band_idx + 1) * band_width
    band_signal = bandpass_filter(raw_waveform, band_low, band_high, sample_rate_hz)
    spectral_kurtosis.append(compute_kurtosis(band_signal))

  // Step 6: Identify dominant frequencies and harmonic relationships
  dominant_freqs = find_peaks(fft_magnitudes, prominence=3*median(fft_magnitudes), max_peaks=10)
  FOR peak IN dominant_freqs:
    // Check if this frequency is a harmonic of a known shaft/bearing frequency
    peak.harmonic_of = identify_harmonic_source(peak.freq_hz, bearing_geometry, shaft_speed_hz)

  RETURN sensor_feature_set {
    spectral_features: {fft_magnitudes, fft_freq_hz, envelope_spectrum, dominant_freqs, spectral_kurtosis},
    time_domain_features: {rms, peak, crest_factor, kurtosis, skewness, zero_crossing_rate},
    bearing_features: bearing_features,
    quality_flags: {clipping_detected, aliasing_risk}
  }
```

---

## Key Schema Relationships

```
digital_twin_asset
  │─── 1:N ──→ sensor_reading           (continuous telemetry per sensor channel)
  │─── 1:N ──→ sensor_feature_set       (pre-computed features extracted at edge)
  │─── 1:N ──→ quality_inspection_result (inspections of parts produced by this asset)
  │─── 1:N ──→ maintenance_ticket       (PdM predictions and manual tickets)
  │─── 1:N ──→ twin_conflict_event      (write conflicts logged for this asset)
  └─── N:M ──→ production_schedule      (asset assigned to multiple scheduled jobs)

production_schedule
  │─── 1:N ──→ scheduled_job            (jobs in this schedule revision)
  └─── N:1 ──→ digital_twin_asset       (jobs assigned to specific machines)

quality_inspection_result
  │─── N:1 ──→ digital_twin_asset       (machine that produced the part)
  └─── 1:N ──→ defect                   (defects detected in this inspection)

maintenance_ticket
  │─── N:1 ──→ digital_twin_asset       (asset requiring maintenance)
  └─── 1:1 ──→ pdm_prediction           (triggering prediction, if PdM-generated)

edge_model_deployment
  │─── N:1 ──→ edge_gateway             (target device for deployment)
  └─── N:1 ──→ model_registry_entry     (model artifact in registry)

sensor_feature_set
  │─── N:1 ──→ digital_twin_asset       (source asset)
  └─── N:1 ──→ sensor_reading (window)  (derived from raw readings in time window)
```
