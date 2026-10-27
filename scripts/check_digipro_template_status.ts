import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkTemplate() {
  const devToken = process.env.DEV_WHATSAPP_ACCESS_TOKEN;
  const digiproWaba = '1671799817659171';
  const res = await fetch(`https://graph.facebook.com/v21.0/${digiproWaba}/message_templates?name=digipro_lead_welcome`, {
    headers: { Authorization: `Bearer ${devToken}` }
  });
  const data = await res.json();
  console.log('Template Status:', JSON.stringify(data, null, 2));
}

checkTemplate().then(() => process.exit(0)).catch(console.error);
