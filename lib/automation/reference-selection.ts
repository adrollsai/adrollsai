import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * WHICH DESIGN A CREATIVE IS BUILT FROM — the account's own, or nothing.
 *
 * THE CASE THIS EXISTS FOR
 * A film academy's admin generated an image in the Creation tab and got a cinematography poster carrying
 * the words "PRIVATE POOL OASIS", a property map-pin and "premium property" copy. Measured on that account
 * (Procolor Film Academy, industry `education`): `profiles.selected_templates` was `[]`, it had NINETEEN
 * rows of its own in `reference_creatives`, and `app/api/chat` used none of them — it called
 * `getRandomReferenceTemplate()` and sent a random pin from the 35 built-in Dubai property designs to the
 * image model as IMAGE 1. The model faithfully reproduced that design's badge.
 *
 * THE RULE, IN THE OPERATOR'S WORDS
 * "never use the super admin designs for real estate for any account, use the users' own ref if uploaded,
 *  it's own brand kit if provided otherwise the ai can create a prompt on it's own based on the data it
 *  has access to"
 *
 * So, in order:
 *   1. the account's OWN uploads (`reference_creatives` where user_id is the account) — its brand, by
 *      definition. Nothing competes with them;
 *   2. nothing. Not a built-in. EVER — not randomly, and not because somebody ticked one. The built-in
 *      shelf is the super admin's real-estate demo set (`reference_creatives` rows with `user_id IS NULL`,
 *      plus the 35 templates in `utils/reference-templates-data`), and no other business may be dressed
 *      in it;
 *   3. with no reference, the caller composes from what it knows: the brief, the account's own data and
 *      the brand kit. That is a complete answer, not a degraded one.
 *
 * `isSuperAdminReference` is exported so every entry point can refuse a built-in that arrives by any other
 * door — a client sending `templateUrl`, a stored `selected_templates` value, a stale cached page.
 */

export interface ReferenceChoice {
  /** The image to send as the design reference, or null when the account has none. */
  url: string | null;
  /** Where it came from, so a thin creative is explainable rather than mysterious. */
  source: 'own' | 'none';
  /** Human label for the log: the account's category, or that there is nothing on file. */
  label: string;
}

const NONE: ReferenceChoice = { url: null, source: 'none', label: 'none on file' };

/** A design reference has to be a real image URL; anything else is not a reference. */
const usableUrl = (value: unknown): string | null => {
  const url = String(value ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  if (url.includes('placehold.co')) return null;
  if (/\.svg($|\?)/i.test(url)) return null;
  return url;
};

/**
 * Is this one of the super admin's built-in designs?
 *
 * Matched by URL shape rather than by importing the catalogue, so a server bundle never carries 35 Dubai
 * pins around — and so an old cached template id (`pinterest_pin_17`, `pinterest_damac_island`) is caught
 * too. Every built-in lives under the `reference-creatives/dubai/pinterest_pin_1793111079523_<n>.jpg`
 * prefix in the R2 bucket the demo shelf is served from.
 */
export function isSuperAdminReference(value: unknown): boolean {
  const text = String(value ?? '').trim();
  if (!text) return false;
  if (/pinterest_pin_\d+/i.test(text)) return true;
  if (/pinterest_(damac|emirates|marbella|property_showcase|investment_flyer|luxury_architectural)/i.test(text)) return true;
  if (/reference-creatives\/dubai\//i.test(text)) return true;
  return false;
}

export interface ChooseReferenceInput {
  /** Category hint from the request: 'premium' | 'edm' | 'high_converting' | null. */
  preferCategory?: string | null;
  /** Deterministic pick, so the same request twice returns the same reference. */
  seed?: string | null;
}

/** A tiny stable hash — enough to spread requests over the account's references without a shared counter. */
function hash(input: string): number {
  let value = 0;
  for (let index = 0; index < input.length; index += 1) {
    value = (value * 31 + input.charCodeAt(index)) % 2147483647;
  }
  return value;
}

export async function chooseReferenceCreative(
  supabase: SupabaseClient,
  userId: string,
  input: ChooseReferenceInput = {},
): Promise<ReferenceChoice> {
  if (!userId) return NONE;

  try {
    const { data: rows } = await supabase
      .from('reference_creatives')
      .select('id, url, category, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);

    const own = (rows || [])
      .map((row: any) => ({
        // A built-in that somehow carries this user_id is still a built-in.
        url: isSuperAdminReference(row?.url) ? null : usableUrl(row?.url),
        category: String(row?.category ?? '').trim().toLowerCase(),
        id: String(row?.id ?? ''),
      }))
      .filter((row) => row.url);

    if (own.length > 0) {
      // Prefer the account's own references in the requested category, then any of its own.
      const wanted = String(input.preferCategory ?? '').trim().toLowerCase();
      const preferred = wanted ? own.filter((row) => row.category && row.category.includes(wanted)) : [];
      const pool = preferred.length > 0 ? preferred : own;
      const index = input.seed ? hash(`${input.seed}:${pool.length}`) % pool.length : Math.floor(Math.random() * pool.length);
      const picked = pool[index];
      return {
        url: picked.url,
        source: 'own',
        label: `own reference${picked.category ? ` (${picked.category})` : ''}`,
      };
    }
  } catch {
    // A missing table or a read error must not stop a generation; fall through to "no reference".
  }

  return NONE;
}

/**
 * Is this URL one this account may use as its reference?
 *
 * The door for a caller that already has a URL in hand (the Creation tab, a stored selection). It must be
 * one of the ACCOUNT'S OWN uploads — looked up in `reference_creatives` for that user — and never a
 * built-in. `ownUrls` lets a caller that already knows the account's library answer without a query.
 */
export async function isOwnReferenceCreative(
  supabase: SupabaseClient,
  userId: string,
  url: string | null | undefined,
  ownUrls?: readonly string[],
): Promise<boolean> {
  const candidate = usableUrl(url);
  if (!candidate || !userId) return false;
  if (isSuperAdminReference(candidate)) return false;

  if (ownUrls && ownUrls.length > 0) {
    const bare = (value: string) => value.split('?')[0];
    if (ownUrls.some((own) => bare(String(own)) === bare(candidate))) return true;
  }

  try {
    const { data } = await supabase
      .from('reference_creatives')
      .select('id, url')
      .eq('user_id', userId)
      .limit(200);
    const bare = (value: string) => String(value).split('?')[0];
    return (data || []).some((row: any) => bare(row?.url ?? '') === bare(candidate));
  } catch {
    return false;
  }
}

/**
 * The sentence a caller can log, so "why does this creative look like that" has an answer.
 */
export function describeReferenceChoice(choice: ReferenceChoice): string {
  if (choice.source === 'own') return `built from ${choice.label}`;
  return 'built from the brief, the brand kit and the account\u2019s own data — no borrowed design';
}
