/**
 * Listing the carrier's recordings and matching them to leads — without needing a call uuid.
 *
 * WHY THIS REPLACES THE UUID APPROACH
 * The status callback gives the carrier 13 seconds to publish a recording. When it doesn't, nothing
 * ever goes back — and the uuid-based sweep I wrote first can only help calls whose uuid we managed
 * to store, which is none of them yet. So the sweep found nothing and the bug stayed exactly as it
 * was for every call already made.
 *
 * Measured against the live carrier API:
 *   - `GET /Account/{id}/Recording/` returns newest-first with `call_uuid`, `to_number`,
 *     `recording_url`, `recording_duration_ms` and `add_time`;
 *   - `from`/`to` are IGNORED (an ancient window still returned today's items), so there is no way to
 *     ask for a time range;
 *   - `limit` is capped at 20.
 *
 * So the only workable strategy is: page the newest N recordings, and match each one to a lead by
 * phone number. The matching is pure and tested; the fetching is thin.
 */

export interface CarrierRecording {
  callUuid: string;
  /** The number that was dialled — the lead's phone on an outbound AI call. */
  toNumber: string;
  recordingUrl: string;
  durationMs: number;
  /** The carrier's own timestamp string, kept for tie-breaking only. */
  addTime: string;
}

export interface LeadForMatching {
  id: string;
  phone: string | null;
  lastCallAt?: string | null;
}

/** Last ten digits, which is what survives every format an Indian number is written in. */
export function phoneKey(raw?: string | null): string {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/** The parsed shape of one carrier item. Tolerant: a malformed row is dropped, not thrown. */
export function parseCarrierRecording(raw: unknown): CarrierRecording | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const callUuid = String(o.call_uuid ?? '').trim();
  const toNumber = String(o.to_number ?? o.to ?? '').trim();
  const recordingUrl = String(o.recording_url ?? '').trim();
  if (!callUuid || !recordingUrl) return null;
  if (String(o.recording_type ?? 'call') !== 'call') return null;

  const durationMs = Number(String(o.recording_duration_ms ?? '0')) || 0;
  return {
    callUuid,
    toNumber,
    recordingUrl,
    durationMs,
    addTime: String(o.add_time ?? ''),
  };
}

/** Everything usable in a carrier list response. */
export function parseCarrierRecordingList(body: unknown): CarrierRecording[] {
  const b = body as { objects?: unknown } | null;
  const list = Array.isArray(b?.objects) ? b!.objects : [];
  const out: CarrierRecording[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const rec = parseCarrierRecording(item);
    if (!rec) continue;
    if (seen.has(rec.callUuid)) continue;
    seen.add(rec.callUuid);
    out.push(rec);
  }
  return out;
}

export interface RecordingMatch {
  recording: CarrierRecording;
  leadId: string;
  because: string;
}

/**
 * Pair recordings to the leads that are missing one.
 *
 * Rules, in order of what protects the owner's data:
 *   - a lead is matched at most once, so two recordings never overwrite the same lead;
 *   - a recording is matched at most once;
 *   - the phone must agree on its last ten digits — never a fuzzy name match;
 *   - when the same phone exists on several leads, the one whose last call is CLOSEST to the
 *     recording's add time wins, because that is the call it belongs to.
 *
 * Pure. No clock, no I/O, so the gate can pin every rule.
 */
export function matchRecordingsToLeads(
  recordings: readonly CarrierRecording[],
  leads: readonly LeadForMatching[],
): RecordingMatch[] {
  // phone -> candidate leads, so a duplicate phone does not silently take the first row
  const byPhone = new Map<string, LeadForMatching[]>();
  for (const lead of leads) {
    const key = phoneKey(lead.phone);
    if (!key || key.length < 10) continue;
    const arr = byPhone.get(key) ?? [];
    arr.push(lead);
    byPhone.set(key, arr);
  }

  const usedLeads = new Set<string>();
  const usedRecordings = new Set<string>();
  const out: RecordingMatch[] = [];

  for (const rec of recordings) {
    if (usedRecordings.has(rec.callUuid)) continue;
    const key = phoneKey(rec.toNumber);
    if (!key || key.length < 10) continue;
    const candidates = (byPhone.get(key) ?? []).filter((l) => !usedLeads.has(l.id));
    if (candidates.length === 0) continue;

    let chosen = candidates[0];
    if (candidates.length > 1) {
      const recTime = Date.parse(rec.addTime);
      if (Number.isFinite(recTime)) {
        let bestDelta = Number.POSITIVE_INFINITY;
        for (const c of candidates) {
          const t = c.lastCallAt ? Date.parse(c.lastCallAt) : NaN;
          const delta = Number.isFinite(t) ? Math.abs(t - recTime) : Number.POSITIVE_INFINITY;
          if (delta < bestDelta) {
            bestDelta = delta;
            chosen = c;
          }
        }
      }
    }

    usedLeads.add(chosen.id);
    usedRecordings.add(rec.callUuid);
    out.push({
      recording: rec,
      leadId: chosen.id,
      because: `the dialled number ends ${key} and this lead has no recording`,
    });
  }

  return out;
}

const PAGE_SIZE = 20; // the carrier's cap; asking for more silently returns 20
const MAX_PAGES = 5; // 100 newest recordings per sweep — enough for a day of calls

/**
 * Page the newest recordings off the carrier.
 *
 * `from`/`to` are ignored by this API, so paging is the only way to bound the work. Paging stops
 * early when a page repeats the previous page's first uuid, which is what a carrier that ignores
 * `offset` would do — better to stop than to loop forever.
 */
export async function listRecentRecordings(input: {
  authId?: string;
  authToken?: string;
  maxPages?: number;
  fetchImpl?: typeof fetch;
}): Promise<CarrierRecording[]> {
  const authId = String(input.authId ?? '').trim();
  const authToken = String(input.authToken ?? '').trim();
  if (!authId || !authToken) return [];

  const doFetch = input.fetchImpl ?? fetch;
  const maxPages = Math.max(1, Math.min(MAX_PAGES, input.maxPages ?? MAX_PAGES));
  const base = `https://api.vobiz.ai/api/v1/Account/${authId}/Recording/`;

  const all: CarrierRecording[] = [];
  const seen = new Set<string>();
  let previousFirst: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    let body: unknown = null;
    try {
      const res = await doFetch(`${base}?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`, {
        headers: { 'X-Auth-ID': authId, 'X-Auth-Token': authToken },
      });
      if (!res.ok) break;
      body = await res.json().catch(() => null);
    } catch {
      break;
    }

    const batch = parseCarrierRecordingList(body);
    if (batch.length === 0) break;
    if (previousFirst && batch[0]?.callUuid === previousFirst) break;
    previousFirst = batch[0]?.callUuid ?? null;

    for (const rec of batch) {
      if (seen.has(rec.callUuid)) continue;
      seen.add(rec.callUuid);
      all.push(rec);
    }
  }

  return all;
}
