// app/api/cron/auto-blog/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateObject } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 60; // Increase timeout for Vercel

export async function GET(request: Request) {
    return runSeoCron(request);
}

export async function POST(request: Request) {
    return runSeoCron(request);
}

async function runSeoCron(request: Request) {
  try {
    const url = new URL(request.url);
    const authHeader = request.headers.get('Authorization');
    const cronSecret = url.searchParams.get('cronSecret') || (authHeader ? authHeader.replace('Bearer ', '') : null);

    if (!process.env.CRON_SECRET || cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
    const errors: string[] = [];

    // Process all profiles in parallel to avoid timeout
    const results = await Promise.all(profiles.map(async (profile) => {
        try {
            // --- SUBSCRIPTION CHECK ---
            const { data: usageProfile } = await supabaseAdmin
                .from('profiles')
                .select('seo_articles_used')
                .eq('id', profile.id)
                .single();
            
            const used = usageProfile?.seo_articles_used || 0;
            if (used >= 30) { // PLAN_LIMITS.seo_articles is 30
                console.log(`[SEO Cron] User ${profile.id} reached SEO limit.`);
                return { success: false, userId: profile.id, error: "Limit reached" };
            }

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

            // Fetch previous post titles to avoid repetition
            const { data: previousPosts } = await supabaseAdmin
                .from('posts')
                .select('title')
                .eq('user_id', profile.id)
                .order('created_at', { ascending: false })
                .limit(10);
            
            const previousTopics = previousPosts?.map(p => p.title).join(', ') || 'None';

            const prompt = `
You are a Research-driven SEO Strategist and Content Marketer with 20 years of experience in direct-response growth.

OBJECTIVE: Write a highly relevant, high-converting blog article that ranks on Google and provides MASSIVE value to potential customers.

BUSINESS CONTEXT:
- Name: "${profile.business_name || 'This Company'}"
- Mission/Bio: "${profile.mission_statement || 'Providing top-tier services.'}"
- Products/Services to Feature: 
${inventoryContext}

AVOID REPETITION: 
The following topics have already been covered. DO NOT write about these again:
[${previousTopics}]

STRICT GUIDELINES:
1. RESEARCH-DRIVEN: Simulate industry research. Address a specific pain point or trend relevant to this business.
2. NATURAL BRANDING: Do NOT repeat the business name over and over. Mention it naturally only once or twice (e.g., in the intro or CTA). Focus on the reader's needs.
3. SEO OPTIMIZED: Target high-intent keywords. Use a mix of educational and transactional intent.
4. CONVERSION: Follow Alex Hormozi's value-first framework. Build extreme trust before asking for the sale.
5. FORMAT: Use ONLY HTML tags (<h2>, <p>, <b>, <ul>, <li>). No markdown.
6. LENGTH: 350-450 words.

OUTPUT: Return ONLY a valid JSON object with: 'title', 'excerpt' (compelling), 'content' (HTML), and 'tags' (SEO keywords).`;

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

            const article = result.object;

            const { error: insertError } = await supabaseAdmin.from('posts').insert({
                user_id: profile.id,
                title: article.title,
                excerpt: article.excerpt,
                content: article.content,
                tags: article.tags,
                status: 'published',
                image_url: featuredImage 
            });

            if (insertError) throw insertError;

            // Increment usage
            await supabaseAdmin
                .from('profiles')
                .update({ seo_articles_used: used + 1 })
                .eq('id', profile.id);

            return { success: true };
        } catch (e: any) {
            console.error(`Error processing profile ${profile.id}:`, e.message);
            return { success: false, error: e.message };
        }
    }));

    successCount = results.filter(r => r.success).length;
    const failures = results.filter(r => !r.success).map(r => r.error);

    if (specificUserId && successCount === 0) {
        return NextResponse.json({ success: false, error: failures[0] || "Unknown error occurred during generation." }, { status: 400 });
    }

    return NextResponse.json({ success: true, generated: successCount, failures: failures.length });

  } catch (error: any) {
    console.error("Auto-Blog Fatal Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}