import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyCreativeSessionToken } from '@/utils/creative-token';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json({ error: 'Session token is required.' }, { status: 400 });
    }

    const payload = verifyCreativeSessionToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid or expired session token. Please request a new link in WhatsApp.' }, { status: 401 });
    }

    const { userId, campaignId } = payload;

    // Fetch user profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, business_name, email, whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token, facebook_token')
      .eq('id', userId)
      .single();

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found.' }, { status: 404 });
    }

    // Fetch target campaign draft if specified, else latest draft
    let campaign: any = null;
    let currentlySelectedUrls: string[] = [];

    if (campaignId) {
      const { data: job } = await supabaseAdmin
        .from('campaign_jobs')
        .select('id, payload, status, created_at')
        .eq('id', campaignId)
        .eq('user_id', userId)
        .single();
      campaign = job;
    }

    if (!campaign) {
      const { data: latestDraft } = await supabaseAdmin
        .from('campaign_jobs')
        .select('id, payload, status, created_at')
        .eq('user_id', userId)
        .eq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      campaign = latestDraft;
    }

    if (campaign?.payload) {
      currentlySelectedUrls = Array.isArray(campaign.payload.creativeUrls || campaign.payload.creative_urls)
        ? [...(campaign.payload.creativeUrls || campaign.payload.creative_urls)]
        : [];
    }

    // Fetch user creatives from assets table
    const { data: assets } = await supabaseAdmin
      .from('assets')
      .select('id, url, caption, type, status, created_at, kie_task_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    // Also fetch property listing images to ensure no user creatives are missed
    const { data: properties } = await supabaseAdmin
      .from('properties')
      .select('id, title, image_url, images, created_at')
      .eq('user_id', userId);

    const assetUrls = new Set((assets || []).map((a: any) => a.url));
    const formattedCreatives: any[] = (assets || []).map((a: any) => {
      const isVideo = (a.type || '').toLowerCase() === 'video' || a.url.includes('.mp4');
      const isAi = !!a.kie_task_id || (a.caption || '').includes('AI') || a.url.includes('/generated/');

      // Infer aspect ratio from URL or caption if possible
      let aspectRatio = '1:1';
      if (a.url.includes('reel') || (a.caption || '').includes('9:16') || (a.caption || '').includes('Reel') || (a.caption || '').includes('Story')) {
        aspectRatio = '9:16';
      } else if ((a.caption || '').includes('16:9') || (a.caption || '').includes('Landscape')) {
        aspectRatio = '16:9';
      } else if ((a.caption || '').includes('4:5')) {
        aspectRatio = '4:5';
      }

      return {
        id: a.id,
        url: a.url,
        title: a.caption || 'Ad Creative',
        type: isVideo ? 'video' : 'image',
        aspect_ratio: aspectRatio,
        is_ai_generated: isAi,
        created_at: a.created_at
      };
    });

    // Supplement with property flyers/photos if not already present
    (properties || []).forEach((prop: any) => {
      const candidateUrls = [prop.image_url, ...(prop.images || [])].filter(Boolean);
      candidateUrls.forEach((u: string, idx: number) => {
        if (!assetUrls.has(u) && (u.startsWith('http://') || u.startsWith('https://'))) {
          assetUrls.add(u);
          formattedCreatives.push({
            id: `prop_${prop.id}_${idx}`,
            url: u,
            title: prop.title || 'Property Creative',
            type: u.includes('.mp4') ? 'video' : 'image',
            aspect_ratio: '1:1',
            is_ai_generated: false,
            created_at: prop.created_at || new Date().toISOString()
          });
        }
      });
    });

    return NextResponse.json({
      success: true,
      profile: {
        id: profile.id,
        business_name: profile.business_name || 'Nobogent Workspace'
      },
      campaign: campaign ? {
        id: campaign.id,
        name: campaign.payload?.campaign_name || 'Campaign Draft',
        daily_budget: campaign.payload?.daily_budget || campaign.payload?.dailyBudget || 1500,
        target_locations: campaign.payload?.target_locations || campaign.payload?.metaLocationsStr || 'Delhi NCR',
        status: campaign.status
      } : null,
      selectedUrls: currentlySelectedUrls,
      creatives: formattedCreatives
    });
  } catch (error: any) {
    console.error('❌ [picker-session GET] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token, selectedUrls } = body;

    if (!token) {
      return NextResponse.json({ error: 'Session token is required.' }, { status: 400 });
    }

    if (!Array.isArray(selectedUrls)) {
      return NextResponse.json({ error: 'selectedUrls must be an array of image/video URLs.' }, { status: 400 });
    }

    const payload = verifyCreativeSessionToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Session expired or invalid.' }, { status: 401 });
    }

    const { userId, campaignId, phone } = payload;

    // Fetch user profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, business_name, whatsapp_personal_number, whatsapp_phone_number_id, whatsapp_access_token, facebook_token')
      .eq('id', userId)
      .single();

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
    }

    // Find campaign draft
    let targetJobId = campaignId;
    if (!targetJobId) {
      const { data: latestDraft } = await supabaseAdmin
        .from('campaign_jobs')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestDraft) targetJobId = latestDraft.id;
    }

    if (!targetJobId) {
      return NextResponse.json({ error: 'No active campaign draft found to attach creatives to.' }, { status: 404 });
    }

    const { data: existingJob } = await supabaseAdmin
      .from('campaign_jobs')
      .select('*')
      .eq('id', targetJobId)
      .single();

    if (!existingJob) {
      return NextResponse.json({ error: 'Campaign draft not found.' }, { status: 404 });
    }

    const jobPayload = existingJob.payload || {};
    const updatedPayload = {
      ...jobPayload,
      creative_urls: selectedUrls,
      creativeUrls: selectedUrls
    };

    const { error: updateErr } = await supabaseAdmin
      .from('campaign_jobs')
      .update({
        payload: updatedPayload,
        updated_at: new Date().toISOString()
      })
      .eq('id', targetJobId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    console.log(`✅ [picker-session POST] Attached ${selectedUrls.length} creatives to campaign ${targetJobId}`);

    // Dispatch WhatsApp confirmation message to user's WhatsApp
    const recipientPhone = (phone || profile.whatsapp_personal_number || '').replace(/\D/g, '');
    const waToken = profile.whatsapp_access_token || profile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;
    const waPhoneId = profile.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID;

    if (recipientPhone && waToken && waPhoneId) {
      try {
        const campaignName = jobPayload.campaign_name || 'Meta Ad Campaign';
        const budget = jobPayload.daily_budget || jobPayload.dailyBudget || 1500;
        const targetCity = Array.isArray(jobPayload.target_locations) 
          ? jobPayload.target_locations.join(', ') 
          : (jobPayload.target_locations || 'Delhi NCR');

        const messageText = `✅ *${selectedUrls.length} Creative(s) Successfully Attached!*\n\n` +
          `Your campaign draft has been updated with your visual selection:\n` +
          `• *Campaign:* ${campaignName}\n` +
          `• *Daily Budget:* ₹${Number(budget).toLocaleString('en-IN')}\n` +
          `• *Targeting:* ${targetCity}\n` +
          `• *Creatives:* ${selectedUrls.length} attached\n\n` +
          `🚀 Everything is configured and ready. Reply *"Launch"* or *"Confirm"* whenever you'd like to publish live to Meta Ads Manager!`;

        await fetch(`https://graph.facebook.com/v20.0/${waPhoneId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${waToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipientPhone,
            type: 'text',
            text: { body: messageText }
          })
        });
        console.log(`📲 Dispatched WhatsApp confirmation message to ${recipientPhone}`);
      } catch (waErr) {
        console.error('Failed to dispatch WhatsApp confirmation message:', waErr);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Successfully attached ${selectedUrls.length} creatives to your campaign draft.`,
      campaign_id: targetJobId,
      selected_count: selectedUrls.length
    });
  } catch (error: any) {
    console.error('❌ [picker-session POST] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
