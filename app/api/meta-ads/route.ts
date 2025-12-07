// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/api/meta-ads/route.ts (New File)

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

// Base URL for Marketing API
const FB_MARKETING_URL = "https://graph.facebook.com/v19.0" 

export async function POST(request: Request) {
    const supabase = await createClient()
    
    // 1. Auth Check
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { accessToken, pageId, adAccountId, creative, campaignConfig } = await request.json()

    if (!accessToken || !adAccountId) {
        return NextResponse.json({ error: 'Missing access token or ad account ID' }, { status: 400 })
    }

    try {
        // --- Step A: Create Ad Creative (Image/Video + Text) ---
        // This assumes you send a creative object with image_url (for uploaded assets) 
        // OR a URL (for assets previously stored on Supabase/Kie.ai)
        
        // 1. Upload Image to Facebook if using an external URL (from Assets tab)
        let creativePhotoId = '';
        if (creative.imageUrl) {
            const uploadRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/adimages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: creative.imageUrl,
                    access_token: accessToken,
                }),
            });
            const uploadData = await uploadRes.json();
            if (!uploadRes.ok || !uploadData.images) {
                throw new Error("Failed to upload image to Facebook: " + uploadData.error?.message);
            }
            // Get the hash of the uploaded image
            const imageHash = Object.keys(uploadData.images)[0];
            creativePhotoId = uploadData.images[imageHash].hash;
        }

        // 2. Create the Ad Creative
        const creativePayload = {
            name: creative.name || 'AdRolls AI Creative',
            object_story_spec: {
                page_id: pageId, // Use the linked page ID
                instagram_actor_id: creative.instagramAccountId, // If Instagram is used
                link_data: {
                    message: creative.primaryText,
                    link: creative.linkUrl,
                    image_hash: creativePhotoId, // Use the uploaded image hash
                    call_to_action: {
                        type: creative.ctaType || 'LEARN_MORE',
                        value: { link: creative.linkUrl }
                    }
                }
            },
            access_token: accessToken,
        };

        const creativeRes = await fetch(`${FB_MARKETING_URL}/adcreatives`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(creativePayload),
        });
        const creativeData = await creativeRes.json();
        if (!creativeRes.ok) {
            throw new Error("Failed to create Ad Creative: " + creativeData.error?.message);
        }
        const creativeId = creativeData.id;


        // --- Step B: Create Campaign (Simplification) ---
        // For a full implementation, this should be broken down into campaign, adset, and ad creation.
        // Simplified flow: Create Ad, which can inherit/create its own campaign/adset for simplicity here.

        // Placeholder for a full ad submission using the creative ID
        return NextResponse.json({ 
            success: true, 
            creativeId: creativeId,
            message: "Ad Creative successfully created on Facebook."
        })

    } catch (error: any) {
        console.error("Meta Ads API CRASH:", error.message)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}