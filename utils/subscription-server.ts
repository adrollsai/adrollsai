import { createClient } from './supabase/server';
import { PLAN_LIMITS } from './subscription';

export async function checkLimitAndIncrement(
    userId: string, 
    type: keyof typeof PLAN_LIMITS
) {
    const supabase = await createClient();
    
    // 1. Fetch current usage and reset date
    const { data: profile, error } = await supabase
        .from('profiles')
        .select(`id, ${type}_used, usage_reset_date`)
        .eq('id', userId)
        .single();

    if (error || !profile) {
        throw new Error("Could not verify account status.");
    }

    let used = (profile as any)[`${type}_used`] || 0;
    const resetDate = profile.usage_reset_date;
    const now = new Date();

    // 2. Check for monthly reset
    if (!resetDate || now > new Date(resetDate)) {
        console.log(`[Subscription] Resetting usage for user ${userId}`);
        const nextReset = new Date();
        nextReset.setMonth(nextReset.getMonth() + 1);

        const resetData = {
            ai_creatives_used: 0,
            campaign_launches_used: 0,
            ai_ad_optimizations_used: 0,
            remarketing_campaigns_used: 0,
            seo_articles_used: 0,
            usage_reset_date: nextReset.toISOString()
        };

        await supabase.from('profiles').update(resetData).eq('id', userId);
        used = 0; // Reset local value for this check
    }

    const limit = PLAN_LIMITS[type];

    // 3. Check if over limit
    if (used >= limit) {
        throw new Error(`Monthly quota reached for ${type.replace('_', ' ')}. Please upgrade your plan.`);
    }

    // 4. Increment
    const { error: updateError } = await supabase
        .from('profiles')
        .update({
            [`${type}_used`]: used + 1
        })
        .eq('id', userId);

    if (updateError) {
        throw new Error("Failed to update usage quota.");
    }

    return true;
}

export async function refundLimit(
    userId: string, 
    type: keyof typeof PLAN_LIMITS
) {
    const supabase = await createClient();
    
    // Fetch current usage
    const { data: profile } = await supabase
        .from('profiles')
        .select(`${type}_used`)
        .eq('id', userId)
        .single();

    const used = (profile as any)?.[`${type}_used`] || 0;
    
    // Decrement if possible (never go below 0)
    if (used > 0) {
        await supabase
            .from('profiles')
            .update({
                [`${type}_used`]: used - 1
            })
            .eq('id', userId);
        console.log(`[Subscription] Refunded 1 ${type} to user ${userId}`);
    }
}

export async function trackStorageUsage(userId: string, bytes: number) {
    const supabase = await createClient();
    
    const { data: profile } = await supabase
        .from('profiles')
        .select('storage_bytes_used')
        .eq('id', userId)
        .single();
        
    const currentBytes = profile?.storage_bytes_used || 0;
    
    await supabase.from('profiles').update({
        storage_bytes_used: currentBytes + bytes
    }).eq('id', userId);
}

export async function checkStorageLimit(userId: string) {
    const supabase = await createClient();
    
    // Calculate real-time usage (more accurate than just trusting storage_bytes_used)
    const { count: assetCount } = await supabase.from('assets').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    const { count: propCount } = await supabase.from('properties').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    const { count: leadCount } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    const { count: msgCount } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('user_id', userId);

    const safeAssetCount = assetCount || 0;
    const safePropCount = propCount || 0;
    const safeLeadCount = leadCount || 0;
    const safeMsgCount = msgCount || 0;

    // Estimation: 2KB per row + 750KB per image
    const dbBytes = (safePropCount + safeLeadCount + safeAssetCount + safeMsgCount) * 2048;
    const mediaBytes = safeAssetCount * 750 * 1024;
    const totalBytesUsed = dbBytes + mediaBytes;
    
    const storageLimitBytes = 10 * 1024 * 1024 * 1024; // 10 GB

    if (totalBytesUsed >= storageLimitBytes) {
        throw new Error("Cloud storage limit reached (10GB). Please manage your assets or upgrade your plan.");
    }

    return true;
}
