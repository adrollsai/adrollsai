const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testSendVideoMessage() {
  const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b'; // rchopra489@gmail.com

  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  const token = profile.whatsapp_access_token || profile.facebook_token;
  const phoneId = profile.whatsapp_phone_number_id;

  const testPhone = '918288835235';
  const testName = 'Rahul';

  const videoUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/bc63c065-9bcc-4793-bedc-f0960406425b/1785759781042-7f4f60c4-5a71-405f-8630-4f6249a5564d.mov';

  const bodyText = `Hi ${testName},\n\nWhat if every new lead received an instant follow-up—even while you're busy?\n\nThis short video shows how real estate businesses are using AI to automatically call, message, and nurture leads 24/7.\n\nClick on "Connect with Expert" button below to book a demo!`;

  const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

  // Payload with video header and interactive reply button
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: testPhone,
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

  console.log(`Sending Video + Button payload to ${testPhone}...`);

  const res = await fetch(metaUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  console.log(`Meta API Status: ${res.status}`);
  console.log("Meta API Response:\n", JSON.stringify(data, null, 2));

  if (!res.ok && data?.error) {
    console.warn("\n⚠️ Interactive video payload failed or returned error. Testing fallback (separate video + interactive button message)...");

    // Fallback Method: Send Video message first, followed by Interactive Button message
    const videoPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: testPhone,
      type: 'video',
      video: {
        link: videoUrl,
        caption: bodyText
      }
    };

    const vidRes = await fetch(metaUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(videoPayload)
    });
    const vidData = await vidRes.json();
    console.log(`Video Message Status: ${vidRes.status}`);
    console.log("Video Message Response:\n", JSON.stringify(vidData, null, 2));

    // Send Button message separately
    const buttonPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: testPhone,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: {
          text: `Would you like to speak directly with our expert on call?`
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

    const btnRes = await fetch(metaUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(buttonPayload)
    });
    const btnData = await btnRes.json();
    console.log(`Button Message Status: ${btnRes.status}`);
    console.log("Button Message Response:\n", JSON.stringify(btnData, null, 2));
  }
}

testSendVideoMessage();
