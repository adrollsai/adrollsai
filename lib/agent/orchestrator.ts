import { SupabaseClient } from '@supabase/supabase-js';
import { createCrmTools } from './tools/crm';
import { createInventoryTools } from './tools/inventory';
import { createWhatsAppTools } from './tools/whatsapp';
import { createVoiceTools } from './tools/voice';
import { createCreativeTools } from './tools/creatives';
import { createCodeRunnerTool } from './tools/code_runner';
import { createHumanApprovalTool } from './tools/human_approval';
import { createDelegationTool } from './tools/delegation';
import { createMetaAdsMcpTools } from './mcp/meta-ads-mcp';
import { createWebFetchMcpTools } from './mcp/web-fetch-mcp';
import { createSchedulerTools } from './tools/scheduler';
import { createVercelMcpTools } from './mcp/vercel-mcp';
import { createSupabaseMcpTools } from './mcp/supabase-mcp';

export async function createAgentContext(supabase: SupabaseClient, userId: string) {
  // Fetch user profile and business context
  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, mission_statement, custom_prompt, currency, business_info, role, email')
    .eq('id', userId)
    .maybeSingle();

  const isSuperAdmin = profile?.role === 'super_admin' || profile?.email === 'rchopra489@gmail.com';

  // Fetch quick metrics and sample catalog offerings to understand this business
  const [{ count: leadCount }, { count: catalogCount }, { data: sampleOfferings }] = await Promise.all([
    supabase.from('leads').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('properties').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('properties').select('title, category, price').eq('user_id', userId).limit(5),
  ]);

  const offeringsSummary = (sampleOfferings || []).map(o => `${o.title} (${o.category || 'General'})`).join(', ') || 'None listed yet';

  const tools = {
    ...createCrmTools(supabase, userId),
    ...createInventoryTools(supabase, userId),
    ...createWhatsAppTools(supabase, userId),
    ...createVoiceTools(supabase, userId),
    ...createCreativeTools(supabase, userId),
    ...createCodeRunnerTool(),
    ...createSchedulerTools(supabase, userId),
    ...createHumanApprovalTool(supabase, userId),
    ...createDelegationTool(),
    ...createMetaAdsMcpTools(supabase, userId),
    ...createWebFetchMcpTools(),
    // Super Admin MCP Suite (Full Supabase and Vercel infrastructure control)
    ...(isSuperAdmin ? createVercelMcpTools(true) : {}),
    ...(isSuperAdmin ? createSupabaseMcpTools(supabase, true) : {}),
  };

  const systemPrompt = `
You are Nobogent Omni-Agent, the elite autonomous AI business copilot and digital operator for this company.
You solve problems proactively across customer acquisition, CRM pipeline, Meta advertising, WhatsApp outreach, voice calling, and creative media.
You are completely generalized and domain-adaptive: adapt your terminology, pitch angles, and workflows to this business's specific industry (whether e-commerce, services, healthcare, consulting, hospitality, manufacturing, or real estate).

OPERATING BUSINESS CONTEXT:
- Business Name: ${profile?.business_name || 'Nobogent Business Partner'}
- Mission / Business Focus: ${profile?.mission_statement || profile?.business_info || 'Sales, marketing, and client operations'}
- Brand Custom Instructions: ${profile?.custom_prompt || 'Deliver premium, high-converting customer experiences'}
- Currency: ${profile?.currency || 'INR'}
- Active Leads in CRM: ${leadCount || 0}
- Active Offerings / Inventory Items: ${catalogCount || 0}
- Sample Offerings: ${offeringsSummary}

CORE BEHAVIORS & PROTOCOLS:
1. DOMAIN ADAPTATION:
   - Reflect the company's industry, product lineup, and customer persona in all copy, ads, and messaging.
   - Do NOT assume a single industry unless specified by the user's business profile or catalog items.
2. PROBLEM SOLVING ON THE FLY:
   - If the user provides a CSV, spreadsheet, raw phone numbers, or complex calculation request, use 'execute_data_code' or 'parse_csv_or_excel' to parse, format, and calculate the data dynamically.
3. RICH PREVIEWS & ARTIFACTS:
   - When the user asks to preview a WhatsApp template, flyer, or message, use 'preview_whatsapp_message' or generate clean, self-contained HTML/CSS inside an artifact.
4. HUMAN-IN-THE-LOOP (SAFETY & BUDGET GUARANTEE):
   - Whenever executing a high-impact, billable, or mass operation (e.g. sending WhatsApp broadcast to > 1 contact, making automated phone calls, deleting catalog items, spending ad budget), ALWAYS call 'request_human_approval' before triggering the bulk action.
   - This sends an instant push notification to the user and displays an interactive approval card in chat.
5. TONE & CLARITY:
   - Be authoritative, crisp, and executive. Avoid unnecessary pleasantries. Summarize numbers and next steps clearly.
`.trim();

  return {
    systemPrompt,
    tools,
  };
}
