import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

type RouteProps = {
  params: Promise<{ user_id: string }>;
};

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request, { params }: RouteProps) {
  try {
    const resolvedParams = await params;
    let identifier = decodeURIComponent(resolvedParams.user_id || '').trim();

    // Check if identifier is custom domain or uuid
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

    let resolvedUserId = identifier;
    if (!isUuid) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .or(`custom_domain.eq.${identifier},business_name.ilike.${identifier}`)
        .maybeSingle();

      if (profile?.id) {
        resolvedUserId = profile.id;
      }
    }

    const url = new URL(request.url);
    const destination = new URL('/real-estate-template/index.html', url.origin);
    destination.searchParams.set('userId', resolvedUserId);

    // Forward any additional query parameters
    url.searchParams.forEach((val, key) => {
      if (key !== 'userId') {
        destination.searchParams.set(key, val);
      }
    });

    return NextResponse.redirect(destination.toString(), 307);
  } catch (err: any) {
    console.error('[Website Route] Error:', err);
    return new Response('Unable to load website: ' + err.message, { status: 500 });
  }
}
