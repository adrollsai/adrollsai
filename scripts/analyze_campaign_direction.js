const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectData() {
  const { data: bioque } = await supabase
    .from('profiles')
    .select('facebook_token')
    .eq('id', '68b55a31-a16d-454d-a20f-11adabf590b0')
    .single();

  const token = bioque.facebook_token;
  const broadAdsetId = '120251924471460304';

  // 1. Hourly breakdown for today
  console.log('=== HOURLY INSIGHTS FOR BROAD ADSET (21 OCT) ===');
  const hourlyRes = await (await fetch('https://graph.facebook.com/v21.0/' + broadAdsetId + '/insights?date_preset=today&breakdowns=hourly_stats_aggregated_by_audience_time_zone&fields=impressions,clicks,spend,cpc,cpm,actions&access_token=' + token)).json();
  
  if (hourlyRes.data) {
    hourlyRes.data.forEach(h => {
      const linkClicks = h.actions?.find(a => a.action_type === 'link_click')?.value || 0;
      const leads = h.actions?.find(a => a.action_type === 'lead')?.value || 0;
      console.log(`Hour: ${h.hourly_stats_aggregated_by_audience_time_zone} | Spend: ₹${Number(h.spend).toFixed(2)} | Imp: ${h.impressions} | Clicks: ${h.clicks} | CPM: ₹${Number(h.cpm).toFixed(2)} | CPC: ₹${Number(h.cpc || 0).toFixed(2)} | LinkClicks: ${linkClicks} | Leads: ${leads}`);
    });
  } else {
    console.log('Hourly error/empty:', hourlyRes);
  }

  // 2. Day-by-day comparison (20 Oct vs 21 Oct)
  console.log('\n=== LAST 3 DAYS AGGREGATE COMPARISON ===');
  const compRes = await (await fetch('https://graph.facebook.com/v21.0/' + broadAdsetId + '/insights?time_increment=1&date_preset=last_3d&fields=date_start,impressions,clicks,spend,cpm,cpc,actions&access_token=' + token)).json();
  compRes.data?.forEach(d => {
    const leads = d.actions?.find(a => a.action_type === 'lead')?.value || 0;
    const linkClicks = d.actions?.find(a => a.action_type === 'link_click')?.value || 0;
    console.log(`Date: ${d.date_start} | Spend: ₹${Number(d.spend).toFixed(2)} | Imp: ${d.impressions} | Clicks: ${d.clicks} | CPM: ₹${Number(d.cpm).toFixed(2)} | CPC: ₹${Number(d.cpc || 0).toFixed(2)} | LinkClicks: ${linkClicks} | Leads: ${leads}`);
  });

  // 3. Age & Gender breakdown for today
  console.log('\n=== DEMOGRAPHICS BREAKDOWN TODAY ===');
  const demoRes = await (await fetch('https://graph.facebook.com/v21.0/' + broadAdsetId + '/insights?date_preset=today&breakdowns=age,gender&fields=impressions,clicks,spend&access_token=' + token)).json();
  demoRes.data?.forEach(d => {
    console.log(`Age: ${d.age} | Gender: ${d.gender} | Imp: ${d.impressions} | Clicks: ${d.clicks} | Spend: ₹${Number(d.spend).toFixed(2)}`);
  });
}

inspectData().catch(console.error);
