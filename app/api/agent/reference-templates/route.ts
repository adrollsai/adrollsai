import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { ALL_REFERENCE_TEMPLATES } from '@/utils/reference-templates-data';

export const revalidate = 3600;

/**
 * The catalogue the Create panel offers.
 *
 * The agent already had these 35 reference creatives through
 * `list_reference_creatives`; the UI had no way to show them before a job starts,
 * so a user could not say "make it like that one" by pointing at it. This is a thin,
 * read-only projection: id, name, category, badge, thumbnail.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({
    templates: ALL_REFERENCE_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      library: t.libraryCategory,
      badge: t.badge,
      thumb: t.fallbackImage || t.url,
      url: t.url,
    })),
  });
}
