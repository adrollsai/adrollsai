import { createClient } from '@supabase/supabase-js';
import { postToFacebook, postToInstagram, postToLinkedin, createKieTask, queryKieTask } from '@/utils/external-apis';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { GoogleGenerativeAI } from '@google/generative-ai';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const rawPhoneId =
  process.env.NOBOGENT_WHATSAPP_PHONE_ID ||
  process.env.DEV_WHATSAPP_PHONE_ID ||
  process.env.WHATSAPP_PHONE_NUMBER_ID ||
  '1185499271314063';

export const NOBOGENT_WABA_PHONE_ID =
  rawPhoneId === '965464359976021' ? '1185499271314063' : rawPhoneId;

export const NOBOGENT_WABA_TOKEN =
  process.env.NOBOGENT_WHATSAPP_ACCESS_TOKEN ||
  process.env.DEV_WHATSAPP_ACCESS_TOKEN ||
  process.env.WHATSAPP_ACCESS_TOKEN ||
  '';

export interface SendCreativeWithButtonsParams {
  to: string;
  creativeUrl: string;
  caption: string;
  title: string;
  assetId?: string | null;
  summaryNotice?: string;
  isFestival?: boolean;
  festivalName?: string;
}

/**
 * Sends a daily creative with caption and interactive Approve / Edit buttons
 * strictly from the Nobogent official WABA account.
 */
export async function sendNobogentCreativeWithButtons(params: SendCreativeWithButtonsParams): Promise<boolean> {
  const {
    to,
    creativeUrl,
    caption,
    title,
    assetId,
    summaryNotice,
    isFestival,
    festivalName
  } = params;

  let cleanPhone = (to || '').replace(/\D/g, '');
  if (cleanPhone.length === 10) {
    cleanPhone = `91${cleanPhone}`;
  }

  if (!cleanPhone || !NOBOGENT_WABA_PHONE_ID || !NOBOGENT_WABA_TOKEN) {
    console.error('[Nobogent WABA] Missing phone or Nobogent WABA credentials');
    return false;
  }

  const headerPrefix = isFestival
    ? `🎉 *Happy ${festivalName || 'Festive Season'}!*`
    : `🌅 *Daily Marketing Creative Ready:* *${title || 'Today\'s Highlight'}*`;

  // Always use pure marketing copy only - never inject AI summaries, notes, or changelogs
  const fullText = `${headerPrefix}\n\n${caption}`.trim();
  // WhatsApp interactive button body text limit is 1024 characters
  const bodyText = fullText.length > 1000 ? `${fullText.slice(0, 995)}...` : fullText;

  const resolvedAssetId = assetId || 'latest';
  const metaUrl = `https://graph.facebook.com/v20.0/${NOBOGENT_WABA_PHONE_ID}/messages`;

  // 1. Primary: Interactive Button message with image header
  try {
    console.log(`[Nobogent WABA] Dispatching creative with interactive buttons to ${cleanPhone}...`);
    const interactivePayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'interactive',
      interactive: {
        type: 'button',
        header: {
          type: 'image',
          image: {
            link: creativeUrl
          }
        },
        body: {
          text: bodyText
        },
        action: {
          buttons: [
            {
              type: 'reply',
              reply: {
                id: `approve_creative_${resolvedAssetId}`,
                title: 'Approve'
              }
            },
            {
              type: 'reply',
              reply: {
                id: `edit_creative_${resolvedAssetId}`,
                title: 'Edit'
              }
            }
          ]
        }
      }
    };

    const res = await fetch(metaUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOBOGENT_WABA_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(interactivePayload)
    });

    if (res.ok) {
      console.log(`[Nobogent WABA] ✅ Interactive creative message delivered to ${cleanPhone}`);
      return true;
    }

    const errData = await res.json().catch(() => ({}));
    console.warn(`[Nobogent WABA] Interactive with image header failed (${res.status}), trying two-step fallback:`, errData);
  } catch (err: any) {
    console.warn('[Nobogent WABA] Primary interactive send exception:', err?.message);
  }

  // 2. Fallback: Send Image message first, then send interactive button message
  try {
    console.log(`[Nobogent WABA] Executing two-step fallback (Image + Buttons) for ${cleanPhone}...`);
    // Step A: Send Image message with full caption
    const imagePayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'image',
      image: {
        link: creativeUrl,
        caption: bodyText.slice(0, 1024)
      }
    };

    await fetch(metaUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOBOGENT_WABA_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(imagePayload)
    });

    // Step B: Send interactive buttons
    const buttonPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: {
          text: '👇 *Review your daily creative above.*\n\nChoose an option below:'
        },
        action: {
          buttons: [
            {
              type: 'reply',
              reply: {
                id: `approve_creative_${resolvedAssetId}`,
                title: 'Approve'
              }
            },
            {
              type: 'reply',
              reply: {
                id: `edit_creative_${resolvedAssetId}`,
                title: 'Edit'
              }
            }
          ]
        }
      }
    };

    const btnRes = await fetch(metaUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOBOGENT_WABA_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(buttonPayload)
    });

    if (btnRes.ok) {
      console.log(`[Nobogent WABA] ✅ Two-step fallback buttons delivered to ${cleanPhone}`);
      return true;
    }
  } catch (fallbackErr: any) {
    console.error('[Nobogent WABA] Two-step fallback error:', fallbackErr?.message);
  }

  // 3. Last-resort Text Fallback
  try {
    const textRes = await fetch(metaUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOBOGENT_WABA_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhone,
        type: 'text',
        text: {
          body: `${headerPrefix}\n\n🖼️ View Image: ${creativeUrl}\n\n${caption}\n\n💬 *Reply "Approve" to publish live to socials, or "Edit" to revise!*`
        }
      })
    });
    return textRes.ok;
  } catch {
    return false;
  }
}

/**
 * Sends a plain text message strictly from Nobogent WABA
 */
export async function sendNobogentTextMessage(to: string, text: string): Promise<boolean> {
  let cleanPhone = (to || '').replace(/\D/g, '');
  if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;

  if (!cleanPhone || !NOBOGENT_WABA_PHONE_ID || !NOBOGENT_WABA_TOKEN) return false;

  try {
    const metaUrl = `https://graph.facebook.com/v20.0/${NOBOGENT_WABA_PHONE_ID}/messages`;
    const res = await fetch(metaUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOBOGENT_WABA_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhone,
        type: 'text',
        text: { body: text }
      })
    });
    return res.ok;
  } catch (err: any) {
    console.error('[Nobogent WABA] sendNobogentTextMessage failed:', err?.message);
    return false;
  }
}

/**
 * Retrieves the active editing asset for a user if one is currently in 'editing' status.
 */
export async function getActiveEditingAsset(userId: string) {
  try {
    const { data: asset } = await supabaseAdmin
      .from('assets')
      .select('*, properties(id, title, configurations)')
      .eq('user_id', userId)
      .eq('status', 'editing')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return asset || null;
  } catch (err: any) {
    console.error('[Creative Handler] getActiveEditingAsset error:', err?.message);
    return null;
  }
}

/**
 * Handles the "Approve" button click or "Approve" text reply:
 * 1. Finds the creative asset.
 * 2. Checks user's connected socials (Facebook, Instagram, LinkedIn).
 * 3. Posts the image and caption to connected socials.
 * 4. Inserts into posts table.
 * 5. Updates asset status to 'Approved'.
 * 6. Replies with confirmation from Nobogent WABA.
 */
export async function handleCreativeApproval(params: {
  userId: string;
  assetId?: string | null;
  fromPhone: string;
  matchedProfile?: any;
}): Promise<{ success: boolean; message: string }> {
  const { userId, assetId, fromPhone, matchedProfile } = params;

  console.log(`[Creative Approval] Handling approval for user ${userId}, assetId: ${assetId || 'latest'}`);

  // 1. Fetch target asset (by specific ID if provided, otherwise latest pending/draft for user)
  let assetQuery = supabaseAdmin
    .from('assets')
    .select('*, properties(id, title, configurations)');

  if (assetId && assetId !== 'latest') {
    assetQuery = assetQuery.eq('id', assetId);
  } else {
    // Find latest pending or draft asset
    assetQuery = assetQuery
      .eq('user_id', userId)
      .in('status', ['pending_approval', 'editing', 'Draft'])
      .order('created_at', { ascending: false })
      .limit(1);
  }

  const { data: asset, error: assetErr } = await assetQuery.maybeSingle();

  if (assetErr || !asset) {
    // Fallback: check any asset created in last 48 hours
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: fallbackAsset } = await supabaseAdmin
      .from('assets')
      .select('*, properties(id, title, configurations)')
      .eq('user_id', userId)
      .gte('created_at', fortyEightHoursAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!fallbackAsset) {
      const msg = "⚠️ I couldn't find a pending creative to approve. You can generate a new creative anytime from your dashboard!";
      await sendNobogentTextMessage(fromPhone, msg);
      return { success: false, message: msg };
    }
    const resolvedUserId = fallbackAsset.user_id || userId;
    return executeAssetApproval(resolvedUserId, fallbackAsset, fromPhone, matchedProfile);
  }

  const resolvedUserId = asset.user_id || userId;
  return executeAssetApproval(resolvedUserId, asset, fromPhone, matchedProfile);
}

async function executeAssetApproval(
  userId: string,
  asset: any,
  fromPhone: string,
  existingProfile?: any
): Promise<{ success: boolean; message: string }> {
  // Fetch user profile with social connection credentials
  let profile = existingProfile;
  if (!profile || !profile.selected_page_token) {
    const { data: prof } = await supabaseAdmin
      .from('profiles')
      .select('id, business_name, selected_page_token, selected_page_id, selected_page_name, facebook_token, linkedin_token, linkedin_id, linkedin_urn')
      .eq('id', userId)
      .single();
    profile = prof || profile;
  }

  const fbToken = profile?.selected_page_token || profile?.facebook_token;
  const pageId = profile?.selected_page_id;
  const pageName = profile?.selected_page_name || 'Facebook Page';
  const liToken = profile?.linkedin_token;
  const liId = profile?.linkedin_id;
  const liUrn = profile?.linkedin_urn || (liId ? `urn:li:person:${liId}` : null);

  const mediaUrl = asset.url;
  const caption = asset.caption || '';

  const publishedPlatforms: string[] = [];
  const failedPlatforms: string[] = [];

  // A. Post to Facebook Page
  if (fbToken && pageId && mediaUrl) {
    console.log(`[Creative Approval] Posting creative to Facebook Page (${pageId})...`);
    try {
      await postToFacebook(fbToken, mediaUrl, caption, 'image', pageId);
      publishedPlatforms.push(`Facebook Page (${pageName})`);
    } catch (fbErr: any) {
      console.error('[Creative Approval] Facebook posting failed:', fbErr.message);
      failedPlatforms.push(`Facebook: ${fbErr.message}`);
    }
  }

  // B. Post to Instagram Business
  if (fbToken && pageId && mediaUrl) {
    console.log(`[Creative Approval] Posting creative to Instagram...`);
    try {
      await postToInstagram(fbToken, pageId, mediaUrl, caption, 'image');
      publishedPlatforms.push('Instagram');
    } catch (igErr: any) {
      console.error('[Creative Approval] Instagram posting failed:', igErr.message);
      failedPlatforms.push(`Instagram: ${igErr.message}`);
    }
  }

  // C. Post to LinkedIn
  if (liToken && liUrn && mediaUrl) {
    console.log(`[Creative Approval] Posting creative to LinkedIn (${liUrn})...`);
    try {
      await postToLinkedin(liToken, liUrn, mediaUrl, caption, 'image');
      publishedPlatforms.push('LinkedIn');
    } catch (liErr: any) {
      console.error('[Creative Approval] LinkedIn posting failed:', liErr.message);
      failedPlatforms.push(`LinkedIn: ${liErr.message}`);
    }
  }

  // D. Update DB records
  const isPublished = publishedPlatforms.length > 0;

  if (isPublished) {
    // Record in posts table
    try {
      await supabaseAdmin.from('posts').insert({
        user_id: userId,
        title: asset.properties?.title ? `Daily: ${asset.properties.title}` : 'Daily Marketing Creative',
        content: caption,
        image_url: mediaUrl,
        status: 'social_published'
      });
    } catch (postErr: any) {
      console.warn('[Creative Approval] Post insert warning:', postErr.message);
    }
  }

  // Update asset status to Approved
  await supabaseAdmin
    .from('assets')
    .update({
      status: 'Approved',
      metadata: {
        ...(asset.metadata || {}),
        approved_at: new Date().toISOString(),
        published_platforms: publishedPlatforms,
        failed_platforms: failedPlatforms
      }
    })
    .eq('id', asset.id);

  // E. Compose confirmation WhatsApp reply
  let replyText = '';

  if (isPublished) {
    const listBullets = publishedPlatforms.map(p => `• ✅ *${p}*`).join('\n');
    const failNotice = failedPlatforms.length > 0
      ? `\n\n⚠️ *Could not post to:*\n${failedPlatforms.map(f => `• ${f}`).join('\n')}`
      : '';

    replyText = `🎉 *Daily Creative Approved & Published!*

Your marketing graphic and copy have been posted live to:
${listBullets}${failNotice}

📝 *Live Caption:*
"${caption.length > 300 ? caption.slice(0, 297) + '...' : caption}"

───────────────
Keep up the momentum! We'll prepare your next creative update tomorrow morning. 🚀`;
  } else if (failedPlatforms.length > 0) {
    replyText = `⚠️ *Creative Approved, but Social Posting Encountered an Error:*
${failedPlatforms.map(f => `• ${f}`).join('\n')}

Your creative has been approved and saved in your *Asset Library*. You can review or manually share it anytime from your dashboard.`;
  } else {
    // No socials connected
    replyText = `✅ *Daily Creative Approved!*

Your marketing creative has been approved and saved to your *Asset Library*.

ℹ️ *Note:* You don't have any connected social media accounts yet.
To automatically publish approved daily creatives to your Facebook Page, Instagram, or LinkedIn, connect them anytime in *Dashboard ➔ Settings ➔ Integrations*.`;
  }

  await sendNobogentTextMessage(fromPhone, replyText);
  return { success: true, message: replyText };
}

/**
 * Handles the "Edit" button click or "Edit" text reply:
 * Sets the asset status to 'editing' and prompts the user to submit changes via text or voice note.
 */
export async function handleCreativeEditRequest(params: {
  userId: string;
  assetId?: string | null;
  fromPhone: string;
}): Promise<{ success: boolean; message: string }> {
  const { userId, assetId, fromPhone } = params;

  console.log(`[Creative Edit Request] User ${userId} requested edit on assetId: ${assetId || 'latest'}`);

  // Find target asset
  let assetQuery = supabaseAdmin
    .from('assets')
    .select('id, user_id, caption, url, status, metadata, properties(title)');

  if (assetId && assetId !== 'latest') {
    assetQuery = assetQuery.eq('id', assetId);
  } else {
    assetQuery = assetQuery
      .eq('user_id', userId)
      .in('status', ['pending_approval', 'editing', 'Draft', 'Approved'])
      .order('created_at', { ascending: false })
      .limit(1);
  }

  const { data: asset } = await assetQuery.maybeSingle();

  if (asset) {
    // Mark asset as currently being edited
    await supabaseAdmin
      .from('assets')
      .update({
        status: 'editing',
        metadata: {
          ...(asset.metadata || {}),
          edit_requested_at: new Date().toISOString()
        }
      })
      .eq('id', asset.id);
  }

  const promptText = `✏️ *Edit Daily Creative*

Please tell me what changes you'd like to make!
You can:
• 💬 *Type your changes* in this chat
• 🎙️ *Send a voice note*

*You can request:*
• 📝 *Copy changes:* (e.g. *"Change headline to: Festive Special - 10% Off!"* or *"Make it shorter and add our phone number"*)
• 🖼️ *Image changes:* (e.g. *"Show modern evening luxury villa with glowing pool"*)
• ✨ *Both image and copy changes!*

I will regenerate the creative and present it back with the same *Approve* & *Edit* buttons for your review! 🚀`;

  await sendNobogentTextMessage(fromPhone, promptText);
  return { success: true, message: promptText };
}

/**
 * Handles the submission of changes (via text message or transcribed voice note)
 * when an asset is in the 'editing' state:
 * 1. Uses Gemini to analyze whether copy, image, or both need changing.
 * 2. Rewrites the caption if copy change requested.
 * 3. Regenerates the image via Kie/R2 if image change requested.
 * 4. Updates the asset in DB.
 * 5. Presents the updated creative back to the admin with Approve & Edit buttons.
 */
export async function handleCreativeRevisionSubmission(params: {
  userId: string;
  instructionText: string;
  fromPhone: string;
  assetId?: string | null;
}): Promise<{ success: boolean; message: string }> {
  const { userId, instructionText, fromPhone, assetId } = params;

  console.log(`[Creative Revision] Processing revision for user ${userId}. Instructions: "${instructionText.slice(0, 100)}..."`);

  // 1. Locate the asset being edited
  let assetQuery = supabaseAdmin
    .from('assets')
    .select('*, properties(id, title, configurations)');

  if (assetId && assetId !== 'latest') {
    assetQuery = assetQuery.eq('id', assetId);
  } else {
    assetQuery = assetQuery
      .eq('user_id', userId)
      .in('status', ['editing', 'pending_approval', 'Draft'])
      .order('created_at', { ascending: false })
      .limit(1);
  }

  const { data: asset } = await assetQuery.maybeSingle();

  if (!asset) {
    const msg = "I couldn't find an active creative to edit. Tap *Edit* on a creative message first to begin revisions!";
    await sendNobogentTextMessage(fromPhone, msg);
    return { success: false, message: msg };
  }

  // Send quick acknowledgement to user
  await sendNobogentTextMessage(fromPhone, "🤖 Working on your changes... Updating creative & copy! Please wait a moment.");

  const currentCaption = asset.caption || '';
  const currentImageUrl = asset.url || '';
  const propTitle = asset.properties?.title || 'Our Brand';

  // 2. Analyze instruction with Gemini
  let analysis: {
    hasCopyChanges: boolean;
    updatedCaption: string;
    hasImageChanges: boolean;
    imageChangePrompt: string;
    summary: string;
  } = {
    hasCopyChanges: true,
    updatedCaption: currentCaption,
    hasImageChanges: false,
    imageChangePrompt: '',
    summary: 'Updated creative based on your feedback.'
  };

  try {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey);
      const geminiModel = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { responseMimeType: 'application/json' }
      });

      const aiPrompt = `You are an expert marketing creative director and advertising editor.
The business owner has provided revision instructions (which may be in English, Hindi, or Hinglish) for their daily social media marketing creative graphic and copy.

CURRENT POST DETAILS:
- Subject / Brand: "${propTitle}"
- Current Caption: "${currentCaption}"
- Current Creative Image URL: "${currentImageUrl}"

OWNER'S REVISION INSTRUCTION:
"${instructionText}"

CRITICAL RULES:
1. In marketing, "creative" / "image" / "graphic" / "poster" refers to the visual image itself, which includes text, numbers, offers, and headlines rendered ON the graphic (e.g. "1,000 Free AI Calling Minutes", prices, bonuses, discounts).
2. If the owner mentions changing ANY number, headline, offer, bonus, visual element, background, colors, layout, or says "creative mein" / "image mein" / "photo mein" / "graphic mein" / "poster mein" / "in the image" / "in the creative":
   - hasImageChanges MUST be true!
   - Write a detailed image edit prompt instructing the AI image-to-image model to modify the existing visual, explicitly specifying what text/numbers on the poster to replace (e.g. "Modify this marketing ad poster: replace the headline text '1,000 FREE AI Calling Minutes' with '500 FREE AI Calling Minutes', keeping the exact same theme, colors, logo, and layout").
3. hasCopyChanges MUST be true if any copy, caption, headline, offer, number, or call-to-action is updated.
   - Output ONLY the 100% clean, final social media caption incorporating the changes.
   - NEVER include explanations, commentary, or changelogs in updatedCaption (e.g. NEVER say "The caption was updated to reflect..." or "Here is the new caption:"). Provide ONLY the clean social media caption ready to be published live.
4. Provide a concise 1-sentence summary of the changes made for internal audit only.

Return ONLY a JSON object:
{
  "hasCopyChanges": boolean,
  "updatedCaption": "string",
  "hasImageChanges": boolean,
  "imageChangePrompt": "string",
  "summary": "string"
}`;

      const res = await geminiModel.generateContent(aiPrompt);
      const textRes = res.response.text().trim();
      const parsed = JSON.parse(textRes);
      analysis = {
        hasCopyChanges: !!parsed.hasCopyChanges,
        updatedCaption: parsed.updatedCaption || currentCaption,
        hasImageChanges: !!parsed.hasImageChanges,
        imageChangePrompt: parsed.imageChangePrompt || '',
        summary: parsed.summary || 'Applied requested changes.'
      };
    }
  } catch (aiErr: any) {
    console.error('[Creative Revision] Gemini analysis error:', aiErr?.message);
    // Fallback heuristic: check if instructions mention image/photo/look/visual
    const isImageMention = /\b(image|photo|picture|pic|background|look|color|villa|view|design|visual|creative)\b/i.test(instructionText);
    analysis = {
      hasCopyChanges: true,
      updatedCaption: currentCaption,
      hasImageChanges: isImageMention,
      imageChangePrompt: isImageMention ? `${propTitle}, ${instructionText}, professional commercial marketing photography, 4k ultra-detailed` : '',
      summary: 'Updated creative with your instructions.'
    };
  }

  let finalCaption = analysis.hasCopyChanges && analysis.updatedCaption ? analysis.updatedCaption : currentCaption;
  let finalImageUrl = currentImageUrl;

  // 3. If image changes requested, generate new image via Kie AI & upload to R2
  if (analysis.hasImageChanges && analysis.imageChangePrompt) {
    console.log(`[Creative Revision] Generating updated image with prompt: "${analysis.imageChangePrompt.slice(0, 100)}..."`);
    try {
      const selectedModel = currentImageUrl ? "gpt-image-2-5-flare-image-to-image" : "gpt-image-2-5-flare-text-to-image";
      const kiePayload: any = {
        model: selectedModel,
        input: {
          prompt: `${analysis.imageChangePrompt}, clean composition, award-winning commercial advertising quality, no unwanted watermarks`,
          aspect_ratio: "3:4",
          resolution: "1K",
          output_format: "png"
        }
      };

      if (currentImageUrl) {
        kiePayload.input.input_urls = [currentImageUrl];
      }

      const kieTaskRes = await createKieTask(kiePayload);

      if (kieTaskRes?.taskId) {
        const taskId = kieTaskRes.taskId;
        let attempts = 0;
        let generatedKieUrl = '';

        while (attempts < 30) {
          attempts++;
          await new Promise(r => setTimeout(r, 4000));
          const statusRes = await queryKieTask(taskId);

          if (statusRes.state === 'success' && statusRes.resultUrl) {
            generatedKieUrl = statusRes.resultUrl;
            break;
          } else if (statusRes.state === 'fail') {
            console.warn('[Creative Revision] Kie AI image generation failed:', statusRes.error);
            break;
          }
        }

        if (generatedKieUrl) {
          // Download and persist to Cloudflare R2
          console.log(`[Creative Revision] Persisting new image to Cloudflare R2...`);
          const imgFetch = await fetch(generatedKieUrl);
          if (imgFetch.ok) {
            const rawBuffer = Buffer.from(await imgFetch.arrayBuffer());
            let uploadBuffer = rawBuffer;
            let ext = 'jpg';
            let contentType = 'image/jpeg';

            try {
              uploadBuffer = await sharp(rawBuffer)
                .resize({ width: 1200, withoutEnlargement: true })
                .jpeg({ quality: 80, progressive: true })
                .toBuffer() as Buffer<ArrayBuffer>;
            } catch {
              ext = 'png';
              contentType = 'image/png';
            }

            const r2Key = `generated/${userId}/${Date.now()}_revised.${ext}`;
            await r2.send(new PutObjectCommand({
              Bucket: R2_BUCKET,
              Key: r2Key,
              Body: uploadBuffer,
              ContentType: contentType
            }));

            const publicBase = (R2_PUBLIC_URL || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev').replace(/\/$/, '');
            finalImageUrl = `${publicBase}/${r2Key}`;
            console.log(`[Creative Revision] ✅ New image persisted at: ${finalImageUrl}`);
          }
        }
      }
    } catch (imgGenErr: any) {
      console.error('[Creative Revision] Image generation error:', imgGenErr?.message);
    }
  }

  // 4. Update the asset record in the database
  const revisionRecord = {
    instruction: instructionText,
    summary: analysis.summary,
    previous_url: currentImageUrl,
    previous_caption: currentCaption,
    revised_url: finalImageUrl,
    revised_caption: finalCaption,
    created_at: new Date().toISOString()
  };

  const existingRevisions = Array.isArray(asset.metadata?.revisions) ? asset.metadata.revisions : [];

  await supabaseAdmin
    .from('assets')
    .update({
      url: finalImageUrl,
      caption: finalCaption,
      status: 'pending_approval',
      metadata: {
        ...(asset.metadata || {}),
        revisions: [...existingRevisions, revisionRecord],
        last_revised_at: new Date().toISOString()
      }
    })
    .eq('id', asset.id);

  // 5. Present back the updated creative with the SAME TWO BUTTONS: Approve, Edit
  console.log(`[Creative Revision] Presenting revised creative back to ${fromPhone} with Approve/Edit buttons`);
  const success = await sendNobogentCreativeWithButtons({
    to: fromPhone,
    creativeUrl: finalImageUrl,
    caption: finalCaption,
    title: propTitle,
    assetId: asset.id
  });

  return {
    success,
    message: `Updated creative delivered. (Summary: ${analysis.summary})`
  };
}

