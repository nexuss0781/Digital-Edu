# 12.21 AI-Native Creative Design Platform — Low-Level Design

## Data Models

### design_document

The canonical representation of a user's design—a structured scene graph with metadata, collaboration state, and generative provenance.

```
design_document {
  document_id:          UUID              -- globally unique, immutable
  owner_id:             UUID              -- creating user
  workspace_id:         UUID              -- team/organization context
  title:                string
  canvas_width:         integer           -- logical pixels
  canvas_height:        integer           -- logical pixels
  scene_graph:          scene_node        -- root node of element tree (see below)
  active_brand_kit_id:  UUID | null       -- FK → brand_kit; null = no brand constraints
  design_tokens_ref:    UUID | null       -- FK → design_token_set; inherited from brand kit or custom
  template_origin_id:   UUID | null       -- FK → template if created from a template
  collaboration_state:  collab_metadata   -- {active_session_id, participant_count, last_sync_at}
  version_head:         UUID              -- FK → design_version; current version pointer
  sharing:              sharing_config    -- {visibility: PRIVATE|LINK|PUBLIC, permissions: list<{user_id, role}>}
  tags:                 list<string>
  created_at:           timestamp
  updated_at:           timestamp
  deleted_at:           timestamp | null  -- soft delete
}
```

### scene_node

A node in the design's element tree. Every visual element (text, image, shape, group, frame) is a scene_node.

```
scene_node {
  node_id:              UUID              -- unique within document
  parent_id:            UUID | null       -- null for root node
  node_type:            enum              -- TEXT | IMAGE | SHAPE | GROUP | FRAME | COMPONENT_INSTANCE
  z_index:              integer           -- rendering order within parent
  bounds:               bounding_box      -- {x, y, width, height} in logical pixels
  rotation:             float             -- degrees, 0-360
  opacity:              float             -- 0.0-1.0
  visible:              boolean
  locked:               boolean           -- prevent editing
  style:                style_properties  -- type-specific styling (see below)
  content:              content_payload   -- type-specific content (see below)
  constraints:          layout_constraints -- {horizontal: LEFT|RIGHT|CENTER|STRETCH, vertical: TOP|BOTTOM|CENTER|STRETCH}
  auto_layout:          auto_layout_config | null  -- flex-like layout for FRAME nodes
  generation_provenance: provenance_info | null    -- AI generation metadata if AI-created
  children:             list<scene_node>  -- ordered child nodes (for GROUP/FRAME)
  crdt_clock:           vector_clock      -- CRDT version vector for conflict resolution
}

style_properties {
  fill:                 list<fill>        -- {type: SOLID|GRADIENT|IMAGE, color: hex, gradient_stops, image_ref}
  stroke:               stroke_config     -- {color, width, dash_pattern, position: INSIDE|CENTER|OUTSIDE}
  corner_radius:        corner_config     -- {top_left, top_right, bottom_left, bottom_right}
  shadow:               list<shadow>      -- {color, offset_x, offset_y, blur, spread}
  blur:                 blur_config | null
  blend_mode:           enum              -- NORMAL | MULTIPLY | SCREEN | OVERLAY | ...
  font_family:          string | null     -- TEXT nodes only
  font_size:            float | null
  font_weight:          integer | null
  line_height:          float | null
  letter_spacing:       float | null
  text_align:           enum | null       -- LEFT | CENTER | RIGHT | JUSTIFY
  text_color:           hex | null
  token_bindings:       map<string, string>  -- maps style property → design_token_id
}

content_payload {
  -- For TEXT nodes:
  text_content:         string
  rich_text_runs:       list<text_run>    -- {start, end, style_overrides}
  -- For IMAGE nodes:
  asset_ref:            UUID              -- FK → asset; content-addressable reference
  crop:                 crop_rect | null  -- {x, y, width, height} within original image
  filters:              image_filters     -- {brightness, contrast, saturation, hue_rotate, ...}
  generation_params:    image_gen_params | null  -- prompt, seed, model_version if AI-generated
  -- For SHAPE nodes:
  shape_type:           enum              -- RECTANGLE | ELLIPSE | POLYGON | STAR | LINE | PATH
  path_data:            string | null     -- SVG path data for custom shapes
  -- For COMPONENT_INSTANCE nodes:
  component_def_id:     UUID              -- FK → component_definition in design system
  overrides:            map<string, any>  -- property overrides from component defaults
}

provenance_info {
  generation_id:        UUID
  prompt:               string
  model_versions:       map<string, string>  -- {layout: "v2.1", image: "v3.0", text: "v1.5"}
  generated_at:         timestamp
  generation_params:    map<string, any>     -- seed, temperature, style_strength, etc.
  parent_generation_id: UUID | null          -- if this was a regeneration/variation
}
```

### brand_kit

A set of brand constraints that govern all AI generation and manual editing for a workspace.

```
brand_kit {
  kit_id:               UUID
  workspace_id:         UUID
  name:                 string
  color_palette:        list<brand_color>     -- {name, hex, usage: PRIMARY|SECONDARY|ACCENT|BACKGROUND|TEXT}
  typography:           list<brand_font>      -- {font_family, weight_range, usage: HEADING|BODY|CAPTION}
  logo_assets:          list<logo_config>     -- {asset_ref, placement_rules: {zones, min_clear_space, min_size}}
  imagery_style:        style_embedding       -- CLIP embedding of reference images; used for style conditioning
  imagery_guidelines:   string                -- natural language description of imagery style
  voice_guidelines:     string                -- brand voice and tone description for text generation
  spacing_scale:        list<integer>         -- pixel spacing scale (e.g., [4, 8, 12, 16, 24, 32, 48, 64])
  grid_system:          grid_config           -- {columns, gutter, margin} per canvas size category
  prohibited_elements:  list<string>          -- elements/styles to avoid (e.g., "rounded corners", "script fonts")
  created_at:           timestamp
  updated_at:           timestamp
  version:              integer
}
```

### design_token_set

Hierarchical design tokens powering component consistency and AI generation constraints.

```
design_token_set {
  token_set_id:         UUID
  workspace_id:         UUID
  parent_set_id:        UUID | null       -- for inheritance hierarchy
  brand_kit_id:         UUID | null       -- FK → brand_kit this token set is derived from
  tokens:               map<string, token_value>
    -- key: dot-notated path (e.g., "color.primary", "spacing.md", "font.heading.family")
    -- value: {raw_value, resolved_value, type: COLOR|DIMENSION|FONT|SHADOW|OPACITY, description}
  component_tokens:     map<string, map<string, string>>
    -- key: component_type (e.g., "button", "card", "header")
    -- value: map of property → token_path (e.g., {"background": "color.primary", "border-radius": "radius.md"})
  created_at:           timestamp
  updated_at:           timestamp
  version:              integer
}
```

### generation_job

Tracks an AI generation request through the multi-model pipeline.

```
generation_job {
  job_id:               UUID
  document_id:          UUID
  user_id:              UUID
  job_type:             enum              -- TEXT_TO_DESIGN | IMAGE_GENERATE | IMAGE_EDIT | TEXT_GENERATE | MAGIC_RESIZE | VARIATION
  prompt:               string
  brand_kit_id:         UUID | null
  input_context:        map<string, any>  -- canvas dimensions, existing elements, target format
  status:               enum              -- QUEUED | INTERPRETING | GENERATING_LAYOUT | GENERATING_IMAGES | GENERATING_TEXT | VALIDATING | COMPLETE | FAILED
  subtasks:             list<subtask_record>
    -- each: {subtask_id, model_type, model_version, input_hash, status, latency_ms, gpu_id, output_ref}
  output_scene_nodes:   list<scene_node>  -- generated elements
  brand_violations:     list<violation>   -- {element_id, rule, severity, correction_applied}
  content_safety_flags: list<safety_flag> -- {element_id, flag_type, confidence, blocked: boolean}
  total_latency_ms:     integer
  gpu_cost_microdollars: integer          -- tracked for cost attribution
  created_at:           timestamp
  completed_at:         timestamp | null
  cached:               boolean           -- true if served from generation cache
}
```

### asset

A media asset (uploaded or AI-generated) stored in the content-addressable asset store.

```
asset {
  asset_id:             UUID              -- derived from content hash for dedup
  content_hash:         bytes[32]         -- SHA-256 of raw content
  perceptual_hash:      bytes[8]          -- pHash for near-duplicate detection
  media_type:           enum              -- IMAGE | VIDEO | AUDIO | FONT | SVG
  mime_type:            string
  dimensions:           {width, height} | null
  file_size_bytes:      integer
  storage_url:          string            -- object storage path
  thumbnails:           list<thumbnail>   -- {size, url} pre-rendered at standard sizes
  metadata:             map<string, string>  -- EXIF, color profile, AI generation params
  upload_source:        enum              -- USER_UPLOAD | AI_GENERATED | TEMPLATE | STOCK_LIBRARY
  uploaded_by:          UUID | null       -- user who uploaded; null for system-generated
  reference_count:      integer           -- number of documents referencing this asset
  content_safety:       safety_status     -- {screened: boolean, safe: boolean, flags: list<string>}
  created_at:           timestamp
  last_referenced_at:   timestamp         -- for lifecycle/GC management
}
```

---

## API Design

### Design Document API

```
POST /v1/designs
  Request:
    workspace_id: UUID
    title: string
    canvas_width: integer
    canvas_height: integer
    template_id: UUID (optional)       -- start from template
    brand_kit_id: UUID (optional)
  Response:
    {document_id, title, canvas_dimensions, collaboration_url, created_at}

GET /v1/designs/{document_id}
  Response:
    {document_id, scene_graph, metadata, version_head, sharing}

PUT /v1/designs/{document_id}/scene-graph
  -- Batch update for non-collaborative (offline) editing
  Request:
    operations: list<scene_graph_operation>  -- insert, update, delete, move
    base_version: UUID                       -- optimistic concurrency check
  Response:
    {document_id, version_id, conflicts: list<conflict> | null}
```

### AI Generation API

```
POST /v1/generate/design
  Request:
    document_id: UUID
    prompt: string
    canvas_dimensions: {width, height}
    brand_kit_id: UUID (optional)
    style_reference_asset_ids: list<UUID> (optional)
    variation_count: integer (default 1, max 4)
  Response:
    {job_id, status: "QUEUED", estimated_completion_ms: integer}
  -- Results streamed via WebSocket or polled via GET /v1/generate/{job_id}

POST /v1/generate/image
  Request:
    prompt: string
    width: integer
    height: integer
    style: enum (PHOTO | ILLUSTRATION | FLAT | WATERCOLOR | ...)
    brand_kit_id: UUID (optional)
    negative_prompt: string (optional)
    seed: integer (optional)
  Response:
    {job_id, status: "QUEUED"}

POST /v1/generate/image-edit
  Request:
    asset_id: UUID
    edit_type: enum (INPAINT | OUTPAINT | STYLE_TRANSFER | BACKGROUND_REMOVE | ENHANCE)
    mask: base64 (for inpaint)
    prompt: string (for inpaint/style)
    target_dimensions: {width, height} (for outpaint)
  Response:
    {job_id, status: "QUEUED"}

POST /v1/generate/text
  Request:
    context: string                    -- surrounding design context
    purpose: enum (HEADLINE | BODY | CTA | CAPTION | TAGLINE)
    tone: string (optional)            -- brand voice override
    max_length: integer (optional)
    language: string (default "en")
  Response:
    {suggestions: list<{text, confidence}>}

POST /v1/generate/resize
  Request:
    document_id: UUID
    target_dimensions: list<{width, height, label}>  -- e.g., [{1080,1080,"Instagram"}, {1200,628,"Facebook"}]
  Response:
    {job_id, resized_documents: list<{label, document_id}>}
```

### Collaboration API (WebSocket)

```
CONNECT /v1/collab/{document_id}
  -- Upgrade to WebSocket; auth via token in handshake
  -- Bidirectional message stream:

  Client → Server:
    {type: "operation", ops: list<scene_graph_operation>, client_clock: vector_clock}
    {type: "cursor_update", position: {x, y}, selection: list<node_id>}
    {type: "presence_heartbeat"}

  Server → Client:
    {type: "remote_operation", user_id, ops: list<scene_graph_operation>, server_clock: vector_clock}
    {type: "remote_cursor", user_id, position: {x, y}, color: hex}
    {type: "ai_generation_preview", job_id, preview_nodes: list<scene_node>}
    {type: "ai_generation_complete", job_id, ops: list<scene_graph_operation>}
    {type: "participant_joined" | "participant_left", user_id, display_name}
```

### Brand Kit API

```
POST /v1/brand-kits
  Request:
    workspace_id: UUID
    name: string
    color_palette: list<brand_color>
    typography: list<brand_font>
    logo_assets: list<{asset_id, placement_rules}>
    imagery_references: list<UUID>      -- asset IDs of reference images for style embedding
    voice_guidelines: string
  Response:
    {kit_id, style_embedding_status: "COMPUTING" | "READY"}

GET /v1/brand-kits/{kit_id}/validate
  -- Validate a scene graph against brand kit rules
  Request (query param):
    document_id: UUID
  Response:
    {violations: list<{node_id, rule, severity: WARNING|ERROR, suggestion}>}
```

### Asset API

```
POST /v1/assets/upload
  Request:
    file: multipart/form-data
    workspace_id: UUID
  Response:
    {asset_id, content_hash, deduplicated: boolean, content_safety: {safe, flags}}

GET /v1/assets/{asset_id}
  Response:
    {asset_id, media_type, dimensions, storage_url, thumbnails, metadata}
```

---

## Core Algorithms

### Algorithm 1: Layout Generation via Constrained Transformer

```
FUNCTION generate_layout(intent: layout_intent, brand_kit: brand_kit | null,
                          canvas: {width, height}) -> list<element_placement>:

  // Step 1: Encode intent as structured input
  content_slots = intent.content_slots  // e.g., [{type: IMAGE, role: HERO}, {type: TEXT, role: HEADLINE}, ...]
  aspect_ratio = canvas.width / canvas.height
  slot_count = len(content_slots)

  // Step 2: Retrieve similar layouts from training data (retrieval-augmented generation)
  query_embedding = layout_encoder.encode({slot_count, aspect_ratio, content_types: [s.type for s in content_slots]})
  similar_layouts = layout_index.search(query_embedding, k=10)

  // Step 3: Condition transformer on brand constraints
  brand_conditioning = null
  IF brand_kit is not null:
    brand_conditioning = {
      grid: brand_kit.grid_system,
      spacing_scale: brand_kit.spacing_scale,
      prohibited: brand_kit.prohibited_elements
    }

  // Step 4: Generate layout via autoregressive transformer
  // Each element placement is predicted sequentially, conditioned on previous placements
  placements = []
  hidden_state = layout_transformer.init(
    canvas_dims={canvas.width, canvas.height},
    similar_layouts=similar_layouts,
    brand_constraints=brand_conditioning
  )

  FOR slot IN content_slots:
    placement = layout_transformer.predict_next(
      hidden_state=hidden_state,
      element_type=slot.type,
      element_role=slot.role,
      previous_placements=placements
    )
    // placement: {x, y, width, height, z_index, alignment, font_size_suggestion}

    // Step 5: Snap to brand grid if active
    IF brand_conditioning is not null:
      placement = snap_to_grid(placement, brand_conditioning.grid, brand_conditioning.spacing_scale)

    placements.append(placement)
    hidden_state = layout_transformer.update(hidden_state, placement)

  // Step 6: Post-process: check overlap, visual balance, hierarchy
  placements = resolve_overlaps(placements, canvas)
  placements = enforce_hierarchy(placements, content_slots)  // HEADLINE bigger than BODY, etc.

  RETURN placements
```

### Algorithm 2: Brand-Constrained Image Generation

```
FUNCTION generate_brand_image(prompt: string, brand_kit: brand_kit,
                               dimensions: {width, height}) -> image_result:

  // Step 1: Compute style conditioning from brand reference images
  style_embedding = brand_kit.imagery_style  // pre-computed CLIP embedding of brand reference images
  palette_embedding = encode_palette(brand_kit.color_palette)  // encode brand colors as conditioning vector

  // Step 2: Augment prompt with brand context
  augmented_prompt = prompt + " in the visual style of: " + brand_kit.imagery_guidelines
  negative_prompt = build_negative_prompt(brand_kit.prohibited_elements)

  // Step 3: Run diffusion model with brand conditioning
  latent = sample_noise(dimensions)
  FOR step IN range(NUM_DIFFUSION_STEPS):  // typically 20-30 steps
    // Classifier-free guidance with style conditioning
    noise_pred_uncond = diffusion_model.predict_noise(latent, step, null_prompt)
    noise_pred_text = diffusion_model.predict_noise(latent, step, augmented_prompt)
    noise_pred_style = diffusion_model.predict_noise(latent, step, augmented_prompt, style_embedding)

    // Blend text guidance and style guidance
    noise_pred = noise_pred_uncond
                 + TEXT_GUIDANCE_SCALE * (noise_pred_text - noise_pred_uncond)
                 + STYLE_GUIDANCE_SCALE * (noise_pred_style - noise_pred_text)

    latent = diffusion_scheduler.step(latent, noise_pred, step)

  image = vae_decoder.decode(latent)

  // Step 4: Post-process color compliance
  dominant_colors = extract_dominant_colors(image, k=5)
  color_distance = compute_palette_distance(dominant_colors, brand_kit.color_palette)
  IF color_distance > COLOR_COMPLIANCE_THRESHOLD:
    image = harmonize_colors(image, brand_kit.color_palette, strength=0.3)

  // Step 5: Content safety check
  safety_result = content_safety_model.classify(image)
  IF safety_result.unsafe:
    RETURN {status: BLOCKED, flags: safety_result.flags}

  RETURN {status: OK, image: image, generation_params: {seed, steps, guidance_scales}}
```

### Algorithm 3: CRDT Scene Graph Merge

```
FUNCTION merge_operations(local_state: scene_graph, remote_ops: list<operation>,
                           local_clock: vector_clock, remote_clock: vector_clock) -> scene_graph:

  // Each operation targets a specific node and property
  // Operation types: INSERT_NODE, DELETE_NODE, UPDATE_PROPERTY, MOVE_NODE

  FOR op IN remote_ops:
    IF op.type == INSERT_NODE:
      // Insert is conflict-free if node_id is globally unique (UUID)
      IF op.node_id NOT IN local_state:
        insert_node(local_state, op.parent_id, op.node, op.z_index)
      // Else: duplicate insert from concurrent generation — idempotent, skip

    ELSE IF op.type == DELETE_NODE:
      // Delete wins over concurrent updates (delete-wins semantic)
      IF op.node_id IN local_state:
        tombstone_node(local_state, op.node_id)  // mark as deleted, retain for undo

    ELSE IF op.type == UPDATE_PROPERTY:
      node = local_state.get(op.node_id)
      IF node is null OR node.is_tombstoned:
        CONTINUE  // node was deleted concurrently; discard update

      // Last-Writer-Wins per property: compare vector clocks
      local_prop_clock = node.property_clocks.get(op.property_name, ZERO_CLOCK)
      IF remote_clock.dominates(local_prop_clock) OR remote_clock.concurrent_with(local_prop_clock):
        // Remote wins or concurrent — apply with tie-breaking by user_id
        IF remote_clock.concurrent_with(local_prop_clock):
          // Tie-break: higher user_id wins (deterministic, arbitrary)
          IF op.user_id > local_state.last_writer(op.node_id, op.property_name):
            node.set_property(op.property_name, op.value)
            node.property_clocks[op.property_name] = remote_clock
        ELSE:
          node.set_property(op.property_name, op.value)
          node.property_clocks[op.property_name] = remote_clock

    ELSE IF op.type == MOVE_NODE:
      // Moving a node = update parent_id + z_index
      // Cycle detection: ensure new parent is not a descendant of the moved node
      IF NOT is_descendant(local_state, op.new_parent_id, op.node_id):
        move_node(local_state, op.node_id, op.new_parent_id, op.new_z_index)

  // Advance local clock
  local_clock = vector_clock_merge(local_clock, remote_clock)

  RETURN local_state
```

### Algorithm 4: Magic Resize via Constraint-Based Reflow

```
FUNCTION magic_resize(source_doc: design_document,
                       target_dimensions: {width, height}) -> design_document:

  source_canvas = {source_doc.canvas_width, source_doc.canvas_height}
  target_canvas = target_dimensions

  // Step 1: Classify elements by role and importance
  elements = flatten_scene_graph(source_doc.scene_graph)
  FOR element IN elements:
    element.importance = classify_importance(element)
    // CRITICAL (logo, headline), HIGH (hero image, CTA), MEDIUM (body text), LOW (decorative)

  // Step 2: Compute scale factors
  scale_x = target_canvas.width / source_canvas.width
  scale_y = target_canvas.height / source_canvas.height
  aspect_change = (target_canvas.width / target_canvas.height) / (source_canvas.width / source_canvas.height)

  // Step 3: Apply role-aware repositioning
  FOR element IN sorted(elements, key=importance, desc):
    IF abs(aspect_change - 1.0) < 0.1:
      // Similar aspect ratio: proportional scaling
      element.bounds = scale_bounds(element.bounds, scale_x, scale_y)
    ELSE:
      // Significant aspect ratio change: content-aware reflow
      IF element.importance == CRITICAL:
        // Critical elements maintain absolute size; reposition to maintain relative zone
        element.bounds = reposition_in_zone(element, target_canvas, element.constraints)
      ELSE IF element.node_type == TEXT:
        // Text elements: maintain width ratio; adjust font size; reflow
        new_width = element.bounds.width * scale_x
        element.bounds.width = new_width
        element.style.font_size = compute_fitting_font_size(element.content, new_width)
        element.bounds.height = compute_text_height(element.content, element.style)
      ELSE IF element.node_type == IMAGE:
        // Images: maintain aspect ratio; crop to fit zone
        element.bounds = fit_image_to_zone(element, target_canvas, scale_x, scale_y)

  // Step 4: Resolve overlaps introduced by reflow
  elements = resolve_overlaps(elements, target_canvas)

  // Step 5: Re-run layout transformer for refinement if aspect change is large
  IF abs(aspect_change - 1.0) > 0.3:
    refined = layout_transformer.refine(elements, target_canvas, source_layout_embedding)
    elements = blend_layouts(elements, refined, weight=0.5)

  target_doc = clone_document(source_doc)
  target_doc.canvas_width = target_canvas.width
  target_doc.canvas_height = target_canvas.height
  target_doc.scene_graph = rebuild_scene_graph(elements)

  RETURN target_doc
```

---

## Additional Data Models

### generation_cache_entry

Stores cached AI generation results for semantic similarity-based cache lookup.

```
generation_cache_entry {
  cache_entry_id:      UUID
  prompt_embedding:    vector[512]         -- CLIP text embedding of the generation prompt
  prompt_text_hash:    bytes[32]           -- SHA-256 of normalized prompt text (for exact match)

  generation_context: {
    design_type:       enum                -- SOCIAL_MEDIA | PRESENTATION | POSTER | FLYER | BANNER
    aspect_ratio:      string              -- "1:1", "16:9", "9:16", etc.
    brand_kit_version: string | null       -- brand kit version if active; null for unbranded
    model_versions: {
      layout:          string
      image:           string
      text:            string
    }
  }

  cached_output: {
    scene_graph:       bytes               -- serialized scene graph (structured document)
    generated_images:  list<asset_ref>     -- references to generated image assets
    generated_text:    map<string, string>  -- element_id → generated text content
    layout_data:       bytes               -- serialized layout positions
  }

  quality_metrics: {
    layout_quality_score:  float64         -- automated quality score (0-1)
    brand_compliance:      boolean         -- passed brand validation
    safety_cleared:        boolean         -- passed content safety
  }

  usage_count:         uint64              -- number of times this cache entry was served
  created_at:          timestamp
  last_served_at:      timestamp
  expires_at:          timestamp           -- cache TTL (typically 30 days)
}
```

### content_safety_record

Audit trail for every content safety screening decision.

```
content_safety_record {
  record_id:           UUID
  generation_job_id:   UUID
  image_hash:          bytes[32]           -- SHA-256 of the screened image
  screening_timestamp: timestamp

  classifiers: list<classifier_result>
    -- each: {
    --   classifier_name:  string           -- "nsfw_v3", "violence_v2", "copyright_clip_v1"
    --   verdict:          enum             -- SAFE | BLOCKED | REVIEW
    --   confidence:       float64          -- 0.0-1.0
    --   category:         string | null    -- "sexual", "violence", "hate", "copyright:disney", etc.
    --   latency_ms:       float64          -- inference time for this classifier
    -- }

  aggregate_verdict:   enum                -- SAFE | BLOCKED | REVIEW
  blocking_reason:     string | null       -- human-readable reason if blocked
  copyright_matches:   list<{source_id: string, similarity: float64}> | null

  -- Post-hoc review (if verdict was REVIEW or if user reported)
  human_review: {
    reviewed_at:       timestamp | null
    reviewer_id:       string | null
    final_verdict:     enum | null         -- CONFIRMED_SAFE | CONFIRMED_UNSAFE | DISPUTED
    notes:             string | null
  }
}
```

### collaboration_session_state

Represents the real-time state of a collaborative editing session.

```
collaboration_session_state {
  session_id:          UUID
  document_id:         UUID
  created_at:          timestamp
  last_activity:       timestamp

  participants: list<participant>
    -- each: {
    --   user_id:        string
    --   display_name:   string
    --   cursor_position: {x: float64, y: float64}  -- current cursor on canvas
    --   selection:       list<node_id> | null       -- selected elements
    --   connected_at:   timestamp
    --   region:         string                      -- client's geographic region
    --   connection_id:  string                      -- WebSocket connection identifier
    -- }

  crdt_state: {
    vector_clock:      map<string, uint64>  -- per-participant logical clock
    operation_log:     list<crdt_operation>  -- operations since last checkpoint
    last_checkpoint:   timestamp
    checkpoint_hash:   bytes[32]             -- hash of scene graph at checkpoint
  }

  active_generations: list<active_generation>
    -- each: {
    --   generation_job_id: UUID
    --   initiated_by:      string           -- user who triggered generation
    --   started_at:        timestamp
    --   target_region:     {x, y, width, height} | null  -- canvas region for generation indicator
    --   snapshot_version:  uint64            -- scene graph version at generation start
    -- }

  session_config: {
    max_participants:  uint16               -- typically 20
    ai_generation_enabled: boolean
    brand_kit_id:      UUID | null
  }
}
```

---

## Algorithm 5: Semantic Similarity Cache Lookup

```
FUNCTION lookup_generation_cache(
    prompt: string,
    context: generation_context
) -> cache_result | null:

  // Step 1: Try exact match (fastest path)
  prompt_hash = sha256(normalize_prompt(prompt))
  exact_match = cache_index.lookup_exact(prompt_hash, context)
  IF exact_match IS NOT null AND exact_match.expires_at > now():
    exact_match.usage_count += 1
    RETURN {entry: exact_match, match_type: EXACT, similarity: 1.0}

  // Step 2: Compute prompt embedding for semantic search
  prompt_embedding = clip_text_encoder.encode(prompt)

  // Step 3: Search vector index for semantically similar cached generations
  candidates = cache_vector_index.search(
    embedding=prompt_embedding,
    filter={
      design_type: context.design_type,
      aspect_ratio: context.aspect_ratio,
      model_versions: context.model_versions  // must match current model versions
    },
    top_k=5,
    min_similarity=0.88
  )

  IF len(candidates) == 0:
    RETURN null  // no cache hit; trigger full generation

  // Step 4: Re-rank candidates by combined similarity
  FOR candidate IN candidates:
    // Weight semantic similarity highest; adjust for brand kit compatibility
    combined_score = 0.7 * candidate.similarity
                   + 0.2 * (1.0 IF candidate.brand_kit_version == context.brand_kit_version ELSE 0.0)
                   + 0.1 * candidate.quality_metrics.layout_quality_score

  best = max(candidates, key=lambda c: c.combined_score)

  IF best.combined_score >= 0.92:
    best.usage_count += 1
    RETURN {entry: best, match_type: SEMANTIC, similarity: best.similarity}
  ELSE:
    RETURN null  // below threshold; not confident enough for cache hit
```

### Algorithm 6: Content Safety Screening Pipeline

```
FUNCTION screen_content_safety(
    image: tensor,
    prompt: string,
    generation_job_id: UUID
) -> safety_verdict:

  // Stage 1: Prompt-level pre-screening (already done before generation; this is defense-in-depth)
  prompt_verdict = prompt_safety_classifier.classify(prompt)
  IF prompt_verdict == BLOCKED:
    RETURN {verdict: BLOCKED, reason: "Prompt contains prohibited content", stage: "pre-generation"}

  // Stage 2: Image content classification (multiple independent classifiers)
  results = run_in_parallel([
    nsfw_classifier.classify(image),                    // NSFW detection (nudity, sexual content)
    violence_classifier.classify(image),                // Violence, gore, weapons
    hate_symbol_detector.detect(image),                 // Hate symbols, extremist imagery
    face_detector.detect_and_compare(image, public_figure_db),  // Deepfake/public figure detection
  ])

  // Stage 3: Copyright similarity screening
  image_embedding = clip_image_encoder.encode(image)
  copyright_matches = copyright_index.search(image_embedding, threshold=0.85, top_k=3)

  // Stage 4: Aggregate verdicts (any classifier blocking → image blocked)
  blocked_reasons = []
  FOR result IN results:
    IF result.verdict == BLOCKED:
      blocked_reasons.append(result.category)

  IF len(copyright_matches) > 0:
    blocked_reasons.append("copyright_similarity: " + copyright_matches[0].source_id)

  // Stage 5: Record audit trail
  safety_record = content_safety_record {
    generation_job_id: generation_job_id,
    image_hash: sha256(image),
    classifiers: results,
    copyright_matches: copyright_matches,
    aggregate_verdict: BLOCKED IF len(blocked_reasons) > 0 ELSE SAFE
  }
  persist(safety_record)

  IF len(blocked_reasons) > 0:
    RETURN {verdict: BLOCKED, reasons: blocked_reasons}

  // Stage 6: Check for borderline cases (any classifier confidence between 0.4-0.6)
  borderline = [r FOR r IN results IF 0.4 <= r.confidence <= 0.6]
  IF len(borderline) > 0:
    // Queue for async human review; allow display (benefit of the doubt)
    queue_for_review(safety_record)
    RETURN {verdict: SAFE, note: "queued for human review", borderline_categories: [b.category FOR b IN borderline]}

  RETURN {verdict: SAFE}
```

---

## Algorithm 7: Brand Enforcement Multi-Pass Validation

```
FUNCTION enforce_brand(scene_graph: scene_graph, brand_kit: brand_kit) -> enforcement_result:

  corrections = []
  violations = []

  // Pass 1 — Color validation
  FOR node IN scene_graph.all_elements():
    FOR prop IN [node.fill, node.stroke, node.text_color]:
      IF prop is not null AND prop is COLOR:
        nearest = find_nearest_palette_color(prop, brand_kit.color_palette)
        delta_e = compute_delta_e(prop, nearest)  // CIE ΔE2000 perceptual difference
        IF delta_e > 5.0:  // beyond perceptual tolerance
          // Check if nearest palette color maintains legibility
          background = get_background_color_at(node.position, scene_graph)
          contrast = compute_contrast_ratio(nearest, background)
          IF contrast >= 4.5:  // WCAG AA
            corrections.add({node_id: node.id, property: prop.name,
                             old: prop.value, new: nearest.value, pass: "COLOR"})
            prop.value = nearest.value
          ELSE:
            // Try all palette colors for one with sufficient contrast
            viable = [c FOR c IN brand_kit.color_palette
                      IF compute_contrast_ratio(c, background) >= 4.5]
            IF viable:
              best = min(viable, key=lambda c: compute_delta_e(prop, c))
              corrections.add({node_id: node.id, property: prop.name,
                               old: prop.value, new: best.value, pass: "COLOR_CONTRAST"})
              prop.value = best.value
            ELSE:
              violations.add({node_id: node.id, rule: "COLOR_LEGIBILITY",
                              message: "No palette color provides sufficient contrast against background"})

  // Pass 2 — Typography validation
  FOR node IN scene_graph.text_elements():
    IF node.font_family NOT IN brand_kit.typography.allowed_families:
      nearest_font = find_nearest_brand_font(node.font_family, brand_kit.typography)
      corrections.add({node_id: node.id, property: "font_family",
                       old: node.font_family, new: nearest_font, pass: "TYPOGRAPHY"})
      node.font_family = nearest_font
      // Recompute text bounds with new font (different glyph widths)
      new_bounds = compute_text_bounds(node.text_content, nearest_font, node.font_size)
      IF new_bounds.width > node.bounds.width:
        // Text overflows — reduce font size to fit
        adjusted_size = fit_font_size(node.text_content, nearest_font, node.bounds)
        IF adjusted_size >= brand_kit.typography.minimum_size:
          node.font_size = adjusted_size
          corrections.add({node_id: node.id, property: "font_size",
                           old: node.font_size, new: adjusted_size, pass: "TYPOGRAPHY_FIT"})
        ELSE:
          violations.add({node_id: node.id, rule: "TYPOGRAPHY_OVERFLOW",
                          message: "Text cannot fit in bounds with brand font at minimum size"})

  // Pass 3 — Logo placement validation
  FOR logo IN scene_graph.elements_with_tag("LOGO"):
    zone = brand_kit.logo_placement_zone  // e.g., {region: BOTTOM_RIGHT, min_margin: 20px, min_size: 48px}
    IF NOT is_within_zone(logo.position, logo.size, zone, scene_graph.canvas):
      corrected_pos = compute_zone_position(logo.size, zone, scene_graph.canvas)
      corrections.add({node_id: logo.id, property: "position",
                       old: logo.position, new: corrected_pos, pass: "LOGO"})
      logo.position = corrected_pos
    // Check clear space
    overlapping = find_overlapping_elements(logo, logo.size * 1.2, scene_graph)
    FOR overlap IN overlapping:
      IF overlap.importance < CRITICAL:
        // Move overlapping element away from logo
        displacement = compute_displacement(overlap, logo, min_clearance=zone.min_margin)
        corrections.add({node_id: overlap.id, property: "position",
                         old: overlap.position, new: overlap.position + displacement, pass: "LOGO_CLEARSPACE"})
        overlap.position = overlap.position + displacement

  // Pass 4 — Imagery style validation
  FOR node IN scene_graph.image_elements():
    IF node.source == "AI_GENERATED":
      image_embedding = compute_clip_embedding(node.image_data)
      style_similarity = cosine_similarity(image_embedding, brand_kit.style_embedding)
      IF style_similarity < 0.70:
        violations.add({node_id: node.id, rule: "IMAGERY_STYLE",
                        similarity: style_similarity, threshold: 0.70,
                        message: "Generated image style does not match brand reference imagery"})

  // Pass 5 — Spacing and grid validation
  FOR node IN scene_graph.all_elements():
    IF brand_kit.grid_system:
      snapped = snap_to_grid(node.position, brand_kit.grid_system)
      IF distance(node.position, snapped) > 2:  // 2px tolerance
        corrections.add({node_id: node.id, property: "position",
                         old: node.position, new: snapped, pass: "GRID"})
        node.position = snapped

  RETURN {
    passed: len(violations) == 0,
    corrections_applied: corrections,
    unresolvable_violations: violations,
    total_corrections: len(corrections),
    total_violations: len(violations)
  }
```

---

### Export Rendering API

```
POST /v1/designs/{document_id}/export
  Request:
    format: "PNG" | "PDF" | "SVG" | "MP4"
    resolution: {width, height, dpi}     -- for raster formats
    color_profile: "sRGB" | "CMYK" | "AdobeRGB"  -- for PDF/print
    quality: 1-100                       -- JPEG quality (PNG is lossless)
    include_bleed: boolean               -- for print formats
    pages: list<page_id>                 -- for multi-page documents
    wait_for_generation: boolean         -- wait for pending AI generation before export
  Response:
    {export_job_id, status: "PROCESSING", estimated_seconds}

GET /v1/exports/{export_job_id}
  Response:
    {export_job_id, status: "PROCESSING" | "COMPLETED" | "FAILED",
     download_url: string (signed, expires in 24h),
     file_size_bytes, format, color_profile_used,
     warnings: list<string>}           -- e.g., "CMYK conversion: 3 colors out of gamut"
```

### Magic Resize API

```
POST /v1/designs/{document_id}/resize
  Request:
    target_formats: list<{name: string, width: int, height: int}>
      -- e.g., [{name: "Instagram Story", width: 1080, height: 1920},
      --        {name: "Twitter Header", width: 1500, height: 500}]
    preserve_text: boolean              -- propagate text edits across formats
    brand_kit_id: UUID | null           -- enforce brand constraints in resized versions
  Response:
    {resize_job_id, target_documents: list<{format_name, document_id, status: "GENERATING"}>}

GET /v1/resize-jobs/{resize_job_id}
  Response:
    {resize_job_id, status: "IN_PROGRESS" | "COMPLETED",
     results: list<{format_name, document_id, strategy_used: "PROPORTIONAL" | "CONSTRAINT_REFLOW" | "AI_RELAYOUT",
                    manual_adjustments_needed: list<string>}>}
```

### Design Token API

```
POST /v1/workspaces/{workspace_id}/design-tokens
  Request:
    name: string
    parent_token_set_id: UUID | null    -- for hierarchy (brand-level inherits from global)
    tokens: list<{
      name: string,                     -- e.g., "color.primary", "spacing.md"
      value: any,                       -- e.g., "#1E3A5F", "16px"
      type: "COLOR" | "SPACING" | "TYPOGRAPHY" | "RADIUS" | "SHADOW" | "OPACITY"
    }>
  Response:
    {token_set_id, token_count, validation: {valid, warnings: list<string>}}

GET /v1/design-tokens/{token_set_id}/resolve
  -- Resolve all tokens in hierarchy (global → brand → component) for a given context
  Request (query params):
    brand_kit_id: UUID
    component_type: string | null       -- optional filter for component-specific tokens
  Response:
    {resolved_tokens: map<string, {value, source_level: "GLOBAL" | "BRAND" | "COMPONENT"}>}
```

---

## Key Schema Relationships

```
design_document
  │─── 1:1 ──→ scene_graph (root scene_node)
  │─── 1:N ──→ design_version         (version history chain)
  │─── N:1 ──→ brand_kit              (optional brand constraints)
  │─── N:1 ──→ design_token_set       (active design tokens)
  │─── 1:N ──→ generation_job         (AI generation requests for this document)
  │─── 1:N ──→ collaboration_session  (active and past collaboration sessions)
  └─── N:M ──→ asset                  (via scene_node.content.asset_ref)

scene_node
  │─── 1:N ──→ scene_node (children)  (tree structure)
  │─── N:1 ──→ asset                  (image/media content reference)
  └─── 0:1 ──→ component_definition   (for COMPONENT_INSTANCE nodes)

brand_kit
  │─── 1:N ──→ design_document        (documents using this brand kit)
  │─── 1:1 ──→ design_token_set       (derived token set)
  └─── N:M ──→ asset                  (logo and reference imagery assets)

generation_job
  │─── N:1 ──→ design_document
  │─── 1:N ──→ subtask_record         (individual model invocations)
  │─── 1:1 ──→ content_safety_record  (safety screening for generated images)
  └─── 0:1 ──→ generation_cache_entry (if result was cached for future reuse)

collaboration_session_state
  │─── N:1 ──→ design_document
  └─── 1:N ──→ participant            (connected users)
```
