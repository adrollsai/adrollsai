import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireUser } from '@/utils/route-auth'
import { resolveActingUser } from '@/utils/route-auth'

/**
 * Undo a bulk lead transfer, with the history intact.
 *
 * WHY THIS EXISTS
 * A transfer was one-way. Moving 200 leads to a teammate also stamped a visibility cutoff so the new
 * assignee could not see earlier work, reset the stage, cleared the attempt counters and hid scheduled
 * actions — and nothing recorded where those leads came from. So "put them back" was impossible even for
 * an admin, and the only recovery was to retype the assignment by hand and lose every cutoff.
 *
 * HOW IT UNDOES
 * The transfer writes a receipt per lead (`custom_fields.transfer_receipt`) holding the previous
 * assignee, the stage and attempt counters as they were, and which flags it set. This endpoint reads that
 * receipt and inverts exactly what it describes:
 *
 *   - `assigned_to` goes back to the previous owner,
 *   - the history cutoff is removed, so the FULL history is visible again — including every follow-up the
 *     receiving agent did in the meantime (nothing is deleted, ever: the notes, calls and messages stay,
 *     attributed to whoever did them),
 *   - the stage, status and attempt counters are restored from the receipt,
 *   - hidden scheduled actions are un-hidden.
 *
 * A lead already reversed is skipped rather than reversed twice, and the work is done in the same
 * worker-pool shape as the transfer itself so a 200-lead reversal does not time out.
 *
 * POST /api/crm/bulk-transfer/reverse
 *   { batchId }                       — reverse one whole operation
 *   { leadIds: [...] }                — reverse specific leads
 *   { batchId, dryRun: true }         — report what would change, change nothing
 */
export const maxDuration = 300

const CONCURRENCY = 40

interface Receipt {
  batch_id?: string
  previous_assignee?: string | null
  new_assignee?: string | null
  stage_before?: string | null
  status_before?: string | null
  attempts_before?: number
  next_followup_before?: string | null
  hid_history?: boolean
  hid_pending_actions?: boolean
  reversed_at?: string | null
}

/**
 * GET /api/crm/bulk-transfer/reverse
 *
 * The transfers that can still be undone, newest first, grouped by operation. This is what the account
 * activity page lists: one row per transfer ("200 leads to Priya, 24 Nov"), not 200 rows, because the
 * thing a person wants to reverse is the operation, not the individual lead.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const acting = await resolveActingUser(req, url.searchParams.get('impersonate'))
    if (!acting.ok) return acting.response
    const actingUserId = acting.userId

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    const { data: rows, error } = await admin
      .from('leads')
      .select('id, custom_fields')
      .eq('user_id', actingUserId)
      .not('custom_fields', 'is', null)
      .limit(5000)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    interface BatchRow {
      batchId: string
      leads: number
      at: string | null
      from: string | null
      to: string | null
      hidHistory: boolean
    }
    const batches = new Map<string, BatchRow>()

    for (const lead of rows || []) {
      let cf: any = (lead as any).custom_fields
      while (typeof cf === 'string') {
        try {
          cf = JSON.parse(cf)
        } catch {
          cf = null
          break
        }
      }
      const receipt = cf && typeof cf === 'object' ? cf.transfer_receipt : null
      if (!receipt || typeof receipt !== 'object') continue
      if (receipt.reversed_at) continue
      const id = String(receipt.batch_id || '')
      if (!id) continue
      const existing = batches.get(id) || {
        batchId: id,
        leads: 0,
        at: receipt.at ?? null,
        from: receipt.previous_assignee ?? null,
        to: receipt.new_assignee ?? null,
        hidHistory: Boolean(receipt.hid_history),
      }
      existing.leads += 1
      batches.set(id, existing)
    }

    // Names, so the page reads "Sonia → Priya" rather than two uuids.
    const ids = new Set<string>()
    for (const batch of batches.values()) {
      if (batch.from) ids.add(batch.from)
      if (batch.to) ids.add(batch.to)
    }
    const nameOf = new Map<string, string>()
    if (ids.size) {
      const { data: people } = await admin
        .from('profiles')
        .select('id, full_name, business_name')
        .in('id', [...ids])
      for (const person of people || []) {
        nameOf.set(String((person as any).id), String((person as any).full_name || (person as any).business_name || ''))
      }
    }

    const list = [...batches.values()]
      .map((batch) => ({
        ...batch,
        fromName: batch.from ? nameOf.get(batch.from) || null : null,
        toName: batch.to ? nameOf.get(batch.to) || null : null,
      }))
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
      .slice(0, 25)

    return NextResponse.json({ success: true, batches: list, reversibleCount: list.reduce((sum, b) => sum + b.leads, 0) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const user = await requireUser(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const acting = await resolveActingUser(req, body?.impersonate || null)
    if (!acting.ok) return acting.response
    const actingUserId = acting.userId

    const batchId = String(body?.batchId || '').trim()
    const leadIds: string[] = Array.isArray(body?.leadIds)
      ? body.leadIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : []
    const dryRun = body?.dryRun === true

    if (!batchId && !leadIds.length) {
      return NextResponse.json(
        { error: 'Give a batchId (from the transfer response) or the leadIds to put back.' },
        { status: 400 }
      )
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    // ---- who may reverse: the same people who may transfer
    const { data: actingProfile } = await admin
      .from('profiles')
      .select('role, id')
      .eq('id', actingUserId)
      .maybeSingle()
    if (!actingProfile || !['super_admin', 'agency', 'admin'].includes(String(actingProfile.role || ''))) {
      return NextResponse.json({ error: 'Forbidden: you cannot reverse a transfer for this account.' }, { status: 403 })
    }

    // ---- the leads to put back
    let query = admin
      .from('leads')
      .select('id, user_id, assigned_to, pipeline_stage, status, voice_call_retry_count, next_followup, custom_fields')
      .eq('user_id', actingUserId)
      .limit(5000)
    if (leadIds.length) query = query.in('id', leadIds)

    const { data: rows, error: readErr } = await query
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 400 })
    if (!rows?.length) return NextResponse.json({ error: 'No leads matched.' }, { status: 400 })

    const candidates: { lead: any; receipt: Receipt }[] = []
    for (const lead of rows) {
      let cf: any = lead.custom_fields || {}
      while (typeof cf === 'string') {
        try {
          cf = JSON.parse(cf)
        } catch {
          cf = {}
          break
        }
      }
      if (!cf || typeof cf !== 'object' || Array.isArray(cf)) continue
      const receipt: Receipt | undefined = cf.transfer_receipt
      if (!receipt || typeof receipt !== 'object') continue
      if (batchId && String(receipt.batch_id || '') !== batchId) continue
      if (receipt.reversed_at) continue // already undone; reversing twice would be a different lie
      candidates.push({ lead, receipt })
    }

    if (!candidates.length) {
      return NextResponse.json(
        {
          error: batchId
            ? `No leads on this account carry an un-reversed receipt for batch ${batchId}.`
            : 'None of those leads carry an un-reversed transfer receipt.',
        },
        { status: 400 }
      )
    }

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        wouldRestore: candidates.length,
        batchId: batchId || null,
        sample: candidates.slice(0, 5).map(({ lead, receipt }) => ({
          leadId: lead.id,
          backTo: receipt.previous_assignee,
          stageBackTo: receipt.stage_before,
          attemptsBackTo: receipt.attempts_before,
          historyWasHidden: Boolean(receipt.hid_history),
        })),
      })
    }

    // ---- invert, one lead at a time, 40 at a time
    let restored = 0
    const errors: string[] = []
    let index = 0

    async function worker() {
      while (index < candidates.length) {
        const entry = candidates[index++]
        if (!entry) continue
        const { lead, receipt } = entry

        let cf: any = lead.custom_fields || {}
        while (typeof cf === 'string') {
          try {
            cf = JSON.parse(cf)
          } catch {
            cf = {}
            break
          }
        }
        if (!cf || typeof cf !== 'object' || Array.isArray(cf)) cf = {}

        const payload: any = {}

        // 1. the owner it came from
        if (receipt.previous_assignee) payload.assigned_to = receipt.previous_assignee

        // 2. the history becomes visible again — the cutoff is deleted, not worked around. Everything the
        //    receiving agent did while it was hidden is still there and stays attributed to them.
        delete cf.history_visible_from
        delete cf.history_hidden_from_assignee
        delete cf.history_hidden_at
        delete cf.history_hidden_by

        // 3. the stage it was in, including the shadow keys the categoriser reads
        if (receipt.stage_before) {
          payload.pipeline_stage = receipt.stage_before
          payload.status = receipt.status_before || receipt.stage_before
          for (const key of ['pipeline_stage', 'status', 'lead_status', 'client_status']) {
            if (cf.stage_before_reset_fields?.[key]) cf[key] = cf.stage_before_reset_fields[key]
          }
        }
        delete cf.stage_before_reset
        delete cf.stage_before_reset_at
        delete cf.stage_before_reset_fields
        delete cf.stage_reset_at
        delete cf.stage_reset_by

        // 4. the attempt counters and the scheduled follow-up
        if (typeof receipt.attempts_before === 'number') payload.voice_call_retry_count = receipt.attempts_before
        if (receipt.next_followup_before) payload.next_followup = receipt.next_followup_before
        delete cf.attempts_before_reset
        delete cf.attempts_reset_at

        // 5. scheduled actions the transfer hid become visible again
        delete cf.pending_actions_hidden
        delete cf.pending_actions_hidden_at

        // 6. mark the receipt reversed — the audit stays, the action is spent
        cf.transfer_receipt = { ...receipt, reversed_at: new Date().toISOString(), reversed_by: actingUserId }
        payload.custom_fields = cf

        const { error } = await admin.from('leads').update(payload).eq('id', lead.id)
        if (error) {
          errors.push(`${lead.id}: ${error.message}`)
          continue
        }
        restored++

        // The trail says it was undone, and by whom. Nothing is overwritten.
        admin
          .from('lead_history')
          .insert({
            lead_id: lead.id,
            user_id: actingUserId,
            action_type: 'REMARK',
            description:
              `Transfer reversed by ${actingUserId}` +
              (receipt.previous_assignee ? `: returned to their previous owner.` : '.') +
              (receipt.hid_history ? ' Earlier history is visible again; everything done after the transfer is kept.' : ''),
          })
          .then(() => {}, () => {})
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, () => worker()))

    return NextResponse.json({
      success: true,
      batchId: batchId || null,
      restoredCount: restored,
      failedCount: errors.length,
      ...(errors.length ? { errors: errors.slice(0, 5) } : {}),
    })
  } catch (e: any) {
    console.error('[Transfer Reverse] failed:', e)
    return NextResponse.json({ error: e?.message || 'Internal Server Error' }, { status: 500 })
  }
}
