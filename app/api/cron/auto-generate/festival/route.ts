import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createKieTask, generateKieChat, queryKieTask } from '@/utils/external-apis';
import { sendPushNotification } from '@/utils/notification-helper';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { getFestivalForToday, buildFestivalCreativePrompt, FESTIVALS_2026, FestivalInfo, resolveCountry, festivalContextNote } from '@/utils/festival-helper';
import { dispatchCreativeToAdmin } from '@/utils/creative-dispatch-helper';
import { resolveNotificationRecipients } from '@/utils/email-helper';
import { MEDIA_MODELS, imageModelFor } from '@/lib/agent/media-models';
import { festivalAutomationConfig, isFestivalAutomationEnabled } from '@/lib/automation/festival-allowlist';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  return handleFestivalGeneration(request);
}

export async function POST(request: Request) {
  return handleFestivalGeneration(request);
}

async function handleFestivalGeneration(request: Request) {
  try {
    const url = new URL(request.url);
    const authHeader = request.headers.get('authorization');
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
    const cronSecret = url.searchParams.get('cronSecret')?.trim() || token || null;
    const expectedSecret = process.env.CRON_SECRET ? process.env.CRON_SECRET.trim() : '';

    if (expectedSecret && cronSecret !== expectedSecret) {
      console.warn('[Festival Dispatcher] Unauthorized access attempt.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isForce = url.searchParams.get('force') === 'true';
    const targetUserId = url.searchParams.get('userId');
    const testFestivalId = url.searchParams.get('festivalTestId'); // e.g. "in-diwali"

    // 1. Fetch active profiles
    //
    // `notification_email` is NOT a profiles column — it lives inside business_info (see
    // app/api/profile/update/route.ts, which deletes it from the update for that reason).
    // Selecting it here made this whole query fail with "column profiles.notification_email
    // does not exist", so the route returned a 500 before generating anything. That is why
    // no festival creative has ever existed in the database, and it is resolved below with
    // resolveNotificationRecipients, which knows where the address really is.
    let profilesQuery = supabaseAdmin
      .from('profiles')
      .select('id, business_name, business_info, industry, contact_number, logo_url, email, whatsapp_personal_number, whatsapp_phone_number_id, whatsapp_access_token, facebook_token, client_features, address, currency');

    if (targetUserId) {
      profilesQuery = profilesQuery.eq('id', targetUserId);
    }

    const { data: profiles, error: profErr } = await profilesQuery;
    if (profErr) throw profErr;

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ message: 'No profiles found for festival check' });
    }

    // The tenant switches are the SAME row every other automation cron obeys. A festival
    // greeting is a paid image generation and a WhatsApp send, so a tenant who turned
    // automation off must not receive one — and must not be billed for it. A tenant with
    // no policy row yet is treated as enabled (the migration backfills; do not break on a
    // race), which is the same rule the daily-creative cron follows.
    const { data: policies } = await supabaseAdmin
      .from('tenant_automations')
      .select('user_id, master_enabled, daily_creative');
    const policyByTenant = new Map<string, any>();
    for (const p of policies || []) policyByTenant.set(p.user_id, p);

    const now = new Date();
    const todayStartIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)).toISOString();

    // Who is allowed to receive (and be billed for) an automatic greeting. A festival
    // creative costs an image and a WhatsApp send, and every tenant has `daily_creative`
    // on, so "automation is enabled" is not permission to spend. See
    // lib/automation/festival-allowlist for the pilot list and the env overrides.
    // A targeted single-tenant run (?userId=) always goes ahead: that is an operator
    // asking for one client on purpose.
    const festivalConfig = festivalAutomationConfig();

    const results: any[] = [];
    const skipped: Array<{ businessName: string | null; reason: string }> = [];

    for (const profile of profiles) {
      // Country: explicit field, then the account currency (populated for every paying
      // account), then the address text. The old code matched the free-text address and
      // silently defaulted everyone to India.
      const country = resolveCountry({
        clientFeaturesCountry: profile.client_features?.country,
        address: profile.address,
        currency: profile.currency,
      });
      const userCountry = country.code;

      // Determine active festival for today in user's country
      let activeFestival: FestivalInfo | null = null;

      if (testFestivalId) {
        activeFestival = FESTIVALS_2026.find(f => f.id === testFestivalId) || null;
      } else {
        activeFestival = getFestivalForToday(userCountry, now);
      }

      if (!activeFestival) {
        // Still logged for the operator: "no calendar for 2027" and "no festival today"
        // are very different states and only one of them needs a data fix.
        console.log(`[Festival Generator] Nothing to send for "${profile.business_name}" (${userCountry}) — ${festivalContextNote(userCountry, now)}`);
        continue;
      }

      console.log(`[Festival Generator] 🎊 Festival Detected for "${profile.business_name}": ${activeFestival.name} (${activeFestival.id}) [country ${userCountry} via ${country.from}]`);

      const policy = policyByTenant.get(profile.id);
      if (policy && (!policy.master_enabled || !policy.daily_creative)) {
        skipped.push({ businessName: profile.business_name, reason: 'disabled_by_tenant' });
        console.log(`[Festival Generator] Disabled by automation policy for ${profile.business_name}. Skipping.`);
        continue;
      }

      // The allowlist: an unlisted tenant is skipped silently and for free.
      const eligibility = isFestivalAutomationEnabled(
        { userId: profile.id, businessName: profile.business_name },
        festivalConfig.allowlist,
        { all: festivalConfig.all || !!targetUserId },
      );
      if (!eligibility.enabled) {
        skipped.push({ businessName: profile.business_name, reason: eligibility.reason });
        continue;
      }
      console.log(`[Festival Generator] ${profile.business_name} is eligible (${eligibility.reason}${eligibility.matched ? `: ${eligibility.matched.label}` : ''})`);

      // Spend guard: the same daily cap the creative cron respects, so a festival day can
      // never quietly double a tenant's generation bill.
      try {
        const { canSpend } = await import('@/lib/automation/ceo');
        const cap = await canSpend(supabaseAdmin, profile.id, 'creative', 0, 1);
        if (!cap.allowed) {
          skipped.push({ businessName: profile.business_name, reason: `spend_cap:${cap.reason || 'cap'}` });
          console.log(`[Festival Generator] Spend cap reached for ${profile.business_name} (${cap.used}/${cap.cap}). Skipping.`);
          continue;
        }
      } catch (capErr: any) {
        // A guardrail that cannot be read must not silently spend.
        skipped.push({ businessName: profile.business_name, reason: 'spend_guard_unavailable' });
        console.warn('[Festival Generator] Spend guard failed:', capErr?.message || capErr);
        continue;
      }

      // Check if a festival asset was already created for this user and this festival today
      if (!isForce) {
        const { count: existingCount } = await supabaseAdmin
          .from('assets')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', profile.id)
          .contains('metadata', { festival_id: activeFestival.id })
          .gte('created_at', todayStartIso);

        if (existingCount && existingCount > 0) {
          skipped.push({ businessName: profile.business_name, reason: 'already_generated_today' });
          console.log(`[Festival Generator] Festival creative already generated today for ${profile.business_name}. Skipping.`);
          continue;
        }
      }

      const businessName = profile.business_name || 'Our Company';
      const contactNumber = profile.contact_number || '';
      const logoUrl = profile.logo_url || '';

      // A. Generate Bespoke Festival Image Prompt
      const festivalPrompt = buildFestivalCreativePrompt({
        festival: activeFestival,
        businessName,
        businessInfo: profile.business_info,
        industry: profile.industry || 'general',
        contactNumber,
        logoUrl
      });

      console.log(`[Festival Generator] Generated Prompt for ${activeFestival.name}:\n`, festivalPrompt);

      // B. Generate High-Converting Festive Greeting Copy
      let festiveCaption = '';
      try {
        const copyPrompt = `
You are an elite festive copywriter writing a prestigious, heartfelt festival greeting post for social media and WhatsApp.
Brand: "${businessName}"
Festival: "${activeFestival.name}"
Industry: "${profile.industry || 'Business'}"
Festive Greeting: "${activeFestival.greeting}"
Contact Line: "${contactNumber}"

Write a warm, celebratory, and prestigious caption (under 400 characters):
1. Festive warm greeting.
2. A blessing of prosperity, abundance, and milestone achievements from ${businessName}.
3. 3-4 relevant festive hashtags.
Keep it elegant, uplifting, and clean. Do not include markdown codeblocks or quotes.
        `.trim();

        festiveCaption = await generateKieChat(copyPrompt, 'gemini-3-flash');
      } catch (cErr) {
        festiveCaption = `${activeFestival.greeting}\n\nWarmest festive wishes and prosperity from all of us at ${businessName}!\n\n${activeFestival.hashtags.join(' ')}`;
      }

      // C. Submit Image Task to Kie AI
      const inputImages: string[] = [];
      if (logoUrl) inputImages.push(logoUrl);

      const payload: any = {
        model: imageModelFor(inputImages),
        input: {
          prompt: festivalPrompt,
          aspect_ratio: '3:4',
          resolution: '1K'
        }
      };
      if (inputImages.length > 0) {
        payload.input.input_urls = inputImages;
      }

      let kieResult = await createKieTask(payload);
      if (!kieResult || kieResult.error || !kieResult.taskId) {
        // Fallback to text-to-image
        kieResult = await createKieTask({
          model: MEDIA_MODELS.image.id,
          input: {
            prompt: festivalPrompt,
            aspect_ratio: '3:4',
            resolution: '1K'
          }
        });
      }

      if (!kieResult || !kieResult.taskId) {
        console.error(`[Festival Generator] Kie task creation failed for ${profile.business_name}`);
        continue;
      }

      // D. Poll for result
      let finalImageUrl = '';
      const taskId = kieResult.taskId;
      let attempts = 0;

      while (attempts < 35) {
        attempts++;
        await new Promise(r => setTimeout(r, 5000));
        const statusRes = await queryKieTask(taskId);
        if (statusRes.state === 'success' && statusRes.resultUrl) {
          finalImageUrl = statusRes.resultUrl;
          break;
        } else if (statusRes.state === 'fail') {
          console.error(`[Festival Generator] Image task failed:`, statusRes.error);
          break;
        }
      }

      if (!finalImageUrl) {
        console.error(`[Festival Generator] Polling timed out for ${profile.business_name}`);
        continue;
      }

      // E. Compress & Persist to Cloudflare R2
      let persistedUrl = finalImageUrl;
      try {
        console.log(`[Festival Generator] Compressing & persisting image to R2...`);
        const imgRes = await fetch(finalImageUrl);
        const rawBuffer = Buffer.from(await imgRes.arrayBuffer());

        let compressedBuffer: any = rawBuffer;
        let finalFileName = `generated/${profile.id}/festival_${activeFestival.id}_${Date.now()}.jpg`;
        let contentType = 'image/jpeg';

        try {
          compressedBuffer = await sharp(rawBuffer)
            .resize({ width: 1200, withoutEnlargement: true })
            .jpeg({ quality: 80, progressive: true })
            .toBuffer();
        } catch (sharpErr) {
          finalFileName = `generated/${profile.id}/festival_${activeFestival.id}_${Date.now()}.png`;
          contentType = 'image/png';
        }

        await r2.send(new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: finalFileName,
          Body: compressedBuffer,
          ContentType: contentType
        }));

        persistedUrl = `${R2_PUBLIC_URL}/${finalFileName}`;
        console.log(`[Festival Generator] Successfully persisted to R2:`, persistedUrl);
      } catch (r2Err) {
        console.error('[Festival Generator] R2 upload error, using original URL:', r2Err);
      }

      // F. Save to Assets Table (SEPARATE FROM 30 DAILY CREATIVES)
      const { data: newAsset } = await supabaseAdmin.from('assets').insert({
        user_id: profile.id,
        property_id: null, // Festival greetings are brand-wide, not tied to a property
        url: persistedUrl,
        type: 'image',
        status: 'pending_approval',
        caption: festiveCaption,
        kie_task_id: taskId,
        metadata: {
          is_festival: true,
          festival_id: activeFestival.id,
          festival_name: activeFestival.name,
          auto_generated: true,
          dimensions: '3:4'
        },
        created_at: new Date().toISOString()
      }).select().single();

      // G. Push Notification to User
      await sendPushNotification(
        profile.id,
        `🎉 Happy ${activeFestival.name}!`,
        `Your special festive brand greeting graphic is ready to share.`,
        `/dashboard/assets`
      );

      // H. Dispatch to Admin's WhatsApp & Email (Nobogent WABA & Nobogent Email)
      const targetPhone = profile.whatsapp_personal_number || profile.contact_number;
      // Where the notification email genuinely lives (business_info, with a redirect
      // rule for one internal account). Reading a nonexistent column was the bug above.
      const targetEmail = resolveNotificationRecipients(profile).toEmail;

      const dispatchResult = await dispatchCreativeToAdmin({
        recipientEmail: targetEmail,
        recipientPhone: targetPhone,
        businessName,
        creativeUrl: persistedUrl,
        caption: festiveCaption,
        title: `Happy ${activeFestival.name}!`,
        assetId: newAsset?.id || null,
        userId: profile.id,
        isFestival: true,
        festivalName: activeFestival.name,
        clientWabaPhoneId: profile.whatsapp_phone_number_id,
        clientWabaToken: profile.whatsapp_access_token || profile.facebook_token
      });

      results.push({
        businessName,
        festival: activeFestival.name,
        assetId: newAsset?.id,
        imageUrl: persistedUrl,
        dispatchResult
      });

      // Ledger the generation against the same daily cap the creative cron uses.
      try {
        const { recordSpend } = await import('@/lib/automation/ceo');
        await recordSpend(supabaseAdmin, profile.id, 'creative', 0, 1);
      } catch (spendErr: any) {
        console.warn('[Festival Generator] Could not record spend:', spendErr?.message || spendErr);
      }
    }

    return NextResponse.json({
      success: true,
      processedFestivalCount: results.length,
      skippedCount: skipped.length,
      skipped,
      allowlist: {
        source: festivalConfig.source,
        all: festivalConfig.all,
        tenants: festivalConfig.allowlist.map((t) => t.label),
      },
      results
    });

  } catch (error: any) {
    console.error('❌ [Festival Generator] Exception:', error);
    return NextResponse.json({ error: error.message || 'Festival generation failed' }, { status: 500 });
  }
}
