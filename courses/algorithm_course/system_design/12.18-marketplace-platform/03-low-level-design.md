# 12.18 Marketplace Platform — Low-Level Design

## Core Data Models

### Listing

```
Listing {
  listing_id:          UUID (PK)
  seller_id:           UUID (FK → User)
  title:               string (max 140 chars)
  description:         text (max 5,000 chars)
  category_path:       string[]  // ["Electronics", "Cameras", "DSLRs"]
  price_cents:         int
  currency:            string (ISO 4217)
  quantity:            int
  quantity_reserved:   int  // sum of active soft reserves
  quantity_sold:       int
  condition:           enum (new | like_new | good | fair | parts_only)
  photo_ids:           UUID[]  // references to object storage
  shipping_options:    ShippingOption[]
  location:            GeoPoint
  tags:                string[]
  state:               enum (draft | pending_review | active | sold | expired | suspended)
  trust_flags:         string[]  // ["counterfeit_suspected", "price_anomaly"]
  created_at:          timestamp
  activated_at:        timestamp
  sold_at:             timestamp (nullable)
  version:             int  // optimistic concurrency control
}

ShippingOption {
  carrier:             string
  service_level:       string
  price_cents:         int
  estimated_days_min:  int
  estimated_days_max:  int
  ships_from_country:  string
}
```

### Order

```
Order {
  order_id:            UUID (PK)
  buyer_id:            UUID (FK → User)
  seller_id:           UUID (FK → User)
  listing_id:          UUID (FK → Listing)
  listing_snapshot:    JSON  // immutable copy at order time
  quantity:            int
  item_price_cents:    int
  shipping_price_cents: int
  tax_cents:           int
  total_cents:         int
  platform_fee_cents:  int   // take rate applied
  seller_net_cents:    int   // total - fee - processing_fee - tax_remittance
  state:               enum (pending_payment | paid | shipped | delivered | completed | disputed | refunded | cancelled)
  payment_token:       string  // tokenized payment reference
  escrow_id:           UUID (FK → EscrowRecord)
  tracking_number:     string (nullable)
  carrier:             string (nullable)
  shipped_at:          timestamp (nullable)
  delivered_at:        timestamp (nullable)
  protection_expires_at: timestamp  // buyer protection window end
  created_at:          timestamp
}
```

### EscrowRecord

```
EscrowRecord {
  escrow_id:         UUID (PK)
  order_id:          UUID (FK → Order)
  buyer_id:          UUID
  seller_id:         UUID
  held_amount_cents: int
  currency:          string
  state:             enum (holding | released_to_seller | refunded_to_buyer | partially_refunded)
  hold_reason:       string  // "standard" | "new_seller" | "dispute_pending" | "fraud_review"
  release_trigger:   enum (delivery_confirmed | protection_expired | dispute_resolved | manual_override)
  created_at:        timestamp
  released_at:       timestamp (nullable)
  events:            EscrowEvent[]  // append-only log of all state changes
}

EscrowEvent {
  event_id:    UUID
  escrow_id:   UUID
  event_type:  enum (held | hold_extended | released | refunded | partially_refunded)
  amount_cents: int
  actor:       string  // "system" | "dispute_service" | "admin"
  reason:      string
  timestamp:   timestamp
}
```

### SellerQualityScore

```
SellerQualityScore {
  seller_id:              UUID (PK)
  overall_score:          float  // 0.0–1.0; normalized composite
  review_score:           float  // recency-weighted avg star rating / 5.0
  review_count:           int
  on_time_shipping_rate:  float  // orders shipped within handling time / total orders
  dispute_rate:           float  // disputes opened / total orders (90-day window)
  response_time_hours:    float  // avg hours to first response on buyer messages
  policy_violation_count: int    // active violations (decay over time)
  trust_tier:             enum (new | standard | trusted | verified_pro)
  payout_hold_days:       int    // derived from trust_tier
  search_boost:           float  // multiplicative modifier applied in ranking (0.5–1.5)
  computed_at:            timestamp
  next_refresh_at:        timestamp  // TTL for async recomputation
  score_version:          int
}
```

### Review

```
Review {
  review_id:     UUID (PK)
  order_id:      UUID (FK → Order; one review per order per direction)
  reviewer_id:   UUID (FK → User)
  reviewee_id:   UUID (FK → User)
  listing_id:    UUID
  direction:     enum (buyer_to_seller | seller_to_buyer)
  rating:        int (1–5)
  title:         string (max 100 chars)
  body:          text (max 1,000 chars)
  photos:        UUID[] (optional)
  fraud_score:   float  // 0.0–1.0; computed async
  fraud_flags:   string[]  // ["velocity_burst", "reviewer_cluster", "unverified_purchase"]
  state:         enum (pending_fraud_check | published | suppressed | removed)
  created_at:    timestamp
  published_at:  timestamp (nullable)
}
```

---

## Search Document Schema

```
SearchDocument {
  listing_id:        string (PK)
  title:             string  (full-text indexed)
  title_tokens:      string[]  (analyzed, stemmed)
  description_excerpt: string  (first 200 chars; full-text indexed)
  category_ids:      string[]  (hierarchical; filter field)
  price_cents:       int  (range filter field)
  currency:          string
  condition:         string  (filter field)
  ships_from:        string  (filter field)
  estimated_delivery_days_min: int  (filter field)
  seller_id:         string
  seller_score:      float  (ranking feature)
  seller_trust_tier: string  (filter field)
  listing_age_hours: int  (freshness signal)
  view_count_7d:     int  (popularity signal)
  click_through_rate_7d: float  (behavioral ranking feature)
  conversion_rate_7d: float  (behavioral ranking feature)
  is_available:      bool  (hard filter: state == active AND quantity > quantity_reserved + quantity_sold)
  title_embedding:   float[384]  (dense vector for semantic ANN search)
  last_indexed_at:   timestamp
}
```

---

## API Contracts

### Search API

```
GET /v1/search

Query parameters:
  q:              string   (keyword query; optional for browse)
  category:       string   (category path filter)
  price_min:      int      (cents)
  price_max:      int      (cents)
  condition:      string[] (multi-select)
  ships_from:     string
  sort:           enum (relevance | price_asc | price_desc | newest | top_rated)
  page_token:     string   (cursor-based pagination)
  limit:          int      (max 48)

Response:
  {
    results: SearchResult[]
    total_estimate: int      (approximate; ±10% acceptable for large result sets)
    next_page_token: string
    search_id: string        (for click/conversion tracking)
    facets: FacetGroup[]     (available filter options with counts)
  }

SearchResult:
  {
    listing_id: string
    title: string
    price_cents: int
    primary_photo_url: string
    seller_id: string
    seller_name: string
    seller_score: float
    seller_trust_tier: string
    shipping_price_cents: int
    estimated_delivery_days: [min, max]
    is_promoted: bool
    rank_position: int
  }
```

### Checkout API

```
POST /v1/checkout/reserve

Request:
  {
    listing_id: string
    quantity:   int
    buyer_id:   string  (from auth token)
  }

Response:
  {
    reservation_id: string
    listing_id: string
    reservation_expires_at: timestamp  // TTL: +10 minutes
    price_snapshot: PriceSnapshot
  }

POST /v1/checkout/complete

Request:
  {
    reservation_id: string
    payment_method_token: string  (tokenized card/wallet reference)
    shipping_option_id: string
    buyer_address: Address
  }

Response:
  {
    order_id: string
    state: "pending_payment" | "paid"
    total_cents: int
    estimated_delivery: [min_date, max_date]
    escrow_id: string
  }
```

### Dispute API

```
POST /v1/orders/{order_id}/disputes

Request:
  {
    reason:       enum (item_not_received | item_not_as_described | damaged | wrong_item | other)
    description:  string (max 2,000 chars)
    evidence:     EvidenceItem[]  // photo uploads, tracking references
  }

Response:
  {
    dispute_id: string
    state: "open"
    auto_resolve_estimate: string  // "within 24 hours" if auto-resolvable
    human_review: bool
    escrow_status: "frozen_pending_resolution"
  }

GET /v1/disputes/{dispute_id}

Response:
  {
    dispute_id: string
    order_id: string
    state: enum (open | pending_seller_response | under_review | resolved_buyer | resolved_seller | escalated)
    resolution: ResolutionDetail (nullable)
    timeline: DisputeEvent[]
    messages: DisputeMessage[]  // mediated communication channel
  }
```

---

## Core Algorithms

### Seller Quality Score Computation

```
FUNCTION compute_seller_quality_score(seller_id, window_days=90):

  // Review component (40% weight)
  recent_reviews = fetch_reviews(seller_id, last_n_days=180)
  review_score = weighted_avg(
    values  = [r.rating for r in recent_reviews],
    weights = [recency_weight(r.created_at) for r in recent_reviews]
  ) / 5.0
  // recency_weight: exponential decay; reviews from past 30 days weight 3×
  // reviews from 31–90 days weight 1.5×; older weight 0.5×

  // Shipping component (25% weight)
  orders = fetch_completed_orders(seller_id, last_n_days=window_days)
  on_time = count(o for o in orders if o.shipped_at <= o.handling_deadline)
  shipping_score = on_time / max(len(orders), 1)

  // Dispute component (20% weight)
  dispute_count = count(disputes opened against seller, last_n_days=window_days)
  dispute_rate = dispute_count / max(len(orders), 1)
  dispute_score = 1.0 - min(dispute_rate * 5, 1.0)
  // 20% dispute rate → score 0.0; 0% → score 1.0

  // Response time component (15% weight)
  avg_response_hours = compute_avg_first_response_time(seller_id, last_n_days=window_days)
  response_score = max(0, 1.0 - (avg_response_hours / 48))
  // 48h response time → score 0.0; instant → score 1.0

  overall = (0.40 * review_score) +
            (0.25 * shipping_score) +
            (0.20 * dispute_score) +
            (0.15 * response_score)

  // Apply policy violation penalty
  violation_penalty = 0.05 * active_violation_count(seller_id)
  overall = max(0, overall - violation_penalty)

  // Map to trust tier
  trust_tier = map_score_to_tier(overall, review_count)
  //   new:          review_count < 10
  //   standard:     overall >= 0.5
  //   trusted:      overall >= 0.75 AND review_count >= 50
  //   verified_pro: overall >= 0.9 AND review_count >= 200

  // Map to search boost
  search_boost = 0.5 + overall  // range: 0.5 to 1.5

  // Map to payout hold days
  payout_hold = {new: 7, standard: 5, trusted: 3, verified_pro: 2}[trust_tier]

  RETURN SellerQualityScore(overall, review_score, shipping_score, dispute_score,
                             response_score, trust_tier, search_boost, payout_hold)
```

### Review Fraud Detection

```
FUNCTION score_review_for_fraud(review_id):
  review = fetch(review_id)
  reviewer = fetch_user(review.reviewer_id)
  seller = fetch_user(review.seller_id)

  signals = {}

  // Signal 1: Verified purchase check (hard gate)
  IF review.order_id NOT IN verified_purchases(reviewer.user_id, seller.user_id):
    signals["unverified_purchase"] = 1.0  // hard flag; auto-suppress

  // Signal 2: Reviewer account age vs. review count
  account_age_days = days_since(reviewer.created_at)
  IF account_age_days < 30 AND reviewer.total_reviews > 5:
    signals["new_account_high_volume"] = 0.8

  // Signal 3: Review velocity burst on this seller
  reviews_last_7d = count_reviews_for_seller(seller.seller_id, last_n_days=7)
  IF reviews_last_7d > 3 * historical_7day_avg(seller.seller_id):
    signals["velocity_burst"] = 0.7

  // Signal 4: IP cluster (same IP subnet as other recent reviewers)
  recent_reviewer_ips = fetch_reviewer_ips(seller.seller_id, last_n_days=30)
  IF ip_subnet(reviewer.last_login_ip) IN cluster(recent_reviewer_ips, threshold=5):
    signals["ip_cluster"] = 0.85

  // Signal 5: Reviewer-seller social graph distance
  graph_distance = shortest_path(reviewer.user_id, seller.seller_id, social_graph)
  IF graph_distance <= 2:  // connected via messaging or shared purchases
    signals["close_graph_distance"] = 0.6

  // Signal 6: Review text similarity to existing reviews
  embedding = embed(review.body)
  similarity = max_cosine_similarity(embedding, recent_review_embeddings(seller.seller_id))
  IF similarity > 0.92:
    signals["near_duplicate_text"] = 0.75

  // Composite fraud score (max of signals, weighted)
  fraud_score = weighted_combination(signals)

  IF "unverified_purchase" IN signals:
    state = "suppressed"
  ELIF fraud_score > 0.7:
    state = "pending_human_review"
  ELSE:
    state = "published"

  RETURN (fraud_score, signals, state)
```

### Inventory Reservation (Optimistic Concurrency)

```
FUNCTION reserve_listing(listing_id, quantity, buyer_id):

  MAX_RETRIES = 3
  FOR attempt IN 1..MAX_RETRIES:
    listing = fetch_with_version(listing_id)

    available = listing.quantity - listing.quantity_reserved - listing.quantity_sold
    IF available < quantity:
      RETURN Error("insufficient_inventory")

    // Attempt optimistic update (fails if version changed since fetch)
    success = UPDATE listings
      SET quantity_reserved = quantity_reserved + quantity,
          version = version + 1
      WHERE listing_id = listing_id
        AND version = listing.version  // optimistic lock check
        AND (quantity - quantity_reserved - quantity_sold) >= quantity

    IF success:
      reservation = create_reservation(listing_id, quantity, buyer_id, ttl=10min)
      schedule_ttl_cleanup(reservation.reservation_id, delay=10min)
      RETURN reservation

  RETURN Error("reservation_conflict_retry_exceeded")
```

### Checkout Saga Orchestration

```
FUNCTION execute_checkout_saga(reservation_id, payment_token, shipping_option, buyer_address):

  // Step 1: Validate reservation is still active
  reservation = fetch_reservation(reservation_id)
  IF reservation.state != "active" OR now() > reservation.expires_at:
    RETURN Error("reservation_expired")

  listing = fetch_listing(reservation.listing_id)
  price_snapshot = reservation.price_snapshot

  // Step 2: Calculate totals
  tax = calculate_tax(buyer_address, listing.category_path, price_snapshot.price_cents)
  shipping_cost = get_shipping_cost(shipping_option, listing.location, buyer_address)
  total = price_snapshot.price_cents + shipping_cost + tax.amount_cents
  platform_fee = floor(total * TAKE_RATE)
  processing_fee = floor(total * INTERCHANGE_RATE) + FIXED_FEE_CENTS
  seller_net = total - platform_fee - processing_fee - tax.amount_cents

  // Step 3: Execute saga steps with compensating actions
  saga_state = "started"
  TRY:
    // 3a: Authorize payment
    auth_result = payment_service.authorize(payment_token, total, idempotency_key=reservation_id)
    IF NOT auth_result.success:
      RETURN Error("payment_declined", auth_result.decline_reason)
    saga_state = "authorized"

    // 3b: Convert soft reserve to hard commit
    commit_result = listing_service.hard_commit(reservation_id)
    IF NOT commit_result.success:
      payment_service.void(auth_result.auth_id)  // compensate step 3a
      RETURN Error("inventory_no_longer_available")
    saga_state = "committed"

    // 3c: Capture payment
    capture_result = payment_service.capture(auth_result.auth_id)
    IF NOT capture_result.success:
      listing_service.release_commit(reservation_id)  // compensate step 3b
      payment_service.void(auth_result.auth_id)       // compensate step 3a
      RETURN Error("payment_capture_failed")
    saga_state = "captured"

    // 3d: Create escrow record
    escrow = escrow_service.create(
      order_total=total, seller_id=listing.seller_id, buyer_id=reservation.buyer_id,
      hold_reason=determine_hold_reason(listing.seller_id)
    )
    saga_state = "escrowed"

    // 3e: Create order record
    order = order_service.create(
      buyer_id=reservation.buyer_id, seller_id=listing.seller_id,
      listing_id=listing.listing_id, listing_snapshot=snapshot(listing),
      total_cents=total, platform_fee_cents=platform_fee,
      seller_net_cents=seller_net, escrow_id=escrow.escrow_id,
      tax_cents=tax.amount_cents, tax_jurisdiction=tax.jurisdiction_code
    )
    saga_state = "completed"

    // 3f: Publish event (async, non-compensatable)
    event_bus.publish("order.created", order)

    RETURN Success(order)

  CATCH exception:
    // Execute compensating transactions in reverse order
    IF saga_state >= "escrowed":
      escrow_service.void(escrow.escrow_id)
    IF saga_state >= "captured":
      payment_service.refund(capture_result.capture_id)
    IF saga_state >= "committed":
      listing_service.release_commit(reservation_id)
    IF saga_state >= "authorized":
      payment_service.void(auth_result.auth_id)
    RETURN Error("checkout_failed", exception.message)
```

### Multi-Stage Search Query Execution

```
FUNCTION execute_search(query, filters, buyer_id, page_token, limit=48):

  // Stage 1: Query Understanding
  parsed = query_understanding(query)
  //   - Entity extraction: "nikon d850" → brand=Nikon, model=D850
  //   - Intent classification: "gift for mom" → category_hints=[jewelry, clothing, home]
  //   - Spell correction: "camra" → "camera"
  //   - Synonym expansion: "couch" → ["couch", "sofa", "settee"]

  // Stage 2: Dual-Path Recall
  // 2a: Vector recall (semantic similarity)
  query_embedding = encode(parsed.corrected_query)
  vector_candidates = ann_search(query_embedding, top_k=1000,
                                  category_filter=parsed.category_hints)

  // 2b: Lexical recall (keyword matching)
  lexical_candidates = bm25_search(parsed.expanded_tokens, top_k=1000,
                                    filters=filters)

  // 2c: Merge and deduplicate
  candidates = merge_unique(vector_candidates, lexical_candidates)
  // Typical: 1,200-1,800 unique candidates

  // Stage 3: Availability Filter (pre-ranking, cheap)
  available_set = availability_cache.get_available_ids(candidates.listing_ids)
  candidates = filter(candidates, lambda c: c.listing_id IN available_set)

  // Stage 4: LTR Re-Ranking
  features = assemble_features(candidates, buyer_id, parsed)
  //   Per candidate: [bm25_score, vector_similarity, seller_score, ctr_7d,
  //                   cvr_7d, price_percentile, listing_age_hours, ...]
  ranked = ltr_model.predict(features)  // LambdaMART; ~15ms for 1,500 candidates
  ranked = sort_by_score(ranked, descending=True)

  // Stage 5: Hard Filters (post-ranking)
  ranked = apply_filters(ranked, filters)  // price range, condition, location
  ranked = remove_policy_suspended(ranked)
  ranked = remove_geo_restricted(ranked, buyer_location)

  // Stage 6: Diversity Injection
  ranked = enforce_seller_diversity(ranked, max_per_seller=3, top_n=20)
  ranked = inject_new_seller_impressions(ranked, category=parsed.category_hints)

  // Stage 7: Personalization (if available)
  IF buyer_id IS NOT NULL AND personalization_service.is_available():
    ranked = personalize(ranked, buyer_id)
  // Fallback: skip personalization; serve un-personalized results

  // Stage 8: Promoted Listing Injection
  promoted = fetch_promoted_listings(parsed.category_hints, limit=3)
  ranked = blend_promoted(ranked, promoted, positions=[1, 5, 12])

  // Paginate
  page = paginate(ranked, page_token, limit)

  RETURN SearchResponse(
    results=page.items,
    total_estimate=len(ranked),
    next_page_token=page.next_token,
    search_id=generate_search_id(),  // for click tracking
    facets=compute_facets(candidates)  // available filters with counts
  )
```

### Tax Calculation Engine

```
FUNCTION calculate_tax(buyer_address, category_path, price_cents):

  // Determine jurisdiction
  jurisdiction = resolve_jurisdiction(buyer_address)
  //   US: state + county + city + special district (ZIP+4 granularity)
  //   EU: country + VAT zone
  //   Other: country-level

  // Determine taxability
  product_tax_class = map_category_to_tax_class(category_path)
  //   Most physical goods: "general_merchandise" → standard rate
  //   Clothing in some states: "clothing" → exempt below threshold
  //   Food: "food" → reduced rate or exempt
  //   Digital goods: "digital" → varies by state

  // Query tax engine
  tax_result = tax_engine.calculate(
    jurisdiction=jurisdiction,
    tax_class=product_tax_class,
    amount_cents=price_cents,
    ship_to=buyer_address,
    transaction_date=now()
  )

  RETURN TaxResult(
    amount_cents=tax_result.tax_cents,
    rate=tax_result.effective_rate,
    jurisdiction_code=jurisdiction.code,
    breakdown=tax_result.line_items  // state, county, city components
  )
```

---

## Additional Data Models

### Reservation

```
Reservation {
  reservation_id:    UUID (PK)
  listing_id:        UUID (FK → Listing)
  buyer_id:          UUID (FK → User)
  quantity:          int
  price_snapshot:    PriceSnapshot  // immutable copy at reservation time
  state:             enum (active | completed | expired | cancelled)
  created_at:        timestamp
  expires_at:        timestamp  // created_at + TTL (10 min default)
  completed_at:      timestamp (nullable)
}

PriceSnapshot {
  price_cents:       int
  currency:          string
  shipping_options:  ShippingOption[]
  captured_at:       timestamp  // when price was locked
}
```

### Dispute

```
Dispute {
  dispute_id:        UUID (PK)
  order_id:          UUID (FK → Order)
  buyer_id:          UUID
  seller_id:         UUID
  reason:            enum (item_not_received | item_not_as_described | damaged | wrong_item | other)
  description:       text
  evidence:          EvidenceItem[]
  state:             enum (open | pending_seller_response | under_review |
                           resolved_buyer | resolved_seller | escalated)
  auto_resolvable:   bool
  assigned_analyst:  string (nullable)
  resolution:        ResolutionDetail (nullable)
  seller_response:   text (nullable)
  seller_response_at: timestamp (nullable)
  buyer_satisfaction: int (1-5, nullable)  // post-resolution survey
  created_at:        timestamp
  resolved_at:       timestamp (nullable)
  escalated_at:      timestamp (nullable)
}

EvidenceItem {
  type:              enum (photo | tracking_info | message_screenshot | receipt)
  url:               string
  uploaded_by:       enum (buyer | seller | system)
  uploaded_at:       timestamp
}

ResolutionDetail {
  outcome:           enum (full_refund | partial_refund | no_refund | replacement)
  refund_amount_cents: int (nullable)
  decided_by:        enum (automated | analyst)
  reason_code:       string
  decided_at:        timestamp
}
```

### User (Buyer/Seller)

```
User {
  user_id:           UUID (PK)
  email:             string (unique, encrypted at rest)
  phone:             string (encrypted at rest)
  display_name:      string
  role:              enum (buyer | seller | both)
  kyc_status:        enum (not_required | pending | verified | rejected | expired)
  kyc_tier:          enum (casual | active | business | high_risk)
  kyc_verified_at:   timestamp (nullable)
  kyc_expires_at:    timestamp (nullable)
  mfa_enabled:       bool
  last_login_at:     timestamp
  last_login_ip:     string
  last_login_device_fingerprint: string
  account_status:    enum (active | suspended | banned | deleted)
  created_at:        timestamp

  // Seller-specific (only populated if role includes seller)
  seller_profile: {
    business_name:     string (nullable)
    business_type:     enum (individual | business)
    tax_id:            string (encrypted)
    payout_method:     PayoutMethod
    return_policy:     text
    handling_time_days: int
    category_permissions: string[]  // categories this seller can list in
  }
}

PayoutMethod {
  type:              enum (bank_account | digital_wallet)
  account_token:     string  // tokenized bank details
  currency:          string
  verified:          bool
  added_at:          timestamp
  last_payout_at:    timestamp (nullable)
}
```

---

## Additional API Contracts

### Review API

```
POST /v1/orders/{order_id}/reviews

Request:
  {
    rating:    int (1-5)
    title:     string (max 100 chars)
    body:      string (max 1,000 chars)
    photos:    string[]  // uploaded photo IDs (optional)
  }

Response:
  {
    review_id: string
    state: "pending_fraud_check"  // always starts in fraud check
    estimated_publish_time: "within 24 hours"
  }

GET /v1/sellers/{seller_id}/reviews

Query parameters:
  sort:        enum (newest | highest | lowest | most_helpful)
  page_token:  string
  limit:       int (max 50)

Response:
  {
    reviews: Review[]
    summary: {
      average_rating: float
      total_count: int
      distribution: { "5": int, "4": int, "3": int, "2": int, "1": int }
    }
    next_page_token: string
  }
```

### Seller Quality API (Internal)

```
GET /internal/v1/sellers/{seller_id}/quality

Response:
  {
    seller_id: string
    overall_score: float
    components: {
      review_score: float
      shipping_score: float
      dispute_score: float
      response_score: float
    }
    trust_tier: "new" | "standard" | "trusted" | "verified_pro"
    search_boost: float
    payout_hold_days: int
    score_version: int
    computed_at: timestamp
    next_refresh_at: timestamp
  }

GET /internal/v1/sellers/{seller_id}/quality/history

Query parameters:
  from: timestamp
  to:   timestamp

Response:
  {
    history: QualityScoreRecord[]  // versioned, immutable score records
  }
```

### Listing Management API

```
POST /v1/listings

Request:
  {
    title:            string (max 140 chars)
    description:      string (max 5,000 chars)
    category_path:    string[]
    price_cents:      int
    currency:         string (ISO 4217)
    quantity:         int
    condition:        enum (new | like_new | good | fair | parts_only)
    shipping_options: ShippingOption[]
    tags:             string[]
    photo_upload_ids: string[]  // pre-uploaded via signed URLs
  }

Response:
  {
    listing_id: string
    state: "pending_review"  // always starts in fraud check
    estimated_activation: "within 5 minutes"
    photo_processing_status: "processing"
  }

PATCH /v1/listings/{listing_id}

Request:
  {
    price_cents:  int (optional)
    quantity:     int (optional)
    description:  string (optional)
    version:     int  // optimistic concurrency; must match current version
  }

Response:
  {
    listing_id: string
    version: int  // incremented
    state: string
    updated_fields: string[]
  }

POST /v1/listings/{listing_id}/deactivate

Response:
  {
    listing_id: string
    state: "expired"
    active_reservations: int  // if > 0, listing remains active until reservations resolve
  }
```

### Payout API (Internal)

```
GET /internal/v1/sellers/{seller_id}/payout-summary

Response:
  {
    seller_id: string
    pending_balance_cents: int  // escrow released but not yet disbursed
    available_balance_cents: int  // cleared for disbursement
    held_balance_cents: int  // held due to disputes or extended holds
    next_payout_date: date
    next_payout_estimated_cents: int
    trust_tier: string
    hold_days: int
    payout_method: PayoutMethod
  }
```
