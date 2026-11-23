-- Auto-calling is ON by default for every account (owner's instruction, 2026-11-23).
--
-- Before this: 98 accounts had `auto_call_new_leads = false`, 8 had it true. The consequence was
-- quiet and expensive — a new lead arrived, nobody was told, and the lead went cold. Procolor's
-- two leads (Varun arya, KARTIK) sat at `voice_call_status: not_called` for exactly this reason.
--
-- The webhook still requires a connected voice line before dialling
-- (`hasConnectedVoice` in app/api/webhooks/facebook/route.ts), so an account with no DID is never
-- called even with this flag on. With Vobiz, the caller ID comes from the rotated shared DID pool
-- (utils/vobiz-helper.ts `pickChannel`), not from a per-tenant number.
--
-- To switch a single account back off:
--   update public.profiles set auto_call_new_leads = false where id = '<uuid>;

alter table public.profiles alter column auto_call_new_leads set default true;

update public.profiles set auto_call_new_leads = true where auto_call_new_leads is not true;

comment on column public.profiles.auto_call_new_leads is
  'Dial a new lead automatically on arrival. Defaults to true for every account; still gated on a connected voice line.';
