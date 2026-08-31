const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function directSyncBlueSquareLeads() {
  console.log('=== Starting Direct Meta Sync for Blue Square Infra ===');

  const ownerId = '2f62a259-f23b-48ee-a920-c436f36eaa4b'; // Blue Square Infra
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', ownerId).single();
  const pageToken = profile.selected_page_token;
  const pageId = profile.selected_page_id;

  // 1. Get Group Rule
  const { data: aut } = await supabase.from('automations').select('*').eq('id', '4d5cedf2-aef6-4dea-bb3b-287b5846a79c').single();
  const group = JSON.parse(aut.description);
  const members = group.members || [];
  console.log('Group members:', members.map(m => m.name));

  // 2. Fetch all lead forms from Facebook
  const formsRes = await fetch(`https://graph.facebook.com/v20.0/${pageId}/leadgen_forms?fields=id,name,status,leads_count&limit=50&access_token=${pageToken}`);
  const formsData = await formsRes.json();
  console.log(`Total forms on page: ${formsData?.data?.length}`);

  let totalNewSynced = 0;
  let totalReopened = 0;
  const memberCounts = {};
  members.forEach(m => memberCounts[m.name] = 0);

  let poolIdx = 0;
  if (group.last_assigned_user_id) {
    const idx = members.findIndex(m => m.userId === group.last_assigned_user_id);
    if (idx !== -1) poolIdx = (idx + 1) % members.length;
  }

  for (const form of (formsData.data || [])) {
    if (form.leads_count === 0 && form.status !== 'ACTIVE') continue;
    try {
      const leadsRes = await fetch(`https://graph.facebook.com/v20.0/${form.id}/leads?fields=id,created_time,field_data,form_id,ad_id,ad_name,campaign_id,campaign_name&limit=50&access_token=${pageToken}`);
      const leadsData = await leadsRes.json();
      if (!leadsData?.data || leadsData.data.length === 0) continue;

      for (const fbLead of leadsData.data) {
        // Check if exists by facebook_lead_id
        const { data: existFb } = await supabase.from('leads').select('id, name, phone, assigned_to').eq('facebook_lead_id', fbLead.id).limit(1);
        if (existFb && existFb.length > 0) continue;

        // Parse fields
        let name = '', phone = '', email = '';
        const customFields = {};
        let firstName = '', lastName = '';
        (fbLead.field_data || []).forEach(f => {
          if (!f.name || !f.values || f.values.length === 0) return;
          const fn = f.name.toLowerCase().trim();
          const fv = (typeof f.values[0] === 'string' ? f.values[0] : String(f.values[0] || '')).trim();
          if (!fv) return;

          if (fn.includes('full_name') || fn.includes('fullname') || fn === 'name' || fn.includes('your_name') || fn.includes('your name') || fn.includes('customer_name') || fn.includes('prospect_name')) name = fv;
          else if (fn.includes('first_name') || fn.includes('firstname') || fn.includes('first name') || fn === 'fname') firstName = fv;
          else if (fn.includes('last_name') || fn.includes('lastname') || fn.includes('last name') || fn === 'lname') lastName = fv;
          else if (fn.includes('email')) email = fv;
          else if (fn.includes('phone') || fn.includes('mobile') || fn.includes('contact') || fn.includes('whatsapp') || fn.includes('tel')) phone = fv;
          else customFields[f.name] = fv;
        });

        if ((!name || name.toLowerCase() === 'lead' || name.toLowerCase() === 'unknown') && (firstName || lastName)) {
          name = `${firstName} ${lastName}`.trim();
        }
        if (!name || name.toLowerCase() === 'lead' || name.toLowerCase() === 'unknown') {
          name = email ? email.split('@')[0] : (phone ? `Lead (${phone})` : `Meta Lead #${fbLead.id.slice(-4)}`);
        }

        const cleanPhone = phone ? phone.replace(/\D/g, '').slice(-10) : '';
        if (cleanPhone && cleanPhone.length >= 7) {
          const { data: existPhone } = await supabase.from('leads').select('id, name, assigned_to').eq('user_id', ownerId).ilike('phone', `%${cleanPhone}%`).limit(1);
          if (existPhone && existPhone.length > 0) {
            totalReopened++;
            continue;
          }
        }

        // Assign to next member in group
        const assignedMember = members[poolIdx];
        poolIdx = (poolIdx + 1) % members.length;
        memberCounts[assignedMember.name] = (memberCounts[assignedMember.name] || 0) + 1;

        const adName = fbLead.ad_name || form.name;
        const campName = fbLead.campaign_name || form.name;
        const adCampStr = `${campName} / ${adName}`;

        const { data: newLead, error: insErr } = await supabase.from('leads').insert({
          user_id: ownerId,
          assigned_to: assignedMember.userId,
          name,
          phone,
          email,
          source: 'Facebook Ads',
          ad_name: adCampStr,
          form_name: form.name,
          form_id: form.id,
          facebook_lead_id: fbLead.id,
          facebook_created_at: fbLead.created_time,
          pipeline_stage: 'New Lead',
          status: 'New Lead',
          custom_fields: customFields,
          created_at: fbLead.created_time || new Date().toISOString()
        }).select().single();

        if (!insErr && newLead) {
          totalNewSynced++;
          await supabase.from('lead_history').insert({
            lead_id: newLead.id,
            user_id: assignedMember.userId,
            action_type: 'ASSIGNMENT',
            performed_by: 'System / Meta Ads Group Distribution',
            actor_name: 'Group Distribution Rule',
            description: `Lead automatically synced from Meta Ads and assigned to ${assignedMember.name} via Group Distribution (${group.group_name})`,
            created_at: new Date().toISOString()
          });
        }
      }
    } catch (e) {
      console.error(`Error fetching leads for form ${form.name}:`, e);
    }
  }

  // Update group state
  const lastSelected = members[(poolIdx - 1 + members.length) % members.length];
  group.last_assigned_user_id = lastSelected.userId;
  group.last_assigned_user_name = lastSelected.name;
  group.last_assigned_at = new Date().toISOString();
  await supabase.from('automations').update({ description: JSON.stringify(group) }).eq('id', aut.id);

  console.log('=== Meta Sync Summary for Blue Square Infra ===');
  console.log('Total newly synced and assigned leads:', totalNewSynced);
  console.log('Total reopened existing leads:', totalReopened);
  console.log('Breakdown per member:', memberCounts);
}

directSyncBlueSquareLeads().catch(console.error);
