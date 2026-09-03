require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const templatesToSubmit = [
  {
    name: 'subscription_expiry_reminder',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}},\n\nYour Nobogent {{2}} plan expires in {{3}}. Renew now to keep your campaigns and AI automations running uninterrupted.\n\n💳 Renew at: {{4}}\n\nNeed help? Contact support@nobogent.com',
        example: {
          body_text: [
            ['Harman Realty', 'Pro Plan', '3 days', 'https://app.nobogent.com/dashboard/billing']
          ]
        }
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Renew Plan',
            url: 'https://app.nobogent.com/dashboard/billing'
          }
        ]
      }
    ]
  },
  {
    name: 'low_credits_alert',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}},\n\n⚠️ Your Nobogent credit balance is running low: only {{2}} credits remaining.\n\nTop up now to avoid service interruptions for your voice calling and marketing campaigns.\n\n🔋 Recharge your account at: {{3}}\n\nNeed help? Contact support@nobogent.com',
        example: {
          body_text: [
            ['Harman Realty', '45', 'https://app.nobogent.com/dashboard/usage']
          ]
        }
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Recharge Credits',
            url: 'https://app.nobogent.com/dashboard/usage'
          }
        ]
      }
    ]
  }
];

async function submitTemplates() {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, whatsapp_access_token, whatsapp_waba_id, facebook_token')
    .eq('email', 'rchopra489@gmail.com')
    .single();

  const token = profile?.whatsapp_access_token || profile?.facebook_token || process.env.WHATSAPP_ACCESS_TOKEN || process.env.DEV_WHATSAPP_ACCESS_TOKEN;
  const wabaId = profile?.whatsapp_waba_id || process.env.DEV_WHATSAPP_WABA_ID;

  console.log(`Submitting templates to Meta WABA: ${wabaId}...`);

  for (const tpl of templatesToSubmit) {
    console.log(`\nSubmitting template: "${tpl.name}" (${tpl.category})...`);
    
    const metaUrl = `https://graph.facebook.com/v20.0/${wabaId}/message_templates`;
    const res = await fetch(metaUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(tpl)
    });

    const data = await res.json();
    if (data.error) {
      console.error(`❌ Meta Error for "${tpl.name}":`, data.error);
    } else {
      console.log(`✅ Successfully submitted "${tpl.name}" to Meta! Template ID: ${data.id}, Status: ${data.status}`);
    }
  }

  console.log('\nFetching updated template statuses from Meta...');
  const listRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?limit=100`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const listData = await listRes.json();
  const created = (listData.data || []).filter(t => ['subscription_expiry_reminder', 'low_credits_alert'].includes(t.name));
  console.log('\n--- TEMPLATE STATUSES ON META ---');
  console.log(JSON.stringify(created, null, 2));
}

submitTemplates();
