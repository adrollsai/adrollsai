/**
 * The Vobiz calling channels: one place that knows how many calls can be in flight, and which number each one
 * dials from.
 *
 * WHY THIS EXISTS
 * Capacity used to be a number written into the code in two places — `profile.voice_concurrency_limit || 3` in the
 * dispatcher and another `let maxConcurrent = 3` in the caller — and the DID rotation was separate again. So buying
 * a fourth Vobiz channel would have changed nothing: the cap would still have been three, and nothing connected
 * "how many lines we pay for" to "how many calls we place".
 *
 * A channel here is one concurrent outbound leg with its own caller ID: the auth account it bills to, and the
 * number it dials from. Capacity is the SUM of the channels' concurrency, so adding a channel is adding an entry
 * and nothing else — no code change, no second constant to remember.
 *
 * WHERE CHANNELS COME FROM, in priority order:
 *   1. `VOBIZ_CHANNELS` — the deployment's own list. Either JSON:
 *        [{"id":"ch1","authId":"MA_...","number":"+917965480905","concurrent":1}]
 *      or the compact form, one channel per `;`, `authId:number`:
 *        "MA_HOSGFZ86:+917965480905;MA_HOSGFZ86:+917965480539;MA_HOSGFZ86:+917965480907"
 *      Buy a channel, add it to the string, redeploy. That is the whole procedure.
 *   2. `profile.business_info.vobiz_channels` — for a tenant that manages its own lines.
 *   3. Fallback: the tenant's own Vobiz number, with `voice_concurrency_limit` (or 3) legs. This keeps today's
 *      behaviour for accounts that have not been put on channels yet, and makes the old hardcoded 3 explicit.
 */

export interface VoiceChannel {
  /** Stable id, used for logging and to keep the round-robin deterministic. */
  id: string;
  /** Human label, e.g. "Channel 2 · +91 79654 80539". */
  label: string;
  /** Vobiz auth account this leg bills to. Empty means the tenant's own default account. */
  authId: string;
  /** Caller ID this channel dials from. Empty means the tenant's default number. */
  number: string;
  /** How many simultaneous calls this channel can carry. */
  concurrent: number;
}

const clean = (value: unknown) => String(value ?? '').trim();

/**
 * Parse the compact `authId:number` list.
 *
 * Written defensively because this string is hand-edited in a dashboard: a stray space, a missing half or a
 * trailing semicolon must cost you that one channel, never the whole list.
 */
export function parseChannelList(raw: string): VoiceChannel[] {
  return String(raw ?? '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const [authId, number, concurrent] = entry.split(':').map((part) => clean(part));
      return {
        id: `ch${index + 1}`,
        label: number ? `Channel ${index + 1} · ${number}` : `Channel ${index + 1}`,
        authId: authId ?? '',
        number: number ?? '',
        concurrent: Math.max(1, Number(concurrent) || 1),
      };
    })
    // A channel with no caller ID cannot place a call, so it is not a channel. That is what makes a stray word in
    // the list cost one entry instead of every call.
    .filter((channel) => channel.number);
}

/** Parse either the JSON or the compact form. Returns [] rather than throwing on junk. */
export function parseChannels(raw: string | undefined | null): VoiceChannel[] {
  const text = clean(raw);
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((entry: any, index: number) => {
          const number = clean(entry?.number);
          const authId = clean(entry?.authId ?? entry?.auth_id);
          if (!number && !authId) return null;
          return {
            id: clean(entry?.id) || `ch${index + 1}`,
            label: clean(entry?.label) || (number ? `Channel ${index + 1} · ${number}` : `Channel ${index + 1}`),
            authId,
            number,
            concurrent: Math.max(1, Number(entry?.concurrent) || 1),
          } as VoiceChannel;
        })
        .filter(Boolean) as VoiceChannel[];
    } catch {
      return [];
    }
  }
  return parseChannelList(text);
}

/**
 * The channels available to one tenant, plus where they came from — the provenance matters, because "3 channels"
 * meaning "the default" and "3 channels" meaning "three lines we pay for" are different facts.
 */
export function loadVoiceChannels(opts: {
  envChannels?: string | null;
  profileNumber?: string | null;
  businessInfo?: any;
  concurrencyLimit?: number | null;
}): { channels: VoiceChannel[]; source: 'env' | 'tenant' | 'fallback' } {
  const fromEnv = parseChannels(opts.envChannels ?? process.env.VOBIZ_CHANNELS);
  if (fromEnv.length) return { channels: fromEnv, source: 'env' };

  const fromTenant = parseChannels(opts.businessInfo?.vobiz_channels);
  if (fromTenant.length) return { channels: fromTenant, source: 'tenant' };

  const number = clean(opts.profileNumber) || clean(opts.businessInfo?.claimed_vobiz_number) || clean(opts.businessInfo?.voice_vobiz_number);
  const legs = Math.max(1, Number(opts.concurrencyLimit) || 3);
  return {
    source: 'fallback',
    channels: [
      {
        id: 'default',
        label: number ? `Default line · ${number}` : 'Default line',
        authId: '',
        number,
        concurrent: legs,
      },
    ],
  };
}

/** Total simultaneous calls the channels allow. This is the ONLY number that should gate dispatch. */
export function channelCapacity(channels: VoiceChannel[]): number {
  return channels.reduce((total, channel) => total + Math.max(1, channel.concurrent || 1), 0);
}

/**
 * Which channel dials the next call.
 *
 * Deterministic round-robin on the seed (a lead id), so the same lead always goes out on the same line — which
 * makes "which number called this person?" answerable from the lead alone — while different leads spread evenly
 * across the channels we pay for.
 */
export function pickChannel(channels: VoiceChannel[], seed: string): VoiceChannel | null {
  if (!channels.length) return null;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return channels[hash % channels.length];
}

/** A one-line, human description of the calling capacity, for logs and for the agent to say out loud. */
export function describeCapacity(channels: VoiceChannel[], source: 'env' | 'tenant' | 'fallback'): string {
  const capacity = channelCapacity(channels);
  const where =
    source === 'env' ? 'configured channels' : source === 'tenant' ? "this business's channels" : 'the default line';
  return `${capacity} simultaneous call${capacity === 1 ? '' : 's'} across ${channels.length} channel${channels.length === 1 ? '' : 's'} (${where})`;
}
