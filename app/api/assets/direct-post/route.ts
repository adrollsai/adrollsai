import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';

export const maxDuration = 300; 
export const runtime = 'nodejs';

// Increase body size limit for video uploads
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '50mb',
        },
    },
};

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const formData = await req.formData();
        const file = formData.get('file') as File;
        const caption = formData.get('caption') as string;
        const platforms = JSON.parse(formData.get('platforms') as string || '["facebook"]');

        if (!file || !caption) return NextResponse.json({ error: 'Missing file or caption' }, { status: 400 });

        const { data: profile } = await supabase.from('profiles').select('selected_page_token, fb_page_id, ig_business_id').eq('id', user.id).single();
        if (!profile?.selected_page_token || !profile?.fb_page_id) {
            return NextResponse.json({ error: 'Meta Page ID or Access Token missing.' }, { status: 400 });
        }

        const results: any = {};
        const isVideo = file.type.startsWith('video');

        // 1. Post to Facebook
        if (platforms.includes('facebook')) {
            const fbFormData = new FormData();
            fbFormData.append('access_token', profile.selected_page_token);
            fbFormData.append('message', caption);
            fbFormData.append('source', file);

            const endpoint = isVideo 
                ? `https://graph-video.facebook.com/v19.0/${profile.fb_page_id}/videos`
                : `https://graph.facebook.com/v19.0/${profile.fb_page_id}/photos`;

            const res = await fetch(endpoint, { method: 'POST', body: fbFormData });
            results.facebook = await res.json();
        }

        // 2. Post to Instagram (Requires public URL)
        if (platforms.includes('instagram')) {
            if (!profile.ig_business_id) {
                results.instagram = { error: "No Instagram Business account linked." };
            } else {
                // Upload to R2 temporarily
                const tempKey = `temp/direct-post/${Date.now()}-${file.name.replace(/\s/g, '_')}`;
                const buffer = Buffer.from(await file.arrayBuffer());
                
                await r2.send(new PutObjectCommand({
                    Bucket: R2_BUCKET,
                    Key: tempKey,
                    Body: buffer,
                    ContentType: file.type
                }));

                const tempUrl = `${R2_PUBLIC_URL}/${tempKey}`;

                // Create Container
                const containerRes = await fetch(`https://graph.facebook.com/v19.0/${profile.ig_business_id}/media`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        access_token: profile.selected_page_token,
                        [isVideo ? 'video_url' : 'image_url']: tempUrl,
                        caption: caption,
                        media_type: isVideo ? 'VIDEO' : 'IMAGE'
                    })
                });
                const containerData = await containerRes.json();

                if (containerData.id) {
                    // Poll for video readiness or just try to publish for images
                    if (isVideo) await new Promise(resolve => setTimeout(resolve, 5000));

                    const publishRes = await fetch(`https://graph.facebook.com/v19.0/${profile.ig_business_id}/media_publish`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            access_token: profile.selected_page_token,
                            creation_id: containerData.id
                        })
                    });
                    results.instagram = await publishRes.json();
                } else {
                    results.instagram = containerData;
                }
            }
        }

        return NextResponse.json({ success: true, results });

    } catch (error: any) {
        console.error("Direct Post Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
