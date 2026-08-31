const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function mergeAndCleanupDuplicates() {
  console.log('=== Starting Lead Deduplication & Cleanup ===');

  const ownerId = '2f62a259-f23b-48ee-a920-c436f36eaa4b'; // Blue Square Infra

  // 1. Get all workspace team member IDs
  const { data: teamProfiles, error: teamErr } = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .or(`parent_id.eq.${ownerId},agency_id.eq.${ownerId},id.eq.${ownerId}`);

  if (teamErr || !teamProfiles) {
    console.error('Error fetching team profiles:', teamErr);
    return;
  }

  const teamIds = teamProfiles.map(p => p.id);
  console.log(`Found ${teamIds.length} team profiles for Blue Square Infra.`);

  // 2. Fetch all leads for this workspace in batches
  let allLeads = [];
  let page = 0;
  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .in('user_id', teamIds)
      .order('created_at', { ascending: false })
      .range(page * 1000, (page + 1) * 1000 - 1);

    if (error || !data || data.length === 0) break;
    allLeads = allLeads.concat(data);
    page++;
    if (data.length < 1000) break;
  }

  console.log(`Total leads fetched: ${allLeads.length}`);

  // 3. Group by normalized 10-digit phone number
  const phoneMap = new Map();
  for (const lead of allLeads) {
    if (!lead.phone) continue;
    const cleanPhone = lead.phone.replace(/\D/g, '').slice(-10);
    if (cleanPhone.length < 7) continue;

    if (!phoneMap.has(cleanPhone)) {
      phoneMap.set(cleanPhone, []);
    }
    phoneMap.get(cleanPhone).push(lead);
  }

  let duplicateGroupsCount = 0;
  let totalDeletedLeads = 0;
  let totalMergedHistory = 0;

  for (const [phone, group] of phoneMap.entries()) {
    if (group.length <= 1) continue;

    duplicateGroupsCount++;

    // Score leads in the group to find the best primary lead
    // Higher score = better candidate for primary lead
    const scored = group.map(l => {
      let score = 0;
      const notes = (l.notes || '').trim();
      const stage = (l.pipeline_stage || l.status || 'New Lead').trim();
      const cf = typeof l.custom_fields === 'string' ? JSON.parse(l.custom_fields || '{}') : (l.custom_fields || {});

      // Score by notes presence & detail
      if (notes.length > 5) score += 100 + Math.min(notes.length, 500);
      if (cf.last_followup_remark || cf.last_remark) score += 80;
      if (cf.last_followup_at) score += 50;

      // Score by pipeline progress
      const nonNewStages = ['Requirement Taken', 'Contacted', 'Visit Planned', 'Visit Done', 'Revisit Done', 'Negotiation', 'Won', 'Deal/Token', 'Lost/NI', 'Never Picked'];
      if (nonNewStages.includes(stage)) score += 60;
      if (stage !== 'New Lead' && stage !== 'New' && stage !== 'Fresh') score += 40;

      // Score by assigned agent (prefer explicitly assigned)
      if (l.assigned_to) score += 30;

      return { lead: l, score, cf, notes, stage };
    });

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    const primary = scored[0].lead;
    const duplicates = scored.slice(1).map(s => s.lead);

    // Merge notes & custom fields from duplicates into primary
    let primaryNotes = (primary.notes || '').trim();
    let primaryCf = typeof primary.custom_fields === 'string' ? JSON.parse(primary.custom_fields || '{}') : { ...(primary.custom_fields || {}) };
    let primarySources = Array.isArray(primaryCf.reopened_sources) ? [...primaryCf.reopened_sources] : [];

    for (const dup of duplicates) {
      const dupNotes = (dup.notes || '').trim();
      if (dupNotes && !primaryNotes.includes(dupNotes)) {
        primaryNotes = primaryNotes ? `${primaryNotes}\n\n[Merged from duplicate]:\n${dupNotes}` : dupNotes;
      }

      const dupCf = typeof dup.custom_fields === 'string' ? JSON.parse(dup.custom_fields || '{}') : (dup.custom_fields || {});
      if (dup.ad_name && !primary.ad_name) primary.ad_name = dup.ad_name;
      if (dup.form_name && !primary.form_name) primary.form_name = dup.form_name;
      if (dup.facebook_lead_id && !primary.facebook_lead_id) primary.facebook_lead_id = dup.facebook_lead_id;

      if (dup.ad_name) primarySources.push(dup.ad_name);
      if (dup.form_name) primarySources.push(dup.form_name);

      // Re-link lead_history from duplicate lead to primary lead
      const { error: relinkErr, count } = await supabase
        .from('lead_history')
        .update({ lead_id: primary.id })
        .eq('lead_id', dup.id);

      if (!relinkErr && count) totalMergedHistory += count;

      // Delete the duplicate lead record
      const { error: delErr } = await supabase
        .from('leads')
        .delete()
        .eq('id', dup.id);

      if (!delErr) {
        totalDeletedLeads++;
      } else {
        console.error(`Failed to delete duplicate lead ${dup.id}:`, delErr);
      }
    }

    primaryCf.reopened_sources = Array.from(new Set(primarySources));
    primaryCf.deduplicated_at = new Date().toISOString();

    // Update primary lead with consolidated notes & fields
    await supabase
      .from('leads')
      .update({
        notes: primaryNotes,
        ad_name: primary.ad_name,
        form_name: primary.form_name,
        facebook_lead_id: primary.facebook_lead_id,
        custom_fields: primaryCf
      })
      .eq('id', primary.id);
  }

  console.log(`=== Deduplication Complete ===`);
  console.log(`Cleaned ${duplicateGroupsCount} duplicate phone groups.`);
  console.log(`Deleted ${totalDeletedLeads} redundant duplicate rows.`);
  console.log(`Merged ${totalMergedHistory} history records to primary leads.`);

  // 4. Deactivate conflicting single-agent Campaign-Assignment rule
  console.log('=== Cleaning Conflicting Automations ===');
  const { data: conflictingAuts, error: autErr } = await supabase
    .from('automations')
    .update({ is_active: false })
    .eq('user_id', ownerId)
    .eq('title', 'Campaign-Assignment: Anmol Avenue - 12-03-2026-50000');

  console.log('Deactivated obsolete Campaign-Assignment rule.');
}

mergeAndCleanupDuplicates().catch(console.error);
