import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { callGemini } from '@/utils/external-apis' // <--- NEW IMPORT

// NOTE: In a real-world app, you must secure this endpoint (e.g., check for a secret cron header).
export async function GET() {
    const supabase = await createClient();
    
    try {
        // 1. Get All Users (Matching n8n 'Get All Users' node)
        const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, business_name'); 
        
        if (profilesError) throw new Error(profilesError.message);
        if (!profiles || profiles.length === 0) return NextResponse.json({ message: "No users found" }, { status: 200 });

        const results = [];

        // 2. Loop through users
        for (const profile of profiles) {
            
            // 2.1 Get 1 Property (Matching n8n 'Get 1 Property' node)
            const { data: properties, error: propertiesError } = await supabase
                .from('properties')
                .select('title, price, description, image_url')
                .eq('user_id', profile.id)
                .order('created_at', { ascending: false })
                .limit(1);

            if (propertiesError || properties?.length === 0) {
                results.push({ userId: profile.id, status: 'skipped', reason: propertiesError?.message || 'No properties' });
                continue;
            }

            const property = properties[0];

            // 2.2 Construct Prompt (Matching n8n 'Message a model' node)
            const prompt = `write a blog for this property listing in mohali tricity area :-
 Title : ${property.title}
Price :- ${property.price}
Description : ${property.description}`;

            // 2.3 Generate Blog Content (Calling the direct API)
            const content = await callGemini(prompt);
            
            // Simple logic to extract excerpt
            const excerpt = content.substring(0, 100).split('\n')[0] + '...';

            // 2.4 Save to DB (Matching n8n 'Save to DB' node)
            const { error: saveError } = await supabase.from('posts').insert({
                user_id: profile.id,
                title: property.title,
                content: content,
                excerpt: excerpt,
                image_url: property.image_url,
                tags: ["AI Generated", "Real Estate", "Market Trends"], // Example tags
                status: 'published'
            });

            if (saveError) {
                throw new Error(`DB save failed for user ${profile.id}: ${saveError.message}`);
            }

            results.push({ userId: profile.id, status: 'success', title: property.title });
        }

        return NextResponse.json({ success: true, results });

    } catch (error: any) {
        console.error("Auto-Blogger Cron Error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}