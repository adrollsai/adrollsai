const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testApprovedTemplate() {
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

  console.log(`Sending APPROVED META TEMPLATE (nobogent_offer_promo_v1) to +${userPhone}...`);

  const templatePayload = {
    messaging_product: "whatsapp",
    to: userPhone,
    type: "template",
    template: {
      name: "nobogent_offer_promo_v1",
      language: { code: "en" },
      components: [
        {
          type: "header",
          parameters: [
            {
              type: "image",
              image: { link: imageUrl }
            }
          ]
        },
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: "Rahul"
            }
          ]
        }
      ]
    }
  };

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(templatePayload)
  });

  const data = await res.json();
  console.log("Template Send Result:\n", JSON.stringify(data, null, 2));
}

testApprovedTemplate();
