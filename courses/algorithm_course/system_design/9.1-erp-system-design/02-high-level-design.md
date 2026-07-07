# High-Level Design

## Overall Architecture

An ERP system integrates finance, HR, supply chain, manufacturing, CRM, and project management into a unified platform. The architecture must balance tight data integration (a defining ERP trait) with modularity for independent evolution.

### Modular Monolith vs Microservices

Most production ERPs use a **modular monolith** rather than pure microservices:

| Factor | Modular Monolith | Microservices |
|--------|-------------------|---------------|
| Cross-module transactions | Native ACID within a single DB | Saga/2PC overhead |
| Data consistency | Strong consistency by default | Eventual consistency |
| Deployment complexity | Single deployable unit | Dozens of services |
| Customization surface | One extension framework | Hooks in every service |

The recommended approach: **modular monolith with clear bounded contexts**, where each module exposes an internal API contract and communicates through an in-process event bus.

```mermaid
flowchart TB
    subgraph ClientLayer["Client Layer"]
        WEB["Web App (SPA)"]
        MOB["Mobile App"]
        EXT["External Integrations"]
    end
    subgraph GatewayLayer["API Gateway Layer"]
        GW["API Gateway"]
        TR["Tenant Resolver"]
    end
    subgraph AppLayer["Application Layer — Modular Monolith"]
        direction LR
        subgraph Core["Core Modules"]
            FIN["Finance"]
            HR["HR"]
            SCM["SCM"]
            CRM["CRM"]
            MFG["Manufacturing"]
        end
        subgraph Platform["Platform Services"]
            CUST["Customization Engine"]
            AUTH["Identity & Access"]
            EVTBUS["Event Bus"]
            JOBQ["Job Scheduler"]
        end
    end
    subgraph DataLayer["Data Layer"]
        PRIM[("Primary DB")]
        READ[("Read Replica")]
        CACHE[("Cache")]
        OBJST[("Object Storage")]
        MQ["Message Queue"]
    end
    WEB --> GW
    MOB --> GW
    EXT --> GW
    GW --> TR --> AppLayer
    FIN <--> EVTBUS
    HR <--> EVTBUS
    SCM <--> EVTBUS
    CRM <--> EVTBUS
    MFG <--> EVTBUS
    Core --> CUST
    Core --> AUTH
    AppLayer --> PRIM
    AppLayer --> READ
    AppLayer --> CACHE
    AppLayer --> OBJST
    JOBQ --> MQ

    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef api fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef cache fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef queue fill:#e0f7fa,stroke:#00695c,stroke-width:2px

    class WEB,MOB,EXT client
    class GW,TR api
    class FIN,HR,SCM,CRM,MFG,CUST,AUTH,EVTBUS,JOBQ service
    class PRIM,READ,OBJST data
    class CACHE cache
    class MQ queue
```

### Module Decomposition as Bounded Contexts

| Module | Key Aggregates | Publishes Events |
|--------|----------------|-------------------|
| Finance | JournalEntry, Invoice, Payment | `InvoicePosted`, `PaymentApplied` |
| HR | Employee, PayrollRun, LeaveRequest | `EmployeeOnboarded`, `PayrollProcessed` |
| SCM | PurchaseOrder, InventoryItem, GoodsReceipt | `POApproved`, `GoodsReceived` |
| CRM | Lead, Opportunity, Contact | `OpportunityWon`, `LeadConverted` |
| Manufacturing | BillOfMaterials, WorkOrder | `WorkOrderCompleted`, `MaterialConsumed` |
| Projects | Project, Task, Timesheet | `MilestoneReached`, `TimesheetApproved` |

---

## Multi-Tenancy Architecture

ERP platforms serve organizations ranging from 5-person startups to 100,000-employee enterprises. Three isolation patterns exist, and a hybrid approach is recommended.

**Pattern 1 — Shared Database, Shared Schema:** All tenants share the same tables with a `tenant_id` discriminator. Cheapest but risk of data leakage if query filters are missed.

**Pattern 2 — Shared Database, Separate Schema:** Each tenant gets a database schema (namespace). Stronger isolation via database-level access controls. Upper limit ~5,000 schemas per instance.

**Pattern 3 — Database-per-Tenant:** Dedicated database per tenant. Maximum isolation and custom SLAs but highest cost.

### Hybrid Strategy (Production Recommendation)

```Step-by-step plan in plain English
FUNCTION resolve_tenant_database(tenant):
    tier = tenant.subscription_tier
    IF tier == "enterprise":
        RETURN dedicated_connection_pool(tenant.dedicated_db_host)
    ELSE IF tier == "professional":
        pool = shared_regional_pool(tenant.region)
        pool.set_schema(tenant.schema_name)
        RETURN pool
    ELSE:
        pool = shared_pool(tenant.region)
        pool.set_tenant_context(tenant.id)
        RETURN pool
```

### Tenant Resolution Flow

```Step-by-step plan in plain English
FUNCTION resolve_tenant(request):
    // Priority: subdomain > header > JWT claim
    tenant_key = extract_subdomain(request.hostname)
        OR request.headers["X-Tenant-ID"]
        OR request.auth_token.claims["tenant_id"]

    IF tenant_key IS NULL:
        RAISE TenantResolutionError("No tenant identifier found")

    tenant = cache.get("tenant:" + tenant_key)
    IF tenant IS NULL:
        tenant = db.query("SELECT * FROM tenants WHERE slug = ?", tenant_key)
        IF tenant IS NULL OR tenant.status != "active":
            RAISE TenantNotFoundError(tenant_key)
        cache.set("tenant:" + tenant_key, tenant, ttl=300)

    RequestContext.set_tenant(tenant)
    RETURN tenant
```

---

## Customization Engine Architecture

### Metadata-Driven Custom Fields

Rather than executing DDL for each tenant's custom fields, the system stores field definitions as metadata:

| Strategy | Flexibility | Query Performance | Recommendation |
|----------|------------|-------------------|----------------|
| EAV (Entity-Attribute-Value) | Excellent | Poor (pivoting/joins) | Only for indexed fields |
| JSON/JSONB Columns | Good | Good with GIN indexes | Primary approach |
| Virtual Columns (wide table) | Limited | Excellent | Avoid — too rigid |

```mermaid
flowchart TB
    subgraph Meta["Metadata Registry"]
        FD["Field Definitions"]
        FM["Form Metadata"]
    end
    subgraph Runtime["Runtime Engine"]
        VE["Validation Engine"]
        FG["Form Generator"]
        QE["Query Enricher"]
    end
    subgraph Store["Storage Layer"]
        STD["Standard Columns"]
        JSONB["JSONB Column<br/>custom_fields"]
        IDX["GIN Index"]
    end
    FD --> VE
    FD --> FG
    FD --> QE
    FM --> FG
    VE --> JSONB
    QE --> JSONB
    JSONB --> IDX

    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef cache fill:#fffde7,stroke:#f57f17,stroke-width:2px

    class FD,FM cache
    class VE,FG,QE service
    class STD,JSONB,IDX data
```

### Custom Workflow Engine

ERP workflows are modeled as configurable state machines:

```Step-by-step plan in plain English
STRUCTURE WorkflowDefinition:
    entity_type: STRING          // "purchase_order", "leave_request"
    states: LIST[StateNode]      // each with on_enter/on_exit actions
    transitions: LIST[Transition]  // from_state, to_state, trigger, guards, actions

FUNCTION execute_transition(entity, trigger, user):
    workflow = load_workflow(entity.type, entity.tenant_id)
    transition = workflow.find_transition(entity.workflow_state, trigger)
    IF transition IS NULL:
        RAISE InvalidTransitionError(entity.workflow_state, trigger)

    context = build_expression_context(entity, user)
    FOR EACH condition IN transition.guard_conditions:
        IF NOT evaluate_expression(condition, context):
            RAISE GuardConditionFailed(condition)

    execute_actions(workflow.get_state(entity.workflow_state).on_exit_actions)
    execute_actions(transition.actions)
    entity.workflow_state = transition.to_state
    execute_actions(workflow.get_state(transition.to_state).on_enter_actions)
    persist(entity)
    emit_event("WorkflowTransitioned", entity, transition)
```

### Dynamic Form Rendering

Forms are rendered from metadata, not hardcoded:

```Step-by-step plan in plain English
FUNCTION generate_form_schema(entity_type, tenant_id, user_role):
    standard_fields = schema_registry.get_fields(entity_type)
    custom_fields = field_definitions.query(tenant_id, entity_type, status="active")
    layout = form_layouts.get(tenant_id, entity_type) OR form_layouts.get_default(entity_type)

    ui_schema = { sections: [], validation_rules: [] }
    FOR EACH section IN layout.sections:
        section_schema = { title: section.title, fields: [] }
        FOR EACH field_ref IN section.field_refs:
            field = standard_fields.get(field_ref) OR custom_fields.get(field_ref)
            IF field IS NULL OR NOT field.visible_to_roles.includes(user_role):
                CONTINUE
            section_schema.fields.append(build_field_schema(field))
        ui_schema.sections.append(section_schema)
    RETURN ui_schema
```

---

## Extension Framework

### Plugin Architecture with Sandboxed Execution

```mermaid
flowchart TB
    subgraph Hooks["Hook System"]
        PRE["Pre-Hooks<br/>Can modify or abort"]
        POST["Post-Hooks<br/>React only"]
        UI["UI Hooks<br/>Inject tabs/buttons"]
    end
    subgraph Exec["Sandboxed Execution"]
        SAND["Sandbox Runtime<br/>CPU/Memory limits"]
        APIC["Scoped API Client"]
    end
    subgraph Store["Plugin Storage"]
        PDB["Namespaced Tables"]
        PCONF["Tenant Config"]
    end
    PRE --> SAND
    POST --> SAND
    UI --> SAND
    SAND --> APIC
    SAND --> PDB

    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef cache fill:#fffde7,stroke:#f57f17,stroke-width:2px

    class PRE,POST,UI,SAND,APIC service
    class PDB data
    class PCONF cache
```

```Step-by-step plan in plain English
FUNCTION execute_plugin_hook(plugin, hook_name, payload):
    IF hook_name NOT IN plugin.manifest.declared_hooks:
        RAISE PermissionDenied(plugin.id, hook_name)

    sandbox = create_sandbox(cpu_limit_ms=500, memory_limit_mb=64, timeout_ms=2000)
    sandbox.inject("platform", create_scoped_api_client(
        tenant_id=RequestContext.tenant_id, scopes=plugin.manifest.api_scopes))

    TRY:
        RETURN sandbox.execute(plugin.entry_point, hook_name, payload)
    CATCH TimeoutError:
        IF hook_name.starts_with("pre_"):
            RAISE PluginTimeoutError("Pre-hook timed out")
    CATCH SandboxViolation AS e:
        disable_plugin(plugin.id, reason=e.message)
```

---

## Data Flow: Procure-to-Pay

```mermaid
sequenceDiagram
    participant User as Procurement User
    participant SCM as SCM Module
    participant WF as Workflow Engine
    participant INV as Inventory Module
    participant FIN as Finance Module
    participant BUS as Event Bus

    User->>SCM: Create Purchase Order
    SCM->>WF: Submit for approval
    WF-->>SCM: Approved
    SCM->>BUS: Emit POApproved
    BUS-->>FIN: Create AP commitment

    User->>INV: Record Goods Receipt
    INV->>BUS: Emit GoodsReceived
    BUS-->>FIN: DR Inventory, CR GR/IR Clearing
    BUS-->>SCM: Update PO received qty

    User->>FIN: Enter Vendor Invoice
    FIN->>FIN: 3-way match (PO, GR, Invoice)
    FIN->>FIN: DR GR/IR Clearing, CR AP

    FIN->>FIN: Payment run
    FIN->>FIN: DR AP, CR Bank
    FIN->>BUS: Emit PaymentExecuted
    BUS-->>SCM: Mark PO fully paid
```

### Cross-Module Event Bus

```Step-by-step plan in plain English
STRUCTURE DomainEvent:
    event_id: UUID
    event_type: STRING
    source_module: STRING
    tenant_id: UUID
    payload: MAP
    correlation_id: UUID    // traces the business process

FUNCTION publish_event(event):
    outbox.insert(event)    // same transaction as business data
    // Outbox processor delivers asynchronously to subscribers

FUNCTION handle_event(event):
    FOR EACH handler IN event_registry.get_handlers(event.event_type):
        TRY:
            handler.process(event)
        CATCH error:
            IF retry_count < MAX_RETRIES:
                schedule_retry(event, handler, exponential_backoff)
            ELSE:
                move_to_dead_letter(event, handler, error)
```

---

## Key Architectural Decisions

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| Architecture style | Microservices, Modular monolith | Modular monolith | Cross-module ACID transactions; extract later if needed |
| Multi-tenancy | Shared-all, Schema, DB-per-tenant | Hybrid (tier-based) | Cost balance with enterprise isolation |
| Custom field storage | EAV, JSONB, DDL per tenant | JSONB + selective EAV | JSONB for most fields; EAV for indexed fields |
| Workflow engine | BPMN, Custom DSL | Custom DSL state machine | BPMN too complex; DSL enables tenant self-service |
| Event delivery | Sync calls, In-process bus, Broker | In-process + transactional outbox | Latency + reliability |
| Extension runtime | Shared process, Container, Sandbox | Scripting sandbox | Isolation without container overhead |
| API style | REST, GraphQL, gRPC | REST + optional GraphQL | REST for caching; GraphQL for complex UI needs |
| Tenant resolution | Subdomain, Header, JWT, Path | Subdomain + JWT | Subdomain for web; JWT for API |

---

## Reporting and Analytics Architecture

Financial reporting is a first-class architectural concern, not an afterthought. The CQRS split separates transactional processing from reporting workloads.

```mermaid
flowchart TB
    subgraph Write["Write Path (OLTP)"]
        TXN[Transaction Services]
        PRIM[(Primary DB)]
    end
    subgraph Sync["Sync Layer"]
        CDC[Change Data Capture]
        AGG[Incremental Aggregator]
    end
    subgraph Read["Read Path (OLAP)"]
        RR[(Read Replicas)]
        CUBE[(Pre-Computed Cubes)]
        RPT[Report Engine]
    end
    subgraph Output["Output"]
        DASH[Dashboards]
        SCHED[Scheduled Reports]
        ADHOC[Ad-Hoc Queries]
    end

    TXN --> PRIM
    PRIM --> CDC --> RR
    CDC --> AGG --> CUBE
    RR --> RPT
    CUBE --> RPT
    RPT --> DASH & SCHED & ADHOC

    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
    classDef cache fill:#fffde7,stroke:#f57f17,stroke-width:2px
    classDef queue fill:#e0f7fa,stroke:#00695c,stroke-width:2px
    classDef client fill:#e1f5fe,stroke:#01579b,stroke-width:2px

    class TXN,RPT,AGG service
    class PRIM,RR,CUBE data
    class CDC queue
    class DASH,SCHED,ADHOC client
```

| Report Category | Source | Freshness | Routing |
|----------------|--------|-----------|---------|
| Operational (invoice list, PO status) | Read replica | < 5 seconds | Direct replica query |
| Financial (trial balance, P&L) | Pre-computed cubes | < 15 minutes | Cube lookup + delta query |
| Analytical (trend, forecasting) | OLAP store | < 1 hour | Dedicated analytical engine |
| Compliance (audit, SoD) | Audit log store | Real-time | Dedicated audit replica |

---

## Integration Hub Architecture

Enterprise ERPs must integrate with dozens of external systems per tenant — banks, tax authorities, shipping carriers, HR benefits providers, and EDI trading partners.

```Step-by-step plan in plain English
STRUCTURE IntegrationChannel:
    channel_id: UUID
    tenant_id: UUID
    channel_type: ENUM  // "rest_api", "edi_x12", "edi_edifact", "sftp", "webhook"
    direction: ENUM     // "inbound", "outbound", "bidirectional"
    config: MAP         // endpoint, credentials_ref, mappings, retry_policy
    status: ENUM        // "active", "paused", "error"

FUNCTION process_outbound_integration(event, channel):
    // Transform ERP domain event to external format
    payload = apply_transformation(event, channel.config.mapping)

    SWITCH channel.channel_type:
        CASE "rest_api":
            response = http_post(channel.config.endpoint, payload,
                                  headers=channel.config.auth_headers)
        CASE "edi_x12":
            edi_doc = transform_to_x12(payload, channel.config.transaction_set)
            response = sftp_upload(channel.config.sftp_host, edi_doc)
        CASE "webhook":
            signature = hmac_sha256(channel.config.secret, payload)
            response = http_post(channel.config.url, payload,
                                  headers={"X-Signature": signature})

    log_integration_event(channel, event, response)
    IF response.is_error:
        schedule_retry(channel, event, backoff=exponential)
```

### Integration Patterns by External System

| External System | Protocol | Direction | Frequency | Error Handling |
|----------------|----------|-----------|-----------|---------------|
| Banking (payments) | BAI2/MT940/ISO 20022 | Bidirectional | Daily batch | Reconciliation queue |
| Tax authority | REST API | Outbound | Per-transaction or batch | Retry + manual queue |
| EDI trading partners | X12/EDIFACT via AS2/SFTP | Bidirectional | Hourly/daily | Acknowledgment tracking |
| Shipping carriers | REST API | Outbound | Per-shipment | Fallback to manual booking |
| HR benefits providers | SFTP/REST | Outbound | Monthly/event-driven | Delta file reconciliation |
| iPaaS connectors | REST/GraphQL | Bidirectional | Real-time | Circuit breaker + DLQ |

---

## Master Data Management Architecture

Master data (chart of accounts, organizational hierarchy, business partners, products) is shared across modules. The MDM service acts as the single source of truth, publishing change events to dependent modules.

```Step-by-step plan in plain English
FUNCTION update_master_data(entity_type, entity_id, changes, user):
    // Validate against master data rules
    rules = load_validation_rules(entity_type, RequestContext.tenant_id)
    FOR EACH rule IN rules:
        IF NOT evaluate_rule(rule, changes):
            RAISE ValidationError(rule.message)

    // Apply change with optimistic locking
    entity = load_with_version(entity_type, entity_id)
    apply_changes(entity, changes)
    persist_with_version_check(entity)

    // Publish change event for cross-module propagation
    publish_event("MasterDataChanged", {
        entity_type: entity_type,
        entity_id: entity_id,
        changed_fields: changes.keys(),
        tenant_id: RequestContext.tenant_id
    })

    // Invalidate caches across all layers
    invalidate_master_data_cache(entity_type, entity_id, RequestContext.tenant_id)

    RETURN entity
```

| Master Data Type | Consumers | Change Propagation | Cache Strategy |
|-----------------|-----------|-------------------|---------------|
| Chart of Accounts | Finance, Reporting, Budgeting | Sync within Finance, async to reporting | L1 (60s) + L2 (30 min) |
| Org Hierarchy | All modules (access control) | Async event, cache invalidation | L2 (5 min), event-driven bust |
| Business Partners | AP, AR, CRM, Procurement | Event-driven, async | L2 (10 min), update on access |
| Product Catalog | Inventory, Manufacturing, Sales | Sync to Inventory, async to others | L2 (15 min) |
| Exchange Rates | Finance, Procurement, Reporting | Broadcast invalidation | L1 (60s), daily reload |
| Tax Tables | Finance, Payroll, Sales | Version-controlled, manual publish | L2 (24h), reload on version bump |
