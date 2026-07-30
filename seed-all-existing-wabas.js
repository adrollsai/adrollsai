const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function seedAllConnectedAccounts() {
  console.log("=== Registering WhatsApp Catalog Templates for All Connected Accounts ===");

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, business_name, whatsapp_waba_id, whatsapp_business_account_id, whatsapp_access_token, facebook_token')
    .or('whatsapp_waba_id.not.is.null,whatsapp_business_account_id.not.is.null');

  if (error) {
    console.error("Failed to query profiles:", error);
    return;
  }

  console.log(`Found ${profiles ? profiles.length : 0} profiles with connected WhatsApp accounts.`);

  const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
  if (!appId) {
    console.error("Missing NEXT_PUBLIC_FACEBOOK_APP_ID in environment.");
    return;
  }

  for (const p of profiles) {
    const wabaId = p.whatsapp_waba_id || p.whatsapp_business_account_id;
    const token = p.whatsapp_access_token || p.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;

    if (!wabaId || !token) {
      console.log(`Skipping profile ${p.email} (${p.id}): Missing WABA ID or Access Token.`);
      continue;
    }

    console.log(`\n--------------------------------------------------`);
    console.log(`Processing WABA ${wabaId} for user: ${p.email} (${p.business_name || p.full_name})`);

    try {
      // 1. Fetch current templates from Meta for this WABA
      const getRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?limit=1000`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const getParsed = await getRes.json();

      if (getParsed.error) {
        console.error(`❌ Meta GET templates error for WABA ${wabaId}:`, getParsed.error.message);
        continue;
      }

      const existingNames = new Set((getParsed.data || []).map(t => t.name.toLowerCase()));
      console.log(`Existing templates count: ${existingNames.size}. Registered templates:`, Array.from(existingNames));

      const postMetaUrl = `https://graph.facebook.com/v20.0/${wabaId}/message_templates`;

      // Register instant_lead_catalog_welcome
      if (!existingNames.has('instant_lead_catalog_welcome')) {
        console.log(`➡️ Submitting 'instant_lead_catalog_welcome' template to Meta for approval...`);
        const payload = {
          name: 'instant_lead_catalog_welcome',
          category: 'MARKETING',
          language: 'en_US',
          components: [
            {
              type: 'BODY',
              text: 'Hi {{1}}, thank you for showing interest in {{2}}! We have received your inquiry. Click the button below to view our complete inventory catalog and current listings:',
              example: {
                body_text: [
                  ['John', p.business_name || 'Nobogent']
                ]
              }
            },
            {
              type: 'BUTTONS',
              buttons: [
                {
                  type: 'URL',
                  text: 'View Listings',
                  url: 'https://app.nobogent.com/shared/{{1}}',
                  example: [
                    p.id
                  ]
                }
              ]
            }
          ]
        };

        const res = await fetch(postMetaUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.error) {
          console.error(`❌ Meta template submission failed for WABA ${wabaId}:`, data.error.message);
        } else {
          console.log(`✅ Template 'instant_lead_catalog_welcome' submitted successfully for WABA ${wabaId}! ID: ${data.id}, Status: ${data.status}`);
        }
      } else {
        console.log(`✅ Template 'instant_lead_catalog_welcome' is already registered for WABA ${wabaId}.`);
      }
    } catch (err) {
      console.error(`Exception during WABA ${wabaId} template registration:`, err.message);
    }
  }

  console.log("\n=== Seeding Finished for All Existing WABA Accounts! ===");
}

seedAllConnectedAccounts();
