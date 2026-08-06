const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function sendTest() {
  const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
  const userPhone = '918288835235';

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('whatsapp_phone_number_id, whatsapp_access_token, facebook_token')
    .eq('id', userId)
    .single();

  const phoneId = profile.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID;
  const token = profile.whatsapp_access_token || profile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;

  const imageUrl = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/bc63c065-9bcc-4793-bedc-f0960406425b/1785906182341-offer.jpg";

  const messageText = `Hi Raman,\n\nWhat if your entire sales & marketing team could be replaced by one AI?\n\nIntroducing *Nobogent* — the world's first AI Sales & Marketing Department built exclusively for real estate.\n\n✅ 500 AI Calling Minutes\n🎥 10 AI Videos\n🎨 50 AI Graphics\n📱 AI WhatsApp Automation\n👥 Advanced AI CRM\n📢 WhatsApp Broadcasting\n🌐 Website Builder\n📄 Landing Page Creator\n📈 Ads Management\n🏡 Inventory Management\n📲 Social Media Posting\n\n*Everything included for just ₹9,999/month.*\n\nReply *Interested* to watch a 2-minute demo and see how Nobogent can help you generate more leads, automate follow-ups, and close more deals.`;

  console.log(`[TEST SEND] Priority 1: Attempting Freeform Interactive WhatsApp Message to +${userPhone}...`);

  // Freeform Interactive Message Payload with Image Header + Text + Interested Quick Reply Button
  const freeformPayload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: userPhone,
    type: "interactive",
    interactive: {
      type: "button",
      header: {
        type: "image",
        image: {
          link: imageUrl
        }
      },
      body: {
        text: messageText
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: "interested_btn",
              title: "Interested"
            }
          }
        ]
      }
    }
  };

  const res1 = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(freeformPayload)
  });

  const data1 = await res1.json();
  console.log("Freeform Send Result:\n", JSON.stringify(data1, null, 2));

  if (data1.messages && data1.messages[0]?.id) {
    console.log("🎉 Freeform WhatsApp message delivered successfully to +", userPhone);
    return;
  }

  // Priority 2: Fallback to Approved Template Message if 24h window error occurs
  console.log("\n[TEST SEND] Priority 2: Fallback to Meta Template Message (nobogent_offer_promo_v1)...");

  const templatePayload = {
    messaging_product: "whatsapp",
    to: userPhone,
    type: "template",
    template: {
      name: "nobogent_offer_promo_v1",
      language: {
        code: "en"
      },
      components: [
        {
          type: "header",
          parameters: [
            {
              type: "image",
              image: {
                link: imageUrl
              }
            }
          ]
        },
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: "Raman"
            }
          ]
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
  console.log("Template Send Result:\n", JSON.stringify(data2, null, 2));
}

sendTest();
