# 14.9 AI-Native MSME Marketing & Social Commerce Platform — Observability

## Metrics

### Content Generation Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `content.generation.latency_p95` | Histogram | End-to-end time from brief submission to creative ready | > 35s (static), > 100s (video) |
| `content.generation.success_rate` | Rate | Percentage of generation requests that pass quality gate | < 85% |
| `content.generation.quality_score_avg` | Gauge | Average quality gate score across all generated content | < 6.5 / 10 |
| `content.generation.regeneration_rate` | Rate | Percentage of creatives rejected by quality gate and regenerated | > 25% |
| `content.generation.gpu_utilization` | Gauge | GPU utilization across image/video/text pools | < 20% (waste) or > 85% (saturation) |
| `content.generation.queue_depth` | Gauge | Number of pending generation requests per pool | > 100 (image), > 50 (video) |
| `content.safety.rejection_rate` | Rate | Content blocked by safety filters | > 5% (indicates prompt quality issue) |
| `content.brand.compliance_rate` | Rate | Content passing brand kit compliance check | < 90% |
| `content.language.distribution` | Counter | Content generated per language | Imbalanced distribution alerts |

### Publishing Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `publishing.post.delivery_rate` | Rate | Scheduled posts successfully published on time | < 99.9% |
| `publishing.post.delay_p95` | Histogram | Delay between scheduled time and actual publish time | > 5 minutes |
| `publishing.api.error_rate` | Rate | Platform API error rate per platform | > 5% sustained for 10 min |
| `publishing.api.rate_limit_hits` | Counter | Number of rate limit responses per platform per hour | > 50% of quota consumed |
| `publishing.circuit_breaker.state` | Gauge | Current circuit breaker state per platform adapter | OPEN state for > 5 minutes |
| `publishing.retry_queue.depth` | Gauge | Number of posts in retry queue per platform | > 1,000 |
| `publishing.token.expiry_countdown` | Gauge | Hours until OAuth token expiry per MSME per platform | < 48 hours |
| `publishing.duplicate.blocked` | Counter | Duplicate publications prevented by idempotency check | Spike indicates retry storm |

### Ad Optimization Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `ads.campaign.roas_avg` | Gauge | Average ROAS across all active campaigns | < 1.0 (losing money) |
| `ads.budget.pacing_error` | Gauge | Difference between planned and actual hourly spend | > 30% deviation |
| `ads.budget.overspend_rate` | Rate | Campaigns exceeding daily budget | > 2% of campaigns |
| `ads.bandit.exploration_ratio` | Gauge | Fraction of budget spent on exploration vs. exploitation | < 10% (under-exploring) or > 40% (over-exploring) |
| `ads.creative.fatigue_detection` | Counter | Creatives flagged for engagement decay | Trend indicates need for more creative variants |
| `ads.fraud.click_anomaly` | Counter | Campaigns flagged for suspicious click patterns | Any spike triggers investigation |
| `ads.optimization.cycle_latency` | Histogram | Time to complete one optimization cycle per campaign | > 30s (missing 15-min optimization window) |

### Influencer Discovery Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `influencer.authenticity.avg_score` | Gauge | Average authenticity score of recommended influencers | < 0.7 (quality concern) |
| `influencer.match.query_latency` | Histogram | Time to return influencer search results | > 10s |
| `influencer.crawl.freshness` | Gauge | Average age of influencer profile data | > 14 days |
| `influencer.fake_detection.rate` | Rate | Percentage of indexed influencers flagged as fake/bot | > 30% (data quality issue) |
| `influencer.match.conversion_rate` | Rate | MSME-influencer matches that convert to actual partnerships | Trending metric for product effectiveness |

### MSME Engagement Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `msme.dau` | Gauge | Daily active MSMEs | Drop > 10% week-over-week |
| `msme.content.approval_rate` | Rate | Generated content approved by MSMEs (vs. rejected/edited) | < 60% (quality problem) |
| `msme.content.approval_latency` | Histogram | Time between content ready and MSME approval | > 24 hours (engagement problem) |
| `msme.onboarding.completion_rate` | Rate | New MSMEs completing brand kit setup | < 50% |
| `msme.churn.30day` | Rate | MSMEs inactive for 30+ days | > 40% monthly |

### WhatsApp Commerce Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `whatsapp.quality_rating` | Gauge | Current quality rating per MSME account (Green/Yellow/Red/Flagged) | Any MSME drops to Red |
| `whatsapp.broadcast.delivery_rate` | Rate | Percentage of broadcast messages delivered (vs. failed/blocked) | < 90% |
| `whatsapp.broadcast.read_rate` | Rate | Percentage of delivered broadcasts read by recipients | < 40% (below industry average) |
| `whatsapp.conversation.ai_resolution_rate` | Rate | Customer queries resolved by AI agent without human escalation | < 70% |
| `whatsapp.conversation.response_latency_p95` | Histogram | Time to first response to customer message (AI or human) | > 30s for AI; > 5 min for human |
| `whatsapp.catalog.sync_latency` | Histogram | Time from product update to WhatsApp catalog reflection | > 10 min |
| `whatsapp.template.approval_rate` | Rate | Percentage of submitted templates approved by WhatsApp | < 80% (indicates template quality issue) |
| `whatsapp.block_rate` | Rate | Percentage of broadcast recipients who block the MSME | > 2% (quality rating risk) |

### Video Commerce Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `video.generation.latency_p95` | Histogram | End-to-end video generation time | > 100s |
| `video.generation.template_hit_rate` | Rate | Percentage of video requests served from pre-rendered templates | < 50% (cost concern) |
| `video.trending_audio.freshness` | Gauge | Age of trending audio library data | > 24 hours |
| `video.platform.watch_time_ratio` | Gauge | Average watch time / video duration for generated videos | < 0.3 (content quality issue) |
| `video.generation.gpu_seconds_per_video` | Histogram | GPU time consumed per video generation | > 60 GPU-s (optimization regression) |

### Social Commerce Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `commerce.shoppable_tag.click_rate` | Rate | Click-through rate on product tags in shoppable content | Trending; no threshold (product metric) |
| `commerce.attribution.conversation_start_rate` | Rate | Social impressions that lead to WhatsApp conversations | Trending; benchmark against category |
| `commerce.catalog.product_count` | Gauge | Products per MSME in social commerce catalogs | < 5 (onboarding incomplete) |
| `commerce.order.attribution_confidence` | Gauge | Confidence level of social-to-order attribution | < 0.5 (attribution model needs calibration) |

### Hyperlocal Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `hyperlocal.geofence.active_count` | Gauge | Number of active geo-fences across all MSMEs | Sudden drop > 10% indicates config issue |
| `hyperlocal.trigger.weather_evaluations` | Counter | Weather trigger evaluations per hour | Spike indicates weather data update; expect corresponding promotion generation |
| `hyperlocal.attribution.qr_scans` | Counter | QR code scans attributed to social campaigns | Trending metric; no alert threshold |
| `hyperlocal.inventory.sync_freshness` | Gauge | Time since last inventory sync per MSME | > 60 min for real-time inventory MSMEs |
| `hyperlocal.targeting.radius_distribution` | Histogram | Distribution of geo-fence radii across MSMEs | Monitoring metric; informs default radius recommendations |

### Voice Commerce Metrics

| Metric | Type | Description | Alert Threshold |
|---|---|---|---|
| `voice.stt.accuracy` | Gauge | Speech-to-text word error rate per language | > 15% for any supported language |
| `voice.brief.parsing_success` | Rate | Voice briefs successfully converted to structured briefs | < 80% (ASR quality issue) |
| `voice.approval.success_rate` | Rate | Voice approval commands correctly interpreted | < 90% (speaker verification or command parsing issue) |

---

## Logging

### Log Levels and Content

```
CONTENT GENERATION LOGS:
  INFO:  Brief received, generation started, quality score, generation completed
  WARN:  Quality gate threshold close (score 5.0–6.0), regeneration triggered,
         brand kit incomplete (using defaults)
  ERROR: Generation failed (GPU error, model timeout, invalid input),
         safety filter triggered, brand kit loading failed

PUBLISHING LOGS:
  INFO:  Post scheduled, publishing initiated, platform response received,
         post confirmed live
  WARN:  Rate limit approaching (>70% quota), retry initiated,
         token refresh triggered
  ERROR: Publishing failed (API error), circuit breaker opened,
         token expired (MSME notification sent), duplicate detected

AD OPTIMIZATION LOGS:
  INFO:  Optimization cycle completed, budget allocation updated,
         creative rotated, campaign state change
  WARN:  Budget pacing deviation >20%, ROAS below 1.0 for 24h,
         exploration ratio exceeding bounds
  ERROR: Budget overspend detected, fraud alert triggered,
         platform campaign API failure

INFLUENCER LOGS:
  INFO:  Search query executed, match scores calculated,
         profile crawl completed
  WARN:  Stale profile data (>14 days), high fake follower ratio in results,
         API rate limit approaching
  ERROR: Crawl failed for platform, scoring pipeline error,
         database query timeout
```

### Structured Log Format

```
{
  "timestamp": "2026-03-10T14:30:22.456Z",
  "level": "INFO",
  "service": "content-generator",
  "trace_id": "abc123",
  "span_id": "def456",
  "msme_id": "msme-789",
  "event": "content.generation.completed",
  "details": {
    "brief_id": "brief-101",
    "creative_id": "creative-202",
    "content_type": "static_image",
    "quality_score": 7.8,
    "generation_time_ms": 18500,
    "gpu_pool": "image_gen_pool_a",
    "language": "hindi",
    "platform_target": "instagram",
    "brand_compliance": true,
    "safety_passed": true,
    "template_used": "food_festive_001",
    "regeneration_count": 0
  }
}
```

### Log Retention and Archival

| Log Category | Hot Retention | Warm Retention | Cold Archive |
|---|---|---|---|
| Content generation | 7 days | 30 days | 1 year |
| Publishing | 14 days | 90 days | 2 years (compliance) |
| Ad optimization | 14 days | 90 days | 2 years (financial audit) |
| Influencer scoring | 7 days | 30 days | 6 months |
| Security/audit | 30 days | 1 year | 7 years (regulatory) |

---

## Distributed Tracing

### Trace Spans for Content Generation Flow

```
Trace: content_generation (total: 22s)
├── brief_parsing (200ms)
│   ├── input_validation (50ms)
│   ├── intent_classification (100ms)
│   └── category_detection (50ms)
├── product_understanding (3.2s) [GPU]
│   ├── background_removal (1.5s)
│   ├── feature_extraction (1.0s)
│   └── color_analysis (0.7s)
├── text_generation (2.8s) [GPU, parallel with layout]
│   ├── caption_generation (1.5s)
│   ├── hashtag_selection (0.8s)
│   └── cta_generation (0.5s)
├── layout_generation (4.5s) [GPU]
│   ├── template_selection (0.3s)
│   ├── composition (3.5s)
│   └── brand_kit_application (0.7s)
├── visual_rendering (8.0s) [GPU]
│   ├── background_synthesis (3.0s)
│   ├── product_compositing (2.5s)
│   ├── text_overlay_rendering (1.5s)
│   └── post_processing (1.0s)
├── quality_gate (1.5s)
│   ├── aesthetic_scoring (0.5s)
│   ├── brand_compliance (0.3s)
│   ├── platform_fitness (0.2s)
│   └── safety_check (0.5s) [GPU]
└── storage_and_notification (1.8s)
    ├── media_upload (1.5s)
    └── push_notification (0.3s)
```

### Trace Spans for Publishing Flow

```
Trace: scheduled_publish (total: 8.5s)
├── schedule_trigger (50ms)
│   └── fetch_scheduled_post (50ms)
├── pre_publish_validation (200ms)
│   ├── token_validity_check (50ms)
│   ├── content_staleness_check (50ms)
│   └── rate_limit_check (100ms)
├── platform_adaptation (500ms)
│   ├── format_conversion (200ms)
│   ├── caption_truncation (50ms)
│   └── hashtag_limit_enforcement (50ms)
├── platform_api_call (6.0s)
│   ├── media_upload (4.5s)
│   ├── caption_posting (1.0s)
│   └── post_confirmation (0.5s)
├── post_publish_actions (1.5s)
│   ├── record_platform_post_id (100ms)
│   ├── update_engagement_tracking (200ms)
│   ├── schedule_metric_polling (100ms)
│   └── notify_msme (300ms)
└── event_emission (200ms)
    └── publish_content_event (200ms)
```

### Trace Spans for WhatsApp Conversation Flow

```
Trace: whatsapp_conversation (total: 2.1s for AI-handled)
├── webhook_receipt (50ms)
│   ├── message_parsing (20ms)
│   └── msme_lookup (30ms)
├── intent_classification (200ms) [GPU]
│   ├── language_detection (50ms)
│   └── intent_model_inference (150ms)
├── catalog_lookup (300ms)
│   ├── product_search (200ms)
│   └── inventory_check (100ms)
├── response_generation (800ms) [GPU]
│   ├── template_selection (100ms)
│   ├── variable_population (200ms)
│   └── language_generation (500ms)
├── response_delivery (500ms)
│   ├── whatsapp_api_call (400ms)
│   └── delivery_confirmation (100ms)
└── analytics_emission (250ms)
    ├── conversation_event (100ms)
    └── attribution_update (150ms)
```

### Cross-Service Trace Correlation

Every request carries a trace context through the entire lifecycle:

```
Brief submission → Content generation → Quality gate → MSME approval →
Scheduling → Publishing → Engagement tracking → Insight generation

WhatsApp commerce flow:
Click-to-WhatsApp ad → Customer message → AI conversation →
Order creation → Delivery update → Follow-up broadcast

All operations correlated by:
  - trace_id: unique per brief (spans entire content lifecycle)
  - brief_id: business-level correlation key
  - msme_id: customer-level correlation
  - creative_id: per-creative correlation (one brief may produce multiple creatives)
  - conversation_id: WhatsApp conversation correlation (links ad → conversation → order)
  - campaign_id: ad campaign correlation (links spend → impressions → conversions)
```

---

## Alerting

### Critical Alerts (Page on-call immediately)

| Alert | Condition | Action |
|---|---|---|
| Publishing failure rate > 10% | > 10% of scheduled posts failing for > 5 min | Investigate platform API health; check circuit breaker state |
| Ad budget overspend | Any campaign exceeds daily budget by > 20% | Immediately pause campaign; investigate pacing logic |
| Safety filter bypass | Content published without safety check | Emergency takedown; investigate pipeline bypass |
| OAuth token mass expiry | > 100 MSME tokens expiring in 24h with refresh failing | Investigate platform OAuth service health; batch notify MSMEs |
| GPU pool exhaustion | All GPU pools at >95% utilization for > 10 min | Trigger emergency scale-up; enable quality degradation |

### Warning Alerts (Notify team within 1 hour)

| Alert | Condition | Action |
|---|---|---|
| Content quality declining | Average quality score < 6.5 for > 1 hour | Review model outputs; check for input distribution shift |
| Platform rate limit saturation | > 80% of any platform's API quota consumed | Review API call patterns; optimize batching |
| Influencer data staleness | > 20% of indexed profiles older than 14 days | Investigate crawler health; check for API changes |
| MSME approval rate dropping | Approval rate < 60% for > 24 hours | Investigate content quality; check for brand kit issues |
| Ad ROAS below 1.0 | Average ROAS < 1.0 for > 48 hours | Review targeting and creative performance; check for fraud |

### Informational Alerts (Daily digest)

| Alert | Condition | Action |
|---|---|---|
| New language performance | Quality score for any language < 5.0 | Schedule language model improvement; increase human review |
| Template staleness | Any template used > 10,000 times without engagement improvement | Refresh template library; A/B test new designs |
| Competitor activity spike | Any monitored competitor's posting frequency > 2x normal | Informational; may trigger proactive MSME recommendations |

---

## Dashboards

### Operations Dashboard

- **GPU Pool Health**: Real-time utilization, queue depth, and latency per pool (image/video/text)
- **Publishing Pipeline**: Posts scheduled vs. published vs. failed per platform per hour
- **Platform API Health**: Per-platform error rate, rate limit utilization, circuit breaker states
- **Content Generation Throughput**: Requests/second, latency distribution, quality score distribution

### Business Dashboard

- **MSME Activity**: DAU/WAU/MAU trends, content creation volume, approval rates
- **Content Performance**: Engagement metrics per content type, per language, per platform
- **Ad Performance**: Campaign ROAS distribution, budget utilization, creative effectiveness
- **Influencer Program**: Match volume, partnership conversion rate, campaign ROI

### ML Model Dashboard

- **Generation Quality**: Quality score trends per model version, per content type, per language
- **Bandit Convergence**: Per-category exploration/exploitation ratio, time-to-convergence for new MSMEs
- **Authenticity Model**: Precision/recall of fake follower detection, false positive rate trends
- **Scheduling Accuracy**: Predicted vs. actual optimal posting time accuracy per MSME cohort

### WhatsApp Commerce Dashboard

- **Quality Rating Health**: Per-MSME quality rating distribution (Green/Yellow/Red); trending indicators; at-risk accounts
- **Conversation Funnel**: Messages received → AI-resolved → Human-escalated → Orders completed
- **Broadcast Effectiveness**: Delivery rate, read rate, reply rate, block rate per template type
- **Catalog Sync Health**: Sync latency distribution; failed syncs per MSME; product count coverage

### Cost Attribution Dashboard

- **GPU Cost per Content Type**: Static image vs. carousel vs. video; cost per MSME tier (free/basic/premium)
- **Platform API Cost**: API calls per platform per operation type (publishing, analytics, ad management)
- **Storage Cost**: Media storage by tier (hot/warm/cold); growth trajectory; cost per MSME
- **Revenue Attribution**: Revenue per MSME attributable to each channel (Instagram, Facebook, WhatsApp, YouTube)

---

## Runbook Index

| Alert | Runbook | Key Actions |
|---|---|---|
| Publishing failure rate > 10% | Check platform API status; verify circuit breaker states; review recent token refresh failures; check for platform API deprecation notices |
| GPU pool exhaustion | Verify auto-scaling status; check for stuck GPU jobs; enable quality degradation; review whether festival pre-scaling was triggered |
| WhatsApp quality rating drop | Identify MSMEs with elevated block rates; review recent broadcast content; pause broadcasts for affected accounts; check opt-in compliance |
| Ad budget overspend | Immediately pause affected campaigns; verify pacing algorithm parameters; check for platform reporting delay (spend may have already occurred); notify MSME |
| Content quality declining | Compare current model outputs against baseline; check for input distribution shift (new MSME category?); review quality gate threshold; check for model serving issues |
| OAuth token mass expiry | Verify platform OAuth service health; check token refresh job status; batch-notify MSMEs to re-authenticate; prioritize premium MSMEs with scheduled posts |
| Video generation backlog | Check GPU pool health; verify video queue is draining; enable resolution-adaptive mode; check for stuck rendering jobs |
| Influencer data staleness | Verify crawler health; check platform API access; review crawl rate limit utilization; trigger priority re-crawl for most-queried influencers |

---

## SLI/SLO Tracking

| Service Level Indicator | SLO Target | Measurement Method |
|---|---|---|
| Static image generation success rate | 99.5% | Successful quality gate passes / total generation requests |
| Scheduled post on-time delivery | 99.99% | Posts published within ±5 min of scheduled time / total scheduled posts |
| Ad budget pacing accuracy | ≤ 10% deviation | abs(actual_spend - planned_spend) / planned_spend, measured hourly |
| WhatsApp message delivery rate | 99.0% | Messages delivered / messages attempted (excludes opt-out rejections) |
| Content generation latency (static, p95) | ≤ 30 seconds | End-to-end: brief submission to creative ready notification |
| Platform API integration uptime | 99.5% per platform | Successful API calls / total API calls per platform per hour |
| MSME approval notification delivery | 99.9% | Approval notifications delivered within 30 seconds of content ready |

---

## AI Observability Standards

This system's AI components MUST implement the observability patterns defined in:
- **[3.25 AI Observability & LLMOps](../3.25-ai-observability-llmops-platform/00-index.md)** — trace model, token accounting, prompt-completion linkage
- **[3.26 AI Model Evaluation & Benchmarking](../3.26-ai-model-evaluation-benchmarking-platform/00-index.md)** — eval taxonomy, regression testing, human review sampling

### Required AI-Specific Metrics
- AI resolution rate (queries handled without human escalation)
- Escalation rate and top escalation reasons
- End-to-end action latency (request to AI-completed action)
- Policy violation attempt rate (actions blocked by guardrails)
- User satisfaction score for AI-handled interactions
