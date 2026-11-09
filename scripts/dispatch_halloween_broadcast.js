const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function cleanPhone(raw) {
  if (!raw) return null;
  let digits = raw.toString().replace(/[^0-9]/g, '');
  if (!digits || digits.length < 10) return null;
  if (digits.length === 10) {
    if (['6', '7', '8', '9'].includes(digits[0])) return '91' + digits;
    return null;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
    if (['6', '7', '8', '9'].includes(digits[0])) return '91' + digits;
  }
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length >= 11 && (digits.startsWith('971') || digits.startsWith('1') || digits.startsWith('44'))) return digits;
  return digits;
}

async function runBroadcast() {
  console.log('🎃 ========================================================');
  console.log('🎃 STARTING NOBOGENT HALLOWEEN BROADCAST DISPATCH');
  console.log('🎃 ========================================================\n');

  const nobogentId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
  const childId = 'b1645a6d-4b73-41ef-a197-8247d0168905';
  const templateName = 'halloween';
  const imageUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/user_assets/bc63c065-9bcc-4793-bedc-f0960406425b/halloween_offer_1793444422001.jpg';
  const phoneId = '1185499271314063'; // Nobogent verified phone (+91 98771 61216)

  // 1. Fetch Nobogent profile & credentials
  const { data: profile, error: pErr } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', nobogentId)
    .single();

  if (pErr || !profile) {
    throw new Error(`Failed to fetch Nobogent profile: ${pErr?.message}`);
  }

  const token = profile.facebook_token || profile.whatsapp_access_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;

  // 2. Build Master Client Exclusion List
  console.log('🔍 Building Master Client Exclusion List...');
  const clientExclusionSet = new Set();
  const { data: allProfiles } = await supabaseAdmin.from('profiles').select('*');
  const internalEmails = ['rchopra489@gmail.com', 'nobogent@gmail.com', 'meta-reviewer@nobogent.com'];

  allProfiles?.forEach(p => {
    const isInternal = internalEmails.includes(p.email) || p.business_name?.toLowerCase() === 'nobogent';
    if (!isInternal) {
      [p.contact_number, p.whatsapp_phone_number, p.whatsapp_personal_number, p.voice_twilio_number, p.old_voice_twilio_number].forEach(raw => {
        const cp = cleanPhone(raw);
        if (cp && !cp.includes('5556633659') && !cp.includes('9999999999')) clientExclusionSet.add(cp);
      });
    }
  });

  const { data: dealLeads } = await supabaseAdmin
    .from('leads')
    .select('phone')
    .eq('user_id', nobogentId)
    .or('pipeline_stage.eq.Deal/Token,pipeline_stage.eq.Sales Partner,pipeline_stage.eq.Meeting Done,status.eq.Deal/Token,status.eq.Partner Onboarding');

  dealLeads?.forEach(dl => {
    const cp = cleanPhone(dl.phone);
    if (cp && !cp.includes('9999999999')) clientExclusionSet.add(cp);
  });

  console.log(`🛡️ Loaded ${clientExclusionSet.size} client exclusion phone numbers.\n`);

  // 3. Fetch All Nobogent Leads
  console.log('📥 Fetching all Nobogent leads from database...');
  let allLeads = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id, name, phone, email, source, ad_name, form_name, campaign_id, user_id, assigned_to, created_at, custom_fields, notes, status, pipeline_stage, csv_audience')
      .or(`user_id.eq.${nobogentId},user_id.eq.${childId},assigned_to.eq.${nobogentId},assigned_to.eq.${childId}`)
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    allLeads = allLeads.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`📋 Total raw Nobogent lead records fetched: ${allLeads.length}`);

  // 4. Filter strictly to target audience (CSV Realtors + Meta Product leads, excluding hiring, agency, clients)
  const targetLeadMap = new Map(); // cleanPhone -> lead record

  allLeads.forEach(l => {
    const cp = cleanPhone(l.phone);
    if (!cp) return;

    // Check if client
    if (clientExclusionSet.has(cp)) return;

    const ad = (l.ad_name || '').toLowerCase();
    const form = (l.form_name || '').toLowerCase();
    const src = (l.source || '').toLowerCase();

    // Check hiring
    if (ad.includes('hiring') || form.includes('hiring') || ad.includes('sales rockstar') || src.includes('hiring')) {
      return;
    }

    // Check agency owners
    if (ad.includes('agency owners') || form.includes('agency') || form.includes('smma') || ad.includes('scale past') || src.includes('partner')) {
      return;
    }

    // Check if CSV Realtor or Meta Product
    const isCsvRealtor = l.source === 'CSV Import' || !!l.csv_audience;
    const isMetaProduct = src.includes('facebook') || src.includes('meta') || src.includes('whatsapp') || !!l.ad_name || !!l.form_name;

    if (isCsvRealtor || isMetaProduct) {
      if (!targetLeadMap.has(cp)) {
        targetLeadMap.set(cp, {
          id: l.id,
          name: l.name || 'Valued Partner',
          phone: cp,
          rawPhone: l.phone,
          source: l.source,
          category: isCsvRealtor ? 'CSV Realtor' : 'Meta Product'
        });
      }
    }
  });

  const audienceList = Array.from(targetLeadMap.values());
  console.log(`🎯 Net Unique Deliverable Audience Count: ${audienceList.length}`);

  if (audienceList.length === 0) {
    console.error('❌ No recipients found. Aborting.');
    return;
  }

  // 5. Create Broadcast Record in whatsapp_broadcasts
  const broadcastTitle = `Halloween Month-End Offer (₹9,999 + 1000 Mins) - ${audienceList.length} Leads`;
  const { data: broadcast, error: bErr } = await supabaseAdmin
    .from('whatsapp_broadcasts')
    .insert({
      user_id: nobogentId,
      title: broadcastTitle,
      template_name: templateName,
      recipient_stage: 'All',
      status: 'processing',
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (bErr || !broadcast) {
    throw new Error(`Failed to create broadcast record: ${bErr?.message}`);
  }

  const broadcastId = broadcast.id;
  console.log(`📢 Created broadcast record ID: ${broadcastId}`);

  // 6. Create Recipient Records in whatsapp_broadcast_recipients
  console.log('💾 Inserting recipient records into database...');
  const recipientBatches = [];
  const recipientRecords = audienceList.map(item => ({
    broadcast_id: broadcastId,
    lead_id: item.id,
    user_id: nobogentId,
    phone_number: item.phone,
    status: 'pending'
  }));

  for (let i = 0; i < recipientRecords.length; i += 200) {
    recipientBatches.push(recipientRecords.slice(i, i + 200));
  }

  for (const batch of recipientBatches) {
    await supabaseAdmin.from('whatsapp_broadcast_recipients').insert(batch);
  }
  console.log(`✅ Saved ${recipientRecords.length} pending recipient records.`);

  // 7. Controlled Concurrency Dispatch Loop
  console.log('\n🚀 Initiating controlled delivery via Meta WhatsApp Cloud API...');
  const CONCURRENCY = 6;
  const DELAY_BETWEEN_CHUNKS_MS = 60;
  let sentCount = 0;
  let failedCount = 0;
  let currentIndex = 0;
  const startTime = Date.now();

  const metaUrl = `https://graph.facebook.com/v21.0/${phoneId}/messages`;

  async function worker() {
    while (currentIndex < audienceList.length) {
      const idx = currentIndex++;
      const recipient = audienceList[idx];

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient.phone,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en_US' },
          components: [
            {
              type: 'header',
              parameters: [
                {
                  type: 'image',
                  image: { link: imageUrl }
                }
              ]
            }
          ]
        }
      };

      try {
        const res = await fetch(metaUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const resData = await res.json();

        if (res.ok && resData.messages?.[0]?.id) {
          sentCount++;
          const msgId = resData.messages[0].id;

          // Update recipient in DB
          await supabaseAdmin
            .from('whatsapp_broadcast_recipients')
            .update({ status: 'sent', sent_at: new Date().toISOString() })
            .eq('broadcast_id', broadcastId)
            .eq('lead_id', recipient.id);

          // Ensure whatsapp_chats record exists so inbound replies trigger email notifications
          let { data: chat } = await supabaseAdmin
            .from('whatsapp_chats')
            .select('id')
            .eq('user_id', nobogentId)
            .eq('recipient_phone', recipient.phone)
            .maybeSingle();

          if (!chat) {
            const { data: newChat } = await supabaseAdmin
              .from('whatsapp_chats')
              .insert({
                user_id: nobogentId,
                recipient_phone: recipient.phone,
                recipient_name: recipient.name,
                last_message_text: `[Template: ${templateName}]`
              })
              .select('id')
              .maybeSingle();
            chat = newChat;
          }

          if (chat?.id) {
            await supabaseAdmin.from('whatsapp_messages').insert({
              chat_id: chat.id,
              direction: 'outbound',
              message_text: `🎃 Sent Month-End Halloween Offer: 1000 Free Calling Mins (@ ₹9,999/mo)`,
              media_url: imageUrl
            });
          }
        } else {
          failedCount++;
          const errMsg = resData.error?.message || 'Meta API error';
          await supabaseAdmin
            .from('whatsapp_broadcast_recipients')
            .update({ status: 'failed', error_message: errMsg })
            .eq('broadcast_id', broadcastId)
            .eq('lead_id', recipient.id);
        }
      } catch (err) {
        failedCount++;
        await supabaseAdmin
          .from('whatsapp_broadcast_recipients')
          .update({ status: 'failed', error_message: err.message })
          .eq('broadcast_id', broadcastId)
          .eq('lead_id', recipient.id);
      }

      const totalDone = sentCount + failedCount;
      if (totalDone % 50 === 0 || totalDone === audienceList.length) {
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`📊 Progress: ${totalDone}/${audienceList.length} (${sentCount} sent, ${failedCount} failed) [${elapsedSec}s]`);
      }

      await new Promise(r => setTimeout(r, DELAY_BETWEEN_CHUNKS_MS));
    }
  }

  // Run workers
  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  // 8. Finalize Broadcast Record
  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  await supabaseAdmin
    .from('whatsapp_broadcasts')
    .update({
      status: 'completed',
      sent_at: new Date().toISOString()
    })
    .eq('id', broadcastId);

  console.log('\n🎉 ========================================================');
  console.log('🎉 BROADCAST DISPATCH COMPLETED');
  console.log('🎉 ========================================================');
  console.log(`⏱️ Total Time: ${totalElapsed} seconds`);
  console.log(`✅ Total Successfully Dispatched: ${sentCount}`);
  console.log(`❌ Total Failed: ${failedCount}`);
  console.log(`📈 Success Rate: ${((sentCount / audienceList.length) * 100).toFixed(1)}%`);
  console.log(`🆔 Broadcast ID: ${broadcastId}`);
}

runBroadcast().catch(console.error);

