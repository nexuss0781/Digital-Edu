# 13.3 AI-Native Energy & Grid Management Platform — Low-Level Design

## Data Models

### Grid State Vector

The grid state vector is the core abstraction—a snapshot of every bus's voltage magnitude and angle, derived from SCADA measurements via state estimation, used as input to OPF and contingency analysis.

```
GridStateVector:
  control_area_id:     string          # utility control area identifier
  timestamp:           datetime_us     # microsecond precision, GPS-synchronized
  scan_cycle:          uint64          # monotonically increasing SCADA cycle number
  topology_version:    uint32          # incremented on breaker status change
  buses:               [BusState]      # one per electrical bus
  branches:            [BranchState]   # one per transmission line / transformer
  generators:          [GeneratorState]
  estimation_quality:  EstimationQuality

BusState:
  bus_id:              string
  voltage_magnitude:   float64         # per-unit (typically 0.95 – 1.05 pu)
  voltage_angle:       float64         # radians
  active_load_mw:      float64
  reactive_load_mvar:  float64
  active_gen_mw:       float64
  reactive_gen_mvar:   float64
  is_energized:        boolean
  zone_id:             string

BranchState:
  branch_id:           string
  from_bus:            string
  to_bus:              string
  active_flow_mw:      float64
  reactive_flow_mvar:  float64
  loading_percent:     float64         # thermal loading as % of rating
  is_in_service:       boolean
  tap_position:        int             # transformer tap (null for lines)

GeneratorState:
  generator_id:        string
  bus_id:              string
  active_output_mw:    float64
  reactive_output_mvar: float64
  set_point_mw:        float64         # dispatched set point from OPF
  ramp_rate_mw_min:    float64
  status:              enum[RUNNING, STANDBY, TRIPPED, MAINTENANCE]
  fuel_type:           enum[GAS, COAL, NUCLEAR, HYDRO, SOLAR, WIND, BATTERY]

EstimationQuality:
  chi_squared:         float64         # statistical fit measure
  largest_residual:    float64         # worst-fit measurement
  bad_data_count:      int             # measurements flagged as bad data
  observable:          boolean         # is the network fully observable?
```

### DER Device Record

```
DERDevice:
  device_id:           string          # globally unique device identifier
  device_type:         enum[SOLAR_INVERTER, BATTERY, EV_CHARGER, THERMOSTAT, WATER_HEATER, COMMERCIAL_HVAC]
  nameplate_kw:        float64         # rated capacity
  location:
    latitude:          float64
    longitude:         float64
    feeder_id:         string          # distribution feeder assignment
    transformer_id:    string          # service transformer
  communication:
    protocol:          enum[IEEE_2030_5, OPENADR_3, OCPP_2, PROPRIETARY]
    endpoint_url:      string
    certificate_id:    string          # PKI certificate for mTLS
    last_heartbeat:    datetime
    connectivity:      enum[ONLINE, OFFLINE, DEGRADED]
  enrollment:
    vpp_id:            string          # assigned VPP portfolio
    dr_programs:       [string]        # enrolled demand response programs
    customer_id:       string
    enrolled_at:       datetime
    consent_scope:     [string]        # what the customer authorized
  state:
    current_output_kw: float64         # positive = generation, negative = consumption
    soc_percent:       float64         # state of charge (batteries, EVs)
    available_kw:      float64         # dispatchable capacity right now
    temperature_f:     float64         # for thermostats: current setpoint
    last_dispatch:     datetime
    dispatch_response: enum[COMPLIED, PARTIAL, REJECTED, TIMEOUT]
  availability_model:
    weekday_profile:   [float64]       # 96 intervals: probability of availability
    weekend_profile:   [float64]
    seasonal_factor:   float64
    historical_compliance: float64     # % of dispatch signals complied with
```

### Smart Meter Reading

```
MeterReading:
  meter_id:            string          # AMI meter identifier
  reading_timestamp:   datetime        # interval end time
  interval_seconds:    int             # 900 (15-min), 300 (5-min), or 60 (1-min)
  delivered_kwh:       float64         # energy delivered to customer
  received_kwh:        float64         # energy received from customer (net metering)
  demand_kw:           float64         # peak demand in interval
  voltage_v:           float64         # service voltage
  power_factor:        float64
  quality_flags:       [enum]          # VALIDATED, ESTIMATED, EDITED, RAW, SUSPECT
  tamper_flags:        [enum]          # COVER_REMOVED, MAGNETIC_DETECTED, REVERSE_FLOW
  communication_method: enum[RF_MESH, CELLULAR, PLC, WIFI]

MeterProfile:                          # aggregated per-meter analytics
  meter_id:            string
  customer_class:      enum[RESIDENTIAL, COMMERCIAL, INDUSTRIAL]
  baseline_kwh_daily:  float64         # weather-normalized baseline consumption
  load_shape:          [float64]       # 96-interval normalized daily profile
  peer_group_id:       string          # cluster of similar consumption patterns
  theft_risk_score:    float64         # 0.0 – 1.0, updated daily
  last_field_check:    datetime
  anomaly_history:     [AnomalyEvent]
```

### Renewable Forecast Record

```
RenewableForecast:
  plant_id:            string          # solar or wind plant identifier
  forecast_timestamp:  datetime        # when the forecast was generated
  valid_from:          datetime        # forecast validity start
  horizon_minutes:     int             # 15, 60, 240, 1440 (24h)
  intervals:           [ForecastInterval]
  nwp_models_used:     [string]        # which NWP models contributed
  ramp_events:         [RampEvent]

ForecastInterval:
  interval_start:      datetime
  interval_end:        datetime
  p10_mw:              float64         # 10th percentile generation
  p25_mw:              float64
  p50_mw:              float64         # median forecast
  p75_mw:              float64
  p90_mw:              float64
  expected_mw:         float64         # mean (may differ from p50 for skewed distributions)
  irradiance_wm2:      float64         # solar only: predicted irradiance
  wind_speed_ms:       float64         # wind only: predicted hub-height wind speed

RampEvent:
  start_time:          datetime
  end_time:            datetime
  direction:           enum[UP, DOWN]
  magnitude_mw:        float64         # absolute change
  magnitude_percent:   float64         # relative to nameplate
  confidence:          float64         # 0.0 – 1.0
  cause:               enum[CLOUD_FRONT, STORM, SUNRISE_SUNSET, WIND_SHIFT, TEMPERATURE_CHANGE]
```

---

## API Contracts

### Grid State API (Internal — OT Plane)

```
// Real-time grid state for operator consoles and optimization engines
GET /api/v1/grid/state/current
Response:
  grid_state_vector: GridStateVector
  metadata:
    computation_time_ms: int
    scada_cycle:         uint64
    data_completeness:   float64    # % of expected measurements received

// Historical grid state for post-event analysis
GET /api/v1/grid/state/history?from={timestamp}&to={timestamp}&resolution={seconds}
Response:
  snapshots: [GridStateVector]       # down-sampled to requested resolution
```

### DER Dispatch API (OT Plane — via Command Gateway)

```
// Dispatch command to a single DER
POST /api/v1/der/dispatch
Request:
  device_id:           string
  command_type:        enum[SET_OUTPUT, CURTAIL, CHARGE, DISCHARGE, RESTORE]
  target_kw:           float64      # desired output (+ gen, - consumption)
  duration_minutes:    int           # how long to hold the dispatch
  priority:            enum[ECONOMIC, RELIABILITY, EMERGENCY]
  market_product:      string        # "FREQ_REG", "SPINNING_RESERVE", "ENERGY"
  authorization_token: string        # signed by VPP controller
Response:
  dispatch_id:         string
  accepted:            boolean
  estimated_response_s: int
  reason:              string        # if rejected: "LOW_SOC", "CUSTOMER_OVERRIDE", "OFFLINE"

// Batch dispatch to VPP portfolio
POST /api/v1/vpp/{vpp_id}/dispatch
Request:
  dispatch_schedule:   [DispatchSignal]
  market_interval:     datetime
  product:             enum[ENERGY, FREQ_REG, SPIN_RESERVE, NON_SPIN]
Response:
  dispatched_count:    int
  rejected_count:      int
  expected_delivery_mw: float64
  confidence:          float64       # probability of meeting delivery target
```

### Renewable Forecast API (IT Plane)

```
// Current forecast for a plant
GET /api/v1/forecast/renewable/{plant_id}?horizon={minutes}
Response:
  forecast:            RenewableForecast
  accuracy_metrics:
    mae_last_24h:      float64      # mean absolute error vs actuals
    bias_last_7d:       float64     # systematic over/under-forecasting

// Aggregate forecast for portfolio
GET /api/v1/forecast/renewable/portfolio/{portfolio_id}
Response:
  aggregate_forecast:  RenewableForecast  # summed with diversity benefit
  diversity_factor:    float64            # correlation-adjusted capacity factor
  ramp_events:         [RampEvent]        # portfolio-level ramp detection
```

### Market Bidding API (IT Plane)

```
// Submit day-ahead bids
POST /api/v1/market/bid/day-ahead
Request:
  trading_day:         date
  bids:                [MarketBid]
MarketBid:
  resource_id:         string        # VPP or generator
  product:             enum[ENERGY, FREQ_REG_UP, FREQ_REG_DOWN, SPIN_RESERVE]
  intervals:           [BidInterval]
BidInterval:
  hour:                int           # 0-23
  price_per_mwh:       float64
  quantity_mw:         float64
  min_quantity_mw:     float64       # minimum acceptable clearing quantity
Response:
  submission_id:       string
  accepted:            boolean
  validation_errors:   [string]

// Real-time position adjustment
POST /api/v1/market/position/adjust
Request:
  resource_id:         string
  interval:            datetime      # 5-minute real-time interval
  adjusted_quantity_mw: float64
  reason:              enum[FORECAST_UPDATE, DER_UNAVAILABLE, EQUIPMENT_TRIP]
```

### Smart Meter Analytics API (IT Plane)

```
// Theft detection alerts
GET /api/v1/metering/theft/alerts?status={open|investigating|resolved}
Response:
  alerts:              [TheftAlert]
TheftAlert:
  meter_id:            string
  risk_score:          float64       # 0.0 – 1.0
  anomaly_type:        enum[CONSUMPTION_DROP, REVERSE_FLOW, NEIGHBOR_DEVIATION, TAMPER_FLAG]
  detection_date:      date
  evidence:
    consumption_change_pct: float64
    neighbor_avg_kwh:      float64
    meter_kwh:             float64
    days_anomalous:        int
  status:              enum[OPEN, INVESTIGATING, CONFIRMED_THEFT, FALSE_POSITIVE]
```

---

## Core Algorithms

### State Estimation — Weighted Least Squares

The state estimator computes the most likely grid state (bus voltage magnitudes and angles) from redundant SCADA measurements, detecting and excluding bad data.

```
FUNCTION estimate_grid_state(measurements, network_model):
    // Initialize state vector (flat start: V=1.0 pu, angle=0 for all buses)
    x = initialize_flat_start(network_model.buses)

    FOR iteration = 1 TO max_iterations:
        // Compute measurement residuals: z - h(x)
        h_x = compute_measurement_functions(x, network_model)
        residuals = measurements.values - h_x

        // Compute Jacobian matrix H = dh/dx
        H = compute_jacobian(x, network_model)

        // Weighted least squares gain matrix: G = H^T * W * H
        W = diagonal_matrix(1 / measurements.variances)
        G = H_transpose * W * H

        // Solve normal equations: G * delta_x = H^T * W * residuals
        delta_x = sparse_solve(G, H_transpose * W * residuals)

        x = x + delta_x

        IF norm(delta_x) < convergence_threshold:
            BREAK

    // Bad data detection using largest normalized residual
    normalized_residuals = compute_normalized_residuals(residuals, H, W)
    bad_data = [m FOR m IN measurements IF abs(normalized_residuals[m]) > 3.0]

    IF bad_data IS NOT EMPTY:
        // Remove bad data and re-estimate
        filtered_measurements = measurements MINUS bad_data
        RETURN estimate_grid_state(filtered_measurements, network_model)

    RETURN GridStateVector(x, quality=compute_chi_squared(residuals, W))
```

### Optimal Power Flow — SOCP Relaxation

```
FUNCTION solve_opf(grid_state, generators, forecasts, market_prices):
    // Decision variables: generator active/reactive output, voltage set points
    // Objective: minimize total generation cost

    problem = create_optimization_problem()

    // Objective: minimize cost
    problem.minimize(
        SUM(gen.cost_curve(gen.active_output) FOR gen IN generators)
    )

    // Power balance at each bus (Kirchhoff's Current Law)
    FOR bus IN grid_state.buses:
        problem.add_constraint(
            SUM(gen.active_output FOR gen AT bus)
            - bus.active_load
            - SUM(branch.active_flow FOR branch FROM bus)
            == 0
        )

    // Generator limits
    FOR gen IN generators:
        problem.add_constraint(gen.min_mw <= gen.active_output <= gen.max_mw)
        problem.add_constraint(gen.active_output - gen.previous_output
                               <= gen.ramp_rate * interval_seconds)

    // Branch thermal limits (SOCP relaxation of AC power flow)
    FOR branch IN grid_state.branches:
        problem.add_constraint(
            branch.active_flow^2 + branch.reactive_flow^2
            <= branch.thermal_rating^2
        )

    // Voltage bounds
    FOR bus IN grid_state.buses:
        problem.add_constraint(0.95 <= bus.voltage_magnitude <= 1.05)

    solution = problem.solve(solver="interior_point", time_limit_ms=1500)
    RETURN solution.generator_set_points, solution.voltage_set_points
```

### Theft Detection — Consumption Pattern Analysis

```
FUNCTION detect_theft(meter_id, readings_90day, peer_group):
    // Feature extraction
    features = {}

    // 1. Consumption trend: sudden drop detection
    daily_consumption = aggregate_daily(readings_90day)
    features.trend_slope = linear_regression_slope(daily_consumption[-30:])
    features.mean_last_30d = mean(daily_consumption[-30:])
    features.mean_prior_60d = mean(daily_consumption[:60])
    features.consumption_ratio = features.mean_last_30d / features.mean_prior_60d

    // 2. Peer comparison: deviation from similar meters
    peer_avg = peer_group.average_daily_consumption()
    features.peer_deviation = (features.mean_last_30d - peer_avg) / peer_avg

    // 3. Pattern regularity: entropy of daily load shape
    features.shape_entropy = compute_entropy(normalize(readings_90day.daily_profiles[-30:]))
    features.shape_change = cosine_distance(
        mean_profile(readings_90day[:60]),
        mean_profile(readings_90day[-30:])
    )

    // 4. Tamper indicators from meter hardware
    features.tamper_events = count_tamper_flags(readings_90day)
    features.outage_anomalies = count_suspicious_outages(readings_90day)

    // 5. Weather normalization
    features.weather_adjusted_ratio = weather_normalize(
        features.consumption_ratio, weather_data
    )

    // ML model scoring
    risk_score = theft_model.predict_probability(features)

    IF risk_score > threshold_high:
        RETURN TheftAlert(meter_id, risk_score, "HIGH_CONFIDENCE")
    ELIF risk_score > threshold_medium:
        RETURN TheftAlert(meter_id, risk_score, "INVESTIGATE")
    ELSE:
        RETURN None
```

### VPP Portfolio Optimization — Stochastic Programming

```
FUNCTION optimize_vpp_portfolio(vpp, forecasts, market_prices, scenarios):
    // Scenarios: 100-500 renewable generation scenarios from forecast distribution
    // Decision: how much to bid in each market product per interval

    problem = create_stochastic_program()

    // First-stage decisions (before uncertainty resolves): market bids
    FOR interval IN market_intervals:
        FOR product IN [ENERGY, FREQ_REG_UP, FREQ_REG_DOWN, SPIN_RESERVE]:
            bid_quantity[interval][product] = problem.add_variable(
                lower=0, upper=vpp.max_capacity
            )

    // Second-stage decisions (per scenario): actual dispatch
    FOR scenario IN scenarios:
        FOR interval IN market_intervals:
            // Available capacity in this scenario
            available = sum_der_availability(vpp.devices, scenario, interval)

            // Must deliver what was bid (or pay penalty)
            shortfall[scenario][interval] = problem.add_variable(lower=0)
            problem.add_constraint(
                SUM(bid_quantity[interval][product] FOR product IN products)
                - shortfall[scenario][interval]
                <= available
            )

    // Objective: maximize expected revenue minus penalty costs
    problem.maximize(
        SUM(
            scenario.probability * (
                SUM(bid_quantity[i][p] * market_prices[i][p] FOR i, p)
                - SUM(shortfall[s][i] * penalty_rate FOR i)
                - SUM(battery_degradation_cost(dispatch) FOR dispatch)
            )
            FOR scenario s IN scenarios
        )
    )

    solution = problem.solve(time_limit_seconds=120)
    RETURN solution.bid_quantities, solution.expected_revenue
```

---

## Key Data Structures

### Sparse Network Admittance Matrix (Y-Bus)

The Y-bus matrix is the fundamental data structure for power system analysis. It is a sparse, symmetric complex matrix where entry Y[i][j] represents the electrical admittance between buses i and j. For a 20,000-bus network, the matrix is ~99.97% sparse (each bus connects to 3–5 neighbors on average).

```
Storage: Compressed Sparse Column (CSC) format
  - Values:    ~120,000 complex entries (non-zero)
  - Row indices: ~120,000 integers
  - Column pointers: 20,001 integers
  Total memory: ~3 MB (vs. 3.2 GB for dense representation)

Rebuild trigger: topology change (breaker open/close)
Rebuild time: ~10 ms (incremental update for single breaker change)
Full rebuild: ~50 ms (rare: only after major topology reconfiguration)
```

### DER Availability Probability Distribution

Each DER's availability is modeled as a time-varying probability distribution, discretized into 96 fifteen-minute intervals per day:

```
Storage per DER: 96 intervals × 2 bytes (uint16 scaled probability) = 192 bytes
  Plus metadata: 64 bytes (device_id, type, capacity, compliance_rate)
  Total per DER: 256 bytes

5M DERs: 5M × 256 bytes = 1.28 GB
  Fits in memory for real-time VPP aggregation

Aggregation: convolution of individual distributions for portfolio-level availability
  Direct convolution of 20,000 DERs: computationally infeasible
  Solution: Central Limit Theorem approximation for large portfolios
    Portfolio mean = SUM(device.expected_availability × device.capacity)
    Portfolio variance = SUM(device.availability_variance × device.capacity^2)
    Valid for portfolios with >500 devices (CLT convergence)
```

### Time-Series Ring Buffer for SCADA

```
Structure: Fixed-size circular buffer per measurement point
  Ring size: 21,600 entries (24 hours at 4-second intervals)
  Entry size: 16 bytes (timestamp_offset: 4 bytes, value: 8 bytes, flags: 4 bytes)
  Per point: 21,600 × 16 bytes = 345.6 KB
  50,000 points: 50,000 × 345.6 KB = ~17 GB

Properties:
  - Constant-time O(1) append and latest-value read
  - O(1) random access by time (compute ring index from timestamp)
  - No garbage collection overhead (fixed allocation)
  - Lock-free single-writer, multi-reader via atomic index update
```

---

## Indexing Strategy

### SCADA Time-Series Store

| Index | Columns / Key | Purpose | Notes |
|---|---|---|---|
| **Primary (time-partitioned)** | `(measurement_point_id, timestamp)` | Point lookups for real-time control; range scans for trending | Partition by day; retain 30 days hot |
| **Topology lookup** | `(substation_id, equipment_type, timestamp)` | All measurements at a substation for state estimation | Composite index; covers ~100 points per substation |
| **Quality flag filter** | `(quality_flag, timestamp)` | Find bad/estimated data for audit | Sparse index (99.9% data is GOOD); bitmap index efficient |
| **Equipment health** | `(equipment_id, measurement_type)` | Transformer DGA trending, line loading history | Supports failure prediction model feature extraction |

### AMI Meter Reading Store

| Index | Columns / Key | Purpose | Notes |
|---|---|---|---|
| **Primary (time-series)** | `(meter_id, reading_timestamp)` | Individual meter history for billing, customer portal | Partition by month; 15-min granularity |
| **Peer group lookup** | `(peer_group_id, reading_timestamp)` | Aggregate peer group consumption for theft comparison | Materialized aggregate updated daily |
| **Transformer aggregate** | `(transformer_id, reading_timestamp)` | Sum consumption per service transformer for loss calculation | Computed from meter-to-transformer mapping |
| **Anomaly candidates** | `(theft_risk_score DESC, meter_id)` | Top-N suspicious meters for investigation prioritization | Updated daily by theft detection batch |
| **VEE status** | `(quality_flag, reading_timestamp)` | Find estimated/edited readings for billing accuracy | Bitmap index on quality_flag enum |
| **Geographic (spatial)** | `(latitude, longitude)` | Spatial queries for outage correlation and peer grouping | R-tree or geohash index for spatial range queries |

### DER Device Registry

| Index | Columns / Key | Purpose | Notes |
|---|---|---|---|
| **Primary** | `(device_id)` | Device lookup for dispatch and telemetry association | B-tree; unique |
| **VPP membership** | `(vpp_id, device_type, device_id)` | All devices in a VPP by type for portfolio aggregation | Composite; used in every dispatch cycle |
| **Feeder location** | `(feeder_id, device_type)` | DERs on a distribution feeder for voltage impact analysis | Prevents localized dispatch that causes voltage issues |
| **Connectivity status** | `(connectivity, last_heartbeat)` | Offline device detection; stale heartbeat monitoring | Partial index on connectivity = OFFLINE for fast scan |
| **Certificate expiry** | `(certificate_expiry_date)` | DERs with certificates expiring soon for renewal pipeline | Range scan: WHERE expiry < now() + 30 days |
| **Enrollment timeline** | `(enrolled_at DESC)` | Newly enrolled devices for onboarding verification | Supports cold-start availability model training |

### Grid Model Database

| Index | Columns / Key | Purpose | Notes |
|---|---|---|---|
| **Bus connectivity** | `(bus_id)` → adjacent buses via branch table | Network traversal for topology processing | Adjacency list; rebuilt on topology change |
| **Branch thermal rating** | `(branch_id, thermal_rating_mva)` | Quick lookup during contingency screening | Cached in memory; index for persistent store |
| **Generator by fuel type** | `(fuel_type, bus_id)` | Aggregate generation by fuel for dispatch economics | Supports cost curve selection in OPF |
| **Protection zone** | `(zone_id, relay_id)` | Relay-to-zone mapping for FLISR and contingency analysis | Updated on protection settings change |

### Forecast Store

| Index | Columns / Key | Purpose | Notes |
|---|---|---|---|
| **Primary** | `(plant_id, forecast_timestamp, valid_from)` | Latest forecast for a plant at a given horizon | Composite; supports "get current forecast for plant X" |
| **Accuracy tracking** | `(plant_id, interval_start)` with actual_mw column | Forecast vs. actual for model retraining | Joined with SCADA actual generation data |
| **Ramp events** | `(start_time, confidence DESC)` | Active ramp alerts sorted by confidence | Used by grid operator console and OPF reserve adjustment |

---

## Additional Algorithms

### Algorithm 5: Incremental Y-Bus Update for Topology Changes

When a single breaker opens or closes, the full Y-bus matrix need not be recomputed. The change affects only the admittance of the switched branch, enabling a rank-1 update.

```
FUNCTION update_ybus_incremental(Y_bus, branch, action):
    // branch connects bus_i to bus_j with admittance y_branch
    i = branch.from_bus
    j = branch.to_bus
    y = branch.admittance  // complex value

    IF action == OPEN:
        // Remove branch: subtract admittance
        Y_bus[i][i] -= y        // diagonal: self-admittance decreases
        Y_bus[j][j] -= y
        Y_bus[i][j] += y        // off-diagonal: mutual admittance removed (was negative)
        Y_bus[j][i] += y
    ELIF action == CLOSE:
        // Add branch: add admittance
        Y_bus[i][i] += y
        Y_bus[j][j] += y
        Y_bus[i][j] -= y
        Y_bus[j][i] -= y

    // Update CSC sparse column pointers if structural change
    IF action changes sparsity pattern:
        update_csc_structure(Y_bus, i, j)

    // Invalidate and recompute elimination ordering for affected subgraph
    // Only if the structural change affects fill-in pattern
    IF structural_change_affects_fill_in(i, j):
        recompute_local_elimination_ordering(Y_bus, affected_buses(i, j, radius=3))

    RETURN Y_bus

// Cost: O(1) for value update; O(k) for local elimination ordering (k = affected bus neighborhood)
// vs. O(n) for full Y-bus rebuild
// Typical execution: ~10 ms for single breaker vs. ~50 ms for full rebuild
```

### Algorithm 6: DER Availability Aggregation via CLT with Conditional Weather Correction

Aggregating availability of 20,000+ DERs per VPP via direct convolution is computationally infeasible. This algorithm uses CLT for base case and Monte Carlo for weather-conditioned tail risk.

```
FUNCTION aggregate_vpp_availability(vpp, weather_scenario):
    // Phase 1: CLT approximation for base availability
    IF weather_scenario.severity == NORMAL:
        // Central Limit Theorem: portfolio sum is approximately Gaussian
        mean_available = 0.0
        variance_available = 0.0

        FOR device IN vpp.devices:
            interval = current_time_interval()  // which 15-min slot
            p_available = device.availability_model.probability(interval)

            // Conditional on weather for temperature-sensitive devices
            IF device.type IN [THERMOSTAT, EV_CHARGER]:
                p_available = adjust_for_temperature(
                    p_available, weather_scenario.temperature,
                    device.type
                )

            expected_kw = device.nameplate_kw * p_available
            variance_kw = device.nameplate_kw^2 * p_available * (1 - p_available)

            mean_available += expected_kw
            variance_available += variance_kw

        std_available = sqrt(variance_available)

        // Return quantiles using Gaussian approximation
        RETURN AvailabilityDistribution(
            mean = mean_available,
            std = std_available,
            P10 = mean_available - 1.28 * std_available,
            P50 = mean_available,
            P90 = mean_available + 1.28 * std_available
        )

    // Phase 2: Monte Carlo for extreme weather (CLT underestimates tail risk)
    ELSE:
        // During extreme weather, DER failures are correlated
        // Direct simulation with correlated availability draws
        samples = []
        FOR trial = 1 TO 1000:
            // Draw correlated availability using copula model
            // Correlation matrix estimated from historical extreme events
            availability_draws = draw_correlated_availability(
                vpp.devices, weather_scenario, correlation_matrix
            )
            total_kw = SUM(
                device.nameplate_kw * draw
                FOR device, draw IN zip(vpp.devices, availability_draws)
            )
            samples.append(total_kw)

        RETURN AvailabilityDistribution(
            mean = mean(samples),
            std = std(samples),
            P10 = percentile(samples, 10),
            P50 = percentile(samples, 50),
            P90 = percentile(samples, 90)
        )

// CLT phase: O(n) where n = number of devices (~20K) → ~2 ms
// Monte Carlo phase: O(1000 × n) → ~2 seconds per VPP
// Monte Carlo triggered only for extreme weather scenarios
```

### Algorithm 7: Look-Ahead OPF with Predictive State Evolution

The standard OPF optimizes for the current grid state, but by the time dispatch signals take effect, the state has changed. Look-ahead OPF optimizes for the predicted state 2-3 SCADA cycles in the future.

```
FUNCTION solve_lookahead_opf(current_state, generator_ramps, load_trend, forecast):
    // Predict state evolution over look-ahead horizon (8-12 seconds)
    horizon_cycles = 3  // 3 × 4 seconds = 12-second look-ahead
    predicted_state = current_state.copy()

    // 1. Project generator outputs based on current ramp trajectories
    FOR gen IN predicted_state.generators:
        ramp_direction = sign(gen.set_point_mw - gen.active_output_mw)
        ramp_amount = min(
            abs(gen.set_point_mw - gen.active_output_mw),
            gen.ramp_rate_mw_min * (horizon_cycles * 4 / 60)
        )
        predicted_state.generators[gen.id].active_output_mw += ramp_direction * ramp_amount

    // 2. Project load based on short-term trend (linear extrapolation)
    FOR bus IN predicted_state.buses:
        load_gradient = compute_load_gradient(bus, last_5_cycles)
        predicted_state.buses[bus.id].active_load_mw += (
            load_gradient * horizon_cycles * 4  // seconds
        )

    // 3. Project renewable generation from short-term forecast
    FOR gen IN predicted_state.generators:
        IF gen.fuel_type IN [SOLAR, WIND]:
            predicted_state.generators[gen.id].active_output_mw = (
                forecast.get_prediction(gen.generator_id, horizon_cycles * 4)
            )

    // 4. Solve OPF against predicted state
    dispatch = solve_opf(predicted_state, generators, forecast, market_prices)

    // 5. Validate dispatch is feasible from current state (ramp rate check)
    FOR gen IN dispatch.set_points:
        max_ramp = gen.ramp_rate_mw_min * (4 / 60)  // per SCADA cycle
        actual_change = abs(dispatch.set_points[gen] - current_state.generators[gen].active_output_mw)
        IF actual_change > max_ramp:
            // Clip to feasible ramp; will converge over multiple cycles
            dispatch.set_points[gen] = current_state.generators[gen].active_output_mw + (
                sign(dispatch.set_points[gen] - current_state.generators[gen].active_output_mw) * max_ramp
            )

    RETURN dispatch

// Reduces frequency deviation by 30-40% vs. reactive OPF
// Additional cost: ~200 ms for state prediction + gradient computation
// Total budget: 500 ms (prediction) + 1500 ms (OPF) = 2000 ms < 4000 ms ✓
```
