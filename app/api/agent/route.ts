import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { streamText, generateText, tool, convertToModelMessages, stepCountIs } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

export const maxDuration = 60;

const LOG_FILE = 'c:/Users/USER/Desktop/adrollsai/adrollsai/agent_chat_debug.log';

export async function POST(req: Request) {
  try {
    const { messages, userInstructions } = await req.json();
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Force overwrite debug log for a clean start on each new request
    try { fs.writeFileSync(LOG_FILE, `=== AGENT CHAT DEBUG [${new Date().toISOString()}] ===\n\n--- INPUT MESSAGES ---\n${JSON.stringify(messages, null, 2)}\n\n`); } catch (e) {
      console.error("Failed to write log file:", e);
    }

    // 1. GATHER DYNAMIC CONTEXT
    const { data: profile } = await supabase.from('profiles').select('business_name').eq('id', user.id).single();
    const { data: properties } = await supabase.from('properties').select('title').eq('user_id', user.id);
    const availableTitles = properties?.map(p => p.title).join(', ') || 'None';

    const systemMessage = `
      You are the AdRolls AI Growth Strategist. You operate on the modern "Andromeda" philosophy: CREATIVES ARE THE NEW TARGETING. 
      You have the ability to "SEE" ad visuals to provide deep analysis.

      REASONING PROTOCOL:
      1. ANALYZE LIST: Call 'check_live_campaigns'.
      2. DEEP DIVE: Call 'get_campaign_details' for the relevant ID.
      3. VISUAL INSPECTION: Call 'inspect_ad_creative' for EACH unique image/video URL found. If there are 3 different ads, inspect all 3.
      4. STRATEGIC REASONING: Synthesize why the winners won and the losers lost. 
      5. PIVOT: Call 'generate_ad_creative' with a prompt that solves the visual weaknesses you just identified.
      6. FINALIZE: Call 'draft_ad_campaign' once the creative is ready.

      STRICT RULES:
      - Do NOT skip inspection. You must "see" the ads before suggesting changes.
      - If you see multiple unique URLs, inspect all of them to get a complete picture.
      - Use the detailed analysis from 'inspect_ad_creative' to write your NEW design prompts.
      - CONCISENESS: Keep your analysis sharp. No markdown.
    `;

    console.log(`[Agent] Processing request for user: ${user.id}`);
    const result = streamText({
      model: google('gemini-3-flash-preview'),
      system: systemMessage,
      messages: await convertToModelMessages(messages, {
        ignoreIncompleteToolCalls: true,
      }),
      stopWhen: stepCountIs(10),
      tools: {
        // ... (tools remain the same)
        get_product_details: tool({
          description: "Fetches full assets (images, description) for a product title from Supabase. Use this to gather context.",
          inputSchema: z.object({
            titleQuery: z.string().describe("The product title to search for (even if vague)."),
          }),
          execute: async ({ titleQuery }) => {
            console.log(`[Tool] get_product_details: ${titleQuery}`);
            const { data } = await supabase
              .from('properties')
              .select('title, description, prop_images, images')
              .ilike('title', `%${titleQuery}%`)
              .eq('user_id', user.id)
              .maybeSingle();

            if (data) {
              return { success: true, product: data };
            }
            return { success: false, message: "Product details not found in inventory." };
          },
        }),
        check_live_campaigns: tool({
          description: "Fetches live active campaigns from Meta Ads including performance metrics (spend, impressions, clicks, cpc). Use this to analyze running campaigns.",
          inputSchema: z.object({}),
          execute: async () => {
            console.log(`[Tool] check_live_campaigns`);
            const { data: userProfile } = await supabase.from('profiles').select('facebook_token, ad_account_id').eq('id', user.id).single();
            if (!userProfile?.facebook_token || !userProfile?.ad_account_id) {
              return { success: false, message: "User has not connected Meta Ads account." };
            }
            const url = `https://graph.facebook.com/v19.0/${userProfile.ad_account_id}/campaigns?fields=id,name,status,effective_status,objective,start_time,insights{spend,impressions,clicks,cpc,inline_link_click_ctr}&limit=20&access_token=${userProfile.facebook_token}`;
            const res = await fetch(url);
            const data = await res.json();

            // Clean up the data for the LLM
            const campaigns = (data.data || []).map((c: any) => ({
              id: c.id,
              name: c.name,
              status: c.effective_status,
              objective: c.objective,
              metrics: c.insights?.data?.[0] || { message: "No recent performance data" }
            }));

            return { success: !data.error, campaigns, error: data.error };
          },
        }),
        inspect_ad_creative: tool({
          description: "Performs multimodal visual analysis on an ad creative image. Use this to 'see' the ad and analyze its visual hierarchy, hooks, and strategy.",
          inputSchema: z.object({
            imageUrl: z.string().describe("The URL of the ad image to analyze."),
          }),
          execute: async ({ imageUrl }) => {
            console.log(`[Tool] inspect_ad_creative: ${imageUrl}`);
            try {
              const imageRes = await fetch(imageUrl);
              const imageBuffer = await imageRes.arrayBuffer();

              const { text } = await generateText({
                model: google('gemini-3-flash-preview'),
                messages: [
                  {
                    role: 'user',
                    content: [
                      { type: 'text', text: "Analyze this ad creative. What is the visual hook? What is the hierarchy? Is it professional? Why might it be failing or succeeding in a real estate context?" },
                      { type: 'image', image: new Uint8Array(imageBuffer) },
                    ],
                  },
                ],
              });
              return { analysis: text };
            } catch (e: any) {
              console.error("Multimodal analysis failed:", e);
              return { error: `Analysis failed: ${e.message}` };
            }
          },
        }),
        get_campaign_details: tool({
          description: "Fetches granular details for a specific campaign ID, including Ad copy and Creative images. Use this to see 'what is being used' in a specific campaign.",
          inputSchema: z.object({
            campaignId: z.string().describe("The ID of the campaign to analyze."),
          }),
          execute: async ({ campaignId }) => {
            console.log(`[Tool] get_campaign_details: ${campaignId}`);
            const { data: userProfile } = await supabase.from('profiles').select('facebook_token').eq('id', user.id).single();
            if (!userProfile?.facebook_token) return { success: false, message: "No token." };
            const url = `https://graph.facebook.com/v19.0/${campaignId}/ads?fields=name,status,creative{name,title,body,image_url,thumbnail_url}&access_token=${userProfile.facebook_token}`;
            const res = await fetch(url);
            const data = await res.json();
            return { success: !data.error, ads: data.data || [], error: data.error };
          },
        }),
        check_crm_leads: tool({
          description: "Show CRM lead pipeline. Requires user confirmation to view in detail, but returns summary metrics immediately.",
          inputSchema: z.object({
            status: z.string().optional().describe("Filter by status"),
          }),
          execute: async ({ status }) => {
            console.log(`[Tool] check_crm_leads: ${status}`);
            let query = supabase.from('leads').select('id, status', { count: 'exact' }).eq('user_id', user.id);
            if (status) query = query.eq('status', status);
            const { count: totalLeads } = await query;
            const { count: newLeads } = await supabase.from('leads').select('id', { count: 'exact' }).eq('user_id', user.id).eq('status', 'NEW');

            return { totalLeads: totalLeads || 0, newLeads: newLeads || 0 };
          },
        }),
        generate_ad_creative: tool({
          description: "Triggers the visual image generation pipeline. Yields control to the client UI.",
          inputSchema: z.object({
            propertyTitle: z.string().describe("Title of product"),
            propertyDescription: z.string().describe("Description for the prompt"),
            imageUrls: z.array(z.string()).describe("List of image URLs to feed the AI"),
            instructions: z.string().describe("User's design style preferences"),
          }),
        }),
        draft_ad_campaign: tool({
          description: "Drafts a new Meta ad campaign and yields control to the client for user confirmation.",
          inputSchema: z.object({
            campaignName: z.string().describe("Descriptive name for the campaign"),
            imageUrl: z.string().optional().describe("URL of the AI-generated image to use"),
            adCopy: z.string().describe("The generated ad copy (Primary Text)"),
            headline: z.string().describe("The ad headline"),
          }),
        }),
        draft_social_post: tool({
          description: "Drafts a new social media post and yields control to the client for user confirmation.",
          inputSchema: z.object({
            platform: z.string().describe("Platform to post on (e.g., 'facebook', 'instagram')"),
            content: z.string().describe("The generated post content"),
          }),
        }),
      },
      onStepFinish: async ({ text, toolCalls, toolResults, reasoning }) => {
        const logEntry = `--- STEP FINISH ---\nTEXT: ${text}\nREASONING: ${reasoning || 'N/A'}\nTOOLS: ${JSON.stringify(toolCalls, null, 2)}\nRESULTS: ${JSON.stringify(toolResults, null, 2)}\n\n`;
        try { fs.appendFileSync(LOG_FILE, logEntry); } catch (e) { }
        console.log(`[Agent Step] Text: ${text}`);
        if (reasoning) console.log(`[Agent Reasoning] ${reasoning}`);
        if (toolCalls?.length) console.log(`[Agent Tools] ${toolCalls.map(t => t.toolName).join(', ')}`);
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error: any) {
    console.error(`[Agent Error] ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}