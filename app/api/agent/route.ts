import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const rawMessages = body.messages || [];

    // 1. GATHER DYNAMIC CONTEXT
    const { data: profile } = await supabase.from('profiles').select('business_name').eq('id', user.id).single();
    const { data: properties } = await supabase.from('properties').select('title').eq('user_id', user.id);
    const availableTitles = properties?.map(p => p.title).join(', ') || 'None';

    const systemMessage = `
      You are the AdRolls AI Operator. You act as an MCP (Model Context Protocol) engine.
      USER BUSINESS: ${profile?.business_name}
      AVAILABLE PRODUCTS: ${availableTitles}

      OPERATING PROTOCOL:
      - If user asks for an image/creative but you don't have the assets (URLs/Description), call 'get_product_details' first.
      - Once you have the assets, call 'generate_image_creative'.
      - For CRM or Campaigns, call the respective tools.
      - FORMATTING: Never use Markdown. Keep text extremely concise.
    `;

    // 2. CONFORM TO KIE.AI SSE/OPENAPI SPEC (Fixed role consecutive & content structure)
    const apiMessages: any[] = [{ role: "developer", content: [{ type: "text", text: systemMessage }] }];
    let lastRole = "developer";

    for (const m of rawMessages) {
       let role = m.role === 'assistant' ? 'assistant' : 'user';
       let text = m.content || "[Task Progressing...]";
       if (role === lastRole) {
          apiMessages[apiMessages.length - 1].content[0].text += `\n\n${text}`;
       } else {
          apiMessages.push({ role, content: [{ type: "text", text }] });
          lastRole = role;
       }
    }

    // 3. MCP TOOL DEFINITIONS (Ensuring every property has a description to avoid proxy crashes)
    const agentTools = [
      {
        type: "function",
        function: {
          name: "get_product_details",
          description: "Fetches full assets (images, description) for a product title. Call this if you need images to generate a creative.",
          parameters: {
            type: "object",
            properties: {
              titleQuery: { type: "string", description: "The product title to search for (even if vague)." }
            },
            required: ["titleQuery"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "generate_image_creative",
          description: "Triggers the visual image generation pipeline.",
          parameters: {
            type: "object",
            properties: {
              propertyTitle: { type: "string", description: "Title of product" },
              propertyDescription: { type: "string", description: "Description for the prompt" },
              imageUrls: { type: "array", items: { type: "string" }, description: "List of image URLs to feed the AI" },
              instructions: { type: "string", description: "User's design style preferences" }
            },
            required: ["propertyTitle", "propertyDescription", "imageUrls"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "check_crm_leads",
          description: "Show CRM lead pipeline.",
          parameters: {
            type: "object",
            properties: { status: { type: "string", description: "Filter by status" } }
          }
        }
      }
    ];

    const response = await fetch('https://api.kie.ai/gemini-3-flash/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.KIE_API_KEY}` },
      body: JSON.stringify({
        model: 'gemini-3-flash',
        messages: apiMessages,
        tools: agentTools,
        stream: true
      })
    });

    return new Response(response.body, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}