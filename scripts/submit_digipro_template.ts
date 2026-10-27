import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function submitTemplate() {
  const devToken = process.env.DEV_WHATSAPP_ACCESS_TOKEN;
  const digiproWaba = '1671799817659171';

  // Test 1: Quick Reply buttons (most reliable, standard on Meta)
  const templatePayload = {
    name: 'digipro_lead_welcome',
    category: 'MARKETING',
    language: 'en_US',
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}! 👋 Welcome to DigiPro Business Services. Thank you for connecting with us regarding company formation & business setup in Dubai.\n\nOur all-inclusive business setup packages start from just AED 3,999, featuring 100% foreign ownership, trade licensing, and residence visa assistance.\n\nHow would you like to proceed?',
        example: {
          body_text: [
            ['Rahul']
          ]
        }
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'QUICK_REPLY',
            text: 'Visit Website'
          },
          {
            type: 'QUICK_REPLY',
            text: 'Connect with Expert'
          },
          {
            type: 'QUICK_REPLY',
            text: 'Book Appointment'
          }
        ]
      }
    ]
  };

  console.log('Submitting template digipro_lead_welcome to WABA:', digiproWaba);
  const res = await fetch(`https://graph.facebook.com/v21.0/${digiproWaba}/message_templates`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${devToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(templatePayload)
  });

  const data = await res.json();
  console.log('Submission Result:', JSON.stringify(data, null, 2));
}

submitTemplate().then(() => process.exit(0)).catch(console.error);
