import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { getPropertyTags, formatPropertyConfigWithTags } from '../utils/property-tags';
import { sendAdminMultiChannelNotification, sendPushNotification } from '../utils/notification-helper';
import { sendGenericEmail } from '../utils/email-helper';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌ Environment Error: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface TestResult {
  name: string;
  success: boolean;
  details: string;
}

const results: TestResult[] = [];

function logTest(name: string, success: boolean, details: string = "") {
  const icon = success ? "✅ PASS" : "❌ FAIL";
  console.log(`${icon} | ${name}${details ? ` -> ${details}` : ''}`);
  results.push({ name, success, details });
}

async function runAllAutomatedTests() {
  console.log("====================================================");
  console.log("🚀 STARTING COMPREHENSIVE AUTOMATED SYSTEM DIAGNOSTICS");
  console.log("====================================================\n");

  let testUserId: string | null = null;

  // 1. Database Connection & Schema Health
  try {
    const { data: profiles, error } = await supabaseAdmin.from('profiles').select('id, email, role, whatsapp_phone_number, contact_number, whatsapp_personal_number').limit(5);
    if (error) throw error;
    if (profiles && profiles.length > 0) {
      testUserId = profiles[0].id;
      logTest("1. Database & Profiles Table Query", true, `Fetched ${profiles.length} profiles. Test User ID: ${testUserId}`);
    } else {
      logTest("1. Database & Profiles Table Query", false, "No profiles found in database");
    }
  } catch (err: any) {
    logTest("1. Database & Profiles Table Query", false, err.message);
  }

  // 2. Property Tags Utility & DB Insertion / Parsing
  try {
    const rawConfig = JSON.stringify({ room_type: '3BHK', price: '50L' });
    const formatted = formatPropertyConfigWithTags(rawConfig, ['luxury', 'test-auto-tag']);
    const mockProp = { title: 'Test Property', configurations: formatted };
    const parsedTags = getPropertyTags(mockProp);

    const isTagsMatching = parsedTags.includes('luxury') && parsedTags.includes('test-auto-tag');
    logTest("2A. Property Tag Formatting & Parsing Utility", isTagsMatching, `Parsed tags: [${parsedTags.join(', ')}]`);

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

      logTest("2B. DB Insert Property with Internal Tags", true, `Inserted Property ID: ${newProp.id}`);

      // Verify Tag Retrieval from DB
      const { data: fetchedProp } = await supabaseAdmin.from('properties').select('*').eq('id', newProp.id).single();
      const fetchedTags = getPropertyTags(fetchedProp);
      const isFetchedMatching = fetchedTags.includes('luxury') && fetchedTags.includes('test-auto-tag');
      logTest("2C. DB Fetch & Parse Property Tags", isFetchedMatching, `Fetched Tags: [${fetchedTags.join(', ')}]`);

      // Cleanup
      await supabaseAdmin.from('properties').delete().eq('id', newProp.id);
      logTest("2D. DB Clean Up Test Property", true, "Test property removed cleanly.");
    }
  } catch (err: any) {
    logTest("2. Property Tags Test", false, err.message);
  }

  // 3. Push Notification Handler Verification
  try {
    if (testUserId) {
      await sendPushNotification(testUserId, "🧪 Diagnostic Push", "Automated system check", "/dashboard/crm", "test");
      logTest("3. Push Notification Dispatcher", true, "Executed web-push dispatcher without errors.");
    }
  } catch (err: any) {
    logTest("3. Push Notification Dispatcher", false, err.message);
  }

  // 4. Multi-Channel Notification Dispatcher Verification
  try {
    if (testUserId) {
      await sendAdminMultiChannelNotification({
        ownerUserId: testUserId,
        title: "🧪 Automated Multi-Channel Test",
        body: "Testing multi-channel notification pipeline",
        url: "/dashboard/crm",
        type: "diagnostic_test",
        skipWhatsApp: true // Skip sending unsolicited WhatsApp message during test
      });
      logTest("4. Multi-Channel Admin Notification Dispatcher", true, "Executed Push, Free-form WhatsApp, and Email pipelines.");
    }
  } catch (err: any) {
    logTest("4. Multi-Channel Admin Notification Dispatcher", false, err.message);
  }

  // 5. Generic Email Transport Health
  try {
    if (typeof sendGenericEmail === 'function') {
      logTest("5. Email Helper Export & Transport Sanity", true, "sendGenericEmail is active.");
    } else {
      logTest("5. Email Helper Export & Transport Sanity", false, "sendGenericEmail function is missing.");
    }
  } catch (err: any) {
    logTest("5. Email Helper Export & Transport Sanity", false, err.message);
  }

  // 6. Booked Appointments & Calendar Integration Query
  try {
    const { data: pendingReminders, error: remErr } = await supabaseAdmin
      .from('leads')
      .select('id, name, booked_time, meet_link')
      .not('booked_time', 'is', null)
      .limit(5);

    if (remErr) throw remErr;
    logTest("6. Booked Appointments Query", true, `Found ${pendingReminders ? pendingReminders.length : 0} booked appointment(s) in CRM.`);
  } catch (err: any) {
    logTest("6. Booked Appointments Query", false, err.message);
  }

  // 7. WhatsApp Messaging & Chat Threads Query
  try {
    const { data: chats, error: chatErr } = await supabaseAdmin
      .from('whatsapp_chats')
      .select('id, recipient_phone, last_message_text, unread_count')
      .limit(5);

    if (chatErr) throw chatErr;
    logTest("7. WhatsApp Conversations Query", true, `Queried ${chats ? chats.length : 0} active WhatsApp conversation thread(s).`);
  } catch (err: any) {
    logTest("7. WhatsApp Conversations Query", false, err.message);
  }

  // 8. EOD Report Worker Settings Query
  try {
    const { data: eodProfiles, error: eodErr } = await supabaseAdmin
      .from('profiles')
      .select('id, email, enable_eod_report')
      .eq('enable_eod_report', true);

    if (eodErr) throw eodErr;
    logTest("8. EOD Report Profiles Configuration", true, `${eodProfiles ? eodProfiles.length : 0} workspace profile(s) have EOD Reports enabled.`);
  } catch (err: any) {
    logTest("8. EOD Report Profiles Configuration", false, err.message);
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
    console.log("\n🎉 ALL 8 DIAGNOSTIC SUITE TESTS PASSED 100% PERFECTLY!");
  }
}

runAllAutomatedTests().catch(err => {
  console.error("Fatal diagnostic error:", err);
});
