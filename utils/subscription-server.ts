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
