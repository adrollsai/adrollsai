import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

const FB_URL = "https://graph.facebook.com/v19.0";

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { campaignId, selectedAssets, leadFormId } = await request.json();
        
        const { data: profile } = await supabase.from('profiles').select('facebook_token, ad_account_id, selected_page_id, custom_domain').eq('id', user.id).single();
        if (!profile?.facebook_token || !profile?.ad_account_id) {
            console.error("[Push] Profile missing credentials for user:", user.id);
            return NextResponse.json({ error: 'Missing Meta credentials' }, { status: 400 });
        }

        // 1. Get Campaign Objective & First Ad Set
        const campaignRes = await fetch(`${FB_URL}/${campaignId}?fields=objective&access_token=${profile.facebook_token}`);
        const campaignData = await campaignRes.json();
        const objective = campaignData.objective;

        const adSetsRes = await fetch(`${FB_URL}/${campaignId}/adsets?fields=id&access_token=${profile.facebook_token}`);
        const adSetsData = await adSetsRes.json();
        const adSetId = adSetsData.data?.[0]?.id;
        if (!adSetId) return NextResponse.json({ error: 'No Ad Set found in campaign' }, { status: 404 });

        let successCount = 0;

        // 2. Deduplicate images from selected variations
        const uniqueImageUrls = Array.from(new Set(selectedAssets.map((a: any) => (a.image_url || a.url) as string)));
        const allHeadlines = selectedAssets.map((a: any) => a.headline).filter(Boolean);
        const allPrimaryTexts = selectedAssets.map((a: any) => a.primary_text).filter(Boolean);

        for (const imageUrl of uniqueImageUrls) {
            console.log("[Push] Processing image:", imageUrl);
            
            // A. Upload Image
            const imgFetch = await fetch(imageUrl as string);
            const imgBlob = await imgFetch.blob();
            const uploadData = new FormData();
            uploadData.append('source', imgBlob, `opt_push_${Date.now()}.png`);
            uploadData.append('access_token', profile.facebook_token);
            
            const uploadRes = await fetch(`${FB_URL}/${profile.ad_account_id}/adimages`, { method: 'POST', body: uploadData });
            const uploadResult = await uploadRes.json();
            const imgHash = uploadResult.images?.[Object.keys(uploadResult.images)[0]]?.hash;

            if (!imgHash) {
                console.error("[Push] Image upload failed:", uploadResult);
                continue;
            }

            // For Awareness campaigns or standard ad sets, we create individual ads for variations
            // to ensure 100% compatibility and avoid Meta API "unsupported field" errors.
            const isLeadGen = objective === 'OUTCOME_LEADS';
            for (let i = 0; i < allPrimaryTexts.length; i++) {
                const headline = allHeadlines[i] || allHeadlines[0];
                const primaryText = allPrimaryTexts[i] || allPrimaryTexts[0];

                const creativePayload = {
                    name: `AI Optimized Variation ${i + 1} - ${Date.now()}`,
                    object_story_spec: {
                        page_id: profile.selected_page_id,
                        link_data: {
                            image_hash: imgHash,
                            link: profile.custom_domain ? `https://${profile.custom_domain}` : 'https://adrolls.in',
                            message: primaryText,
                            name: headline,
                            call_to_action: { 
                                type: isLeadGen ? 'SIGN_UP' : 'LEARN_MORE',
                                value: isLeadGen ? { lead_gen_form_id: leadFormId } : {}
                            }
                        }
                    },
                    access_token: profile.facebook_token
                };

                const creativeRes = await fetch(`${FB_URL}/${profile.ad_account_id}/adcreatives`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(creativePayload)
                });
                const creativeData = await creativeRes.json();

                if (creativeData.id) {
                    console.log(`[Push] Creative ${i+1} created:`, creativeData.id);
                    const adPayload = {
                        name: `AI Optimized Ad - Var ${i + 1}`,
                        adset_id: adSetId,
                        creative: { creative_id: creativeData.id },
                        status: 'PAUSED',
                        access_token: profile.facebook_token
                    };
                    const adRes = await fetch(`${FB_URL}/${profile.ad_account_id}/ads`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(adPayload)
                    });
                    if (adRes.ok) successCount++;
                }
            }
        }

        return NextResponse.json({ success: true, pushedCount: successCount });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
