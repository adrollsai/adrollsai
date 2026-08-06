const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkWABABilling() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222';
  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  const token = profile.whatsapp_access_token || profile.facebook_token;
  const phoneId = profile.whatsapp_phone_number_id; // 1222478707610202
  const wabaId = profile.whatsapp_waba_id; // 1073364991920323

  console.log("Checking WABA Billing and Account Status for WABA ID:", wabaId);

  // 1. Fetch WABA Details
  const wabaRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}?fields=id,name,account_review_status,primary_funding_id,currency,timezone_id`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const wabaData = await wabaRes.json();
  console.log("WABA Account Info:\n", JSON.stringify(wabaData, null, 2));

  // 2. Fetch Phone Number Status & Quality
  const phoneRes = await fetch(`https://graph.facebook.com/v20.0/${phoneId}?fields=id,display_phone_number,quality_rating,platform_type,throughput,code_verification_status`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const phoneData = await phoneRes.json();
  console.log("\nPhone Number Info:\n", JSON.stringify(phoneData, null, 2));

  // 3. Test sending a Freeform Custom Message (Directly using open 24h window)
  const testPhone = '918288835235';
  const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

  const pdfUrl = 'https://app.nobogent.com/api/fetch-image?url=https%3A%2F%2Fpub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev%2Flibrary%2Fd838c956-1761-4bce-9d91-32f3abecc222%2F1785820062907-FarmHouse-FunctionalDevelopment290324.pdf';

  const bodyText = `Namaste Rahul ji! 🙏\n\nDhanyawad Khushi Ram Realtors & Developers ke 1-Acre Bio-Climatic Luxury Farmhouse project mein interest dikhane ke liye.\n\n✨ Key Highlights:\n• 30-Acre Approved Bio-Climatic Township (Only 19 Farmhouses)\n• 6,000-7,000 sq ft Built-up Villa + Private Pool & Landscaping\n• 58% Open Area, 80 ft Wide Road & Art of Living Ashram\n• Direct Price Advantage: ₹12.5 Crore (Around ₹25,000/gaj built-up)\n\n📄 Download Complete PDF Brochure:\n${pdfUrl}\n\nKya aap is weekend par One-to-One Site Visit plan karna chahenge?`;

  console.log("\n3. Testing Direct Freeform Custom Message delivery to " + testPhone + "...");

  const freeformPayload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: testPhone,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: bodyText
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: 'book_site_visit',
              title: 'Book Site Visit'
            }
          },
          {
            type: 'reply',
            reply: {
              id: 'request_call_back',
              title: 'Request Call Back'
            }
          }
        ]
      }
    }
  };

  const sendRes = await fetch(metaUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(freeformPayload)
  });

  const sendData = await sendRes.json();
  console.log(`Freeform Meta API Status: ${sendRes.status}`);
  console.log("Freeform Meta API Response:\n", JSON.stringify(sendData, null, 2));
}

checkWABABilling();
