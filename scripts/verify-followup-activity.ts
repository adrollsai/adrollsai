/**
 * Follow-up accounting: one number per rep, or no number at all.
 *
 * The fixtures below are the real production rows for Devraj Singh Rathore on 19 Nov 2026.
 * He logged nine follow-ups across nine leads. The Analytics page told him seven, because:
 *
 *   • the Action Report re-dated each row from the first date-like token in its description,
 *     which for offline-written rows is the NEXT ACTION date the agent typed, so four rows
 *     fell outside "today";
 *   • one of those dates was "11/17/2026", read as month 17 and rolled into May 2027;
 *   • note blocks written by the offline fallback carry no "by <name>", and an empty name
 *     matched every rep through `name.includes('')`, so his work was credited to whoever
 *     sorted first;
 *   • the Followup Board on the same page counted the same rows a third way and said 11.
 *
 * This gate pins the rules that make those four failures impossible, and reproduces the old
 * arithmetic alongside the new one so the 7-vs-9 regression can never come back unnoticed.
 *
 *   npm run verify:followup-activity
 */
import {
  classifyHistoryRow,
  countFollowupActivity,
  extractNoteAuthor,
  isBookableActionType,
  matchRepByName,
  parseNoteBlockTime,
  parseNoteHeaderTime,
} from '../utils/followup-activity';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);

/* ──────────────────────────────────────────────────────────────────────────── */
/* Fixtures: Devraj's real rows                                               */
/* ──────────────────────────────────────────────────────────────────────────── */

const DEVRAJ = 'devraj-uuid';
// Deliberately first in the rep list: the old empty-name match credited unattributed
// note blocks to whoever happened to sit at index 0.
const REPS = [
  { id: 'test-business-uuid', name: 'Test Business', email: 'test@business.test' },
  { id: 'akshay-uuid', name: 'Akshay Pathade', email: 'akshay@example.com' },
  { id: DEVRAJ, name: 'Devraj', email: 'devraj@example.com' },
];

const T = (iso: string) => iso;
const HISTORY = [
  {
    lead_id: 'yes',
    user_id: DEVRAJ,
    action_type: 'STATUS_CHANGE',
    description: '📝 Followup (Call) updated by Devraj Singh Rathore. Stage: Lost/NI, Rating: Hot.',
    created_at: T('2026-11-19T06:42:39.614Z'), // 12:12:39 IST
  },
  {
    lead_id: 'jay',
    user_id: DEVRAJ,
    action_type: 'REMARK',
    description:
      '⚠️ Call Not Picked (DNP) logged by Devraj Singh Rathore. Next Action: Call on 11/17/2026, 11:00:00 AM.',
    created_at: T('2026-11-19T08:10:55.813Z'), // 13:40:55 IST
  },
  {
    lead_id: 'parv',
    user_id: DEVRAJ,
    action_type: 'FOLLOWUP',
    description:
      '📝 Followup (Call) updated by Devraj Singh Rathore. Stage: Contacted, Rating: Warm. Remarks: Details sent on whatapp',
    created_at: T('2026-11-19T08:11:27.407Z'), // 13:41:27
  },
  {
    lead_id: 'raj',
    user_id: DEVRAJ,
    action_type: 'FOLLOWUP',
    description:
      '📝 Followup (Call) updated by Devraj Singh Rathore. Stage: Meeting Planned, Rating: Warm. Remarks: WhatsApp details sent',
    created_at: T('2026-11-19T08:14:26.000Z'), // 13:44:26
  },
  {
    lead_id: 'rajan',
    user_id: DEVRAJ,
    action_type: 'FOLLOWUP',
    description:
      '📝 Followup (Call) updated by Devraj Singh Rathore. Stage: Contacted, Rating: Hot. Remarks: Details pushed out itw hot',
    created_at: T('2026-11-19T08:35:41.000Z'), // 14:05:41
  },
  {
    lead_id: 'karan',
    user_id: DEVRAJ,
    action_type: 'FOLLOWUP',
    description:
      '📝 Followup (Call) updated. Stage: Contacted. Remarks: All details sent waiting for meet  Next Action: Call on 11/10/2026, 11:00:00',
    created_at: T('2026-11-19T08:36:22.000Z'), // 14:06:22
  },
  {
    lead_id: 'ashish',
    user_id: DEVRAJ,
    action_type: 'FOLLOWUP',
    description:
      "📝 Followup (Call) updated by Devraj Singh Rathore. Stage: Contacted, Rating: Warm. Remarks: Hasn't responded inspite of all serials",
    created_at: T('2026-11-19T08:36:51.000Z'), // 14:06:51 — first write
  },
  {
    lead_id: 'ashish',
    user_id: DEVRAJ,
    action_type: 'FOLLOWUP',
    description:
      "📝 Followup (Call) updated. Stage: Contacted. Remarks: Hasn't responded inspite of all serials  Next Action: Call on 21/10/2026, 15:40:00",
    created_at: T('2026-11-19T08:36:51.400Z'), // 14:06:51 — duplicate write, same second
  },
  {
    lead_id: 'ratul',
    user_id: DEVRAJ,
    action_type: 'FOLLOWUP',
    description:
      "📝 Followup (Call) updated. Stage: Contacted. Remarks: Didn't show up and called and whatapp him today again  Next Action: Call on 12/10/2026, 17:03:00",
    created_at: T('2026-11-19T08:37:29.000Z'), // 14:07:29
  },
  {
    lead_id: 'cibin',
    user_id: DEVRAJ,
    action_type: 'FOLLOWUP',
    description:
      '📝 Followup (Call) updated by Devraj Singh Rathore. Stage: Contacted, Rating: Warm. Remarks: Details sent out. Waiting for meet',
    created_at: T('2026-11-19T08:38:00.000Z'), // 14:08:00 — first write
  },
  {
    lead_id: 'cibin',
    user_id: DEVRAJ,
    action_type: 'FOLLOWUP',
    description:
      '📝 Followup (Call) updated. Stage: Contacted. Remarks: Details sent out. Waiting for meet Next Action: Call on 13/10/2026, 11:00:00',
    created_at: T('2026-11-19T08:38:00.500Z'), // 14:08:00 — duplicate write
  },
];

const noteHeader = (time: string, author: string) =>
  `[📝 Followup (Call) - ${time}${author ? ` by ${author}` : ''}]: Stage: Contacted.`;
const dnpHeader = (time: string, author: string) =>
  `[⚠️ Call Not Picked - DNP (${time})${author ? ` by ${author}` : ''}]: Next action scheduled for 17/11/2026, 11:00:00 am (Call).`;

const LEADS = [
  // Every lead below carries a lead_history row in range, so its notes are gap-fill only and
  // must not add a second event.
  { id: 'yes', assigned_to: DEVRAJ, notes: '', custom_fields: '{}' },
  {
    id: 'jay',
    assigned_to: DEVRAJ,
    notes: `${dnpHeader('19/11/2026, 1:40:54 pm', 'Devraj Singh Rathore')}\n\n${noteHeader('18/11/2026, 5:22:54 pm', 'Devraj Singh Rathore')} Couldn't attend asked me to do it later`,
    custom_fields: JSON.stringify({ last_followup_at: '2026-11-19T08:10:55.813Z', last_followup_type: 'Call (DNP)' }),
  },
  {
    id: 'parv',
    assigned_to: DEVRAJ,
    notes: `${noteHeader('19/11/2026, 1:41:26 pm', 'Devraj Singh Rathore')} Details sent on whatapp`,
    custom_fields: JSON.stringify({ last_followup_at: '2026-11-19T08:11:27.407Z', last_followup_type: 'Call' }),
  },
  {
    id: 'raj',
    assigned_to: DEVRAJ,
    notes: `${noteHeader('19/11/2026, 1:44:25 pm', 'Devraj Singh Rathore')} WhatsApp details sent`,
    custom_fields: JSON.stringify({ last_followup_at: '2026-11-19T08:14:26.000Z', last_followup_type: 'Call' }),
  },
  {
    id: 'rajan',
    assigned_to: DEVRAJ,
    notes: `${noteHeader('19/11/2026, 2:05:41 pm', 'Devraj Singh Rathore')} Details pushed out itw hot`,
    custom_fields: JSON.stringify({ last_followup_at: '2026-11-19T08:35:41.000Z', last_followup_type: 'Call' }),
  },
  {
    // Offline-fallback note: no "by <name>" — the case that used to be miscredited.
    id: 'karan',
    assigned_to: DEVRAJ,
    notes: `${noteHeader('19/11/2026, 2:06:20 pm', '')} All details sent waiting for meet\n\n${noteHeader('10/10/2026, 4:56:53 pm', 'Devraj Singh Rathore')} Requested a call back tomorrow.`,
    custom_fields: JSON.stringify({ last_followup_at: '2026-11-19T08:36:22.000Z', last_followup_type: 'Call' }),
  },
  {
    id: 'ashish',
    assigned_to: DEVRAJ,
    notes: `${noteHeader('19/11/2026, 2:06:49 pm', '')} Hasn't responded inspite of all serials`,
    custom_fields: JSON.stringify({ last_followup_at: '2026-11-19T08:36:51.000Z', last_followup_type: 'Call' }),
  },
  {
    id: 'ratul',
    assigned_to: DEVRAJ,
    notes: `${noteHeader('19/11/2026, 2:07:27 pm', '')} Didn't show up and called and whatapp him today again\n\n${noteHeader('12/10/2026, 3:03:54 pm', 'Devraj Singh Rathore')} Requested me to meet to connect at 5`,
    custom_fields: JSON.stringify({ last_followup_at: '2026-11-19T08:37:29.000Z', last_followup_type: 'Call' }),
  },
  {
    id: 'cibin',
    assigned_to: DEVRAJ,
    notes: `${noteHeader('19/11/2026, 2:07:58 pm', '')} Details sent out. Waiting for meet\n\n${dnpHeader('12/10/2026, 3:04:34 pm', 'Devraj Singh Rathore')}`,
    custom_fields: JSON.stringify({ last_followup_at: '2026-11-19T08:38:00.000Z', last_followup_type: 'Call' }),
  },
];

// 19 Nov 2026, Asia/Kolkata (UTC+05:30).
const DAY_START = new Date('2026-11-18T18:30:00.000Z');
const DAY_END = new Date('2026-11-19T18:29:59.999Z');
const isToday = (value: Date | string | null | undefined) => {
  const d = value instanceof Date ? value : value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return false;
  return d >= DAY_START && d <= DAY_END;
};

/* ──────────────────────────────────────────────────────────────────────────── */
/* 1. The regression itself: 7 before, 9 now                                  */
/* ──────────────────────────────────────────────────────────────────────────── */

head('1. Devraj’s day: nine follow-ups, not seven');

/** The old behaviour, kept here only as the thing being disproved. */
function legacyActionReportTotal(reps: typeof REPS): number {
  const parseActionDate = (text?: string, fallback?: string): Date | null => {
    if (text) {
      const m = text.match(
        /([0-9]{1,2})[/-]([0-9]{1,2})[/-]([0-9]{2,4})(?:,?\s*([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?\s*(am|pm)?)?/i
      );
      if (m) {
        const day = parseInt(m[1], 10);
        const month = parseInt(m[2], 10) - 1;
        let year = parseInt(m[3], 10);
        if (year < 100) year += 2000;
        let hour = m[4] ? parseInt(m[4], 10) : 0;
        const min = m[5] ? parseInt(m[5], 10) : 0;
        const sec = m[6] ? parseInt(m[6], 10) : 0;
        if ((m[7] || '').toLowerCase() === 'pm' && hour < 12) hour += 12;
        if ((m[7] || '').toLowerCase() === 'am' && hour === 12) hour = 0;
        return new Date(Date.UTC(year, month, day, hour, min, sec) - 5.5 * 3600 * 1000);
      }
    }
    return fallback ? new Date(fallback) : null;
  };

  const counts: Record<string, number> = {};
  reps.forEach((r) => (counts[r.id] = 0));
  const seen = new Map<string, Array<{ cat: string; time: number }>>();

  const record = (repId: string | null | undefined, leadId: string, cat: string, when: Date | null) => {
    if (!repId || !when || !isToday(when) || !(repId in counts)) return;
    const existing = seen.get(leadId) || [];
    if (existing.some((e) => e.cat === cat && Math.abs(e.time - when.getTime()) < 30 * 60 * 1000)) return;
    existing.push({ cat, time: when.getTime() });
    seen.set(leadId, existing);
    counts[repId] += 1;
  };

  for (const row of HISTORY) {
    const cat = classifyHistoryRow(row);
    if (!cat) continue;
    record(row.user_id, row.lead_id, cat, parseActionDate(row.description, row.created_at));
  }

  for (const lead of LEADS) {
    const notes = lead.notes || '';
    const chunks = notes.split(/(?=\[(?:📝|⚠️))/).filter(Boolean);
    for (const chunk of chunks) {
      const when = parseActionDate(chunk); // old code parsed the whole chunk, prose included
      if (!when) continue;
      const author = (chunk.match(/by\s+([^\]:\n]+)/i)?.[1] || '').trim().toLowerCase();
      const matched =
        reps.find((r) => {
          const fn = (r.name || '').toLowerCase();
          return fn.includes(author); // '' matches the first rep — the bug
        }) || reps.find((r) => r.id === lead.assigned_to);
      if (!matched) continue;
      record(matched.id, lead.id, 'calls', when);
    }
  }
  return counts[DEVRAJ];
}

const legacy = legacyActionReportTotal(REPS);
check('the old arithmetic still reproduces the complaint (7)', legacy === 7, `legacy=${legacy}`);

const result = countFollowupActivity({ history: HISTORY, leads: LEADS, reps: REPS, isInRange: isToday });
const counts = result.countsByRep[DEVRAJ];
check(
  'the new arithmetic counts all nine follow-ups',
  result.totalByRep[DEVRAJ] === 9,
  `total=${result.totalByRep[DEVRAJ]} calls=${counts.calls} dnp=${counts.dnp}`
);
check('eight calls plus one DNP', counts.calls === 8 && counts.dnp === 1, `calls=${counts.calls} dnp=${counts.dnp}`);
check(
  'nine distinct leads are attributed, one per follow-up',
  new Set(Object.values(result.leadsByRep[DEVRAJ]).flatMap((s) => Array.from(s))).size === 9,
  `${new Set(Object.values(result.leadsByRep[DEVRAJ]).flatMap((s) => Array.from(s))).size} leads`
);

head('2. Nothing leaks to another rep');

check(
  'the rep that sorts first gets none of it',
  result.totalByRep['test-business-uuid'] === 0,
  `first rep total=${result.totalByRep['test-business-uuid']}`
);
check('a rep with no rows gets nothing', result.totalByRep['akshay-uuid'] === 0, `akshay=${result.totalByRep['akshay-uuid']}`);
check(
  'the workspace total equals the sum of the reps',
  Object.values(result.totalByRep).reduce((a, b) => a + b, 0) === 9,
  `sum=${Object.values(result.totalByRep).reduce((a, b) => a + b, 0)}`
);

/* ──────────────────────────────────────────────────────────────────────────── */
/* 3. Timing comes from created_at, never from prose                           */
/* ──────────────────────────────────────────────────────────────────────────── */

head('3. A next-action date can never re-date a follow-up');

check(
  'a row quoting "Next Action: Call on 21/10/2026" still counts today',
  result.leadsByRep[DEVRAJ].calls.has('ashish'),
  'ashish counted'
);
check(
  'a row quoting a past next action still counts today',
  result.leadsByRep[DEVRAJ].calls.has('karan') && result.leadsByRep[DEVRAJ].calls.has('ratul'),
  'karan + ratul counted'
);
check(
  'a DNP row quoting "11/17/2026" is not rolled into 2027',
  result.leadsByRep[DEVRAJ].dnp.has('jay'),
  'jay counted as dnp'
);
check(
  'the duplicate second write does not double the count',
  result.totalByRep[DEVRAJ] === 9,
  'ashish and cibin each counted once'
);

head('4. Note-header parsing is strict and month-order tolerant');

const nov17 = parseNoteHeaderTime('[⚠️ Call Not Picked - DNP (11/17/2026, 11:00:00 am) by Devraj]');
check(
  '17/11 written month-first is read as 17 Nov, not month 17',
  nov17 !== null && nov17.getUTCFullYear() === 2026 && nov17.getUTCMonth() === 10 && nov17.getUTCDate() === 17,
  nov17 ? nov17.toISOString() : 'null'
);

const dayFirst = parseNoteHeaderTime('[📝 Followup (Call) - 19/11/2026, 2:06:20 pm]:');
check(
  'day-first stays day-first',
  dayFirst !== null && dayFirst.getUTCDate() === 19 && dayFirst.getUTCMonth() === 10,
  dayFirst ? dayFirst.toISOString() : 'null'
);

check('a header without a date yields null', parseNoteHeaderTime('[📝 Remark]: no date here') === null);
check(
  'an impossible date is rejected instead of rolled over',
  parseNoteHeaderTime('[📝 Followup - 31/02/2026, 10:00:00 am]') === null,
  '31 February'
);
check(
  'a date in the far future is rejected',
  parseNoteHeaderTime('[📝 Followup - 12/12/2099, 10:00:00 am]') === null
);
check(
  'prose after the header is never consulted',
  parseNoteBlockTime('[📝 Remark]: promised to call on 21/10/2026 at 15:40') === null,
  'no bracketed date, no prose date'
);
check(
  'the bracketed header date is used when present',
  parseNoteBlockTime('[📝 Followup (Call) - 19/11/2026, 2:06:20 pm]: Next Action: Call on 21/10/2026')?.toISOString() ===
    '2026-11-19T08:36:20.000Z',
  parseNoteBlockTime('[📝 Followup (Call) - 19/11/2026, 2:06:20 pm]: Next Action: Call on 21/10/2026')?.toISOString()
);

head('5. Attribution needs a name');

check('an empty name matches no rep', matchRepByName('', REPS) === null);
check('an empty name never yields the first rep', matchRepByName('   ', REPS) === null);
check('a full name matches', matchRepByName('Devraj Singh Rathore', REPS)?.id === DEVRAJ);
check('a partial name matches', matchRepByName('by devraj', REPS)?.id === DEVRAJ);
check('an email matches', matchRepByName('akshay@example.com', REPS)?.id === 'akshay-uuid');
check(
  'an unattributed block hands its author to nobody',
  extractNoteAuthor('[📝 Followup (Call) - 19/11/2026, 2:06:20 pm]: Stage: Contacted.') === ''
);

head('6. Gap-fill cannot double count');

{
  // A lead with a history row in range AND a note block in range: one event, not two.
  const withHistory = countFollowupActivity({
    history: [
      {
        lead_id: 'solo',
        user_id: DEVRAJ,
        action_type: 'FOLLOWUP',
        description: '📝 Followup (Call) updated by Devraj Singh Rathore. Stage: Contacted.',
        created_at: '2026-11-19T08:36:22.000Z',
      },
    ],
    leads: [
      {
        id: 'solo',
        assigned_to: DEVRAJ,
        notes: noteHeader('19/11/2026, 2:06:22 pm', '') + ' details sent',
        custom_fields: '{}',
      },
    ],
    reps: REPS,
    isInRange: isToday,
  });
  check('history row wins and the note is ignored', withHistory.totalByRep[DEVRAJ] === 1, `total=${withHistory.totalByRep[DEVRAJ]}`);
  check(
    'the note does not leak to the first rep either',
    withHistory.totalByRep['test-business-uuid'] === 0,
    `first rep=${withHistory.totalByRep['test-business-uuid']}`
  );
}

{
  // An imported lead with no history at all must still be counted from its notes.
  const notesOnly = countFollowupActivity({
    history: [],
    leads: [
      {
        id: 'imported',
        assigned_to: DEVRAJ,
        notes: noteHeader('19/11/2026, 2:06:22 pm', '') + ' legacy import followup',
        custom_fields: '{}',
      },
    ],
    reps: REPS,
    isInRange: isToday,
  });
  check('an imported lead with only notes is still counted', notesOnly.totalByRep[DEVRAJ] === 1, `total=${notesOnly.totalByRep[DEVRAJ]}`);
  check(
    'and credited to the lead’s assignee, not to whoever sorts first',
    notesOnly.totalByRep['test-business-uuid'] === 0,
    `first rep=${notesOnly.totalByRep['test-business-uuid']}`
  );
}

{
  // Out-of-range rows still drop out — the fix must not inflate a quiet day.
  const quietDay = countFollowupActivity({
    history: HISTORY,
    leads: LEADS,
    reps: REPS,
    isInRange: (v) => {
      const d = v instanceof Date ? v : v ? new Date(v) : null;
      return Boolean(d) && !Number.isNaN(d!.getTime()) && d! >= new Date('2026-11-10T18:30:00.000Z') && d! <= new Date('2026-11-11T18:29:59.999Z');
    },
  });
  check('a different day counts nothing from today’s rows', quietDay.totalByRep[DEVRAJ] === 0, `total=${quietDay.totalByRep[DEVRAJ]}`);
}

head('7. Transfers and imports are not follow-ups');

check(
  'a transfer row is excluded',
  classifyHistoryRow({ action_type: 'TRANSFER', description: '🔄 Lead transferred from Nobogent to Akshay Pathade' }) === null
);
check(
  'a bulk transfer description is excluded',
  classifyHistoryRow({ action_type: 'REMARK', description: 'Bulk transferred 40 leads' }) === null
);
check(
  'a facebook ad submission is excluded',
  classifyHistoryRow({ action_type: 'REMARK', description: 'Facebook ad submission received' }) === null
);
check(
  'a real followup is included',
  classifyHistoryRow({ action_type: 'FOLLOWUP', description: '📝 Followup (Call) updated by X.' }) === 'calls'
);
check(
  'a closing meeting is bucketed as a closing meeting',
  classifyHistoryRow({ action_type: 'FOLLOWUP', description: '📝 Followup (Closing Meeting) updated by X.' }) ===
    'closing_meetings'
);
check(
  'a DNP is never bucketed as a connected call',
  classifyHistoryRow({ action_type: 'REMARK', description: '⚠️ Call Not Picked (DNP) logged by X.' }) === 'dnp'
);
check(
  'a bare stage edit is not a follow-up',
  classifyHistoryRow({ action_type: 'STATUS_CHANGE', description: 'Stage updated to qualified' }) === null
);
check(
  'a follow-up that also moved the stage still counts',
  classifyHistoryRow({
    action_type: 'STATUS_CHANGE',
    description: '📝 Followup (Call) updated by Devraj Singh Rathore. Stage: Lost/NI, Rating: Hot.',
  }) === 'calls'
);
check(
  'a dial attempt counts as a follow-up event',
  classifyHistoryRow({ action_type: 'REMARK', description: '📞 Outbound call initiated by Akshay Pathade to X' }) ===
    'calls'
);

head('8. Credit follows the human, not the workspace that owns the row');

{
  // This is the shape `/api/crm/lead-action` writes: user_id = the workspace owner,
  // actor_id = the signed-in agent.
  const ownedByWorkspace = countFollowupActivity({
    history: [
      {
        lead_id: 'owned',
        user_id: 'test-business-uuid',
        actor_id: DEVRAJ,
        action_type: 'CALL_FEEDBACK',
        description: '📝 Followup (Call) updated by Devraj Singh Rathore. Stage: Contacted.',
        created_at: '2026-11-19T08:36:22.000Z',
      },
    ],
    leads: [],
    reps: REPS,
    isInRange: isToday,
  });
  check(
    'the agent who made the call gets the credit',
    ownedByWorkspace.totalByRep[DEVRAJ] === 1,
    `devraj=${ownedByWorkspace.totalByRep[DEVRAJ]}`
  );
  check(
    'the workspace owner does not',
    ownedByWorkspace.totalByRep['test-business-uuid'] === 0,
    `owner=${ownedByWorkspace.totalByRep['test-business-uuid']}`
  );
}

{
  // An actor outside the reportable workspace must not make the follow-up vanish.
  const foreignActor = countFollowupActivity({
    history: [
      {
        lead_id: 'owned2',
        user_id: DEVRAJ,
        actor_id: 'someone-else-uuid',
        action_type: 'FOLLOWUP',
        description: '📝 Followup (Call) updated by Someone Else. Stage: Contacted.',
        created_at: '2026-11-19T08:36:22.000Z',
      },
    ],
    leads: [],
    reps: REPS,
    isInRange: isToday,
  });
  check(
    'an unknown actor falls back to the credited owner rather than dropping the row',
    foreignActor.totalByRep[DEVRAJ] === 1,
    `devraj=${foreignActor.totalByRep[DEVRAJ]}`
  );
}

head('9. Meeting next actions are bookable');

// The old server-side check looked for 'Site Visit' / 'Meeting' / 'Appointment', but the modal
// can only send Call / Visit / Revisit / Closing Meeting / Home Meeting — so the booking branch
// was unreachable and "book a meeting at 9pm" was saved as an unbooked call.
check('Visit books the lead', isBookableActionType('Visit'));
check('Revisit books the lead', isBookableActionType('Revisit'));
check('Closing Meeting books the lead', isBookableActionType('Closing Meeting'));
check('Home Meeting books the lead', isBookableActionType('Home Meeting'));
check('Meeting and Appointment still work for API clients', isBookableActionType('Appointment'));
check('a plain Call does not book', !isBookableActionType('Call'));
check('an empty type does not book', !isBookableActionType('') && !isBookableActionType(null));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
