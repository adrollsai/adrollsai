import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

const FB_URL = "https://graph.facebook.com/v19.0";

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { campaignId, selectedAssets, leadFormId } = await request.json();
        const { searchParams } = new URL(request.url);
        const impersonateId = searchParams.get('impersonate');

        const { data: myProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
        const isAdminLike = ['super_admin', 'agency', 'admin'].includes(myProfile?.role || '');

        const { data: ownProfile } = await supabase.from('profiles').select('role, parent_id, agency_id').eq('id', user.id).single();
        let targetUserId = user.id;

        if (['admin', 'agent'].includes(ownProfile?.role || '') && (ownProfile?.parent_id || ownProfile?.agency_id)) {
            targetUserId = (ownProfile?.parent_id || ownProfile?.agency_id) as string;
        }

        if (impersonateId && ['super_admin', 'agency', 'admin'].includes(ownProfile?.role || '')) {
            if (ownProfile?.role !== 'super_admin') {
                const { data: subAccount } = await supabase.from('profiles').select('id').eq('id', impersonateId).eq('agency_id', user.id).single();
                if (subAccount) targetUserId = impersonateId;
                else return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 });
            } else {
                targetUserId = impersonateId;
            }
        }
        
        const { data: profile } = await supabase.from('profiles').select('facebook_token, ad_account_id, selected_page_id, custom_domain, logo_url').eq('id', targetUserId).single();
        if (!profile?.facebook_token || !profile?.ad_account_id) {
            console.error("[Push] Profile missing credentials for target user:", targetUserId);
            return NextResponse.json({ error: 'Missing Meta credentials' }, { status: 400 });
        }

        // 1. Get Campaign Objective & First Ad Set
        const campaignRes = await fetch(`${FB_URL}/${campaignId}?fields=objective&access_token=${profile.facebook_token}`);
        const campaignData = await campaignRes.json();
        const objective = campaignData.objective;
        const isLeadGen = objective === 'OUTCOME_LEADS';

        const adSetsRes = await fetch(`${FB_URL}/${campaignId}/adsets?fields=id,destination_type&access_token=${profile.facebook_token}`);
        const adSetsData = await adSetsRes.json();
        const adSet = adSetsData.data?.[0];
        const adSetId = adSet?.id;
        if (!adSetId) return NextResponse.json({ error: 'No Ad Set found in campaign' }, { status: 404 });

        const isWebsiteCampaign = adSet.destination_type === 'WEBSITE';

        // Retrieve existing ads to inherit form and link URL
        let activeLinkUrl = null;
        let activeLeadFormId = leadFormId;
        
        console.log("[Push] Retrieving existing campaign ads to inherit layout properties...");
        const adsRes = await fetch(`${FB_URL}/${campaignId}/ads?fields=creative{id,object_story_spec}&access_token=${profile.facebook_token}&limit=5`);
        const adsData = await adsRes.json();
        
        for (const ad of (adsData.data || [])) {
            const spec = ad.creative?.object_story_spec;
            
            // Try to find a link
            const link = spec?.link_data?.link || 
                         spec?.video_data?.call_to_action?.value?.link ||
                         spec?.link_data?.call_to_action?.value?.link;
            if (!activeLinkUrl && link && typeof link === 'string' && link.startsWith('http')) {
                activeLinkUrl = link;
                console.log("[Push] Inherited Link URL:", activeLinkUrl);
            }
            
            // Try to find a lead form
            if (!isWebsiteCampaign && !activeLeadFormId) {
                const formId = spec?.link_data?.call_to_action?.value?.lead_gen_form_id || 
                             spec?.video_data?.call_to_action?.value?.lead_gen_form_id;
                if (formId) {
                    activeLeadFormId = formId;
                    console.log("[Push] Inherited Lead Form ID:", activeLeadFormId);
                }
            }
        }
        
        const finalLinkUrl = activeLinkUrl || (profile.custom_domain ? `https://${profile.custom_domain}` : 'https://adrolls.in');

        let successCount = 0;

        let globalThumbHash = null;
        const hasVideos = selectedAssets.some((a: any) => a.type === 'video' || (a.image_url || a.url || '').toLowerCase().match(/\.(mp4|mov|avi|wmv)$/));
        
        if (hasVideos) {
            console.log("[Push] Preparing video thumbnail for batch...");
            const thumbSource = profile.logo_url || 
                               selectedAssets.find((a: any) => a.type !== 'video' && !(a.image_url || a.url || '').toLowerCase().match(/\.(mp4|mov|avi|wmv)$/))?.url ||
                               'https://adrolls.in/logo-square.png'; // High-reliability fallback
            
            if (thumbSource) {
                console.log("[Push] Using thumb source:", thumbSource);
                try {
                    const thumbFetch = await fetch(thumbSource);
                    const thumbBlob = await thumbFetch.blob();
                    const thumbData = new FormData();
                    thumbData.append('source', thumbBlob, `thumb_${Date.now()}.png`);
                    thumbData.append('access_token', profile.facebook_token);
                    const thumbRes = await fetch(`${FB_URL}/${profile.ad_account_id}/adimages`, { method: 'POST', body: thumbData });
                    const thumbResult = await thumbRes.json();
                    globalThumbHash = thumbResult.images?.[Object.keys(thumbResult.images)[0]]?.hash;
                    console.log("[Push] Prepared global thumbnail hash:", globalThumbHash);
                } catch (e) {
                    console.error("[Push] Failed to prepare video thumbnail:", e);
                }
            } else {
                console.warn("[Push] No thumb source found (no logo and no images in batch).");
            }
        }

        for (const asset of selectedAssets) {
            const imageUrl = asset.image_url || asset.url;
            const isVideo = asset.type === 'video' || imageUrl.toLowerCase().match(/\.(mp4|mov|avi|wmv)$/);
            
            console.log(`[Push] Processing ${isVideo ? 'video' : 'image'}:`, imageUrl);
            
            let creativeId = null;
            let imgHash = null;
            let videoId = null;

            if (isVideo) {
                // A. Upload Video
                const videoData = new FormData();
                videoData.append('file_url', imageUrl);
                videoData.append('access_token', profile.facebook_token);
                
                const videoRes = await fetch(`${FB_URL}/${profile.ad_account_id}/advideos`, { method: 'POST', body: videoData });
                const videoResult = await videoRes.json();
                videoId = videoResult.id;

                if (!videoId) {
                    console.error("[Push] Video upload failed:", videoResult);
                    continue;
                }
                
                // Wait for video processing (Meta requirement)
                await new Promise(resolve => setTimeout(resolve, 5000));
            } else {
                // A. Upload Image
                const imgFetch = await fetch(imageUrl as string);
                const imgBlob = await imgFetch.blob();
                const uploadData = new FormData();
                uploadData.append('source', imgBlob, `opt_push_${Date.now()}.png`);
                uploadData.append('access_token', profile.facebook_token);
                
                const uploadRes = await fetch(`${FB_URL}/${profile.ad_account_id}/adimages`, { method: 'POST', body: uploadData });
                const uploadResult = await uploadRes.json();
                imgHash = uploadResult.images?.[Object.keys(uploadResult.images)[0]]?.hash;

                if (!imgHash) {
                    console.error("[Push] Image upload failed:", uploadResult);
                    continue;
                }
                // We can also use this as a global thumb hash for future videos in this loop
                if (!globalThumbHash) globalThumbHash = imgHash;
            }

            const isLeadGen = objective === 'OUTCOME_LEADS';
            const headline = asset.headline || asset.name || "Special Offer";
            const primaryText = asset.primary_text || "Contact us today for more details!";
            const description = asset.description || "";

            const creativePayload: any = {
                name: `AI Optimized Variation - ${Date.now()}`,
                access_token: profile.facebook_token,
                object_story_spec: {
                    page_id: profile.selected_page_id,
                }
            };

            const ctaValue: any = {};
            if (isWebsiteCampaign) {
                ctaValue.link = finalLinkUrl;
            } else {
                if (activeLeadFormId) {
                    ctaValue.lead_gen_form_id = activeLeadFormId;
                }
                ctaValue.link = finalLinkUrl;
            }

            if (isVideo) {
                creativePayload.object_story_spec.video_data = {
                    video_id: videoId,
                    message: primaryText,
                    title: headline,
                    image_hash: globalThumbHash, // Meta requires a thumbnail
                    call_to_action: {
                        type: 'LEARN_MORE',
                        value: ctaValue
                    }
                };
            } else {
                creativePayload.object_story_spec.link_data = {
                    image_hash: imgHash,
                    link: finalLinkUrl,
                    message: primaryText,
                    name: headline,
                    description: description,
                    call_to_action: { 
                        type: 'LEARN_MORE',
                        value: ctaValue
                    }
                };
            }

            const creativeRes = await fetch(`${FB_URL}/${profile.ad_account_id}/adcreatives`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(creativePayload)
            });
            const creativeData = await creativeRes.json();

            if (creativeData.id) {
                console.log(`[Push] Creative created:`, creativeData.id);
                const adPayload = {
                    name: `AI Optimized Ad - ${isVideo ? 'Video' : 'Image'} - ${Date.now()}`,
                    adset_id: adSetId,
                    creative: { creative_id: creativeData.id },
                    status: 'ACTIVE',
                    access_token: profile.facebook_token
                };
                const adRes = await fetch(`${FB_URL}/${profile.ad_account_id}/ads`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(adPayload)
                });
                const adData = await adRes.json();
                if (adRes.ok) {
                    console.log(`[Push] Ad created successfully:`, adData.id);
                    successCount++;
                } else {
                    console.error("[Push] Ad creation failed:", adData);
                }
            } else {
                console.error("[Push] Creative creation failed:", creativeData);
            }
        }

        return NextResponse.json({ success: true, pushedCount: successCount });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
