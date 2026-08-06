const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runFreeformVideoBroadcast() {
  const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b'; // rchopra489@gmail.com

  // 1. Get profile credentials
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (!profile) {
    console.error("Profile not found!");
    return;
  }

  const token = profile.whatsapp_access_token || profile.facebook_token;
  const phoneId = profile.whatsapp_phone_number_id;
  const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

  // 2. Fetch all chats for this user
  const { data: chats } = await supabaseAdmin
    .from('whatsapp_chats')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  console.log(`Found ${chats?.length || 0} chats for ${profile.email}`);

  const videoUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/bc63c065-9bcc-4793-bedc-f0960406425b/nobogent_demo_video_1785822553001.mp4';

  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  console.log("\nStarting Video + Interactive Button broadcast...\n");

  for (const chat of chats || []) {
    let cleanPhone = chat.recipient_phone ? chat.recipient_phone.replace(/\D/g, '') : '';
    if (!cleanPhone) continue;
    if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

    const leadName = chat.recipient_name || 'there';

    const bodyText = `Hi ${leadName},\n\nWhat if every new lead received an instant follow-up—even while you're busy?\n\nThis short video shows how real estate businesses are using AI to automatically call, message, and nurture leads 24/7.\n\nClick on "Connect with Expert" button below to book a demo!`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'interactive',
      interactive: {
        type: 'button',
        header: {
          type: 'video',
          video: {
            link: videoUrl
          }
        },
        body: {
          text: bodyText
        },
        action: {
          buttons: [
            {
              type: 'reply',
              reply: {
                id: 'connect_expert',
                title: 'Connect with Expert'
              }
            }
          ]
        }
      }
    };

    try {
      const res = await fetch(metaUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (res.ok) {
        console.log(`✅ [SUCCESS] Sent to ${leadName} (${cleanPhone}) | WAMID: ${data.messages?.[0]?.id}`);
        successCount++;

        // Record message in whatsapp_messages
        await supabaseAdmin.from('whatsapp_messages').insert({
          chat_id: chat.id,
          direction: 'outbound',
          message_text: `${bodyText}\n\n[Media: Video]\n[Button: Connect with Expert]`,
          media_url: videoUrl,
          media_type: 'video'
        });

        // Update chat last message
        await supabaseAdmin.from('whatsapp_chats').update({
          last_message_text: `${bodyText} [Button: Connect with Expert]`,
          updated_at: new Date().toISOString()
        }).eq('id', chat.id);

      } else {
        console.warn(`⚠️ [FAILED] ${leadName} (${cleanPhone}): ${data.error?.message} (Code: ${data.error?.code})`);
        failCount++;
      }

    } catch (err) {
      console.error(`❌ [ERROR] ${leadName} (${cleanPhone}):`, err.message);
      failCount++;
    }

    // Small delay to prevent rate limit spikes
    await new Promise(r => setTimeout(r, 400));
  }

  console.log("\n=========================================");
  console.log(`🎉 BROADCAST COMPLETED!`);
  console.log(`Successes: ${successCount}`);
  console.log(`Failures/Expired 24h Window: ${failCount}`);
  console.log(`Total Target Chats: ${chats?.length || 0}`);
  console.log("=========================================\n");
}

runFreeformVideoBroadcast();
