# Deep Dive & Bottlenecks

## Deep Dive 1: Query Execution Sandbox

### Why User-Defined Code Needs Isolation

No-code platforms allow users to write JavaScript transformations that run server-side. This is fundamentally different from a traditional web application where only trusted developer code executes on the server. In a no-code platform, **any authenticated builder can submit arbitrary JavaScript** that the platform must execute safely. Without proper isolation, a malicious or careless transformation could:

- **Read filesystem**: Access credentials, environment variables, or other tenants' data
- **Make network calls**: Perform SSRF attacks against internal services or other customers' databases
- **Exhaust resources**: Infinite loops consuming CPU, memory allocation bombs
- **Escape the process**: Exploit V8 vulnerabilities to gain shell access
- **Access other tenants**: Read shared process memory from concurrent executions

### Sandboxing Approaches

| Approach | Isolation Level | Startup Latency | Memory Overhead | Security Boundary |
|----------|----------------|-----------------|-----------------|-------------------|
| **V8 Isolates** (Chosen for JS transforms) | Separate heap per isolate within shared process | <5ms (warm pool) | ~2-5MB per isolate | Memory-isolated; no FS/network access |
| **gVisor (user-space kernel)** | Kernel syscall interception | 50-100ms | ~20MB per sandbox | Syscall filtering; very strong |
| **Firecracker microVM** | Full VM-level isolation | 125ms cold start | ~5MB base | Hardware-enforced isolation |
| **WebAssembly (Wasm)** | Linear memory sandbox | <10ms | ~1-2MB per instance | No syscall access; deterministic |
| **Container per execution** | OS-level namespaces/cgroups | 200-500ms cold | ~50MB per container | Strong; standard tooling |

### V8 Isolate Security Architecture

```
Step-by-step plan in plain English: Sandbox Security Configuration

FUNCTION create_secure_isolate():
    isolate = new V8Isolate()

    // Resource limits
    isolate.set_memory_limit(128 * 1024 * 1024)    // 128 MB hard cap
    isolate.set_cpu_time_limit(5000)                 // 5 second wall-clock timeout
    isolate.set_stack_size(1 * 1024 * 1024)          // 1 MB stack

    // REMOVE dangerous globals
    isolate.remove_global("fetch")           // No network access
    isolate.remove_global("XMLHttpRequest")  // No network access
    isolate.remove_global("WebSocket")       // No persistent connections
    isolate.remove_global("importScripts")   // No dynamic code loading
    isolate.remove_global("require")         // No module system
    isolate.remove_global("process")         // No process info
    isolate.remove_global("__dirname")       // No filesystem paths

    // REMOVE code generation primitives
    isolate.remove_global("Function")        // Cannot construct functions from strings
    // Note: template literals and arrow functions are safe; only
    // the Function() constructor is dangerous as it parses strings as code

    // INJECT safe, frozen utility libraries
    isolate.set_global("_", freeze(lodash_subset))     // Lodash (data manipulation only)
    isolate.set_global("moment", freeze(moment_lib))   // Date handling
    isolate.set_global("JSON", freeze(JSON))           // JSON parse/stringify
    isolate.set_global("console", {                    // Limited console (logged, not output)
        log: sandbox_logger.log,
        error: sandbox_logger.error
    })

    RETURN isolate


FUNCTION execute_sandboxed_transform(code, data, timeout_ms):
    isolate = isolate_pool.acquire()
    TRY:
        isolate.set_global("data", deep_freeze(data))

        // Wrap user code to capture return value
        wrapped_code = f"(function() {{ {code} }})()"

        result = isolate.run_with_timeout(wrapped_code, timeout_ms)

        // Validate result is serializable (no functions, symbols, etc.)
        validate_serializable(result)

        RETURN result

    CATCH V8TimeoutError:
        metrics.increment("sandbox.timeout")
        RAISE SandboxTimeoutError(
            "Transformation timed out after {timeout_ms}ms. "
            "Check for infinite loops or expensive operations."
        )
    CATCH V8MemoryError:
        metrics.increment("sandbox.oom")
        RAISE SandboxMemoryError("Transformation exceeded 128MB memory limit.")
    CATCH V8Error AS e:
        metrics.increment("sandbox.error")
        RAISE SandboxExecutionError(e.message)  // Sanitize stack trace
    FINALLY:
        isolate.reset()
        isolate_pool.release(isolate)
```

### Real-World Lesson: n8n CVE-2025-68613

In 2025, the n8n workflow automation platform disclosed CVE-2025-68613 (CVSS 9.9), a critical remote code execution vulnerability in its expression evaluation engine. Authenticated users could craft expressions that escaped the sandbox and executed arbitrary system commands. The root cause: the expression evaluator used an insufficiently restricted JavaScript execution context, allowing access to constructor chains that reached the `process` global.

**Key takeaway**: Sandbox security is not about blocking known attack patterns---it is about allowlisting a minimal safe surface. Start from zero capabilities and add only what is explicitly needed. The V8 Isolate model is preferred because it starts with an empty global scope that must be explicitly populated.

---

## Deep Dive 2: Data Connector Proxy

### Why Server-Side Proxying Is Non-Negotiable

All data connector calls must be proxied through the platform's server-side Data Connector Service. The browser client **never** connects directly to customer databases or APIs. This is non-negotiable for several reasons:

1. **Credential security**: Database passwords and API tokens are stored encrypted server-side. If the client connected directly, credentials would need to be sent to the browser---exposing them to any user with browser DevTools.

2. **Network access**: Customer databases are typically in private VPCs or behind firewalls. The platform's connector proxy connects from known IP ranges that customers allowlist.

3. **SSRF prevention**: By routing all outbound requests through the proxy, the platform can enforce destination allowlists and block requests to internal infrastructure (169.254.x.x, 10.x.x.x, localhost).

4. **Connection pooling**: Managing database connection pools server-side prevents the thundering herd problem. Without pooling, 1,000 concurrent end-users could open 1,000 connections to a customer's database.

5. **Query auditing**: Every query passes through the proxy, enabling complete audit logging before the query reaches the database.

### Connector Proxy Architecture

```
Step-by-step plan in plain English: Data Connector Proxy

STRUCTURE ConnectorPool:
    connector_id: string
    pool: ConnectionPool
    circuit_breaker: CircuitBreaker
    rate_limiter: RateLimiter
    last_health_check: timestamp
    health_status: "healthy" | "degraded" | "down"

FUNCTION execute_connector_query(connector_id, query, params, timeout_ms):
    // Step 1: Load connector config (encrypted)
    config = credential_store.get_decrypted(connector_id)
    IF config IS NULL:
        RAISE ConnectorNotFoundError(connector_id)

    // Step 2: Check circuit breaker
    cb = get_circuit_breaker(connector_id)
    IF cb.is_open():
        RAISE CircuitOpenError(
            f"Connector {connector_id} is temporarily unavailable. "
            f"Last failure: {cb.last_failure_reason}. "
            f"Retry after: {cb.retry_after}"
        )

    // Step 3: Rate limit check
    IF NOT rate_limiter.allow(connector_id):
        RAISE RateLimitError(f"Too many queries to connector {connector_id}")

    // Step 4: Acquire connection from pool
    pool = get_or_create_pool(connector_id, config)
    connection = pool.acquire(timeout=5000)
    IF connection IS NULL:
        RAISE PoolExhaustedError(f"All connections to {connector_id} are in use")

    // Step 5: Execute with timeout
    TRY:
        start_time = now()
        result = connection.execute_with_timeout(query, params, timeout_ms)
        duration = now() - start_time

        cb.record_success()
        metrics.histogram("connector.query.duration", duration, {
            connector_type: config.type,
            connector_id: connector_id
        })

        RETURN result

    CATCH TimeoutError:
        cb.record_failure("timeout")
        metrics.increment("connector.query.timeout", {connector_id})
        RAISE ConnectorTimeoutError(f"Query timed out after {timeout_ms}ms")

    CATCH ConnectionError AS e:
        cb.record_failure("connection_error")
        pool.invalidate(connection)  // Remove bad connection
        metrics.increment("connector.query.connection_error", {connector_id})
        RAISE ConnectorConnectionError(e.message)

    FINALLY:
        IF connection.is_valid():
            pool.release(connection)


FUNCTION get_or_create_pool(connector_id, config):
    IF connector_id IN pool_registry:
        RETURN pool_registry[connector_id]

    pool_config = {
        min_connections: config.pool_config.min OR 2,
        max_connections: config.pool_config.max OR 20,
        idle_timeout: config.pool_config.idle_timeout OR 300000,  // 5 min
        connection_timeout: 10000,  // 10s to establish connection
        validation_query: "SELECT 1",  // Health check on borrow
    }

    pool = ConnectionPool.create(config.connection_string, pool_config)
    pool_registry[connector_id] = pool
    RETURN pool
```

### Circuit Breaker Configuration

| Connector Type | Failure Threshold | Reset Timeout | Half-Open Max | Timeout |
|---------------|-------------------|---------------|---------------|---------|
| SQL Database | 5 failures in 60s | 30s | 2 test queries | 10s |
| REST API | 10 failures in 60s | 15s | 3 test calls | 30s |
| GraphQL API | 10 failures in 60s | 15s | 3 test calls | 30s |
| MongoDB | 5 failures in 60s | 30s | 2 test queries | 10s |
| Object Storage | 3 failures in 60s | 60s | 1 test call | 30s |

### Slow Connector Isolation

A critical operational concern: if one customer's database is slow (e.g., their PostgreSQL is under heavy load), queries to that connector should not consume all available threads in the query execution engine, blocking queries to healthy connectors.

**Solution**: Per-connector thread pool isolation (bulkhead pattern):
- Each connector gets a dedicated thread pool (max 20 threads by default)
- If a connector's pool is exhausted, new queries to that connector fail fast with `PoolExhaustedError`
- Queries to other connectors are unaffected
- The circuit breaker opens if the connector is consistently slow, preventing further resource consumption

---

## Deep Dive 3: Metadata-Driven Rendering

### How the Client Renders from JSON

The platform client receives the entire app definition as a JSON document and renders it into a functional application. No code is compiled or generated---the runtime is a generic interpreter that traverses the component tree and instantiates UI components based on `type` fields.

```
Step-by-step plan in plain English: Client-Side Rendering Engine

FUNCTION render_app(app_definition, user_context):
    // Build the dependency graph for reactive bindings
    dep_graph = build_dependency_graph(app_definition)

    // Resolve current page from URL route
    current_page = match_route(app_definition.pages, window.location)
    IF current_page IS NULL:
        REDIRECT to first page

    // Initialize state
    state = initialize_state(current_page.state, app_definition.globalState)
    state["currentUser"] = user_context

    // Render component tree recursively
    root_element = render_component_tree(current_page.components, state, dep_graph)

    // Execute onPageLoad queries
    FOR query IN get_page_load_queries(app_definition, current_page):
        execute_query_async(query).then(result => {
            dep_graph.update(query.name, result)
            // Dependency graph triggers re-renders of bound components
        })

    RETURN root_element


FUNCTION render_component_tree(components, state, dep_graph):
    rendered = []
    FOR component IN sort_by_layout(components):
        // Check visibility
        IF NOT evaluate_visibility(component.visibility, state):
            CONTINUE

        // Resolve bindings for this component
        resolved_props = resolve_component_bindings(component, state, dep_graph)

        // Instantiate the component by type
        element = component_registry.create(component.type, {
            props: resolved_props,
            events: bind_event_handlers(component.events, state, dep_graph),
            layout: component.layout,
            children: render_component_tree(component.children, state, dep_graph)
        })

        rendered.append(element)

    RETURN rendered


FUNCTION evaluate_visibility(visibility_rule, state):
    IF visibility_rule.rule == "always":
        RETURN true
    IF visibility_rule.rule == "never":
        RETURN false
    IF visibility_rule.rule == "expression":
        RETURN expression_evaluator.evaluate(visibility_rule.expression, state)


FUNCTION bind_event_handlers(events, state, dep_graph):
    handlers = {}
    FOR event_name, handler_def IN events:
        handlers[event_name] = create_handler(handler_def, state, dep_graph)
    RETURN handlers

FUNCTION create_handler(handler_def, state, dep_graph):
    SWITCH handler_def.action:
        CASE "trigger_query":
            RETURN () => execute_query_and_update(handler_def.config.queryName, state, dep_graph)
        CASE "set_state":
            RETURN (value) => {
                state.set(handler_def.config.key, resolve_value(handler_def.config.value, state))
                dep_graph.notify_change(f"state.{handler_def.config.key}")
            }
        CASE "navigate":
            RETURN () => router.navigate(handler_def.config.route)
        CASE "open_modal":
            RETURN () => modal_manager.open(handler_def.config.modalId)
```

### Component Binding Resolution: The Formula Engine

The binding system (`{{query1.data.length}}`, `{{state.selectedRow.name.toUpperCase()}}`) is conceptually a spreadsheet formula engine. Each binding expression creates a dependency edge in the graph. When any source value changes, all downstream bindings are re-evaluated in topological order.

**Why topological sort matters**: Consider this dependency chain:
- `query1.data` feeds `table.data`
- `table.selectedRow` feeds `detailPanel.data`
- `detailPanel.data.id` feeds `query2.params.id`
- `query2.data` feeds `chart.data`

If `query1` completes, the system must re-evaluate in order: `table.data` -> `table.selectedRow` -> `detailPanel.data` -> `query2.params.id` -> trigger `query2` -> `chart.data`. Evaluating out of order (e.g., re-rendering the chart before query2 finishes) produces stale or inconsistent UI.

**Cycle detection**: The dependency graph must be a DAG. If a user creates a circular dependency (e.g., `query1` depends on `query2.data` and `query2` depends on `query1.data`), the platform must detect this at save time and surface an error in the builder, not at runtime.

---

## Deep Dive 4: Permission Engine

### Multi-Layer Permission Model

Permissions operate at four layers, evaluated in order of precedence:

```
Step-by-step plan in plain English: Permission Evaluation

ENUM AppRole:
    OWNER = 5      // Full control, can delete app, manage permissions
    ADMIN = 4      // Edit app, manage user-level permissions
    EDITOR = 3     // Edit app definition (builder access)
    VIEWER = 2     // View deployed app (read-only, all components visible)
    USER = 1       // Use deployed app (component visibility governed by rules)

FUNCTION check_permission(user, app_id, action):
    // Layer 1: Org-level check
    org_role = get_org_role(user, app.org_id)
    IF org_role == "org_admin":
        RETURN ALLOWED(role=OWNER)  // Org admins have full access to all apps

    // Layer 2: App-level RBAC
    app_role = get_app_role(user, app_id)
    IF app_role IS NULL:
        RETURN DENIED("No access to this app")

    IF action == "edit_definition" AND app_role < EDITOR:
        RETURN DENIED("Insufficient role for editing")
    IF action == "manage_permissions" AND app_role < ADMIN:
        RETURN DENIED("Insufficient role for permission management")

    // Layer 3: Component-level visibility (for deployed app users)
    IF action == "view_component":
        component_rules = get_component_visibility(app_id, user)
        // Rules are evaluated client-side for rendering, server-side for data filtering

    // Layer 4: Row-level security (for query execution)
    IF action == "execute_query":
        row_filters = get_row_filters(app_id, user)
        RETURN ALLOWED(role=app_role, row_filters=row_filters)

    RETURN ALLOWED(role=app_role)


FUNCTION get_component_visibility(app_id, user):
    // Returns a map of component_id -> visible (boolean)
    // Based on user's groups, role, and custom attributes
    permission = get_permission_entry(user, app_id)

    overrides = permission.component_overrides
    // Example overrides:
    // {
    //   "comp-btn-delete": { "visible": "{{currentUser.groups.includes('admins')}}" },
    //   "comp-salary-column": { "visible": "{{currentUser.role === 'hr'}}" }
    // }

    resolved = {}
    FOR comp_id, rule IN overrides:
        resolved[comp_id] = expression_evaluator.evaluate(rule.visible, {currentUser: user})

    RETURN resolved
```

### Row-Level Security Implementation

Row-level security (RLS) works by dynamically injecting WHERE clauses into SQL queries based on the current user's attributes. This happens transparently---the app builder writes a normal query, and the permission engine wraps it.

**Example**: An app builder writes `SELECT * FROM support_tickets`. For a user with the filter `org_id = '{{currentUser.orgId}}'`, the executed query becomes:

```
SELECT * FROM (SELECT * FROM support_tickets) AS __filtered
WHERE org_id = 'org-456'
```

The subquery wrapping ensures the user cannot bypass the filter with UNION, CTEs, or other SQL constructs.

---

## Deep Dive 5: Collaborative App Building

### Conflict Resolution for Visual Builders

When two builders edit the same app simultaneously, the system must handle conflicts without data loss. Unlike collaborative text editors (which need character-level CRDT/OT), visual builders operate on coarser-grained objects---components, queries, and page layouts.

```
Step-by-step plan in plain English: Collaborative Editing Protocol

STRUCTURE EditOperation:
    user_id: string
    timestamp: int
    path: string           // e.g., "pages.0.components.3.props.text"
    operation: "set" | "add" | "remove" | "move"
    value: any
    base_version: int      // Version this edit was based on

FUNCTION handle_concurrent_edits(operations):
    // Group by component-level path
    component_groups = group_by_component(operations)

    FOR component_id, ops IN component_groups:
        IF all_ops_on_different_properties(ops):
            // Non-conflicting: different properties of same component
            // Apply all operations (merge)
            apply_all(ops)
        ELSE:
            // Conflicting: same property edited by multiple users
            // Last-write-wins (by server timestamp)
            sorted = sort_by_timestamp(ops)
            apply(sorted.last)

            // Notify losing editors
            FOR op IN sorted[:-1]:
                notify_conflict(op.user_id, component_id,
                    "Your change to {path} was overwritten by {winner.user_id}")


FUNCTION on_builder_selection_change(user_id, app_id, selected_component_id):
    // Broadcast presence to other builders
    collaboration_hub.broadcast(app_id, {
        type: "selection_change",
        user_id: user_id,
        component_id: selected_component_id,
        color: get_user_color(user_id)  // Consistent cursor color per user
    })

    // Soft-lock: warn (but don't block) other users
    // "Alice is currently editing this component"
```

**Why this is simpler than document editors**: In a visual builder, the atomic unit of editing is a component property (e.g., changing a button's text, moving a table, modifying a query). These are discrete, independent operations rather than interleaved character insertions in a shared text buffer. Last-write-wins at the component-property level is acceptable because simultaneous edits to the exact same property of the exact same component are rare---presence indicators provide social conflict avoidance.

---

## Deep Dive 6: AI Copilot Architecture

### How AI-Assisted App Generation Works

The AI Copilot transforms natural language descriptions into valid app definitions. This is not simple text generation---the output must conform to a strict JSON schema, reference real tables and columns from the connected database, use valid binding syntax, and produce a functional reactive dependency graph.

```
Step-by-step plan in plain English: AI Copilot Generation Pipeline

FUNCTION generate_app_from_prompt(builder_id, prompt, connector_id):
    // Step 1: Gather context
    schema = get_cached_schema(connector_id)
    component_catalog = get_component_catalog()  // All available component types with props
    binding_reference = get_binding_syntax_docs()

    // Step 2: Construct enriched LLM prompt
    system_prompt = build_system_prompt(component_catalog, binding_reference)
    user_prompt = f"""
        Database schema: {summarize_schema(schema)}
        User request: {prompt}
        Generate a complete app definition JSON conforming to the schema.
    """

    // Step 3: Call LLM with streaming response
    response = llm_client.generate(
        system_prompt = system_prompt,
        user_prompt = user_prompt,
        max_tokens = 8000,
        temperature = 0.2,    // Low temperature for structured output
        response_format = "json"
    )

    // Step 4: Validate generated output
    app_def = parse_json(response)
    validation_errors = validate_app_definition(app_def, schema)

    IF validation_errors:
        // Attempt self-repair: send errors back to LLM for correction
        repair_prompt = f"Fix these errors in the generated app: {validation_errors}"
        repaired = llm_client.generate(system_prompt, repair_prompt, context=response)
        app_def = parse_json(repaired)
        validation_errors = validate_app_definition(app_def, schema)

        IF validation_errors:
            RETURN {status: "partial", app_def: app_def, errors: validation_errors}

    // Step 5: Security validation (same pipeline as human-created apps)
    security_check = validate_expressions(app_def)
    sql_check = validate_sql_queries(app_def, schema)

    IF security_check.has_violations OR sql_check.has_violations:
        RAISE SecurityViolationError("AI-generated content failed security validation")

    RETURN {status: "success", app_def: app_def}


FUNCTION summarize_schema(schema):
    // Summarize schema to fit within LLM context window
    // Include: table names, column names with types, primary keys, foreign keys
    // Exclude: indexes, constraints, sequences, comments
    summary = []
    FOR table_name, table_def IN schema:
        cols = [f"{c.name} ({c.type})" FOR c IN table_def.columns[:20]]  // Cap at 20 columns
        summary.append(f"Table {table_name}: {', '.join(cols)}")
        IF table_def.foreign_keys:
            fks = [f"{fk.column} -> {fk.ref_table}.{fk.ref_column}" FOR fk IN table_def.foreign_keys]
            summary.append(f"  Relationships: {', '.join(fks)}")

    // If schema is still too large, prioritize tables mentioned in the prompt
    IF total_tokens(summary) > 4000:
        summary = prioritize_by_relevance(summary, prompt)

    RETURN '\n'.join(summary)
```

### AI Query Suggestion

Beyond full app generation, the AI Copilot suggests individual SQL queries based on natural language:

| User Says | AI Generates |
|-----------|-------------|
| "Show me all orders from last week" | `SELECT * FROM orders WHERE created_at > NOW() - INTERVAL '7 days' ORDER BY created_at DESC` |
| "Count customers by country" | `SELECT country, COUNT(*) as customer_count FROM customers GROUP BY country ORDER BY customer_count DESC` |
| "Find orders over $1000 that haven't shipped" | `SELECT * FROM orders WHERE total > 1000 AND status != 'shipped'` |

**Important**: AI-generated SQL is treated identically to human-written SQL---it passes through the parameterization pipeline, SQL validator, and row-level security filter injection. The AI does not receive special trust.

---

## Deep Dive 7: Workflow Execution Engine

### Stateful Multi-Step Execution

Unlike interactive queries (stateless, sub-second), workflows are stateful, multi-step processes that may take minutes to complete. Each step's result is persisted before the next step begins, enabling crash recovery.

```
Step-by-step plan in plain English: Workflow Execution Engine

STRUCTURE WorkflowExecution:
    id: string
    workflow_id: string
    trigger_data: any
    steps_completed: list[StepResult]
    current_step: string
    status: "running" | "completed" | "failed" | "timed_out"
    started_at: timestamp
    timeout_at: timestamp

FUNCTION execute_workflow(workflow_def, trigger_data):
    execution = create_execution_record(workflow_def.id, trigger_data)
    execution.timeout_at = now() + workflow_def.max_duration_ms

    current_step_id = workflow_def.steps[0].id
    step_context = {"trigger": {"data": trigger_data}, "steps": {}}

    WHILE current_step_id IS NOT NULL:
        // Check timeout
        IF now() > execution.timeout_at:
            execution.status = "timed_out"
            persist_execution(execution)
            alert("workflow_timeout", {workflow_id: workflow_def.id, execution_id: execution.id})
            RETURN execution

        step_def = get_step(workflow_def, current_step_id)
        execution.current_step = current_step_id

        TRY:
            result = execute_step(step_def, step_context)
            step_context["steps"][current_step_id] = {"data": result, "status": "success"}
            execution.steps_completed.append({step_id: current_step_id, result: result, status: "success"})
            persist_execution(execution)  // Checkpoint after each step

            // Determine next step
            current_step_id = resolve_next_step(workflow_def, step_def, result, step_context)

        CATCH error:
            IF step_def.retry AND retry_count < step_def.retry.max_attempts:
                delay = step_def.retry.base_delay_ms * (2 ** retry_count)  // Exponential backoff
                sleep(delay)
                retry_count++
                CONTINUE
            ELSE IF step_def.on_error == "continue":
                step_context["steps"][current_step_id] = {"error": error.message, "status": "failed"}
                current_step_id = resolve_next_step(workflow_def, step_def, null, step_context)
            ELSE IF step_def.on_error STARTS_WITH "goto:":
                current_step_id = step_def.on_error.split(":")[1]
            ELSE:
                execution.status = "failed"
                persist_execution(execution)
                // Execute error handler if defined
                IF workflow_def.error_handler:
                    execute_step(workflow_def.error_handler, {**step_context, "error": error})
                RETURN execution

    execution.status = "completed"
    persist_execution(execution)
    RETURN execution
```

### Workflow Crash Recovery

If the workflow engine process crashes mid-execution, the workflow must resume from the last completed step:

1. On startup, the engine scans for executions with `status = "running"` and `started_at` within the timeout window
2. For each recovered execution, it reads `steps_completed` to determine the last checkpoint
3. It resumes from the step after the last completed step
4. Steps already completed are not re-executed (idempotency at the step level)

This is conceptually similar to a write-ahead log: each step completion is a durable checkpoint, and recovery replays from the last checkpoint.

---

## Slowest part of the process Analysis

### Slowest part of the process 1: Query Execution Engine Under Load

**Problem**: During peak hours, 2,300 QPS of query execution requests hit the engine. Each query involves binding resolution, parameterization, sandbox execution (if transforms exist), and connector proxy calls.

**Mitigation**:
- Horizontal scaling of stateless query execution nodes (auto-scale based on CPU utilization)
- V8 Isolate pool with warm instances to avoid cold-start overhead
- Per-connector bulkhead isolation prevents one slow connector from blocking others
- Query result caching for idempotent queries (optional, configurable per query)
- Client-side debouncing of rapid state changes (prevent query flood from slider drag, etc.)

### Slowest part of the process 2: App Definition Cache Invalidation

**Problem**: Published app definitions are aggressively cached (5-minute TTL). When a builder publishes a new version, end-users may see the stale version for up to 5 minutes.

**Mitigation**:
- Event-driven cache invalidation: publish event -> message bus -> all runtime nodes evict cached definition
- Cache versioning: cache key includes version number; publish atomically updates the version pointer
- Client-side version check: runtime periodically polls for version changes (lightweight HEAD request)
- Graceful rollout: new version is "warmed" into cache before becoming the active published version

### Slowest part of the process 3: Connector Credential Decryption

**Problem**: Every query execution requires decrypting the connector's credentials. At 2,300 QPS, this means 2,300 decryption operations per second.

**Mitigation**:
- Short-lived in-memory credential cache (TTL: 60 seconds, encrypted at rest in memory)
- Decrypted credentials cached per connector, not per query
- Hardware security module (HSM) offload for high-throughput decryption
- Connection pooling: credentials are decrypted once when the pool is created, not per query

### Slowest part of the process 4: AI Copilot LLM Latency

**Problem**: LLM inference for app generation takes 2-10 seconds per request. Builders expect near-instant feedback. Multiple builders generating simultaneously can overwhelm the LLM provider's rate limits.

**Mitigation**:
- Streaming responses: send partial JSON output to the builder as it's generated, showing progressive construction
- Response caching: identical prompts (same schema + similar natural language) return cached results (hash-based cache key)
- Tiered models: use a smaller, faster model for autocomplete suggestions (<500ms); use a larger model for full app generation
- Request queuing: excess requests are queued with estimated wait time shown to the builder
- Fallback: if the LLM provider is unavailable, AI features degrade gracefully; manual building continues unaffected

### Slowest part of the process 5: Large App Definition Rendering

**Problem**: Complex apps with 200+ components, 50+ queries, and deep nesting create JSON definitions of 1-5 MB. Client-side rendering (parsing JSON, building dependency graph, instantiating components) can take >500ms, violating the <50ms component render target.

**Mitigation**:
- Lazy page loading: only the current page's components are rendered; other pages are loaded on navigation
- Virtual rendering: off-screen components in scrollable containers are not instantiated until visible
- Dependency graph partitioning: per-page dependency subgraphs instead of one global graph
- Definition compression: gzip app definition in transit (typically 5:1 compression ratio for JSON)
- Pre-computed dependency graph: server computes the dependency graph at publish time and includes it in the definition, avoiding client-side graph construction
