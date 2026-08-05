const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runBroadcast() {
  const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';

  // 1. Fetch credentials
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('whatsapp_phone_number_id, whatsapp_access_token, facebook_token')
    .eq('id', userId)
    .single();

  const phoneId = profile.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID;
  const token = profile.whatsapp_access_token || profile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;
  const imageUrl = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/bc63c065-9bcc-4793-bedc-f0960406425b/1785906182341-offer.jpg";

  // 2. Fetch all leads and WhatsApp chats for account
  const [leadsRes, chatsRes] = await Promise.all([
    supabaseAdmin.from('leads').select('id, name, phone').eq('user_id', userId),
    supabaseAdmin.from('whatsapp_chats').select('id, recipient_name, recipient_phone').eq('user_id', userId)
  ]);

  const recipientMap = new Map();

  (leadsRes.data || []).forEach(l => {
    if (!l.phone) return;
    const cleanDigits = l.phone.replace(/\D/g, '');
    if (cleanDigits.length < 10) return;
    const formatted = cleanDigits.length === 10 ? `91${cleanDigits}` : cleanDigits;
    const firstName = (l.name && !l.name.includes('+') && !l.name.includes('Test')) ? l.name.split(' ')[0] : 'there';
    recipientMap.set(formatted, {
      name: firstName,
      phone: formatted,
      lead_id: l.id
    });
  });

  (chatsRes.data || []).forEach(c => {
    if (!c.recipient_phone) return;
    const cleanDigits = c.recipient_phone.replace(/\D/g, '');
    if (cleanDigits.length < 10) return;
    const formatted = cleanDigits.length === 10 ? `91${cleanDigits}` : cleanDigits;
    if (!recipientMap.has(formatted)) {
      const firstName = (c.recipient_name && !c.recipient_name.includes('+')) ? c.recipient_name.split(' ')[0] : 'there';
      recipientMap.set(formatted, {
        name: firstName,
        phone: formatted,
        chat_id: c.id
      });
    }
  });

  const recipients = Array.from(recipientMap.values());
  console.log(`\n🚀 Starting WhatsApp Broadcast to ${recipients.length} UNIQUE leads...\n`);

  let successCount = 0;
  let freeformCount = 0;
  let templateCount = 0;
  let failCount = 0;

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    const greetingName = r.name || 'there';

    const messageText = `Hi ${greetingName},\n\nWhat if your entire sales & marketing team could be replaced by one AI?\n\nIntroducing *Nobogent* — the world's first AI Sales & Marketing Department built exclusively for real estate.\n\n✅ 500 AI Calling Minutes\n🎥 10 AI Videos\n🎨 50 AI Graphics\n📱 AI WhatsApp Automation\n👥 Advanced AI CRM\n📢 WhatsApp Broadcasting\n🌐 Website Builder\n📄 Landing Page Creator\n📈 Ads Management\n🏡 Inventory Management\n📲 Social Media Posting\n\n*Everything included for just ₹9,999/month.*\n\nReply *Interested* to watch a 2-minute demo and see how Nobogent can help you generate more leads, automate follow-ups, and close more deals.`;

    // Attempt 1: Freeform Interactive Message (Image + Text + Interested Button)
    const freeformPayload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: r.phone,
      type: "interactive",
      interactive: {
        type: "button",
        header: {
          type: "image",
          image: { link: imageUrl }
        },
        body: { text: messageText },
        action: {
          buttons: [
            {
              type: "reply",
              reply: { id: "interested_btn", title: "Interested" }
            }
          ]
        }
      }
    };

    let sentMessageId = null;
    let methodUsed = '';

    try {
      const res1 = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(freeformPayload)
      });
      const data1 = await res1.json();

      if (data1.messages && data1.messages[0]?.id) {
        sentMessageId = data1.messages[0].id;
        methodUsed = 'FREEFORM_INTERACTIVE';
        freeformCount++;
      } else {
        // Attempt 2: Fallback to Template Message if 24h window error occurs
        const templatePayload = {
          messaging_product: "whatsapp",
          to: r.phone,
          type: "template",
          template: {
            name: "nobogent_offer_promo_v1",
            language: { code: "en" },
            components: [
              {
                type: "header",
                parameters: [{ type: "image", image: { link: imageUrl } }]
              },
              {
                type: "body",
                parameters: [{ type: "text", text: greetingName }]
              }
            ]
          }
        };

        const res2 = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(templatePayload)
        });
        const data2 = await res2.json();

        if (data2.messages && data2.messages[0]?.id) {
          sentMessageId = data2.messages[0].id;
          methodUsed = 'META_TEMPLATE';
          templateCount++;
        } else {
          console.error(`❌ [${i+1}/${recipients.length}] Failed for +${r.phone} (${greetingName}):`, data2.error?.message || data1.error?.message);
          failCount++;
        }
      }
    } catch (err) {
      console.error(`❌ [${i+1}/${recipients.length}] Exception for +${r.phone}:`, err.message);
      failCount++;
    }

    if (sentMessageId) {
      successCount++;
      console.log(`✅ [${i+1}/${recipients.length}] Delivered to +${r.phone} (${greetingName}) via ${methodUsed} (ID: ${sentMessageId})`);

      // Log message to DB
      try {
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
              lead_id: r.lead_id || null,
              last_message_text: messageText,
              unread_count: 0
            })
            .select('id')
            .single();
          chat = newChat;
        } else {
          await supabaseAdmin
            .from('whatsapp_chats')
            .update({
              last_message_text: messageText,
              updated_at: new Date().toISOString()
            })
            .eq('id', chat.id);
        }

        if (chat) {
          await supabaseAdmin
            .from('whatsapp_messages')
            .insert({
              chat_id: chat.id,
              direction: 'outbound',
              message_text: messageText,
              media_url: imageUrl
            });
        }
      } catch (dbErr) {
        console.warn("DB log error:", dbErr.message);
      }
    }

    // Gentle 100ms delay between API calls to prevent rate limits
    await new Promise(res => setTimeout(res, 100));
  }

  console.log(`\n===================================================`);
  console.log(`🎉 BROADCAST COMPLETED SUMMARY:`);
  console.log(`  - Total Targets: ${recipients.length}`);
  console.log(`  - Successfully Delivered: ${successCount}`);
  console.log(`  - Freeform Interactive Messages: ${freeformCount}`);
  console.log(`  - Meta Template Messages: ${templateCount}`);
  console.log(`  - Failed: ${failCount}`);
  console.log(`===================================================\n`);
}

runBroadcast();
