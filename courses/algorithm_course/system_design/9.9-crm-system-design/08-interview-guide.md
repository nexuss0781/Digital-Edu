# Interview Guide

## How to Use This Guide

This guide structures a 45-minute system design interview for a CRM platform (Salesforce/Zoho-style). It covers pacing, key discussion areas, trap questions that separate senior from staff-level candidates, and a scoring rubric. The interviewer should adapt based on the candidate's level: senior engineers should demonstrate solid multi-tenant fundamentals and data model design; staff engineers should additionally reason about metadata-driven architectures, governor limit design, and platform extensibility trade-offs.

---

## 45-Minute Interview Pacing

| Time | Phase | Focus | Candidate Should Demonstrate |
|------|-------|-------|------------------------------|
| 0-5 min | **Requirements Clarification** | Scope, scale, key features | Asks about tenant scale, custom object requirements, API needs; distinguishes CRM from generic CRUD |
| 5-15 min | **High-Level Design** | Architecture diagram, data flow | Draws multi-tenant architecture with metadata engine, identifies CQRS for reporting, shows lead-to-close flow |
| 15-30 min | **Deep Dive** | Custom objects, scoring, workflows | Designs metadata-driven schema storage, explains trigger execution order, discusses governor limits |
| 30-40 min | **Scalability & Trade-offs** | Multi-tenant scaling, bottlenecks | Discusses pod-based scaling, sharing model performance, cross-object query optimization |
| 40-45 min | **Wrap-up** | Extensions, security, open questions | Mentions field-level security, marketplace packaging, or GDPR if not covered |

---

## Phase 1: Requirements Clarification (0-5 min)

### Good Clarifying Questions

| Question | Why It Matters |
|----------|---------------|
| "How many tenants and users? Are tenants SMB or enterprise?" | Determines multi-tenancy model depth and isolation requirements |
| "Do tenants need to create their own entity types, or just add fields to existing objects?" | Custom objects vs. custom fields is a fundamentally different architecture |
| "What's the API usage pattern? Mostly UI-driven or heavy integration traffic?" | Shapes API platform design, rate limiting, and bulk processing needs |
| "How important is real-time search vs. report freshness?" | Drives consistency model choice and CQRS design |
| "Are there regulatory requirements like GDPR that affect data handling?" | Influences data residency, consent tracking, and erasure capabilities |

### Red Flags

- Candidate jumps straight to database schema without understanding the multi-tenant and custom object requirements
- Treats CRM as a simple CRUD application without recognizing the platform nature
- Does not ask about scale (number of tenants, users per tenant, data volume)

---

## Phase 2: High-Level Design (5-15 min)

### Expected Architecture Elements

A strong candidate should identify these components and explain their interactions:

1. **API Gateway with Tenant Resolver** --- Every request is scoped to an org_id; tenant context propagates through all layers
2. **Domain Services** (Lead, Account, Opportunity, Activity) --- Separated by business domain but sharing the metadata engine
3. **Metadata Engine** --- Central service that defines the virtual schema; all CRUD operations consult metadata before executing
4. **Workflow/Trigger Engine** --- Executes tenant-defined automations with strict ordering and governor limits
5. **Multi-Tenant Database** --- Shared generic tables with org_id partitioning; metadata maps virtual fields to physical columns
6. **Reporting/CQRS Split** --- Operational queries against primary; analytical queries against read replicas or dedicated analytics store
7. **Event Bus** --- Change data capture, async workflow actions, search index updates

### Probing Questions

| Question | What to Look For |
|----------|-----------------|
| "How does the metadata engine interact with the database layer?" | Understanding that queries are compiled from virtual schema to physical queries |
| "Why not just create a database table per custom object?" | Understanding DDL costs at multi-tenant scale; lock contention; schema migration across 150K tenants |
| "Where do you put the governor limit enforcement?" | Should be platform-level (not application code); thread-local counters; uncatchable exceptions |

---

## Phase 3: Deep Dive (15-30 min)

### Track A: Custom Object & Metadata Engine

**Interviewer prompt**: "A tenant administrator creates a new custom object called 'Projects' with fields Budget (currency), Status (picklist), and Start Date (date). Walk me through what happens at the storage layer."

**Expected discussion points:**
- Metadata rows are inserted (metadata_object, metadata_field entries) --- no DDL
- Physical column slots are allocated from the generic table (e.g., number_col_003 for Budget)
- Metadata cache is invalidated for this tenant only
- Next query for Projects compiles to a physical query using the mapped columns

**Follow-up**: "Now the tenant has 200 custom objects with 500 fields total. They're running reports that join Projects with Accounts with Opportunities. How does the query perform?"

**Expected answer:** Cross-object queries on generic tables require joins through the relationship table and metadata-driven column mapping. Index selectivity is poor on generic columns. Mitigations include composite indexes (org_id + object_type_id + column), materialized relationship paths for common traversals, and CQRS with a denormalized analytics store for complex reports.

### Track B: Lead Scoring Pipeline

**Interviewer prompt**: "Design the lead scoring system. A tenant wants to score leads based on job title, company size, and behavioral signals like page visits and email opens."

**Expected discussion points:**
- Two scoring dimensions: demographic (rule-based point assignment) and behavioral (event-driven with time decay)
- Behavioral signals arrive via event stream; processed asynchronously; scores update in near-real-time
- Time decay function (exponential decay with configurable half-life)
- Optional ML overlay for predictive scoring; tenant controls rule-vs-ML weight

**Follow-up**: "The tenant changes their scoring rules. What happens to the 2 million existing leads?"

**Expected answer:** Batch recalculation with checkpointing. Process in batches of 1,000. Show "recalculating" indicator to users during the process. Checkpoint progress for resumability if the job fails. Use off-peak scheduling to minimize resource impact on other tenants.

### Track C: Workflow Trigger Execution

**Interviewer prompt**: "A sales rep changes an Opportunity stage to 'Closed Won'. Walk me through everything that happens in the system."

**Expected discussion points:**
1. Before-trigger evaluates (may set fields like IsWon = true, ForecastCategory = 'Closed')
2. Validation rules check (required fields for Closed Won stage)
3. DML commit
4. After-trigger fires (may update Account.LastClosedWonDate, create a Task for onboarding)
5. Account update triggers Account's before/after triggers (cascading)
6. Workflow rules evaluate (send congratulations email, update opportunity team)
7. Rollup summary on Account recalculates (TotalClosedWonAmount)
8. Forecast rollup updates (quota attainment for the rep's territory)
9. CDC event published (downstream systems notified)

**Follow-up**: "What prevents a trigger loop? One trigger updates Account, which triggers an Opportunity update, which triggers another Account update."

**Expected answer:** Recursion depth counter (max 16 levels). Governor limits are per-transaction across all recursion depths (100 SOQL total, not 100 per trigger). The engine tracks which records have already been processed to prevent re-triggering on the same change in the same transaction.

---

## Phase 4: Scalability & Trade-Offs (30-40 min)

### Key Trade-Off Discussions

**1. Sharing Model Performance vs. Flexibility**

"With Private org-wide defaults, every query joins against the sharing table. At scale (millions of records, thousands of sharing rules), this join becomes expensive. How would you handle this?"

| Approach | Pros | Cons |
|----------|------|------|
| Pre-computed sharing table | Fast query-time lookup | Expensive to maintain on ownership/rule changes |
| Query-time evaluation | No maintenance overhead | Slow for complex sharing hierarchies |
| Hybrid: pre-compute for large orgs, evaluate for small | Balances cost and speed | Complexity of two code paths |

**Expected answer**: Pre-computed sharing table (the Salesforce approach). Accept the maintenance cost because query-time evaluation at scale is prohibitively expensive. Sharing recalculation runs asynchronously after ownership or rule changes, with the old sharing state remaining valid during recalculation.

**2. Generic Tables vs. Dedicated Tables**

"Why not create a dedicated database table for each custom object?"

| Approach | Pros | Cons |
|----------|------|------|
| Generic tables | Zero DDL on schema changes; instant custom object creation | Query compilation overhead; poor column-name readability |
| Dedicated tables | Natural indexing; readable schema; standard query planning | DDL for every schema change; lock contention at scale |
| Hybrid (Salesforce actual) | Typed slots for performance; JSON overflow for flexibility | Two query paths; overflow fields lose indexing |

**Expected answer**: At 150K tenants with frequent schema changes, DDL is operationally unviable. Generic tables with aggressive metadata caching and query compilation are the correct choice. The candidate should mention the typed-slot approach with overflow columns as the practical hybrid.

**3. Synchronous vs. Asynchronous Workflow Execution**

"Should all workflow actions execute synchronously within the save transaction?"

**Expected answer**: No. Before-triggers and validation rules must be synchronous (they affect the save outcome). After-actions (emails, callouts, task creation for other records) should be asynchronous because: (a) external callout latency is unpredictable, (b) email sending should not block the UI, (c) async processing allows retry on failure without failing the original save.

---

## Trap Questions (Separates Senior from Staff)

### Trap 1: "Can we just use a NoSQL document database for the multi-tenant CRM?"

**Naive answer**: "Yes, each tenant gets a collection, each record is a document with flexible schema."

**Why it's a trap**: CRM queries are inherently relational (Accounts → Contacts → Opportunities → Products). Cross-object reports, rollup summaries, and formula fields that reference related objects require join semantics. Document databases lack efficient joins, making cross-object reporting---a core CRM feature---extremely expensive.

**Staff-level answer**: "Document databases handle the custom field problem well (schema flexibility), but CRM data is fundamentally a relationship graph. The query patterns---cross-object reports, rollup summaries, relationship traversals---require relational semantics. The correct approach is a relational database with a metadata layer that provides document-like schema flexibility while preserving relational query capabilities."

### Trap 2: "Why not run SOQL queries directly against the database without compilation?"

**Naive answer**: "Parse SOQL and translate field names to columns."

**Why it's a trap**: SOQL operates on the virtual schema. Without compilation, the system would need to: (a) look up metadata for every field reference at query time, (b) cannot leverage database query optimizer because the optimizer sees generic column names, (c) cannot apply field-level security because the database does not know which virtual fields map to which physical columns.

**Staff-level answer**: "SOQL compilation is necessary because it translates the virtual schema query into an optimized physical query, applies security filters (FLS strips hidden fields from the SELECT, RLS joins the sharing table), enforces governor limits (adds LIMIT), and produces a query plan that the database optimizer can efficiently execute against the physical schema."

### Trap 3: "Governor limits seem like an artificial constraint. Can we just scale the infrastructure?"

**Naive answer**: "With enough hardware, governor limits are unnecessary."

**Why it's a trap**: Governor limits protect tenants from each other, not from the platform. Without governor limits, a single tenant's poorly-written trigger that issues 10,000 SOQL queries per save would exhaust the database connection pool for the entire pod, degrading service for all 5,000 tenants on that pod. No amount of hardware scaling eliminates the need for per-transaction resource caps in a multi-tenant environment.

**Staff-level answer**: "Governor limits are the CRM equivalent of OS process resource limits. They ensure fair sharing of shared resources (CPU, DB connections, memory) across thousands of co-tenant organizations. Scaling infrastructure increases total capacity but does not prevent a single tenant from consuming a disproportionate share. The limits also serve as a design constraint that forces efficient patterns---just as memory constraints force efficient algorithms."

### Trap 4: "For lead scoring, shouldn't we just use a single ML model?"

**Naive answer**: "Train a deep learning model on all conversion data."

**Why it's a trap**: (a) New tenants have insufficient conversion data to train a reliable model. (b) Sales teams do not trust opaque ML scores---they need to understand why a lead scored high. (c) Different tenants have completely different ideal customer profiles; a pooled model would average out tenant-specific patterns.

**Staff-level answer**: "Rule-based scoring is the foundation because it's immediately usable (no training data required), transparent (sales reps can see point breakdowns), and tenant-customizable. ML augments rules---not replaces them---by finding non-obvious patterns in behavioral sequences. The weight between rules and ML should be tenant-controlled, with ML only enabled when sufficient conversion history exists (200+ conversions minimum for basic models)."

### Trap 5: "Can we add AI email drafting that reads the full account history for better context?"

**Naive answer**: "Yes, give the AI access to all account records for the best possible email drafts."

**Why it's a trap**: The AI would read data the requesting user may not have access to. A sales rep who can only see their own Opportunities should not receive AI-drafted content influenced by another rep's confidential deal notes. The existing OLS/FLS/RLS model does not account for AI inference paths.

**Staff-level answer**: "AI inference must be scoped to the requesting user's access permissions. The copilot queries CRM data using the user's security context --- same OLS, FLS, and RLS checks as if the user ran a SOQL query. This may reduce draft quality (the AI cannot reference activities from other reps), but it prevents information leakage. For aggregate context (e.g., 'this account has been active for 18 months'), we can use elevated access for statistics without exposing individual records."

---

## Scoring Rubric

### Junior/Mid Level (Not Expected to Pass This Topic)

- Designs a basic CRUD API for leads and opportunities
- Uses a standard relational schema with one table per entity
- Does not address multi-tenancy or custom objects
- Treats CRM as a web application, not a platform

### Senior Level (Expected Bar)

| Dimension | Criteria | Score |
|-----------|----------|-------|
| **Requirements** | Identifies multi-tenant scale, custom object needs, API platform requirements | 1-2 pts |
| **Data Model** | Designs generic table storage with metadata mapping; explains why dedicated tables don't work at scale | 2-3 pts |
| **Automation** | Describes trigger execution order; identifies cascading trigger problem; proposes governor limits | 2-3 pts |
| **Scaling** | Explains pod-based scaling; discusses tenant migration; mentions sharing table for RLS | 1-2 pts |
| **Security** | Covers at least OLS + FLS + RLS; explains sharing rules | 1-2 pts |
| **Total** | | 7-12 pts |

### Staff Level (Exceptional)

| Dimension | Criteria | Score |
|-----------|----------|-------|
| **Metadata Engine** | Explains query compilation from virtual to physical schema; discusses formula field evaluation and cross-object reference resolution | 2-3 pts |
| **Governor Limits** | Designs governor architecture as platform-level enforcement; explains why limits are essential for multi-tenant fairness, not just safety | 2-3 pts |
| **Scoring Pipeline** | Designs hybrid rule+ML scoring with decay; addresses cold-start, model training, and tenant control of scoring weights | 2-3 pts |
| **Query Optimization** | Identifies generic column index selectivity problem; proposes composite indexes and materialized paths for cross-object queries | 2-3 pts |
| **Platform Thinking** | Discusses marketplace/packaging, API versioning, extension sandboxing, or upgrade-safe customization hierarchy | 2-3 pts |
| **AI Integration** | Addresses AI copilot permission model; identifies the inference-vs-security tension; proposes user-scoped inference or aggregate elevation | 1-2 pts |
| **Total** | | 11-17 pts |

---

## Common Candidate Mistakes

| Mistake | Why It's Wrong | Correct Approach |
|---------|---------------|-----------------|
| Designing separate database per tenant | Cost-prohibitive at 150K tenants; operational nightmare for upgrades | Shared database with org_id partitioning; dedicated DB only for largest enterprise tenants |
| Ignoring the order of execution for triggers | Leads to incorrect automation behavior; candidates underestimate cascading complexity | Must know: system validation → before-trigger → custom validation → DML → after-trigger → workflow → rollup |
| Proposing ElasticSearch as the primary data store | ElasticSearch lacks transactional guarantees needed for CRM record saves | ES for search index only; transactional database as source of truth |
| Not considering the sharing model's performance impact | Private OWD with millions of records creates expensive joins | Pre-computed sharing table; accept async recalculation cost |
| Designing lead scoring as batch-only | Sales reps expect near-real-time scores after behavioral events | Event-driven scoring with < 5s latency for score updates |
| Ignoring formula field evaluation cost | "Just compute on read" without considering list views with thousands of records and cross-object formulas | Batch prefetch; cached compiled expressions; limit cross-object formula depth |
| Treating governor limits as optional rate limiting | Governor limits are load-bearing architectural constraints, not safety nets | Platform-level enforcement with thread-local counters; uncatchable exceptions; limits shape all feature design |
| Ignoring CDC for downstream synchronization | Point-to-point integration between write path and every consumer creates tight coupling | Event mesh with CDC events; downstream systems subscribe to change events independently |

---

## Architecture Diagram Expectations

During the whiteboard phase, strong candidates produce a diagram that includes these key elements:

**Must-have components:**
1. API Gateway with tenant resolver (org_id extraction from JWT/session)
2. Metadata Engine as a central service consulted by all domain services
3. Shared multi-tenant database with org_id partitioning
4. Separate path for reporting/analytics (CQRS split)
5. Event bus connecting write path to async consumers
6. Governor limit enforcement layer (not just API rate limiting)

**Distinguishing elements (staff-level):**
- Formula field evaluation pipeline in the data access path
- Pre-computed sharing table as part of the query path for Private OWD objects
- Metadata cache hierarchy (thread-local → process → distributed → database)
- Bulk API processor with separate worker pool and governor limits
- Search indexer consuming CDC events from the event bus
- AI/ML inference layer operating within user security scope

**Common diagram mistakes:**
- Drawing a single "CRM Service" box without decomposing into domain and platform services
- Omitting the metadata engine entirely (treating custom objects as a storage problem, not a platform problem)
- Placing governor limits only at the API gateway (they must be within the application runtime)
- Not showing the relationship between the metadata cache and all domain services

---

## Additional Probing Questions by Depth

### For Senior Candidates

| Question | Expected Answer Direction |
|----------|--------------------------|
| "How would you handle a tenant requesting deletion of all their data under GDPR?" | Identify all data locations (DB, cache, search index, analytics store, backups, event bus). Anonymize vs. hard delete trade-off for referential integrity. Audit trail of the erasure itself must be retained. Cross-reference scan for custom object lookups pointing to the contact. |
| "A tenant's report takes 30 seconds. How do you diagnose and fix it?" | Check report definition for cross-object joins and formula fields. Trace the compiled physical query for missing indexes. Consider CQRS --- move to analytics store for complex reports. Check if the tenant has Private OWD causing sharing table joins. |
| "How do you handle conflicting field updates from two concurrent API requests?" | Optimistic concurrency with version field / last_modified_date check. CRM typically uses last-write-wins for most fields but may enforce version checking for critical fields like Opportunity.Amount. Discuss the trade-off between strict consistency and user experience for sales reps. |

### For Staff+ Candidates

| Question | Expected Answer Direction |
|----------|--------------------------|
| "How would you add AI-powered email drafting to the CRM without violating the security model?" | AI inference must respect FLS and RLS --- the model should only see data the requesting user can access. Discuss user-scoped inference vs. elevated inference with filtered output. Address the information leakage risk where AI-generated content might implicitly reveal data the user cannot see. Mention the need for a new "AI access layer" in the permission model. |
| "Design the tenant migration process when splitting a pod that has become too hot." | Dual-write strategy: bulk copy → enable dual-write → catch up delta → verify checksums → switch reads → drain source. Must handle in-flight transactions, CDC event ordering during migration, cache warming on the target pod, and search index rebuilding. Migration should be transparent to the tenant's users. |
| "How would you implement a formula field that references data across three object levels?" | Dependency DAG construction at metadata time. Cycle detection to prevent circular references. Topological sort for evaluation ordering. Batch prefetch of related records to avoid N+1 query patterns. Governor limit pressure from cross-object queries. Limit on formula compilation depth (typically 10 levels). |

---

## Discussion Extensions (If Time Allows)

| Topic | Discussion Direction |
|-------|---------------------|
| **AppExchange/Marketplace** | How do managed packages achieve namespace isolation? How are cross-package dependencies resolved? What prevents a malicious package from exfiltrating tenant data? |
| **Salesforce-to-Salesforce Sync** | How do two CRM orgs share records in real-time? Conflict resolution? Schema mapping when orgs have different custom fields? |
| **AI Copilot Integration** | How does the platform train per-tenant ML models? Where does inference run (edge vs. central)? How does the AI respect the existing OLS/FLS/RLS model? What new permission dimensions does AI inference require? |
| **Mobile Offline Sync** | How does the mobile client work offline with a subset of CRM data? Conflict resolution when online/offline changes collide? How are governor limits enforced for offline-queued operations? |
| **Multi-Currency Forecasting** | How does the system aggregate opportunities in 20 different currencies into a single forecast? Dated exchange rates? Currency conversion timing (record date vs. close date vs. today)? |
| **Real-Time CDP Integration** | How does the CRM connect with a Customer Data Platform to unify first-party and third-party data? Identity resolution across CRM contacts and anonymous web visitors? Consent propagation between CRM and CDP? |
| **Conversation Intelligence** | How does the platform process call recordings to auto-populate CRM fields? Speech-to-text pipeline architecture? NLP entity extraction for competitor mentions, pricing discussions, and objection patterns? Privacy implications of recording analysis? |
