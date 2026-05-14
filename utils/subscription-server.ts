import { createClient } from './supabase/server';
import { PLAN_LIMITS } from './subscription';

export async function checkLimitAndIncrement(
    userId: string, 
    type: keyof typeof PLAN_LIMITS
) {
    const supabase = await createClient();
    
    const UNLIMITED_USERS = ['bc63c065-9bcc-4793-bedc-f0960406425b'];
    if (UNLIMITED_USERS.includes(userId)) return true;

    // 1. Fetch current usage and reset date
    const { data: profile, error } = await supabase
        .from('profiles')
        .select(`id, ${type}_used, usage_reset_date, parent_id`)
        .eq('id', userId)
        .single();

    if (error || !profile) {
        throw new Error("Could not verify account status.");
    }

    // Resolve Primary User ID (Owner of the limits)
    const primaryUserId = profile.parent_id || userId;
    
    // If current user is an agent, we MUST re-fetch the parent's actual usage
    let profileToUpdate = profile;
    if (profile.parent_id) {
        const { data: parentProfile } = await supabase
            .from('profiles')
            .select(`id, ${type}_used, usage_reset_date, parent_id`)
            .eq('id', profile.parent_id)
            .single();
        if (parentProfile) profileToUpdate = parentProfile;
    }

    let used = (profileToUpdate as any)[`${type}_used`] || 0;
    const resetDate = profileToUpdate.usage_reset_date;
    const now = new Date();

    // 2. Check for monthly reset
    if (!resetDate || now > new Date(resetDate)) {
        console.log(`[Subscription] Resetting usage for primary user ${primaryUserId}`);
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

        await supabase.from('profiles').update(resetData).eq('id', primaryUserId);
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
        .eq('id', primaryUserId);

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
    
    // Resolve Primary User ID
    const { data: userProfile } = await supabase.from('profiles').select('parent_id').eq('id', userId).single();
    const primaryUserId = userProfile?.parent_id || userId;

    // Fetch current usage of primary user
    const { data: profile } = await supabase
        .from('profiles')
        .select(`${type}_used`)
        .eq('id', primaryUserId)
        .single();

    const used = (profile as any)?.[`${type}_used`] || 0;
    
    // Decrement if possible (never go below 0)
    if (used > 0) {
        await supabase
            .from('profiles')
            .update({
                [`${type}_used`]: used - 1
            })
            .eq('id', primaryUserId);
        console.log(`[Subscription] Refunded 1 ${type} to user ${primaryUserId} (requested by ${userId})`);
    }
}

export async function trackStorageUsage(userId: string, bytes: number) {
    const supabase = await createClient();
    
    const { data: userProfile } = await supabase.from('profiles').select('parent_id').eq('id', userId).single();
    const primaryUserId = userProfile?.parent_id || userId;
    
    const { data: profile } = await supabase
        .from('profiles')
        .select('storage_bytes_used')
        .eq('id', primaryUserId)
        .single();
        
    const currentBytes = profile?.storage_bytes_used || 0;
    
    await supabase.from('profiles').update({
        storage_bytes_used: currentBytes + bytes
    }).eq('id', primaryUserId);
}

export async function checkStorageLimit(userId: string) {
    const supabase = await createClient();
    
    // Resolve Primary User ID
    const { data: userProfile } = await supabase.from('profiles').select('parent_id').eq('id', userId).single();
    const primaryUserId = userProfile?.parent_id || userId;
    
    // Calculate real-time usage (more accurate than just trusting storage_bytes_used)
    const { count: assetCount } = await supabase.from('assets').select('id', { count: 'exact', head: true }).eq('user_id', primaryUserId);
    const { count: propCount } = await supabase.from('properties').select('id', { count: 'exact', head: true }).eq('user_id', primaryUserId);
    const { count: leadCount } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', primaryUserId);
    const { count: msgCount } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('user_id', primaryUserId);

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
