-- ============================================================================
-- 20261111150000_security_lockdown_anon.sql
--
-- CRITICAL: the `anon` role (the public API key that ships in the browser bundle)
-- could read the ENTIRE public schema, with no login.
--
-- Root cause: migrations 20260630000400 + 20260630000700 created policies as
--     CREATE POLICY "..." ON public.leads FOR SELECT USING (true);
-- with no `TO` clause. In PostgreSQL a policy without `TO` applies to PUBLIC —
-- i.e. every role, including `anon`. Combined with Supabase's default table
-- grants to `anon`, the `USING (true)` predicates became a public read grant.
-- The later `TO authenticated` "all" policies were simply OR'd on top.
--
-- Verified live against project hpssqssdewmkmafxlfud before this migration,
-- using the public anon key and NO session:
--     leads        39,112 rows readable
--     properties      181 rows readable
--     assets        1,953 rows readable
--     profiles         11 rows readable — ALL 11 exposed whatsapp_access_token,
--                      10 exposed facebook_token, 1 exposed elevenlabs_api_key
--     anon could also EXECUTE every SECURITY DEFINER function, including the
--     leftover migration helper auth.migrate_auth_identity(), which writes
--     arbitrary rows into auth.identities.
--
-- This migration revokes anon at the GRANT level (evaluated before RLS) and
-- re-grants only the columns genuinely public pages need. It does not touch
-- `authenticated` or `service_role`.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Revoke every anon table privilege except the intentionally public tables
--    (GBP audit tool + public review collection are meant to be anonymous).
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname <> all (array[
        'gbp_audit_campaigns',
        'gbp_audit_reports',
        'review_feedbacks'
      ])
  loop
    execute format('revoke all on table public.%I from anon', r.relname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Re-grant the public marketing surface only.
--    Never include: whatsapp_access_token, whatsapp_phone_number_id,
--    whatsapp_waba_id, facebook_token, selected_page_token, ad_account_id,
--    linkedin_token, youtube_token/refresh, google_*_token/refresh,
--    elevenlabs_api_key, voice_twilio_*, webhook_token_99acres,
--    domain_verify_token, whitelabel_verify_token, credits/subscription fields.
-- ---------------------------------------------------------------------------
grant select (
  id, business_name, full_name, logo_url, brand_color, mission_statement,
  contact_number, email, address, business_info, custom_domain, whitelabel_domain,
  facebook_url, instagram_url, linkedin_url, youtube_url, whatsapp_phone_number,
  avatar_url, pixel_id, google_place_id, google_review_url,
  google_booking_duration, google_booking_hours, google_booking_enabled,
  business_landing_enabled, business_landing_hero_title,
  business_landing_hero_subtitle, business_landing_show_products,
  currency, created_at
) on public.profiles to anon;

grant select (
  id, user_id, title, address, price, description, property_type, status,
  image_url, images, master_creatives, rera_number, brochure_url, floor_plan_url,
  configurations, youtube_url, show_on_landing_page, created_at
) on public.properties to anon;

grant select (
  id, user_id, slug, title, product_name, html_content, booking_enabled,
  property_id, created_at, updated_at
) on public.landing_pages to anon;

grant select (
  id, created_at, user_id, title, content, excerpt, image_url, tags,
  media_type, media_url, link_url, youtube_url, status
) on public.posts to anon;

-- ---------------------------------------------------------------------------
-- 3. SECURITY DEFINER functions bypass RLS entirely, so EXECUTE privilege is a
--    second, independent back door. anon held it on all of them (Postgres grants
--    EXECUTE to PUBLIC by default).
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;
grant execute on all functions in schema public to authenticated, service_role;

-- future functions must not silently re-open the hole
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public grant execute on functions to authenticated, service_role;

-- Dead migration helper that writes to auth.identities. Nothing calls it
-- (verified: no .rpc('migrate_auth_identity') anywhere in the app).
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'migrate_auth_identity'
  loop
    execute format('revoke execute on function %s from anon, authenticated', r.sig);
  end loop;
end $$;

commit;
