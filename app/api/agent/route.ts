import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { streamText, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

// Define the fallback type locally so it never throws a red squiggle
type ChatMessage = {
    role: 'user' | 'assistant' | 'system' | 'data';
    content: string;
};

// Configure the Kie API using the OpenAI wrapper
const kie = createOpenAI({
  baseURL: 'https://api.kie.ai/gemini-3-flash/v1',
  apiKey: process.env.KIE_API_KEY || '',
});

export const maxDuration = 60; 

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Safely type the incoming messages using our local type
    const { messages }: { messages: ChatMessage[] } = await req.json();

    // 2. GATHER BUSINESS CONTEXT
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    const { count: productCount } = await supabase.from('properties').select('*', { count: 'exact', head: true }).eq('user_id', user.id);
    
    // 3. HORMOZI SYSTEM PROMPT
    const systemPrompt = `
      You are an elite, direct-response business mentor and AI operator built into AdRolls.
      Your operating framework is based heavily on Alex Hormozi's "$100M Offers" and "$100M Leads".
      
      CONTEXT:
      User's Business: ${profile?.business_name || 'A growing business'}
      Current Products/Services Active: ${productCount || 0}
      
      YOUR ROLE:
      1. ADVISE: Give highly practical, no-fluff, high-impact advice. Focus on value stacking, risk reversal, and clear CTAs.
      2. OPERATE: You have tools to take action. If the user asks to add a product, draft a post, launch an ad, or check leads, USE YOUR TOOLS.
      3. CLARIFY: If a user asks you to launch an ad but doesn't specify the budget or target audience, ask them clarifying questions before calling the tool.
      
      TONE: Direct, confident, analytical, and encouraging. Focus on unit economics. Talk like a seasoned operator.
    `;

    // 4. THE AGENT ENGINE
    const result = streamText({
      model: kie('gemini-3-flash'), 
      system: systemPrompt,
      messages: messages as any, // Cast to any to bypass strict SDK versioning checks
      maxSteps: 5, 
      tools: {
        
        // TOOL 1: ADD INVENTORY
        addProduct: tool({
          description: 'Add a new product or real estate block (e.g., Manali 2 RK) to the database.',
          parameters: z.object({
            title: z.string().describe('Name of the product or service'),
            description: z.string().describe('Details, price, and offer stack'),
          }),
          execute: async ({ title, description }) => {
            const { error } = await supabase.from('properties').insert({
              user_id: user.id,
              title,
              description,
              status: 'Active',
              property_type: 'Generated via Agent',
              auto_generate: false
            });
            if (error) return { success: false, message: error.message };
            return { success: true, message: `Successfully added ${title} to inventory.` };
          },
        }),

        // TOOL 2: CHECK LEADS
        checkLeads: tool({
           description: 'Fetches recent leads to give the user a status update on their sales pipeline.',
           parameters: z.object({}), 
           execute: async () => {
             const { data, error } = await supabase
                .from('leads') 
                .select('name, status, created_at')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(5);
             if (error) return { success: false, message: "Could not fetch leads right now." };
             return { success: true, recentLeads: data };
           }
        }),

        // TOOL 3: DRAFT SOCIAL POST
        draftSocialPost: tool({
          description: 'Drafts a social media post. Always use this when a user wants to post to Facebook/Instagram. It requires user confirmation.',
          parameters: z.object({
            platform: z.enum(['facebook', 'instagram', 'universal']),
            caption: z.string().describe('The Hormozi-style direct response copy for the post'),
          }),
          execute: async ({ platform, caption }) => {
            return { platform, caption, status: 'awaiting_user_confirmation' };
          },
        }),

        // TOOL 4: CREATE AD CAMPAIGN
        draftAdCampaign: tool({
            description: 'Drafts a Meta/Facebook Ad Campaign. Requires budget, audience, and copy. Will pause and ask the user to confirm in the UI.',
            parameters: z.object({
                campaignName: z.string().describe('A catchy internal name for the campaign'),
                dailyBudget: z.number().describe('Daily budget in INR'),
                targetAudience: z.string().describe('Who we are targeting (e.g., Tech Professionals in Delhi)'),
                adCopy: z.string().describe('The primary text for the ad'),
            }),
            execute: async (args) => {
                return { ...args, status: 'awaiting_user_confirmation' };
            }
        })
      },
    });

    return result.toDataStreamResponse();
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}