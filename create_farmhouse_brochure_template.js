const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function submitFarmhouseTemplate() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222';
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('whatsapp_access_token, whatsapp_phone_number_id, whatsapp_waba_id, facebook_token')
    .eq('id', userId)
    .single();

  const token = profile?.whatsapp_access_token || profile?.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;
  const wabaId = profile?.whatsapp_waba_id || process.env.DEV_WHATSAPP_WABA_ID;

  console.log(`Submitting Farmhouse Brochure template for WABA ID: ${wabaId}...`);

  const templatePayload = {
    name: 'farmhouse_luxury_brochure',
    category: 'MARKETING',
    language: 'hi',
    components: [
      {
        type: 'HEADER',
        format: 'TEXT',
        text: '1-Acre Bio-Climatic Luxury Farmhouse'
      },
      {
        type: 'BODY',
        text: 'Namaste {{1}} ji! 🙏\n\nDhanyawad Khushi Ram Realtors & Developers ke 1-Acre Bio-Climatic Luxury Farmhouse project mein interest dikhane ke liye.\n\nAapke request ke anusar Farmhouse ki complete Brochure, Floor Plans aur Township layout ki details niche di gayi hain:\n\n✨ Key Highlights:\n• 30-Acre Approved Bio-Climatic Township (Only 19 Farmhouses)\n• 6,000-7,000 sq ft Built-up Villa + Private Pool & Landscaping\n• 58% Open Area, 80 ft Wide Road & Art of Living Ashram\n• Direct Price Advantage: ₹12.5 Crore (Around ₹25,000/gaj built-up)\n\nComplete PDF Brochure download link:\n{{2}}\n\nKya aap is weekend par One-to-One Site Visit plan karna chahenge?',
        example: {
          body_text: [["Rahul", "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/Farmhouse_Brochure.pdf"]]
        }
      },
      {
        type: 'FOOTER',
        text: 'The Khushi Ram Realtors & Developers'
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'QUICK_REPLY',
            text: 'Book Site Visit'
          },
          {
            type: 'QUICK_REPLY',
            text: 'Request Call Back'
          }
        ]
      }
    ]
  };

  const metaUrl = `https://graph.facebook.com/v20.0/${wabaId}/message_templates`;
  const res = await fetch(metaUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(templatePayload)
  });

  const data = await res.json();
  console.log("Meta API Submit Status:", res.status);
  console.log("Meta API Submit Response:\n", JSON.stringify(data, null, 2));

  if (res.ok && data.id) {
    console.log(`\n🎉 SUCCESS! Template farmhouse_luxury_brochure submitted to Meta! ID: ${data.id}, Status: ${data.status}`);
  }
}

submitFarmhouseTemplate();
