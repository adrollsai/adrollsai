import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function investigateKhushi() {
  console.log("=== 1. Finding Profile for Khushi Ram ===");
  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    .select('*')
    .or('full_name.ilike.%Khushi%,business_name.ilike.%Khushi%,email.ilike.%Khushi%');

  if (pErr) {
    console.error("Profile query error:", pErr);
    return;
  }

  console.log(`Found ${profiles?.length} matching profiles:`, profiles?.map(p => ({ id: p.id, email: p.email, full_name: p.full_name, business_name: p.business_name, nobo_credits: p.nobo_credits })));

  if (!profiles || profiles.length === 0) {
    console.log("No profile matching Khushi directly. Let's search all profiles:");
    const { data: allP } = await supabase.from('profiles').select('id, email, full_name, business_name');
    console.log("Profiles list:", allP);
    return;
  }

  const targetProfile = profiles[0];
  console.log("\nTarget Profile:", targetProfile.id, targetProfile.full_name, targetProfile.email);

  // Check call campaigns / lead campaigns tables
  const { data: tables } = await supabase.rpc('get_tables').catch(() => ({ data: null }));
  
  // Query voice call logs
  const { data: callLogs, error: logErr } = await supabase
    .from('voice_call_logs')
    .select('*')
    .eq('user_id', targetProfile.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (logErr) {
    console.log("voice_call_logs error:", logErr.message);
  } else {
    console.log(`Recent Voice Call Logs (${callLogs?.length}):`, callLogs);
  }

  // Query leads for Khushi Ram
  const { data: leads, error: leadErr } = await supabase
    .from('leads')
    .select('id, name, phone, status, custom_fields, created_at')
    .eq('user_id', targetProfile.id)
    .order('created_at', { ascending: false })
    .limit(30);

  if (leadErr) {
    console.log("leads query error:", leadErr.message);
  } else {
    console.log(`Total Leads (${leads?.length}):`, leads?.map(l => ({ id: l.id, name: l.name, phone: l.phone, status: l.status, custom: l.custom_fields })));
  }

  // Check if there is a call queue table or campaign table
  const { data: voiceCampaigns, error: vcErr } = await supabase
    .from('voice_campaigns')
    .select('*')
    .eq('user_id', targetProfile.id);

  if (vcErr) {
    console.log("voice_campaigns table error:", vcErr.message);
  } else {
    console.log("voice_campaigns:", voiceCampaigns);
  }
}

investigateKhushi();
