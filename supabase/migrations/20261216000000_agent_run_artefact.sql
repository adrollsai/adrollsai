-- ============================================================================
-- 20261216000000_agent_run_artefact.sql
--
-- WHERE THE FILM'S R2 KEY LIVES.
--
-- 20261215000000_agent_runs.sql gave a run a checkpoint (what has been done and
-- paid for) but nowhere to say WHAT IT PRODUCED. The `video` skill
-- (lib/agent/tools/skills/video/index.ts) finishes by publishing a rendered film
-- to R2, and the run row is the only durable record that survives the sandbox
-- being paused, recycled or killed: without these columns a finished run and a
-- failed one look identical from the database, and the only copy of the key is in
-- a log line that may already have rotated.
--
-- Additive only: three nullable columns and a partial index. No existing column is
-- altered, renamed or dropped, and every previous query keeps working.
--
-- `artefact_key` is the R2 object key (`video/<slug>/final.mp4`), `artefact_url`
-- the public URL the app can hand to a browser, and `artefact_meta` the facts that
-- are useful to a human reading the row later: duration, byte size, fps, aspect,
-- and the render's own `hyperframes check --json` counts. Nullable throughout,
-- because a run that has not finished has no artefact, and a run that failed must
-- not be forced to invent one.
--
-- The skill WRITES these; it does not require them. If this migration is not
-- applied, lib/agent/tools/skills/video/index.ts records
-- `{ recorded: false, reason }` and logs the key rather than failing a render that
-- already succeeded — see recordRunArtefact().
-- ============================================================================

alter table public.agent_runs
  add column if not exists artefact_key  text,
  add column if not exists artefact_url  text,
  add column if not exists artefact_meta jsonb;

comment on column public.agent_runs.artefact_key is
  'R2 object key of the deliverable this run produced (e.g. video/<slug>/final.mp4). NULL until the render step publishes.';
comment on column public.agent_runs.artefact_url is
  'Public URL for artefact_key, so a dashboard or a delivery path never has to rebuild it.';
comment on column public.agent_runs.artefact_meta is
  'Facts about the artefact: { seconds, bytes, fps, aspect, slug, job_id, check: { errors, warnings } }.';

-- "Show me this tenant's finished films" is the one query this serves.
create index if not exists agent_runs_artefact_idx
  on public.agent_runs (user_id, updated_at desc)
  where artefact_key is not null;
