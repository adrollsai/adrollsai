-- Phone numbers are stored the way humans typed them ("+91 98726 69935"), so any
-- "does this message come from this business?" lookup has to compare digits, not
-- strings. Doing that in JS means loading every profile on every inbound WhatsApp
-- message; doing it in SQL needs a column that is already normalised.
--
-- These generated columns are the cheapest correct version: Postgres keeps them in
-- sync, they can be indexed, and no application code can forget to update them.

alter table public.profiles add column if not exists whatsapp_digits text
  generated always as (regexp_replace(coalesce(whatsapp_phone_number, ''), '\D', '', 'g')) stored;

alter table public.profiles add column if not exists contact_digits text
  generated always as (regexp_replace(coalesce(contact_number, ''), '\D', '', 'g')) stored;

-- Suffix matching ("%9872669935") is what the lookup needs, and a text_pattern_ops
-- index serves LIKE 'prefix%' - for a suffix we index the reversed string instead.
alter table public.profiles add column if not exists whatsapp_digits_rev text
  generated always as (reverse(regexp_replace(coalesce(whatsapp_phone_number, ''), '\D', '', 'g'))) stored;

alter table public.profiles add column if not exists contact_digits_rev text
  generated always as (reverse(regexp_replace(coalesce(contact_number, ''), '\D', '', 'g'))) stored;

create index if not exists profiles_whatsapp_digits_rev_idx
  on public.profiles (whatsapp_digits_rev text_pattern_ops);

create index if not exists profiles_contact_digits_rev_idx
  on public.profiles (contact_digits_rev text_pattern_ops);
