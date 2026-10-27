import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', '426490e7-c7ec-43b7-979f-a891f947ab3c')
    .single();

  if (!profile) return;
  const token = profile.facebook_token;

  // Get Page Access Token
  const accRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${token}`);
  const accJson = await accRes.json();
  const targetPage = accJson.data?.find((x: any) => x.id === profile.selected_page_id);
  const pageToken = targetPage?.access_token || token;
  console.log(`Page: ${targetPage?.name} (${targetPage?.id})`);

  // Inspect WhatsApp Phone Number ID
  const phoneNumId = profile.whatsapp_phone_number_id || '1317688188100617';
  console.log(`\n--- Inspecting WhatsApp Phone Number [${phoneNumId}] ---`);
  const phoneRes = await fetch(`https://graph.facebook.com/v21.0/${phoneNumId}?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating,platform_type&access_token=${token}`);
  const phoneData = await phoneRes.json();
  console.log('Phone details:', JSON.stringify(phoneData, null, 2));

  // Check WABA ID linked to this phone number
  const wabaRes = await fetch(`https://graph.facebook.com/v21.0/${phoneNumId}?fields=whatsapp_business_account&access_token=${token}`);
  const wabaData = await wabaRes.json();
  console.log('WABA details:', JSON.stringify(wabaData, null, 2));

  const wabaId = wabaData?.whatsapp_business_account?.id;

  // If WABA ID is found, check message templates
  if (wabaId) {
    const templatesRes = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates?access_token=${token}`);
    const templatesData = await templatesRes.json();
    console.log(`\n--- Message Templates for WABA ${wabaId} ---`);
    console.log(JSON.stringify(templatesData, null, 2));
  }

  // Check Leadgen Forms with Page Token
  console.log('\n--- Leadgen Forms for Page ---');
  const formsRes = await fetch(`https://graph.facebook.com/v21.0/${profile.selected_page_id}/leadgen_forms?fields=id,name,status,leads_count,created_time&access_token=${pageToken}`);
  const formsData = await formsRes.json();
  console.log(JSON.stringify(formsData, null, 2));

  if (formsData.data) {
    for (const f of formsData.data) {
      const leadsRes = await fetch(`https://graph.facebook.com/v21.0/${f.id}/leads?fields=id,created_time,field_data&access_token=${pageToken}`);
      const leadsJson = await leadsRes.json();
      console.log(`\nLeads for "${f.name}" (${f.id}) - total: ${leadsJson.data?.length || 0}`);
      if (leadsJson.data && leadsJson.data.length > 0) {
        console.log(JSON.stringify(leadsJson.data, null, 2));
      }
    }
  }

  // Check Campaign Insights / Ad Level Leads since yesterday
  console.log('\n--- Campaign Insights for DigiPro ---');
  const campId = '120252584916540286';
  const insightsRes = await fetch(`https://graph.facebook.com/v21.0/${campId}/insights?date_preset=yesterday&fields=impressions,clicks,spend,actions&access_token=${token}`);
  console.log('Yesterday Insights:', await insightsRes.json());
  const todayInsightsRes = await fetch(`https://graph.facebook.com/v21.0/${campId}/insights?date_preset=today&fields=impressions,clicks,spend,actions&access_token=${token}`);
  console.log('Today Insights:', await todayInsightsRes.json());
}

main().catch(console.error);
