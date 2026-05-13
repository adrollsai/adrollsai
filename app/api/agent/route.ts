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

    // Detailed request logging
    const logPrefix = `[Agent][${new Date().toISOString()}]`;
    console.log(`${logPrefix} New Request. Messages: ${messages?.length}`);

    // Force overwrite debug log for a clean start on each new request
    try { 
        fs.writeFileSync(LOG_FILE, `=== AGENT CHAT DEBUG [${new Date().toISOString()}] ===\n\n--- INPUT MESSAGES ---\n${JSON.stringify(messages, null, 2)}\n\n`); 
    } catch (e: any) {
        console.error(`${logPrefix} Log write failed:`, e.message);
    }

    // 1. GATHER DYNAMIC CONTEXT
    const { data: profile } = await supabase
      .from('profiles')
      .select('business_name, mission_statement, custom_prompt')
      .eq('id', user.id)
      .single();
    const { data: properties } = await supabase.from('properties').select('title').eq('user_id', user.id);
    const availableTitles = properties && Array.isArray(properties) ? properties.map(p => p.title).join(', ') : 'None';

    const systemMessage = `
      You are the AdRolls AI Growth Strategist. You operate on the modern "Andromeda" philosophy: CREATIVES ARE THE NEW TARGETING. 
      You have the ability to "SEE" ad visuals to provide deep analysis.

      REASONING PROTOCOL (CREATIVE GENERATION):
      1. ANALYZE PRODUCT: Call 'get_product_details' to understand assets.
      2. STRATEGIZE: Call 'generate_creative_angles' based on product context and Hormozi frameworks.
      3. REVIEW: Present angles to the user for selection.
      
      REASONING PROTOCOL (CAMPAIGN ANALYSIS):
      1. ANALYZE LIST: Call 'check_live_campaigns'.
      2. DEEP DIVE: Call 'get_campaign_details' for the relevant ID.
      3. VISUAL INSPECTION: Call 'inspect_ad_creative' for EACH unique image/video URL found.
      4. STRATEGIC REASONING: Synthesize why the winners won and the losers lost. 
      5. PIVOT: Call 'generate_creative_angles' or 'generate_ad_creative' to solve weaknesses.
      6. FINALIZE: Call 'draft_ad_campaign' once the creative is ready.

      STRICT RULES:
      - Do NOT skip inspection when analyzing campaigns.
      - Use 'generate_creative_angles' as the first step for new creative tasks.
      - CONCISENESS: Keep your analysis sharp. No markdown.

      BUSINESS CONTEXT (PRIORITY):
      Business Name: ${profile?.business_name || 'Not provided'}
      Business Mission: ${profile?.mission_statement || 'Not provided'}
      Global Visual Style Preference (MUST PRIORITIZE): ${profile?.custom_prompt || 'No specific style provided'}
      
      INSTRUCTIONS FOR EMPTY INVENTORY:
      If 'get_product_details' returns no results or if the user has no items in 'availableTitles', 
      you MUST proceed using ONLY the Business Name and Mission Statement above to create general brand creatives or service-based ads.
    `;

    console.log(`[Agent] Processing request for user: ${user.id}`);
    const result = streamText({
      model: google('gemini-3-flash-preview'),
      system: systemMessage,
      messages: await (async () => {
        // AI SDK 5.0+ convertToModelMessages expects UIMessages with 'parts'.
        // If we have simple CoreMessages (like from manual AdsPage fetch), skip conversion.
        if (Array.isArray(messages) && messages.length > 0 && !messages[0].parts) {
          return messages;
        }
        return convertToModelMessages(messages, {
          ignoreIncompleteToolCalls: true,
        });
      })(),
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
            const { data, error } = await supabase
              .from('properties')
              .select('title, description, image_url, images')
              .ilike('title', `%${titleQuery}%`)
              .eq('user_id', user.id)
              .maybeSingle();

            if (error) {
                console.error(`[Tool Error] get_product_details:`, error);
                return { success: false, message: `Database error: ${error.message}` };
            }

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
        generate_creative_angles: tool({
          description: "Generates multiple strategic ad 'angles' or 'hooks' for a product using Alex Hormozi tactics (Value Equation). Use this before generating images.",
          inputSchema: z.object({
            productTitle: z.string().describe("The product title"),
            productDescription: z.string().describe("The product description"),
            quantity: z.number().describe("Number of angles to generate"),
            additionalInstructions: z.string().optional().describe("User's extra context"),
            previousContext: z.string().optional().describe("Context of previously generated angles to avoid duplicates"),
          }),
          execute: async ({ productTitle, productDescription, quantity, additionalInstructions, previousContext }) => {
            console.log(`[Tool] generate_creative_angles`);
            
            const prompt = `
              You are a world-class Direct Response Marketing Strategist. 
              Generate ${quantity || 5} unique high-converting ad angles/hooks for this product:
              
              PRODUCT: ${productTitle || 'Unknown Product'}
              DESCRIPTION: ${productDescription || 'No description provided'}
              USER INSTRUCTIONS: ${additionalInstructions || 'None'}
              VISUAL STYLE PREFERENCE (MUST FOLLOW): ${profile?.custom_prompt || 'None'}
              PREVIOUS ANGLES (AVOID THESE): ${previousContext || 'None'}

              FRAMEWORK: Use Alex Hormozi's Value Equation (Dream Outcome, Perceived Likelihood of Achievement, Time Delay, Effort & Sacrifice).
              
              For each angle, provide:
              1. Title (The Hook)
              2. Brief (Marketing strategy and 'why' it works)
              3. Visual Concept (What should the 'Raw/Organic' image look like?)
              
              FORMAT: JSON array of objects with keys: title, brief, visual_concept.
            `;

            const { text } = await generateText({
              model: google('gemini-3-flash-preview'), // Using latest Flash
              prompt,
            });

            try {
              // Extract JSON if wrapped in markdown
              const jsonStr = text.includes('```json') ? text.split('```json')[1].split('```')[0] : text;
              const angles = JSON.parse(jsonStr);
              return { success: true, angles };
            } catch (e) {
              return { success: true, raw_text: text };
            }
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

    return result.toTextStreamResponse();
  } catch (error: any) {
    console.error(`[Agent Error] ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}