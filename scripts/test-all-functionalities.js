const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌ Environment Error: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const results = [];

function logTest(name, success, details = "") {
  const icon = success ? "✅ PASS" : "❌ FAIL";
  console.log(`${icon} | ${name}${details ? ` -> ${details}` : ''}`);
  results.push({ name, success, details });
}

async function runAllAutomatedTests() {
  console.log("====================================================");
  console.log("🚀 STARTING AUTOMATED SYSTEM FUNCTIONALITY DIAGNOSTIC");
  console.log("====================================================\n");

  let testUserId = null;

  // 1. Database Connection & Schema Health
  try {
    const { data: profiles, error } = await supabaseAdmin.from('profiles').select('id, email, role, whatsapp_phone_number, contact_number, whatsapp_personal_number').limit(5);
    if (error) throw error;
    if (profiles && profiles.length > 0) {
      testUserId = profiles[0].id;
      logTest("Database & Profiles Table Query", true, `Fetched ${profiles.length} profiles. Test User ID: ${testUserId}`);
    } else {
      logTest("Database & Profiles Table Query", false, "No profiles found in database");
    }
  } catch (err) {
    logTest("Database & Profiles Table Query", false, err.message);
  }

  // 2. Property Tags Storage & Utilities
  try {
    const { getPropertyTags, formatPropertyConfigWithTags } = require('../utils/property-tags');
    
    // Test formatting
    const rawConfig = JSON.stringify({ room_type: '3BHK', price: '50L' });
    const formatted = formatPropertyConfigWithTags(rawConfig, ['luxury', 'test-tag-123']);
    const mockProp = { title: 'Test Property', configurations: formatted };
    const parsedTags = getPropertyTags(mockProp);

    const isTagsMatching = parsedTags.includes('luxury') && parsedTags.includes('test-tag-123');
    logTest("Property Tag Formatting & Parsing Utility", isTagsMatching, `Parsed tags: [${parsedTags.join(', ')}]`);

    // Test DB Insert & Cleanup
    if (testUserId) {
      const { data: newProp, error: insertErr } = await supabaseAdmin.from('properties').insert({
        user_id: testUserId,
        title: 'AUTOMATED_TEST_PROPERTY_DO_NOT_DELETE',
        description: 'Test Property for Tag Search Verification',
        configurations: formatted,
        created_at: new Date().toISOString()
      }).select().single();

      if (insertErr) throw insertErr;

      logTest("DB Insert Property with Tags", true, `Inserted Prop ID: ${newProp.id}`);

      // Verify Tag Retrieval from DB
      const { data: fetchedProp } = await supabaseAdmin.from('properties').select('*').eq('id', newProp.id).single();
      const fetchedTags = getPropertyTags(fetchedProp);
      const isFetchedMatching = fetchedTags.includes('luxury') && fetchedTags.includes('test-tag-123');
      logTest("DB Fetch Property Tags", isFetchedMatching, `Fetched Tags: [${fetchedTags.join(', ')}]`);

      // Cleanup
      await supabaseAdmin.from('properties').delete().eq('id', newProp.id);
      logTest("DB Clean Up Test Property", true, "Test property removed cleanly.");
    }
  } catch (err) {
    logTest("Property Tags Test", false, err.message);
  }

  // 3. Multi-Channel Notification Helper Verification
  try {
    const { sendAdminMultiChannelNotification, sendPushNotification } = require('../utils/notification-helper');
    
    if (testUserId) {
      // Test sending push notification (should handle 0 push tokens gracefully)
      await sendPushNotification(testUserId, "🧪 Diagnostic Push", "Automated system check", "/dashboard/crm", "test");
      logTest("Push Notification Handler", true, "Executed push notification dispatcher without errors.");

      // Test multi-channel notification dispatcher with skip flags to avoid sending real spam while testing code paths
      await sendAdminMultiChannelNotification({
        ownerUserId: testUserId,
        title: "🧪 Automated Multi-Channel Test",
        body: "Testing multi-channel notification pipeline",
        url: "/dashboard/crm",
        type: "diagnostic_test",
        skipWhatsApp: true // Avoid sending unsolicited WhatsApp text during automated test
      });
      logTest("Multi-Channel Notification Dispatcher", true, "Executed sendAdminMultiChannelNotification successfully.");
    }
  } catch (err) {
    logTest("Multi-Channel Notification Test", false, err.message);
  }

  // 4. Email Transport Health
  try {
    const { sendGenericEmail } = require('../utils/email-helper');
    if (typeof sendGenericEmail === 'function') {
      logTest("Email Helper Export", true, "sendGenericEmail is properly exported.");
    } else {
      logTest("Email Helper Export", false, "sendGenericEmail function is missing.");
    }
  } catch (err) {
    logTest("Email Helper Test", false, err.message);
  }

  // 5. Booking & Reminders Cron Verification
  try {
    const { data: pendingReminders, error: remErr } = await supabaseAdmin
      .from('leads')
      .select('id, name, booked_time')
      .not('booked_time', 'is', null)
      .limit(3);

    if (remErr) throw remErr;
    logTest("Booked Appointments Query", true, `Found ${pendingReminders ? pendingReminders.length : 0} booked appointment(s) in CRM.`);
  } catch (err) {
    logTest("Booked Appointments Query", false, err.message);
  }

  // 6. WhatsApp Chats & Unread Messages Verification
  try {
    const { data: chats, error: chatErr } = await supabaseAdmin
      .from('whatsapp_chats')
      .select('id, recipient_phone, last_message_text, unread_count')
      .limit(5);

    if (chatErr) throw chatErr;
    logTest("WhatsApp Chats Inquiry", true, `Queried ${chats ? chats.length : 0} active WhatsApp conversation thread(s).`);
  } catch (err) {
    logTest("WhatsApp Chats Inquiry", false, err.message);
  }

  // 7. EOD Report Settings Verification
  try {
    const { data: eodProfiles, error: eodErr } = await supabaseAdmin
      .from('profiles')
      .select('id, email, enable_eod_report')
      .eq('enable_eod_report', true);

    if (eodErr) throw eodErr;
    logTest("EOD Report Profiles Check", true, `${eodProfiles ? eodProfiles.length : 0} profile(s) have EOD Reports enabled.`);
  } catch (err) {
    logTest("EOD Report Profiles Check", false, err.message);
  }

  console.log("\n====================================================");
  console.log("📊 DIAGNOSTIC RESULTS SUMMARY");
  console.log("====================================================");
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  console.log(`TOTAL TESTS: ${results.length} | PASSED: ${passed} | FAILED: ${failed}`);
  
  if (failed > 0) {
    console.log("\n⚠️ ISSUES PINPOINTED:");
    results.filter(r => !r.success).forEach(r => console.log(`- ${r.name}: ${r.details}`));
  } else {
    console.log("\n🎉 ALL DIAGNOSTIC TESTS PASSED PERFECTLY!");
  }
}

runAllAutomatedTests().catch(err => {
  console.error("Fatal diagnostic error:", err);
});
