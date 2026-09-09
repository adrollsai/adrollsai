const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runPilot10() {
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

  console.log(`Starting WhatsApp Pilot Batch (First 10 Contacts) via Phone ID ${phoneId}...`);
  console.log(`Template: "${templateName}" | Image: ${imageUrl}\n`);

  const { data: leads, error: lErr } = await supabaseAdmin
    .from('leads')
    .select('id, name, phone, email, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (lErr || !leads) {
    console.error('Failed to load CRM leads:', lErr);
    return;
  }

  // Filter and deduplicate leads
  const recipients = [];
  const seenPhones = new Set();

  for (const l of leads) {
    let clean = (l.phone || '').replace(/\D/g, '');
    if (clean.length === 10) clean = '91' + clean;
    if (clean.length >= 10 && clean.length <= 15 && !seenPhones.has(clean)) {
      seenPhones.add(clean);
      let firstName = (l.name || '').trim().split(' ')[0] || 'there';
      if (firstName.includes('₹') || firstName.includes('cr') || firstName.includes('aed') || /\d/.test(firstName)) {
        firstName = 'there';
      }
      recipients.push({
        id: l.id,
        rawName: l.name,
        firstName,
        phone: clean,
        createdAt: l.created_at
      });
    }
  }

  const pilotBatch = recipients.slice(0, 10);
  console.log(`Total unique leads available: ${recipients.length}`);
  console.log(`Selected pilot batch of ${pilotBatch.length} contacts:\n`);

  pilotBatch.forEach((r, idx) => {
    console.log(`  ${idx + 1}. ${r.rawName || 'Unnamed'} -> Greeting: "Hello ${r.firstName} ji" | Phone: +${r.phone}`);
  });

  console.log('\n--- Sending Messages Now ---\n');

  let successCount = 0;
  let failCount = 0;
  const results = [];

  for (let i = 0; i < pilotBatch.length; i++) {
    const r = pilotBatch[i];
    console.log(`[${i + 1}/${pilotBatch.length}] Sending to ${r.firstName} (+${r.phone})...`);

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
        const msgId = resData.messages[0].id;
        console.log(`  ✅ Sent! Meta Message ID: ${msgId}`);

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
              recipient_name: r.rawName || r.firstName,
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
            message_text: `[Image Header: ${imageUrl}]\n\nHello ${r.firstName} ji,\n\n🏙️ Exclusive Dubai Properties — Hand-Picked For You\n\nWe’ve curated a list of selected Dubai properties featuring:\n\n* 📈 High Rental Yield Potential\n* 💰 Festive Offers on Select Properties\n* 📍 Prime Locations\n* 🏢 Top Developers\n\n📋 Want the hand-picked property list?\n\n👉 Click "Interested" and we’ll share it with you.`
          });
        }

        results.push({ name: r.rawName || r.firstName, phone: r.phone, status: 'SUCCESS', messageId: msgId });
      } else {
        failCount++;
        const errDetail = resData.error?.message || JSON.stringify(resData);
        console.error(`  ❌ Meta Error:`, errDetail);
        results.push({ name: r.rawName || r.firstName, phone: r.phone, status: 'FAILED', error: errDetail });
      }
    } catch (err) {
      failCount++;
      console.error(`  ❌ Exception:`, err.message);
      results.push({ name: r.rawName || r.firstName, phone: r.phone, status: 'EXCEPTION', error: err.message });
    }

    // Gentle throttle between messages
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log(`\n========================================`);
  console.log(`🎉 Pilot Batch Complete!`);
  console.log(`Total Sent: ${successCount} / ${pilotBatch.length}`);
  console.log(`Total Failed: ${failCount} / ${pilotBatch.length}`);
  console.log(`========================================\n`);

  return { successCount, failCount, results, totalAvailable: recipients.length };
}

if (require.main === module) {
  runPilot10();
}

module.exports = { runPilot10 };
