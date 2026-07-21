import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
    try {
        let user: any = null;
        const mockUserHeader = request.headers.get('X-Mock-User');
        if (mockUserHeader && !process.env.VERCEL) {
            user = { id: mockUserHeader };
        } else {
            const clientSupabase = await createClient();
            const { data: { user: authUser } } = await clientSupabase.auth.getUser();
            user = authUser;
        }

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const url = new URL(request.url);
        const impersonateId = url.searchParams.get('impersonate');

        const { data: currentProfile } = await supabaseAdmin.from('profiles').select('role, agency_id, parent_id').eq('id', user.id).single();
        let targetUserId = (['admin', 'agent'].includes(currentProfile?.role || '') && (currentProfile?.agency_id || currentProfile?.parent_id)) 
          ? (currentProfile.agency_id || currentProfile.parent_id) 
          : user.id;

        if (impersonateId && impersonateId !== user.id) {
            if (['super_admin', 'agency', 'admin', 'agent'].includes(currentProfile?.role || '')) {
                if (currentProfile?.role !== 'super_admin') {
                    const isParent = (currentProfile?.agency_id === impersonateId || currentProfile?.parent_id === impersonateId);
                    const { data: subAccount } = await supabaseAdmin
                      .from('profiles')
                      .select('id')
                      .eq('id', impersonateId)
                      .eq('agency_id', currentProfile?.agency_id || user.id)
                      .single();

                    if (isParent || subAccount) {
                        targetUserId = impersonateId;
                    } else {
                        return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 });
                    }
                } else {
                    targetUserId = impersonateId;
                }
            } else {
                return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 });
            }
        }

        let since = url.searchParams.get('since');
        if (since && since.includes(' ') && !since.includes('+')) {
            const parts = since.split(' ');
            const lastPart = parts[parts.length - 1];
            if (lastPart.includes(':')) {
                since = parts.slice(0, -1).join(' ') + '+' + lastPart;
            }
        }

        const { data: targetProfile } = await supabaseAdmin.from('profiles').select('parent_id, agency_id').eq('id', targetUserId).single();
        const effectiveUserIds: string[] = [targetUserId];
        if (targetProfile?.parent_id) effectiveUserIds.push(targetProfile.parent_id);
        if (targetProfile?.agency_id) effectiveUserIds.push(targetProfile.agency_id);

        let query = supabaseAdmin
            .from('assets')
            .select('*')
            .in('user_id', effectiveUserIds);
            
        if (since) {
            query = query.or(`created_at.gt.${since},status.eq.Processing,status.eq.Rendering`);
        }

        const { data: assetData, error: assetError } = await query.order('created_at', { ascending: false });

        if (assetError) {
            throw assetError;
        }

        // --- Auto-Sync processing assets from Kie.ai on GET request ---
        const processingAssets = (assetData || []).filter(a => a.status === 'Processing' && a.kie_task_id);
        if (processingAssets.length > 0) {
            console.log(`[Assets API] Found ${processingAssets.length} processing assets to sync status.`);
            for (const asset of processingAssets) {
                try {
                    const taskId = asset.kie_task_id;
                    const checkRes = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
                        headers: { 'Authorization': `Bearer ${process.env.KIE_API_KEY}` }
                    });
                    
                    let markAsFailed = false;
                    let failMsg = "";

                    if (!checkRes.ok) {
                        const elapsedMs = Date.now() - new Date(asset.created_at || "").getTime();
                        if (elapsedMs > 5 * 60 * 1000) {
                            markAsFailed = true;
                            failMsg = `Server error ${checkRes.status}`;
                        }
                    } else {
                        const checkData = await checkRes.json();
                        if (checkData.code !== 200) {
                            const elapsedMs = Date.now() - new Date(asset.created_at || "").getTime();
                            if (elapsedMs > 5 * 60 * 1000) {
                                markAsFailed = true;
                                failMsg = checkData.msg || checkData.error || "Task not found on design server";
                            }
                        } else {
                            const state = checkData.data?.state || checkData.data?.status || checkData.status;
                            if (state === 'success' || state === 'succeeded' || state === 'completed') {
                                let imageUrl = null;
                                const resultJson = checkData.data?.resultJson;
                                if (resultJson) {
                                    try {
                                        const parsed = JSON.parse(resultJson);
                                        imageUrl = parsed.resultUrls?.[0] || parsed.url;
                                    } catch (e) {}
                                }
                                const result = checkData.data?.result || checkData.data;
                                if (!imageUrl && result) {
                                    imageUrl = result.image_url || result.imageUrl || result.output_url || result.outputUrl || result.url || result.resultUrl;
                                }

                                if (imageUrl) {
                                    const imgRes = await fetch(imageUrl);
                                    if (imgRes.ok) {
                                        const buffer = Buffer.from(await imgRes.arrayBuffer());
                                        const ext = imageUrl.split('.').pop()?.split('?')[0] || 'png';
                                        const r2Key = `generated/${asset.user_id}/creative_${Date.now()}_${asset.id}.${ext}`;

                                        await r2.send(new PutObjectCommand({
                                            Bucket: R2_BUCKET,
                                            Key: r2Key,
                                            Body: buffer,
                                            ContentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`
                                        }));

                                        const r2Url = `${R2_PUBLIC_URL}/adrolls-storage/${r2Key}`;
                                        
                                        // Update database record
                                        await supabaseAdmin
                                            .from('assets')
                                            .update({
                                                url: r2Url,
                                                status: 'Draft',
                                                created_at: new Date().toISOString()
                                            })
                                            .eq('id', asset.id);
                                        
                                        // Update local variable so it returns updated draft state to frontend
                                        asset.url = r2Url;
                                        asset.status = 'Draft';
                                        asset.created_at = new Date().toISOString();
                                    }
                                }
                            } else if (state === 'failed' || state === 'error' || state === 'fail') {
                                markAsFailed = true;
                                failMsg = checkData.data?.failMsg || "Kie.ai generation error";
                            }
                        }
                    }

                    if (markAsFailed) {
                        await supabaseAdmin
                            .from('assets')
                            .update({
                                status: 'Failed',
                                caption: `Error: ${failMsg}`
                            })
                            .eq('id', asset.id);
                        
                        asset.status = 'Failed';
                        asset.caption = `Error: ${failMsg}`;
                    }
                } catch (err) {
                    console.error(`[Assets API] Sync failed for asset ${asset.id}:`, err);
                }
            }
        }

        return NextResponse.json(assetData || []);

    } catch (error: any) {
        console.error("[Assets API] Fetch error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
