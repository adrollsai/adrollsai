import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

const FB_URL = "https://graph.facebook.com/v19.0";

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { campaignId, selectedAssets, leadFormId } = await request.json();
        
        const { data: profile } = await supabase.from('profiles').select('facebook_token, ad_account_id, fb_page_id, business_url').eq('id', user.id).single();
        if (!profile?.facebook_token || !profile?.ad_account_id) {
            return NextResponse.json({ error: 'Missing Meta credentials' }, { status: 400 });
        }

        // 1. Get First Ad Set
        const adSetsRes = await fetch(`${FB_URL}/${campaignId}/adsets?fields=id&access_token=${profile.facebook_token}`);
        const adSetsData = await adSetsRes.json();
        const adSetId = adSetsData.data?.[0]?.id;
        if (!adSetId) return NextResponse.json({ error: 'No Ad Set found in campaign' }, { status: 404 });

        let successCount = 0;

        for (const asset of selectedAssets) {
            // A. Upload Image to Meta (Asset URL to Hash)
            const imgFetch = await fetch(asset.url);
            const imgBlob = await imgFetch.blob();
            const uploadData = new FormData();
            uploadData.append('source', imgBlob, `opt_push_${Date.now()}.png`);
            uploadData.append('access_token', profile.facebook_token);
            
            const uploadRes = await fetch(`${FB_URL}/${profile.ad_account_id}/adimages`, { method: 'POST', body: uploadData });
            const uploadResult = await uploadRes.json();
            const imgHash = uploadResult.images?.[Object.keys(uploadResult.images)[0]]?.hash;

            if (!imgHash) continue;

            // B. Create Creative
            const [headline, ...rest] = (asset.caption || '').split('\n\n');
            const primaryText = rest.join('\n\n') || headline;

            const creativePayload = {
                name: `AI Push - ${asset.id}`,
                object_story_spec: {
                    page_id: profile.fb_page_id,
                    link_data: {
                        message: primaryText,
                        name: headline,
                        link: profile.business_url || 'https://adrolls.in',
                        image_hash: imgHash,
                        call_to_action: { type: 'SIGN_UP', value: { lead_gen_form_id: leadFormId } }
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
                // C. Create Ad
                const adPayload = {
                    name: `AI Optimized Variation - ${Date.now()}`,
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

        return NextResponse.json({ success: true, pushedCount: successCount });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
