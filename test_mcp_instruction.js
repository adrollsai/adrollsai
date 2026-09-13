const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

// Setup Supabase admin client
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runComplexTest(customPrompt) {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("🚀 NOBOGENT WHATSAPP MCP AGENT — COMPLEX INSTRUCTION TESTER");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // 1. Fetch an admin profile that has whatsapp_personal_number or contact_number
  const { data: profiles, error } = await supabaseAdmin
    .from('profiles')
    .select('id, business_name, whatsapp_personal_number, contact_number, whatsapp_phone_number, role')
    .or('role.eq.admin,role.eq.agency,role.eq.super_admin')
    .limit(5);

  if (error || !profiles || profiles.length === 0) {
    console.error("❌ No admin profiles found in database.");
    return;
  }

  const testProfile = profiles.find(p => p.whatsapp_personal_number) || profiles[0];
  const testPhone = (testProfile.whatsapp_personal_number || testProfile.contact_number || '918288835235').replace(/\D/g, '');

  console.log(`👤 Using Workspace Profile: "${testProfile.business_name || 'Admin'}" (ID: ${testProfile.id})`);
  console.log(`📱 Simulating Sender Phone: +${testPhone}\n`);

  // Default complex instruction if none provided
  const prompt = customPrompt || 
    "Add a new 3BHK flat at Green Valley Baner priced at 85 Lakhs. Then draft a Meta ad campaign for it with a daily budget of 2000 INR targeting Pune, and also analyze why our leads this week had low qualification scores.";

  console.log(`📝 Complex Instruction:`);
  console.log(`   "${prompt}"\n`);
  console.log("⏳ Sending payload to local webhook endpoint: http://localhost:3000/api/webhooks/facebook ...");

  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "entry_test",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550001234",
                phone_number_id: process.env.DEV_WHATSAPP_PHONE_ID || "1029384756"
              },
              messages: [
                {
                  from: testPhone,
                  id: `wamid_test_${Date.now()}`,
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  type: "text",
                  text: {
                    body: prompt
                  }
                }
              ]
            }
          }
        ]
      }
    ]
  };

  try {
    const res = await fetch("http://localhost:3000/api/webhooks/facebook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const resJson = await res.json();
    console.log(`\n✅ Webhook Response HTTP Status: ${res.status}`);
    console.log("📦 Response Payload:", JSON.stringify(resJson));

    console.log("\n🔍 Waiting for agentic MCP processing...");
    
    // Wait for asynchronous agent execution to finish
    await new Promise(r => setTimeout(r, 6000));

    // Fetch the latest chat for this user
    const { data: chat } = await supabaseAdmin
      .from('whatsapp_chats')
      .select('id, last_message_text, updated_at')
      .eq('user_id', testProfile.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (chat) {
      console.log("\n💬 Latest WhatsApp Outbound Reply from Agent:");
      console.log("───────────────────────────────────────────────────────────────");
      console.log(chat.last_message_text);
      console.log("───────────────────────────────────────────────────────────────");
    }

    // Check newly added property in inventory
    const { data: latestProp } = await supabaseAdmin
      .from('properties')
      .select('id, title, price, address, property_type, created_at')
      .eq('user_id', testProfile.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (latestProp) {
      console.log("\n🏡 Latest Property in Inventory:");
      console.log(`   - Title: ${latestProp.title}`);
      console.log(`   - Price: ${latestProp.price}`);
      console.log(`   - Address: ${latestProp.address}`);
      console.log(`   - Type: ${latestProp.property_type}`);
    }

    // Check newly added campaign job
    const { data: latestJob } = await supabaseAdmin
      .from('campaign_jobs')
      .select('id, campaign_name, daily_budget, status, target_locations, created_at')
      .eq('user_id', testProfile.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (latestJob) {
      console.log("\n🚀 Latest Campaign Job Draft:");
      console.log(`   - Campaign Name: ${latestJob.campaign_name}`);
      console.log(`   - Daily Budget: ₹${latestJob.daily_budget}`);
      console.log(`   - Status: ${latestJob.status}`);
      console.log(`   - Target: ${JSON.stringify(latestJob.target_locations)}`);
    }

    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("✅ COMPLEX INSTRUCTION TEST COMPLETE");
    console.log("═══════════════════════════════════════════════════════════════\n");

  } catch (err) {
    console.error("❌ Error running test:", err.message);
  }
}

const inputPrompt = process.argv.slice(2).join(" ");
runComplexTest(inputPrompt);
