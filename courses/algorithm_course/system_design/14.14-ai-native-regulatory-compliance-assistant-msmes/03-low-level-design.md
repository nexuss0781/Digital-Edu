# 14.14 AI-Native Regulatory & Compliance Assistant for MSMEs — Low-Level Design

## Data Models

### Business Profile

```
BusinessProfile {
    business_id          UUID            PK
    gstin                String          UNIQUE, nullable (not all MSMEs have GST)
    pan                  String          UNIQUE
    business_name        String
    business_type        Enum            [proprietorship, partnership, llp, pvt_ltd, opc]
    industry_codes       String[]        NIC codes for industry classification
    incorporation_date   Date

    // Compliance-critical parameters
    employee_count       Integer         triggers ESI/PF thresholds
    annual_turnover      Decimal         triggers GST filing frequency, audit thresholds
    states_of_operation  String[]        jurisdiction set
    municipal_areas      String[]        municipal jurisdiction set
    activities           String[]        [manufacturing, trading, services, food, hazardous]

    // Derived compliance parameters
    size_classification  Enum            [micro, small, medium] — computed from investment + turnover
    gst_filing_frequency Enum            [monthly, quarterly, annual] — derived from turnover
    pf_applicable        Boolean         derived from employee_count >= 20 (or voluntary)
    esi_applicable       Boolean         derived from employee_count >= 10

    // Archetype mapping
    archetype_id         UUID            FK → ComplianceArchetype
    archetype_version    Integer         version of archetype when last synced

    // DPDP consent tracking
    consent_version      Integer         latest consent version accepted
    data_retention_end   Date            nullable — when data deletion is scheduled

    created_at           Timestamp
    updated_at           Timestamp
    parameter_version    Integer         incremented on every parameter change
}
```

### Compliance Archetype

```
ComplianceArchetype {
    archetype_id         UUID            PK
    archetype_hash       String          hash of (industry, size, jurisdictions, activities)

    // Defining parameters
    industry_group       String          NIC group code
    size_bracket         Enum            [micro, small, medium]
    jurisdiction_set     String[]        sorted list of jurisdictions
    activity_set         String[]        sorted list of activities

    // Cached obligation set
    obligation_node_ids  UUID[]          list of applicable regulation node IDs
    obligation_count     Integer
    last_computed_at     Timestamp
    graph_version        Integer         knowledge graph version when computed

    // Statistics
    business_count       Integer         number of businesses in this archetype
    invalidated          Boolean         true when regulatory change affects this archetype
    invalidated_at       Timestamp       nullable

    created_at           Timestamp
    updated_at           Timestamp
}
```

### Regulatory Knowledge Graph Nodes

```
RegulationNode {
    node_id              UUID            PK
    node_type            Enum            [act, section, rule, notification, circular,
                                          obligation, threshold, form, penalty]

    // Identity
    title                String          "CGST Act 2017, Section 39(1)"
    short_title          String          "GSTR-3B Monthly Filing"
    jurisdiction         String          "central" | state code | municipal code
    jurisdiction_level   Enum            [central, state, municipal]

    // Content
    full_text            Text            original legal text
    plain_summary        Text            AI-generated plain-language summary
    plain_summary_lang   String[]        languages available for summary
    effective_date       Date
    sunset_date          Date            nullable — for provisions with expiry
    confidence_score     Float           NLP extraction confidence (0-1)
    verified_by          UUID            nullable — human reviewer ID
    verified_at          Timestamp       nullable

    // Applicability
    applicability_rules  JSON            structured criteria for who this applies to
    /*  Example:
        {
            "conditions": [
                {"field": "gst_filing_frequency", "op": "eq", "value": "monthly"},
                {"field": "states_of_operation", "op": "contains", "value": "any"}
            ],
            "logic": "AND"
        }
    */

    // Obligation details (for obligation nodes)
    obligation_type      Enum            [filing, payment, registration, renewal, report,
                                          inspection, certification]
    frequency            Enum            [one_time, monthly, quarterly, half_yearly, annual,
                                          event_triggered]
    deadline_rule        JSON            temporal computation rule (see Deadline Computation)
    penalty_rule         JSON            penalty calculation for non-compliance
    preparation_days     Integer         estimated days needed to prepare
    severity_tier        Enum            [critical, high, medium, low]

    // Threshold details (for threshold nodes)
    threshold_field      String          "employee_count" | "annual_turnover" | ...
    threshold_value      Decimal
    threshold_direction  Enum            [above, below, crossing]
    hysteresis_rule      JSON            activation/deactivation asymmetry rules
    /*  Example:
        {
            "activation": {"field": "employee_count", "op": ">=", "value": 20},
            "deactivation": "never",  // PF is permanent once triggered
            // OR: {"field": "employee_count", "op": "<", "value": 10,
            //      "duration_months": 24}  // ESI: below threshold for 24 months
        }
    */

    // Metadata
    source_url           String
    last_verified        Timestamp
    version              Integer
    created_at           Timestamp
    updated_at           Timestamp
}
```

### Regulatory Graph Edges

```
RegulationEdge {
    edge_id              UUID            PK
    source_node_id       UUID            FK → RegulationNode
    target_node_id       UUID            FK → RegulationNode
    edge_type            Enum            [contains, amends, derives_from, depends_on,
                                          supersedes, references, conflicts_with,
                                          triggers_threshold, override, additive, concurrent]
    jurisdiction_rel     Enum            [override, additive, concurrent]  nullable — for cross-jurisdiction edges
    metadata             JSON            additional edge context
    effective_date       Date
    created_at           Timestamp
}
```

### Compliance Obligation Instance

```
ObligationInstance {
    instance_id          UUID            PK
    business_id          UUID            FK → BusinessProfile
    regulation_node_id   UUID            FK → RegulationNode

    // Computed deadline
    due_date             Date
    extended_due_date    Date            nullable — government extension
    period_start         Date            for periodic filings (e.g., month start)
    period_end           Date            for periodic filings (e.g., month end)
    preparation_start    Date            computed: due_date - preparation_days

    // Status tracking
    status               Enum            [upcoming, due_soon, overdue, completed,
                                          not_applicable, waived, blocked]
    blocked_by           UUID[]          obligation instances that must complete first
    completed_at         Timestamp       nullable
    completion_evidence  UUID            FK → Document (filing receipt)

    // Notification state
    reminder_stage       Integer         current reminder stage (0=not started, 1=90d, etc.)
    last_reminder_sent   Timestamp
    assignee_user_id     UUID            FK → User (who is responsible)
    acknowledged         Boolean

    // Penalty tracking
    penalty_accrued      Decimal         computed daily for overdue items
    penalty_formula      String          human-readable penalty description

    // Risk scoring
    risk_score           Float           penalty_amount × inspection_probability × remediation_difficulty
    severity_tier        Enum            [critical, high, medium, low]

    created_at           Timestamp
    updated_at           Timestamp
}
```

### Compliance Document

```
ComplianceDocument {
    document_id          UUID            PK
    business_id          UUID            FK → BusinessProfile

    // Content-addressed storage
    content_hash_sha256  String          SHA-256 of document content
    content_hash_sha3    String          SHA-3 of document content (dual-hash for future-proofing)
    storage_path         String          object storage path
    file_size            Integer         bytes
    mime_type            String

    // AI-classified metadata
    regulation_node_id   UUID            FK → RegulationNode (nullable until classified)
    document_type        Enum            [filing_receipt, acknowledgment, challan,
                                          certificate, license, inspection_report,
                                          return_form, assessment_order, notice,
                                          correspondence, other]
    assessment_period    String          "2025-26" or "2025-Q3" or "2025-10"
    confidence_score     Float           classification confidence (0-1)
    classification_model String          model version used for classification

    // Extracted fields
    extracted_fields     JSON            {challan_no, filing_date, amount, ack_number, ...}
    ocr_text             Text            full OCR text for search indexing
    language_detected    String          detected language of document

    // Metadata
    uploaded_by          UUID            FK → User
    upload_source        Enum            [app, email, whatsapp, api, digilocker]
    uploaded_at          Timestamp
    verified_by          UUID            nullable — human verification
    verified_at          Timestamp       nullable

    // Integrity audit trail
    last_integrity_check Timestamp
    integrity_status     Enum            [verified, pending, failed]
}
```

### Notification Record

```
NotificationRecord {
    notification_id      UUID            PK
    business_id          UUID            FK → BusinessProfile
    user_id              UUID            FK → User
    obligation_id        UUID            FK → ObligationInstance (nullable for regulatory updates)

    notification_type    Enum            [deadline_reminder, regulatory_change, threshold_alert,
                                          gap_alert, overdue_escalation, audit_readiness,
                                          extension_correction, q_and_a_followup]
    severity             Enum            [critical, high, medium, low]
    channel              Enum            [whatsapp, sms, email, push]

    // Content
    title                String
    body                 Text
    action_url           String          deep link to relevant screen
    original_deadline    Date            nullable — for correction notifications

    // Delivery tracking
    scheduled_at         Timestamp
    sent_at              Timestamp       nullable
    delivered_at         Timestamp       nullable
    read_at              Timestamp       nullable
    acknowledged_at      Timestamp       nullable
    delivery_status      Enum            [pending, sent, delivered, read, failed, expired]
    failure_reason       String          nullable
    retry_count          Integer         default 0
    fallback_triggered   Boolean         whether fallback channel was used

    // Reconciliation
    reconciliation_check Timestamp       nullable — when last verified by reconciler
    reconciliation_gap   Boolean         false — true if detected as missing by reconciler

    created_at           Timestamp
}
```

### Threshold State Machine

```
ThresholdState {
    state_id             UUID            PK
    business_id          UUID            FK → BusinessProfile
    threshold_node_id    UUID            FK → RegulationNode (threshold type)

    // Current state
    current_value        Decimal         current value of monitored field
    threshold_value      Decimal         regulatory threshold
    state                Enum            [below, approaching, crossed, permanently_activated,
                                          deactivation_pending, deactivated]

    // History
    first_crossed_at     Date            nullable — when threshold was first crossed
    last_crossed_at      Date            nullable — most recent crossing
    consecutive_months_below Integer     for deactivation rules with duration requirement
    activation_permanent Boolean         true for PF-style permanent obligations

    // Projection
    projected_crossing   Date            nullable — estimated future crossing date
    projection_confidence Float          confidence in projection

    updated_at           Timestamp
}
```

### Holiday Calendar

```
HolidayEntry {
    entry_id             UUID            PK
    date                 Date
    jurisdiction         String          "national" | state code | "bank"
    holiday_type         Enum            [national, bank, state, municipal, restricted]
    name                 String
    affects_deadlines    Boolean         whether filing deadlines shift for this holiday
    administering_body   String[]        which authority's deadlines are affected

    source_notification  String          gazette/notification reference
    created_at           Timestamp
}
```

---

## API Contracts

### Business Profile API

```
POST /api/v1/businesses
Request:
{
    "gstin": "27AABCU9603R1ZM",
    "pan": "AABCU9603R",
    "business_name": "Sharma Textiles",
    "business_type": "pvt_ltd",
    "industry_codes": ["13111"],
    "employee_count": 45,
    "annual_turnover": 8500000,
    "states_of_operation": ["MH", "GJ"],
    "activities": ["manufacturing", "trading"],
    "consent": {
        "data_processing": true,
        "notification_channels": ["whatsapp", "email"],
        "data_sharing_with_ca": false,
        "version": "2.1"
    }
}
Response: 201
{
    "business_id": "uuid",
    "archetype_id": "uuid",
    "obligations_count": 87,
    "next_deadline": {
        "obligation": "GSTR-3B Filing (October 2025)",
        "due_date": "2025-11-20",
        "days_remaining": 15
    },
    "threshold_alerts": [
        {
            "type": "esi_approaching",
            "message": "At 45 employees, you are well above the ESI threshold (10)",
            "status": "already_applicable"
        }
    ],
    "compliance_score": 0,
    "onboarding_checklist": [
        {"step": "Upload existing licenses", "priority": "high"},
        {"step": "Connect accounting software", "priority": "medium"},
        {"step": "Invite your accountant", "priority": "medium"},
        {"step": "Upload last 3 months filing receipts", "priority": "high"}
    ]
}
```

### Business Parameter Update API

```
PATCH /api/v1/businesses/{business_id}/parameters
Request:
{
    "employee_count": 50,
    "change_reason": "hired_5_new",
    "effective_date": "2025-11-15"
}
Response: 200
{
    "parameter_version": 12,
    "threshold_crossings": [],
    "obligation_changes": {
        "added": [],
        "modified": 0,
        "removed": 0
    },
    "recomputation_status": "complete"
}
```

### Compliance Calendar API

```
GET /api/v1/businesses/{business_id}/calendar?month=2025-11&status=upcoming,due_soon
Response: 200
{
    "month": "2025-11",
    "obligations": [
        {
            "instance_id": "uuid",
            "title": "GSTR-3B Filing — October 2025",
            "regulation": "CGST Act, Section 39(1)",
            "due_date": "2025-11-20",
            "preparation_start": "2025-11-17",
            "status": "due_soon",
            "severity": "high",
            "risk_score": 85.5,
            "penalty_rule": "₹50/day + 18% interest on tax due",
            "preparation_days": 3,
            "assignee": {"user_id": "uuid", "name": "Ramesh (Accountant)"},
            "dependencies": [],
            "blocked_by": [],
            "documents_needed": ["Sales register", "Purchase register", "Input tax credit details"],
            "pre_fill_available": true,
            "deadline_extended": false
        }
    ],
    "priority_list": [
        {
            "rank": 1,
            "instance_id": "uuid",
            "reason": "Highest penalty risk; due in 5 days"
        }
    ],
    "summary": {
        "total_obligations": 12,
        "completed": 3,
        "upcoming": 7,
        "overdue": 2,
        "blocked": 0,
        "risk_score": 72
    }
}
```

### Document Upload API

```
POST /api/v1/businesses/{business_id}/documents
Content-Type: multipart/form-data
Fields: file, source (app|email|whatsapp|digilocker), notes (optional)

Response: 202
{
    "document_id": "uuid",
    "content_hash": "sha256:a1b2c3...",
    "classification": {
        "status": "processing",
        "estimated_completion": "10s"
    }
}

// Classification webhook (async)
POST /webhooks/document-classified
{
    "document_id": "uuid",
    "classification": {
        "document_type": "filing_receipt",
        "regulation": "GSTR-3B",
        "period": "2025-10",
        "confidence": 0.94,
        "extracted_fields": {
            "ack_number": "GSTN/2025/10/A1234",
            "filing_date": "2025-11-18",
            "tax_paid": 45000
        }
    },
    "linked_obligation_id": "uuid",
    "audit_readiness_impact": {
        "previous_score": 75,
        "new_score": 78,
        "gap_resolved": "Missing GSTR-3B receipt for October 2025"
    }
}
```

### Regulatory Change Feed API

```
GET /api/v1/businesses/{business_id}/regulatory-changes?since=2025-11-01
Response: 200
{
    "changes": [
        {
            "change_id": "uuid",
            "published_date": "2025-11-05",
            "source": "CBIC Notification No. 47/2025",
            "original_url": "https://...",
            "impact_level": "high",
            "confidence_score": 0.92,
            "summary": {
                "title": "GST Filing Frequency Change for Turnover > ₹5 Crore",
                "plain_language": "Your GST filing changes from quarterly to monthly starting April 2026 because your turnover crossed ₹5 crore.",
                "action_required": "No immediate action. Monthly filing starts from April 2026. System will update your calendar automatically.",
                "penalty_info": "Late monthly filing: ₹50/day up to ₹5,000",
                "affected_obligations": ["GSTR-3B", "GSTR-1"],
                "citation": "CGST Act Section 39(1), as amended by Notification 47/2025"
            }
        }
    ]
}
```

### NL Compliance Q&A API

```
POST /api/v1/businesses/{business_id}/compliance-qa
Request:
{
    "question": "Do I need to register for ESI if I have 8 employees?",
    "conversation_id": "uuid",   // optional for follow-ups
    "language": "en"
}
Response: 200
{
    "answer": {
        "text": "No, ESI registration is not mandatory for your business at 8 employees. The ESI Act applies to establishments with 10 or more employees. However, you are approaching the threshold — if you hire 2 more employees, ESI registration will become mandatory within 15 days of hiring the 10th employee.",
        "confidence": 0.95,
        "citations": [
            {
                "regulation": "ESI Act, 1948, Section 1(5)",
                "text": "...applicable to all factories and establishments employing 10 or more persons...",
                "node_id": "uuid"
            }
        ],
        "action_items": [
            "No action required at present",
            "System will alert you when you approach 10 employees"
        ],
        "disclaimer": "This is regulatory information, not legal advice. Consult your CA for specific guidance."
    },
    "conversation_id": "uuid",
    "follow_up_suggestions": [
        "What happens if I cross 10 employees temporarily?",
        "What are the ESI contribution rates?",
        "Is ESI applicable if some employees are contract workers?"
    ]
}
```

### Audit Readiness API

```
GET /api/v1/businesses/{business_id}/audit-readiness?regulation=gst&period=2024-25
Response: 200
{
    "readiness_score": 78,
    "regulation": "GST",
    "period": "2024-25",
    "score_breakdown": {
        "filing_completeness": 90,
        "document_evidence": 72,
        "cross_reference_accuracy": 70,
        "supporting_documents": 80
    },
    "gaps": [
        {
            "gap_type": "missing_document",
            "description": "GSTR-3B filing receipt for March 2025 not uploaded",
            "severity": "high",
            "penalty_risk": "₹50/day late fee if filing itself was late",
            "action": "Upload the GSTR-3B acknowledgment for March 2025",
            "remediation_deadline": "Before audit notice"
        },
        {
            "gap_type": "mismatch",
            "description": "Input tax credit claimed (₹2,45,000) doesn't match purchase register total (₹2,52,000)",
            "severity": "medium",
            "penalty_risk": "Reversal of excess ITC + interest",
            "action": "Reconcile ITC with purchase register and upload reconciliation statement"
        }
    ],
    "audit_pack": {
        "available": true,
        "download_url": "/api/v1/businesses/{id}/audit-pack/gst/2024-25",
        "documents_included": 47,
        "last_generated": "2025-11-10T08:00:00Z",
        "organized_by": ["Monthly returns", "Annual return", "ITC details", "E-way bills", "Challans"]
    }
}
```

---

## Core Algorithms

### Algorithm 1: Obligation Mapping via Knowledge Graph Traversal with Archetype Caching

```
function computeObligations(businessProfile):
    // Step 0: Check archetype cache
    archetypeHash = computeArchetypeHash(
        businessProfile.industry_codes,
        businessProfile.size_classification,
        sorted(businessProfile.states_of_operation),
        sorted(businessProfile.activities)
    )

    cachedArchetype = archetypeCache.get(archetypeHash)
    if cachedArchetype and not cachedArchetype.invalidated:
        // Cache hit: clone obligation set
        obligations = cachedArchetype.obligation_node_ids.map(
            nodeId -> createObligationInstance(
                knowledgeGraph.getNode(nodeId), businessProfile
            )
        )
        businessProfile.archetype_id = cachedArchetype.archetype_id
        return resolveJurisdictionConflicts(obligations)

    // Cache miss: full graph traversal
    applicableObligations = []

    // Step 1: Determine jurisdiction set
    jurisdictions = ["central"]
    jurisdictions.addAll(businessProfile.states_of_operation)
    jurisdictions.addAll(businessProfile.municipal_areas)

    // Step 2: Traverse knowledge graph for each jurisdiction
    for jurisdiction in jurisdictions:
        regulationNodes = knowledgeGraph.getNodes(
            jurisdiction = jurisdiction,
            nodeType = "obligation"
        )

        for node in regulationNodes:
            if evaluateApplicability(node.applicability_rules, businessProfile):
                obligation = createObligationInstance(node, businessProfile)
                applicableObligations.add(obligation)

    // Step 3: Resolve conflicts (state overrides central)
    applicableObligations = resolveJurisdictionConflicts(applicableObligations)

    // Step 4: Compute dependency ordering
    applicableObligations = topologicalSort(applicableObligations, byDependencyEdges)

    // Step 5: Update archetype cache
    archetypeCache.put(archetypeHash, ArchetypeEntry(
        obligation_node_ids = applicableObligations.map(o -> o.regulation_node_id),
        graph_version = knowledgeGraph.currentVersion(),
        business_count = 1
    ))

    return applicableObligations

function evaluateApplicability(rules, profile):
    for condition in rules.conditions:
        fieldValue = profile.getField(condition.field)
        if not evaluate(fieldValue, condition.op, condition.value):
            if rules.logic == "AND": return false
        else:
            if rules.logic == "OR": return true
    return rules.logic == "AND"
```

### Algorithm 2: Deadline Computation with Calendar Adjustments and Extensions

```
function computeDeadline(obligationNode, businessProfile, periodEnd):
    rule = obligationNode.deadline_rule

    // Step 1: Base deadline from rule
    if rule.type == "fixed_day_of_month":
        baseDate = Date(periodEnd.year, periodEnd.month + rule.offset_months, rule.day)
    elif rule.type == "days_after_period_end":
        baseDate = periodEnd + rule.days
    elif rule.type == "fixed_annual_date":
        baseDate = Date(periodEnd.year + rule.year_offset, rule.month, rule.day)
    elif rule.type == "event_relative":
        eventDate = getBusinessEvent(businessProfile, rule.event_type)
        baseDate = eventDate + rule.days_after_event
    elif rule.type == "conditional":
        // Evaluate conditional deadline based on business parameters
        for range in rule.conditions[0].ranges:
            fieldValue = businessProfile.getField(rule.conditions[0].field)
            if fieldValue >= range.min and (range.max is null or fieldValue < range.max):
                baseDate = computeDeadline(range.deadline, businessProfile, periodEnd)
                break

    // Step 2: Apply jurisdiction-specific overrides
    if jurisdictionOverride = getJurisdictionDeadline(
        obligationNode, businessProfile.states_of_operation
    ):
        baseDate = jurisdictionOverride

    // Step 3: Apply government extensions (check extension cache first)
    if extension = getActiveExtension(obligationNode.node_id, periodEnd):
        baseDate = extension.extended_date

    // Step 4: Holiday adjustment based on administering authority
    adminBody = obligationNode.administering_body
    holidayCalendar = getHolidayCalendar(adminBody, businessProfile.primaryJurisdiction)
    while isHoliday(baseDate, holidayCalendar) or isWeekend(baseDate):
        if rule.holiday_shift == "next_working_day":
            baseDate = baseDate + 1 day
        elif rule.holiday_shift == "previous_working_day":
            baseDate = baseDate - 1 day
        else:
            break  // no shift

    // Step 5: Compute preparation start date
    preparationStart = baseDate - obligationNode.preparation_days
    while isHoliday(preparationStart, holidayCalendar) or isWeekend(preparationStart):
        preparationStart = preparationStart - 1 day

    return DeadlineResult(
        due_date = baseDate,
        preparation_start = preparationStart,
        calendar_adjusted = baseDate != originalBaseDate,
        extension_applied = extension != null
    )
```

### Algorithm 3: Regulatory Change Detection and Impact Analysis

```
function processRegulatoryDocument(newDocument, source):
    // Step 1: Parse and extract text
    parsedText = documentParser.parse(newDocument)
    language = detectLanguage(parsedText)
    if language != "en":
        englishText = legalTranslator.translate(parsedText, language, "en")
    else:
        englishText = parsedText

    // Step 2: Detect if this is a new regulation or amendment
    existingNodes = knowledgeGraph.findSimilar(englishText, threshold=0.85)

    if existingNodes is empty:
        changeType = "new_regulation"
        affectedNodes = []
    else:
        changeType = "amendment"
        previousVersion = existingNodes[0]
        diff = semanticDiff(previousVersion.full_text, englishText)
        affectedNodes = identifyAffectedNodes(previousVersion, diff)

    // Step 3: Extract obligations from new/changed text
    obligations = nlpPipeline.extractObligations(englishText)
    // NER: who (applicability), what (obligation), when (deadline),
    //       how_much (penalty), where (jurisdiction)

    // Step 4: Confidence-based routing
    for obligation in obligations:
        if obligation.confidence >= 0.85:
            autoAccepted.add(obligation)
        elif obligation.confidence >= 0.7:
            humanReviewQueue.add(obligation)  // flag for review
        else:
            rejected.add(obligation)  // log and skip

    // Step 5: Check for deadline extensions (fast path)
    if isDeadlineExtension(englishText):
        processExtensionFastPath(englishText, obligations)
        return

    // Step 6: Update knowledge graph atomically
    graphTransaction = knowledgeGraph.beginTransaction()
    for obligation in autoAccepted:
        node = createOrUpdateNode(obligation)
        graphTransaction.upsert(node)

    // Validate before committing
    if not validateGraphConsistency(graphTransaction):
        graphTransaction.rollback()
        alertManualReview("Graph consistency check failed", newDocument)
        return

    graphTransaction.commit()

    // Step 7: Invalidate affected archetypes
    affectedArchetypes = archetypeCache.findAffected(obligations)
    for archetype in affectedArchetypes:
        archetype.invalidated = true
        archetype.invalidated_at = now()

    // Step 8: Find affected businesses (priority-ordered)
    affectedBusinesses = []
    for node in affectedNodes + autoAccepted:
        businesses = businessDB.query(
            matchesApplicability(node.applicability_rules)
        )
        affectedBusinesses.addAll(businesses)

    // Step 9: Three-phase propagation
    deduplicated = affectedBusinesses.deduplicate()
    // Phase 1: Businesses with affected obligation due in next 30 days
    urgent = deduplicated.filter(b -> hasUpcomingDeadline(b, obligations, 30))
    for business in urgent:
        obligationService.recomputeSync(business.business_id)

    // Phase 2: Remaining businesses — async, rate-limited
    remaining = deduplicated.subtract(urgent)
    asyncPropagationQueue.enqueueAll(remaining, rateLimitPerSecond=1000)

    // Step 10: Generate notifications
    summary = nlpPipeline.generatePlainLanguageSummary(
        changeType, diff, obligations
    )
    notificationService.dispatchRegulatoryChange(
        deduplicated, summary
    )
```

### Algorithm 4: Audit Readiness Scoring

```
function computeAuditReadiness(businessId, regulation, period):
    score = 100  // Start with perfect score, deduct for gaps
    gaps = []

    // Step 1: Get all obligations for this regulation and period
    obligations = obligationStore.query(
        business_id = businessId,
        regulation = regulation,
        period = period
    )

    for obligation in obligations:
        weight = getObligationWeight(obligation)  // risk-weighted

        // Check 1: Filing completion
        if obligation.status == "overdue":
            score -= 15 * weight
            gaps.add(Gap("missing_filing", obligation, severity="critical"))
        elif obligation.status == "completed":
            // Check 2: Filing evidence
            if not documentVault.hasDocument(obligation.completion_evidence):
                score -= 5 * weight
                gaps.add(Gap("missing_receipt", obligation, severity="high"))
            else:
                // Check 3: Document integrity
                doc = documentVault.get(obligation.completion_evidence)
                if not verifyDualHash(doc):
                    score -= 10 * weight
                    gaps.add(Gap("integrity_issue", obligation, severity="critical"))

    // Step 2: Check supporting documents
    requiredDocs = getRequiredSupportingDocs(regulation, period)
    for docType in requiredDocs:
        if not documentVault.hasDocumentOfType(businessId, docType, period):
            score -= 3
            gaps.add(Gap("missing_supporting_doc", docType, severity="medium"))

    // Step 3: Cross-reference validation
    crossRefIssues = validateCrossReferences(businessId, regulation, period)
    for issue in crossRefIssues:
        score -= issue.severity_weight
        gaps.add(issue)

    // Step 4: Timeline consistency check
    filingDates = obligations.filter(completed).map(o -> o.completed_at)
    for filing in filingDates:
        if filing > getDeadlineForObligation(obligation):
            score -= 2  // Late filing detected
            gaps.add(Gap("late_filing", obligation, severity="low",
                detail="Filed on {filing}, deadline was {deadline}"))

    return AuditReadiness(
        score = max(0, score),
        gaps = gaps.sortBy(severity descending),
        audit_pack_ready = score >= 70,
        score_breakdown = computeBreakdown(obligations, gaps)
    )

function getObligationWeight(obligation):
    // Risk-weighted scoring
    baseWeight = 1.0
    if obligation.severity_tier == "critical": baseWeight = 3.0
    elif obligation.severity_tier == "high": baseWeight = 2.0
    elif obligation.severity_tier == "medium": baseWeight = 1.0
    elif obligation.severity_tier == "low": baseWeight = 0.5
    return baseWeight
```

### Algorithm 5: Threshold Monitoring with Hysteresis

```
function monitorThreshold(businessId, parameterChange):
    business = businessDB.get(businessId)
    thresholdStates = thresholdStateDB.getAll(businessId)

    for state in thresholdStates:
        thresholdNode = knowledgeGraph.getNode(state.threshold_node_id)
        currentValue = business.getField(thresholdNode.threshold_field)
        state.current_value = currentValue

        previousState = state.state

        // Evaluate activation
        if state.state in ["below", "approaching"]:
            if currentValue >= thresholdNode.threshold_value:
                state.state = "crossed"
                state.first_crossed_at = state.first_crossed_at or today()
                state.last_crossed_at = today()

                // Check if permanent activation
                if thresholdNode.hysteresis_rule.deactivation == "never":
                    state.state = "permanently_activated"
                    state.activation_permanent = true

                // Trigger new obligations
                newObligations = obligationMappingService.getThresholdObligations(
                    thresholdNode.node_id, business
                )
                obligationService.addObligations(businessId, newObligations)

                // Send alert
                notificationService.sendThresholdAlert(
                    businessId, thresholdNode, currentValue, newObligations
                )

            elif currentValue >= thresholdNode.threshold_value * 0.8:
                state.state = "approaching"
                projectedCrossing = projectCrossingDate(business, thresholdNode)
                state.projected_crossing = projectedCrossing

                notificationService.sendApproachingAlert(
                    businessId, thresholdNode, currentValue, projectedCrossing
                )

        // Evaluate deactivation (only for non-permanent thresholds)
        elif state.state == "crossed" and not state.activation_permanent:
            if currentValue < thresholdNode.threshold_value:
                deactRule = thresholdNode.hysteresis_rule.deactivation
                if deactRule.type == "immediate":
                    state.state = "deactivated"
                    obligationService.deactivateThresholdObligations(businessId, thresholdNode)
                elif deactRule.type == "duration":
                    state.state = "deactivation_pending"
                    state.consecutive_months_below += 1
                    if state.consecutive_months_below >= deactRule.duration_months:
                        state.state = "deactivated"
                        obligationService.deactivateThresholdObligations(businessId, thresholdNode)
                elif deactRule.type == "application_required":
                    notificationService.sendDeregistrationReminder(
                        businessId, thresholdNode
                    )
            else:
                state.consecutive_months_below = 0

        thresholdStateDB.save(state)
```

---

## State Machine: Obligation Instance Lifecycle

```
            ┌──────────────┐
            │  not_applicable│◄── threshold not met
            └──────┬───────┘
                   │ threshold crossed
                   ▼
            ┌──────────────┐
      ┌────►│   upcoming    │◄── initial state for applicable obligations
      │     └──────┬───────┘
      │            │ within reminder window
      │            ▼
      │     ┌──────────────┐
      │     │   due_soon    │── notifications active
      │     └──────┬───────┘
      │            │         \
      │            │          └── dependency not met
      │            │               ▼
      │            │         ┌──────────────┐
      │            │         │   blocked     │── waiting for upstream
      │            │         └──────┬───────┘
      │            │                │ dependency resolved
      │            │◄───────────────┘
      │            │
      │            ├── completed before deadline ──► completed
      │            │
      │            │ deadline passed without completion
      │            ▼
      │     ┌──────────────┐
      │     │   overdue     │── penalty accrual starts
      │     └──────┬───────┘
      │            │ filing completed late
      │            ▼
      │     ┌──────────────┐
      │     │   completed   │── with late flag
      │     └──────────────┘
      │
      │ government extension → recompute deadline
      └── waived (explicit exemption)
```

---

## Database Schema Decisions

| Data Store | Technology Choice | Rationale |
|---|---|---|
| **Regulatory Knowledge Graph** | Graph database (property graph model) | Natural representation of regulation hierarchies, amendment chains, and applicability relationships; efficient multi-hop traversal for obligation mapping; temporal queries for point-in-time compliance |
| **Business Profiles** | Relational database | Structured, transactional data with ACID requirements; frequent updates to parameters; complex queries for threshold monitoring |
| **Archetype Cache** | In-memory key-value store with disk persistence | O(1) lookup for archetype matching; invalidation on regulatory changes; small enough to fit in memory (~200 archetypes × 10 KB each) |
| **Document Vault** | Object storage with metadata in relational DB | Content-addressed blob storage for documents; metadata (classification, extracted fields) in relational DB for querying; separation enables independent scaling |
| **Compliance Deadlines** | Relational database with time-series optimization | Deadline queries are time-range heavy ("all deadlines in next 30 days"); partitioned by due_date for efficient range scans |
| **Notification Queue** | Message queue with scheduled delivery | Decouples notification generation from delivery; supports scheduled future delivery; retry semantics for failed deliveries |
| **Search Index** | Full-text search engine | Document vault search across OCR text, extracted fields, and regulatory text; faceted search by regulation, period, document type |
| **Notification History** | Append-only time-series store | High write volume (8M/day); queries primarily by business_id + time range; append-only nature suits time-series storage |
| **Holiday Calendar** | Relational database (reference data) | Small dataset (~2,000 entries/year); multi-key lookups (date + jurisdiction + authority); updated annually |
| **Threshold State** | Relational database | Per-business state machine; frequent reads/writes during threshold monitoring; ACID for state transitions |

---

## Indexing Strategy

| Table/Collection | Index | Purpose |
|---|---|---|
| ObligationInstance | `(business_id, status, due_date)` | Calendar queries: "all upcoming obligations for business X" |
| ObligationInstance | `(due_date, status)` | Notification generator: "all obligations due in next 7 days" |
| ObligationInstance | `(regulation_node_id, status)` | Impact analysis: "all instances of regulation Y" |
| ComplianceDocument | `(business_id, regulation_node_id, assessment_period)` | Audit readiness: "all GST docs for business X in 2024-25" |
| ComplianceDocument | `(content_hash_sha256)` | Deduplication and integrity verification |
| NotificationRecord | `(business_id, obligation_id, scheduled_at)` | Reconciliation: "was this obligation's reminder sent?" |
| NotificationRecord | `(scheduled_at, delivery_status)` | Dispatch queue processing |
| ThresholdState | `(business_id, state)` | Dashboard: "all approaching thresholds for business X" |
| BusinessProfile | `(archetype_id)` | Propagation: "all businesses in archetype Y" |
| HolidayEntry | `(date, jurisdiction, affects_deadlines)` | Deadline computation: "is this date a holiday?" |
