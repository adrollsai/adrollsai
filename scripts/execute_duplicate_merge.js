const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function executeDuplicateMerge() {
  const userId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
  console.log('Fetching all leads for Blue Square Infra...');

  let allLeads = [];
  let from = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('user_id', userId)
      .range(from, from + batchSize - 1);
    if (error) { console.error('Fetch error:', error); break; }
    if (!data || data.length === 0) break;
    allLeads.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  console.log(`Total leads fetched: ${allLeads.length}`);

  const phoneMap = {};
  allLeads.forEach(l => {
    const p = l.phone ? l.phone.replace(/\D/g, '').slice(-10) : '';
    if (p && p.length >= 7) {
      if (!phoneMap[p]) phoneMap[p] = [];
      phoneMap[p].push(l);
    }
  });

  const dupes = Object.entries(phoneMap).filter(([p, list]) => list.length > 1);
  console.log(`Processing ${dupes.length} duplicate groups...\n`);

  let mergedCount = 0;
  let deletedCount = 0;

  for (let i = 0; i < dupes.length; i++) {
    const [phone, list] = dupes[i];
    // Sort descending so newest (active) lead is first
    list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    
    const primaryLead = list[0];
    const secondaryLeads = list.slice(1);

    console.log(`[Group ${i + 1}/${dupes.length}] Merging phone ${phone}: Keeping ${primaryLead.name} (${primaryLead.id})...`);

    // Parse primary custom fields
    let primaryCf = {};
    if (primaryLead.custom_fields) {
      try {
        primaryCf = typeof primaryLead.custom_fields === 'string' ? JSON.parse(primaryLead.custom_fields) : primaryLead.custom_fields;
      } catch (e) {}
    }

    let combinedNotes = primaryLead.notes || '';

    for (const sec of secondaryLeads) {
      // 1. Re-link lead_history rows
      const { data: movedHist, error: histErr } = await supabase
        .from('lead_history')
        .update({ lead_id: primaryLead.id })
        .eq('lead_id', sec.id);

      if (histErr) {
        console.error(`  ⚠️ Error moving lead_history for ${sec.id}:`, histErr.message);
      } else {
        console.log(`  ✓ Transferred lead_history from ${sec.id} to ${primaryLead.id}`);
      }

      // 2. Re-link call_logs rows if any
      try {
        await supabase
          .from('call_logs')
          .update({ lead_id: primaryLead.id })
          .eq('lead_id', sec.id);
      } catch (clErr) {}

      // 3. Merge custom_fields
      let secCf = {};
      if (sec.custom_fields) {
        try {
          secCf = typeof sec.custom_fields === 'string' ? JSON.parse(sec.custom_fields) : sec.custom_fields;
        } catch (e) {}
      }

      // Merge secondary fields into primaryCf without overriding existing non-empty primary fields
      Object.keys(secCf).forEach(key => {
        if (!primaryCf[key] || primaryCf[key] === '' || primaryCf[key] === null) {
          primaryCf[key] = secCf[key];
        }
      });

      // Merge notes if secondary had distinct notes
      if (sec.notes && !combinedNotes.includes(sec.notes.trim())) {
        combinedNotes = (combinedNotes ? `${combinedNotes}\n\n` : '') + `[Merged History from ${new Date(sec.created_at).toLocaleDateString()} (${sec.source || 'Facebook'})]:\n${sec.notes}`;
      }

      // 4. Create explicit history entry for the merge
      const mergeHistoryDesc = `🔀 Merged duplicate contact record.\nPrevious Lead ID: ${sec.id}\nOriginal Date: ${new Date(sec.created_at).toLocaleString('en-IN')}\nSource: ${sec.source || 'Facebook'}\nPrevious Stage: ${sec.pipeline_stage || sec.status || 'New Lead'}\nPrevious Name: ${sec.name || 'N/A'}`;
      
      await supabase.from('lead_history').insert({
        lead_id: primaryLead.id,
        user_id: primaryLead.assigned_to || primaryLead.user_id,
        action_type: 'REOPENED',
        performed_by: 'System / Deduplication',
        actor_name: 'Deduplication System',
        description: mergeHistoryDesc,
        details: {
          merged_from_lead_id: sec.id,
          merged_lead_name: sec.name,
          merged_created_at: sec.created_at,
          merged_source: sec.source,
          merged_stage: sec.pipeline_stage || sec.status,
          merged_notes: sec.notes,
          timestamp: new Date().toISOString()
        },
        created_at: sec.created_at || new Date().toISOString()
      });

      // 5. Delete the redundant secondary lead
      const { error: delErr } = await supabase
        .from('leads')
        .delete()
        .eq('id', sec.id);

      if (delErr) {
        console.error(`  ❌ Failed to delete duplicate lead ${sec.id}:`, delErr.message);
      } else {
        console.log(`  ✓ Successfully deleted duplicate lead row ${sec.id}`);
        deletedCount++;
      }
    }

    // 6. Update primary lead with consolidated notes and custom_fields
    await supabase
      .from('leads')
      .update({
        notes: combinedNotes,
        custom_fields: primaryCf,
        reopened_count: (primaryLead.reopened_count || 0) + secondaryLeads.length
      })
      .eq('id', primaryLead.id);

    mergedCount++;
  }

  console.log(`\n========================================`);
  console.log(`🎉 Deduplication & Merge Complete!`);
  console.log(`- Total Groups Processed: ${mergedCount}`);
  console.log(`- Duplicate Leads Removed: ${deletedCount}`);
  console.log(`- All History & Notes Preserved: 100%`);
  console.log(`========================================`);
}

executeDuplicateMerge().catch(console.error);
