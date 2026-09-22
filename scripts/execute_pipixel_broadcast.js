const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function executeBroadcast() {
  const pipixelId = 'c7bede84-d7ea-4b02-bbbb-017d24a37914';
  const flowId = 'afb2d582-a7d1-4d3a-b31a-1250613343f5';
  const phoneId = '1301187456416800';
  const token = process.env.DEV_WHATSAPP_ACCESS_TOKEN;
  const templateName = 'immigration_trial';
  const imageUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/c7bede84-d7ea-4b02-bbbb-017d24a37914/1790064783995-ChatGPTImageSep222026014241PM.jpg';

  console.log('🚀 Starting PiPixel WhatsApp Broadcast for template: immigration_trial');

  // 1. Fetch all leads for PiPixel
  const { data: allLeads, error: leadsErr } = await supabaseAdmin
    .from('leads')
    .select('id, name, phone, email, pipeline_stage')
    .eq('user_id', pipixelId)
    .order('created_at', { ascending: true });

  if (leadsErr || !allLeads) {
    console.error('Failed to fetch leads:', leadsErr);
    return;
  }

  console.log(`📋 Total leads in PiPixel CRM: ${allLeads.length}`);

  // 2. Filter leads with valid phone numbers
  const validLeads = allLeads.filter(l => {
    if (!l.phone) return false;
    const clean = l.phone.replace(/\D/g, '');
    return clean.length >= 8 && clean.length <= 15;
  });

  console.log(`📱 Leads with deliverable phone numbers: ${validLeads.length}`);

  // 3. Create the broadcast record
  const broadcastTitle = `[Flow: Immigration Free Trial Campaign] Immigration Trial (${validLeads.length} Leads) [flow:${flowId}]`;
  const { data: broadcast, error: bErr } = await supabaseAdmin
    .from('whatsapp_broadcasts')
    .insert({
      user_id: pipixelId,
      title: broadcastTitle,
      template_name: templateName,
      recipient_stage: 'All',
      status: 'processing',
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (bErr || !broadcast) {
    console.error('Failed to create broadcast:', bErr);
    return;
  }

  const broadcastId = broadcast.id;
  console.log(`📢 Created broadcast record ID: ${broadcastId}`);

  // 4. Link broadcast in automations table
  try {
    const { data: auto } = await supabaseAdmin
      .from('automations')
      .select('description')
      .eq('id', flowId)
      .single();

    if (auto) {
      const desc = typeof auto.description === 'string' ? JSON.parse(auto.description) : auto.description;
      desc.lastBroadcastId = broadcastId;
      desc.lastBroadcastAt = new Date().toISOString();
      desc.lastBroadcastAudience = 'All CRM Leads';
      desc.lastBroadcastRecipients = validLeads.length;

      await supabaseAdmin
        .from('automations')
        .update({ description: JSON.stringify(desc) })
        .eq('id', flowId);
      console.log(`🔗 Linked broadcast to flow ${flowId}`);
    }
  } catch (err) {
    console.warn('Could not update automation metadata:', err);
  }

  // 5. Create recipient records in whatsapp_broadcast_recipients
  const recipientBatches = [];
  const recipientRecords = validLeads.map(lead => {
    let cleanPhone = lead.phone.replace(/\D/g, '');
    if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
    return {
      broadcast_id: broadcastId,
      lead_id: lead.id,
      user_id: pipixelId,
      phone_number: cleanPhone,
      status: 'pending'
    };
  });

  for (let i = 0; i < recipientRecords.length; i += 100) {
    recipientBatches.push(recipientRecords.slice(i, i + 100));
  }

  for (const batch of recipientBatches) {
    await supabaseAdmin.from('whatsapp_broadcast_recipients').insert(batch);
  }
  console.log(`📥 Registered ${recipientRecords.length} pending recipients in DB.`);

  // 6. Send template messages with controlled concurrency
  let sentCount = 0;
  let failedCount = 0;
  const CONCURRENCY = 5;
  let currIdx = 0;

  async function sendWorker() {
    while (currIdx < validLeads.length) {
      const idx = currIdx++;
      const lead = validLeads[idx];
      let cleanPhone = lead.phone.replace(/\D/g, '');
      if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhone,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en_US' },
          components: [
            {
              type: 'header',
              parameters: [
                {
                  type: 'image',
                  image: { link: imageUrl }
                }
              ]
            }
          ]
        }
      };

      try {
        const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const resData = await res.json();

        if (res.ok && resData.messages?.[0]?.id) {
          sentCount++;
          // Update recipient status
          await supabaseAdmin
            .from('whatsapp_broadcast_recipients')
            .update({ status: 'sent', sent_at: new Date().toISOString() })
            .eq('broadcast_id', broadcastId)
            .eq('lead_id', lead.id);

          // Ensure chat is logged
          let { data: chat } = await supabaseAdmin
            .from('whatsapp_chats')
            .select('id')
            .eq('user_id', pipixelId)
            .eq('recipient_phone', cleanPhone)
            .maybeSingle();

          if (!chat) {
            const { data: newChat } = await supabaseAdmin
              .from('whatsapp_chats')
              .insert({
                user_id: pipixelId,
                recipient_phone: cleanPhone,
                recipient_name: lead.name || 'Valued Lead',
                last_message_text: `[Template: ${templateName}]`
              })
              .select('id')
              .single();
            chat = newChat;
          }

          if (chat) {
            await supabaseAdmin.from('whatsapp_messages').insert({
              chat_id: chat.id,
              direction: 'outbound',
              message_text: `Sent Template: ${templateName}`,
              media_url: imageUrl
            });
          }

          if (sentCount % 20 === 0 || sentCount === validLeads.length) {
            console.log(`Progress: ${sentCount}/${validLeads.length} sent (${failedCount} failed)`);
          }
        } else {
          failedCount++;
          const errMsg = resData.error?.message || 'Meta API error';
          console.warn(`❌ Failed for ${cleanPhone}: ${errMsg}`);
          await supabaseAdmin
            .from('whatsapp_broadcast_recipients')
            .update({ status: 'failed', error_message: errMsg })
            .eq('broadcast_id', broadcastId)
            .eq('lead_id', lead.id);
        }
      } catch (sendErr) {
        failedCount++;
        console.error(`❌ Exception sending to ${cleanPhone}:`, sendErr.message);
        await supabaseAdmin
          .from('whatsapp_broadcast_recipients')
          .update({ status: 'failed', error_message: sendErr.message })
          .eq('broadcast_id', broadcastId)
          .eq('lead_id', lead.id);
      }

      // Small pacing throttle to prevent burst limits
      await new Promise(r => setTimeout(r, 120));
    }
  }

  console.log(`⚡ Dispatching messages across ${CONCURRENCY} parallel workers...`);
  const workers = Array.from({ length: CONCURRENCY }, () => sendWorker());
  await Promise.all(workers);

  // 7. Finalize broadcast status
  await supabaseAdmin
    .from('whatsapp_broadcasts')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString()
    })
    .eq('id', broadcastId);

  console.log('\n========================================');
  console.log('🎉 PiPixel Broadcast Execution Completed!');
  console.log(`Total Deliverable: ${validLeads.length}`);
  console.log(`Successfully Sent: ${sentCount}`);
  console.log(`Failed / Ineligible: ${failedCount}`);
  console.log(`Delivery Rate: ${((sentCount / validLeads.length) * 100).toFixed(1)}%`);
  console.log('========================================');
}

executeBroadcast();
