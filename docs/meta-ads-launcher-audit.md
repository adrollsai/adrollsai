# Meta ads launcher — standards audit

Written 2026-11-23, against the live Graph API (v23.0 probes, v19.0 in production code)
and the current Advantage+ documentation. Everything marked **fixed** is in this
branch; everything else is a recommendation with the impact spelled out.

Scope audited: the dashboard launcher (`app/api/meta-ads/launch-campaign` →
`utils/campaign-processor.ts`), the retargeting launcher
(`app/api/meta-ads/launch-remarketing`), and the agent's Meta tools
(`lib/agent/mcp/meta-ads-mcp.ts`, `lib/agent/mcp/meta-graph.ts`).

---

## 1. The two live failures

### 1.1 "People living in this location" cannot be published any more — **fixed**

Every ad set this platform built hardcoded:

```ts
geo_locations: { location_types: ['home'] }
```

`['home']` is "People living in this location". Meta removed that choice from Ads
Manager; the surviving choice is "People living in or recently in this location"
(`['home','recent']`).

The Graph API still *accepts* `['home']` — I proved it with
`execution_options: ["validate_only"]` on Blue Square Infra's account — which is why
this never showed up as a launch error. What it produces is an ad set that exists but
cannot be published or edited in the Ads Manager UI: the advertiser is forced to pick
the surviving option first. That matches the report exactly ("launches ads with
people living in this area, which is no longer available").

Fixed in `lib/ads/advantage-plus.ts` (`LOCATION_TYPES`) and applied in
`utils/campaign-processor.ts` (4 sites), `app/api/meta-ads/launch-remarketing/route.ts`
(2 sites), `lib/agent/mcp/meta-ads-mcp.ts` and `lib/agent/mcp/meta-graph.ts`.

### 1.2 Advantage+ audience inside a special ad category — **fixed**

The exact error hit while publishing today, read live off the ad set's `issues_info`:

```
Ad set 120247466552430424  "Anmol Plotting Whatsapp ad set"   WITH_ISSUES
  level=AD_SET  code=2909055
  summary: Advantage+ audience is not available
  message: Advantage+ audience is unavailable for ads in this special ad category.
           To publish this ad set, use the original audience options instead.
```

That ad set sits inside campaign `120247466552420424` ("Anmol Deep | Whatsapp |
20-11-2026"), which carries `special_ad_categories: ["HOUSING"]`,
`special_ad_category_country: ["IN"]` and
`advantage_state: ADVANTAGE_PLUS_ENGAGEMENT`. Meta reports the campaign as fully
Advantage+ while refusing to publish the ad set underneath it.

Root causes on our side, both now fixed:

1. `special_ad_categories` was hardcoded to `[]` in both launchers, while our own
   privacy page states that every campaign we create declares HOUSING. An undeclared
   housing campaign is a compliance problem; a declared one makes Advantage+ audience
   illegal. We were on the wrong side of both halves of that trade-off.
2. `targeting_automation: { advantage_audience: 0 }` plus
   `publisher_platforms: ['facebook','instagram']` /
   `device_platforms: ['mobile','desktop']` were sent on every launch. Those two lines
   make a campaign *structurally incapable* of being Advantage+ — Meta requires all
   three levers (campaign budget, Advantage+ audience, unrestricted placements).

Fixed: `resolveAdvantagePlan()` detects the category from the tenant's
`profiles.industry` (or an explicit override), declares it, turns Advantage+ audience
off when the category forbids it, and reports why in the launch message.

---

## 2. Advantage+ — what "recommended settings" actually requires

Per [Advantage+ Campaign Experience (Marketing API)](https://developers.secure.facebook.com/documentation/ads-commerce/marketing-api/advantage-campaigns),
a campaign is reported as `ADVANTAGE_PLUS_LEADS` / `_SALES` / `_APP` only when three
levers are all `ENABLED`:

| Lever | Requirement | State in this repo |
|---|---|---|
| Advantage+ budget | budget at campaign level + a supported bid strategy | **was already correct** (`daily_budget` on the campaign, `LOWEST_COST_WITHOUT_CAP`) |
| Advantage+ audience | `targeting_automation.advantage_audience = 1` (age/gender/interests may stay as *suggestions* via `individual_setting`) | **fixed** — was hardcoded `0` |
| Advantage+ placements | *no* placement targeting and *no* placement exclusions | **fixed** — was hardcoded to FB+IG / mobile+desktop |

The objective must also match: `OUTCOME_LEADS` for an Advantage+ leads campaign,
`OUTCOME_SALES` for sales. `lib/ads/campaign-plan.ts` already resolves the objective
per destination, so the plan reports the matching state
(`ADVANTAGE_PLUS_LEADS` / `_SALES` / `_ENGAGEMENT`).

Two further Meta rules discovered by probing, both now encoded and gated:

* **Age ceiling.** With Advantage+ audience on, `age_max` may not be below 65 —
  error `1870189`: *"the maximum age audience control can't be set to lower than 65.
  You can add a lower maximum age as a suggestion instead."* The launcher now sends
  `age_max: 65` and keeps the advertiser's ceiling as a suggestion.
* **Special ad categories forbid age and gender targeting outright**, so the plan
  opens the range to 18–65 and drops `genders` rather than letting the ad set be
  rejected.

Retargeting is deliberately excluded from Advantage+ audience: a saved-audience
campaign exists to reach a list, so `advantage_audience: 0` is kept and
`targeting_relaxation_types: { custom_audience: 0, lookalike: 0 }` is now sent
explicitly instead of being left to Meta's default.

All of the above is pinned by `npm run verify:advantage` (93 assertions) and was
re-validated live for three payload shapes — prospecting, housing, retargeting — with
`validate_only`, creating nothing and spending nothing:

```
campaign create   generic prospecting  OK        special_ad_categories=[]
campaign create   property (HOUSING)   OK        special_ad_categories=["HOUSING"]
ad set            generic   Advantage+ audience ON, auto placements   OK
ad set            housing   Advantage+ audience OFF, expansion pinned OK
```

---

## 3. Audit against what a production launcher should do

Legend: **fixed** = done in this branch · **ok** = present and correct · **gap** =
missing, with severity in brackets.

### 3.1 Targeting and compliance

| Item | State | Notes |
|---|---|---|
| Location types Meta still offers | **fixed** | always `['home','recent']` |
| Country + granular location conflict (error `1487756`) | **fixed** | `buildGeoLocations()` strips the country and reports it; the old inline parser could still send both |
| Special ad category declared | **fixed** | detected from `profiles.industry`, overridable, reported in the log and the launch message |
| Special ad category + Advantage+ conflict (`2909055`) | **fixed** | audience lever disabled with an explanation instead of an unpublishable ad set |
| Age/gender under a special category | **fixed** | opened to 18–65, no genders |
| Radius bounds | **ok** | clamped 17–80 km (Meta's own limits) |
| Geo radius minimum for HOUSING in the US | **gap** (low) | US/CA housing needs a larger radius; only matters for non-IN accounts |
| Audience expansion pinned for retargeting | **fixed** | `targeting_relaxation_types` now explicit |
| `special_ad_category_country` | **gap** (low) | Meta infers it; setting it explicitly makes the declaration unambiguous |
| Multicultural-affinity / lookalike restrictions under HOUSING | **gap** (low) | Meta rejects some interest sets in HOUSING; a validate-only pre-flight would catch it before creating the shell |

### 3.2 Creative and placements

| Item | State | Notes |
|---|---|---|
| Advantage+ placements | **fixed** | no placement fields sent when the lever is on |
| Advantage+ creative enhancements (`degrees_of_freedom_spec`) | **fixed, but not as the guide says** | `standard_enhancements` — the name almost every guide still shows — is **rejected on v22+**, subcode `3858504`: *"Including standard enhancements field in creative has been deprecated. Please choose to set individual features instead."* The surviving bundle is `STANDARD_ENHANCEMENTS_CATALOG`, which validated cleanly. `IMAGE_ANIMATION`, `PROFILE_CARD` and `TEXT_OVERLAY_TRANSLATION` also validate but change what the creative looks like, so they stay an explicit choice |
| Creative quality/ratio validation before upload | **gap** (medium) | Meta returns a `percent` coverage warning after upload; a local aspect-ratio/resolution check would avoid publishing a 1:1 image into a Story-only placement. The watchdog now at least reports the resulting `2490085` ("crop key deprecated") rejections |
| Dynamic/catalogue creatives | **gap** (low) | not supported; fine for this product |
| Brand safety inventory filter | **gap** (low) | `brand_safety_content_filter_levels` unset; Meta's default applies |

### 3.3 Measurement

| Item | State | Notes |
|---|---|---|
| Pixel/dataset attached to ads | **ok** | `tracking_specs` on the ad |
| Conversions API | **ok** | `utils/meta-capi.ts` exists and is used from the CRM |
| `attribution_spec` | **fixed** | never sent before, so every campaign silently inherited the account default. On a lead ad set Meta accepts exactly one window — 7-day click and any view-through value are rejected with *"use one of these supported … combinations: (1, 0)"* — so lead and messaging campaigns now send a 1-day click window explicitly. Other objectives keep Meta's default, because their valid windows differ |
| Lead-form quality flag | **ok** | `is_continued_flow` for the higher-intent review screen |
| Reporting/insights | **ok** | `campaign-insights`, `analyze-campaign`, `optimize-campaign` routes |

### 3.4 Operations and safety

| Item | State | Notes |
|---|---|---|
| Campaigns created `ACTIVE` | **gap** (high, deliberate?) | both launchers create the campaign and ads `ACTIVE`, so spend starts the moment Meta approves. Meta's own recommendation is create-PAUSED → review → activate. Our standing rule is "nothing may spend money without human approval": a human clicking Launch *is* approval, so this is defensible, but the agent-initiated path should not default to `ACTIVE` — see next row |
| Agent tool defaults | **gap** (high) | `meta_mcp_launch_leadgen_campaign` has `status: z.enum(['ACTIVE','PAUSED']).default('ACTIVE')`. `meta_mcp_create_campaign` defaults to PAUSED, this one does not. Recommend defaulting it to PAUSED |
| Pre-flight `validate_only` | **fixed** | `lib/ads/preflight.ts`. The campaign and the ad set are now validated *before* either is created, so a refusal no longer leaves an empty campaign shell or spends the client's launch credit. Measured rejections it now catches early: budget under Meta's floor (`2446375` "Budget is too small") and an objective Meta no longer serves. A failed ad-set pre-flight archives the campaign it would have hung from |
| Ad-review issue monitoring | **fixed** | `lib/ads/ad-review-monitor.ts` + `/api/cron/meta-ad-issues` (every 6h). Reads `issues_info` on campaigns, ad sets and ads for `WITH_ISSUES`/`DISAPPROVED`, raises one notification per tenant, de-duplicated for 12h. Advisory issues on healthy objects are ignored so the alert keeps its meaning. **This is the gap that hid failure 1.2 for three days**, and the first sweep already found 16 flagged objects across the connected accounts |
| Rejected-ad reasons surfaced to the client | **partial** | creation-time errors are mapped nicely (payment `1359188`, non-discrimination `2859002`, draft/draft-error `1359188`), and post-review rejections now reach the client through the watchdog instead of staying invisible |
| Empty-campaign / orphan cleanup | **ok** | campaign archived when the ad set fails, paused when 0 ads are created |
| Launch credit refund on failure | **ok** | `refundLimit` on every failure path, including a failed pre-flight |
| Duplicate-campaign guard | **gap** (low) | two rapid clicks create two campaigns; no idempotency key |
| Budget sanity checks | **fixed** | a budget under Meta's floor is now caught by the pre-flight instead of half-creating a campaign |
| Frequency caps | **gap** (low) | `frequency_control_specs` unused; usually fine for CBO lead gen |
| Learning-phase reporting | **gap** (low) | no "still learning / out of learning" state in analytics, so optimisation decisions can be made on 12 conversions |

### 3.5 API hygiene

| Item | State | Notes |
|---|---|---|
| Graph version | **fixed** for the ads surface | `lib/ads/graph-version.ts` is now the single constant (`v23.0`), used by the campaign processor, both launchers, the ads routes and the agent's Meta tools. WhatsApp keeps its own version on purpose — different product, different deprecation track. The remaining `v19.0` references are on the read-only reporting paths (`app/api/agent/route.ts`, `analytics/ai`, `background-worker`, `analyze-campaigns`) and should follow |
| Version consistency | **partially fixed** | the ads surface is one version; WhatsApp (v20) and the read-only reporting routes (v19) still differ |
| Error detail preserved | **ok** | `error_user_msg` / `error_user_title` / `error_subcode` are all used, and the pre-flight preserves them too |
| Token expiry handling | **gap** (medium) | five tenants returned *"Error validating access token: The session has been invalidated"* during this audit (ADROLLS.in, BlueSquare Infra agent profile, Punitpal Singh, Adrolls Realty, Bioque's account is "not writable"). The pre-flight now surfaces this before a launch, but nothing tells the owner their token died — recommend a token-health check in the same watchdog |

---

## 4. What was changed in this branch

* `lib/ads/advantage-plus.ts` — new, pure: location types, special ad category
  detection, the Advantage+ plan (levers, reasons, blockers), age/gender rules under
  Meta's hard constraints, `attribution_spec`, Advantage+ creative enhancements, and
  the campaign/ad-set payload builders.
* `lib/ads/graph-version.ts` — one Graph API version for the ads surface.
* `lib/ads/preflight.ts` — `validate_only` pre-flight for the campaign and the ad set.
* `lib/ads/ad-review-monitor.ts` — pure decisions for the ad-review watchdog.
* `app/api/cron/meta-ad-issues/route.ts` + `vercel.json` — the watchdog itself, every
  6 hours.
* `utils/campaign-processor.ts` — campaign and ad-set payloads built from the plan;
  both objects pre-flighted before creation; all four `['home']` sites fixed;
  attribution and creative enhancements attached; launch message and job log state the
  Advantage+ shape and any blocker.
* `app/api/meta-ads/launch-campaign/route.ts` — carries `industry` and the optional
  explicit category/levers into the job.
* `app/api/meta-ads/launch-remarketing/route.ts` — same, with Advantage+ audience
  pinned off for retargeting.
* `app/api/meta-ads/{route,custom-audiences,search-interests}` — share the version
  constant.
* `lib/agent/mcp/meta-ads-mcp.ts` — new `specialAdCategory` parameter, plan-built
  campaign payload, pre-flight-aware, Advantage+ summary in the tool result.
* `lib/agent/mcp/meta-graph.ts` — enforces the surviving location types on any
  caller-supplied targeting.
* `scripts/verify-advantage-plus.ts` — 148 assertions covering every rule above,
  including the pre-flight, the watchdog's decision logic and the version constant.

## 5. Recommended next (in order of value)

1. **Token health** — the watchdog already reads every account; have it also report an
   invalidated token to the owner instead of leaving the launch to fail later.
2. **Finish the version bump** on the read-only reporting routes (`agent/route.ts`,
   `analytics/ai`, `background-worker`, `analyze-campaigns`) so nothing is left on v19.
3. **Idempotency key** on launch, so a double click cannot create two campaigns.
4. **Local creative pre-checks** (aspect ratio, resolution, file size) before upload.
5. **Learning-phase state** in the ads analytics, so optimisation decisions are not
   taken on 12 conversions.

## 6. Data repairs applied alongside the code (2026-11-23)

The code fix cannot repair objects that already exist, so the legacy state was swept
in the same pass (`validate_only`-free, but read-then-write with the exact shape Meta
accepts):

* **81 ad sets** carried `location_types: ["home"]` (or `["frequently_in","home"]`).
  **34 were rewritten** to include `"recent"`; the other 47 are already ended
  (end dates from Oct 2023 to 8 Nov 2026) or on accounts whose status blocks writes,
  so there is nothing live left on the removed option.
* **Blue Square Infra ad set `120247466552430424`** ("Anmol Plotting Whatsapp ad set"),
  the one from section 1.2, is **repaired**: Advantage+ audience off, `age_range`
  removed, `issues_info` now empty, status still `PAUSED` so nothing started spending.
  Two things made this write fail at first and are now encoded in the code:
  `targeting_automation` cannot be disabled while `age_range` is present (subcode
  `1487079`), and keeping `individual_setting` re-triggers `2909055`.
* 16 objects across the connected accounts are still flagged by Meta for reasons that
  belong to the advertiser, not the launcher — missing WhatsApp number (`2446880`,
  `2446955`), missing privacy policy (`1892142`), unavailable posts (`2490155`),
  deprecated 191x100 crop key (`2490085`), wrong creative for objective (`1487891`).
  Those are now surfaced by the watchdog instead of staying invisible.
* Five accounts could not be read at all: invalidated tokens (ADROLLS.in, BlueSquare
  Infra, Punitpal Singh, Adrolls Realty) and Bioque's "ad account not writable".
