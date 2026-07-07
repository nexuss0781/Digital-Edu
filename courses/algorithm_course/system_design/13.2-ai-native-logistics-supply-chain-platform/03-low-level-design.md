# 13.2 AI-Native Logistics & Supply Chain Platform — Low-Level Design

## Data Models

### shipment

The canonical lifecycle record for a single shipment from order to delivery.

```
shipment {
  shipment_id:          UUID              -- globally unique, immutable
  tenant_id:            UUID              -- shipper/customer isolation
  order_id:             UUID              -- originating order reference
  status:               enum              -- PLANNED | TENDERED | IN_TRANSIT | AT_STOP |
                                          -- DELIVERED | EXCEPTION | CANCELLED
  mode:                 enum              -- ROAD | RAIL | OCEAN | AIR | INTERMODAL
  legs:                 list<shipment_leg>
    -- each: {leg_id, mode, carrier_id, origin: location, destination: location,
    --        planned_pickup_at, planned_delivery_at, actual_pickup_at, actual_delivery_at,
    --        vehicle_id, container_id, status}
  current_leg_index:    integer           -- which leg is active
  origin:               location          -- {lat, lon, address, facility_id}
  destination:          location
  stops:                list<stop>        -- intermediate stops with time windows
    -- each: {stop_id, location, earliest_arrival, latest_arrival, service_time_min,
    --        stop_type: PICKUP | DELIVERY | CROSSDOCK, cargo_items: list<item_ref>}
  cargo:                cargo_manifest    -- {total_weight_kg, total_volume_m3, piece_count,
                                          --  commodity_type, temperature_range: {min_c, max_c},
                                          --  hazmat_class: string | null}
  carrier_id:           UUID
  vehicle_id:           UUID | null       -- assigned after dispatch
  driver_id:            UUID | null
  current_position:     geo_point         -- last known {lat, lon, timestamp, source}
  current_eta:          eta_prediction    -- {predicted_arrival, confidence_interval_min,
                                          --  model_version, computed_at}
  route_plan:           route_ref         -- FK to active route solution
  exception_history:    list<exception>   -- {exception_id, type, severity, detected_at,
                                          --  resolved_at, resolution}
  cold_chain:           cold_chain_config | null
    -- {target_temp_c, tolerance_c, sensor_ids: list<string>,
    --  excursion_history: list<excursion_event>}
  proof_of_delivery:    pod_record | null -- {photo_url, signature_url, gps_at_delivery,
                                          --  delivered_at, recipient_name}
  created_at:           timestamp
  updated_at:           timestamp
  sla:                  sla_spec          -- {promised_delivery_by, penalty_per_hour_late}
}
```

### route_solution

A computed route assignment for a set of vehicles and stops at a specific depot.

```
route_solution {
  solution_id:          UUID
  depot_id:             UUID
  planning_horizon:     date_range        -- {start_date, end_date}
  solver_version:       string
  solve_type:           enum              -- FULL_SOLVE | INCREMENTAL_REOPT
  parent_solution_id:   UUID | null       -- the solution this was derived from (incremental)
  vehicles:             list<vehicle_route>
    -- each: {
    --   vehicle_id, driver_id,
    --   stop_sequence: list<{stop_id, shipment_id, arrival_eta, departure_eta,
    --                        service_time_min, cumulative_load_kg, cumulative_volume_m3}>,
    --   total_distance_km, total_duration_min, total_cost,
    --   utilization_pct: float  -- % of capacity used
    -- }
  unassigned_stops:     list<stop_id>     -- stops that could not be feasibly assigned
  objective_value:      float             -- total cost of solution (distance + time + penalties)
  constraints_violated: list<string>      -- any soft constraint violations accepted
  computed_at:          timestamp
  computation_time_ms:  integer
  trigger:              enum              -- SCHEDULED | NEW_ORDER | TRAFFIC_UPDATE |
                                          -- VEHICLE_BREAKDOWN | MANUAL_REPLAN
}
```

### warehouse_state (Digital Twin)

Real-time representation of a warehouse's physical state.

```
warehouse_state {
  warehouse_id:         UUID
  snapshot_at:          timestamp          -- last full state sync
  zones:                list<zone>
    -- each: {zone_id, zone_type: PICK | BULK | COLD | STAGING | DOCK,
    --        temperature_c, humidity_pct, active_pickers: integer}
  bins:                 list<bin>
    -- each: {bin_id, zone_id, aisle, rack, level, position,
    --        sku_id: string | null, quantity: integer, last_pick_at: timestamp,
    --        velocity_class: enum  -- A | B | C (pick frequency tier)}
  amrs:                 list<amr_state>
    -- each: {amr_id, position: {x, y, heading}, battery_pct, status: IDLE | PICKING |
    --        CHARGING | MAINTENANCE, current_task_id: UUID | null,
    --        carrying: list<{sku_id, quantity}>}
  conveyors:            list<conveyor_segment>
    -- each: {segment_id, status: RUNNING | STOPPED | FAULT,
    --        throughput_items_per_min, queue_depth}
  dock_doors:           list<dock_door>
    -- each: {door_id, status: OPEN | CLOSED | LOADING | UNLOADING,
    --        assigned_vehicle_id: UUID | null, eta_complete: timestamp}
  active_waves:         list<wave>
    -- each: {wave_id, order_count, pick_tasks_remaining, priority, started_at}
  version:              long              -- monotonically increasing state version
}
```

### vehicle

Fleet vehicle record with telematics and maintenance state.

```
vehicle {
  vehicle_id:           UUID
  tenant_id:            UUID
  type:                 enum              -- VAN | TRUCK | TRAILER | REEFER | EV
  capacity_kg:          float
  capacity_m3:          float
  license_plate:        string
  home_depot_id:        UUID
  current_position:     geo_point
  telematics:           telematics_snapshot
    -- {engine_hours, odometer_km, fuel_level_pct, tire_pressure: list<float>,
    --  engine_temp_c, battery_voltage, dtc_codes: list<string>,
    --  last_ping_at: timestamp}
  maintenance_state:    maintenance_info
    -- {next_service_due_at: timestamp, next_service_type: string,
    --  predicted_failure_components: list<{component, probability, horizon_days}>,
    --  last_service_at: timestamp}
  driver_id:            UUID | null       -- currently assigned driver
  status:               enum              -- AVAILABLE | IN_USE | MAINTENANCE | OUT_OF_SERVICE
  fuel_type:            enum              -- DIESEL | GASOLINE | ELECTRIC | HYBRID | CNG
  refrigeration:        boolean
  created_at:           timestamp
}
```

### demand_forecast

Probabilistic forecast for a single SKU-location-day.

```
demand_forecast {
  forecast_id:          UUID
  sku_id:               string
  location_id:          UUID              -- warehouse or store
  forecast_date:        date
  generated_at:         timestamp
  model_version:        string
  quantiles:            map<float, float> -- {0.10: 5, 0.25: 8, 0.50: 12, 0.75: 18, 0.90: 25}
  point_forecast:       float             -- median (P50) as convenience field
  features_used:        list<string>      -- feature names contributing to this forecast
  hierarchy_level:      enum              -- SKU_LOCATION | CATEGORY_REGION | TOTAL
  reconciled:           boolean           -- true after MinT reconciliation applied
  reconciliation_adjustment: float        -- delta applied during reconciliation
}
```

### cold_chain_reading

Individual IoT sensor reading for cold chain compliance.

```
cold_chain_reading {
  reading_id:           UUID
  shipment_id:          UUID
  sensor_id:            string
  timestamp:            timestamp
  temperature_c:        float
  humidity_pct:         float | null
  battery_pct:          float
  location:             geo_point | null  -- if sensor has GPS
  excursion:            boolean           -- true if outside tolerance
  excursion_duration_sec: integer | null  -- cumulative seconds outside tolerance in this excursion
}
```

---

## API Design

### Shipment Management API

```
POST /v1/shipments
  Request:
    order_id: UUID
    origin: location
    destination: location
    stops: list<stop_spec>
    cargo: cargo_manifest
    sla: {promised_delivery_by: timestamp}
    cold_chain: cold_chain_config | null
  Response:
    {shipment_id, status: "PLANNED", estimated_pickup: timestamp, estimated_delivery: timestamp}

GET /v1/shipments/{shipment_id}
  Response:
    {shipment_id, status, current_position, current_eta, legs, exception_history, cold_chain}

GET /v1/shipments/{shipment_id}/timeline
  Response:
    {shipment_id, events: list<{event_type, timestamp, location, source, details}>}

POST /v1/shipments/{shipment_id}/proof-of-delivery
  Request:
    photo: multipart/form-data
    signature: multipart/form-data | null
    gps: geo_point
    recipient_name: string
  Response:
    {shipment_id, pod_status: "RECORDED", delivered_at: timestamp}
```

### Route Optimization API

```
POST /v1/routes/optimize
  Request:
    depot_id: UUID
    planning_horizon: {start: date, end: date}
    stops: list<stop_spec>           -- or empty to use all pending stops for depot
    vehicles: list<vehicle_id>       -- available fleet
    constraints: {max_route_duration_min, max_stops_per_vehicle, time_windows: boolean}
    solve_type: enum                 -- FULL | INCREMENTAL
    time_budget_sec: float           -- solver time limit
  Response:
    {solution_id, vehicles: list<vehicle_route>, unassigned_stops, objective_value,
     computation_time_ms}

POST /v1/routes/{solution_id}/reoptimize
  Request:
    trigger: enum                    -- NEW_ORDER | CANCELLATION | TRAFFIC | BREAKDOWN
    changes: list<{type: ADD_STOP | REMOVE_STOP | UPDATE_TRAFFIC | REMOVE_VEHICLE, payload}>
  Response:
    {solution_id, vehicles: list<vehicle_route>, delta_cost, computation_time_ms}

GET /v1/routes/{solution_id}/vehicle/{vehicle_id}
  Response:
    {vehicle_id, stop_sequence, total_distance_km, total_duration_min, next_stop_eta}
```

### Demand Forecasting API

```
GET /v1/forecasts/{sku_id}/{location_id}
  Request (query params):
    horizon_days: integer (default 90)
    quantiles: list<float> (default [0.10, 0.50, 0.90])
  Response:
    {sku_id, location_id, forecasts: list<{date, quantiles: map<float, float>, reconciled}>}

GET /v1/forecasts/accuracy
  Request (query params):
    period: date_range
    aggregation: enum  -- SKU | CATEGORY | REGION | TOTAL
  Response:
    {metrics: {wmape, bias, coverage_p90, pinball_loss_by_quantile}}

POST /v1/forecasts/override
  Request:
    sku_id: string
    location_id: UUID
    date_range: {start, end}
    override_values: list<{date, quantity}>
    reason: string
  Response:
    {override_id, applied: boolean, reconciliation_impact: float}
```

### Warehouse Orchestration API

```
POST /v1/warehouses/{warehouse_id}/waves
  Request:
    order_ids: list<UUID>
    priority: enum  -- STANDARD | EXPEDITED | CRITICAL
    constraints: {max_picks_per_wave, cutoff_time: timestamp}
  Response:
    {wave_id, pick_tasks: list<{task_id, sku_id, bin_id, quantity, assigned_amr_id}>,
     estimated_completion: timestamp}

GET /v1/warehouses/{warehouse_id}/state
  Response:
    {warehouse_id, snapshot_at, amr_count_by_status, bin_utilization_pct,
     active_waves, dock_door_status, zone_temperatures}

POST /v1/warehouses/{warehouse_id}/slotting/optimize
  Request:
    optimization_scope: enum  -- FULL | ZONE | INCREMENTAL
    target_zone_ids: list<UUID> | null
  Response:
    {moves: list<{sku_id, from_bin, to_bin, reason}>, estimated_pick_time_reduction_pct}
```

### Fleet & Cold Chain API

```
GET /v1/fleet/{vehicle_id}/health
  Response:
    {vehicle_id, telematics, maintenance_state, driver_safety_score, fuel_efficiency}

GET /v1/fleet/{vehicle_id}/maintenance-prediction
  Response:
    {vehicle_id, predictions: list<{component, failure_probability, horizon_days, recommended_action}>}

GET /v1/shipments/{shipment_id}/cold-chain
  Response:
    {shipment_id, readings: list<cold_chain_reading>,
     excursions: list<{start_at, end_at, max_temp_deviation_c, duration_sec}>,
     compliance_status: enum  -- COMPLIANT | EXCURSION_DETECTED | VIOLATION}
```

---

## Core Algorithms

### Algorithm 1: Warm-Start Adaptive Large Neighborhood Search (ALNS) for VRP

```
FUNCTION solve_vrp_incremental(current_solution: route_solution,
                                changes: list<change>,
                                time_budget_sec: float) -> route_solution:

  // Step 1: Apply changes to current solution
  working = deep_copy(current_solution)
  FOR change IN changes:
    IF change.type == ADD_STOP:
      // Insert new stop into cheapest feasible position
      best_cost = INF
      best_position = null
      FOR vehicle_route IN working.vehicles:
        FOR position IN 0..len(vehicle_route.stop_sequence):
          cost = compute_insertion_cost(vehicle_route, change.stop, position)
          IF is_feasible(vehicle_route, change.stop, position) AND cost < best_cost:
            best_cost = cost
            best_position = {vehicle_route, position}
      IF best_position is not null:
        insert_stop(best_position.vehicle_route, change.stop, best_position.position)
      ELSE:
        working.unassigned_stops.append(change.stop)

    ELSE IF change.type == REMOVE_STOP:
      remove_stop_from_route(working, change.stop_id)

    ELSE IF change.type == UPDATE_TRAFFIC:
      update_travel_times(working, change.traffic_matrix)

    ELSE IF change.type == REMOVE_VEHICLE:
      orphaned_stops = remove_vehicle(working, change.vehicle_id)
      working.unassigned_stops.extend(orphaned_stops)

  // Step 2: ALNS improvement phase (if time budget allows)
  start_time = now()
  iteration = 0
  best_solution = deep_copy(working)
  best_cost = compute_objective(working)

  destroy_operators = [random_removal, worst_removal, shaw_removal, cluster_removal]
  repair_operators = [greedy_insertion, regret_2_insertion, regret_3_insertion]
  operator_weights = initialize_uniform_weights(destroy_operators, repair_operators)

  WHILE elapsed(start_time) < time_budget_sec:
    // Select operators using roulette wheel selection based on weights
    destroy_op = roulette_select(destroy_operators, operator_weights.destroy)
    repair_op = roulette_select(repair_operators, operator_weights.repair)

    // Destroy: remove a subset of stops from current solution
    destroyed = destroy_op(working, removal_count=random(10, 30))

    // Repair: reinsert removed stops
    repaired = repair_op(working, destroyed.removed_stops)

    // Accept or reject using simulated annealing criterion
    new_cost = compute_objective(repaired)
    IF accept_sa(new_cost, best_cost, temperature(iteration)):
      working = repaired
      IF new_cost < best_cost:
        best_solution = deep_copy(repaired)
        best_cost = new_cost
        update_operator_weights(operator_weights, destroy_op, repair_op, IMPROVED)
      ELSE:
        update_operator_weights(operator_weights, destroy_op, repair_op, ACCEPTED)
    ELSE:
      update_operator_weights(operator_weights, destroy_op, repair_op, REJECTED)

    iteration += 1

  best_solution.solve_type = INCREMENTAL_REOPT
  best_solution.parent_solution_id = current_solution.solution_id
  best_solution.computation_time_ms = elapsed_ms(start_time)
  RETURN best_solution
```

### Algorithm 2: Hierarchical Probabilistic Demand Forecasting

```
FUNCTION generate_reconciled_forecasts(sku_locations: list<sku_location>,
                                       hierarchy: product_geo_hierarchy,
                                       history: demand_history) -> list<demand_forecast>:

  // Step 1: Generate base forecasts at leaf level (SKU-location-day)
  base_forecasts = {}
  FOR sl IN sku_locations:
    features = extract_features(sl, history)
      // features: day_of_week, month, is_promotion, price, lag_7, lag_28,
      //           rolling_mean_7, rolling_mean_28, trend, seasonality_fourier
    quantile_model = load_model(sl.category)  // LightGBM quantile regression
    FOR day IN forecast_horizon:
      quantiles = {}
      FOR q IN [0.10, 0.25, 0.50, 0.75, 0.90]:
        quantiles[q] = quantile_model.predict(features, quantile=q, target_day=day)
      base_forecasts[(sl.sku_id, sl.location_id, day)] = quantiles

  // Step 2: Aggregate base forecasts up the hierarchy
  aggregated = {}
  FOR level IN hierarchy.levels_bottom_up():  // SKU→Category→Department→Total
    FOR node IN hierarchy.nodes_at_level(level):
      children = hierarchy.children(node)
      FOR day IN forecast_horizon:
        FOR q IN quantile_list:
          aggregated[(node, day, q)] = SUM(
            base_forecasts.get((child, day, q), 0) for child in children
          )

  // Step 3: MinT optimal reconciliation
  // Construct summing matrix S that maps bottom-level to all levels
  S = hierarchy.build_summing_matrix()  // dimensions: (all_nodes × leaf_nodes)

  // For each quantile and each day, reconcile independently
  FOR q IN quantile_list:
    FOR day IN forecast_horizon:
      // Collect all forecasts (base + aggregated) into vector y_hat
      y_hat = collect_all_level_forecasts(base_forecasts, aggregated, day, q)

      // Compute reconciliation weights (MinT: minimize trace of reconciled error covariance)
      W_h = estimate_reconciliation_covariance(history, hierarchy, q)
      P = inverse(S_T × inverse(W_h) × S) × S_T × inverse(W_h)
      y_tilde = S × P × y_hat  // reconciled forecasts

      // Write back reconciled values to base forecasts
      distribute_reconciled(base_forecasts, y_tilde, hierarchy, day, q)

  // Step 4: Build output forecast records
  results = []
  FOR (sku_id, location_id, day), quantiles IN base_forecasts:
    results.append(demand_forecast{
      sku_id, location_id, forecast_date=day,
      quantiles=quantiles, reconciled=true,
      model_version=quantile_model.version
    })
  RETURN results
```

### Algorithm 3: Real-Time Pick-Path Optimization

```
FUNCTION optimize_pick_path(warehouse: warehouse_state,
                            pick_list: list<pick_task>,
                            amr: amr_state) -> ordered_pick_sequence:

  // Step 1: Build traversable graph from warehouse layout
  // Nodes: bin locations + aisle intersections + staging areas
  // Edges: walkable/drivable paths with distance weights
  graph = warehouse.navigation_graph  // pre-computed, updated when layout changes

  // Step 2: Filter pick locations and compute pairwise distances
  pick_locations = [warehouse.get_bin_location(task.bin_id) FOR task IN pick_list]
  start_location = amr.position
  end_location = warehouse.staging_area(pick_list[0].wave_id)

  // For small pick lists (≤ 15 items): solve TSP exactly via dynamic programming
  IF len(pick_list) <= 15:
    distance_matrix = compute_pairwise_shortest_paths(graph, [start_location] + pick_locations + [end_location])
    sequence = solve_tsp_dp(distance_matrix)  // Held-Karp: O(n^2 * 2^n), feasible for n ≤ 15
    RETURN map_sequence_to_tasks(sequence, pick_list)

  // For larger pick lists: use nearest-neighbor Practical rule of thumb + 2-opt improvement
  // Step 3: Nearest-neighbor construction
  current = start_location
  remaining = set(pick_locations)
  sequence = []
  WHILE remaining is not empty:
    nearest = argmin(remaining, key=lambda loc: shortest_path(graph, current, loc))
    sequence.append(nearest)
    remaining.remove(nearest)
    current = nearest

  // Step 4: 2-opt local search improvement
  improved = true
  WHILE improved:
    improved = false
    FOR i IN 0..len(sequence)-2:
      FOR j IN i+2..len(sequence):
        delta = (distance(sequence[i], sequence[j]) + distance(sequence[i+1], sequence[j+1]))
              - (distance(sequence[i], sequence[i+1]) + distance(sequence[j], sequence[j+1]))
        IF delta < -EPSILON:
          reverse_segment(sequence, i+1, j)
          improved = true

  // Step 5: Collision avoidance check against other AMRs
  FOR segment IN path_segments(sequence):
    conflicting_amrs = warehouse.check_path_conflicts(segment, amr.amr_id, time_window=30_sec)
    IF conflicting_amrs:
      // Add wait or detour for lowest-priority AMR
      resolve_conflict(segment, amr, conflicting_amrs, graph)

  RETURN map_sequence_to_tasks(sequence, pick_list)
```

### Algorithm 4: ML-Based ETA Prediction

```
FUNCTION predict_eta(shipment: shipment,
                     telemetry_history: list<telemetry_event>,
                     external_signals: external_context) -> eta_prediction:

  // Step 1: Build feature vector from multi-source telemetry
  features = {}

  // Spatial features
  features.remaining_distance_km = haversine(shipment.current_position, shipment.destination)
  features.route_complexity = count_remaining_stops(shipment)
  features.current_speed_kmh = telemetry_history[-1].speed if telemetry_history else null

  // Temporal features
  features.elapsed_time_hours = hours_since(shipment.actual_pickup_at)
  features.time_of_day = current_hour_local(shipment.current_position)
  features.day_of_week = current_day_of_week()
  features.is_weekend = features.day_of_week in [SAT, SUN]

  // Historical carrier performance
  features.carrier_avg_delay_hours = carrier_stats.get(shipment.carrier_id).mean_delay
  features.carrier_otd_rate = carrier_stats.get(shipment.carrier_id).on_time_delivery_rate
  features.lane_avg_transit_hours = lane_stats.get(shipment.origin, shipment.destination).mean_transit

  // External signals
  features.weather_severity = external_signals.weather_along_route(shipment.route_plan)
  features.traffic_congestion_index = external_signals.traffic_index(shipment.current_position)
  features.port_congestion_hours = external_signals.port_wait_time(shipment.destination) if shipment.mode == OCEAN else 0

  // Telemetry-derived features (movement patterns)
  features.avg_speed_last_hour = mean(t.speed for t in telemetry_history[-12:])  // 5-min intervals
  features.stop_count_last_2h = count(t for t in telemetry_history[-24:] if t.speed < 5)
  features.heading_variance = variance(t.heading for t in telemetry_history[-6:])

  // Step 2: Handle missing features (masked attention for variable inputs)
  feature_mask = {k: v is not null FOR k, v IN features.items()}

  // Step 3: Model inference (gradient-boosted model + conformal prediction for intervals)
  point_estimate = eta_model.predict(features, feature_mask)
  residuals = eta_model.calibration_residuals  // from holdout set
  alpha = 0.10  // 90% prediction interval
  interval_width = quantile(abs(residuals), 1 - alpha)

  RETURN eta_prediction {
    predicted_arrival: shipment.actual_pickup_at + hours(point_estimate),
    confidence_interval_min: interval_width * 60,  // convert to minutes
    model_version: eta_model.version,
    computed_at: now()
  }
```

---

## Key Schema Relationships

```
shipment
  │─── 1:N ──→ shipment_leg           (one per transport mode segment)
  │─── 1:N ──→ telemetry_event        (continuous GPS/sensor readings)
  │─── 1:N ──→ cold_chain_reading     (temperature/humidity sensors)
  │─── 1:N ──→ exception              (disruptions, delays, excursions)
  │─── 1:1 ──→ route_solution         (via route_plan reference)
  └─── 1:1 ──→ proof_of_delivery      (captured at final delivery)

route_solution
  │─── 1:N ──→ vehicle_route          (one per assigned vehicle)
  └─── 1:1 ──→ route_solution         (parent, for incremental solutions)

vehicle
  │─── 1:N ──→ telematics_reading     (continuous sensor data)
  │─── 1:N ──→ vehicle_route          (assigned routes over time)
  └─── 1:1 ──→ driver                 (currently assigned)

warehouse_state
  │─── 1:N ──→ bin                    (inventory locations)
  │─── 1:N ──→ amr_state              (robot fleet)
  │─── 1:N ──→ wave                   (active pick waves)
  └─── 1:N ──→ dock_door              (loading/unloading bays)

demand_forecast
  └─── N:1 ──→ sku_location           (one forecast per SKU-location-day)
```

---

## Indexing Strategy

### Shipment Store Indexes

```
Primary key:     shipment_id (UUID)
Partition key:   tenant_id (all queries scoped to tenant)

Secondary indexes:
  (tenant_id, status)                    -- "show me all IN_TRANSIT shipments for this tenant"
  (tenant_id, carrier_id, status)        -- "all active shipments with carrier X"
  (tenant_id, destination, sla.promised_delivery_by)  -- "shipments arriving at location Y, sorted by SLA urgency"
  (tenant_id, mode, status)              -- "all ocean shipments currently in transit"

Geospatial index:
  current_position                       -- "all shipments within 50 km of port X" (used for disruption impact analysis)
  Uses R-tree or geohash prefix index; updated on every GPS ping

Time-range index:
  (tenant_id, created_at)                -- "shipments created in the last 7 days" (for dashboards)
  (tenant_id, sla.promised_delivery_by)  -- "shipments with SLA expiring in next 24 hours" (proactive alerting)
```

### Telemetry Time-Series Indexes

```
Primary key:     (shipment_id, timestamp, source)   -- natural idempotency key
Partition key:   shipment_id                         -- all telemetry for one shipment co-located

Time-series optimizations:
  Columnar encoding: lat/lon stored as delta-encoded floats (high spatial correlation between consecutive pings)
  Timestamp encoding: delta-of-delta encoding (regular ping intervals compress to 1-2 bytes per timestamp)
  Downsampling policy:
    0–7 days:   full resolution (every ping)
    7–30 days:  5-minute aggregation (avg lat/lon/speed per 5 min)
    30–365 days: 1-hour aggregation
    > 1 year:   daily summary only

  Result: 10x compression on warm tier, 100x on cold tier
```

### Route Solution Indexes

```
Primary key:     solution_id (UUID)
Secondary indexes:
  (depot_id, computed_at DESC)           -- "latest solution for this depot"
  (depot_id, planning_horizon.start_date) -- "solutions for this depot on date X"
  (parent_solution_id)                   -- "all incremental re-optimizations derived from this full solve"

Query pattern:
  The route engine always reads the LATEST solution for a depot (single-row read by depot_id + max computed_at).
  Historical solutions retained for 90 days for audit and quality analysis.
```

### Warehouse Digital Twin Indexes

```
The digital twin is an in-memory data structure, not a database. Indexes are in-memory spatial structures:

AMR positions:
  2D spatial index (k-d tree or grid hash) on (x, y) position
  Updated every 1 second per AMR; rebuilt incrementally (not full rebuild)
  Supports: "nearest idle AMR to bin X", "all AMRs in zone Y", "AMRs within 5m of path segment Z"

Bin occupancy:
  Hash map: bin_id → {sku_id, quantity, velocity_class}
  Spatial index on bin physical coordinates for pick-path graph
  Inverted index: sku_id → list<bin_id>  (which bins hold this SKU?)

Conveyor status:
  Array indexed by segment_id (static; conveyors don't move)
  Status updated on sensor events (RUNNING → STOPPED → FAULT)
```

### Demand Forecast Store Indexes

```
Primary key:     (sku_id, location_id, forecast_date)
Partition key:   location_id                         -- co-locate all SKU forecasts for a warehouse

Secondary indexes:
  (sku_id, forecast_date)                -- "forecast for SKU X across all locations"
  (hierarchy_level, forecast_date)       -- "all category-level forecasts for today" (planner dashboard)
  (reconciled, generated_at)             -- "unreconciled forecasts from latest batch" (reconciliation pipeline input)

The forecast store fits in memory (~18 GB for 10M SKU-locations). For serving, a distributed cache fronts the persistent store
with 100% hit rate during the inter-refresh period (forecasts change only once per day).
```

---

## Algorithm 5: Cold Chain Excursion Detection with Gap Reconstruction

```
FUNCTION process_cold_chain_batch(shipment_id: UUID,
                                   readings: list<cold_chain_reading>,
                                   config: cold_chain_config) -> excursion_report:

  // Step 1: Sort readings by timestamp (batch arrivals may be out of order)
  sorted_readings = sort(readings, key=lambda r: r.timestamp)

  // Step 2: Detect gaps in the reading sequence
  gaps = []
  FOR i IN 1..len(sorted_readings):
    interval = sorted_readings[i].timestamp - sorted_readings[i-1].timestamp
    IF interval > config.max_gap_seconds:  // typically 120 seconds (2x expected interval)
      gaps.append({
        start: sorted_readings[i-1].timestamp,
        end: sorted_readings[i].timestamp,
        duration_sec: interval,
        pre_gap_temp: sorted_readings[i-1].temperature_c,
        post_gap_temp: sorted_readings[i].temperature_c
      })

  // Step 3: Detect temperature excursions
  excursions = []
  current_excursion = null
  FOR reading IN sorted_readings:
    deviation = reading.temperature_c - config.target_temp_c
    is_excursion = abs(deviation) > config.tolerance_c

    IF is_excursion AND current_excursion is null:
      // Excursion starts
      current_excursion = {
        start_at: reading.timestamp,
        max_deviation_c: abs(deviation),
        readings: [reading]
      }
    ELSE IF is_excursion AND current_excursion is not null:
      // Excursion continues
      current_excursion.max_deviation_c = max(current_excursion.max_deviation_c, abs(deviation))
      current_excursion.readings.append(reading)
    ELSE IF not is_excursion AND current_excursion is not null:
      // Excursion ends
      current_excursion.end_at = reading.timestamp
      current_excursion.duration_sec = current_excursion.end_at - current_excursion.start_at
      excursions.append(current_excursion)
      current_excursion = null

  // Step 4: Classify gaps as verified or unverified
  FOR gap IN gaps:
    IF gap.pre_gap_temp within tolerance AND gap.post_gap_temp within tolerance:
      IF gap.duration_sec <= config.max_verified_gap_sec:  // e.g., 30 minutes
        gap.status = "VERIFIED_COMPLIANT"  // short gap, bookend temps OK
      ELSE:
        gap.status = "UNVERIFIED_INTERVAL"  // long gap, requires human disposition
    ELSE:
      gap.status = "EXCURSION_SUSPECTED"  // temps outside tolerance around gap

  // Step 5: Generate compliance report
  RETURN excursion_report {
    shipment_id,
    total_readings: len(sorted_readings),
    excursions: excursions,
    gaps: gaps,
    compliance_status: determine_compliance(excursions, gaps),
    requires_disposition: any(g.status == "UNVERIFIED_INTERVAL" for g in gaps)
  }
```

---

## Algorithm 6: Carrier Selection and Mode Optimization

```
FUNCTION select_carrier(shipment: shipment_spec,
                        available_carriers: list<carrier>,
                        constraints: carrier_constraints) -> carrier_recommendation:

  // Step 1: Filter carriers by hard constraints
  eligible = []
  FOR carrier IN available_carriers:
    IF carrier.covers_mode(shipment.mode) AND
       carrier.covers_lane(shipment.origin, shipment.destination) AND
       carrier.has_capacity(shipment.cargo) AND
       carrier.meets_certification(shipment.cargo.hazmat_class, shipment.cold_chain) AND
       carrier.active_status == ACTIVE:
      eligible.append(carrier)

  IF len(eligible) == 0:
    RETURN carrier_recommendation{status: "NO_ELIGIBLE_CARRIER", fallback: manual_dispatch}

  // Step 2: Score eligible carriers on multi-objective criteria
  scored = []
  FOR carrier IN eligible:
    score = weighted_score({
      cost:         carrier.quoted_rate(shipment) * weights.cost,         // lower is better
      reliability:  carrier.otd_rate_90d * weights.reliability,           // higher is better
      transit_time: carrier.estimated_transit(shipment) * weights.speed,  // lower is better
      co2_emission: carrier.emission_factor * weights.sustainability,     // lower is better
      relationship: carrier.volume_commitment_pct * weights.strategic     // higher = more committed
    })
    scored.append({carrier, score})

  // Step 3: Apply diversity constraint (don't over-concentrate with one carrier)
  ranked = sort(scored, key=lambda s: s.score, reverse=true)
  top_carrier = ranked[0].carrier
  IF tenant_carrier_concentration(top_carrier) > constraints.max_carrier_share:
    // Promote next-best carrier to encourage diversification
    top_carrier = ranked[1].carrier

  RETURN carrier_recommendation{
    primary: top_carrier,
    alternatives: ranked[1:3],  // next 2 best options for planner review
    scoring_breakdown: scored[0].score_components
  }
```
