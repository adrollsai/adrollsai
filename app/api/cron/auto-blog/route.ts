// app/api/cron/auto-blog/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateObject } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'

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
    const specificUserId = url.searchParams.get('userId');

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    let profilesQuery = supabaseAdmin.from('profiles').select('id, business_name, mission_statement');
    if (specificUserId) {
        profilesQuery = profilesQuery.eq('id', specificUserId);
    }
    
    const { data: profiles, error } = await profilesQuery;
    if (error) throw error;

    if (!profiles || profiles.length === 0) {
        return NextResponse.json({ success: false, error: "Profile not found." }, { status: 404 });
    }

    let successCount = 0;
    let lastError = null;

    for (const profile of profiles) {
        let article;
        const { data: products } = await supabaseAdmin
            .from('properties')
            .select('title, price, property_type, description, image_url')
            .eq('user_id', profile.id)
            .limit(3);

        let inventoryContext = "General brand awareness and market updates.";
        let featuredImage = 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=800&q=80';
        
        if (products && products.length > 0) {
            inventoryContext = products.map(p => 
                `- ${p.title} (${p.property_type || 'Product'}): ${p.price}. ${p.description || ''}`
            ).join('\n');
            if (products[0].image_url) featuredImage = products[0].image_url;
        }

        const prompt = `You are an elite SEO copywriter and direct-response marketer trained in the exact principles of Alex Hormozi (Grand Slam Offers, Value Equation, clear CTAs, and building extreme trust). \n\nWrite a highly SEO-optimized, engaging blog article to rank the landing page for a business named "${profile.business_name || 'This Company'}".\n\nBusiness Context & Mission:\n"${profile.mission_statement || 'Providing top-tier services and maximum value to our customers.'}"\n\nHere is their current active inventory/products to feature naturally in the article:\n${inventoryContext}\n\nInstructions:\n1. Write a compelling, value-driven article that builds trust, highlights the immense value of these specific products/services, and drives the reader to take action.\n2. Format the body content strictly with HTML tags (<h2>, <p>, <b>, <ul>, <li>). Do NOT use markdown.\n3. Keep the total length under 400 words. \n4. Return ONLY a valid JSON object with the following exact keys: 'title', 'excerpt' (1 compelling sentence), 'content' (the HTML body), and 'tags' (array of 3 to 5 SEO keywords). Do not include markdown formatting blocks (like \`\`\`json) around the output.`;

        try {
            const result = await generateObject({
              model: google('gemini-3-flash-preview'),
              prompt: prompt + `\n\nGenerate this uniquely for today's timestamp: ${new Date().toISOString()}`,
              schema: z.object({
                title: z.string(),
                excerpt: z.string(),
                content: z.string(),
                tags: z.array(z.string())
              })
            });
            article = result.object;
        } catch (e: any) {
            lastError = `Gemini API Error: ${e.message}`;
            console.error(lastError);
            continue;
        }

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
             lastError = `Database Insert Error: ${insertError.message}`;
             console.error(lastError);
        } else {
             successCount++;
        }
    }

    if (specificUserId && successCount === 0) {
        return NextResponse.json({ success: false, error: lastError || "Unknown error occurred during generation." }, { status: 400 });
    }

    return NextResponse.json({ success: true, generated: successCount });

  } catch (error: any) {
    console.error("Auto-Blog Fatal Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}