import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { whatsAppHealth } from '@/lib/whatsapp/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Can this account send a campaign right now?"
 *
 * The WhatsApp tab shows this before the launch button, because launching into an account Meta is
 * refusing produced a 16,317-recipient campaign with 122 delivered and the rest refused — a queue, a
 * progress screen and 2,000 failure rows, all of which one read would have prevented.
 */
export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const impersonateId = String(new URL(req.url).searchParams.get('impersonate') ?? '').trim();
    const ownerId = impersonateId || user.id;

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const health = await whatsAppHealth(admin, ownerId);
    return NextResponse.json({ success: true, ...health });
  } catch (error: any) {
    console.error('[WhatsApp health] failed:', error);
    return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
