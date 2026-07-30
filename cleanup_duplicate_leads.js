const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function cleanupDuplicates() {
  console.log("=== 1. Searching for Duplicate Leads ===");

  // Fetch all leads ordered by created_at ascending so index 0 of duplicates is the oldest (original)
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, user_id, name, phone, email, facebook_lead_id, created_at')
    .order('created_at', { ascending: true });

  if (error) {
    console.error("Error fetching leads:", error);
    return;
  }

  console.log(`Total leads fetched: ${leads.length}`);

  const groups = new Map();

  for (const lead of leads) {
    let key = null;
    if (lead.facebook_lead_id) {
      key = `fb_${lead.user_id}_${lead.facebook_lead_id}`;
    } else if (lead.phone) {
      const cleanDigits = lead.phone.replace(/\D/g, '').slice(-10);
      if (cleanDigits.length >= 7) {
        key = `phone_${lead.user_id}_${cleanDigits}`;
      }
    }

    if (key) {
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(lead);
    }
  }

  const duplicatesToDelete = [];
  let duplicateGroupCount = 0;

  for (const [key, groupLeads] of groups.entries()) {
    if (groupLeads.length > 1) {
      duplicateGroupCount++;
      const primaryLead = groupLeads[0];
      const extraLeads = groupLeads.slice(1);
      
      console.log(`\nGroup [${key}] - Lead Name: "${primaryLead.name}", Keep ID: ${primaryLead.id}`);
      console.log(`Removing ${extraLeads.length} duplicates:`, extraLeads.map(l => l.id));

      for (const extra of extraLeads) {
        duplicatesToDelete.push({
          duplicateId: extra.id,
          primaryId: primaryLead.id
        });
      }
    }
  }

  console.log(`\nFound ${duplicateGroupCount} duplicate lead groups with a total of ${duplicatesToDelete.length} duplicate rows to delete.`);

  if (duplicatesToDelete.length === 0) {
    console.log("No duplicate leads found to delete.");
    return;
  }

  console.log("\n=== 2. Re-assigning lead references & Deleting Duplicates ===");

  for (const item of duplicatesToDelete) {
    const dupId = item.duplicateId;
    const keepId = item.primaryId;

    // Update references in related tables if needed
    await supabase.from('lead_history').update({ lead_id: keepId }).eq('lead_id', dupId);
    await supabase.from('whatsapp_chats').update({ lead_id: keepId }).eq('lead_id', dupId);
    await supabase.from('voice_call_logs').update({ lead_id: keepId }).eq('lead_id', dupId);
    await supabase.from('flagged_questions').update({ lead_id: keepId }).eq('lead_id', dupId);

    // Delete the duplicate lead
    const { error: delErr } = await supabase.from('leads').delete().eq('id', dupId);
    if (delErr) {
      console.error(`Failed to delete lead ${dupId}:`, delErr.message);
    } else {
      console.log(`Successfully deleted duplicate lead ${dupId}`);
    }
  }

  console.log("\n=== Cleanup Complete! ===");
}

cleanupDuplicates();
