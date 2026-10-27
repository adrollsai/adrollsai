import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function check() {
  const devToken = process.env.DEV_WHATSAPP_ACCESS_TOKEN;
  const digiproWaba = '1671799817659171';
  const res = await fetch(`https://graph.facebook.com/v21.0/${digiproWaba}/message_templates?fields=name,status,category,components`, {
    headers: { Authorization: `Bearer ${devToken}` }
  });
  const data = await res.json();
  console.log('Templates with components:');
  for (const t of data.data) {
    console.log(`\n=== Template: ${t.name} (${t.status}) ===`);
    console.log(JSON.stringify(t.components, null, 2));
  }
}

check().then(() => process.exit(0)).catch(console.error);
