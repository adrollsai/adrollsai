-- ============================================================================
-- 20261111160200_automation_defaults_existing_tenants.sql
--
-- 20261111160000 backfilled tenant_automations for the 92 existing tenants with
-- every feature ON. That would have had three side effects nobody asked for:
--
--   ai_calling      -> the new cadence cron would begin dialling ~14,000 fresh
--                      leads across 19 tenants, from those tenants' own lines.
--   weekly_whatsapp -> weekly template sends billed to THEIR Meta accounts at
--                      ~1.08/message.
--
-- The product decision is: default ON for NEW accounts (onboarding provisions
-- those rows with the table defaults), and quiet for existing accounts until
-- they opt in from the dashboard.
--
-- daily_creative / video_reel / website_autobuild stay on: the image pipeline
-- was already generating for the 10 enrolled properties, so this preserves
-- current behaviour rather than changing it. Video has 0 enrolled properties,
-- so it is inert until someone enrols one.
--
-- To opt EVERYONE in today (e.g. a coordinated launch), run:
--   update public.tenant_automations
--      set ai_calling = true, weekly_whatsapp = true, updated_at = now();
-- ============================================================================

begin;

update public.tenant_automations
   set ai_calling = false,
       weekly_whatsapp = false,
       updated_at = now();

commit;
