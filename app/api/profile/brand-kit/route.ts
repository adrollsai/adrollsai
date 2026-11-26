import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { applyPlaybookPatch } from '@/lib/automation/playbook-service';
import { getActivePlaybook } from '@/lib/automation/ceo';
import { brandKitFor } from '@/lib/agent/media/brand-kit';

/**
 * THE BRAND KIT — read and write.
 *
 * WHY: the owner went looking for a brand kit in the profile and there was none. The pieces existed but nowhere to see
 * or set them: `profiles.brand_color`, the logo, and the standing `creative_directives` on the playbook (which the image
 * tool now obeys). So an owner could not say "always navy and gold, never stock photos, no gradients" anywhere.
 *
 * This exposes exactly those, and nothing else: colour, the reference images the AI will copy, and free-text rules that
 * are stored as standing creative directives — the same field `lib/automation/creative-directives` enforces, so a rule
 * typed here is a rule that actually binds.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const kit = await brandKitFor(supabase as any, user.id);
    const { data: profile } = await supabase
      .from('profiles')
      .select('brand_color, logo_url, business_name')
      .eq('id', user.id)
      .maybeSingle();

    const playbook: any = await getActivePlaybook(supabase as any, user.id);
    const directives = playbook?.creative_directives?.global;
    const rulesText = Array.isArray(directives)
      ? directives.map((d: any) => String(d?.instruction || '').trim()).filter(Boolean).join('\n')
      : '';


    return NextResponse.json({
      brandColor: (profile as any)?.brand_color || '',
      logoUrl: (profile as any)?.logo_url || '',
      businessName: (profile as any)?.business_name || '',
      rulesText,
      activeSources: kit.sources,
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
    const brandColor = typeof body.brandColor === 'string' ? body.brandColor.trim() : null;
    const rulesText = typeof body.rulesText === 'string' ? body.rulesText : null;

    if (brandColor !== null) {
      if (brandColor && !/^#[0-9a-f]{6}$/i.test(brandColor)) {
        return NextResponse.json({ error: 'Brand colour must look like #0F172A' }, { status: 400 });
      }
      const { error } = await supabase
        .from('profiles')
        .update({ brand_color: brandColor || null })
        .eq('id', user.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let savedRules = 0;
    if (rulesText !== null) {
      /**
       * One rule per line, stored as standing creative directives. Blank lines are dropped rather than saved as empty
       * instructions, and the section is REPLACED so deleting a rule actually deletes it.
       */
      const instructions = rulesText
        .split('\n')
        .map((line: string) => line.trim())
        .filter(Boolean)
        .slice(0, 20)
        .map((instruction: string, index: number) => ({ id: `brand-rule-${index + 1}`, instruction }));

      const res = await applyPlaybookPatch(
        supabase as any,
        user.id,
        { section: 'creative_directives', value: { global: instructions } } as any,
        { authoredBy: 'user', note: 'brand kit rules from the profile' }
      );
      if (!res.ok) {
        return NextResponse.json({ error: res.error || 'Could not save the brand rules' }, { status: 500 });
      }
      savedRules = instructions.length;
    }

    return NextResponse.json({ success: true, savedRules });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Could not save the brand kit' }, { status: 500 });
  }
}
