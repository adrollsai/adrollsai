-- Follow-up accounting: review queries, not repairs.
--
-- These are read-only. They exist so the duplicate rows the old client wrote can be reviewed
-- by a human before anything is deleted — nothing here mutates data.
--
-- Context: before the fix, `UpdateFollowupModal` aborted its request after 12 seconds and then
-- unconditionally wrote the follow-up again through a direct Supabase fallback. Aborting is a
-- client-side act, so the server usually committed anyway. The result is pairs of lead_history
-- rows on the same lead, 0–2 seconds apart, one attributed ("… updated by <name>") and one not
-- ("… updated. Stage: …"), with `custom_fields.followup_count` incremented twice.
--
-- The counting logic now collapses such pairs, so dashboards are already correct. This file is
-- only for deciding whether the stored rows should also be tidied.

-- ── 1. Suspected duplicate pairs ──────────────────────────────────────────────
-- A same-lead, same-actor pair of follow-up rows within 5 seconds.
SELECT
  a.lead_id,
  l.name                                   AS lead_name,
  a.user_id,
  p.full_name                              AS actor,
  a.created_at                             AS first_write,
  b.created_at                             AS second_write,
  EXTRACT(EPOCH FROM (b.created_at - a.created_at))::numeric(10,2) AS gap_seconds,
  (a.description LIKE '%updated by %')     AS first_attributed,
  (b.description LIKE '%updated by %')     AS second_attributed
FROM lead_history a
JOIN lead_history b
  ON b.lead_id = a.lead_id
 AND b.user_id IS NOT DISTINCT FROM a.user_id
 AND b.created_at > a.created_at
 AND b.created_at < a.created_at + interval '5 seconds'
 AND b.id > a.id
JOIN leads l    ON l.id = a.lead_id
LEFT JOIN profiles p ON p.id = a.user_id
WHERE a.action_type IN ('FOLLOWUP', 'STATUS_CHANGE')
  AND b.action_type IN ('FOLLOWUP', 'STATUS_CHANGE')
  AND a.created_at >= now() - interval '90 days'
ORDER BY a.created_at DESC;

-- ── 2. How many rows are affected, per rep ────────────────────────────────────
SELECT
  p.full_name                          AS rep,
  count(*)                             AS duplicate_pairs,
  min(a.created_at)                    AS first_seen,
  max(a.created_at)                    AS last_seen
FROM lead_history a
JOIN lead_history b
  ON b.lead_id = a.lead_id
 AND b.user_id IS NOT DISTINCT FROM a.user_id
 AND b.created_at > a.created_at
 AND b.created_at < a.created_at + interval '5 seconds'
 AND b.id > a.id
JOIN profiles p ON p.id = a.user_id
WHERE a.action_type IN ('FOLLOWUP', 'STATUS_CHANGE')
  AND b.action_type IN ('FOLLOWUP', 'STATUS_CHANGE')
GROUP BY 1
ORDER BY duplicate_pairs DESC;

-- ── 3. Leads whose stored followup_count overstates the real number ──────────
-- `followup_count` is incremented per write, so a duplicate pair inflates it by one.
-- Compare it with the number of distinct follow-up events actually recorded.
WITH real AS (
  SELECT
    lead_id,
    count(*) AS history_followups
  FROM lead_history
  WHERE action_type IN ('FOLLOWUP', 'STATUS_CHANGE', 'REMARK', 'CALL_FEEDBACK')
  GROUP BY lead_id
)
SELECT
  l.id,
  l.name,
  p.full_name                                              AS assignee,
  (l.custom_fields::jsonb ->> 'followup_count')            AS stored_followup_count,
  r.history_followups,
  (l.custom_fields::jsonb ->> 'followup_count')::int - r.history_followups AS drift
FROM leads l
JOIN real r ON r.lead_id = l.id
LEFT JOIN profiles p ON p.id = l.assigned_to
WHERE l.custom_fields IS NOT NULL
  AND l.custom_fields::jsonb ? 'followup_count'
  AND (l.custom_fields::jsonb ->> 'followup_count')::int > r.history_followups
ORDER BY drift DESC
LIMIT 100;

-- ── 4. Leads whose next action was saved in the past ─────────────────────────
-- The old form accepted these silently. No longer possible, but existing rows still carry the
-- typo, and a past next action is what used to pull a follow-up out of "today".
SELECT
  l.id,
  l.name,
  p.full_name                                                        AS assignee,
  to_char(l.next_followup AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS next_followup_ist,
  l.custom_fields::jsonb ->> 'next_action_type'                      AS next_action_type,
  l.custom_fields::jsonb ->> 'last_followup_remark'                  AS last_remark
FROM leads l
LEFT JOIN profiles p ON p.id = l.assigned_to
WHERE l.next_followup IS NOT NULL
  AND l.next_followup < now() - interval '2 days'
  AND coalesce(l.pipeline_stage, '') NOT IN ('Lost', 'Lost/NI', 'Already Purchased', 'Deal Won')
ORDER BY l.next_followup DESC
LIMIT 200;

-- ── 5. Follow-ups that mention a meeting but were saved as a call ────────────
-- Aniket Chouhan's "18 nov 9pm ko meet ka bol rahe hai" is the shape of this: the appointment
-- lives only in prose, so it never got a booked_time and never appeared in a booking view.
SELECT
  l.id,
  l.name,
  p.full_name                                                   AS assignee,
  l.custom_fields::jsonb ->> 'last_followup_remark'             AS last_remark,
  l.custom_fields::jsonb ->> 'next_action_type'                 AS next_action_type,
  to_char(l.next_followup AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS next_followup_ist,
  l.booked_time
FROM leads l
LEFT JOIN profiles p ON p.id = l.assigned_to
WHERE l.custom_fields::jsonb ->> 'last_followup_remark' ~* '(meet|meeting|demo|appointment|\d{1,2}\s*(pm|am))'
  AND l.booked_time IS NULL
  AND l.next_followup > now() - interval '7 days'
ORDER BY l.next_followup DESC
LIMIT 100;
