import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { callGemini } from '@/utils/external-apis'

export async function GET() {
    const supabase = await createClient();
    
    try {
        const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, business_name, custom_domain'); 
        
        if (profilesError) throw new Error(profilesError.message);
        if (!profiles || profiles.length === 0) return NextResponse.json({ message: "No users found" }, { status: 200 });

        const results = [];

        // Loop through all users sequentially
        for (const profile of profiles) {
            
            const { data: properties, error: propertiesError } = await supabase
                .from('properties')
                .select('title, price, description, address, image_url, property_type')
                .eq('user_id', profile.id)
                .order('created_at', { ascending: false })
                .limit(1);

            if (propertiesError || properties?.length === 0) {
                results.push({ userId: profile.id, status: 'skipped', reason: 'No properties' });
                continue;
            }

            const property = properties[0];

            // AI Prompt engineered for LLM indexing & Direct-Response SEO
            const prompt = `You are an expert Real Estate Copywriter specializing in direct-response marketing and search engine optimization. 
            Write an authoritative market update feed post for this property. 
            
            Business Name: ${profile.business_name}
            Property: ${property.title}
            Type: ${property.property_type || 'Premium Real Estate'}
            Location: ${property.address}
            Price: ${property.price}
            Details: ${property.description}

            RULES:
            - Write in a highly engaging, high-status, cinematic tone.
            - Use value stacking to build desire for the location and the asset.
            - Ensure legal accuracy: If the business model involves shared investment, refer to it strictly as "fractional co-ownership", do not use the word "own" by itself.
            - Do not invent hypothetical return percentages or unauthorized pricing.
            - Ensure any location referencing Delhi is written as "New Delhi".
            
            STRUCTURE YOUR RESPONSE EXACTLY LIKE THIS:
            TITLE: [Catchy, SEO-optimized headline]
            CONTENT: [3-4 paragraphs. Use bolding (e.g., <b>text</b>) for emphasis on key benefits. Include a clear Call to Action to contact ${profile.business_name}].
            TAGS: [Comma separated list of 3-4 keywords like 'Real Estate, Investment, Market Update']`;

            const rawContent = await callGemini(prompt);
            
            let title = `${property.title} - Market Update`;
            let contentBody = rawContent;
            let tags = ["Real Estate", "Market Trends"];

            // Extract Title
            const titleMatch = rawContent.match(/TITLE:\s*(.*)/i);
            if (titleMatch && titleMatch[1]) {
                title = titleMatch[1].trim();
            }

            // Extract Content
            const contentMatch = rawContent.match(/CONTENT:\s*([\s\S]*?)(?=TAGS:|$)/i);
            if (contentMatch && contentMatch[1]) {
                contentBody = contentMatch[1].trim();
            }

            // Extract Tags
            const tagsMatch = rawContent.match(/TAGS:\s*(.*)/i);
            if (tagsMatch && tagsMatch[1]) {
                tags = tagsMatch[1].replace(/[[\]]/g, '').split(',').map(tag => tag.trim());
            }
            
            // Create a clean meta-excerpt for the UI and search snippets
            const excerpt = contentBody.replace(/<[^>]*>?/gm, '').substring(0, 130) + '...';

            const { error: saveError } = await supabase.from('posts').insert({
                user_id: profile.id,
                title: title,
                content: contentBody,
                excerpt: excerpt,
                image_url: property.image_url,
                tags: tags,
                status: 'published'
            });

            if (saveError) {
                console.error(`DB save failed for ${profile.id}:`, saveError);
                results.push({ userId: profile.id, status: 'error', reason: saveError.message });
                continue;
            }

            results.push({ userId: profile.id, status: 'success', title: title });
        }

        return NextResponse.json({ success: true, processed: results.length, details: results });

    } catch (error: any) {
        console.error("Cron Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}