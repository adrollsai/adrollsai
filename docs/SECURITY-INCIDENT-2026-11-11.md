# Security remediation — 2026-11-11

Status: **fix applied and verified in production** (`hpssqssdewmkmafxlfud`).
Credential rotation is still outstanding — see §5.

## 1. What was wrong

`20260630000700_fix_all_rls_policies.sql` (and its sibling `20260630000400`) created
RLS policies like:

```sql
CREATE POLICY "leads_select_policy" ON public.leads FOR SELECT USING (true);
```

A policy with no `TO` clause applies to `PUBLIC` — **every role, including `anon`**.
Combined with Supabase's default table grants to `anon`, and the fact that the anon key
ships in the browser bundle as `NEXT_PUBLIC_SUPABASE_ANON_KEY`, the whole `public`
schema was world-readable with no login. The later `TO authenticated` policies were
simply OR'd on top and never constrained anything.

Measured live before the fix, using only the public anon key with **no session**:

| Table | Rows readable anonymously |
|---|---|
| `leads` | 39,112 (name, phone, email) |
| `assets` | 1,953 |
| `properties` | 181 |
| `profiles` | 11 — **all 11** exposed `whatsapp_access_token`, 10 exposed `facebook_token`, 1 exposed `elevenlabs_api_key` |

Additionally, `anon` held `EXECUTE` on every `SECURITY DEFINER` function, including the
leftover migration helper `migrate_auth_identity(...)`, which `INSERT`s arbitrary rows
into `auth.identities`. That is an account-takeover primitive, not just a data leak.

Writes were **not** possible anonymously — existing `UPDATE`/`DELETE` predicates all
depend on `auth.uid()`, which is `NULL` for `anon`. It was a read breach.

Logged-in users (`authenticated`) also had `USING (true)` on ~30 tables, so any of the
94 accounts — including 53 low-privilege `agent` accounts — could read every other
tenant's leads, wallets, transactions and credentials.

## 2. What changed

Migrations (applied):

- `20261111150000_security_lockdown_anon.sql` — revokes `anon` at the **grant** level
  (checked before RLS) on every public table, then re-grants only the public marketing
  columns on `profiles`, `properties`, `landing_pages`, `posts`. Revokes `EXECUTE` from
  `PUBLIC`/`anon` on all functions and removes `authenticated` access to
  `migrate_auth_identity`. Sets default privileges so new functions do not re-open it.
- `20261111150100_security_tenant_isolation.sql` — drops every `USING (true)` policy;
  restores the pre-existing tenant-scoped policies on `leads`/`properties`/`assets`/
  `video_tasks`/`campaign_jobs`/`campaign_analyses`/`qualification_forms`; adds uniform
  `tenant_isolation` policies elsewhere. Tenant resolution lives in `SECURITY DEFINER`
  helpers (`is_same_tenant`, `is_super_admin`, `auth_parent_id/agency_id/org_id`) because
  an inline predicate makes `profiles` reference itself and Postgres aborts with
  *"infinite recursion detected in policy for relation profiles"* — the exact bug that
  caused the original author to fall back to `USING (true)`.
- `20261111150200_security_tenant_isolation_followup.sql` — scopes `fractions` and
  `creative_prompts` through their `property_id` relation, and removes
  `organizations_all_policy`, which `20260630000400` had accidentally created **on
  `distribution_batches`** instead of `organizations`.

Code:

- `app/api/public/booking/[lead_id]/route.ts` — new service-role endpoint so public
  booking pages never touch `leads` as `anon`. The lead UUID is the capability token.
- `app/booking/[lead_id]/page.tsx`, `app/shared/booking/[lead_id]/page.tsx`,
  `app/shared/[user_id]/booking/[lead_id]/page.tsx` — now use that endpoint.
- `app/shared/[user_id]/page.tsx` — the anonymous catalogue page replaced three
  `select('*')` calls (profiles, properties, posts) with explicit public projections.
- `app/dashboard/test-auth/page.tsx` — no longer reads another user's `facebook_token`
  from the browser.

Rollback: `supabase/rollback/20261111150000_security_rollback.sql` (deliberately outside
`supabase/migrations/` so `db push` never applies it). It re-opens the breach — prefer
fixing forward.

## 3. Verification

Anonymous, no session, after the fix:

| Probe | Before | After |
|---|---|---|
| `GET /rest/v1/leads` | 206, 39,112 rows | **401** |
| `GET /rest/v1/assets` | 206, 1,953 rows | **401** |
| `GET /rest/v1/profiles?select=whatsapp_access_token` | 200 | **401** |
| `GET /rest/v1/profiles?select=*` | 200 | **401** |
| `POST /rest/v1/rpc/migrate_auth_identity` | executable | **404** |
| `GET /rest/v1/profiles?select=id,business_name,logo_url` | 200 | 200 (unchanged) |
| `GET /rest/v1/properties?select=id,title,price` | 200 | 200 (unchanged) |

Tenant isolation, simulated with `request.jwt.claims` inside rolled-back transactions:

| Identity | `leads` | `profiles` | `properties` |
|---|---|---|---|
| `super_admin` | 39,114 | 94 | 181 |
| `agent` (before) | 39,114 | 94 | 181 |
| `agent` (after) | **456** | **2** | **26** |

## 4. Deliberately left permissive

- `ads` — no tenant column at all (`id, created_at, title, description, price, image_url`),
  so it carries no tenant-identifying data. Unreachable by `anon` (no grant).
- `landing_pages` public read — public page hosting is the feature; anonymous users are
  limited to safe columns by grant.
- `gbp_audit_campaigns`, `gbp_audit_reports`, `review_feedbacks` — anonymous audit tool
  and public review collection by design.
- `image_analysis_cache` — shared cache, now restricted to signed-in users only.

## 5. OUTSTANDING — do these next

1. **Rotate every credential that was publicly readable.** Assume compromise for all 11
   whitelabel profiles and, because every `authenticated` user could read all 94 rows,
   for the remaining tenants too:
   - Meta / Facebook: `facebook_token`, `selected_page_token`, `ad_account_id`
   - WhatsApp Cloud API: `whatsapp_access_token`, `whatsapp_phone_number_id`, `whatsapp_waba_id`
   - ElevenLabs: `elevenlabs_api_key` (3 rows), `elevenlabs_agent_id`
   - Google: `google_business_token`, `google_business_refresh_token`, `google_refresh_token`
   - Twilio: `voice_twilio_token`, `voice_twilio_sid`
   - `webhook_token_99acres`, `domain_verify_token`, `whitelabel_verify_token`
2. **Review logs** for enumeration of `/rest/v1/leads` before 2026-11-11 (Supabase logs
   viewer + any CDN/WAF logs). 39,112 buyer phone numbers is a reportable personal-data
   breach under the DPDP Act 2023 — get legal advice on notification obligations.
3. **Drop `public.migrate_auth_identity` entirely** once confirmed unused (access is
   already revoked).
4. **Move secrets out of `profiles`** into a `profile_secrets` table readable only by the
   owner (`id = auth.uid()`), so a team member can never read the business owner's tokens.
5. `app/dashboard/ads/page.tsx:1609` still does `assets.select('*')` with no tenant
   filter — safe now via RLS, but worth an explicit filter.
6. Add a CI guard: fail the build if any policy in `pg_policies` has `qual = 'true'` or
   a policy without a `TO` clause on a tenant table.

## 6. Smoke test before trusting this

Logged in as a normal owner, as an agency, as an agent, and as a super_admin:

- Dashboard loads properties, assets, leads (non-empty).
- CRM lead list + lead detail page.
- Landing page generator progress poller (`/dashboard/pages`, reads `campaign_jobs`).
- Reference library shows both global (`user_id IS NULL`) and own creatives.
- Public catalogue at `/shared/<uuid>` and at a custom domain.
- A booking link (`/booking/<lead_id>`) opens and can reschedule.
- Whitelabel login page on a custom domain renders branding.
