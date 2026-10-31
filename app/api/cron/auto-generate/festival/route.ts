import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createKieTask, generateKieChat, queryKieTask } from '@/utils/external-apis';
import { sendPushNotification } from '@/utils/notification-helper';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { getFestivalForToday, buildFestivalCreativePrompt, FESTIVALS_2026, FestivalInfo } from '@/utils/festival-helper';
import { dispatchCreativeToAdmin } from '@/utils/creative-dispatch-helper';

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
    let profilesQuery = supabaseAdmin
      .from('profiles')
      .select('id, business_name, business_info, industry, contact_number, logo_url, email, notification_email, whatsapp_personal_number, whatsapp_phone_number_id, whatsapp_access_token, facebook_token, client_features, address');

    if (targetUserId) {
      profilesQuery = profilesQuery.eq('id', targetUserId);
    }

    const { data: profiles, error: profErr } = await profilesQuery;
    if (profErr) throw profErr;

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ message: 'No profiles found for festival check' });
    }

    const now = new Date();
    const todayStartIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)).toISOString();

    const results: any[] = [];

    for (const profile of profiles) {
      const userCountry = profile.client_features?.country || profile.address || 'India';

      // Determine active festival for today in user's country
      let activeFestival: FestivalInfo | null = null;

      if (testFestivalId) {
        activeFestival = FESTIVALS_2026.find(f => f.id === testFestivalId) || null;
      } else {
        activeFestival = getFestivalForToday(userCountry, now);
      }

      if (!activeFestival) {
        console.log(`[Festival Generator] No festival today for profile "${profile.business_name}" (${userCountry})`);
        continue;
      }

      console.log(`[Festival Generator] 🎊 Festival Detected for "${profile.business_name}": ${activeFestival.name} (${activeFestival.id})`);

      // Check if a festival asset was already created for this user and this festival today
      if (!isForce) {
        const { count: existingCount } = await supabaseAdmin
          .from('assets')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', profile.id)
          .contains('metadata', { festival_id: activeFestival.id })
          .gte('created_at', todayStartIso);

        if (existingCount && existingCount > 0) {
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
        model: inputImages.length > 0 ? 'gpt-image-2-5-flare-image-to-image' : 'gpt-image-2-5-flare-text-to-image',
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
          model: 'gpt-image-2-5-flare-text-to-image',
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
      const targetEmail = profile.notification_email || profile.email;

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
    }

    return NextResponse.json({
      success: true,
      processedFestivalCount: results.length,
      results
    });

  } catch (error: any) {
    console.error('❌ [Festival Generator] Exception:', error);
    return NextResponse.json({ error: error.message || 'Festival generation failed' }, { status: 500 });
  }
}
