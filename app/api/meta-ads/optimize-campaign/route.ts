import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { generateKieChat, createKieImageTask } from '@/utils/external-apis';

const FB_GRAPH = "https://graph.facebook.com/v19.0";

export async function POST(request: Request) {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { campaignId } = await request.json();
    if (!campaignId) return NextResponse.json({ error: 'Missing Campaign ID' }, { status: 400 });

    const { data: profile } = await supabase.from('profiles').select('facebook_token, ad_account_id').eq('id', user.id).single();
    if (!profile?.facebook_token || !profile?.ad_account_id) {
        return NextResponse.json({ error: 'Missing Meta credentials' }, { status: 400 });
    }

    try {
        // 1. Fetch Ad-Level Insights
        const insightsRes = await fetch(`${FB_GRAPH}/${campaignId}/insights?fields=ad_id,ad_name,spend,impressions,cpc,actions&level=ad&date_preset=maximum&access_token=${profile.facebook_token}`);
        const insightsData = await insightsRes.json();
        
        if (!insightsData.data || insightsData.data.length === 0) {
            return NextResponse.json({ 
                status: 'insufficient_data', 
                message: 'This campaign does not have enough active delivery data to optimize yet.' 
            });
        }

        let totalSpend = 0;
        let totalImpressions = 0;
        let winners = [];
        let pausedAds = [];

        // 2. Sort Winners and Losers
        for (const ad of insightsData.data) {
            const spend = parseFloat(ad.spend || "0");
            const impressions = parseInt(ad.impressions || "0");
            const leads = parseInt(ad.actions?.find((a: any) => a.action_type === 'lead')?.value || "0");
            const cpl = leads > 0 ? spend / leads : spend;

            totalSpend += spend;
            totalImpressions += impressions;

            // Definition of a Loser: High spend, zero leads
            if (leads === 0 && spend > 500) { 
                pausedAds.push(ad.ad_name);
                await fetch(`${FB_GRAPH}/${ad.ad_id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'PAUSED', access_token: profile.facebook_token })
                });
            } 
            // Definition of a Winner: Generating leads, or has best engagement
            else if (leads > 0 || spend > 200) {
                winners.push({ id: ad.ad_id, name: ad.ad_name, leads: leads, spend: spend });
            }
        }

        // 3. Condition Check: Is there enough data overall?
        if (totalSpend < 800 && totalImpressions < 2000 && winners.length === 0) {
            return NextResponse.json({ 
                status: 'insufficient_data', 
                message: `Not enough data to optimize. Current Spend: ₹${totalSpend.toFixed(0)}. Please let the campaign run longer.` 
            });
        }

        if (winners.length === 0) {
            return NextResponse.json({ 
                status: 'success', 
                pausedAds: pausedAds,
                insight: "All ads were underperforming and have been paused. No clear winner identified yet.",
                videoConcept: null,
                newImageTask: null
            });
        }

        // Sort winners by leads (descending), then spend
        winners.sort((a, b) => b.leads - a.leads || b.spend - a.spend);
        const topWinner = winners[0];

        // 4. Fetch the ACTUAL Media URL and Lead Form for the Top Winner
        const adRes = await fetch(`${FB_GRAPH}/${topWinner.id}?fields=creative&access_token=${profile.facebook_token}`);
        const adData = await adRes.json();
        let topCreativeUrl = null;
        let leadFormId = null;

        if (adData.creative?.id) {
            const creativeRes = await fetch(`${FB_GRAPH}/${adData.creative.id}?fields=image_url,thumbnail_url,object_story_spec&access_token=${profile.facebook_token}`);
            const creativeData = await creativeRes.json();
            topCreativeUrl = creativeData.image_url || creativeData.thumbnail_url || null;
            leadFormId = creativeData.object_story_spec?.link_data?.call_to_action?.value?.lead_gen_form_id;
        }

        // 5. Multimodal AI Analysis via Gemini 3 Flash
        const llmPrompt = `
        You are an elite, multimodal AI media buyer specializing in real estate direct-response ads.
        I am providing you the performance metrics and the ACTUAL visual image/thumbnail of the top winning ad.
        
        Top Ad Name: ${topWinner.name}
        Leads Generated: ${topWinner.leads}
        Spend: ₹${topWinner.spend}

        Task 1: Write a sharp 1-sentence insight on WHY this visual is converting.
        Task 2: Generate 10 distinct variations. For each, provide:
           - An image generation prompt (max 60 words, focus on realism and visual hook).
           - A high-converting Headline (max 40 chars).
           - A Primary Text (ad copy) using Hormozi's framework (max 200 chars).
        
        Output MUST be valid JSON:
        {
            "visual_insight": "...",
            "variations": [
                { "title": "Variation 1", "image_prompt": "...", "headline": "...", "primary_text": "..." },
                ... (10 items)
            ]
        }
        `;

        const aiRaw = await generateKieChat(llmPrompt, "gemini-3-flash-preview", topCreativeUrl || undefined);
        let parsed;
        try {
            parsed = JSON.parse(aiRaw.replace(/^```json\s*/, '').replace(/\s*```$/, ''));
        } catch (e) {
            console.error("Failed to parse Gemini output:", aiRaw);
            return NextResponse.json({ error: "Failed to parse AI strategy output." }, { status: 500 });
        }

        // 6. Trigger Background Tasks for Image Generation (5x nano-banana-2, 5x gpt-image-2)
        const baseUrl = new URL(request.url).origin;
        const generationResults = [];

        for (let i = 0; i < parsed.variations.length; i++) {
            const variant = parsed.variations[i];
            const modelToUse = i % 2 === 0 ? 'nano-banana-2' : 'gpt/gpt-image-2-text-to-image';
            const aspectRatio = i % 2 === 0 ? '1:1' : '4:5';
            
            // Trigger background worker
            fetch(`${baseUrl}/api/background-worker`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user.id,
                    propertyTitle: variant.title,
                    payload: {
                        propertyTitle: variant.title,
                        propertyDescription: variant.image_prompt,
                        userInstructions: "Real estate optimization variation.",
                        model: modelToUse,
                        aspectRatio: aspectRatio
                    },
                    existingCaption: `${variant.headline}\n\n${variant.primary_text}`
                })
            }).catch(err => console.error(`Background worker trigger failed for variant ${i}:`, err));
        }

        return NextResponse.json({ 
            status: 'success', 
            insight: parsed.visual_insight,
            variations: parsed.variations, // Return the plan to the UI immediately
            pausedAds: pausedAds,
            winnerImageAnalyzed: topCreativeUrl,
            leadFormId: leadFormId,
            message: "10 optimization variations are being generated in the background. Once they appear in your assets library, you can review and push them to the campaign."
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}