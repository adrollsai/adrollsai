const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testNativePdfDocumentCard() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222'; // Khushi Ram account
  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  const token = profile.whatsapp_access_token || profile.facebook_token;
  const phoneId = profile.whatsapp_phone_number_id; // 1222478707610202

  const testPhone = '918288835235';
  const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

  // Direct clean R2 PDF link
  const pdfUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/d838c956-1761-4bce-9d91-32f3abecc222/1785820062907-FarmHouse-FunctionalDevelopment290324.pdf';

  const bodyText = `Namaste Rahul ji! 🙏\n\nDhanyawad Khushi Ram Realtors & Developers ke 1-Acre Bio-Climatic Luxury Farmhouse project mein interest dikhane ke liye.\n\n✨ Key Highlights:\n• 30-Acre Approved Bio-Climatic Township (Only 19 Farmhouses)\n• 6,000-7,000 sq ft Built-up Villa + Private Pool & Landscaping\n• 58% Open Area, 80 ft Wide Road & Art of Living Ashram\n• Direct Price Advantage: ₹12.5 Crore (Around ₹25,000/gaj built-up)\n\nKya aap is weekend par One-to-One Site Visit plan karna chahenge?`;

  console.log("Sending Native Document Header (PDF Card) + Buttons to " + testPhone + "...");

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: testPhone,
    type: 'interactive',
    interactive: {
      type: 'button',
      header: {
        type: 'document',
        document: {
          link: pdfUrl,
          filename: '1-Acre Luxury Farmhouse Brochure.pdf'
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
}

testNativePdfDocumentCard();
