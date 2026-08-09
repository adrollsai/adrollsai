import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

const FB_URL = "https://graph.facebook.com/v19.0";

function normalizePublicR2Url(url: string): string {
    if (!url) return '';
    let target = url;
    if (target.includes('/api/fetch-image?url=')) {
        try {
            const decoded = decodeURIComponent(target.split('/api/fetch-image?url=')[1]);
            if (decoded && decoded.startsWith('http')) {
                target = decoded;
            }
        } catch (e) {}
    }
    return target;
}

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

        const { data: ownProfile } = await supabase.from('profiles').select('role, facebook_token, parent_id, agency_id').eq('id', user.id).single();
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
        
        let { data: profile } = await supabase.from('profiles').select('facebook_token, ad_account_id, selected_page_id, custom_domain, logo_url, agency_id, parent_id').eq('id', targetUserId).single();
        
        let token = profile?.facebook_token;
        if (!token) {
            token = ownProfile?.facebook_token;
        }

        if (!token && (ownProfile?.agency_id || ownProfile?.parent_id)) {
            const { data: parentProfile } = await supabase
                .from('profiles')
                .select('facebook_token')
                .eq('id', ownProfile.agency_id || ownProfile.parent_id)
                .single();
            token = parentProfile?.facebook_token;
        }

        if (profile) {
            profile.facebook_token = token || null;
        }

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
        let inheritedTrackingSpecs = null;
        let inheritedUrlTags = null;
        
        console.log("[Push] Retrieving existing campaign ads to inherit layout properties...");
        const adsRes = await fetch(`${FB_URL}/${campaignId}/ads?fields=creative{id,object_story_spec,url_tags},tracking_specs&access_token=${profile.facebook_token}&limit=5`);
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

            // Try to find tracking specs
            if (!inheritedTrackingSpecs && ad.tracking_specs) {
                inheritedTrackingSpecs = ad.tracking_specs;
                console.log("[Push] Inherited tracking specs:", JSON.stringify(inheritedTrackingSpecs));
            }

            // Try to find URL tags
            if (!inheritedUrlTags && ad.creative?.url_tags) {
                inheritedUrlTags = ad.creative.url_tags;
                console.log("[Push] Inherited URL tags:", inheritedUrlTags);
            }
        }
        
        const finalLinkUrl = activeLinkUrl || (profile.custom_domain ? `https://${profile.custom_domain}` : 'https://adrolls.in');

        let successCount = 0;

        let globalThumbHash: string | null = null;
        const hasVideos = selectedAssets.some((a: any) => a.type === 'video' || (a.image_url || a.url || a.videoSourceUrl || '').toLowerCase().match(/\.(mp4|mov|avi|wmv)$/));
        
        if (hasVideos) {
            console.log("[Push] Preparing video thumbnail for batch...");
            const rawThumb = profile.logo_url || 
                             selectedAssets.find((a: any) => a.type !== 'video' && !(a.image_url || a.url || a.videoSourceUrl || '').toLowerCase().match(/\.(mp4|mov|avi|wmv)$/))?.url ||
                             'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/2f62a259-f23b-48ee-a920-c436f36eaa4b/1778143153926.png';
            
            if (rawThumb) {
                const cleanThumbUrl = normalizePublicR2Url(rawThumb);
                console.log("[Push] Using normalized thumb source:", cleanThumbUrl);
                try {
                    const thumbFetch = await fetch(cleanThumbUrl);
                    if (thumbFetch.ok) {
                        const thumbBlob = await thumbFetch.blob();
                        const thumbData = new FormData();
                        thumbData.append('source', thumbBlob, `thumb_${Date.now()}.png`);
                        thumbData.append('access_token', profile.facebook_token);
                        const thumbRes = await fetch(`${FB_URL}/${profile.ad_account_id}/adimages`, { method: 'POST', body: thumbData });
                        const thumbResult = await thumbRes.json();
                        globalThumbHash = thumbResult.images?.[Object.keys(thumbResult.images)[0]]?.hash || null;
                        console.log("[Push] Prepared global thumbnail hash:", globalThumbHash);
                    }
                } catch (e) {
                    console.error("[Push] Failed to prepare video thumbnail:", e);
                }
            }
        }

        for (const asset of selectedAssets) {
            let rawUrl = asset.image_url || asset.url || asset.previewUrl || asset.videoSourceUrl || "";
            let imageUrl = normalizePublicR2Url(rawUrl);

            const isVideo = asset.type === 'video' || (typeof imageUrl === 'string' && imageUrl.toLowerCase().match(/\.(mp4|mov|avi|wmv)/));
            
            console.log(`[Push] Processing ${isVideo ? 'video' : 'image'}:`, imageUrl);
            
            let creativeId = null;
            let imgHash = null;
            let videoId = null;

            if (isVideo) {
                let uploadError: any = null;

                // 1. Try uploading to Meta via URL-encoded file_url
                if (imageUrl && imageUrl.startsWith('http')) {
                    try {
                        console.log(`[Push] Uploading video via Meta file_url (URL-encoded): ${imageUrl}`);
                        const params = new URLSearchParams();
                        params.append('file_url', imageUrl);
                        params.append('access_token', profile.facebook_token);

                        const videoRes = await fetch(`${FB_URL}/${profile.ad_account_id}/advideos`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                            body: params.toString()
                        });
                        
                        const resText = await videoRes.text();
                        console.log(`[Push] Meta file_url response status: ${videoRes.status}`);
                        
                        let videoResult: any = {};
                        try {
                            videoResult = JSON.parse(resText);
                        } catch (parseErr) {
                            throw new Error(`Failed to parse Meta response (Status ${videoRes.status}): ${resText.substring(0, 500)}`);
                        }
                        
                        if (videoResult.id) {
                            videoId = videoResult.id;
                            console.log(`[Push] Successfully uploaded video via file_url. Meta ID: ${videoId}`);
                        } else {
                            uploadError = videoResult.error || { message: `file_url upload failed (Status ${videoRes.status}): ${resText}` };
                            console.error(`[Push] Meta file_url upload failed:`, uploadError);
                        }
                    } catch (e: any) {
                        uploadError = { message: e.message };
                        console.error(`[Push] Error uploading video via file_url: ${e.message}`);
                    }
                }

                // 2. Fallback to downloading video and doing a binary upload if file_url failed
                if (!videoId && imageUrl && imageUrl.startsWith('http')) {
                    try {
                        console.log(`[Push] Falling back to downloading video for binary upload: ${imageUrl}`);
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout

                        const videoFetch = await fetch(imageUrl, { signal: controller.signal });
                        if (!videoFetch.ok) {
                            throw new Error(`Failed to fetch video file: ${videoFetch.statusText}`);
                        }
                        const videoBlob = await videoFetch.blob();
                        clearTimeout(timeoutId);

                        const videoData = new FormData();
                        videoData.append('source', videoBlob, 'video.mp4');
                        videoData.append('access_token', profile.facebook_token);

                        const videoRes = await fetch(`${FB_URL}/${profile.ad_account_id}/advideos`, { method: 'POST', body: videoData });
                        const resText = await videoRes.text();
                        console.log(`[Push] Meta binary fallback response status: ${videoRes.status}`);
                        
                        let videoResult: any = {};
                        try {
                            videoResult = JSON.parse(resText);
                        } catch (parseErr) {
                            throw new Error(`Failed to parse Meta binary response (Status ${videoRes.status}): ${resText.substring(0, 500)}`);
                        }
                        
                        if (videoResult.id) {
                            videoId = videoResult.id;
                            console.log(`[Push] Successfully uploaded video via binary fallback. Meta ID: ${videoId}`);
                        } else {
                            uploadError = videoResult.error || { message: `Binary fallback upload failed (Status ${videoRes.status}): ${resText}` };
                            console.error(`[Push] Binary fallback upload failed:`, uploadError);
                        }
                    } catch (e: any) {
                        uploadError = { message: e.message };
                        console.error(`[Push] Error during binary video upload fallback: ${e.message}`);
                    }
                }

                if (!videoId) {
                    console.error("[Push] Video upload failed completely:", uploadError || "Unknown error");
                    continue;
                }
                
                // Wait for video processing (Meta requirement)
                await new Promise(resolve => setTimeout(resolve, 3000));
            } else {
                // Upload Image
                const cleanImgUrl = normalizePublicR2Url(imageUrl);
                const imgFetch = await fetch(cleanImgUrl);
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
            if (inheritedUrlTags) {
                creativePayload.url_tags = inheritedUrlTags;
            }

            const ctaValue: any = {};
            if (isWebsiteCampaign) {
                ctaValue.link = finalLinkUrl;
            } else {
                if (activeLeadFormId) {
                    ctaValue.lead_gen_form_id = activeLeadFormId;
                }
                ctaValue.link = finalLinkUrl;
            }

            const isWhatsApp = adSet.destination_type === 'WHATSAPP';
            const ctaType = isWhatsApp ? 'WHATSAPP_MESSAGE' : 'LEARN_MORE';
            const videoCtaValue = isWhatsApp ? { app_destination: 'WHATSAPP' } : ctaValue;

            if (isVideo) {
                // Ensure video thumbnail hash is provided
                let itemThumbHash = globalThumbHash;
                if (!itemThumbHash) {
                    let rawItemThumb = asset.thumbnailUrl || asset.metadata?.thumbnailUrl || asset.poster || profile.logo_url || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/2f62a259-f23b-48ee-a920-c436f36eaa4b/1778143153926.png';
                    const itemThumbUrl = normalizePublicR2Url(rawItemThumb);
                    try {
                        const tFetch = await fetch(itemThumbUrl);
                        if (tFetch.ok) {
                            const tBlob = await tFetch.blob();
                            const tData = new FormData();
                            tData.append('source', tBlob, `vthumb_${Date.now()}.png`);
                            tData.append('access_token', profile.facebook_token);
                            const tRes = await fetch(`${FB_URL}/${profile.ad_account_id}/adimages`, { method: 'POST', body: tData });
                            const tJson = await tRes.json();
                            itemThumbHash = tJson.images?.[Object.keys(tJson.images)[0]]?.hash || null;
                        }
                    } catch (tErr) {
                        console.error("[Push] Failed to upload video item thumbnail:", tErr);
                    }
                }

                creativePayload.object_story_spec.video_data = {
                    video_id: videoId,
                    message: primaryText,
                    title: headline,
                    image_hash: itemThumbHash || globalThumbHash,
                    call_to_action: {
                        type: ctaType,
                        value: videoCtaValue
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
                const adPayload: any = {
                    name: `AI Optimized Ad - ${isVideo ? 'Video' : 'Image'} - ${Date.now()}`,
                    adset_id: adSetId,
                    creative: { creative_id: creativeData.id },
                    status: 'ACTIVE',
                    access_token: profile.facebook_token
                };
                if (inheritedTrackingSpecs) {
                    adPayload.tracking_specs = inheritedTrackingSpecs;
                }
                const adRes = await fetch(`${FB_URL}/${profile.ad_account_id}/ads`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(adPayload)
                });
                const adData = await adRes.json();
                if (adRes.ok) {
                    console.log(`[Push] Ad created successfully:`, adData.id);
                    successCount++;

                    // Link asset to campaign in Supabase database so it displays in Nobogent account
                    try {
                        const targetAssetId = asset.id || asset.asset_id;
                        if (targetAssetId) {
                            await supabase.from('assets').update({
                                master_creative_id: campaignId,
                                status: 'Active',
                                caption: headline || primaryText || null
                            }).eq('id', targetAssetId);
                        } else {
                            await supabase.from('assets').insert({
                                user_id: targetUserId,
                                master_creative_id: campaignId,
                                type: isVideo ? 'video' : 'image',
                                url: imageUrl,
                                status: 'Active',
                                caption: headline || primaryText || null,
                                metadata: {
                                    meta_ad_id: adData.id,
                                    meta_creative_id: creativeData.id,
                                    thumbnailUrl: asset.thumbnailUrl || asset.metadata?.thumbnailUrl || null,
                                    headline,
                                    primary_text: primaryText
                                }
                            });
                        }
                    } catch (dbErr) {
                        console.error("[Push] Failed to link asset to campaign in DB:", dbErr);
                    }
                } else {
                    console.error("[Push] Ad creation failed:", adData);
                }
            } else {
                console.error("[Push] Creative creation failed:", creativeData);
            }
        }

        if (successCount === 0) {
            return NextResponse.json({
                success: false,
                error: 'Failed to create video ads on Meta. Please check video file format and Meta ad account permissions.'
            }, { status: 400 });
        }

        return NextResponse.json({ success: true, pushedCount: successCount });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
