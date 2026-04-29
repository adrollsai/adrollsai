import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const messages = body.messages || [];

    // 1. GATHER BUSINESS CONTEXT TO FEED THE AI
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    const { count: productCount } = await supabase.from('properties').select('*', { count: 'exact', head: true }).eq('user_id', user.id);
    
    // 2. THE HORMOZI SYSTEM PROMPT (Using 'developer' role as per Kie.ai Gemini 3 Flash docs)
    const systemMessage = {
      role: 'developer', 
      content: `
        You are an elite, direct-response business mentor and AI operator built into AdRolls.
        Your operating framework is based heavily on Alex Hormozi's "$100M Offers" and "$100M Leads".
        
        CONTEXT:
        User's Business: ${profile?.business_name || 'A growing business'}
        Current Products/Services Active: ${productCount || 0}
        
        YOUR ROLE:
        1. ADVISE: Give highly practical, no-fluff, high-impact advice. Focus on value stacking, risk reversal, reducing friction, and clear CTAs.
        2. OPERATE: You have tools to take action. If the user asks to post to social media, launch an ad, or set a cron job, USE YOUR TOOLS.
        3. CLARIFY FIRST: If a user asks you to launch an ad but doesn't specify the budget, offer, or target audience, ask them clarifying questions BEFORE calling the tool.
        4. PERMISSIONS: You cannot post automatically. Explain that you will draft it and give them a button to confirm.
        
        TONE: Direct, confident, analytical, and encouraging. Talk like a seasoned operator who cares about LTV to CAC ratios.
      `
    };

    // 3. DEFINE NATIVE TOOLS (No Zod required, just OpenAPI JSON Schema)
    const agentTools = [
      {
        type: "function",
        function: {
          name: "draft_social_post",
          description: "Drafts a social media post. Always use this when a user wants to post to Facebook or Instagram.",
          parameters: {
            type: "object",
            properties: {
              platform: { 
                type: "string", 
                enum: ["facebook", "instagram", "universal"] 
              },
              caption: { 
                type: "string", 
                description: "The Hormozi-style direct response copy for the post" 
              }
            },
            required: ["platform", "caption"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "draft_ad_campaign",
          description: "Drafts a Meta/Facebook Ad Campaign. Requires budget, audience, and copy.",
          parameters: {
            type: "object",
            properties: {
              campaignName: { type: "string", description: "A catchy internal name for the campaign" },
              dailyBudget: { type: "number", description: "Daily budget in INR" },
              targetAudience: { type: "string", description: "Who we are targeting" },
              adCopy: { type: "string", description: "The primary text for the ad" }
            },
            required: ["campaignName", "dailyBudget", "targetAudience", "adCopy"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "schedule_cron_task",
          description: "Drafts a scheduled task/cron job (e.g., auto-blogging, lead reminders).",
          parameters: {
            type: "object",
            properties: {
              taskType: { type: "string", enum: ["auto-blog", "optimize-ads", "reminders"] },
              frequency: { type: "string", description: "e.g., 'daily', 'weekly'" }
            },
            required: ["taskType", "frequency"]
          }
        }
      }
    ];

    // Combine system instructions with the chat history
    const apiMessages = [systemMessage, ...messages];

    // 4. MAKE THE NATIVE FETCH REQUEST TO KIE.AI
    const payload = {
      model: 'gemini-3-flash',
      messages: apiMessages,
      tools: agentTools,
      stream: true, // Native Server-Sent Events (SSE)
      include_thoughts: true, 
      reasoning_effort: "high"
    };

    const response = await fetch('https://api.kie.ai/gemini-3-flash/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.KIE_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Kie AI API Error: ${errorText}`);
    }

    // 5. PIPE THE STREAM DIRECTLY TO THE FRONTEND
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    console.error("Agent Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}