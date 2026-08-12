import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { renderMediaOnLambda } from '@remotion/lambda';
import { speculateFunctionName } from '@remotion/lambda-client';

export async function POST(request: Request) {
    let creditsDeductedSuccess = false;
    let userId = '';
    try {
        const mockUserHeader = request.headers.get('X-Mock-User');
        if (mockUserHeader && !process.env.VERCEL) {
            userId = mockUserHeader;
        } else {
            const supabase = await createClient();
            const { data: { user } } = await supabase.auth.getUser();

            if (!user) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
            userId = user.id;
        }

        const { assetId, videoUrl, captions, effects: clientEffects, theme, durationInFrames } = await request.json();

        if (!assetId || !videoUrl || !captions || !theme) {
            return NextResponse.json({ error: 'Missing required parameters: assetId, videoUrl, captions, and theme are required.' }, { status: 400 });
        }

        // Create Supabase Admin client to manage credits
        const { createClient: createAdminClient } = await import('@supabase/supabase-js');
        const supabaseAdmin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // --- CREDITS CHECK & DEDUCTION ---
        const { hasEnoughCredits, deductCredits, addCredits } = await import('@/utils/credits');
        const hasCredits = await hasEnoughCredits(supabaseAdmin, userId, 20);
        if (!hasCredits) {
            return NextResponse.json({ error: 'Insufficient credits. You need at least 20 Nobo Credits to render this video.' }, { status: 402 });
        }

        const creditsDeducted = await deductCredits(
            supabaseAdmin,
            userId,
            20,
            'ai_generation',
            `AI Video Render - Editing video asset ${assetId}`
        );
        if (!creditsDeducted) {
            return NextResponse.json({ error: 'Failed to process credit deduction.' }, { status: 500 });
        }
        creditsDeductedSuccess = true;

        // 1. Retrieve original asset context details using supabaseAdmin
        const { data: originalAsset, error: fetchErr } = await supabaseAdmin
            .from('assets')
            .select('*')
            .eq('id', assetId)
            .single();

        if (fetchErr || !originalAsset) {
            return NextResponse.json({ error: 'Original video asset not found.' }, { status: 404 });
        }

        // 1.5. Create a NEW Asset placeholder in Supabase for the rendered video,
        // using supabaseAdmin so impersonation and admin actions bypass user_id RLS checks
        const { data: newAsset, error: newAssetError } = await supabaseAdmin
            .from('assets')
            .insert({
                user_id: originalAsset.user_id,
                property_id: originalAsset.property_id || null,
                type: 'video',
                status: 'Rendering',
                url: originalAsset.url, // Point temporarily to original source video URL
                caption: `${originalAsset.caption || ''} (AI Edited)`
            })
            .select()
            .single();

        if (newAssetError || !newAsset) {
            return NextResponse.json({ error: `Failed to initialize edited asset placeholder: ${newAssetError?.message}` }, { status: 500 });
        }

        console.log(`[Render Route] Preparing rendering delegation. Original: ${assetId}, New: ${newAsset.id}`);

        // 2. Retrieve User Profile Details for the Outro screen (respecting asset owner / impersonation)
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', originalAsset.user_id)
            .single();

        // 3. Retrieve Visual Effects (fallback to client effects or db metadata)
        let effects = clientEffects || [];
        if (!effects || effects.length === 0) {
            if (originalAsset?.metadata?.effects) {
                effects = originalAsset.metadata.effects;
            }
        }

        // 4. Send Asynchronous Render Request to AWS Lambda
        console.log(`[Render Route] Dispatching payload to AWS Lambda...`);

        try {
            const forwardedHost = request.headers.get('x-forwarded-host');
            const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
            const requestOrigin = new URL(request.url).origin;
            const publicUrl = process.env.NEXT_PUBLIC_APP_URL;
            let baseUrl = requestOrigin;
            
            if (forwardedHost && !forwardedHost.includes('localhost') && !forwardedHost.includes('local.')) {
                baseUrl = `${forwardedProto}://${forwardedHost}`;
            } else if (!requestOrigin.includes('localhost') && !requestOrigin.includes('local.')) {
                baseUrl = requestOrigin;
            } else if (publicUrl && publicUrl.startsWith('http') && !publicUrl.includes('localhost') && !publicUrl.includes('local.')) {
                baseUrl = publicUrl;
            } else {
                baseUrl = 'https://app.nobogent.com';
            }
            
            const callbackUrl = `${baseUrl.replace(/\/$/, '')}/api/video/render/callback`;
            console.log(`[Render Route] Using callback URL: ${callbackUrl}`);

            const functionName = speculateFunctionName({
                diskSizeInMb: 512,
                memorySizeInMb: 2048,
                timeoutInSeconds: 900,
            });

            const bucketName = process.env.REMOTION_AWS_BUCKET_NAME || 'remotionlambda-useast1-k8ta4ch4gl';
            const siteName = process.env.REMOTION_AWS_SITE_NAME || 'nobogent-site';
            const region = (process.env.REMOTION_AWS_REGION || 'us-east-1') as any;

            // Use 300+ frames per Lambda (max 3 Lambdas total) to prevent Chromium remote video seeking stalls at chunk boundaries
            const totalFrames = durationInFrames ? Number(durationInFrames) : 900;
            const maxLambdas = 3;
            const framesPerLambda = Math.max(300, Math.ceil(totalFrames / maxLambdas));

            let cleanVideoUrl = videoUrl;
            if (videoUrl.includes('/api/fetch-image?url=')) {
                try {
                    const parsed = new URL(videoUrl, 'https://app.nobogent.com');
                    const extracted = parsed.searchParams.get('url');
                    if (extracted && extracted.startsWith('http')) {
                        cleanVideoUrl = extracted;
                    }
                } catch (e) {}
            }

            // Strip redundant /adrolls-storage/ prefix from R2 public domain URLs (r2.dev mounts bucket root directly)
            const audioUrlCandidate = originalAsset?.metadata?.audioUrl || originalAsset?.voiceover_url || originalAsset?.audio_url;
            let cleanAudioUrl = audioUrlCandidate;
            if (cleanAudioUrl && typeof cleanAudioUrl === 'string' && cleanAudioUrl.includes('r2.dev/adrolls-storage/')) {
                cleanAudioUrl = cleanAudioUrl.replace('r2.dev/adrolls-storage/', 'r2.dev/');
            }

            console.log(`[Render Route] Dispatching render for video URL: ${cleanVideoUrl}, audio URL: ${cleanAudioUrl}`);

            const renderResult = await renderMediaOnLambda({
                region,
                functionName,
                serveUrl: `https://${bucketName}.s3.${region}.amazonaws.com/sites/${siteName}/index.html`,
                composition: 'CaptionsComposition',
                inputProps: {
                    videoUrl: cleanVideoUrl,
                    ...(cleanAudioUrl ? { audioUrl: cleanAudioUrl } : {}),
                    captions,
                    effects,
                    theme,
                    profile: profile || {}
                },
                codec: 'h264',
                imageFormat: 'jpeg',
                maxRetries: 5,
                privacy: 'public',
                framesPerLambda,
                forceDurationInFrames: durationInFrames ? Number(durationInFrames) : undefined,
                webhook: {
                    url: callbackUrl,
                    secret: null,
                    customData: {
                        assetId: newAsset.id
                    }
                }
            });

            console.log(`[Render Route] Successfully delegated render to AWS Lambda:`, renderResult);

            return NextResponse.json({
                success: true,
                message: "Render successfully dispatched to cloud backend.",
                renderId: renderResult.renderId
            });

        } catch (workerError: any) {
            console.error(`[Render Route] AWS Lambda delegation failed:`, workerError);

            // Revert new asset status back to 'Failed'
            await supabaseAdmin
                .from('assets')
                .update({ status: 'Failed' })
                .eq('id', newAsset.id);

            // Refund credits
            try {
                await addCredits(supabaseAdmin, userId, 20, 'ai_generation', `Refund: AWS Lambda delegation failed for video render`);
                creditsDeductedSuccess = false;
            } catch (refundErr) {
                console.error("Failed to refund video render credits:", refundErr);
            }

            return NextResponse.json({
                success: false,
                error: `Failed to initiate cloud rendering worker: ${workerError.message}`
            }, { status: 502 });
        }

    } catch (error: any) {
        console.error("[Render Route] Error:", error);
        if (creditsDeductedSuccess) {
            try {
                const { createClient: createAdminClient } = await import('@supabase/supabase-js');
                const supabaseAdmin = createAdminClient(
                    process.env.NEXT_PUBLIC_SUPABASE_URL!,
                    process.env.SUPABASE_SERVICE_ROLE_KEY!
                );
                const { addCredits } = await import('@/utils/credits');
                await addCredits(supabaseAdmin, userId, 20, 'ai_generation', `Refund: Video render failed`);
            } catch (refundErr) {
                console.error("Failed to refund video render credits in catch block:", refundErr);
            }
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
