import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
});

const KIE_CREDIT_RATE = 0.005;    // $0.005 USD per credit (Rs. 0.42)
const KIE_IMAGE_CREDITS = 8;      // 8 credits per image
const LAMBDA_SECOND_RATE = 0.00003333; // AWS Lambda 2048MB execution rate
const R2_STORAGE_GB_RATE = 0.015; // $0.015 USD per GB-month
const VERCEL_LEAD_RATE = 0.005;   // Estimated $0.005 per lead (covers hosting/bandwidth/functions)
const META_CAMPAIGN_RATE = 0.05;  // Graph API overhead per campaign
const WHATSAPP_MSG_RATE = 0.01;   // WhatsApp API overhead per message
const GEMINI_PROMPT_RATE = 0.0005; // Average prompt cost for optimizeCaptions/rewrites
const GEMINI_SCRIPT_RATE = 0.001;  // Average script synthesis cost
const EXCHANGE_RATE = 84.0;       // 1 USD = 84 INR

// Helper to list all objects in R2 bucket and aggregate file sizes by User ID prefix
async function getR2StorageStats() {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const userSizes: Record<string, number> = {};
    const userFiles: Record<string, number> = {};
    
    try {
        let isTruncated = true;
        let continuationToken: string | undefined = undefined;
        
        while (isTruncated) {
            const listParams: any = {
                Bucket: process.env.R2_BUCKET_NAME!,
            };
            if (continuationToken) {
                listParams.ContinuationToken = continuationToken;
            }
            const command = new ListObjectsV2Command(listParams);
            const response = (await s3.send(command)) as any;
            const contents = response.Contents || [];
            
            contents.forEach((obj: any) => {
                if (obj.Size) {
                    const parts = obj.Key.split('/');
                    const userId = parts.find((p: string) => uuidRegex.test(p));
                    if (userId) {
                        userSizes[userId] = (userSizes[userId] || 0) + obj.Size;
                        userFiles[userId] = (userFiles[userId] || 0) + 1;
                    }
                }
            });
            
            isTruncated = response.IsTruncated || false;
            continuationToken = response.NextContinuationToken;
        }
    } catch (err) {
        console.error("[Costing Route] S3 List error:", err);
    }
    
    return { userSizes, userFiles };
}

export async function GET(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: profile, error: profileErr } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (profileErr || profile?.role !== 'super_admin') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const targetUserId = searchParams.get('userId');

        // Fetch real-time R2 storage metrics
        const { userSizes, userFiles } = await getR2StorageStats();

        // Fetch dynamic Vercel plan and billing info
        let vercelPlan = 'hobby';
        try {
            const vercelRes = await fetch('https://api.vercel.com/v2/teams', {
                headers: { 'Authorization': `Bearer ${process.env.VERCEL_TOKEN}` }
            });
            if (vercelRes.ok) {
                const teamsData = await vercelRes.json();
                if (teamsData?.teams?.length > 0) {
                    vercelPlan = teamsData.teams[0].billing?.plan || 'hobby';
                }
            }
        } catch (err) {
            console.error("[Costing Route] Vercel API error:", err);
        }
        const baseVercelCost = vercelPlan === 'pro' ? 20.0 : 0.0;

        if (targetUserId) {
            // ================== DETAILED SINGLE USER COSTING ==================
            const { data: targetProfile, error: tpErr } = await supabaseAdmin
                .from('profiles')
                .select('*')
                .eq('id', targetUserId)
                .single();

            if (tpErr || !targetProfile) {
                return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
            }

            // Fetch video & image assets
            const { data: assets } = await supabaseAdmin
                .from('assets')
                .select('*')
                .eq('user_id', targetUserId);

            let videoCredits = 0;
            let videoCount = 0;
            let imageCount = 0;
            let renderCount = 0;
            let lambdaTotalDuration = 0;

            if (assets) {
                for (const asset of assets) {
                    if (asset.type === 'video') {
                        videoCount += 1;
                        const meta = asset.metadata || {};
                        
                        // Detect AWS Lambda rendering usage from metadata/actions
                        const wasRendered = meta.captions || meta.effects || meta.renderTimeSeconds || meta.timeToRenderInMs;
                        if (wasRendered) {
                            renderCount += 1;
                            
                            let renderDuration = 45; // default fallback execution seconds
                            let lambdasUsed = 1;
                            
                            if (typeof meta.renderTimeSeconds === 'number') {
                                renderDuration = meta.renderTimeSeconds;
                            } else if (typeof meta.timeToRenderInMs === 'number') {
                                renderDuration = meta.timeToRenderInMs / 1000;
                            }
                            
                            if (typeof meta.lambdasUsed === 'number') {
                                lambdasUsed = meta.lambdasUsed;
                            }
                            
                            lambdaTotalDuration += (renderDuration * lambdasUsed);
                        }

                        // Pull credits from Kie API if not cached in metadata
                        let credits = meta.creditsConsumed;
                        if (typeof credits !== 'number' && asset.kie_task_id) {
                            try {
                                console.log(`[Costing Route] Fetching credits from Kie for task: ${asset.kie_task_id}`);
                                const response = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${asset.kie_task_id}`, {
                                    headers: {
                                        'Authorization': `Bearer ${process.env.KIE_API_KEY}`
                                    }
                                });
                                if (response.ok) {
                                    const resJson = await response.json();
                                    const parsedCredits = resJson.data?.creditsConsumed;
                                    if (typeof parsedCredits === 'number') {
                                        credits = parsedCredits;
                                        // Cache inside asset metadata
                                        const updatedMetadata = { ...meta, creditsConsumed: credits };
                                        await supabaseAdmin
                                            .from('assets')
                                            .update({ metadata: updatedMetadata })
                                            .eq('id', asset.id);
                                    }
                                }
                            } catch (err) {
                                console.error("[Costing Route] Kie API error:", err);
                            }
                        }

                        // Fallback to standard 232 credits if not found/failed
                        videoCredits += (typeof credits === 'number') ? credits : 232;

                    } else if (asset.type === 'image') {
                        imageCount += 1;
                    }
                }
            }

            // Query Campaigns
            const { count: campaignsCount } = await supabaseAdmin
                .from('campaigns')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', targetUserId);

            // Query Messages
            const { count: messagesCount } = await supabaseAdmin
                .from('messages')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', targetUserId);

            // Query Leads (to estimate Vercel web traffic / actions)
            const { count: leadsCount } = await supabaseAdmin
                .from('leads')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', targetUserId);

            const safeCampaignsCount = campaignsCount || 0;
            const safeMessagesCount = messagesCount || 0;
            const safeLeadsCount = leadsCount || 0;

            // Fetch profiles count to divide the Vercel subscription cost
            const { count: totalUsers } = await supabaseAdmin
                .from('profiles')
                .select('*', { count: 'exact', head: true });
            const userCountDivider = totalUsers || 1;

            // Calculations
            const r2Bytes = userSizes[targetUserId] || targetProfile.storage_bytes_used || 0;
            const r2StorageGb = r2Bytes / (1024 * 1024 * 1024);
            const r2FileCount = userFiles[targetUserId] || (videoCount + imageCount);
            
            const videoGenCost = videoCredits * KIE_CREDIT_RATE;
            const imageGenCost = imageCount * KIE_IMAGE_CREDITS * KIE_CREDIT_RATE;
            const lambdaRenderCost = lambdaTotalDuration * LAMBDA_SECOND_RATE;
            
            // R2 storage cost (GB rate) + operation costs (Class A/B request overhead estimate)
            const r2Cost = (r2StorageGb * R2_STORAGE_GB_RATE) + (r2FileCount * 0.00005);
            
            const geminiCost = (safeCampaignsCount * GEMINI_SCRIPT_RATE) + (renderCount * GEMINI_PROMPT_RATE) + (safeMessagesCount * 0.0001);
            
            // Vercel cost = traffic-proportioned lead rate + divided flat subscription rate
            const vercelCost = (safeLeadsCount * VERCEL_LEAD_RATE) + (baseVercelCost / userCountDivider);
            
            const metaCost = safeCampaignsCount * META_CAMPAIGN_RATE;
            const whatsappCost = safeMessagesCount * WHATSAPP_MSG_RATE;

            const totalUsd = videoGenCost + imageGenCost + lambdaRenderCost + r2Cost + geminiCost + vercelCost + metaCost + whatsappCost;
            const totalInr = totalUsd * EXCHANGE_RATE;

            return NextResponse.json({
                success: true,
                details: {
                    businessName: targetProfile.business_name || 'Sub-Account',
                    email: targetProfile.email,
                    role: targetProfile.role,
                    createdAt: targetProfile.created_at,
                    breakdown: {
                        kieVideo: { count: videoCount, metric: `${videoCredits} credits`, usd: videoGenCost, inr: videoGenCost * EXCHANGE_RATE },
                        kieImage: { count: imageCount, metric: `${imageCount * KIE_IMAGE_CREDITS} credits`, usd: imageGenCost, inr: imageGenCost * EXCHANGE_RATE },
                        lambdaRender: { count: renderCount, metric: `${lambdaTotalDuration.toFixed(1)}s execution`, usd: lambdaRenderCost, inr: lambdaRenderCost * EXCHANGE_RATE },
                        geminiLLM: { count: safeCampaignsCount + renderCount, metric: 'API tokens', usd: geminiCost, inr: geminiCost * EXCHANGE_RATE },
                        r2Storage: { count: r2FileCount, metric: `${r2StorageGb.toFixed(4)} GB`, usd: r2Cost, inr: r2Cost * EXCHANGE_RATE },
                        vercelHosting: { count: safeLeadsCount, metric: `${vercelPlan.toUpperCase()} plan share`, usd: vercelCost, inr: vercelCost * EXCHANGE_RATE },
                        metaCampaigns: { count: safeCampaignsCount, metric: 'Launches', usd: metaCost, inr: metaCost * EXCHANGE_RATE },
                        whatsappMsgs: { count: safeMessagesCount, metric: 'Dispatches', usd: whatsappCost, inr: whatsappCost * EXCHANGE_RATE }
                    },
                    totalCostUsd: parseFloat(totalUsd.toFixed(2)),
                    totalCostInr: parseFloat(totalInr.toFixed(2))
                }
            });
        }

        // ================== GLOBAL SUMMARY FOR ALL USERS ==================
        const { data: profiles, error: pErr } = await supabaseAdmin
            .from('profiles')
            .select('id, email, business_name, role, storage_bytes_used');

        if (pErr || !profiles) {
            return NextResponse.json({ error: 'Failed to retrieve profiles' }, { status: 500 });
        }

        const costingMap: Record<string, {
            videosCount: number;
            rendersCount: number;
            imagesCount: number;
            campaignsCount: number;
            messagesCount: number;
            totalCostUsd: number;
            totalCostInr: number;
        }> = {};

        profiles.forEach(p => {
            costingMap[p.id] = {
                videosCount: 0,
                rendersCount: 0,
                imagesCount: 0,
                campaignsCount: 0,
                messagesCount: 0,
                totalCostUsd: 0,
                totalCostInr: 0
            };
        });

        // 1. Fetch assets
        const { data: assets } = await supabaseAdmin
            .from('assets')
            .select('user_id, type, metadata');

        const videoCreditsMap: Record<string, number> = {};
        const lambdaDurationMap: Record<string, number> = {};

        if (assets) {
            assets.forEach(asset => {
                const uId = asset.user_id;
                if (!costingMap[uId]) return;

                if (asset.type === 'video') {
                    costingMap[uId].videosCount += 1;
                    const meta = asset.metadata || {};
                    
                    const wasRendered = meta.captions || meta.effects || meta.renderTimeSeconds || meta.timeToRenderInMs;
                    if (wasRendered) {
                        costingMap[uId].rendersCount += 1;
                        
                        let renderDuration = 45;
                        let lambdasUsed = 1;
                        
                        if (typeof meta.renderTimeSeconds === 'number') {
                            renderDuration = meta.renderTimeSeconds;
                        } else if (typeof meta.timeToRenderInMs === 'number') {
                            renderDuration = meta.timeToRenderInMs / 1000;
                        }
                        
                        if (typeof meta.lambdasUsed === 'number') {
                            lambdasUsed = meta.lambdasUsed;
                        }
                        
                        lambdaDurationMap[uId] = (lambdaDurationMap[uId] || 0) + (renderDuration * lambdasUsed);
                    }
                    
                    // Aggregate credits using cached values or fallback
                    const credits = meta.creditsConsumed || 232;
                    videoCreditsMap[uId] = (videoCreditsMap[uId] || 0) + credits;
                } else if (asset.type === 'image') {
                    costingMap[uId].imagesCount += 1;
                }
            });
        }

        // 2. Fetch correct Campaigns (campaigns table)
        const { data: campaigns } = await supabaseAdmin
            .from('campaigns')
            .select('user_id');

        if (campaigns) {
            campaigns.forEach(campaign => {
                const uId = campaign.user_id;
                if (costingMap[uId]) {
                    costingMap[uId].campaignsCount += 1;
                }
            });
        }

        // 3. Fetch WhatsApp Messages
        const { data: messages } = await supabaseAdmin
            .from('messages')
            .select('user_id');

        if (messages) {
            messages.forEach(msg => {
                const uId = msg.user_id;
                if (costingMap[uId]) {
                    costingMap[uId].messagesCount += 1;
                }
            });
        }

        // 4. Compute cost per user
        profiles.forEach(p => {
            const counts = costingMap[p.id];
            if (!counts) return;

            const uId = p.id;
            const credits = videoCreditsMap[uId] || 0;
            const videoCost = credits * KIE_CREDIT_RATE;
            const imageCost = counts.imagesCount * KIE_IMAGE_CREDITS * KIE_CREDIT_RATE;
            
            const renderDuration = lambdaDurationMap[uId] || 0;
            const renderCost = renderDuration * LAMBDA_SECOND_RATE;
            
            const storageBytes = userSizes[uId] || p.storage_bytes_used || 0;
            const storageGb = storageBytes / (1024 * 1024 * 1024);
            const fileCount = userFiles[uId] || (counts.videosCount + counts.imagesCount);
            
            const r2Cost = (storageGb * R2_STORAGE_GB_RATE) + (fileCount * 0.00005);
            
            const geminiCost = (counts.campaignsCount * GEMINI_SCRIPT_RATE) + (counts.rendersCount * GEMINI_PROMPT_RATE) + (counts.messagesCount * 0.0001);
            
            const vercelCost = (counts.campaignsCount * 1.5 * VERCEL_LEAD_RATE) + (baseVercelCost / Math.max(1, profiles.length));
            
            const metaCost = counts.campaignsCount * META_CAMPAIGN_RATE;
            const whatsappCost = counts.messagesCount * WHATSAPP_MSG_RATE;

            const totalUsd = videoCost + imageCost + renderCost + r2Cost + geminiCost + vercelCost + metaCost + whatsappCost;

            costingMap[uId].totalCostUsd = parseFloat(totalUsd.toFixed(2));
            costingMap[uId].totalCostInr = parseFloat((totalUsd * EXCHANGE_RATE).toFixed(2));
        });

        return NextResponse.json({ success: true, costing: costingMap });

    } catch (err: any) {
        console.error("[Costing API Global Error]:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
