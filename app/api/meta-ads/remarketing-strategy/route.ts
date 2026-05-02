import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { generateKieChat } from '@/utils/external-apis';

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { campaignId, campaignName } = await request.json();
        
        const { data: profile } = await supabase.from('profiles').select('business_name').eq('id', user.id).single();

        const llmPrompt = `
        You are an elite AI media buyer. 
        We are launching a REMARKETING campaign for users who have already submitted leads but haven't converted yet.
        Business Name: ${profile?.business_name || 'Our Company'}
        Original Campaign: ${campaignName || 'General Campaign'}
        
        To build trust and rapport, generate 3 distinct creative concepts (text-based angles) we should use for the retargeting ads:
        1. Social Proof / Authority
        2. Soft Offer / Urgency
        3. Founder Story / Behind the Scenes

        Format exactly as JSON:
        {
            "strategy_insight": "A brief 2 sentence explanation of why remarketing is critical here.",
            "variations": [
                { "title": "Social Proof", "prompt": "..." },
                { "title": "Soft Offer", "prompt": "..." },
                { "title": "Rapport/Story", "prompt": "..." }
            ]
        }
        `;

        const aiRaw = await generateKieChat(llmPrompt, "gemini-3-flash-preview");
        let parsed;
        try {
            parsed = JSON.parse(aiRaw.replace(/^```json\s*/, '').replace(/\s*```$/, ''));
        } catch (e) {
            console.error("Failed to parse Gemini output:", aiRaw);
            parsed = { strategy_insight: "Retargeting helps build trust.", variations: [] };
        }

        return NextResponse.json({ status: 'success', insight: parsed.strategy_insight, variations: parsed.variations });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
