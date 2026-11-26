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
 * WHAT IS IN THE KIT, AND WHAT IS NOT
 * The kit is the brand: colour, logo rules, and the standing directives the owner writes in Profile → Brand Kit.
 *
 * Catalogue images are deliberately NOT part of it. They belong to a listing (a course, a property, a product) — they are
 * content, and the agent passes them as references when it is making a creative ABOUT that item. Using them silently as
 * the brand's look happened to look right for one academy whose listing photos matched their branding, and would quietly
 * mis-brand anyone whose catalogue photos are ordinary product shots.
 */

export interface BrandKit {
  /** Sentences appended to the model prompt. Empty when the account has nothing on file. */
  rules: string;
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
  const kit: BrandKit = { rules: '', brandColor: null, logoUrl: null, sources: [] };
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

    const lines: string[] = [];
    if (kit.brandColor) {
      kit.sources.push('brand colour');
      lines.push(`Brand colour ${kit.brandColor} must drive the palette — accents, overlays and type highlights, not a random hue.`);
    }
    if (directives && (directives.instructions?.length || directives.bans?.length)) {
      kit.sources.push('standing rules');
      if (renderedDirectives) lines.push(`Standing brand rules, which outrank any other styling:\n${renderedDirectives}`);
    } else if (String((playbook as any)?.positioning || '').trim()) {
      kit.sources.push('positioning');
      lines.push(`Positioning: ${String((playbook as any).positioning).trim()}`);
    }
    if (kit.logoUrl) {
      kit.sources.push('logo');
      lines.push('Leave clean, uncluttered space where the brand logo belongs; never invent or redraw the logo.');
    }
    if (kit.sources.length) {
      lines.push('Keep the type treatment consistent with previous material for this business: one weight family, no novelty fonts.');
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
