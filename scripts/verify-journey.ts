/* eslint-disable @typescript-eslint/no-explicit-any -- partial playbook rows are cast in fixtures on purpose: a real playbook row carries far more than a test needs. */
/**
 * The per-campaign lead journey — first reply, T+1h, T+1d, opt-out, handoff.
 *
 * Everything here runs OFFLINE: the clock, the store and the sender are injected,
 * so there is no Supabase, no Meta and no waiting an hour to find out whether the
 * hour works. What has to be true and is checked here:
 *   1. a new lead produces exactly the first reply, one send at T+1h and one at
 *      T+1d — the exact instants are asserted, and nothing else ever fires
 *   2. the same inbound event delivered twice produces ONE first reply
 *   3. an opt-out at T+30m cancels both future steps and nothing sends afterwards
 *   4. an opt-out word that lands AFTER a step was queued but BEFORE it fires
 *      still suppresses it
 *   5. a handoff request stops the journey and notifies the owner exactly once
 *   6. every emitted message carries the three button ids, asserted by name
 *   7. test mode redirects the recipient on every step
 *   8. an industry-neutral tenant never receives real-estate vocabulary
 *   9. the custom calling script is used when set, the shipped default when not
 *  10. a policy violation is blocked AND logged with its reason
 *
 *   npm run verify:journey
 */
import {
  applyInboundIntent,
  buildLeadMessage,
  classifyLeadReply,
  createMemoryJourneyStore,
  createRecordingSender,
  defaultJourney,
  journeyFromPlaybook,
  journeyPatch,
  planJourney,
  processDueSteps,
  renderStepBody,
  startJourney,
  type JourneyDeps,
  type LeadJourney,
  type OwnerNotice,
} from '../lib/automation/journey'
import {
  LEAD_BUTTON_IDS,
  checkLeadMessagePolicy,
  realEstateWordsIn,
} from '../lib/automation/lead-message-policy'
import { DEFAULT_CALLING_SCRIPT, resolveCallingScript } from '../lib/automation/calling-script'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`)
  } else {
    fail++
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`)
  }
}

const LEAD_PHONE = '+919812345678'
const LEAD_ID = 'lead-journey-1'
const USER_ID = 'user-journey-1'
const MIN = 60_000
const HOUR = 60 * MIN

/** The instant the inbound lead event arrives. Everything is relative to this. */
const T0 = new Date('2026-03-02T09:00:00.000Z')

/** A journey as a tenant would have it once they turn it on. */
function activeJourney(overrides: Partial<LeadJourney> = {}): LeadJourney {
  return { ...defaultJourney(null), enabled: true, ...overrides }
}

interface Harness {
  deps: JourneyDeps
  store: ReturnType<typeof createMemoryJourneyStore>
  sender: ReturnType<typeof createRecordingSender>
  notices: OwnerNotice[]
  logs: string[]
  setClock(d: Date): void
}

function harness(opts: { failSend?: boolean } = {}): Harness {
  const store = createMemoryJourneyStore()
  const sender = createRecordingSender({ fail: opts.failSend })
  const notices: OwnerNotice[] = []
  const logs: string[] = []
  let clock = new Date(T0)
  return {
    store,
    sender,
    notices,
    logs,
    setClock(d: Date) {
      clock = new Date(d)
    },
    deps: {
      store,
      sender,
      now: () => new Date(clock),
      notifyOwner: async (n: OwnerNotice) => {
        notices.push(n)
      },
      log: (entry) => {
        logs.push(`${entry.event}: ${entry.detail}`)
      },
    },
  }
}

/** Everything a step's message needs that the row does not carry. */
function context(businessName = 'Nobogent Academy', leadName = 'Asha', industry: string | null = null) {
  return async () => ({
    playbook: null,
    industry,
    businessName,
    leadName,
    phone: LEAD_PHONE,
  })
}

const buttonIdsOf = (m: { buttons: Array<{ id: string }> }) => m.buttons.map((b) => b.id)

function env(key: string, value: string | undefined) {
  const before = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
  return () => {
    if (before === undefined) delete process.env[key]
    else process.env[key] = before
  }
}

async function main() {
  // Test mode is controlled explicitly here: this script never loads .env.
  const restoreMode = env('OUTBOUND_TEST_MODE', 'false')
  const restoreNumber = env('OUTBOUND_TEST_NUMBER', undefined)

  console.log('--- 1. a new lead: first reply, T+1h, T+1d — no more, no fewer ---')
  {
    const h = harness()
    const journey = activeJourney()
    const started = await startJourney(h.deps, {
      journey,
      leadId: LEAD_ID,
      userId: USER_ID,
      startedAt: new Date(T0),
    })

    check('starting a journey plans exactly three steps', started.steps.length === 3 && started.enqueued === 3, `enqueued=${started.enqueued}`)

    const planned = planJourney(journey, new Date(T0))
    const dueAt = planned.map((s) => s.dueAt.toISOString())
    check(
      'the first reply is due at T+0',
      dueAt[0] === '2026-03-02T09:00:00.000Z',
      dueAt[0]
    )
    check(
      'the second step is due exactly one hour later',
      dueAt[1] === '2026-03-02T10:00:00.000Z',
      dueAt[1]
    )
    check(
      'the third step is due exactly one day later',
      dueAt[2] === '2026-03-03T09:00:00.000Z',
      dueAt[2]
    )
    check(
      'the queued rows carry those same instants',
      h.store.rows.map((r) => r.dueAt).join('|') === dueAt.join('|'),
      h.store.rows.map((r) => r.dueAt).join(', ')
    )

    // T+0
    const at0 = await processDueSteps(h.deps, { contextFor: context() })
    check('exactly one send at T+0', at0.sent === 1 && h.sender.sent.length === 1, `sent=${at0.sent}`)
    check('the T+0 send is the first reply', h.sender.sent[0]?.stepId === 'first_reply', String(h.sender.sent[0]?.stepId))

    // T+59m — nothing may fire
    h.setClock(new Date(T0.getTime() + 59 * MIN))
    const at59 = await processDueSteps(h.deps, { contextFor: context() })
    check('nothing fires at T+59m', at59.sent === 0 && h.sender.sent.length === 1, `sent=${at59.sent}`)

    // T+1h — the hour step fires, once
    h.setClock(new Date(T0.getTime() + 60 * MIN))
    const at1h = await processDueSteps(h.deps, { contextFor: context() })
    check('exactly one send at T+1h', at1h.sent === 1 && h.sender.sent.length === 2, `sent=${at1h.sent}`)
    check('the T+1h send is the hour follow-up', h.sender.sent[1]?.stepId === 'followup_1h', String(h.sender.sent[1]?.stepId))

    const at1hAgain = await processDueSteps(h.deps, { contextFor: context() })
    check('re-running the T+1h pass sends nothing extra', at1hAgain.sent === 0 && h.sender.sent.length === 2)

    // T+23h — still nothing
    h.setClock(new Date(T0.getTime() + 23 * HOUR))
    const at23 = await processDueSteps(h.deps, { contextFor: context() })
    check('nothing fires at T+23h', at23.sent === 0 && h.sender.sent.length === 2, `sent=${at23.sent}`)

    // T+1d — the day step fires, then the journey is exhausted
    h.setClock(new Date(T0.getTime() + 24 * HOUR))
    const at1d = await processDueSteps(h.deps, { contextFor: context() })
    check('exactly one send at T+1d', at1d.sent === 1 && h.sender.sent.length === 3, `sent=${at1d.sent}`)
    check('the T+1d send is the day follow-up', h.sender.sent[2]?.stepId === 'followup_1d', String(h.sender.sent[2]?.stepId))

    h.setClock(new Date(T0.getTime() + 72 * HOUR))
    const at3d = await processDueSteps(h.deps, { contextFor: context() })
    check('no fourth message ever appears', at3d.sent === 0 && h.sender.sent.length === 3, `total=${h.sender.sent.length}`)
    check(
      'the three sends happened in journey order',
      h.sender.sent.map((m) => m.stepId).join(',') === 'first_reply,followup_1h,followup_1d',
      h.sender.sent.map((m) => m.stepId).join(',')
    )
  }

  console.log('\n--- 2. the same inbound event delivered twice => ONE first reply ---')
  {
    const h = harness()
    const journey = activeJourney()

    const first = await startJourney(h.deps, { journey, leadId: LEAD_ID, userId: USER_ID, startedAt: new Date(T0) })
    const second = await startJourney(h.deps, { journey, leadId: LEAD_ID, userId: USER_ID, startedAt: new Date(T0) })

    check('the first delivery creates the steps', first.created === true && first.enqueued === 3)
    check('the duplicate delivery creates nothing', second.created === false && second.enqueued === 0, `enqueued=${second.enqueued}`)
    check('there are still only three rows for (lead, step)', h.store.rows.length === 3, `rows=${h.store.rows.length}`)

    const a = await processDueSteps(h.deps, { contextFor: context() })
    const b = await processDueSteps(h.deps, { contextFor: context() })
    check(
      'two webhook deliveries produce exactly ONE first reply',
      a.sent === 1 && b.sent === 0 && h.sender.sent.length === 1,
      `sent=${a.sent} then ${b.sent}`
    )
    check(
      'the duplicate is a no-op, not a second queue entry',
      h.store.rows.filter((r) => r.stepId === 'first_reply').length === 1
    )
  }

  console.log('\n--- 3. an opt-out at T+30m cancels both future steps ---')
  {
    const h = harness()
    const journey = activeJourney()
    await startJourney(h.deps, { journey, leadId: LEAD_ID, userId: USER_ID, startedAt: new Date(T0) })
    await processDueSteps(h.deps, { contextFor: context() })
    check('the first reply went out before the opt-out', h.sender.sent.length === 1)

    h.setClock(new Date(T0.getTime() + 30 * MIN))
    const stop = await applyInboundIntent(h.deps, {
      journey,
      leadId: LEAD_ID,
      userId: USER_ID,
      text: 'STOP',
    })
    check('the opt-out is recognised', stop.kind === 'opt_out', stop.matched || '')
    check('both future steps are cancelled immediately', stop.cancelled === 2, `cancelled=${stop.cancelled}`)

    const future = h.store.rows.filter((r) => r.stepId !== 'first_reply')
    check(
      'no future step is left pending',
      future.every((r) => r.status === 'cancelled'),
      future.map((r) => `${r.stepId}:${r.status}`).join(', ')
    )
    check(
      'the cancellation names the opt-out',
      future.every((r) => String(r.cancelReason || '').startsWith('opt_out')),
      future.map((r) => String(r.cancelReason)).join(', ')
    )

    h.setClock(new Date(T0.getTime() + 1 * HOUR))
    const after1h = await processDueSteps(h.deps, { contextFor: context() })
    h.setClock(new Date(T0.getTime() + 24 * HOUR))
    const after1d = await processDueSteps(h.deps, { contextFor: context() })
    check(
      'nothing sends after the opt-out — not at T+1h, not at T+1d',
      after1h.sent === 0 && after1d.sent === 0 && h.sender.sent.length === 1,
      `total=${h.sender.sent.length}`
    )
    check(
      'the lead is marked opted out where the rest of the app can see it',
      !!h.store.state.get(LEAD_ID)?.optedOutAt
    )
  }

  console.log('\n--- 4. an opt-out word after a step was queued but before it fires ---')
  {
    const h = harness()
    const journey = activeJourney()
    await startJourney(h.deps, { journey, leadId: LEAD_ID, userId: USER_ID, startedAt: new Date(T0) })
    await processDueSteps(h.deps, { contextFor: context() })

    // The hour step is queued (it already is) and not yet due.
    const queued = h.store.rows.find((r) => r.stepId === 'followup_1h')
    check('the hour step is queued and pending before the opt-out', queued?.status === 'pending')

    h.setClock(new Date(T0.getTime() + 20 * MIN))
    const nahi = classifyLeadReply({ text: 'nahi bhai, interest nahi hai', journey })
    check('an Indic opt-out word is understood', nahi.kind === 'opt_out', `${nahi.kind} via "${nahi.matched}"`)

    const res = await applyInboundIntent(h.deps, {
      journey,
      leadId: LEAD_ID,
      userId: USER_ID,
      text: 'nahi bhai, interest nahi hai',
    })
    check('the queued step is cancelled by the wording', res.cancelled >= 1, `cancelled=${res.cancelled}`)

    // Simulate a row that survived the cancellation (a crash between the two
    // writes, or a worker that had already read the queue): the send attempt
    // itself must still refuse.
    if (queued) {
      queued.status = 'pending'
      queued.cancelledAt = null
      queued.cancelReason = null
    }
    h.setClock(new Date(T0.getTime() + HOUR))
    const attempt = await processDueSteps(h.deps, { contextFor: context() })
    check(
      'a still-due step is suppressed on the send attempt itself',
      attempt.sent === 0 && attempt.cancelled === 1 && h.sender.sent.length === 1,
      `sent=${attempt.sent} cancelled=${attempt.cancelled}`
    )
    check(
      'the suppression is logged with the opt-out instant',
      h.logs.some((l) => l.includes('suppressed') && l.includes('opted out')),
      h.logs.filter((l) => l.includes('suppressed')).join(' | ') || 'no log line'
    )
  }

  console.log('\n--- 5. a handoff request stops the journey and notifies the owner once ---')
  {
    const h = harness()
    const journey = activeJourney()
    await startJourney(h.deps, { journey, leadId: LEAD_ID, userId: USER_ID, startedAt: new Date(T0) })
    await processDueSteps(h.deps, { contextFor: context() })

    h.setClock(new Date(T0.getTime() + 25 * MIN))
    const ask = await applyInboundIntent(h.deps, {
      journey,
      leadId: LEAD_ID,
      userId: USER_ID,
      text: 'can I speak to a real person please?',
    })
    check('the handoff request is recognised', ask.kind === 'handoff', ask.matched || '')
    check('the journey stops', ask.cancelled === 2, `cancelled=${ask.cancelled}`)
    check('the owner is notified', ask.notifiedOwner === true && h.notices.length === 1, `notices=${h.notices.length}`)
    check(
      'the owner notice names the lead and says messaging is paused',
      h.notices[0]?.leadId === LEAD_ID && /paused/i.test(h.notices[0]?.body || ''),
      h.notices[0]?.body || ''
    )
    check('the lead is marked for a human', !!h.store.state.get(LEAD_ID)?.handoffAt)

    // A second "I want a human" must not ring the owner twice.
    h.setClock(new Date(T0.getTime() + 26 * MIN))
    const again = await applyInboundIntent(h.deps, {
      journey,
      leadId: LEAD_ID,
      userId: USER_ID,
      text: 'hello? a human?',
    })
    check(
      'a repeated handoff does not notify the owner again',
      again.kind === 'handoff' && again.notifiedOwner === false && h.notices.length === 1,
      `notices=${h.notices.length}`
    )

    // The expert button is the same intent.
    const viaButton = classifyLeadReply({ buttonId: 'talk_expert', journey })
    check('the talk_expert button is a handoff too', viaButton.kind === 'handoff', viaButton.matched || '')

    h.setClock(new Date(T0.getTime() + 24 * HOUR))
    const later = await processDueSteps(h.deps, { contextFor: context() })
    check('nothing sends after a handoff', later.sent === 0 && h.sender.sent.length === 1, `total=${h.sender.sent.length}`)
  }

  console.log('\n--- 6. every emitted message carries the three button ids ---')
  {
    const h = harness()
    const journey = activeJourney()
    await startJourney(h.deps, { journey, leadId: LEAD_ID, userId: USER_ID, startedAt: new Date(T0) })
    for (const offset of [0, HOUR, 24 * HOUR]) {
      h.setClock(new Date(T0.getTime() + offset))
      await processDueSteps(h.deps, { contextFor: context() })
    }

    check('all three step messages were emitted', h.sender.sent.length === 3, `emitted=${h.sender.sent.length}`)
    let allExact = true
    const seen: string[] = []
    for (const message of h.sender.sent) {
      const ids = buttonIdsOf(message)
      seen.push(`${message.stepId}:[${ids.join(',')}]`)
      const exact =
        ids.length === 3
        && ids[0] === 'view_properties'
        && ids[1] === 'talk_expert'
        && ids[2] === 'book_appointment'
      const labelled = message.buttons.every((b) => String(b.label || '').trim().length > 0)
      if (!exact || !labelled) allExact = false
    }
    check(
      'every message carries exactly view_properties | talk_expert | book_appointment, by name',
      allExact,
      seen.join('  ')
    )
    check(
      'the policy re-asserts the same ids',
      LEAD_BUTTON_IDS.join(',') === 'view_properties,talk_expert,book_appointment',
      LEAD_BUTTON_IDS.join(',')
    )
    check(
      'a message with the buttons stripped is rejected by policy',
      (() => {
        const v = checkLeadMessagePolicy({ to: LEAD_PHONE, body: 'hi', buttons: [], windowOpen: true })
        return !v.allowed && v.code === 'buttons_missing'
      })()
    )
    check(
      'a message with a re-id-ed button is rejected by policy',
      (() => {
        const v = checkLeadMessagePolicy({
          to: LEAD_PHONE,
          body: 'hi',
          buttons: [
            { id: 'view_properties', label: 'View' },
            { id: 'talk_expert', label: 'Talk' },
            { id: 'book_a_meeting', label: 'Book' },
          ],
          windowOpen: true,
        })
        return !v.allowed && v.code === 'buttons_wrong_ids'
      })()
    )
  }

  console.log('\n--- 7. test mode redirects the recipient on every step ---')
  {
    const enableMode = env('OUTBOUND_TEST_MODE', 'true')
    const number = env('OUTBOUND_TEST_NUMBER', '9876543210')

    const h = harness()
    const journey = activeJourney()
    await startJourney(h.deps, { journey, leadId: LEAD_ID, userId: USER_ID, startedAt: new Date(T0) })
    for (const offset of [0, HOUR, 24 * HOUR]) {
      h.setClock(new Date(T0.getTime() + offset))
      await processDueSteps(h.deps, { contextFor: context() })
    }

    check('three messages were still emitted in test mode', h.sender.sent.length === 3, `emitted=${h.sender.sent.length}`)
    check(
      'every step goes to the founder, never the customer',
      h.sender.sent.every((m) => m.to === '919876543210'),
      h.sender.sent.map((m) => `${m.stepId}->${m.to}`).join('  ')
    )
    check(
      'no message carries the real lead number',
      h.sender.sent.every((m) => !m.to.includes('9812345678')),
      h.sender.sent.map((m) => m.to).join(', ')
    )

    number()
    enableMode()
  }

  console.log('\n--- 8. an industry-neutral tenant never gets real-estate vocabulary ---')
  {
    const banned = ['propert', 'listing', 'rera', 'realtor']
    const h = harness()
    const journey = activeJourney()
    await startJourney(h.deps, { journey, leadId: LEAD_ID, userId: USER_ID, startedAt: new Date(T0) })
    for (const offset of [0, HOUR, 24 * HOUR]) {
      h.setClock(new Date(T0.getTime() + offset))
      await processDueSteps(h.deps, { contextFor: context('Nobogent Academy', 'Asha', null) })
    }

    check('the neutral journey still sends all three steps', h.sender.sent.length === 3, `emitted=${h.sender.sent.length}`)
    const offenders: string[] = []
    for (const message of h.sender.sent) {
      const haystack = `${message.body} ${message.buttons.map((b) => b.label).join(' ')}`.toLowerCase()
      for (const word of banned) {
        if (haystack.includes(word)) offenders.push(`${message.stepId}:${word}`)
      }
    }
    check('no banned real-estate word reaches a neutral tenant', offenders.length === 0, offenders.join(', ') || 'clean')

    // The shipped copy is neutral for every vocabulary the product supports.
    for (const industry of [null, 'education', 'immigration', 'generic', 'healthcare']) {
      const words = [
        renderStepBody(defaultJourney(industry).firstReply.body, { leadName: 'Asha', businessName: 'Acme', industry }),
        renderStepBody(defaultJourney(industry).followups[0].body, { leadName: 'Asha', businessName: 'Acme', industry }),
        renderStepBody(defaultJourney(industry).followups[1].body, { leadName: 'Asha', businessName: 'Acme', industry }),
      ].join(' ')
      check(
        `the shipped copy is neutral for industry "${industry || 'untagged'}"`,
        realEstateWordsIn(words).length === 0,
        realEstateWordsIn(words).join(', ') || 'clean'
      )
    }

    // A real-estate tenant MAY use its own vocabulary.
    const re = checkLeadMessagePolicy({
      to: LEAD_PHONE,
      body: 'Here are the property listings you asked about.',
      buttons: [
        { id: 'view_properties', label: 'View Properties' },
        { id: 'talk_expert', label: 'Talk to Expert' },
        { id: 'book_appointment', label: 'Book Appointment' },
      ],
      windowOpen: true,
      industry: 'real_estate',
    })
    check('a brokerage is allowed its own vocabulary', re.allowed === true, re.code)
  }

  console.log('\n--- 9. the custom calling script wins, the shipped default does not ---')
  {
    const shipped = resolveCallingScript({ leadName: 'Asha', businessName: 'Nobogent Academy', industry: null })
    check('with nothing set, the shipped default is used', shipped.source === 'default', shipped.source)
    check(
      'the shipped default is the exported constant, with its placeholders filled',
      DEFAULT_CALLING_SCRIPT.includes('{{business}}')
        && !shipped.script.includes('{{')
        && shipped.script.includes('Nobogent Academy')
        && shipped.script.includes('Never invent prices'),
      `${shipped.script.length} chars, source=${shipped.source}`
    )
    check(
      'the shipped default is industry-neutral',
      realEstateWordsIn(shipped.script).length === 0,
      realEstateWordsIn(shipped.script).join(', ') || 'clean'
    )
    check(
      'the shipped default forbids invented facts and honours "stop"',
      /Never invent prices/i.test(shipped.script) && /opt-out/i.test(shipped.script)
    )

    const tenant = resolveCallingScript({
      leadName: 'Asha',
      businessName: 'Nobogent Academy',
      industry: 'education',
      playbook: { call_script: { script: 'Greet {{name}} from {{business}} and talk about our {{products}}.' } },
    })
    check('a tenant script is used when set', tenant.source === 'playbook' && tenant.script.includes('Greet Asha from Nobogent Academy'), tenant.source)
    check('placeholders resolve with the industry vocabulary', tenant.script.includes('our courses'), tenant.script)

    const campaign = resolveCallingScript({
      leadName: 'Asha',
      businessName: 'Nobogent Academy',
      campaignScript: 'This is the Diwali campaign script.',
      playbook: { call_script: { script: 'Greet {{name}} from {{business}} and talk about our {{products}}.' } },
    })
    check('a campaign script beats the tenant script', campaign.source === 'campaign' && campaign.script.includes('Diwali'), campaign.source)
    check('every resolved script has a first message', campaign.firstMessage.trim().length > 0, campaign.firstMessage)
  }

  console.log('\n--- 10. a policy violation is BLOCKED and LOGGED with its reason ---')
  {
    const h = harness()
    // A neutral tenant whose copy was authored as if it were a brokerage.
    const journey = activeJourney({
      firstReply: {
        ...defaultJourney(null).firstReply,
        body: 'Hi {{name}}, your property listing with the RERA number is ready.',
      },
    })
    await startJourney(h.deps, { journey, leadId: LEAD_ID, userId: USER_ID, startedAt: new Date(T0) })
    const res = await processDueSteps(h.deps, { contextFor: context('Nobogent Academy', 'Asha', null) })

    check('the offending step is not sent', res.sent === 0 && h.sender.sent.length === 0, `sent=${res.sent}`)
    check('the step is blocked', res.blocked === 1, `blocked=${res.blocked}`)
    const row = h.store.rows.find((r) => r.stepId === 'first_reply')
    check('the row records why', row?.status === 'blocked' && /industry_vocabulary/.test(String(row?.blockedReason)), String(row?.blockedReason))
    check(
      'the block is logged with its reason',
      h.logs.some((l) => l.startsWith('blocked:') && /industry_vocabulary/.test(l) && /real-estate vocabulary/.test(l)),
      h.logs.filter((l) => l.startsWith('blocked:')).join(' | ') || 'no log line'
    )
    check(
      'the audit store keeps the reason too',
      h.store.logs.some((e) => e.event === 'blocked' && /industry_vocabulary/.test(e.detail)),
      `${h.store.logs.filter((e) => e.event === 'blocked').length} blocked log row(s)`
    )

    // Outside the 24h window a free-form message is a policy violation, not a send.
    const outside = harness()
    const nowWindow = createMemoryJourneyStore({ windowExpiresAt: new Date(T0.getTime() - HOUR).toISOString() })
    const depsOutside: JourneyDeps = {
      store: nowWindow,
      sender: outside.sender,
      now: () => new Date(T0),
      log: (e) => outside.logs.push(`${e.event}: ${e.detail}`),
    }
    const tplJourney = activeJourney({
      firstReply: { ...defaultJourney(null).firstReply, template: null },
    })
    await startJourney(depsOutside, { journey: tplJourney, leadId: LEAD_ID, userId: USER_ID, startedAt: new Date(T0) })
    const outsideRes = await processDueSteps(depsOutside, { contextFor: context() })
    check(
      'outside the 24h window a free-form send is blocked, not attempted',
      outsideRes.sent === 0 && outsideRes.blocked === 1 && outside.sender.sent.length === 0,
      `sent=${outsideRes.sent} blocked=${outsideRes.blocked}`
    )
    check(
      'and the reason names the template requirement',
      /template_required/.test(String(nowWindow.rows[0]?.blockedReason)),
      String(nowWindow.rows[0]?.blockedReason)
    )

    // A channel failure is blocked too — never silently dropped.
    const failing = harness({ failSend: true })
    await startJourney(failing.deps, { journey: activeJourney(), leadId: LEAD_ID, userId: USER_ID, startedAt: new Date(T0) })
    const failed = await processDueSteps(failing.deps, { contextFor: context() })
    check(
      'a refused send is recorded as blocked with the channel error',
      failed.blocked === 1 && /send_failed: simulated channel failure/.test(String(failing.store.rows[0]?.blockedReason)),
      String(failing.store.rows[0]?.blockedReason)
    )
  }

  console.log('\n--- 11. the journey is playbook data (editable, opt-in) ---')
  {
    const off = journeyFromPlaybook(null)
    check('a tenant without a journey gets it switched OFF', off.enabled === false, `enabled=${off.enabled}`)
    check('the default journey still describes T+1h and T+1d', off.followups.map((f) => f.offsetMinutes).join(',') === '60,1440')

    const authored = journeyFromPlaybook({
      industry: null,
      cadence: {
        journey: {
          enabled: true,
          followups: [{ id: 'followup_1h', offsetMinutes: 120 }],
          optOut: { words: ['bas'] },
          handoff: { triggers: ['manager se baat'] },
        },
      },
    } as any)
    check('a patch switches the journey on', authored.enabled === true)
    check('a patch can re-time a step', authored.followups[0].offsetMinutes === 120, String(authored.followups[0].offsetMinutes))
    check('a patch can add an opt-out word', authored.optOut.words.includes('bas'))
    check('adding a word never removes the shipped ones', authored.optOut.words.includes('stop'), `${authored.optOut.words.length} words`)
    check('a patch can add a handoff trigger', authored.handoff.triggers.includes('manager se baat'))

    // Per-campaign overrides: the same tenant can run a different journey on one
    // campaign (e.g. a launch campaign that follows up after 2 hours, not 1).
    const perCampaign = journeyFromPlaybook({
      industry: null,
      cadence: {
        journey: {
          enabled: true,
          followups: [{ id: 'followup_1h', offsetMinutes: 60 }],
          campaigns: {
            'campaign-launch': { followups: [{ id: 'followup_1h', offsetMinutes: 120 }] },
          },
        },
      },
    } as any, { campaignId: 'campaign-launch' })
    check(
      'a campaign override re-times its own journey',
      perCampaign.followups[0].offsetMinutes === 120,
      String(perCampaign.followups[0].offsetMinutes)
    )
    check('the campaign override is attributed to the campaign', perCampaign.campaignId === 'campaign-launch', String(perCampaign.campaignId))

    const otherCampaign = journeyFromPlaybook({
      industry: null,
      cadence: {
        journey: {
          enabled: true,
          followups: [{ id: 'followup_1h', offsetMinutes: 60 }],
          campaigns: { 'campaign-launch': { followups: [{ id: 'followup_1h', offsetMinutes: 120 }] } },
        },
      },
    } as any, { campaignId: 'campaign-other' })
    check(
      'a lead from another campaign keeps the tenant timing',
      otherCampaign.followups[0].offsetMinutes === 60,
      String(otherCampaign.followups[0].offsetMinutes)
    )

    const overrideCannotEnable = journeyFromPlaybook({
      industry: null,
      cadence: { journey: { enabled: false, campaigns: { c1: { enabled: true } } } },
    } as any, { campaignId: 'c1' })
    check(
      'a campaign override cannot switch a switched-off journey on',
      overrideCannotEnable.enabled === false,
      `enabled=${overrideCannotEnable.enabled}`
    )

    const patch = journeyPatch(activeJourney())
    check('the journey is written through the playbook service, not the table', patch.section === 'cadence', patch.section)
    check(
      'the patch carries the whole journey and the three buttons are not part of it',
      !!(patch.value as any).journey?.followups?.length && !('buttons' in (patch.value as any)),
      Object.keys(patch.value as any).join(',')
    )

    // A button label policy still applies to what the journey sends.
    const message = buildLeadMessage({
      row: { leadId: LEAD_ID, userId: USER_ID, stepId: 'first_reply', body: 'hello', template: 't', intent: 'x' },
      industry: 'education',
      businessName: 'Nobogent Academy',
      leadName: 'Asha',
      phone: LEAD_PHONE,
      state: { optedOutAt: null, handoffAt: null, windowExpiresAt: new Date(T0.getTime() + HOUR).toISOString() },
      now: new Date(T0),
    })
    check(
      'the built message has the three button ids in contract order',
      buttonIdsOf(message).join(',') === 'view_properties,talk_expert,book_appointment',
      buttonIdsOf(message).join(',')
    )
    check(
      'an academy label is not a property label',
      !/propert/i.test(message.buttons[0].label),
      message.buttons[0].label
    )
  }

  restoreNumber()
  restoreMode()

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error('verify-journey crashed:', e?.message || e)
  process.exit(1)
})
