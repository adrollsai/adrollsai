import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
    try {
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

        // Find assets in 'Processing' state older than 10 minutes
        const { data: stuckAssets, error: fetchError } = await supabaseAdmin
            .from('assets')
            .select('id')
            .eq('status', 'Processing')
            .lt('created_at', tenMinutesAgo);

        if (fetchError) throw fetchError;

        if (stuckAssets && stuckAssets.length > 0) {
            const ids = stuckAssets.map(a => a.id);
            console.log(`[Cleanup] Marking ${ids.length} stuck assets as Failed.`);
            
            const { error: updateError } = await supabaseAdmin
                .from('assets')
                .update({ status: 'Failed' })
                .in('id', ids);

            if (updateError) throw updateError;
            
            return NextResponse.json({ success: true, count: ids.length });
        }

        return NextResponse.json({ success: true, count: 0 });
    } catch (error: any) {
        console.error("[Cleanup Error]", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
