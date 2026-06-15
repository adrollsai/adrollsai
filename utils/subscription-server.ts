import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js';
import { createClient } from './supabase/server';
import { getUserLimits } from './subscription';

// Helper to create a secure service-role client bypassing RLS policies for backend quota management
const getAdminClient = async () => {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceKey) {
        return createSupabaseAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            serviceKey
        );
    }
    console.warn("[Subscription Server] WARNING: SUPABASE_SERVICE_ROLE_KEY is missing! Falling back to standard client.");
    return await createClient();
};

export async function checkLimitAndIncrement(
    userId: string, 
    type: 'videos' | 'images' | 'seo_articles' | 'campaign_launches' | 'campaign_optimizations' | 'retargeting_campaigns'
) {
    const supabase = await getAdminClient();
    
    const UNLIMITED_USERS = [
        'bc63c065-9bcc-4793-bedc-f0960406425b',
        'c890a11f-84ce-4592-ab8f-8682927b1a9d',
        '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2'
    ];
    if (UNLIMITED_USERS.includes(userId)) return true;

    // Map new types to their corresponding DB columns (for both old and new schemas)
    const dbColumnMap: Record<string, string> = {
        videos: 'videos_used',
        images: 'images_used',
        seo_articles: 'seo_articles_used',
        campaign_launches: 'campaign_launches_used',
        campaign_optimizations: 'campaign_optimizations_used',
        retargeting_campaigns: 'retargeting_campaigns_used'
    };

    const legacyColumnMap: Record<string, string> = {
        videos: 'ai_creatives_used',
        images: 'ai_creatives_used',
        seo_articles: 'seo_articles_used',
        campaign_launches: 'campaign_launches_used',
        campaign_optimizations: 'ai_ad_optimizations_used',
        retargeting_campaigns: 'remarketing_campaigns_used'
    };

    const dbColumn = dbColumnMap[type];
    const legacyColumn = legacyColumnMap[type];

    // 1. Fetch current usage, reset date, and full subscription status
    const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

    if (error || !profile) {
        console.error("[Subscription Check Error]:", error);
        throw new Error(`Could not verify account status. Details: ${error ? error.message : 'Profile record empty for target: ' + userId}`);
    }

    // Resolve Primary User ID (Owner of the limits)
    const primaryUserId = profile.parent_id || userId;
    
    // If current user is an agent, we MUST re-fetch the parent's actual profile
    let profileToUpdate = profile;
    if (profile.parent_id) {
        const { data: parentProfile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', profile.parent_id)
            .single();
        if (parentProfile) profileToUpdate = parentProfile;
    }

    // Resolve limits dynamically
    const limits = getUserLimits(profileToUpdate);
    const limit = limits[type as keyof typeof limits] || 0;

    // Determine current usage value (prefer new column if present, fallback to legacy)
    let used = 0;
    if (dbColumn in profileToUpdate && (profileToUpdate as any)[dbColumn] !== null) {
        used = (profileToUpdate as any)[dbColumn];
    } else if (legacyColumn in profileToUpdate) {
        used = (profileToUpdate as any)[legacyColumn] || 0;
    }

    const resetDate = profileToUpdate.usage_reset_date;
    const now = new Date();

    // 2. Check for monthly reset
    if (!resetDate || now > new Date(resetDate)) {
        console.log(`[Subscription] Resetting usage for primary user ${primaryUserId}`);
        const nextReset = new Date();
        nextReset.setMonth(nextReset.getMonth() + 1);

        const resetData = {
            videos_used: 0,
            images_used: 0,
            seo_articles_used: 0,
            campaign_launches_used: 0,
            campaign_optimizations_used: 0,
            retargeting_campaigns_used: 0,
            // also reset legacy columns for safety
            ai_creatives_used: 0,
            ai_ad_optimizations_used: 0,
            remarketing_campaigns_used: 0,
            usage_reset_date: nextReset.toISOString()
        };

        await supabase.from('profiles').update(resetData).eq('id', primaryUserId);
        used = 0; // Reset local value for this check
    }

    // 3. Check if over limit
    if (used >= limit) {
        throw new Error(`Monthly quota reached for ${type.replace('_', ' ')}. Please upgrade your plan or purchase an add-on.`);
    }

    // 4. Increment both new and legacy columns for complete backward and forward compatibility
    const updateData: any = {};
    if (dbColumn in profileToUpdate) {
        updateData[dbColumn] = used + 1;
    }
    if (legacyColumn in profileToUpdate) {
        const oldVal = (profileToUpdate as any)[legacyColumn] || 0;
        updateData[legacyColumn] = oldVal + 1;
    }

    const { error: updateError } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', primaryUserId);

    if (updateError) {
        throw new Error("Failed to update usage quota.");
    }

    return true;
}

export async function refundLimit(
    userId: string, 
    type: 'videos' | 'images' | 'seo_articles' | 'campaign_launches' | 'campaign_optimizations' | 'retargeting_campaigns'
) {
    const supabase = await getAdminClient();
    
    // Resolve Primary User ID
    const { data: userProfile } = await supabase.from('profiles').select('parent_id').eq('id', userId).single();
    const primaryUserId = userProfile?.parent_id || userId;

    // Fetch current usage of primary user
    const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', primaryUserId)
        .single();

    if (!profile) return;

    const dbColumnMap: Record<string, string> = {
        videos: 'videos_used',
        images: 'images_used',
        seo_articles: 'seo_articles_used',
        campaign_launches: 'campaign_launches_used',
        campaign_optimizations: 'campaign_optimizations_used',
        retargeting_campaigns: 'retargeting_campaigns_used'
    };

    const legacyColumnMap: Record<string, string> = {
        videos: 'ai_creatives_used',
        images: 'ai_creatives_used',
        seo_articles: 'seo_articles_used',
        campaign_launches: 'campaign_launches_used',
        campaign_optimizations: 'ai_ad_optimizations_used',
        retargeting_campaigns: 'remarketing_campaigns_used'
    };

    const dbColumn = dbColumnMap[type];
    const legacyColumn = legacyColumnMap[type];

    const updateData: any = {};

    if (dbColumn in profile) {
        const used = (profile as any)[dbColumn] || 0;
        if (used > 0) updateData[dbColumn] = used - 1;
    }
    if (legacyColumn in profile) {
        const used = (profile as any)[legacyColumn] || 0;
        if (used > 0) updateData[legacyColumn] = used - 1;
    }

    if (Object.keys(updateData).length > 0) {
        await supabase
            .from('profiles')
            .update(updateData)
            .eq('id', primaryUserId);
        console.log(`[Subscription] Refunded 1 ${type} to user ${primaryUserId}`);
    }
}

export async function trackStorageUsage(userId: string, bytes: number) {
    const supabase = await getAdminClient();
    
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
    const supabase = await getAdminClient();
    
    // Resolve Primary User ID
    const { data: userProfile } = await supabase.from('profiles').select('parent_id').eq('id', userId).single();
    const primaryUserId = userProfile?.parent_id || userId;
    
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', primaryUserId).single();
    if (!profile) return true;

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
    
    // Resolve dynamic limit based on plan
    const limits = getUserLimits(profile);
    const storageLimitGb = limits.storage_gb || 10;
    const storageLimitBytes = storageLimitGb * 1024 * 1024 * 1024;

    if (totalBytesUsed >= storageLimitBytes) {
        throw new Error(`Cloud storage limit reached (${storageLimitGb}GB). Please manage your assets or upgrade your plan.`);
    }

    return true;
}
