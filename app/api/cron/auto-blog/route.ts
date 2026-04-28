// app/api/cron/auto-blog/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Absolute cache busting so Vercel doesn't freeze the cron responses
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

export async function GET(request: Request) {
    return runSeoCron(request);
}

export async function POST(request: Request) {
    return runSeoCron(request);
}

async function runSeoCron(request: Request) {
  try {
    const url = new URL(request.url);
    const specificUserId = url.searchParams.get('userId'); // Allows testing for a single user from the dashboard

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // 1. Fetch target profiles (with their mission statement for context)
    let profilesQuery = supabaseAdmin.from('profiles').select('id, business_name, mission_statement');
    if (specificUserId) {
        profilesQuery = profilesQuery.eq('id', specificUserId);
    }
    
    const { data: profiles, error } = await profilesQuery;
    if (error) throw error;

    let successCount = 0;

    for (const profile of profiles || []) {
        
        // 2. Fetch the actual products/inventory for this specific business
        const { data: products } = await supabaseAdmin
            .from('properties') // Adjust this table name if your products are stored elsewhere
            .select('title, price, property_type, description, image_url')
            .eq('user_id', profile.id)
            .limit(3); // Grab up to 3 active products to feature in the blog

        // 3. Format the inventory into text for the AI
        let inventoryContext = "General brand awareness and market updates.";
        let featuredImage = 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=800&q=80'; // Default SaaS fallback image
        
        if (products && products.length > 0) {
            inventoryContext = products.map(p => 
                `- ${p.title} (${p.property_type || 'Product'}): ${p.price}. ${p.description || ''}`
            ).join('\n');
            
            // Use the first product's image as the cover image for the blog post
            if (products[0].image_url) featuredImage = products[0].image_url;
        }

        // 4. The Dynamic, Alex Hormozi-Inspired SEO Prompt
        const prompt = `You are an elite SEO copywriter and direct-response marketer trained in the exact principles of Alex Hormozi (Grand Slam Offers, Value Equation, clear CTAs, and building extreme trust). 
        
        Write a highly SEO-optimized, engaging blog article to rank the landing page for a business named "${profile.business_name || 'This Company'}".
        
        Business Context & Mission:
        "${profile.mission_statement || 'Providing top-tier services and maximum value to our customers.'}"
        
        Here is their current active inventory/products to feature naturally in the article:
        ${inventoryContext}
        
        Instructions:
        1. Write a compelling, value-driven article that builds trust, highlights the immense value of these specific products/services, and drives the reader to take action.
        2. Format the body content strictly with HTML tags (<h2>, <p>, <b>, <ul>, <li>). Do NOT use markdown.
        3. Keep the total length under 400 words. 
        4. Return ONLY a valid JSON object with the following exact keys: 'title', 'excerpt' (1 compelling sentence), 'content' (the HTML body), and 'tags' (array of 3 to 5 SEO keywords). Do not include markdown formatting blocks (like \`\`\`json) around the output.`;

        // 5. Call Kie.ai using OpenAI-compatible formatting with Gemini 1.5 Flash
        const res = await fetch('https://api.kie.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.KIE_API_KEY}`
            },
            body: JSON.stringify({
                model: 'google/gemini-1.5-flash', 
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" }
            })
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error(`Kie.ai failed for ${profile.id}:`, errText);
            continue;
        }

        const aiData = await res.json();
        const responseText = aiData.choices[0].message.content;
        
        let article;
        try {
            // Some models occasionally still wrap JSON in markdown despite instructions. Clean it just in case.
            const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            article = JSON.parse(cleanJson);
        } catch (e) {
            console.error("Failed to parse JSON from AI:", responseText);
            continue;
        }

        // 6. Save to Database for the Feed
        const { error: insertError } = await supabaseAdmin.from('posts').insert({
            user_id: profile.id,
            title: article.title,
            excerpt: article.excerpt,
            content: article.content,
            tags: article.tags,
            status: 'published',
            image_url: featuredImage 
        });

        if (insertError) {
             console.error(`DB Insert Error for ${profile.id}:`, insertError);
        } else {
             successCount++;
        }
    }

    return NextResponse.json({ success: true, generated: successCount });

  } catch (error: any) {
    console.error("Auto-Blog Fatal Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}