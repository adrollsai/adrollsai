const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function submitTemplate() {
  const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('whatsapp_waba_id, whatsapp_phone_number_id, whatsapp_access_token, facebook_token')
    .eq('id', userId)
    .single();

  const wabaId = profile.whatsapp_waba_id || process.env.DEV_WHATSAPP_WABA_ID;
  const token = profile.whatsapp_access_token || profile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;

  console.log(`Submitting Meta WhatsApp Template to WABA ID ${wabaId}...`);

  const imageUrl = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/bc63c065-9bcc-4793-bedc-f0960406425b/1785906182341-offer.jpg";

  // Template name: must be lowercase, alphanumeric and underscores only
  const templateName = "nobogent_offer_promo_v1";

  const bodyText = `Hi {{1}},\n\nWhat if your entire sales & marketing team could be replaced by one AI?\n\nIntroducing *Nobogent* — the world's first AI Sales & Marketing Department built exclusively for real estate.\n\n✅ 500 AI Calling Minutes\n🎥 10 AI Videos\n🎨 50 AI Graphics\n📱 AI WhatsApp Automation\n👥 Advanced AI CRM\n📢 WhatsApp Broadcasting\n🌐 Website Builder\n📄 Landing Page Creator\n📈 Ads Management\n🏡 Inventory Management\n📲 Social Media Posting\n\n*Everything included for just ₹9,999/month.*\n\nReply *Interested* to watch a 2-minute demo and see how Nobogent can help you generate more leads, automate follow-ups, and close more deals.`;

  const templatePayload = {
    name: templateName,
    language: "en",
    category: "MARKETING",
    components: [
      {
        type: "HEADER",
        format: "IMAGE",
        example: {
          header_handle: [imageUrl]
        }
      },
      {
        type: "BODY",
        text: bodyText,
        example: {
          body_text: [["Raman"]]
        }
      },
      {
        type: "BUTTONS",
        buttons: [
          {
            type: "QUICK_REPLY",
            text: "Interested"
          }
        ]
      }
    ]
  };

  const metaRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(templatePayload)
  });

  const resData = await metaRes.json();
  console.log("Meta Response:\n", JSON.stringify(resData, null, 2));
}

submitTemplate();
