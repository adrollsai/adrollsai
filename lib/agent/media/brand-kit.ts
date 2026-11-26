import type { SupabaseClient } from '@supabase/supabase-js';
import { mergeDirectives } from '@/lib/automation/creative-directives';

/**
 * THE ACCOUNT'S OWN LOOK, FOUND AT GENERATION TIME.
 *
 * WHY
 * A customer's words: "It isn't following the brand guidelines. I see random colours and fonts and design system so far."
 * They were right. The brand machinery exists — `creative_directives` on the playbook, enforced by
 * `lib/automation/creative-directives` and checked by `creative-directive-gate` — but it is wired into ONE tool
 * (`ad_creative`). `generate_ai_image`, the tool that actually stages most images, never read it, and that account's
 * `creative_directives` was `{}` anyway. So the model was asked for a picture with no brand constraints whatsoever.
 *
 * What the account DOES already have, and what this module uses instead of asking anyone to fill in a form:
 *   - `profiles.brand_color` and `profiles.logo_url`
 *   - the images they uploaded to their own catalogue (`properties.images` / `properties.image_url`)
 *   - any standing `creative_directives` or `positioning` on the active playbook
 *
 * The catalogue images are the useful part: they are real examples of the house style, so they ride along as
 * IMAGE-TO-IMAGE references — which constrains palette and lighting far more reliably than adjectives in a prompt.
 */

export interface BrandKit {
  /** Sentences appended to the model prompt. Empty when the account has nothing on file. */
  rules: string;
  /** Catalogue images to use as image-to-image references when the caller supplied none. */
  referenceUrls: string[];
  brandColor: string | null;
  logoUrl: string | null;
  /** Which parts of the kit were found, so a thin result is explainable rather than mysterious. */
  sources: string[];
}

const cleanUrl = (value: unknown): string | null => {
  const url = String(value ?? '').trim();
  return /^https?:\/\//i.test(url) ? url : null;
};

export async function brandKitFor(supabase: SupabaseClient, userId: string): Promise<BrandKit> {
  const kit: BrandKit = { rules: '', referenceUrls: [], brandColor: null, logoUrl: null, sources: [] };
  if (!userId) return kit;

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('business_name, brand_color, logo_url, mission_statement')
      .eq('id', userId)
      .maybeSingle();

    kit.brandColor = String((profile as any)?.brand_color || '').trim() || null;
    kit.logoUrl = cleanUrl((profile as any)?.logo_url);

    // Standing directives, if the account (or the CEO) has written any.
    const { data: playbook } = await supabase
      .from('business_playbooks')
      .select('creative_directives, positioning')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    const directives = mergeDirectives((playbook as any)?.creative_directives ?? null, {});
    const renderedDirectives = (directives.instructions || []).join('\n');

    // Their own catalogue plates: the strongest available evidence of the house style.
    const { data: items } = await supabase
      .from('properties')
      .select('title, image_url, images')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(6);

    for (const item of (items || []) as any[]) {
      const list: string[] = [];
      if (Array.isArray(item?.images)) {
        for (const img of item.images) {
          const url = cleanUrl(typeof img === 'string' ? img : img?.url);
          if (url) list.push(url);
        }
      }
      const primary = cleanUrl(item?.image_url);
      if (primary) list.unshift(primary);
      for (const url of list) {
        if (kit.referenceUrls.length < 3 && !kit.referenceUrls.includes(url)) kit.referenceUrls.push(url);
      }
      if (kit.referenceUrls.length >= 3) break;
    }
    if (kit.referenceUrls.length) kit.sources.push(`${kit.referenceUrls.length} catalogue image(s)`);

    const lines: string[] = [];
    if (kit.brandColor) {
      kit.sources.push('brand colour');
      lines.push(`Brand colour ${kit.brandColor} must drive the palette — accents, overlays and type highlights, not a random hue.`);
    }
    if (directives && (directives.instructions?.length || directives.bans?.length)) {
      kit.sources.push('standing directives');
      lines.push(renderedDirectives || String((playbook as any)?.positioning || '').trim());
    } else if (String((playbook as any)?.positioning || '').trim()) {
      kit.sources.push('positioning');
      lines.push(`Positioning: ${String((playbook as any).positioning).trim()}`);
    }
    if (kit.referenceUrls.length) {
      lines.push(
        'The attached reference images are THIS BRAND\'S OWN catalogue artwork. Match their palette, typography weight, ' +
          'logo treatment, texture and lighting exactly; do not introduce a new art direction, and do not copy their ' +
          'layout verbatim.'
      );
    }
    if (kit.logoUrl) {
      kit.sources.push('logo');
      lines.push('Leave clean, uncluttered space where the brand logo belongs; never invent or redraw the logo.');
    }

    kit.rules = lines.filter(Boolean).join('\n');
    return kit;
  } catch (err: any) {
    // A brand kit is an improvement, never a blocker: a lookup failure must not stop an image the owner paid for.
    console.warn('[brand-kit] lookup failed:', err?.message || err);
    return kit;
  }
}

/** Append the kit to a prompt, in one place so every caller produces the same shape. */
export function withBrandRules(prompt: string, kit: BrandKit): string {
  const base = String(prompt || '').trim();
  if (!kit.rules) return base;
  return `${base}\n\nBRAND LOCK — this business's own design system, which outranks generic styling:\n${kit.rules}`;
}
