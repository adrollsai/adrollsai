-- User-uploaded skills for the agent.
--
-- The harness has a skill catalogue (name + when-to-use in the prompt, full body
-- loaded on demand). Until now only we could add entries. This makes the same
-- mechanism available per business, so a client can teach the agent their own way
-- of doing things without us shipping a prompt change.
--
-- Progressive disclosure is the point: `description` is cheap and always visible,
-- `content` is only fetched when the agent decides the skill applies. A client with
-- twenty uploaded skills therefore does not pay for twenty skill bodies on every
-- step.

create table if not exists public.agent_skills (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  name            text not null,
  description     text not null,
  content         text not null,
  source_filename text,
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One skill per name per business, so re-uploading updates instead of duplicating.
create unique index if not exists agent_skills_user_name_idx
  on public.agent_skills (user_id, lower(name));

create index if not exists agent_skills_user_idx
  on public.agent_skills (user_id, created_at desc);

alter table public.agent_skills enable row level security;

drop policy if exists "owners read own skills" on public.agent_skills;
create policy "owners read own skills"
  on public.agent_skills for select
  using (auth.uid() = user_id);

drop policy if exists "owners write own skills" on public.agent_skills;
create policy "owners write own skills"
  on public.agent_skills for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Keep updated_at honest without trusting the client.
create or replace function public.touch_agent_skill()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists agent_skills_touch on public.agent_skills;
create trigger agent_skills_touch
  before update on public.agent_skills
  for each row execute function public.touch_agent_skill();
