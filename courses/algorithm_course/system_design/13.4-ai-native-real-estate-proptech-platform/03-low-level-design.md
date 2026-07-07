# 13.4 AI-Native Real Estate & PropTech Platform — Low-Level Design

## Data Models

### Property Intelligence Record

```
PropertyRecord {
  canonical_id:          UUID                -- Platform-wide unique property ID
  external_ids: [
    { source: "MLS_NWMLS", id: "2847391" },
    { source: "TAX_KING_CO", id: "732104-0290" },
    { source: "BMS_ID", id: "bldg-4827" }
  ]

  -- Physical Attributes
  address:               StructuredAddress   -- Parsed: street, unit, city, state, zip, country
  location:              GeoPoint            -- Lat/lon centroid
  parcel_geometry:        GeoPolygon          -- Parcel boundary from tax records
  h3_index:              String              -- H3 hex at resolution 9
  property_type:         Enum                -- SINGLE_FAMILY | CONDO | TOWNHOUSE | MULTI_FAMILY | COMMERCIAL | INDUSTRIAL | LAND
  year_built:            Int
  year_renovated:        Int?
  gross_living_area_sqft: Float
  lot_size_sqft:         Float
  bedrooms:              Int
  bathrooms:             Float
  stories:               Int
  garage_spaces:         Int
  construction_type:     Enum                -- WOOD_FRAME | MASONRY | STEEL | CONCRETE
  condition_score:       Float               -- 1.0 - 5.0 from photo CV analysis
  features:              [String]            -- Pool, fireplace, central_air, etc.

  -- Valuation
  current_avm_estimate:  Money
  avm_confidence_interval: { low: Money, high: Money }
  avm_model_version:     String
  avm_last_computed:     Timestamp
  comparable_ids:        [UUID]              -- Top-5 comparable property IDs
  last_sale_price:       Money
  last_sale_date:        Date
  tax_assessed_value:    Money

  -- Climate Risk
  climate_risk_scores: {
    flood:       { score: Float, return_period_years: Int, scenario: String },
    wildfire:    { score: Float, defensible_space_m: Float },
    heat_stress: { score: Float, cooling_degree_days_delta: Float },
    wind_storm:  { score: Float, design_wind_speed_mph: Float },
    drought:     { score: Float, water_stress_index: Float },
    sea_level:   { score: Float, elevation_above_msl_m: Float }
  }
  climate_risk_version:  String
  climate_risk_computed: Timestamp

  -- Listing State (if active)
  listing: {
    status:        Enum    -- ACTIVE | PENDING | SOLD | WITHDRAWN | EXPIRED
    list_price:    Money
    list_date:     Date
    days_on_market: Int
    mls_source:    String
    photos:        [ObjectRef]
    photo_embeddings: [Vector512]
    description:   Text
    description_embedding: Vector768
    virtual_tour_url: String?
    listing_quality_score: Float  -- 1.0 - 10.0 from photo/description analysis
  }?

  -- Metadata
  created_at:            Timestamp
  updated_at:            Timestamp
  data_sources:          [{ source: String, last_sync: Timestamp, confidence: Float }]
}
```

### Building Digital Twin

```
BuildingTwin {
  building_id:           UUID
  canonical_property_id: UUID
  building_type:         Enum        -- OFFICE | RETAIL | RESIDENTIAL | MIXED_USE | INDUSTRIAL

  -- HVAC System
  hvac_zones: [{
    zone_id:             String
    current_temp_f:      Float
    setpoint_temp_f:     Float
    humidity_pct:        Float
    co2_ppm:             Float
    occupancy_count:     Int
    damper_position_pct: Float       -- 0-100
    vav_airflow_cfm:     Float
    last_updated:        Timestamp
  }]

  -- Equipment Registry
  equipment: [{
    equipment_id:        String
    type:                Enum        -- AHU | CHILLER | BOILER | PUMP | ELEVATOR | GENERATOR
    manufacturer:        String
    install_date:        Date
    health_score:        Float       -- 0.0 - 1.0 from degradation model
    predicted_failure_date: Date?
    maintenance_schedule: [{ task: String, due_date: Date, priority: Enum }]
    sensor_ids:          [String]
  }]

  -- Energy
  energy_meters: [{
    meter_id:            String
    meter_type:          Enum        -- ELECTRIC | GAS | WATER | SOLAR
    current_demand_kw:   Float
    daily_consumption_kwh: Float
    monthly_consumption_kwh: Float
    cost_rate:           Money       -- per kWh, current utility rate
  }]

  -- Occupancy
  occupancy: {
    total_capacity:      Int
    current_count:       Int
    by_floor:            [{ floor: Int, count: Int, capacity: Int }]
    prediction_next_hour: [{ time: Timestamp, predicted_count: Int }]
    source:              Enum        -- BADGE | WIFI | CAMERA | SENSOR_FUSION
  }

  -- Safety
  safety_status: {
    fire_alarm:          Enum        -- NORMAL | ALERT | ALARM
    co_level_ppm:        Float
    smoke_detected:      Boolean
    flood_sensors:       [{ zone: String, status: Enum }]
    last_safety_check:   Timestamp
  }

  -- Optimization State
  optimizer: {
    current_policy:      String      -- RL policy version
    mode:                Enum        -- COMFORT | ECONOMY | DEMAND_RESPONSE | OVERRIDE
    energy_savings_pct:  Float       -- vs baseline (no optimization)
    comfort_score:       Float       -- 0-100 occupant satisfaction
    last_action:         { timestamp: Timestamp, action: String, reason: String }
  }
}
```

### Lease Extraction Record

```
LeaseExtraction {
  extraction_id:         UUID
  document_id:           UUID        -- Reference to raw document in object storage
  property_id:           UUID?       -- Linked canonical property (if resolved)

  -- Parties
  landlord:              { name: String, entity_type: Enum, address: String }
  tenant:                { name: String, entity_type: Enum, address: String }
  guarantor:             { name: String, entity_type: Enum }?

  -- Key Terms
  lease_type:            Enum        -- GROSS | NET | DOUBLE_NET | TRIPLE_NET | MODIFIED_GROSS
  commencement_date:     Date
  expiration_date:       Date
  term_months:           Int
  base_rent:             Money
  rent_frequency:        Enum        -- MONTHLY | QUARTERLY | ANNUALLY
  security_deposit:      Money
  rentable_sqft:         Float
  usable_sqft:           Float

  -- Escalations
  escalations: [{
    type:                Enum        -- FIXED_PCT | CPI | MARKET_RESET | STEP
    effective_date:      Date
    amount_or_pct:       Float
    cap_pct:             Float?
    floor_pct:           Float?
  }]

  -- Options
  renewal_options: [{
    notice_deadline:     Date
    term_months:         Int
    rent_basis:          Enum        -- MARKET | FIXED | CPI_ADJUSTED
    conditions:          Text
  }]
  termination_options: [{
    earliest_date:       Date
    penalty:             Money
    notice_months:       Int
  }]

  -- Operating Expenses
  cam_structure:         { base_year: Int, tenant_share_pct: Float, cap_pct: Float? }?
  tax_passthrough:       { base_year: Int, tenant_share_pct: Float }?
  insurance_passthrough: { base_year: Int, tenant_share_pct: Float }?

  -- Clauses (200+ types; sample below)
  clauses: [{
    clause_type:         String      -- e.g., "assignment_subletting", "force_majeure", "default_remedies"
    page_number:         Int
    text_span:           { start: Int, end: Int }
    extracted_value:     JSON        -- Type-specific structured extraction
    confidence:          Float       -- Model confidence 0.0 - 1.0
    review_status:       Enum        -- AUTO_APPROVED | PENDING_REVIEW | HUMAN_VERIFIED
  }]

  -- Anomaly Detection
  anomalies: [{
    clause_type:         String
    description:         String
    severity:            Enum        -- INFO | WARNING | CRITICAL
    portfolio_norm:      String      -- What the norm is across similar leases
  }]

  -- Processing Metadata
  processing: {
    ocr_engine_version:  String
    nlp_model_version:   String
    processing_time_sec: Float
    page_count:          Int
    overall_confidence:  Float
    reviewed_by:         String?
    reviewed_at:         Timestamp?
  }
}
```

---

## API Contracts

### Property Valuation API

```
POST /api/v1/valuations
Request:
{
  "property_id": "uuid",                    -- Canonical property ID
  "valuation_purpose": "LENDING | INVESTMENT | LISTING | TAX_APPEAL",
  "as_of_date": "2026-03-01",              -- Optional: historical valuation
  "include_comparables": true,
  "include_explainability": true
}

Response:
{
  "valuation_id": "uuid",
  "property_id": "uuid",
  "estimated_value": { "amount": 485000, "currency": "USD" },
  "confidence_interval": {
    "low": 461000, "high": 509000, "confidence_level": 0.90
  },
  "model_version": "avm-v3.2.1",
  "computed_at": "2026-03-10T04:30:00Z",
  "comparables": [
    {
      "property_id": "uuid",
      "address": "123 Oak St",
      "sale_price": 472000,
      "sale_date": "2025-12-15",
      "similarity_score": 0.94,
      "adjustments": [
        { "factor": "square_footage", "adjustment": +8500, "reason": "Subject 150 sqft larger" },
        { "factor": "condition", "adjustment": -5000, "reason": "Comp recently renovated" },
        { "factor": "lot_size", "adjustment": +2000, "reason": "Subject lot 500 sqft larger" }
      ],
      "adjusted_price": 477500
    }
  ],
  "explainability": {
    "top_features": [
      { "feature": "gross_living_area", "importance": 0.28, "direction": "positive" },
      { "feature": "neighborhood_median", "importance": 0.19, "direction": "positive" },
      { "feature": "condition_score", "importance": 0.12, "direction": "negative" }
    ],
    "spatial_contribution": 0.15,       -- Fraction of value from neighborhood effect
    "temporal_contribution": 0.08,      -- Fraction from market momentum
    "compliance_flags": []
  }
}
```

### Property Search API

```
POST /api/v1/search
Request:
{
  "query": "3BR craftsman near good schools under 600K",    -- Natural language
  "filters": {                                               -- Structured filters
    "price_range": { "min": 300000, "max": 600000 },
    "bedrooms_min": 3,
    "property_types": ["SINGLE_FAMILY", "TOWNHOUSE"],
    "geo_bounds": {
      "type": "radius",
      "center": { "lat": 47.6062, "lon": -122.3321 },
      "radius_miles": 15
    }
  },
  "visual_reference": "base64_encoded_image",               -- Optional: find visually similar
  "sort": "relevance",
  "page": 1,
  "page_size": 20,
  "user_id": "uuid"                                          -- For personalization
}

Response:
{
  "total_results": 347,
  "results": [
    {
      "property_id": "uuid",
      "address": "456 Elm Ave, Seattle, WA 98103",
      "list_price": 549000,
      "avm_estimate": 535000,
      "bedrooms": 3, "bathrooms": 2.0,
      "sqft": 1850, "lot_sqft": 6200,
      "year_built": 1942,
      "photos": ["url1", "url2"],
      "listing_quality_score": 8.2,
      "relevance_score": 0.92,
      "match_reasons": ["craftsman_style", "school_district_rating_8", "price_in_range"],
      "climate_risk_summary": { "overall": "LOW", "flood": 2, "wildfire": 1 },
      "days_on_market": 12,
      "status": "ACTIVE"
    }
  ],
  "search_metadata": {
    "query_interpretation": {
      "style": "craftsman",
      "school_quality": "above_average",
      "price_ceiling": 600000,
      "bedrooms": 3
    },
    "retrieval_sources": {
      "geospatial": 1200,
      "semantic": 800,
      "visual": 450,
      "fused_candidates": 347
    },
    "latency_ms": 87
  }
}
```

### Building Digital Twin API

```
GET /api/v1/buildings/{building_id}/twin
Response:
{
  "building_id": "uuid",
  "snapshot_timestamp": "2026-03-10T10:15:30Z",
  "hvac_summary": {
    "zones_count": 42,
    "zones_at_setpoint": 38,
    "zones_warming": 3,
    "zones_cooling": 1,
    "avg_temperature_f": 72.1,
    "avg_humidity_pct": 44.2,
    "total_airflow_cfm": 85000
  },
  "energy": {
    "current_demand_kw": 450,
    "today_consumption_kwh": 3200,
    "month_to_date_kwh": 28500,
    "savings_vs_baseline_pct": 18.3,
    "current_cost_rate": 0.14
  },
  "occupancy": {
    "current": 342,
    "capacity": 800,
    "utilization_pct": 42.8,
    "predicted_peak_today": 520
  },
  "equipment_health": {
    "total_equipment": 156,
    "healthy": 148,
    "warning": 6,
    "critical": 2,
    "next_maintenance": {
      "equipment_id": "ahu-03",
      "task": "belt_replacement",
      "due_date": "2026-03-18",
      "predicted_failure_if_skipped": "2026-04-02"
    }
  },
  "safety": {
    "status": "NORMAL",
    "co2_max_ppm": 680,
    "fire_system": "ARMED",
    "last_drill": "2026-02-15"
  },
  "optimizer": {
    "mode": "ECONOMY",
    "policy_version": "rl-v2.4",
    "last_action": "Reduced zone-12 setpoint 73F→71F (low occupancy detected)",
    "energy_savings_mtd_pct": 18.3
  }
}
```

### Tenant Screening API

```
POST /api/v1/screening
Request:
{
  "applicant": {
    "full_name": "...",
    "ssn_hash": "sha256_hash",         -- Hashed; never stored raw
    "annual_income": 85000,
    "employment_months": 36,
    "credit_authorized": true
  },
  "property_id": "uuid",
  "lease_terms": {
    "monthly_rent": 2200,
    "term_months": 12
  }
}

Response:
{
  "screening_id": "uuid",
  "decision": "APPROVED",              -- APPROVED | CONDITIONAL | DENIED
  "compatibility_score": 82,           -- 0-100
  "risk_assessment": {
    "credit_score_range": "GOOD",      -- Category, not exact score
    "debt_to_income_ratio": 0.28,
    "rent_to_income_ratio": 0.31,
    "rental_history": "POSITIVE",
    "employment_stability": "STABLE"
  },
  "conditions": [],                    -- e.g., ["additional_deposit_required"]
  "adverse_action_reasons": [],        -- Required if DENIED; ECOA compliance
  "fair_housing_attestation": {
    "prohibited_variables_excluded": true,
    "proxy_detection_passed": true,
    "model_version": "screen-v1.8",
    "audit_id": "uuid"
  }
}
```

---

## Core Algorithms

### Comparable Sales Selection

```
FUNCTION select_comparables(subject_property, k=5):
    -- Step 1: Candidate generation (broad filter)
    candidates = geospatial_query(
        center = subject_property.location,
        radius = adaptive_radius(subject_property),  -- 1 mile urban, 10 miles rural
        sold_within_months = 12,
        property_type = subject_property.property_type
    )

    -- Step 2: Embedding similarity
    subject_embedding = property_encoder.encode(subject_property)
    -- Embedding captures: sqft, bedrooms, lot_size, year_built, condition,
    -- construction_type, neighborhood_quality, school_district, walkability
    FOR each candidate IN candidates:
        candidate.similarity = cosine_similarity(
            subject_embedding,
            property_embeddings[candidate.id]
        )

    -- Step 3: Temporal decay weighting
    FOR each candidate IN candidates:
        months_since_sale = months_between(candidate.sale_date, today)
        candidate.temporal_weight = exp(-0.1 * months_since_sale)

    -- Step 4: Combined scoring
    FOR each candidate IN candidates:
        candidate.comp_score = (
            0.6 * candidate.similarity +
            0.25 * candidate.temporal_weight +
            0.15 * geographic_proximity_score(subject_property, candidate)
        )

    -- Step 5: Diversity constraint
    -- Avoid selecting 5 comps from the same street/building
    selected = greedy_diverse_top_k(candidates, k=5, diversity_radius=200m)

    -- Step 6: Compute adjustments for each comparable
    FOR each comp IN selected:
        comp.adjustments = compute_adjustments(subject_property, comp)
        -- Adjustments for: sqft difference, bedroom count, condition,
        -- lot size, garage, pool, renovation recency, market trend since sale
        comp.adjusted_price = comp.sale_price + sum(comp.adjustments)

    RETURN selected
```

### HVAC Reinforcement Learning Optimizer

```
FUNCTION hvac_optimization_step(building_twin, weather_forecast, energy_prices):
    -- State representation
    state = {
        zone_temperatures:    building_twin.get_zone_temps(),
        zone_occupancies:     building_twin.get_zone_occupancies(),
        outdoor_temp:         weather_forecast.current_temp,
        outdoor_forecast_4h:  weather_forecast.next_4_hours,
        energy_price_current: energy_prices.current_rate,
        energy_price_4h:      energy_prices.next_4_hours,
        time_of_day:          current_time(),
        day_of_week:          current_day(),
        equipment_status:     building_twin.get_equipment_status()
    }

    -- Safety check (ALWAYS runs before RL action)
    safety_overrides = check_safety_constraints(building_twin)
    IF safety_overrides IS NOT EMPTY:
        EXECUTE safety_overrides IMMEDIATELY
        RETURN safety_overrides  -- Skip optimization this cycle

    -- RL policy inference
    action = rl_policy.predict(state)
    -- Action space: per-zone setpoint adjustments (±3°F), supply air temp,
    -- chiller staging, economizer mode, demand response participation

    -- Constraint validation (comfort bounds)
    FOR each zone IN action.zone_setpoints:
        zone.setpoint = clamp(zone.setpoint,
            min = occupied_min_temp(zone),      -- e.g., 68°F if occupied
            max = occupied_max_temp(zone)        -- e.g., 76°F if occupied
        )
        IF zone.occupancy == 0:
            zone.setpoint = setback_temp(zone)  -- Wider range for unoccupied

    -- Pre-cooling / pre-heating logic
    IF energy_prices.next_2_hours > 1.5 * energy_prices.current_rate:
        -- Pre-cool now while energy is cheap
        FOR each zone IN action.zone_setpoints:
            IF zone.occupancy_predicted_2h > 0:
                zone.setpoint = zone.setpoint - 2  -- Overcool slightly

    -- Apply validated actions to building systems
    actuator_commands = translate_to_bacnet_commands(action)
    building_controller.execute(actuator_commands)

    -- Log for reward computation (next cycle)
    log_action(state, action, energy_consumption, comfort_metrics)
```

### Climate Risk Scoring

```
FUNCTION compute_climate_risk(parcel, scenario="SSP2-4.5", horizon=2050):
    -- Step 1: Map parcel to climate grid cells
    grid_cells = climate_grid.intersect(parcel.geometry)
    -- Parcels may span multiple ~1km grid cells; area-weight contributions

    -- Step 2: Per-peril scoring
    scores = {}

    -- Flood risk
    flood_depth = weighted_average(
        [cell.flood_depth_100yr[scenario][horizon] FOR cell IN grid_cells],
        weights = intersection_areas
    )
    elevation = parcel.elevation_above_nearest_waterway
    first_floor_height = parcel.building.first_floor_elevation
    scores.flood = flood_vulnerability_curve(
        flood_depth, elevation, first_floor_height,
        construction_type = parcel.building.construction_type
    )

    -- Wildfire risk
    vegetation_density = satellite_vegetation_index(parcel.geometry)
    slope = terrain_slope(parcel.geometry)
    defensible_space = compute_defensible_space(parcel.geometry, vegetation_density)
    fire_weather_index = grid_cells.avg(cell.fire_weather_index[scenario][horizon])
    scores.wildfire = wildfire_risk_model(
        vegetation_density, slope, defensible_space,
        fire_weather_index, parcel.building.roof_material
    )

    -- Heat stress
    cooling_degree_days_delta = grid_cells.avg(
        cell.cdd_65[scenario][horizon] - cell.cdd_65_baseline
    )
    urban_heat_island = compute_uhi_adjustment(parcel.location)
    scores.heat_stress = heat_vulnerability(
        cooling_degree_days_delta + urban_heat_island,
        parcel.building.has_central_air,
        parcel.building.insulation_rating
    )

    -- Wind/storm risk
    design_wind_speed = grid_cells.max(cell.peak_gust[scenario][horizon])
    scores.wind_storm = wind_vulnerability(
        design_wind_speed,
        parcel.building.roof_type,
        parcel.building.year_built,
        parcel.building.stories
    )

    -- Drought / water stress
    scores.drought = grid_cells.avg(cell.water_stress_index[scenario][horizon])

    -- Sea level rise (only for coastal properties)
    IF parcel.distance_to_coast_km < 50:
        slr_meters = grid_cells.avg(cell.sea_level_rise_m[scenario][horizon])
        scores.sea_level = sea_level_vulnerability(
            slr_meters, parcel.elevation_above_msl,
            parcel.building.has_flood_barrier
        )
    ELSE:
        scores.sea_level = 0

    -- Step 3: Composite risk and financial impact
    composite = weighted_composite(scores, weights=peril_weights_by_region)
    annual_expected_loss = compute_expected_annual_loss(scores, parcel.building.value)
    insurance_premium_estimate = loss_to_premium(annual_expected_loss)

    RETURN {
        scores: scores,
        composite: composite,
        annual_expected_loss: annual_expected_loss,
        insurance_estimate: insurance_premium_estimate,
        climate_adjusted_value: parcel.avm_estimate - present_value(annual_expected_loss, 30)
    }
```

### Entity Resolution for Properties

```
FUNCTION resolve_property(incoming_record):
    -- Step 1: Address normalization
    normalized_address = address_parser.parse(incoming_record.address)
    -- Handles: "123 N Main St Apt 4B" → {number: 123, direction: N,
    --   street: Main, suffix: St, unit: 4B}

    -- Step 2: Candidate retrieval (blocking)
    candidates = []
    -- Block 1: Exact street + zip match
    candidates += property_index.query(
        street = normalized_address.street,
        zip = normalized_address.zip
    )
    -- Block 2: Geospatial proximity (for geocoded records)
    IF incoming_record.has_geocode:
        candidates += geospatial_index.query(
            center = incoming_record.geocode,
            radius = 50m
        )
    -- Block 3: Parcel number match (if available)
    IF incoming_record.has_parcel_number:
        candidates += parcel_index.query(incoming_record.parcel_number)

    -- Step 3: Pairwise similarity scoring
    FOR each candidate IN deduplicate(candidates):
        features = extract_match_features(incoming_record, candidate)
        -- Features: address_edit_distance, unit_match, geocode_distance,
        -- sqft_difference_pct, year_built_match, bedroom_match
        candidate.match_score = match_model.predict(features)

    -- Step 4: Decision
    best_match = candidates.max_by(match_score)
    IF best_match.match_score >= HIGH_CONFIDENCE_THRESHOLD (0.95):
        RETURN { action: MERGE, canonical_id: best_match.canonical_id }
    ELIF best_match.match_score >= REVIEW_THRESHOLD (0.70):
        RETURN { action: HUMAN_REVIEW, candidates: top_3(candidates) }
    ELSE:
        RETURN { action: CREATE_NEW, canonical_id: generate_uuid() }
```

### Lease Amendment Composition

```
FUNCTION compose_lease_with_amendments(base_lease_extraction, amendments):
    -- Amendments must be processed in chronological order
    amendments = sort_by_date(amendments)
    effective_lease = deep_copy(base_lease_extraction)

    FOR each amendment IN amendments:
        -- Step 1: Identify modified sections
        FOR each modification IN amendment.modifications:
            target_section = resolve_section_reference(
                modification.reference,     -- e.g., "Section 3.1" or "the parking provision"
                effective_lease.structure
            )

            IF target_section IS RESOLVED:
                IF modification.type == "REPLACE":
                    effective_lease.clauses[target_section] = modification.new_content
                ELIF modification.type == "SUPPLEMENT":
                    effective_lease.clauses[target_section].append(modification.new_content)
                ELIF modification.type == "DELETE":
                    effective_lease.clauses[target_section].mark_deleted()
            ELSE:
                -- Cannot resolve section reference; flag for human review
                effective_lease.unresolved_amendments.append({
                    amendment_id: amendment.id,
                    reference: modification.reference,
                    reason: "Section reference could not be resolved"
                })

        -- Step 2: Update financial terms (rent, escalation, etc.)
        IF amendment.modifies_rent:
            effective_lease.base_rent = amendment.new_base_rent
            effective_lease.rent_effective_date = amendment.effective_date

        IF amendment.modifies_term:
            effective_lease.expiration_date = amendment.new_expiration_date

    -- Step 3: Consistency validation
    validate_lease_consistency(effective_lease)
    -- Checks: commencement + term = expiration, escalation rates within
    -- market norms, no contradictory clauses from different amendments

    RETURN effective_lease
```

### Natural Language Query Understanding

```
FUNCTION parse_property_query(query_text):
    -- Step 1: Intent classification
    -- Determine query type: search, valuation, comparison, market info
    intent = intent_classifier.predict(query_text)
    -- e.g., "3BR craftsman near good schools" → PROPERTY_SEARCH

    -- Step 2: Entity extraction
    entities = entity_extractor.extract(query_text)
    -- Extracts: bedrooms=3, style=craftsman, school_quality=above_average
    -- Uses a fine-tuned NER model trained on property search queries

    -- Step 3: Implicit constraint inference
    -- "Good schools" → school_rating >= 7 (configurable threshold)
    -- "Near downtown" → distance_to_city_center <= 5 miles
    -- "Quiet neighborhood" → traffic_volume_index <= 3 AND crime_rate_index <= 3
    FOR each entity IN entities:
        IF entity.type == "SUBJECTIVE_QUALITY":
            entity.structured_filter = quality_to_filter_mapping[entity.value]
            entity.confidence = quality_to_filter_mapping[entity.value].confidence

    -- Step 4: Geographic scope resolution
    IF entities.has_geographic_entity:
        geo_scope = geocoder.resolve(entities.geographic_entity)
    ELSE:
        geo_scope = user_profile.default_search_area
        -- Fall back to user's recent search geography

    -- Step 5: Construct structured query
    structured_query = {
        filters: entities_to_filters(entities),
        geo_bounds: geo_scope,
        semantic_embedding: text_encoder.encode(query_text),
        -- Full query embedding for semantic matching against listing descriptions
        sort: infer_sort_preference(entities),
        -- "cheapest" → sort by price asc; "newest" → sort by list_date desc
    }

    RETURN structured_query
```

### Predictive Maintenance Scoring

```
FUNCTION compute_equipment_health(equipment, sensor_history):
    -- Step 1: Extract degradation features from sensor data
    degradation_features = {}

    -- Vibration analysis (for rotating equipment: fans, pumps, compressors)
    IF equipment.has_vibration_sensor:
        vibration = sensor_history.get(equipment.vibration_sensor_id, days=30)
        degradation_features.vibration_trend = linear_regression_slope(vibration)
        degradation_features.vibration_rms = root_mean_square(vibration.last_24h)
        degradation_features.vibration_peak_ratio = max(vibration.last_24h) / mean(vibration.last_24h)

    -- Temperature differential (for heat exchangers, chillers)
    IF equipment.type IN [CHILLER, AHU, BOILER]:
        supply_temp = sensor_history.get(equipment.supply_temp_sensor, days=30)
        return_temp = sensor_history.get(equipment.return_temp_sensor, days=30)
        delta_t = return_temp - supply_temp
        degradation_features.delta_t_trend = linear_regression_slope(delta_t)
        -- Declining delta_t = declining heat transfer efficiency = fouling or refrigerant loss

    -- Run time and cycling
    degradation_features.total_runtime_hours = equipment.lifetime_runtime
    degradation_features.cycles_last_30_days = count_transitions(
        sensor_history.get(equipment.status_sensor, days=30)
    )
    degradation_features.avg_cycle_duration = mean_run_duration(
        sensor_history.get(equipment.status_sensor, days=30)
    )
    -- Shortening cycle durations indicate declining performance

    -- Step 2: Health score prediction
    health_score = health_model.predict(degradation_features)
    -- Output: 0.0 (imminent failure) to 1.0 (like-new condition)

    -- Step 3: Remaining useful life estimation
    IF health_score < 0.7:
        -- Fit exponential decay to health score trend
        health_trend = sensor_history.get_health_scores(equipment.id, months=6)
        rul_days = estimate_time_to_threshold(health_trend, threshold=0.3)
        predicted_failure_date = today() + rul_days
    ELSE:
        predicted_failure_date = NULL  -- Healthy; no predicted failure

    -- Step 4: Maintenance recommendation
    IF health_score < 0.3:
        recommendation = URGENT_MAINTENANCE
        priority = P1
    ELIF health_score < 0.5:
        recommendation = SCHEDULED_MAINTENANCE
        priority = P2
    ELIF health_score < 0.7:
        recommendation = MONITOR_CLOSELY
        priority = P3
    ELSE:
        recommendation = NORMAL_OPERATION
        priority = P4

    RETURN {
        health_score: health_score,
        predicted_failure_date: predicted_failure_date,
        recommendation: recommendation,
        priority: priority,
        contributing_factors: rank_features_by_importance(degradation_features)
    }
```
