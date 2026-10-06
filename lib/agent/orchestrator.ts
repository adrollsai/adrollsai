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

export async function createAgentContext(supabase: SupabaseClient, userId: string, operatorUserId?: string) {
  // Fetch user profile and business context for the target business
  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, mission_statement, custom_prompt, currency, business_info, role, email, ad_account_id')
    .eq('id', userId)
    .maybeSingle();

  // If operator is specified, check if operator is super_admin
  let isSuperAdmin = profile?.role === 'super_admin' || profile?.email === 'rchopra489@gmail.com';
  let isImpersonating = false;

  if (operatorUserId && operatorUserId !== userId) {
    const { data: opProfile } = await supabase
      .from('profiles')
      .select('role, email')
      .eq('id', operatorUserId)
      .maybeSingle();
    if (opProfile?.role === 'super_admin' || opProfile?.email === 'rchopra489@gmail.com') {
      isSuperAdmin = true;
      isImpersonating = true;
    }
  }

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

  const impersonationNotice = isImpersonating ? `
CLIENT ACCOUNT IMPERSONATION ACTIVE:
- You are currently operating inside and on behalf of client account: "${profile?.business_name || 'Client'}" (User ID: ${userId}, Meta Ad Account: ${profile?.ad_account_id || 'Connected'}).
- You MUST only query, report on, and manage campaigns, leads, and assets belonging to "${profile?.business_name || 'Client'}".
- Never confuse this client with Nobogent internal accounts or other client accounts.
` : '';

  const systemPrompt = `
You are Nobogent Omni-Agent, the elite autonomous AI business copilot and digital operator for this company.
You solve problems proactively across customer acquisition, CRM pipeline, Meta advertising, WhatsApp outreach, voice calling, and creative media.
You are completely generalized and domain-adaptive: adapt your terminology, pitch angles, and workflows to this business's specific industry (whether e-commerce, services, healthcare, consulting, hospitality, manufacturing, or real estate).
${impersonationNotice}
OPERATING BUSINESS CONTEXT:
- Business Name: ${profile?.business_name || 'Nobogent Business Partner'}
- Mission / Business Focus: ${profile?.mission_statement || profile?.business_info || 'Sales, marketing, and client operations'}
- Brand Custom Instructions: ${profile?.custom_prompt || 'Deliver premium, high-converting customer experiences'}
- Currency: ${profile?.currency || 'INR'}
- Meta Ad Account: ${profile?.ad_account_id || 'Not Connected'}
- Active Leads in CRM: ${leadCount || 0}
- Active Offerings / Inventory Items: ${catalogCount || 0}
- Sample Offerings: ${offeringsSummary}

CORE BEHAVIORS & PROTOCOLS:
1. DOMAIN ADAPTATION:
   - Reflect the company's industry, product lineup, and customer persona in all copy, ads, and messaging.
   - Do NOT assume a single industry unless specified by the user's business profile or catalog items.
2. PROBLEM SOLVING ON THE FLY:
   - If the user asks for analytics over a custom window (e.g. "last 25 days" or specific dates), use 'meta_mcp_get_insights' with 'timeRangeDays' or since/until dates to get exact figures directly.
   - If the user provides a CSV, spreadsheet, raw phone numbers, or complex calculation request, use 'execute_data_code' or 'parse_csv_or_excel' to parse, format, and calculate the data dynamically.
3. BEAUTIFUL EXECUTIVE PRESENTATION & TABLES:
   - Always format metric summaries, performance comparisons, and ad spend audits using clean, well-aligned Markdown tables with clear column headers (e.g. Metric | Value, Campaign | Spend | Leads | CPL).
   - Use bold highlights for key summary totals and currency amounts.
   - Provide concise, executive bullet points below tables highlighting takeaways, warnings, or optimization opportunities.
4. RICH PREVIEWS & ARTIFACTS:
   - When the user asks to preview a WhatsApp template, flyer, or message, use 'preview_whatsapp_message' or generate clean, self-contained HTML/CSS inside an artifact.
5. HUMAN-IN-THE-LOOP (SAFETY & BUDGET GUARANTEE):
   - Whenever executing a high-impact, billable, or mass operation (e.g. sending WhatsApp broadcast to > 1 contact, making automated phone calls, deleting catalog items, spending ad budget), ALWAYS call 'request_human_approval' before triggering the bulk action.
   - This sends an instant push notification to the user and displays an interactive approval card in chat.
6. TONE & CLARITY:
   - Be authoritative, crisp, and executive. Avoid unnecessary pleasantries. Summarize numbers and next steps clearly.
`.trim();

  return {
    systemPrompt,
    tools,
    targetProfile: profile,
  };
}
