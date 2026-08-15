import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createKieImageTask } from '@/utils/external-apis';
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

const FB_GRAPH = "https://graph.facebook.com/v19.0";

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get('secret') || searchParams.get('cronSecret') || (authHeader ? authHeader.replace('Bearer ', '') : null);
    if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized Cron Trigger' }, { status: 401 });
    }

    const supabase = await createClient();

    // 1. Fetch Users with active FB Tokens
    const { data: profiles, error: profileErr } = await supabase
        .from('profiles')
        .select('id, facebook_token, ad_account_id')
        .not('facebook_token', 'is', null);

    if (profileErr || !profiles || profiles.length === 0) {
        return NextResponse.json({ status: "No active profiles found." });
    }

    let logs: string[] = [];

    for (const profile of profiles) {
        if (!profile.ad_account_id) continue;

        try {
            // 2. Fetch Active Campaigns for the Ad Account
            const campsRes = await fetch(`${FB_GRAPH}/${profile.ad_account_id}/campaigns?fields=id,name,status&effective_status=['ACTIVE']&access_token=${profile.facebook_token}`);
            const campsData = await campsRes.json();
            
            if (!campsData.data || campsData.data.length === 0) continue;

            for (const campaign of campsData.data) {
                // 3. Fetch Ad Insights under this campaign (last 7 days)
                const insightsRes = await fetch(`${FB_GRAPH}/${campaign.id}/insights?fields=ad_id,ad_name,spend,cpc,actions&level=ad&date_preset=last_7d&access_token=${profile.facebook_token}`);
                const insights = await insightsRes.json();
                
                if (!insights.data || insights.data.length === 0) continue;

                let winners = [];
                let losers = [];

                // 4. Sort Winners and Losers based on Spend and Lead Volume
                for (const adData of insights.data) {
                    const spend = parseFloat(adData.spend || "0");
                    const leads = parseInt(adData.actions?.find((a: any) => a.action_type === 'lead')?.value || "0");
                    const cpl = leads > 0 ? spend / leads : spend;

                    // Condition: High spend with 0 leads -> Pause. (Adjust 500 INR threshold as needed)
                    if (leads === 0 && spend > 500) { 
                        losers.push({ id: adData.ad_id, name: adData.ad_name, reason: "High spend, zero leads." });
                        
                        // Execute Pause on Meta API
                        await fetch(`${FB_GRAPH}/${adData.ad_id}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: 'PAUSED', access_token: profile.facebook_token })
                        });
                    } 
                    // Condition: Generating leads at acceptable CPL -> Learn from it.
                    else if (leads > 0 && cpl < 300) {
                        winners.push({ name: adData.ad_name, cpl: cpl, leads: leads });
                    }
                }

                // 5. Generate Insights and New Creative Concepts via Gemini Flash 3
                if (winners.length > 0) {
                    const llmPrompt = `
                    You are an expert media buyer and AI creative director.
                    Analyze the following winning Meta Ads data for "Countryside Heaven" luxury real estate (Targeting 2 RK units). 
                    
                    Winning Ads: ${JSON.stringify(winners)}.
                    
                    Task 1: Based on standard direct-response principles, write a 2-sentence insight explaining WHY these ads might be working.
                    Task 2: Generate an image generation prompt (max 50 words) for a brand new, highly realistic architectural creative to test alongside the winners. It must visually appeal to high-intent buyers looking for luxury 2 RKs in the hills. Do not include text in the image prompt.
                    
                    Output strictly as JSON:
                    {
                        "insight": "...", 
                        "new_image_prompt": "..."
                    }
                    `;
                    
                    try {
                        const { object: parsed } = await generateObject({
                            model: google('gemini-3-flash-preview'),
                            prompt: llmPrompt,
                            schema: z.object({
                                insight: z.string(),
                                new_image_prompt: z.string()
                            })
                        });

                        // 6. Trigger Image Generation via Kie.ai
                        // This starts an async task on Kie.ai. You save the taskId to check/retrieve later.
                        const taskId = await createKieImageTask(parsed.new_image_prompt);

                        // 7. Log to Supabase for contextual memory & future retrieval
                        // NOTE: Ensure you create the 'ad_optimizations' table in your Supabase database.
                        await supabase.from('ad_optimizations').insert({
                            user_id: profile.id,
                            campaign_id: campaign.id,
                            insights: parsed.insight,
                            image_task_id: taskId,
                            paused_ads: losers.map(l => l.name)
                        });

                        logs.push(`✅ Optimized Campaign: ${campaign.name}. Paused ${losers.length} ads. New image task triggered: ${taskId}`);
                    } catch (aiErr: any) {
                        logs.push(`⚠️ Failed AI optimization for Campaign: ${campaign.name}. Error: ${aiErr.message}`);
                    }
                } else if (losers.length > 0) {
                     logs.push(`🛑 Paused ${losers.length} failing ads in Campaign: ${campaign.name}. No clear winners yet.`);
                }
            }
        } catch (e: any) {
            logs.push(`❌ Error processing profile ${profile.id}: ${e.message}`);
            console.error(`Error processing profile ${profile.id}:`, e);
        }
    }

    return NextResponse.json({ message: "Optimization Cycle Complete", logs });
}