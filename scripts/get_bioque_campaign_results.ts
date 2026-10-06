import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
dotenv.config();

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BIOQUE_USER_ID = '68b55a31-a16d-454d-a20f-11adabf590b0';

async function main() {
  console.log('=== 1. FETCHING META ADS CAMPAIGN METRICS FOR BIOQUE ESTATES ===');
  
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('facebook_token, ad_account_id, credits')
    .eq('id', BIOQUE_USER_ID)
    .single();

  const accessToken = profile?.facebook_token;
  const adAccountId = profile?.ad_account_id;

  console.log('Ad Account:', adAccountId);
  console.log('Credits Balance:', profile?.credits);

  if (accessToken && adAccountId) {
    const cleanAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    
    // Fetch campaigns
    const campUrl = `https://graph.facebook.com/v21.0/${cleanAdAccountId}/campaigns?fields=id,name,status,effective_status,daily_budget,created_time&limit=25&access_token=${accessToken}`;
    const campRes = await fetch(campUrl);
    const campData = await campRes.json();
    
    console.log('\n--- Active / Recent Campaigns on Meta ---');
    if (campData?.data) {
      for (const camp of campData.data) {
        // Fetch insights for today
        const insightUrl = `https://graph.facebook.com/v21.0/${camp.id}/insights?date_preset=today&fields=spend,impressions,clicks,cpc,ctr,reach,actions,cost_per_action_type&access_token=${accessToken}`;
        const insRes = await fetch(insightUrl);
        const insData = await insRes.json();
        const ins = insData?.data?.[0] || {};

        let leads = 0;
        let cpl = 'N/A';
        if (ins.actions) {
          const leadAction = ins.actions.find((a: any) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped');
          if (leadAction) leads = parseInt(leadAction.value, 10);
        }
        if (ins.cost_per_action_type) {
          const costLead = ins.cost_per_action_type.find((a: any) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped');
          if (costLead) cpl = `₹${parseFloat(costLead.value).toFixed(2)}`;
        }

        console.log(`\n• Campaign: ${camp.name}`);
        console.log(`  ID: ${camp.id} | Status: ${camp.effective_status} | Daily Budget: ₹${(parseInt(camp.daily_budget, 10) / 100) || 500}`);
        console.log(`  Spend Today: ₹${ins.spend ? parseFloat(ins.spend).toFixed(2) : '0.00'}`);
        console.log(`  Impressions: ${ins.impressions || 0} | Reach: ${ins.reach || 0} | Clicks: ${ins.clicks || 0} (CTR: ${ins.ctr ? (parseFloat(ins.ctr) * 100).toFixed(2) + '%' : '0%'})`);
        console.log(`  Leads Generated: ${leads} | Cost Per Lead: ${cpl}`);
      }
    } else {
      console.log('Error fetching campaigns:', campData);
    }
  }

  console.log('\n=== 2. FETCHING TODAY\'S LEADS IN CRM (BIOQUE ESTATES) ===');
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data: leads, error: leadsErr } = await supabaseAdmin
    .from('leads')
    .select('id, name, phone, email, ad_name, form_name, campaign_id, created_at, voice_call_status, voice_call_summary, custom_fields')
    .eq('user_id', BIOQUE_USER_ID)
    .gte('created_at', todayStart.toISOString())
    .order('created_at', { ascending: false });

  if (leadsErr) {
    console.error('Error fetching leads:', leadsErr);
    return;
  }

  console.log(`Total Leads Received Today: ${leads?.length || 0}`);

  if (leads && leads.length > 0) {
    for (const lead of leads) {
      let cf: any = {};
      try {
        cf = typeof lead.custom_fields === 'string' ? JSON.parse(lead.custom_fields) : (lead.custom_fields || {});
      } catch (e) {}

      const campName = cf.meta_ad_origin?.campaign_name || lead.ad_name || 'N/A';
      console.log(`\n------------------------------------------------------`);
      console.log(`👤 Lead: ${lead.name || 'Unnamed'} | 📞 ${lead.phone || 'No Phone'}`);
      console.log(`   Campaign: ${campName}`);
      console.log(`   Form: ${lead.form_name || cf.meta_ad_origin?.body || 'Instant Form'}`);
      console.log(`   Time: ${new Date(lead.created_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
      console.log(`   Form Answers:`);
      for (const [k, v] of Object.entries(cf)) {
        if (!['meta_ad_origin', 'is_instant_form', 'qualification_completed', 'all_facebook_lead_ids', 'lead_priority', 'is_interested', 'is_qualified', 'calling_enabled', 'lead_score', 'lead_tier', 'score_breakdown', 'score_updated_at'].includes(k)) {
          console.log(`     - ${k}: ${v}`);
        }
      }
      console.log(`   Call Status: ${lead.voice_call_status || 'not_called'}`);
      if (lead.voice_call_summary) {
        console.log(`   Call Summary: ${lead.voice_call_summary}`);
      }
    }
  }
}

main().catch(console.error);
