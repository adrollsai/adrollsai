import { createClient } from '@/utils/supabase/server'

export async function getOrgAdminCredentials(orgId: string) {
  const supabase = await createClient();
  
  // 1. Find the Admin/SuperUser for this Org
  // Assuming the creator of the org is the admin, or check roles
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