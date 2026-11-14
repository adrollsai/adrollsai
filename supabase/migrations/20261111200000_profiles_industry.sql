-- ============================================================================
-- 20261111200000_profiles_industry.sql
--
-- ROOT CAUSE of "everything assumes real estate": `profiles.industry` DID NOT
-- EXIST. Onboarding has always called
--     supabaseAdmin.from('profiles').update({ industry: detectedIndustry })
-- (app/api/onboarding/complete/route.ts:211) and the auto-generate worker calls
-- the same update — both silently failed, because the column was never created.
-- So the app detected a tenant's industry and had nowhere to store it, and every
-- prompt, template and website assumed property sales.
--
-- This adds the column and backfills the obvious non-real-estate tenant so they
-- stop receiving property vocabulary.
-- ============================================================================

begin;

alter table public.profiles
  add column if not exists industry text;

comment on column public.profiles.industry is
  'Detected/declared business vertical, e.g. real_estate, education, immigration, healthcare. Drives website, script and template vocabulary. NULL is treated as real_estate for backwards compatibility.';

-- Backfill: anything clearly not property sales.
update public.profiles
   set industry = 'education'
 where industry is null
   and (
     business_name ilike '%academy%'
     or business_name ilike '%film%'
     or business_name ilike '%school%'
     or business_name ilike '%institute%'
     or business_name ilike '%college%'
     or business_name ilike '%coaching%'
   );

update public.profiles
   set industry = 'immigration'
 where industry is null
   and (business_name ilike '%immigration%' or business_name ilike '%visa%');

update public.profiles
   set industry = 'real_estate'
 where industry is null
   and (
     business_name ilike '%realtor%'
     or business_name ilike '%realty%'
     or business_name ilike '%infra%'
     or business_name ilike '%estate%'
     or business_name ilike '%propert%'
     or business_name ilike '%homes%'
     or business_name ilike '%city%'
   );

commit;
