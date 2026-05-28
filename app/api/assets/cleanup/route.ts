import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
    try {
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const fortyFiveMinutesAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString();

        // Find all assets in 'Processing' state
        const { data: activeAssets, error: fetchError } = await supabaseAdmin
            .from('assets')
            .select('id, type, created_at')
            .eq('status', 'Processing');

        if (fetchError) throw fetchError;

        // Filter for stuck assets in memory:
        // - Images: stuck after 10 minutes
        // - Videos: stuck after 45 minutes (to allow parallel scene generations + stitching)
        const stuckAssets = activeAssets?.filter(asset => {
            const createdAtTime = new Date(asset.created_at).getTime();
            if (asset.type === 'video') {
                return createdAtTime < new Date(fortyFiveMinutesAgo).getTime();
            } else {
                return createdAtTime < new Date(tenMinutesAgo).getTime();
            }
        }) || [];

        if (stuckAssets.length > 0) {
            const ids = stuckAssets.map(a => a.id);
            console.log(`[Cleanup] Marking ${ids.length} stuck assets as Failed. Stuck ids:`, ids);
            
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
