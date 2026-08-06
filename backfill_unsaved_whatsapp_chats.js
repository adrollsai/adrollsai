const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function backfill() {
  const { data: chats, error } = await supabaseAdmin
    .from('whatsapp_chats')
    .select('id, user_id, recipient_phone, recipient_name, lead_id');

  if (error) {
    console.error("Error fetching chats:", error);
    return;
  }

  console.log(`Processing ${chats.length} WhatsApp chats for CRM sync...`);
  let createdCount = 0;
  let linkedCount = 0;

  for (const c of chats) {
    if (!c.recipient_phone) continue;

    const rawPhone = c.recipient_phone.replace(/\D/g, '');
    const cleanDigits = rawPhone.slice(-10);
    if (!cleanDigits || cleanDigits.length < 10) continue;

    const formattedPhone = c.recipient_phone.startsWith('+') ? c.recipient_phone : `+${c.recipient_phone}`;

    // 1. Check if lead exists
    let { data: existingLead } = await supabaseAdmin
      .from('leads')
      .select('id, name')
      .eq('user_id', c.user_id)
      .ilike('phone', `%${cleanDigits}%`)
      .maybeSingle();

    if (!existingLead && c.lead_id) {
      const { data: lById } = await supabaseAdmin
        .from('leads')
        .select('id, name')
        .eq('id', c.lead_id)
        .maybeSingle();
      existingLead = lById;
    }

    if (!existingLead) {
      // Create new lead in CRM
      const defaultName = c.recipient_name && c.recipient_name.trim() ? c.recipient_name.trim() : formattedPhone;

      const { data: newLead, error: insertErr } = await supabaseAdmin
        .from('leads')
        .insert({
          user_id: c.user_id,
          name: defaultName,
          phone: formattedPhone,
          source: 'WhatsApp Inbound',
          pipeline_stage: 'New',
          created_at: new Date().toISOString()
        })
        .select('id, name')
        .single();

      if (insertErr) {
        console.error(`Failed to insert lead for ${formattedPhone}:`, insertErr);
      } else if (newLead) {
        existingLead = newLead;
        createdCount++;
        console.log(`✅ [CREATED CRM LEAD] ID: ${newLead.id}, Name: ${newLead.name}, Phone: ${formattedPhone}`);
      }
    }

    // Link chat to lead_id and update recipient_name if needed
    if (existingLead) {
      const updates = {};
      if (c.lead_id !== existingLead.id) {
        updates.lead_id = existingLead.id;
      }
      if (!c.recipient_name || c.recipient_name !== existingLead.name) {
        updates.recipient_name = existingLead.name;
      }

      if (Object.keys(updates).length > 0) {
        await supabaseAdmin
          .from('whatsapp_chats')
          .update(updates)
          .eq('id', c.id);
        linkedCount++;
      }
    }
  }

  console.log(`\n🎉 Backfill Complete! Created ${createdCount} new CRM leads and updated/linked ${linkedCount} WhatsApp chats!`);
}

backfill();
