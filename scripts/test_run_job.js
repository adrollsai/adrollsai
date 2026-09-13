const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runPendingJob() {
  const flyerUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/inventory/bc63c065-9bcc-4793-bedc-f0960406425b/1789292582076_img.jpg';

  const { data: job } = await supabaseAdmin
    .from('campaign_jobs')
    .select('*')
    .eq('id', 'e0be041b-1729-4be0-8deb-99ac16e7b916')
    .single();

  const payload = job.payload || {};
  payload.creativeUrls = [flyerUrl];
  payload.creative_urls = [flyerUrl];

  await supabaseAdmin
    .from('campaign_jobs')
    .update({
      status: 'pending',
      payload: payload,
      message: null
    })
    .eq('id', 'e0be041b-1729-4be0-8deb-99ac16e7b916');

  console.log('Set job status to pending. Triggering process-campaign-job...');

  const res = await fetch('http://localhost:3000/api/meta-ads/process-campaign-job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: job.id, payload: payload })
  });

  const data = await res.json();
  console.log('API response:', data);

  // Poll for result in DB
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const { data: updated } = await supabaseAdmin
      .from('campaign_jobs')
      .select('id, status, campaign_id, message')
      .eq('id', 'e0be041b-1729-4be0-8deb-99ac16e7b916')
      .single();
    console.log(`Poll ${i+1}: status=${updated.status}, campaign_id=${updated.campaign_id}, msg=${updated.message}`);
    if (updated.status === 'completed' || updated.status === 'failed') {
      console.log('Final Job Result:', updated);
      break;
    }
  }
}

runPendingJob().catch(console.error);
