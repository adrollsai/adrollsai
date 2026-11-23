-- Creative directives: standing instructions about what a creative may contain.
--
-- The owner's ask: "for this property the creative should be such and such each time — and no phone
-- number on it", and "don't put the number on any daily creative". The playbook already holds the
-- prose half of "how this business behaves"; this column holds the scoped, machine-checkable half:
--
--   { "global": [{ "instruction": "...", "bans": ["phone"] }],
--     "properties": { "<property id>": [ ... ] },
--     "campaigns":  { "<campaign id>": [ ... ] } }
--
-- It lives on business_playbooks rather than its own table because every write is already versioned and
-- archived there, so a directive can be explained and rolled back like any other behaviour change.
alter table business_playbooks
  add column if not exists creative_directives jsonb not null default '{}'::jsonb;

comment on column business_playbooks.creative_directives is
  'Scoped standing creative instructions and hard bans (phone, price, emoji, deadlines), enforced by lib/automation/creative-directives.ts';
