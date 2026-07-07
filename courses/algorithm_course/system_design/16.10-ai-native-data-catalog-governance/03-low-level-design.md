# Low-Level Design — AI-Native Data Catalog & Governance

## Data Model

### Entity-Relationship Model

The core data model is a **metadata graph** stored in a relational database with an adjacency-list representation. Every metadata asset is an **Entity** with typed properties, and connections between entities are **Relationships** with direction and type.

### Core Entity Schema

```
Entity
├── entity_id          UUID (primary key)
├── entity_type        ENUM (table, column, pipeline, dashboard, glossary_term, user, domain, ml_model)
├── qualified_name     VARCHAR(1024) UNIQUE  -- e.g., "warehouse.schema.table.column"
├── display_name       VARCHAR(256)
├── description        TEXT
├── owner_id           UUID (FK → Entity[user])
├── domain_id          UUID (FK → Entity[domain])
├── created_at         TIMESTAMP
├── updated_at         TIMESTAMP
├── deleted_at         TIMESTAMP (soft delete)
└── version            BIGINT (optimistic locking)
```

### Relationship Schema

```
Relationship
├── relationship_id    UUID (primary key)
├── source_id          UUID (FK → Entity)
├── target_id          UUID (FK → Entity)
├── relationship_type  ENUM (lineage, contains, owns, uses, depends_on, produces, consumes)
├── properties         JSONB  -- type-specific metadata (e.g., transformation SQL for lineage)
├── created_at         TIMESTAMP
└── updated_at         TIMESTAMP
```

### Tag & Classification Schema

```
Tag
├── tag_id             UUID (primary key)
├── tag_key            VARCHAR(128)  -- e.g., "pii_type", "data_tier", "sensitivity"
├── tag_value          VARCHAR(256)  -- e.g., "email", "gold", "confidential"
├── source             ENUM (manual, auto_classification, inherited, policy)
├── confidence         FLOAT (0.0-1.0)  -- ML confidence for auto-classified tags
└── created_at         TIMESTAMP

EntityTag
├── entity_id          UUID (FK → Entity)
├── tag_id             UUID (FK → Tag)
├── applied_by         UUID (FK → Entity[user] or system)
└── applied_at         TIMESTAMP
```

### Governance Policy Schema

```
Policy
├── policy_id          UUID (primary key)
├── policy_name        VARCHAR(256)
├── policy_type        ENUM (access_control, column_masking, row_filtering, retention, quality_threshold)
├── condition          JSONB  -- tag-based predicate: {"tag_key": "pii_type", "operator": "exists"}
├── action             JSONB  -- {"type": "mask", "function": "sha256_hash"}
├── scope              ENUM (global, domain, dataset)
├── scope_id           UUID (nullable, FK → Entity)
├── priority           INT  -- conflict resolution: higher priority wins
├── enabled            BOOLEAN
├── created_by         UUID (FK → Entity[user])
├── created_at         TIMESTAMP
└── updated_at         TIMESTAMP
```

### Quality Profile Schema

```
QualityProfile
├── profile_id         UUID (primary key)
├── entity_id          UUID (FK → Entity[table or column])
├── dimension          ENUM (freshness, completeness, uniqueness, validity, consistency)
├── score              FLOAT (0.0-1.0)
├── details            JSONB  -- dimension-specific details
├── measured_at        TIMESTAMP
└── run_id             UUID  -- links to profiling job execution

QualityScore (materialized composite)
├── entity_id          UUID (FK → Entity)
├── composite_score    FLOAT (0.0-1.0)  -- weighted average of dimensions
├── trend              ENUM (improving, stable, degrading)
├── last_updated       TIMESTAMP
```

### Data Contract Schema

```
DataContract
├── contract_id         UUID (primary key)
├── producer_entity_id  UUID (FK → Entity[table or dataset])
├── contract_name       VARCHAR(256)
├── version             SEMVER  -- e.g., "2.1.0" (major.minor.patch)
├── status              ENUM (draft, active, deprecated)
├── schema_spec         JSONB  -- column names, types, constraints, nullability
├── quality_slos        JSONB  -- {"freshness_max_minutes": 60, "completeness_min": 0.95}
├── availability_slo    FLOAT  -- e.g., 0.999
├── owner_id            UUID (FK → Entity[user])
├── created_at          TIMESTAMP
├── updated_at          TIMESTAMP
└── deprecated_at       TIMESTAMP (nullable)

ContractSubscription
├── subscription_id     UUID (primary key)
├── contract_id         UUID (FK → DataContract)
├── consumer_entity_id  UUID (FK → Entity[pipeline, dashboard, ml_model])
├── consumer_owner_id   UUID (FK → Entity[user])
├── subscribed_at       TIMESTAMP
├── min_version         SEMVER  -- minimum contract version consumer depends on
└── notification_channel VARCHAR(256)  -- e.g., "slack:#data-commerce", "email:team@..."

ContractViolation
├── violation_id        UUID (primary key)
├── contract_id         UUID (FK → DataContract)
├── violation_type      ENUM (schema_break, quality_slo_breach, availability_slo_breach)
├── details             JSONB  -- specific violation details
├── detected_at         TIMESTAMP
├── resolved_at         TIMESTAMP (nullable)
└── resolution          TEXT (nullable)
```

### AI Readiness & Bias Metadata Schema

```
AIReadinessProfile
├── profile_id          UUID (primary key)
├── entity_id           UUID (FK → Entity[table or dataset])
├── purpose             VARCHAR(256)  -- "fraud detection training", "recommendation model"
├── representativeness  JSONB  -- {"demographic_distribution": {...}, "temporal_coverage": "2020-2026"}
├── bias_assessment     JSONB  -- {"protected_attributes": ["gender", "age"], "fairness_metrics": {...}}
├── label_quality       FLOAT (0.0-1.0)  -- accuracy of labels in supervised datasets
├── consent_basis       ENUM (explicit_consent, legitimate_interest, contract, legal_obligation)
├── collection_method   TEXT  -- "user registration form", "web scraping", "third-party purchase"
├── assessed_by         UUID (FK → Entity[user])
├── assessed_at         TIMESTAMP
└── eu_ai_act_risk      ENUM (prohibited, high_risk, limited_risk, minimal_risk)
```

### Metadata Change Event Schema

```
MetadataChangeEvent
├── event_id            UUID (primary key)
├── event_type          ENUM (entity_created, entity_updated, entity_deleted,
│                             tag_applied, tag_removed, lineage_added, lineage_removed,
│                             quality_measured, policy_changed, contract_violated)
├── entity_id           UUID (FK → Entity)
├── entity_type         ENUM
├── change_payload      JSONB  -- type-specific delta
├── previous_version    BIGINT -- entity version before change
├── new_version         BIGINT -- entity version after change
├── source              VARCHAR(256) -- connector or user that caused the change
├── trace_id            VARCHAR(128) -- W3C trace context for distributed tracing
├── timestamp           TIMESTAMP
└── partition_key       VARCHAR(256) -- for event bus partitioning (typically entity_id)
```

### Search Index Document Schema

```
SearchDocument (one per entity, stored in search index)
├── entity_id           UUID
├── qualified_name      VARCHAR (boosted 3x in BM25)
├── display_name        VARCHAR (boosted 2x in BM25)
├── description         TEXT (boosted 1x in BM25)
├── entity_type         KEYWORD (facetable)
├── domain              KEYWORD (facetable)
├── owner_name          KEYWORD (facetable)
├── tags                KEYWORD[] (facetable, multi-valued)
├── quality_score       FLOAT (sortable)
├── usage_count_30d     LONG (sortable)
├── last_updated        DATE (sortable)
├── is_certified        BOOLEAN (filterable)
├── is_deprecated       BOOLEAN (filterable)
├── lineage_upstream    INT (depth count)
├── lineage_downstream  INT (depth count)
├── column_names        TEXT (searchable, not displayed)
├── column_descriptions TEXT (searchable, not displayed)
├── embedding_vector    FLOAT[384] (for semantic search, kNN index)
└── _updated_at         DATE (internal, for index sync tracking)
```

### Indexing Strategy

| Table | Index | Purpose |
|-------|-------|---------|
| Entity | `qualified_name` UNIQUE | Fast lookup by fully qualified path |
| Entity | `(entity_type, domain_id)` | Filter by type within domain |
| Entity | `updated_at DESC` | Recent changes feed |
| Entity | `(deleted_at IS NULL)` partial index | Exclude soft-deleted entities from queries |
| Relationship | `(source_id, relationship_type)` | Forward lineage traversal |
| Relationship | `(target_id, relationship_type)` | Backward lineage traversal |
| Relationship | `(source_id, target_id, relationship_type)` UNIQUE | Prevent duplicate edges |
| EntityTag | `(tag_key, tag_value)` | Policy evaluation: "find all entities with tag X" |
| EntityTag | `(entity_id, tag_key)` UNIQUE | One value per tag key per entity |
| QualityProfile | `(entity_id, dimension, measured_at DESC)` | Latest quality per dimension |
| DataContract | `(producer_entity_id, status)` | Find active contracts for entity |
| ContractSubscription | `(contract_id)` | Find all consumers of a contract |
| MetadataChangeEvent | `(entity_id, timestamp DESC)` | Entity history timeline |
| MetadataChangeEvent | `(event_type, timestamp DESC)` | Event type filtering |

---

## API Design

### Search API

```
GET /api/v1/search
  ?q={query_text}
  &type={entity_type}
  &tags={tag_key:tag_value}
  &owner={user_id}
  &domain={domain_id}
  &quality_min={0.0-1.0}
  &sort={relevance|usage|freshness|quality}
  &page={offset}
  &size={limit}

Response:
{
  "results": [
    {
      "entity_id": "...",
      "qualified_name": "warehouse.analytics.customer_orders",
      "entity_type": "table",
      "display_name": "Customer Orders",
      "description": "All orders placed by customers...",
      "owner": { "name": "data-platform-team", "domain": "commerce" },
      "quality_score": 0.92,
      "usage_count_30d": 1547,
      "tags": [{"key": "pii_type", "value": "email"}, {"key": "tier", "value": "gold"}],
      "lineage_depth": { "upstream": 3, "downstream": 12 },
      "relevance_score": 0.87
    }
  ],
  "facets": {
    "entity_type": [{"value": "table", "count": 142}, ...],
    "domain": [...],
    "tags": [...]
  },
  "total": 342,
  "page": 0
}
```

### Lineage API

```
GET /api/v1/lineage/{entity_id}
  ?direction={upstream|downstream|both}
  &depth={max_hops}
  &granularity={table|column}

Response:
{
  "root": { "entity_id": "...", "qualified_name": "..." },
  "nodes": [...],
  "edges": [
    {
      "source": "warehouse.raw.orders.customer_email",
      "target": "warehouse.analytics.customer_360.email",
      "transformation": "LOWER(TRIM(customer_email))",
      "pipeline": "dbt_analytics_v2",
      "last_observed": "2026-03-10T08:30:00Z"
    }
  ]
}
```

### Classification API

```
POST /api/v1/classify
{
  "entity_ids": ["...", "..."],    // specific columns, or omit for full scan
  "classifiers": ["pii", "phi", "pci"],
  "confidence_threshold": 0.85,
  "auto_apply": false              // false = suggest, true = auto-tag
}

Response:
{
  "results": [
    {
      "entity_id": "...",
      "qualified_name": "warehouse.raw.users.ssn",
      "classifications": [
        { "tag": "pii_type:ssn", "confidence": 0.97, "method": "regex+ner" }
      ]
    }
  ],
  "stats": { "scanned": 500, "classified": 47, "skipped": 3 }
}
```

### Policy Evaluation API

```
POST /api/v1/policy/evaluate
{
  "user_id": "...",
  "entity_id": "...",
  "action": "read",
  "context": { "ip_range": "10.0.0.0/8", "purpose": "analytics" }
}

Response:
{
  "decision": "allow_with_masking",
  "applied_policies": [
    { "policy_id": "...", "type": "column_masking", "columns": ["ssn", "email"],
      "masking_function": "sha256_hash" }
  ],
  "row_filter": "region = 'US'"
}
```

### Natural Language Query API

```
POST /api/v1/nl-query
{
  "question": "How many active customers placed orders last month?",
  "context": { "domain": "commerce", "preferred_tables": ["customer_360"] }
}

Response:
{
  "sql": "SELECT COUNT(DISTINCT customer_id) FROM analytics.customer_360 WHERE status = 'active' AND last_order_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')",
  "confidence": 0.82,
  "tables_used": ["analytics.customer_360"],
  "explanation": "Counts distinct active customers with at least one order in the previous calendar month",
  "warnings": ["Column 'status' has 3% NULL values — results may undercount"]
}
```

### AI Agent API (MCP-Compatible)

```
POST /api/v1/agent/discover
{
  "agent_id": "pipeline-builder-agent-v2",
  "query": "customer revenue datasets for quarterly reporting",
  "intent": "table_discovery",
  "context": {
    "domain": "commerce",
    "required_quality_min": 0.8,
    "required_freshness_max_hours": 24,
    "exclude_deprecated": true
  },
  "max_results": 5
}

Response:
{
  "datasets": [
    {
      "entity_id": "...",
      "qualified_name": "warehouse.analytics.customer_revenue_quarterly",
      "description": "Quarterly customer revenue aggregated by region and product line",
      "schema": {
        "columns": [
          {"name": "customer_id", "type": "BIGINT", "description": "Unique customer identifier", "pii": false},
          {"name": "email", "type": "VARCHAR", "description": "Customer email", "pii": true, "masked": true},
          {"name": "revenue_q", "type": "DECIMAL(12,2)", "description": "Quarterly revenue in USD"}
        ]
      },
      "quality_score": 0.94,
      "last_updated": "2026-03-19T06:00:00Z",
      "owner": "data-platform-team",
      "lineage_summary": {"upstream_tables": 3, "downstream_consumers": 8},
      "contracts": [{"version": "2.0.1", "status": "active"}],
      "access_decision": "allow_with_masking",
      "masked_columns": ["email"]
    }
  ],
  "agent_session_id": "sess-abc-123",
  "audit_logged": true
}
```

### Data Contract Validation API

```
POST /api/v1/contracts/validate
{
  "producer_entity_id": "...",
  "proposed_change": {
    "type": "schema_change",
    "changes": [
      {"action": "drop_column", "column": "legacy_status"},
      {"action": "add_column", "column": "status_v2", "type": "VARCHAR(50)"},
      {"action": "change_type", "column": "amount", "from": "INT", "to": "DECIMAL(12,2)"}
    ]
  }
}

Response:
{
  "validation_result": "BREAKING_CHANGE_DETECTED",
  "breaking_changes": [
    {
      "change": "drop_column: legacy_status",
      "affected_contracts": [
        {"contract_id": "...", "contract_name": "commerce-reporting-v2", "version": "2.0.1"}
      ],
      "affected_consumers": [
        {"entity_id": "...", "name": "quarterly_revenue_dashboard", "owner": "bi-team"},
        {"entity_id": "...", "name": "churn_prediction_pipeline", "owner": "ml-team"}
      ]
    },
    {
      "change": "change_type: amount INT → DECIMAL(12,2)",
      "affected_contracts": [
        {"contract_id": "...", "contract_name": "commerce-reporting-v2", "version": "2.0.1"}
      ],
      "severity": "warning",
      "note": "Type widening — may be compatible but consumers should verify"
    }
  ],
  "non_breaking_changes": [
    {"change": "add_column: status_v2", "status": "compatible"}
  ]
}
```

---

## Core Algorithms

### Algorithm 1: Column-Level Lineage Extraction via SQL AST Parsing

```
FUNCTION extract_column_lineage(sql_text, schema_context):
    // Parse SQL into Abstract Syntax Tree
    ast = parse_sql(sql_text)

    // Resolve all table references against schema context
    table_refs = resolve_table_aliases(ast, schema_context)

    lineage_edges = []

    FOR EACH output_column IN ast.select_clause:
        // Trace each output column to its source columns
        source_columns = trace_column_sources(output_column, table_refs, schema_context)

        FOR EACH source_col IN source_columns:
            edge = {
                source: source_col.qualified_name,
                target: output_column.qualified_name,
                transformation: extract_transformation_expression(output_column),
                transform_type: classify_transform(output_column)  // direct, aggregation, filter, join
            }
            lineage_edges.append(edge)

    // Handle SELECT * by expanding to all columns from schema context
    IF ast.has_select_star:
        FOR EACH table IN table_refs:
            FOR EACH col IN schema_context.get_columns(table):
                lineage_edges.append({source: col, target: col, transformation: "passthrough"})

    // Handle CTEs recursively
    FOR EACH cte IN ast.common_table_expressions:
        cte_lineage = extract_column_lineage(cte.query, schema_context)
        lineage_edges.extend(cte_lineage)

    RETURN lineage_edges

FUNCTION trace_column_sources(expression, table_refs, schema):
    // Base case: direct column reference
    IF expression.is_column_ref:
        table = resolve_column_table(expression.name, table_refs, schema)
        RETURN [table + "." + expression.name]

    // Recursive case: function call or operation
    IF expression.is_function OR expression.is_binary_op:
        sources = []
        FOR EACH child IN expression.children:
            sources.extend(trace_column_sources(child, table_refs, schema))
        RETURN sources

    // Subquery case
    IF expression.is_subquery:
        sub_lineage = extract_column_lineage(expression.query, schema)
        RETURN [edge.source FOR edge IN sub_lineage]

    RETURN []  // literal values have no source
```

**Complexity:** O(N × C) where N = number of output columns, C = average expression depth. Schema lookups are O(1) with cached schema context.

---

### Algorithm 2: Auto-Classification Pipeline (Hybrid NER + Regex + LLM)

```
FUNCTION classify_column(column_metadata, data_sample):
    classifications = []

    // Stage 1: Metadata-based classification (column name patterns)
    name_matches = apply_name_patterns(column_metadata.name)
    // e.g., "ssn", "social_security" → PII:SSN with confidence 0.9
    FOR EACH match IN name_matches:
        classifications.append({tag: match.tag, confidence: match.confidence, method: "name_pattern"})

    // Stage 2: Regex-based classification (data value patterns)
    FOR EACH value IN data_sample:
        FOR EACH pattern IN REGEX_PATTERNS:  // SSN: \d{3}-\d{2}-\d{4}, email: RFC5322, etc.
            IF pattern.matches(value):
                match_rate = count_matches(data_sample, pattern) / len(data_sample)
                IF match_rate > PATTERN_THRESHOLD:  // e.g., 0.7
                    classifications.append({
                        tag: pattern.tag,
                        confidence: min(0.95, match_rate),
                        method: "regex"
                    })

    // Stage 3: NER-based classification (unstructured text columns)
    IF column_metadata.type IN (TEXT, VARCHAR) AND avg_length(data_sample) > 20:
        ner_results = run_ner_model(data_sample)  // spaCy NER: PERSON, ORG, LOC, etc.
        entity_counts = aggregate_entity_types(ner_results)
        FOR EACH entity_type, count IN entity_counts:
            IF count / len(data_sample) > NER_THRESHOLD:  // e.g., 0.5
                classifications.append({
                    tag: map_ner_to_pii(entity_type),
                    confidence: count / len(data_sample),
                    method: "ner"
                })

    // Stage 4: LLM-based resolution (ambiguous cases)
    IF has_conflicting_classifications(classifications):
        llm_verdict = query_llm(
            column_name=column_metadata.name,
            sample_values=data_sample[:10],
            existing_tags=classifications,
            prompt="Determine the most likely data classification..."
        )
        classifications = resolve_conflicts(classifications, llm_verdict)

    // Merge: highest confidence per tag key wins
    RETURN deduplicate_by_confidence(classifications)
```

**Complexity:** O(S × P) for regex where S = sample size, P = pattern count. NER is O(S × L) where L = average text length.

---

### Algorithm 3: Usage-Weighted Search Ranking

```
FUNCTION rank_search_results(query, candidates, user_context):
    scored_results = []

    FOR EACH candidate IN candidates:
        // Component 1: Text relevance (BM25 from search index)
        text_score = candidate.bm25_score  // normalized 0-1

        // Component 2: Usage popularity (log-scaled query count)
        usage_score = log(1 + candidate.query_count_30d) / log(1 + MAX_QUERY_COUNT)

        // Component 3: Quality signal
        quality_score = candidate.composite_quality_score  // 0-1

        // Component 4: Freshness (exponential decay)
        days_since_update = (NOW - candidate.last_updated).days
        freshness_score = exp(-DECAY_RATE * days_since_update)  // DECAY_RATE ≈ 0.05

        // Component 5: User affinity (personalization)
        affinity_score = compute_affinity(user_context, candidate)
        // Based on: same domain, previously accessed, team ownership

        // Component 6: Certification bonus
        certification_bonus = 0.1 IF candidate.is_certified ELSE 0.0

        // Weighted combination (weights learned from click-through data)
        final_score = (
            W_TEXT * text_score +
            W_USAGE * usage_score +
            W_QUALITY * quality_score +
            W_FRESH * freshness_score +
            W_AFFINITY * affinity_score +
            certification_bonus
        )
        // Default weights: W_TEXT=0.35, W_USAGE=0.25, W_QUALITY=0.15, W_FRESH=0.10, W_AFFINITY=0.15

        scored_results.append({candidate, final_score})

    RETURN sort_by_score_descending(scored_results)
```

---

### Algorithm 4: Tag-Based Policy Evaluation with Inheritance

```
FUNCTION evaluate_access(user, entity, action):
    // Step 1: Collect all tags on the entity (direct + inherited)
    entity_tags = get_direct_tags(entity)

    // Inherit tags from parent entities (column inherits from table, table from schema, etc.)
    current = entity.parent
    WHILE current IS NOT NULL:
        parent_tags = get_direct_tags(current)
        FOR EACH tag IN parent_tags:
            IF tag.inheritable AND tag NOT IN entity_tags:
                entity_tags.add(tag.with_source("inherited"))
        current = current.parent

    // Step 2: Collect user's attributes (roles, groups, domain membership)
    user_attrs = get_user_attributes(user)

    // Step 3: Find all applicable policies (matching entity tags)
    applicable_policies = []
    FOR EACH policy IN active_policies:
        IF policy.condition.matches(entity_tags) AND policy.scope.includes(entity):
            applicable_policies.append(policy)

    // Sort by priority (highest first)
    applicable_policies.sort_by(priority, DESC)

    // Step 4: Evaluate policies in priority order
    decision = DEFAULT_DENY
    masking_rules = []
    row_filters = []

    FOR EACH policy IN applicable_policies:
        IF policy.type == "access_control":
            IF policy.allows(user_attrs, action):
                decision = ALLOW
            ELSE IF policy.denies(user_attrs, action):
                RETURN {decision: DENY, reason: policy.name}  // explicit deny is final

        ELSE IF policy.type == "column_masking":
            masking_rules.append(policy.action)

        ELSE IF policy.type == "row_filtering":
            row_filters.append(policy.action.filter_predicate)

    // Step 5: Compose final decision
    IF decision == ALLOW AND (masking_rules OR row_filters):
        RETURN {
            decision: ALLOW_WITH_CONDITIONS,
            masking: masking_rules,
            row_filter: combine_filters(row_filters, AND),
            audit_entry: {user, entity, action, policies_applied}
        }

    RETURN {decision, audit_entry: {user, entity, action, policies_applied}}
```

**Complexity:** O(T + P) where T = tags on entity path, P = active policies. Policy lookup uses tag-indexed inverted index for O(1) amortized matching.

---

### Algorithm 5: NL-to-SQL with Catalog-Augmented RAG

```
FUNCTION natural_language_to_sql(question, user_context):
    // Step 1: Extract intent and entities from the question
    intent = classify_intent(question)  // SELECT, COUNT, COMPARE, TREND, etc.
    mentioned_entities = extract_data_references(question)
    // e.g., "customers", "orders", "last month" → table hints + time filter

    // Step 2: Retrieve relevant catalog metadata via RAG
    search_results = catalog_search(mentioned_entities, user_context.domain)
    relevant_tables = []
    FOR EACH result IN search_results[:10]:
        table_meta = {
            qualified_name: result.qualified_name,
            columns: get_columns_with_descriptions(result.entity_id),
            sample_values: get_sample_values(result.entity_id, limit=5),
            relationships: get_foreign_keys(result.entity_id),
            quality_score: result.quality_score
        }
        relevant_tables.append(table_meta)

    // Step 3: Construct LLM prompt with schema context
    prompt = build_prompt(
        question=question,
        tables=relevant_tables,
        dialect=user_context.warehouse_dialect,  // PostgreSQL, Snowflake SQL, etc.
        guidelines=[
            "Use qualified table names",
            "Prefer tables with higher quality scores",
            "Apply appropriate date functions for the dialect",
            "Add LIMIT 1000 for safety"
        ]
    )

    // Step 4: Generate SQL via LLM
    raw_sql = call_llm(prompt, temperature=0.0)

    // Step 5: Validate and repair
    parsed = try_parse_sql(raw_sql)
    IF parsed.has_errors:
        // Self-correction loop (max 2 retries)
        correction_prompt = build_correction_prompt(raw_sql, parsed.errors, relevant_tables)
        raw_sql = call_llm(correction_prompt, temperature=0.0)
        parsed = try_parse_sql(raw_sql)

    // Step 6: Verify column references exist in catalog
    FOR EACH column_ref IN parsed.column_references:
        IF NOT catalog_contains(column_ref):
            RETURN {error: "Column not found: " + column_ref, suggestion: find_similar(column_ref)}

    // Step 7: Apply policy-based restrictions
    policy_result = evaluate_access(user_context.user, parsed.tables, "read")
    IF policy_result.masking:
        raw_sql = apply_masking_to_sql(raw_sql, policy_result.masking)
    IF policy_result.row_filter:
        raw_sql = inject_row_filter(raw_sql, policy_result.row_filter)

    // Step 8: Generate explanation
    explanation = generate_explanation(question, raw_sql, relevant_tables)

    RETURN {
        sql: raw_sql,
        confidence: estimate_confidence(parsed, relevant_tables),
        tables_used: parsed.table_references,
        explanation: explanation,
        warnings: collect_quality_warnings(parsed.table_references)
    }
```

**Complexity:** O(R × C) for RAG retrieval where R = results, C = columns per table. LLM inference is the latency Slowest part of the process (~2-4s per call).

---

### Algorithm 6: Active Metadata Event Processing

```
FUNCTION process_metadata_event(event):
    // Step 1: Classify event type and priority
    event_type = classify_event(event)
    priority = determine_priority(event_type, event.entity)

    // Step 2: Deduplication — check if this event is redundant
    event_hash = hash(event.entity_id, event.change_type, event.timestamp / DEDUP_WINDOW)
    IF seen_events.contains(event_hash):
        RETURN  // skip duplicate
    seen_events.add(event_hash, TTL=DEDUP_WINDOW)

    // Step 3: Burst detection — check if this is part of a mass operation
    source_event_count = increment_counter(event.source_id, window=5_MINUTES)
    IF source_event_count > BURST_THRESHOLD:  // e.g., 1000 events in 5 min
        IF NOT burst_detected[event.source_id]:
            burst_detected[event.source_id] = true
            emit_alert("Metadata burst detected from " + event.source_id)
        queue_for_batch_processing(event)
        RETURN

    // Step 4: Execute matching automation rules
    matching_rules = find_matching_rules(event_type, event.entity.tags, event.entity.domain)

    FOR EACH rule IN matching_rules (sorted by priority):
        SWITCH rule.action:
            CASE "propagate_tag":
                // Propagate classification tag to downstream entities via lineage
                downstream = get_downstream_entities(event.entity_id, max_hops=3)
                FOR EACH target IN downstream:
                    IF NOT has_tag(target, rule.tag):
                        apply_tag(target, rule.tag, source="propagated", confidence=rule.min_confidence)
                        emit_event(TagPropagatedEvent(target, rule.tag))

            CASE "alert_stakeholders":
                // Notify affected consumers of upstream change
                consumers = get_consumers_via_lineage(event.entity_id)
                FOR EACH consumer IN consumers:
                    notify(consumer.owner, rule.template, event)

            CASE "evaluate_contract":
                // Check if change violates data contracts
                contracts = get_active_contracts(event.entity_id)
                FOR EACH contract IN contracts:
                    IF violates(contract, event.change):
                        create_violation(contract, event)
                        notify(contract.producer_owner, "contract_violation", event)

            CASE "trigger_quality_check":
                // Schedule quality profiling for affected entity
                schedule_quality_scan(event.entity_id, priority=HIGH)

            CASE "auto_deprecate":
                // Mark unused assets for deprecation review
                IF event.entity.last_accessed > 90_DAYS_AGO:
                    apply_tag(event.entity_id, "candidate_for_deprecation")
                    notify(event.entity.owner, "deprecation_review_needed")

    // Step 5: Audit logging
    log_audit_event(event, matching_rules, actions_taken)
```

**Complexity:** O(R × D) where R = matching rules, D = downstream entities for propagation. Burst detection is O(1) with counter increment. Lineage traversal for propagation dominates latency.

---

### Algorithm 7: Data Contract Validation

```
FUNCTION validate_schema_change(entity_id, proposed_changes):
    // Step 1: Fetch all active contracts for this entity
    contracts = get_active_contracts(entity_id)
    IF contracts IS EMPTY:
        RETURN {result: "NO_CONTRACTS", changes_allowed: true}

    breaking = []
    warnings = []
    compatible = []

    FOR EACH change IN proposed_changes:
        FOR EACH contract IN contracts:
            schema_spec = contract.schema_spec

            SWITCH change.action:
                CASE "drop_column":
                    IF change.column IN schema_spec.required_columns:
                        breaking.append({change, contract, severity: "critical",
                            affected: get_subscribers(contract.contract_id)})
                    ELSE IF change.column IN schema_spec.optional_columns:
                        warnings.append({change, contract, severity: "warning"})

                CASE "change_type":
                    IF is_narrowing_cast(change.from_type, change.to_type):
                        breaking.append({change, contract, severity: "critical",
                            reason: "Narrowing type change may cause data loss"})
                    ELSE IF is_widening_cast(change.from_type, change.to_type):
                        warnings.append({change, contract, severity: "info",
                            reason: "Widening type change — consumers should verify"})

                CASE "add_column":
                    compatible.append({change, status: "additive — no contract impact"})

                CASE "rename_column":
                    IF change.old_name IN schema_spec.required_columns:
                        breaking.append({change, contract, severity: "critical",
                            reason: "Required column renamed"})

                CASE "change_nullability":
                    IF change.new_nullable == false AND change.old_nullable == true:
                        warnings.append({change, contract, severity: "warning",
                            reason: "Adding NOT NULL constraint — existing NULLs will fail"})

    // Step 2: Determine overall result
    IF breaking IS NOT EMPTY:
        RETURN {result: "BREAKING_CHANGE_DETECTED", breaking, warnings, compatible}
    ELSE IF warnings IS NOT EMPTY:
        RETURN {result: "COMPATIBLE_WITH_WARNINGS", warnings, compatible}
    ELSE:
        RETURN {result: "FULLY_COMPATIBLE", compatible}
```

**Complexity:** O(C × K × S) where C = proposed changes, K = active contracts, S = schema spec columns. Typically small numbers (< 100 contracts per entity).

---

### Algorithm 8: Semantic Search with Hybrid BM25/Vector Scoring

```
FUNCTION hybrid_search(query_text, filters, user_context):
    // Step 1: Generate query embedding for semantic search
    query_embedding = embed_text(query_text)  // 384-dim vector

    // Step 2: Execute BM25 keyword search
    bm25_results = search_index.query(
        text=query_text,
        filters=filters,
        limit=100
    )

    // Step 3: Execute vector similarity search (kNN)
    vector_results = vector_store.knn_search(
        vector=query_embedding,
        k=50,
        filters=filters  // pre-filter by entity type, domain
    )

    // Step 4: Merge and deduplicate
    merged = {}
    FOR EACH result IN bm25_results:
        merged[result.entity_id] = {
            bm25_score: normalize(result.score),  // 0-1
            vector_score: 0.0,
            entity: result
        }

    FOR EACH result IN vector_results:
        IF result.entity_id IN merged:
            merged[result.entity_id].vector_score = normalize(result.similarity)
        ELSE:
            merged[result.entity_id] = {
                bm25_score: 0.0,
                vector_score: normalize(result.similarity),
                entity: result
            }

    // Step 5: Compute hybrid score
    FOR EACH entity_id, scores IN merged:
        // Reciprocal Rank Fusion or weighted combination
        hybrid_score = (
            BM25_WEIGHT * scores.bm25_score +     // default 0.6
            VECTOR_WEIGHT * scores.vector_score     // default 0.4
        )
        scores.hybrid_score = hybrid_score

    // Step 6: Sort by hybrid score, apply policy filter, return top K
    sorted_results = sort_by(merged.values(), "hybrid_score", DESC)
    visible_results = filter_by_policy(sorted_results, user_context)

    RETURN visible_results[:20]
```

**Complexity:** O(N log N) for BM25 (inverted index), O(M log M) for kNN (approximate nearest neighbor with HNSW graph), O(R log R) for merge sort where R = combined results. Total latency dominated by the slower of BM25 and kNN (~200-300ms each).

**When semantic search helps most:**
- User searches "revenue" → BM25 finds tables named "revenue"; semantic search also finds tables named "sales_amount" and "gross_income" with similar embeddings
- User searches "customer churn analysis" → BM25 requires exact term match; semantic search finds "subscriber_attrition_metrics" which is semantically similar
- User searches in a different language → BM25 fails entirely; multilingual embeddings may find the right table
