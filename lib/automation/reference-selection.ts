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
 * image model as IMAGE 1. The model faithfully reproduced that design's badge. Built-ins are a
 * real-estate shelf (`WATERFRONT LUXURY`, `PRIVATE POOL OASIS`, `RERA Certified`); substituting one for a
 * business that never chose it is how a film academy ends up advertising a swimming pool.
 *
 * THE ORDER, AND WHY
 *   1. a reference a PERSON picked for this generation  — handled by the caller, it is explicit intent;
 *   2. the account's OWN uploads (`reference_creatives`) — these are its brand, by definition;
 *   3. a built-in the owner explicitly ticked (`profiles.selected_templates`) — opt-in, so allowed;
 *   4. nothing — compose from the brief and the brand kit alone.
 *
 * Step 4 is a real answer, not a failure. A wrong reference is worse than no reference: with none, the
 * brief and the brand rules decide the look; with a borrowed one, the creative advertises somebody else's
 * industry.
 */

export interface ReferenceChoice {
  /** The image to send as the design reference, or null when the account has none. */
  url: string | null;
  /** Where it came from, so a thin creative is explainable rather than mysterious. */
  source: 'own' | 'selected' | 'none';
  /** Human label for the log: the account's category, or the built-in's name. */
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

export interface ChooseReferenceInput {
  /** Category hint from the request: 'premium' | 'edm' | 'high_converting' | null. */
  preferCategory?: string | null;
  /**
   * Absolute URL of a built-in design the owner ticked in their profile. Resolved by the caller (this
   * module does not import the template catalogue, so a server bundle never carries it by accident).
   */
  selectedTemplateUrl?: string | null;
  selectedTemplateLabel?: string | null;
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
        url: usableUrl(row?.url),
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
    // A missing table or a read error must not stop a generation; fall through to the next option.
  }

  const selected = usableUrl(input.selectedTemplateUrl);
  if (selected) {
    return { url: selected, source: 'selected', label: input.selectedTemplateLabel || 'a reference the owner selected' };
  }

  return NONE;
}

/**
 * The sentence a caller can log, so "why does this creative look like that" has an answer.
 */
export function describeReferenceChoice(choice: ReferenceChoice): string {
  if (choice.source === 'own') return `built from ${choice.label}`;
  if (choice.source === 'selected') return `built from ${choice.label}, which the owner selected`;
  return 'built from the brief, the brand kit and no borrowed design';
}
