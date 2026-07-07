# 14.16 AI-Native ONDC Commerce Platform — Low-Level Design

## Core Data Models

### Beckn Context Object

The context object is present in every Beckn protocol message and establishes the transaction identity.

```
BecknContext:
  domain:           string          # "ONDC:RET10" (grocery), "ONDC:RET12" (fashion), etc.
  country:          string          # "IND"
  city:             string          # "std:080" (Bangalore), "std:011" (Delhi)
  action:           enum            # search | select | init | confirm | status | track | cancel | update | rating | support
  core_version:     string          # "1.2.5"
  bap_id:           string          # Buyer app subscriber ID (registered in ONDC registry)
  bap_uri:          string          # Buyer app callback URI
  bpp_id:           string          # Seller app subscriber ID
  bpp_uri:          string          # Seller app callback URI
  transaction_id:   string(UUID)    # Unique ID for the entire transaction lifecycle
  message_id:       string(UUID)    # Unique ID for this specific request-callback pair
  timestamp:        ISO8601         # Message creation timestamp
  ttl:              ISO8601Duration # Time-to-live for the message (e.g., "PT30S")
  key:              string          # Encryption public key (for encrypted payloads)
```

### Catalog Item Model

```
CatalogItem:
  id:               string(UUID)    # Platform-internal item ID
  beckn_item_id:    string          # Beckn-protocol item identifier
  seller_id:        string(UUID)    # Reference to seller
  seller_np_id:     string          # Seller NP subscriber ID

  # Product core
  name:             string          # Product name (max 200 chars)
  short_desc:       string          # Short description (max 500 chars)
  long_desc:        string          # Detailed description (max 5000 chars)
  category_id:      string          # ONDC taxonomy category ID
  category_path:    string[]        # Full category hierarchy ["Fashion", "Men", "Shirts", "Casual"]
  hsn_code:         string          # Harmonized System Nomenclature code for GST

  # AI-enriched fields
  ai_generated:     boolean         # Whether descriptions were AI-generated
  ai_category_confidence: float     # Confidence score for category mapping (0-1)
  ai_attributes:    Map<string, string>  # Extracted attributes (color, material, size, etc.)
  embedding_vector: float[384]      # Semantic embedding for cross-lingual search
  quality_score:    float           # Catalog completeness/quality score (0-100)

  # Pricing
  price:            Money           # { value: decimal, currency: "INR" }
  max_price:        Money           # Maximum price (for variable pricing)
  price_breakup:    PriceBreakup[]  # Tax, packaging, delivery charge breakdown

  # Inventory
  quantity_available: integer       # Current stock count
  quantity_maximum:   integer       # Maximum orderable quantity
  is_available:     boolean         # Explicitly marked available/unavailable

  # Fulfillment
  fulfillment_ids:  string[]        # Supported fulfillment modes
  location_ids:     string[]        # Seller locations that can fulfill
  serviceability:   Serviceability  # Geographic serviceability definition

  # Media
  images:           Image[]         # { url, size_variant, alt_text }

  # Metadata
  created_at:       timestamp
  updated_at:       timestamp
  catalog_version:  integer         # Optimistic concurrency version
  language:         string          # Original catalog language ("hi", "en", "ta", etc.)
  translations:     Map<string, TranslatedFields>  # Translated name, descriptions per language
```

### Order State Machine

```
OrderStateMachine:
  states:
    CREATED         # Buyer selected items (select received)
    QUOTED          # Seller provided quote (on_select sent)
    INITIALIZED     # Buyer provided billing/shipping (init received)
    READY           # Seller confirmed logistics and final quote (on_init sent)
    CONFIRMED       # Payment verified, order confirmed (confirm/on_confirm)
    PACKED          # Seller packed the order
    PICKUP_PENDING  # Logistics assigned, awaiting pickup
    PICKED_UP       # Logistics picked up from seller
    IN_TRANSIT      # In logistics transit
    OUT_FOR_DELIVERY # Last-mile delivery in progress
    DELIVERED       # Successfully delivered
    COMPLETED       # Post-delivery window passed; settlement eligible
    CANCELLED       # Order cancelled (pre-fulfillment)
    RETURN_INITIATED # Buyer initiated return
    RETURN_PICKED   # Return pickup completed
    RETURN_DELIVERED # Return received by seller
    REFUNDED        # Refund processed

  transitions:
    CREATED         -> QUOTED           on: on_select received
    QUOTED          -> INITIALIZED      on: init received
    INITIALIZED     -> READY            on: on_init sent
    READY           -> CONFIRMED        on: confirm received + payment verified
    CONFIRMED       -> PACKED           on: seller marks packed
    CONFIRMED       -> CANCELLED        on: cancel received (pre-ship)
    PACKED          -> PICKUP_PENDING   on: logistics confirmed
    PICKUP_PENDING  -> PICKED_UP        on: logistics on_status (picked_up)
    PICKED_UP       -> IN_TRANSIT       on: logistics on_status (in_transit)
    IN_TRANSIT      -> OUT_FOR_DELIVERY on: logistics on_status (out_for_delivery)
    OUT_FOR_DELIVERY -> DELIVERED       on: logistics on_status (delivered)
    DELIVERED       -> COMPLETED        on: return_window_expired (auto, 7 days)
    DELIVERED       -> RETURN_INITIATED on: buyer raises return
    RETURN_INITIATED -> RETURN_PICKED   on: reverse logistics pickup
    RETURN_PICKED   -> RETURN_DELIVERED on: return received
    RETURN_DELIVERED -> REFUNDED        on: refund processed
    CANCELLED       -> REFUNDED        on: refund processed (if prepaid)

  timeout_rules:
    CREATED -> auto_cancel:      30 minutes (no on_select)
    QUOTED -> auto_cancel:       15 minutes (no init)
    INITIALIZED -> auto_cancel:  10 minutes (no on_init)
    READY -> auto_cancel:        30 minutes (no confirm)
    CONFIRMED -> escalate:       24 hours (no packed status)
    PICKUP_PENDING -> reassign:  4 hours (logistics no-show)
```

### Order Record

```
Order:
  id:               string(UUID)
  transaction_id:   string(UUID)    # Beckn transaction ID
  network_order_id: string          # ONDC-assigned order ID

  # Participants
  buyer_np_id:      string          # BAP subscriber ID
  seller_np_id:     string          # BPP subscriber ID
  seller_id:        string(UUID)    # Internal seller reference
  logistics_np_id:  string          # Logistics NP subscriber ID (nullable)

  # Order details
  items:            OrderItem[]     # { item_id, quantity, price, fulfillment_id }
  billing:          BillingInfo     # { name, phone, email, address, gst_number }
  fulfillment:      Fulfillment     # { type, tracking, delivery_address, estimated_delivery }

  # Financial
  quote:            Quote           # { price, breakup: [item, tax, delivery, packing] }
  payment:          Payment         # { type, status, transaction_id, settlement_details }
  settlement_status: enum           # PENDING | PARTIAL | SETTLED | DISPUTED

  # State
  state:            OrderState      # Current state from state machine
  state_history:    StateTransition[] # [{from, to, timestamp, trigger, actor}]

  # Protocol audit
  message_log:      MessageRef[]    # References to signed protocol messages

  # Timestamps
  created_at:       timestamp
  confirmed_at:     timestamp
  delivered_at:     timestamp
  completed_at:     timestamp
```

### Trust Score Model

```
TrustScore:
  np_id:            string          # Network participant ID
  seller_id:        string(UUID)    # Specific seller (for seller NPs)

  # Dimension scores (0-100)
  fulfillment_score:    float       # Order completion rate, on-time delivery
  quality_score:        float       # Return rate, "not as described" complaints
  responsiveness_score: float       # Protocol response latency, grievance resolution speed
  compliance_score:     float       # Schema adherence, protocol version currency
  payment_score:        float       # Settlement reliability, refund timeliness
  catalog_score:        float       # Catalog completeness, accuracy, freshness

  # Composite
  composite_score:      float       # Weighted aggregate of dimension scores
  confidence_level:     float       # Based on sample size (higher orders = higher confidence)

  # Temporal
  score_window:         string      # "30d" — trailing window for computation
  computed_at:          timestamp
  version:              integer     # Score version for change tracking

  # Anti-gaming
  anomaly_flags:        string[]    # ["rapid_order_spike", "review_pattern_suspicious"]
  manual_override:      float       # Admin-imposed adjustment (nullable)

  # Computation inputs
  total_orders:         integer     # Orders in window
  fulfilled_orders:     integer
  cancelled_orders:     integer
  returned_orders:      integer
  avg_delivery_delta:   duration    # Avg(actual_delivery - promised_delivery)
  grievance_count:      integer
  avg_grievance_resolution: duration
  protocol_error_rate:  float       # % of protocol messages with schema violations
```

---

## Settlement Algorithm

### Multi-Party Settlement Flow

Each ONDC transaction involves settlement across multiple parties:

```
SettlementComputation:
  input:
    order:            Order
    order_amount:     Money         # Total order value (paid by buyer)
    payment_method:   enum          # UPI | CARD | COD | WALLET

  computation:
    # Step 1: GST computation
    item_gst = sum(item.price * item.gst_rate for item in order.items)
    total_with_gst = order_amount  # GST is inclusive in listed price

    # Step 2: Commission splits
    buyer_np_commission = order_amount * buyer_np_commission_rate   # Typically 2-5%
    seller_np_commission = order_amount * seller_np_commission_rate # Typically 3-8%
    ondc_network_fee = order_amount * 0.001                        # 0.1% network fee

    # Step 3: Logistics cost
    logistics_charge = order.fulfillment.logistics_quote
    logistics_gst = logistics_charge * 0.18                         # 18% GST on logistics

    # Step 4: Tax deduction at source
    tcs_amount = order_amount * 0.01    # 1% TCS under Section 52 of CGST Act
    tds_amount = seller_np_commission * 0.01  # 1% TDS if applicable

    # Step 5: Seller payout
    seller_payout = order_amount
                    - buyer_np_commission
                    - seller_np_commission
                    - ondc_network_fee
                    - logistics_charge
                    - tcs_amount

  settlement_timeline:
    digital_payment:  T+1 business day (buyer NP → collector → settlement to all parties)
    cod_payment:      T+3 business days (logistics NP collects → remits → settlement)
    refund:           T+5 business days (reverse flow)

  reconciliation:
    # Daily reconciliation job
    for each order settled today:
      verify: sum(all_party_payouts) == order_amount
      verify: gst_collected == gst_reported_to_gstn
      verify: tcs_deducted == tcs_reported_to_income_tax
      flag_discrepancy if any verification fails
```

### Settlement State Machine

```
SettlementStateMachine:
  PENDING          # Order confirmed, awaiting delivery
  DELIVERY_CONFIRMED  # Delivery verified, settlement eligible
  COMPUTATION_DONE    # Settlement amounts computed for all parties
  BUYER_NP_SETTLED    # Buyer NP commission settled
  SELLER_NP_SETTLED   # Seller NP commission settled
  LOGISTICS_SETTLED   # Logistics charges settled
  NETWORK_FEE_SETTLED # ONDC network fee settled
  SELLER_PAID         # Seller payout completed
  RECONCILED          # All amounts verified and reconciled
  DISPUTED            # Discrepancy detected, under investigation
```

---

## API Contracts (Internal)

### Catalog Enrichment API

```
POST /internal/catalog/enrich

Request:
  seller_id:        string(UUID)
  items:            RawCatalogItem[]   # Seller's raw product data
    - name:         string             # Raw product name
    - description:  string             # Raw description (may be empty)
    - images:       string[]           # Image URLs
    - price:        decimal
    - category_hint: string            # Seller's category (free-form)
    - attributes:   Map<string, string> # Raw attributes

Response:
  enriched_items:   EnrichedItem[]
    - original_id:    string
    - enriched_name:  string           # AI-improved product name
    - short_desc:     string           # AI-generated short description
    - long_desc:      string           # AI-generated detailed description
    - category_id:    string           # Mapped ONDC category
    - category_confidence: float
    - hsn_code:       string           # Inferred HSN code
    - extracted_attributes: Map<string, string>  # AI-extracted attributes
    - quality_score:  float
    - issues:         ValidationIssue[] # Schema compliance issues
    - translations:   Map<string, TranslatedFields>

  processing_time_ms: integer
```

### Federated Search API

```
POST /internal/search/federated

Request:
  query:            string             # Natural language or structured query
  location:         GeoPoint           # Buyer's location
  category:         string             # Category filter (optional)
  filters:          Map<string, string> # Attribute filters
  sort_by:          enum               # RELEVANCE | PRICE_LOW | PRICE_HIGH | RATING | DELIVERY_SPEED
  page:             integer
  page_size:        integer
  buyer_context:    BuyerContext        # History, preferences for personalization

Response:
  results:          SearchResult[]
    - item:           CatalogItem
    - seller_trust:   float            # Composite trust score
    - relevance:      float            # AI relevance score
    - delivery_estimate: Duration      # Estimated delivery time
    - source_np:      string           # Seller NP that provided this result
    - price_freshness: timestamp       # When price was last confirmed

  total_count:      integer
  aggregations:     Map<string, Facet[]> # Category, price range, brand facets
  query_latency_ms: integer
  np_response_stats: NPResponseStat[]  # Which NPs responded, latency per NP
```

### Trust Score API

```
GET /internal/trust/score/{np_id}?seller_id={seller_id}

Response:
  composite_score:    float
  dimensions:
    fulfillment:      { score: float, sample_size: integer, trend: string }
    quality:          { score: float, sample_size: integer, trend: string }
    responsiveness:   { score: float, sample_size: integer, trend: string }
    compliance:       { score: float, sample_size: integer, trend: string }
    payment:          { score: float, sample_size: integer, trend: string }
    catalog:          { score: float, sample_size: integer, trend: string }
  confidence:         float
  anomaly_flags:      string[]
  computed_at:        timestamp
  order_volume_30d:   integer
```

---

## Cross-Lingual Search Pipeline

```
CrossLingualSearchPipeline:
  input: buyer_query (any of 22 Indian languages)

  step_1_language_detection:
    detected_language = detect_language(buyer_query)
    # Output: "hi" (Hindi), "ta" (Tamil), "en" (English), etc.

  step_2_query_embedding:
    query_vector = multilingual_encoder.encode(buyer_query)
    # Uses multilingual model trained on Indian language corpus
    # Output: float[384] dense vector

  step_3_approximate_index_search:
    candidate_items = vector_index.search(
      query_vector,
      top_k=500,
      filters={location: buyer_location, category: category_filter}
    )
    # Searches pre-computed item embeddings regardless of source language

  step_4_reranking:
    for each candidate in candidate_items:
      relevance_score = cross_encoder.score(buyer_query, candidate.name + candidate.description)
      trust_boost = candidate.seller_trust_score * 0.15
      freshness_boost = recency_score(candidate.updated_at) * 0.05
      delivery_boost = delivery_speed_score(candidate, buyer_location) * 0.10
      final_score = relevance_score * 0.70 + trust_boost + freshness_boost + delivery_boost

    ranked_results = sort(candidates, by=final_score, descending=True)[:page_size]

  step_5_response_translation:
    if detected_language != "en":
      for result in ranked_results:
        if result.translations[detected_language] exists:
          use cached translation
        else:
          result.display_name = translate(result.name, target=detected_language)
          result.display_desc = translate(result.short_desc, target=detected_language)

    return ranked_results
```

---

## Fraud Detection Signals

```
FraudSignalMatrix:
  seller_signals:
    - catalog_inflation:      Sudden 10× increase in catalog size within 24 hours
    - price_manipulation:     Listing high price, immediately "discounting" to normal
    - fake_order_patterns:    Orders from related buyer accounts (device/IP clustering)
    - fulfillment_gaming:     Marking delivered without logistics tracking confirmation
    - category_misuse:        Listing items in wrong category for visibility

  buyer_signals:
    - return_abuse:           Return rate > 40% over trailing 30 orders
    - address_anomaly:        Multiple orders to different addresses from same account
    - payment_cycling:        Repeated failed payments followed by COD selection
    - review_manipulation:    Positive reviews from accounts with no purchase history

  network_signals:
    - collusion_detection:    Buyer NP and seller NP with statistically improbable order volumes
    - wash_trading:           Circular orders between related entities
    - protocol_abuse:         NP sending malformed messages to trigger error-handling bugs

  detection_algorithm:
    risk_score = weighted_sum(
      catalog_inflation_score * 0.15,
      price_manipulation_score * 0.15,
      fake_order_score * 0.20,
      fulfillment_gaming_score * 0.20,
      historical_trust_score * 0.15,
      network_anomaly_score * 0.15
    )

    action_thresholds:
      risk_score < 30:   ALLOW (normal processing)
      risk_score 30-60:  FLAG (additional verification, human review queue)
      risk_score 60-80:  RESTRICT (limit order volume, require prepayment only)
      risk_score > 80:   SUSPEND (temporary suspension, notify ONDC)
```

---

## WhatsApp Conversational Commerce State Machine

```
WhatsAppSessionModel:
  session_id:         string(UUID)
  waba_phone:         string          # WhatsApp Business Account phone number
  buyer_phone:        string          # Buyer's WhatsApp number (hashed for storage)

  # Conversation state
  state:              enum
    IDLE              # No active conversation
    DISCOVERY         # Buyer describing what they want
    BROWSING          # Showing catalog results
    SELECTING         # Buyer choosing specific item(s)
    CART_BUILDING     # Adding items to cart (maps to Beckn select)
    CHECKOUT          # Collecting billing/shipping (maps to Beckn init)
    PAYMENT           # Awaiting payment completion (maps to Beckn confirm)
    ORDER_ACTIVE      # Order confirmed, tracking updates
    SUPPORT           # Post-purchase support/grievance

  # Beckn protocol mapping
  transaction_id:     string(UUID)    # Active Beckn transaction (nullable)
  cart_items:         CartItem[]      # { item_id, seller_np_id, quantity, price }
  delivery_address:   Address         # Saved or collected during session
  payment_method:     enum            # UPI_INTENT | UPI_COLLECT | COD

  # Conversation context
  language:           string          # Detected buyer language ("hi", "ta", "en")
  intent_history:     Intent[]        # [{query, interpreted_category, confidence, timestamp}]
  result_set:         SearchResult[]  # Current displayed results (for "show cheaper" refinement)
  message_history:    Message[]       # Last 20 messages for context (rolling window)

  # Session management
  created_at:         timestamp
  last_activity:      timestamp
  expires_at:         timestamp       # 24-hour WhatsApp session window
  handoff_to_human:   boolean         # AI escalated to human support

StateTransitions:
  IDLE -> DISCOVERY:         on: buyer sends any message
  DISCOVERY -> BROWSING:     on: AI maps intent to search query
  BROWSING -> SELECTING:     on: buyer taps carousel item or says "show me more about #2"
  SELECTING -> CART_BUILDING: on: buyer confirms item selection ("add this")
  CART_BUILDING -> CHECKOUT: on: buyer says "order" / "checkout" / "done adding"
  CHECKOUT -> PAYMENT:       on: address confirmed, UPI link generated
  PAYMENT -> ORDER_ACTIVE:   on: payment confirmed (Beckn on_confirm received)
  ORDER_ACTIVE -> SUPPORT:   on: buyer raises issue post-delivery

  # Lateral transitions
  BROWSING -> DISCOVERY:     on: buyer changes intent ("actually show me rice instead")
  CART_BUILDING -> BROWSING: on: buyer wants to add more items
  any -> IDLE:               on: session timeout (30 min inactivity) or buyer says "bye"
```

### WhatsApp NLU Intent Mapping

```
IntentClassification:

  input: buyer_message (any Indian language, potentially code-mixed)

  step_1_language_detection:
    language = detect_language(buyer_message)
    # Handle code-mixing: "mujhe 5kg atta chahiye near MG Road"
    # Detected as: primary=Hindi, mixed=English (location reference)

  step_2_intent_classification:
    intents:
      PRODUCT_SEARCH:    "show me rice" / "दाल दिखाओ" / "arisi vendum"
      REFINE_RESULTS:    "cheaper one" / "bigger size" / "different brand"
      ADD_TO_CART:       "add this" / "yeh le lo" / "ok, this one"
      CHECK_PRICE:       "kitna hai" / "price?" / "how much"
      ORDER_STATUS:      "where is my order" / "mera order kahan hai"
      HELP:              "help" / "problem" / "speak to someone"
      GREETING:          "hi" / "namaste" / "hello"
      CANCEL:            "cancel" / "don't want" / "nahi chahiye"

  step_3_entity_extraction:
    entities:
      product_type:      "atta" → Wheat Flour
      quantity:          "5kg" → { value: 5, unit: "kg" }
      brand:             "Aashirvaad" → brand filter
      location:          "MG Road" → delivery address hint
      price_range:       "under 500" → { max: 500, currency: "INR" }

  step_4_beckn_query_construction:
    search_intent = {
      category: map_to_ondc_category(product_type),
      fulfillment: { type: "Delivery", end: { location: buyer_location } },
      filters: { quantity, brand, price_range },
      language: language
    }
```

---

## Seller Onboarding Pipeline Model

```
SellerOnboardingPipeline:
  seller_id:          string(UUID)
  onboarding_state:   enum
    REGISTERED        # Basic info collected (name, phone, business type)
    KYC_INITIATED     # e-KYC flow started
    KYC_VERIFIED      # Aadhaar e-KYC completed successfully
    DOCUMENTS_PENDING # GST/FSSAI verification in progress
    DOCUMENTS_VERIFIED # All regulatory documents verified
    CATALOG_CREATION  # Seller creating product catalog
    CATALOG_REVIEW    # AI validating catalog against ONDC schemas
    SANDBOX_TESTING   # Running test transactions in sandbox
    LIVE              # Active on ONDC network
    SUSPENDED         # Temporarily suspended (compliance issue)

  # Identity verification
  kyc_result:
    method:           enum            # AADHAAR_OTP | AADHAAR_BIOMETRIC
    status:           enum            # PENDING | SUCCESS | FAILED
    vid_hash:         string          # Hashed Virtual ID (no raw Aadhaar stored)
    verified_name:    string          # Name from e-KYC
    verified_at:      timestamp

  # Document verification
  documents:
    gst_certificate:
      number:         string          # GSTIN
      status:         enum            # PENDING | VALID | EXPIRED | CANCELLED
      verified_via:   "DigiLocker"
      active_on_gstn: boolean         # Real-time GSTN validation
    fssai_license:                    # Required for food category
      number:         string
      valid_until:    date
      verified_via:   "DigiLocker"
    shop_license:                     # State-specific shop establishment license
      number:         string
      issuing_authority: string

  # Catalog readiness
  catalog_stats:
    total_items:      integer
    ai_generated:     integer         # Items with AI-generated descriptions
    schema_compliant: integer         # Items passing ONDC schema validation
    issues_pending:   integer         # Items with unresolved validation issues
    quality_score:    float           # Average catalog quality score (0-100)

  # ONDC registration
  np_registration:
    subscriber_id:    string          # Assigned by ONDC after registration
    subscriber_url:   string          # Platform callback URL
    signing_key_id:   string          # Public key registered with ONDC
    supported_domains: string[]       # ["ONDC:RET10", "ONDC:RET11"]
    city_coverage:    string[]        # ["std:080", "std:011", ...]
```

---

## Logistics Orchestration Model

```
LogisticsOrchestrator:

  LogisticsSearch:
    order_id:           string(UUID)
    origin:             GeoPoint        # Seller location
    destination:        GeoPoint        # Buyer delivery address
    package:
      weight_grams:     integer
      dimensions:       { length_cm, width_cm, height_cm }
      category:         enum            # FOOD | FRAGILE | STANDARD | HAZARDOUS
      requires_cold_chain: boolean

    fulfillment_type:   enum
      HYPERLOCAL        # < 3 km, immediate delivery (30-60 min)
      SAME_DAY          # Same city, slotted delivery (4-8 hours)
      NEXT_DAY          # Same city or nearby, next business day
      INTERCITY         # Cross-city, 2-5 business days
      STORE_PICKUP      # Buyer picks up from seller location

  LogisticsQuoteAggregation:
    # Broadcast logistics search to ONDC logistics network
    lsp_responses:      LSPQuote[]
      - lsp_np_id:      string
      - price:          Money
      - estimated_pickup: timestamp
      - estimated_delivery: timestamp
      - tracking_supported: boolean
      - insurance_included: boolean
      - cod_supported:  boolean
      - response_latency_ms: integer

    # AI-powered LSP selection
    selection_algorithm:
      score = weighted_sum(
        price_competitiveness * 0.25,
        delivery_speed * 0.25,
        lsp_trust_score * 0.20,
        tracking_reliability * 0.15,
        historical_sla_adherence * 0.15
      )

    selected_lsp:       string          # NP ID of chosen LSP
    fallback_lsp:       string          # Second-choice for failover

  LogisticsFailover:
    trigger: Pickup not completed within SLA window (default: 4 hours)
    action:
      1. Send cancel to current LSP via protocol
      2. Re-broadcast logistics search
      3. Select new LSP (exclude failed LSP)
      4. Send confirm to new LSP
      5. Notify seller of LSP change
      6. Update order tracking to reflect new LSP
      7. Record failover event for trust scoring
```

---

## India Stack Integration Models

```
IndiaStackConnectors:

  AadhaarEKYC:
    flow:
      1. Seller initiates KYC on platform
      2. Platform generates OTP request to UIDAI via registered ASA
      3. Seller enters OTP received on Aadhaar-linked mobile
      4. ASA verifies OTP with UIDAI
      5. ASA returns: { success, name, dob, gender, address, virtual_id }
      6. Platform stores: { seller_id, kyc_status, vid_hash, verified_at }
      7. Raw Aadhaar data purged from memory (never persisted to disk)

    rate_limits:
      max_requests:     10 per second (ASA-level)
      retry_policy:     Exponential backoff, max 3 retries
      daily_cap:        10,000 verifications per ASA agreement

  DigiLockerDocumentPull:
    flow:
      1. Seller grants consent for document pull (on-screen authorization)
      2. Platform calls DigiLocker API with seller's linked DigiLocker ID
      3. DigiLocker returns verified document (GST certificate, FSSAI license)
      4. Platform validates: document matches seller's registered details
      5. AI extracts key fields: GSTIN, license number, validity dates
      6. Cross-validates GSTIN against GSTN active status API

    documents_supported:
      - GST Registration Certificate (GSTIN)
      - FSSAI License (Food Safety)
      - Drug License (Pharmaceutical)
      - Shop & Establishment License (state-specific)
      - PAN Card (for TDS/TCS compliance)

  UPIPaymentIntegration:
    collect_flow:
      1. Platform generates UPI collect request via PSP
      2. Buyer receives notification on UPI app
      3. Buyer approves payment with UPI PIN
      4. PSP confirms payment to platform
      5. Platform records payment → sends Beckn confirm

    intent_flow:
      1. Platform generates UPI intent URI: upi://pay?pa={vpa}&pn={name}&am={amount}&tr={txn_id}
      2. URI embedded in WhatsApp message as clickable link
      3. Buyer taps link → UPI app opens with pre-filled details
      4. Buyer confirms with UPI PIN
      5. Callback to platform with payment confirmation

    reconciliation:
      - Each UPI transaction generates a unique UTR (UPI Transaction Reference)
      - UTR mapped to Beckn transaction_id for settlement tracking
      - Daily reconciliation: platform UTRs vs. PSP settlement report

  AccountAggregator:
    purpose: Assess seller creditworthiness for COD advance feature
    flow:
      1. Seller grants consent (AA consent framework — purpose-limited, time-bound)
      2. Platform requests financial data from seller's bank via AA
      3. AA returns: bank statements (3-6 months), balance history
      4. AI computes creditworthiness score: { avg_balance, income_stability, existing_liabilities }
      5. Score used to determine COD advance percentage (0-80%)
    constraints:
      - Consent must be explicit, granular, and revocable
      - Data retained only for the consented purpose and duration
      - Re-consent required for each new data fetch cycle
```

---

## Catalog Enrichment Pipeline (Detailed)

```
CatalogEnrichmentPipeline:

  Stage 1: Image Analysis
    input: product_images[] (raw uploads from seller)
    processing:
      - Object detection: identify primary product in cluttered background
      - Background removal: isolate product for clean display
      - Attribute extraction from packaging:
        - Brand name (OCR on label)
        - Weight/volume (OCR: "5kg", "1L")
        - MRP (OCR: "₹299")
        - Ingredients list (OCR, for food category compliance)
      - Image quality scoring: { resolution, clarity, background_cleanliness }
    output: enriched_images[], extracted_attributes{}

  Stage 2: Category Mapping
    input: seller-provided category_hint, extracted_attributes, product_name
    processing:
      - Text classification against ONDC taxonomy (5,000+ nodes)
      - Multi-signal mapping:
        - Seller's free-form category → nearest ONDC node (fuzzy match)
        - Product name → category via trained classifier
        - Extracted attributes (weight unit, ingredients) → category refinement
      - Confidence calibration:
        - confidence > 0.95: auto-assign category
        - confidence 0.70-0.95: assign with "review recommended" flag
        - confidence < 0.70: require manual seller confirmation
    output: category_id, category_path[], confidence_score

  Stage 3: HSN Code Assignment
    input: category_id, product_name, extracted_attributes
    processing:
      - Map ONDC category to HSN code using maintained lookup table
      - For ambiguous cases (e.g., "cotton shirt" could be HSN 6105 or 6109
        depending on whether it's knitted or woven):
        - Use product description attributes to disambiguate
        - Cross-reference with seller's existing GST filings if available
      - Validate HSN code format (4-digit or 8-digit per GST requirements)
    output: hsn_code, gst_rate (5%, 12%, 18%, or 28%)

  Stage 4: Description Generation
    input: product_name, extracted_attributes, images, category
    processing:
      - Generate structured product title:
        template: "{Brand} {Product Type} {Key Attribute} {Size/Quantity}"
        example: "Aashirvaad Whole Wheat Atta 5kg"
      - Generate short description (max 500 chars):
        Focus on key differentiators and buyer-relevant attributes
      - Generate long description (max 5000 chars):
        Include all extracted attributes, care instructions, usage suggestions
      - Generate in buyer's preferred language (default: English + Hindi)
    output: title, short_desc, long_desc, translations{}

  Stage 5: Schema Validation
    input: complete enriched catalog item
    processing:
      - Validate against ONDC domain-specific schema (grocery vs. fashion vs. electronics)
      - Required field check (varies by domain):
        - Grocery: weight, shelf_life, fssai_license
        - Fashion: size, color, material, care_instructions
        - Electronics: warranty, power_rating, model_number
      - Auto-correction for common errors:
        - Price format: "299" → { value: 299.00, currency: "INR" }
        - Weight format: "5 kg" → { value: 5000, unit: "gram" }
        - Missing MRP: Estimate from category average (flagged for seller review)
    output: validated_item, issues[], auto_corrections[]
```
