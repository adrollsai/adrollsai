import { SupabaseClient } from '@supabase/supabase-js'

// UPDATED: Now accepts 'supabase' as a dependency to reuse the connection
export async function getOrgAdminCredentials(supabase: SupabaseClient, orgId: string) {
  
  // 1. Find the Admin/SuperUser for this Org
  // We use the passed 'supabase' client which is already authenticated/context-aware
  const { data: adminProfile, error } = await supabase
    .from('profiles')
    .select('ad_account_id, facebook_token, selected_page_id')
    .eq('organization_id', orgId)
    .in('role', ['admin', 'super_user']) 
    .not('facebook_token', 'is', null) // Must have connected FB
    .limit(1)
    .single();

  if (error || !adminProfile) {
    throw new Error("Organization Admin has not connected Facebook Ads yet.");
  }

  return {
    adAccountId: adminProfile.ad_account_id,
    facebookToken: adminProfile.facebook_token,
    pageId: adminProfile.selected_page_id
  };
}