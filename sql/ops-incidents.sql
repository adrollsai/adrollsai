-- Ops watchdog: the record of everything the self-healing sweep has seen and done.
--
-- WHY A TABLE AND NOT JUST LOGS
-- A log line is a moment. An incident is a condition with a lifetime: it starts, it
-- recurs every 30 minutes, it may be repaired, and eventually it stops. The sweep runs
-- 48 times a day; without a row to anchor to, the same stuck job would be "found" 48
-- times, the owner would be told 48 times, and nobody could answer "is this new, or is
-- it the same thing that has been broken since Tuesday?"
--
-- `fingerprint` is what makes that possible: a deterministic identity for one condition
-- (class + subject), unique in this table. Seeing the same fingerprint again bumps
-- `last_seen_at` and `occurrences`; it does not create a second row.
--
-- WHY `blast_radius` AND `repair_log` ARE COLUMNS
-- The system is allowed to fix some things and not others, and that difference has to be
-- auditable after the fact. `blast_radius = 'safe'` means this class is on the allowlist
-- in lib/ops/repairs.ts, which can only touch the exact columns it declares. Everything
-- else lands as `needs_approval` and waits for a human. `repair_log` is append-only
-- evidence of what was actually done, not what was intended.

create table if not exists public.ops_incidents (
  id uuid primary key default gen_random_uuid(),

  -- Deterministic identity for one condition. Unique: recurrence updates, never duplicates.
  fingerprint text not null unique,

  -- The detector class that produced it, e.g. 'harness-run-dead-lettered'.
  class text not null,

  severity text not null default 'warning'
    check (severity in ('critical', 'warning', 'info')),

  -- What is wrong, in the owner's language.
  title text not null,
  -- The numbers it came from. Never empty: an incident without evidence is an opinion.
  evidence text not null,
  -- What we would do about it, as a suggestion the owner can disagree with.
  suggested_fix text,

  blast_radius text not null default 'needs_approval'
    check (blast_radius in ('safe', 'needs_approval')),

  status text not null default 'open'
    check (status in ('open', 'repaired', 'resolved', 'needs_approval', 'ignored')),

  -- What the incident is about, so a repair knows exactly which row to touch.
  subject_table text,
  subject_id text,

  -- Tenant affected, when the problem belongs to one. Null means platform-wide.
  user_id uuid references auth.users (id) on delete set null,

  occurrences integer not null default 1,
  repair_attempts integer not null default 0,
  repair_log jsonb not null default '[]'::jsonb,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_repaired_at timestamptz,
  resolved_at timestamptz,
  -- Last time the owner was told about this fingerprint, so one fault is not 48 alerts.
  notified_at timestamptz,

  -- Anything else the detector wants to keep: ids, counts, error heads.
  detail jsonb
);

-- The sweep's hot query: what is open right now.
create index if not exists ops_incidents_open_idx
  on public.ops_incidents (status, severity, last_seen_at desc);

-- The console's query: newest first, all statuses.
create index if not exists ops_incidents_recent_idx
  on public.ops_incidents (last_seen_at desc);

-- Recurrence detection for one class ("has this happened before?").
create index if not exists ops_incidents_class_idx
  on public.ops_incidents (class, last_seen_at desc);

create index if not exists ops_incidents_user_idx
  on public.ops_incidents (user_id, last_seen_at desc)
  where user_id is not null;

-- Only the service role reads or writes this. There is deliberately no policy for
-- `anon` or `authenticated`: an incident row names a tenant and describes a fault, and
-- a tenant has no business listing the platform's faults. The owner reaches it through
-- /api/ops/incidents, which checks for `super_admin`.
alter table public.ops_incidents enable row level security;

comment on table public.ops_incidents is
  'Conditions found by the ops watchdog (lib/ops). One row per condition, deduplicated by fingerprint; records safe repairs alongside the incidents that need a human.';
comment on column public.ops_incidents.fingerprint is
  'Deterministic identity: class + subject. Recurrence bumps last_seen_at, never inserts.';
comment on column public.ops_incidents.blast_radius is
  'safe = on the repair allowlist in lib/ops/repairs.ts; needs_approval = a human decides.';
