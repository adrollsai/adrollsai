const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runBroadcast() {
  const userId = '68b55a31-a16d-454d-a20f-11adabf590b0'; // Bioque Estates

  const { data: profile, error: pErr } = await supabaseAdmin
    .from('profiles')
    .select('whatsapp_waba_id, whatsapp_phone_number_id, whatsapp_access_token, facebook_token')
    .eq('id', userId)
    .single();

  if (pErr || !profile) {
    console.error('Failed to load profile:', pErr);
    return;
  }

  const token = profile.whatsapp_access_token || profile.facebook_token;
  const phoneId = profile.whatsapp_phone_number_id;
  const templateName = 'bioque_exclusive_dubai_img_v1';
  const imageUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/campaigns/68b55a31-a16d-454d-a20f-11adabf590b0/dubai_properties_1788934140851.jpeg';

  console.log(`Starting WhatsApp Broadcast: "${templateName}" with Image Header via phone ID ${phoneId}...`);

  const { data: leads, error: lErr } = await supabaseAdmin
    .from('leads')
    .select('id, name, phone, email')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (lErr || !leads) {
    console.error('Failed to load CRM leads:', lErr);
    return;
  }

  // Filter and format leads
  const recipients = [];
  const seenPhones = new Set();

  for (const l of leads) {
    let clean = (l.phone || '').replace(/\D/g, '');
    if (clean.length === 10) clean = '91' + clean;
    if (clean.length >= 10 && clean.length <= 15 && !seenPhones.has(clean)) {
      seenPhones.add(clean);
      let firstName = (l.name || '').trim().split(' ')[0] || 'there';
      if (firstName.includes('₹') || firstName.includes('cr') || firstName.includes('aed')) {
        firstName = 'there';
      }
      recipients.push({
        id: l.id,
        name: l.name || firstName,
        firstName,
        phone: clean
      });
    }
  }

  console.log(`Found ${recipients.length} valid unique recipients to send.`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    console.log(`[${i + 1}/${recipients.length}] Sending to ${r.firstName} (${r.phone})...`);

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: r.phone,
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
          },
          {
            type: 'body',
            parameters: [
              { type: 'text', text: r.firstName }
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
        successCount++;
        console.log(`  ✅ Delivered message ID: ${resData.messages[0].id}`);

        // Ensure chat exists and log message
        let { data: chat } = await supabaseAdmin
          .from('whatsapp_chats')
          .select('id')
          .eq('user_id', userId)
          .eq('recipient_phone', r.phone)
          .maybeSingle();

        if (!chat) {
          const { data: newChat } = await supabaseAdmin
            .from('whatsapp_chats')
            .insert({
              user_id: userId,
              recipient_phone: r.phone,
              recipient_name: r.name,
              lead_id: r.id,
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
            message_text: `Hello ${r.firstName} ji,\n\n🏙️ Exclusive Dubai Properties — Hand-Picked For You\n\nWe’ve curated a list of selected Dubai properties featuring:\n\n* 📈 High Rental Yield Potential\n* 💰 Festive Offers on Select Properties\n* 📍 Prime Locations\n* 🏢 Top Developers\n\n📋 Want the hand-picked property list?\n\n👉 Click "Interested" and we’ll share it with you.`
          });
        }
      } else {
        failCount++;
        console.error(`  ❌ Meta Error:`, resData.error?.message || resData);
      }
    } catch (err) {
      failCount++;
      console.error(`  ❌ Exception:`, err.message);
    }

    // Gentle throttle to comply with Meta Cloud API rate limits (100ms between sends)
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  console.log(`\n🎉 Broadcast Finished! Sent: ${successCount} | Failed: ${failCount} | Total: ${recipients.length}`);
}

if (require.main === module) {
  runBroadcast();
}

module.exports = { runBroadcast };
