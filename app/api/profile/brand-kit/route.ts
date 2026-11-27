import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { applyPlaybookPatch } from '@/lib/automation/playbook-service';
import { getActivePlaybook } from '@/lib/automation/ceo';

/**
 * THE BRAND KIT — read and write.
 *
 * WHY: the owner went looking for a brand kit in the profile and there was none. The pieces existed but nowhere to see or
 * set them: `profiles.brand_color`, the logo, and the standing `creative_directives` on the playbook that the image
 * pipeline obeys.
 *
 * WHY A PALETTE AND NOT ONE HEX: a real brand is five colours with a ratio — one client's is about 60% neutral, 25%
 * scarlet, 15% wisteria, with the logo spectrum allowed only as thin stripes. A single swatch cannot express that, which is
 * why they kept saying "still not taking the brand guidelines". So the kit stores an ordered palette of {hex, role} and
 * composes it into the standing rules the gate enforces. `profiles.brand_color` stays equal to the first colour, because
 * older code reads it.
 *
 * No new table: the palette is serialised as the FIRST creative directive ("Brand palette (use ONLY these): #RRGGBB role; …"),
 * which is exactly what `lib/automation/creative-directives` reads. An account with no palette simply has no such rule, and
 * nothing is hardcoded.
 */
export const dynamic = 'force-dynamic';

export interface PaletteEntry {
  hex: string;
  role: string;
}

const HEX = /^#[0-9a-f]{6}$/i;
const PALETTE_PREFIX = 'Brand palette (use ONLY these)';

function cleanPalette(input: unknown): PaletteEntry[] {
  if (!Array.isArray(input)) return [];
  const out: PaletteEntry[] = [];
  for (const raw of input) {
    const hex = String((raw as any)?.hex ?? '').trim().toUpperCase();
    if (!HEX.test(hex)) continue;
    const role = String((raw as any)?.role ?? '').replace(/\s+/g, ' ').trim().slice(0, 48);
    if (out.some((entry) => entry.hex === hex)) continue;
    out.push({ hex, role });
    if (out.length >= 8) break;
  }
  return out;
}

function paletteRule(palette: PaletteEntry[]): string | null {
  if (!palette.length) return null;
  const parts = palette.map((entry) => `${entry.hex}${entry.role ? ` ${entry.role}` : ''}`);
  return (
    `${PALETTE_PREFIX}: ${parts.join('; ')}. ` +
    'Use no other colours. Secondary and accent colours stay secondary — never the dominant fill.'
  );
}

/** Read the palette back out of the stored rule, so the UI edits what is actually enforced. */
function paletteFromRules(rules: string[]): PaletteEntry[] {
  const line = rules.find((rule) => rule.startsWith(PALETTE_PREFIX));
  if (!line) return [];
  const body = line.slice(PALETTE_PREFIX.length).replace(/^:\s*/, '').split('. ')[0];
  return body
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hex, ...rest] = chunk.split(/\s+/);
      return { hex: String(hex || '').toUpperCase(), role: rest.join(' ') };
    })
    .filter((entry) => HEX.test(entry.hex));
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('brand_color, logo_url, business_name')
      .eq('id', user.id)
      .maybeSingle();

    const playbook: any = await getActivePlaybook(supabase as any, user.id);
    const directives = playbook?.creative_directives?.global;
    const allRules: string[] = Array.isArray(directives)
      ? directives.map((d: any) => String(d?.instruction || '').trim()).filter(Boolean)
      : [];

    return NextResponse.json({
      brandColor: (profile as any)?.brand_color || '',
      logoUrl: (profile as any)?.logo_url || '',
      businessName: (profile as any)?.business_name || '',
      palette: paletteFromRules(allRules),
      rulesText: allRules.filter((rule) => !rule.startsWith(PALETTE_PREFIX)).join('\n'),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Could not read the brand kit' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const brandColor = typeof body.brandColor === 'string' ? body.brandColor.trim().toUpperCase() : null;
    const rulesText = typeof body.rulesText === 'string' ? body.rulesText : null;
    const palette = cleanPalette(body.palette);

    if (brandColor !== null && brandColor && !HEX.test(brandColor)) {
      return NextResponse.json({ error: 'Brand colour must look like #0F172A' }, { status: 400 });
    }

    // The primary is the palette's first colour; keep profiles.brand_color in step with it.
    const primary = palette.length ? palette[0].hex : brandColor;
    if (primary !== null) {
      const { error } = await supabase
        .from('profiles')
        .update({ brand_color: primary || null })
        .eq('id', user.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    /**
     * Palette first, then the owner's own rules. The section is REPLACED, so deleting a rule or clearing the palette
     * actually removes it instead of leaving a stale rule behind.
     */
    const instructions: Array<{ id: string; instruction: string }> = [];
    const rule = paletteRule(palette);
    if (rule) instructions.push({ id: 'brand-palette', instruction: rule });

    if (rulesText !== null) {
      rulesText
        .split('\n')
        .map((line: string) => line.trim())
        .filter(Boolean)
        .slice(0, 20)
        .forEach((instruction: string, index: number) =>
          instructions.push({ id: `brand-rule-${index + 1}`, instruction })
        );
    }

    if (instructions.length) {
      const res = await applyPlaybookPatch(
        supabase as any,
        user.id,
        { section: 'creative_directives', value: { global: instructions } } as any,
        { authoredBy: 'user', note: 'brand kit from the profile' }
      );
      if (!res.ok) {
        return NextResponse.json({ error: res.error || 'Could not save the brand kit' }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        savedColours: palette.length,
        savedRules: instructions.length,
        version: res.version,
      });
    }

    return NextResponse.json({ success: true, savedColours: 0, savedRules: 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Could not save the brand kit' }, { status: 500 });
  }
}
