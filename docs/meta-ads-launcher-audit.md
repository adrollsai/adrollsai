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
| Advantage+ creative enhancements (`degrees_of_freedom_spec`) | **gap** (medium) | 0 hits anywhere in the repo. Advantage+ creative (image brightness/crop variants, text improvements, "add a CTA") is the standard 2025+ practice and is a *separate* lever from Advantage+ campaign. Recommend `degrees_of_freedom_spec: { creative_features_spec: { standard_enhancements: { enroll_status: 'OPT_IN' } } }` on the ad creative |
| Creative quality/ratio validation before upload | **gap** (medium) | Meta returns a `percent` coverage warning after upload; a local aspect-ratio/resolution check would avoid publishing a 1:1 image into a Story-only placement |
| Dynamic/catalogue creatives | **gap** (low) | not supported; fine for this product |
| Brand safety inventory filter | **gap** (low) | `brand_safety_content_filter_levels` unset; Meta's default applies |

### 3.3 Measurement

| Item | State | Notes |
|---|---|---|
| Pixel/dataset attached to ads | **ok** | `tracking_specs` on the ad |
| Conversions API | **ok** | `utils/meta-capi.ts` exists and is used from the CRM |
| `attribution_spec` | **gap** (medium) | never sent, so every lead campaign inherits the account default (7-day click / 1-day view). For lead gen that is usually right, but it should be explicit and reported, because the number the client sees depends on it |
| Lead-form quality flag | **ok** | `is_continued_flow` for the higher-intent review screen |
| Reporting/insights | **ok** | `campaign-insights`, `analyze-campaign`, `optimize-campaign` routes |

### 3.4 Operations and safety

| Item | State | Notes |
|---|---|---|
| Campaigns created `ACTIVE` | **gap** (high, deliberate?) | both launchers create the campaign and ads `ACTIVE`, so spend starts the moment Meta approves. Meta's own recommendation is create-PAUSED → review → activate. Our standing rule is "nothing may spend money without human approval": a human clicking Launch *is* approval, so this is defensible, but the agent-initiated path should not default to `ACTIVE` — see next row |
| Agent tool defaults | **gap** (high) | `meta_mcp_launch_leadgen_campaign` has `status: z.enum(['ACTIVE','PAUSED']).default('ACTIVE')`. `meta_mcp_create_campaign` defaults to PAUSED, this one does not. Recommend defaulting it to PAUSED |
| Pre-flight `validate_only` | **gap** (high) | the launcher's first real call *creates* the campaign. Meta's `execution_options: ["validate_only"]` returns the full rejection set (invalid targeting, missing budget, unsupported destination) and creates nothing. I used it for every probe in this audit — it would have caught both live failures before a shell was left behind |
| Ad-review issue monitoring | **gap** (high) | **this is what hid failure 1.2 for three days.** Nothing ever reads `issues_info` on ads/adsets/campaigns, so a `WITH_ISSUES` ad set looks perfectly healthy in our UI. Recommend a cron that polls `issues_info` for live objects and raises an in-app notification with `error_code` + `error_message` |
| Rejected-ad reasons surfaced to the client | **partial** | creation-time errors are mapped nicely (payment `1359188`, non-discrimination `2859002`, draft/draft-error `1359188`); *post-review* rejections are not |
| Empty-campaign / orphan cleanup | **ok** | campaign archived when the ad set fails, paused when 0 ads are created |
| Launch credit refund on failure | **ok** | `refundLimit` on every failure path |
| Duplicate-campaign guard | **gap** (low) | two rapid clicks create two campaigns; no idempotency key |
| Budget sanity checks | **gap** (medium) | no minimum/recommended check per objective and currency; Meta silently under-delivers below ~₹300/day for lead gen |
| Frequency caps | **gap** (low) | `frequency_control_specs` unused; usually fine for CBO lead gen |
| Learning-phase reporting | **gap** (low) | no "still learning / out of learning" state in analytics, so optimisation decisions can be made on 12 conversions |

### 3.5 API hygiene

| Item | State | Notes |
|---|---|---|
| Graph version | **gap** (high) | production code pins **v19.0** in `campaign-processor.ts`, `launch-remarketing`, `meta-ads/route.ts`, `custom-audiences`, `agent/route.ts`, `background-worker`, `analyze-campaigns` and others (49 call sites), while Meta's current version is **v27.0** and these docs are written against it. v19 still answers today, which is exactly how a hard cut-off arrives with no warning. Recommend a single `META_GRAPH_VERSION` constant per app + a scheduled bump |
| Version consistency | **gap** (medium) | three versions in use side by side: v19.0, v20.0, v21.0 (WhatsApp routes on v20, `meta-ads-mcp` on v21) |
| Error detail preserved | **ok** | `error_user_msg` / `error_user_title` / `error_subcode` are all used |
| Token expiry handling | **gap** (medium) | four tenants returned *"Error validating access token: The session has been invalidated"* during this audit (ADROLLS.in, BlueSquare Infra agent profile, Punitpal Singh, Adrolls Realty). Nothing in the launcher pre-checks the token, so the failure surfaces as a generic Meta error mid-launch |

---

## 4. What was changed in this branch

* `lib/ads/advantage-plus.ts` — new, pure: location types, special ad category
  detection, the Advantage+ plan (levers, reasons, blockers), age/gender rules under
  Meta's two hard constraints, and the campaign/ad-set payload builders.
* `utils/campaign-processor.ts` — campaign payload and targeting now built from the
  plan; all four `['home']` sites fixed; launch message and job log now state the
  Advantage+ shape and any blocker.
* `app/api/meta-ads/launch-campaign/route.ts` — carries `industry` and the optional
  explicit category/levers into the job.
* `app/api/meta-ads/launch-remarketing/route.ts` — same, with Advantage+ audience
  pinned off for retargeting.
* `lib/agent/mcp/meta-ads-mcp.ts` — new `specialAdCategory` parameter, plan-built
  campaign payload, plan-built targeting, Advantage+ summary in the tool result.
* `lib/agent/mcp/meta-graph.ts` — enforces the surviving location types on any
  caller-supplied targeting.
* `scripts/verify-advantage-plus.ts` — 93 assertions covering every rule above.

## 5. Recommended next (in order of value)

1. **Ad-review issue monitor** — a cron over live campaigns/adsets/ads reading
   `issues_info`, raising notifications. It converts "the client finds out when they
   try to publish" into "we tell them first".
2. **`validate_only` pre-flight** in the launcher before any object is created.
3. **Graph API version bump** to a single current constant (v23+ today, v27 available).
4. **Advantage+ creative** (`degrees_of_freedom_spec`) opt-in on creatives.
5. **Explicit `attribution_spec`** and a token-validity pre-check.
