# Technical audit — the existing Nobogent PWA

Read directly from the code at `nobogent-app/nobogent` (Next.js 16 App Router +
Supabase). This document records what the mobile client had to work around. Every
claim below cites the file it came from.

---

## 1. Stack

| Concern | Implementation |
|---|---|
| Framework | Next.js 16, App Router, ~200 route handlers under `app/api` |
| Data | Supabase PostgREST, project ref `hpssqssdewmkmafxlfud` (`package.json`) |
| Auth | Supabase GoTrue — email + password, Google OAuth, password reset. No magic link, no OTP, no Apple |
| Media | Cloudflare R2 (`utils/r2.ts`) is the primary store; Supabase Storage holds call recordings |
| Billing | Razorpay + PhonePe |
| Existing mobile | Capacitor wrapper around the PWA (`capacitor.config.ts`, `android/`, `ios/`) — a WebView, which is what this project replaces |

Client-facing app id is `com.nobogent.app`, name "Nobogent AI". Both are reused by
this native build so it can ship as an update to the existing store listing.

---

## 2. Data model — what exists, and what does not

Confirmed **absent**: `projects`, `agent_sessions`, `agent_messages`, `tasks`,
`pipeline_stages`.

| UI concept | Actual storage |
|---|---|
| "Project" | `properties` row. `properties.id` is the `propertyId` every generation endpoint accepts |
| "Generated asset" | `assets` (`url`, `type`, `status`, `caption`, `metadata` jsonb, `property_id`) |
| "Lead" | `leads` — 48 columns, `status` and `pipeline_stage` are free text |
| "Task session" | **nothing** — client-side `localStorage` in the web app |
| Pipeline stages | a constant in `utils/pipeline-stages.ts`, not a table |

### `assets.status` has two success values

`Ready` **and** `Draft` both mean finished, depending on which code path completed
the render (`video/callback`, `video-sync-helper`). In-flight rows are sometimes
identified only by a `.../processing` sentinel in `url`.

A client that treats only `Ready` as terminal spins forever. `AssetStatus.parse()`
folds both into `ready` and checks the URL sentinel.

### Type drift

`supabase/database.types.ts` is stale. Routes read and write columns it does not
declare: `profiles.is_disabled`, `profiles.industry`, `profiles.selected_templates`,
`leads.last_call_at`, `leads.dnp_count`, and entire migration-only tables
(`agent_events`, `agent_policies`).

Consequence: **every model parses defensively** (`core/utils/json.dart`) rather
than casting. PostgREST returns `numeric` as String and `jsonb` decoded, so blind
casts would crash on real payloads.

---

## 3. Authentication reality for a native client

Three mechanisms coexist:

| Mechanism | Routes | Native friendly? |
|---|---|---|
| Supabase SSR **cookies** | most `app/api/**` | **No** — chunked, rotating, and `/api` is excluded from the middleware refresh loop (`middleware.ts`), so there is no transparent refresh. Dies after ~1h with no recovery |
| `Authorization: Bearer` | ~9 routes (`crm/leads`, `crm/lead-action`, `crm/followup`, `crm/call-logs`, `notifications`, `video/generate|script|concepts`, …) | **Yes** |
| HMAC capability token | `creatives/picker-session` | Yes, but for an unauthenticated external client |

**Decision:** native auth via GoTrue, and `Bearer` for the API. Cookie replay was
rejected — it would look like it works and then fail an hour later.

**Gap:** the routes this app most needs (agent chat, agent approvals, asset
listing) are cookie-only. See §5.

---

## 4. Tenant isolation is application-level

RLS is enabled on ~22 migration files, but
`20260630000700_fix_all_rls_policies.sql` replaced the working
`auth.uid() = user_id` predicates with:

```sql
CREATE POLICY "leads_all_policy" ON public.leads
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

…on `leads`, `assets`, `properties`, `notifications`, `video_tasks`,
`campaign_jobs`, and `profiles` reads are open to all authenticated users.

**Consequence for this app:** RLS cannot be relied on for scoping. Every query
adds `.eq('user_id', uid)` explicitly. Anything else would let one tenant read
another's leads.

---

## 5. The AI agent endpoint

`POST /api/agent/v2/chat` — the most important route, and the most constrained.

| Property | Finding |
|---|---|
| Auth | Supabase **cookie only** — no Bearer branch |
| Authorisation | **`super_admin` only.** Returns `403 "Nobo is restricted to Super Admin only"` for every other role (plus one hard-coded founder email) |
| Response | AI SDK v6 **UI message stream** over SSE (`toUIMessageStreamResponse`), frames `text-delta`, `reasoning-delta`, `tool-input-start/available`, `tool-output-available/error`, `finish` |
| Conversation state | **None.** No `conversationId` is read; nothing but a telemetry row is written. Full history must be re-sent every turn |
| Limits | `maxDuration = 60` (hard stream cap), `stepCountIs(10)` (max tool round-trips) |
| Tools | ~60 across 13 suites: an E2B Linux sandbox, Nobogent app MCP, Meta Ads MCP, web research, scheduling, and human-in-the-loop |
| Artifacts | Returned inside `tool-output-available.output.artifact` — `video_player`, `image_preview`, `action_confirmation`, `user_input_prompt`, `whatsapp_preview`. The declared TypeScript union is narrower than reality |

### Approvals (`human_approval.ts`, `/api/agent/v2/action`)

The agent can request a decision (`whatsapp_broadcast`, `bulk_call`, `delete_data`,
`ad_spend`, `custom`). **Approving does not execute anything** — the route updates
status and synthesises a result object. It is a state-machine placeholder.

The UI therefore says "approved", never "sent". This is deliberately honest.

### Two latent backend defects worth reporting

1. `agent_events.scheduled_for` is `TIMESTAMPTZ NOT NULL` with no default, but both
   the approval insert and the telemetry insert omit it. Those inserts fail and the
   error is only `console.warn`ed — so the approval card renders but the follow-up
   lookup can 404.
2. In `generate-caption`, `isVideo` is referenced before its declaration (TDZ), so
   the `sharp` downscale silently never runs — a cost/latency issue, not a crash.

Neither was fixed: this project does not modify backend behaviour.

---

## 6. Other findings that shaped decisions

| Finding | How the app responds |
|---|---|
| `GET /api/crm/leads` ignores `page`/`limit` (up to 11 000 rows) while `crm/call-logs` silently caps at 100 | The client caps its own list and filters locally |
| No `/api/projects` CRUD; projects are creatable only via `allocate-delivery` | Projects are read-only in this client; creation routes through the agent |
| No FCM/APNs token column (`push_subscriptions` is web-push only) | Native push is **not** implemented — see LIMITATIONS |
| `POST /api/upload` and `/api/questions/resolve` have **no authentication** | Deliberately not used by this client |
| `notifications/preferences` has a genuine Bearer branch | Preferences are callable natively if needed later |
| The web bottom bar carries 11 role-gated items | Reduced to 5 native tabs; the rest live inside Projects and Settings |

---

## 7. Brand and design tokens (measured, not assumed)

| Asset | Finding |
|---|---|
| **Logo** | The logomark is an **orbital swirl in violet → indigo** (`#6020D0` → `#4840D0`), sampled directly from `public/nobogent-logo.png` |
| Marketing palette | navy `#003D6F` / `#124376`, crimson `#B31B20`, gold `#D4AF37` |
| App chrome | white, `#F8FAFC` page, `slate-900 #0F172A` text, `#2563EB` action blue |
| `tailwind.config.ts` primary/accent/surface | `#D0E8FF` / `#FFD8E4` / `#F8F9FF` — **dead code**, 2/0/0 usages. Ignored |
| Typography | Inter (variable), body tracking `-0.011em`, headings `-0.022em` |
| Dark mode | effectively absent in the PWA (root layout forces light) |

**Design decision:** the mobile identity is built on the **logomark's violet → indigo**
because that is the one brand asset users actually recognise. Navy/crimson/gold are
retained as *accent* roles (depth, approval, credits). Inter is shipped as a bundled
variable font with the same negative tracking, so type matches the web product
exactly.

---

## 8. What this client reuses vs. reimplements

| Reused unchanged | Reimplemented in Flutter |
|---|---|
| Supabase project, GoTrue auth, all data | Every screen (the PWA is a WebView today) |
| `/api/crm/lead-action`, `notifications`, `video/*` via Bearer | Navigation, layout, motion, gestures |
| R2 media URLs | Platform-adaptive components |
| Business rules (pipeline stages, credit semantics) | Task-session model (which the backend lacks) |
| `com.nobogent.app` identity | Store icons and launch screens |
