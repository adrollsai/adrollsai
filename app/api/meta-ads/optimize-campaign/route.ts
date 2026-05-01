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

        // 4. Fetch the ACTUAL Media URL for the Top Winner to feed to Multimodal AI
        const adRes = await fetch(`${FB_GRAPH}/${topWinner.id}?fields=creative&access_token=${profile.facebook_token}`);
        const adData = await adRes.json();
        let topCreativeUrl = null;

        if (adData.creative?.id) {
            const creativeRes = await fetch(`${FB_GRAPH}/${adData.creative.id}?fields=image_url,thumbnail_url&access_token=${profile.facebook_token}`);
            const creativeData = await creativeRes.json();
            // Use image_url (for images) or thumbnail_url (for videos)
            topCreativeUrl = creativeData.image_url || creativeData.thumbnail_url || null;
        }

        // 5. Multimodal AI Analysis via Gemini 3 Flash
        const llmPrompt = `
        You are an elite, multimodal AI media buyer specializing in real estate direct-response ads.
        I am providing you the performance metrics and the ACTUAL visual image/thumbnail of the top winning ad.
        
        Top Ad Name: ${topWinner.name}
        Leads Generated: ${topWinner.leads}
        Spend: ₹${topWinner.spend}

        Task 1: Write a 1-sentence highly specific insight on WHY this visual is converting well.
        Task 2: To feed the Meta Andromeda algorithm, we need high volume and diversification. Generate 3 distinct, highly realistic static image prompts (50 words each) based on the winning angle but varying the visual hook (e.g., one aesthetic, one showing people, one abstract). Do not include text in the image prompts.
        
        Output strictly as JSON:
        {
            "visual_insight": "...",
            "variations": [
                { "title": "Aesthetic Focus", "prompt": "..." },
                { "title": "Human Element", "prompt": "..." },
                { "title": "Abstract/Detail", "prompt": "..." }
            ]
        }
        `;

        // Pass the image URL to generateKieChat for true multimodal analysis
        const aiRaw = await generateKieChat(llmPrompt, "gemini-3-flash", topCreativeUrl || undefined);
        let parsed;
        try {
            parsed = JSON.parse(aiRaw.replace(/^```json\s*/, '').replace(/\s*```$/, ''));
        } catch (e) {
            console.error("Failed to parse Gemini output:", aiRaw);
            parsed = { visual_insight: "High engagement detected.", variations: [] };
        }

        // Return everything to the frontend to display to the user in the Agent Orchestrator
        return NextResponse.json({ 
            status: 'success', 
            insight: parsed.visual_insight,
            variations: parsed.variations,
            pausedAds: pausedAds,
            winnerImageAnalyzed: topCreativeUrl,
            topWinner: topWinner
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}