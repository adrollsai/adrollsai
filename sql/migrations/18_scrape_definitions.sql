-- Stored scrape definitions (the `scrape` skill).
--
-- A definition is a NAMED, VERSIONED extraction schema: which pages to read,
-- which repeated element is a row, and which fields to pull from each row. It is
-- stored rather than kept in a prompt so it can be re-run and diffed, and so its
-- fingerprint can key the R2 response cache (`version` below).
--
-- Nothing here is site-specific or industry-specific: `definition` is opaque
-- JSON validated by lib/agent/scraping/extract.ts, and `version` is the
-- sha256-prefix fingerprint of that JSON. Applying this migration is optional —
-- without it the definition store falls back to files under
-- .nobogent/scraping/definitions/ and says so.

create table if not exists public.agent_scrape_definitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  definition jsonb not null,
  -- Fingerprint of `definition` (first 16 hex chars of sha256 of its canonical
  -- JSON). Part of the response-cache key, so a definition can be re-run and the
  -- two runs compared.
  version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_scrape_definitions_name_len check (char_length(name) between 2 and 64)
);

-- One definition name per account: saving the same name replaces the body (and
-- therefore the version), which is what makes "re-run and diff" meaningful.
create unique index if not exists agent_scrape_definitions_user_name_key
  on public.agent_scrape_definitions (user_id, name);

create index if not exists agent_scrape_definitions_user_idx
  on public.agent_scrape_definitions (user_id, updated_at desc);

alter table public.agent_scrape_definitions enable row level security;

-- A business sees and edits only its own definitions. Service-role callers (the
-- agent runtime) bypass RLS, which is how the skill reads them.
drop policy if exists "agent_scrape_definitions owner read" on public.agent_scrape_definitions;
create policy "agent_scrape_definitions owner read"
  on public.agent_scrape_definitions for select
  using (auth.uid() = user_id);

drop policy if exists "agent_scrape_definitions owner write" on public.agent_scrape_definitions;
create policy "agent_scrape_definitions owner write"
  on public.agent_scrape_definitions for insert
  with check (auth.uid() = user_id);

drop policy if exists "agent_scrape_definitions owner update" on public.agent_scrape_definitions;
create policy "agent_scrape_definitions owner update"
  on public.agent_scrape_definitions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "agent_scrape_definitions owner delete" on public.agent_scrape_definitions;
create policy "agent_scrape_definitions owner delete"
  on public.agent_scrape_definitions for delete
  using (auth.uid() = user_id);
