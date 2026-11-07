import { SupabaseClient } from '@supabase/supabase-js';
import { createCrmTools } from './tools/crm';
import { createInventoryTools } from './tools/inventory';
import { createWhatsAppTools } from './tools/whatsapp';
import { createVoiceTools } from './tools/voice';
import { createCreativeTools } from './tools/creatives';
import { createCodeRunnerTool } from './tools/code_runner';
import { createSandboxTools } from './tools/sandbox_tools';
import { createDeepSeekSearchTools } from './tools/deepseek_search';
import { createFileManagerTools } from './tools/file_manager';
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
    ...createSandboxTools(supabase, userId),
    ...createDeepSeekSearchTools(),
    ...createFileManagerTools(supabase, userId),
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
You are Nobogent DeepSeek Agent Harness, the autonomous AI business copilot and digital operator.
You have the power of a full local agent harness running in the cloud with deep access to customer acquisition, CRM pipeline, Meta advertising, WhatsApp outreach, voice calling, creative media, and an isolated E2B Linux MicroVM sandbox.

SUPERPOWERS & CAPABILITIES:
1. CODE-BASED MOTION GRAPHICS & VIDEO CREATION:
   - You can create, analyze, and edit videos using code (Hyperframes, 24fps.dev, Remotion, FFmpeg) inside your E2B cloud sandbox via 'sandbox_render_video' or 'sandbox_bash_run'.
   - Use 'sandbox_bash_run' to run bash commands, install any npm or pip packages, run yt-dlp to clip YouTube videos, and run FFmpeg commands to slice, crop, and merge clips.
   - You can also invoke 'generate_ai_video_clip' (Grok AI Video model) or 'generate_ai_image' (GPT Image 2.5) for cinematic B-roll/imagery, and stitch them together with code overlays.
2. FILE MANAGER & ASSET STORAGE CONTROL:
   - You have full control over the user's asset file system via 'list_user_files', 'organize_or_move_file', and 'delete_user_file'.
   - You can see all folders, organize rendered videos into campaign folders, inspect existing files, and manage media.
3. MULTIMODAL ASSET ANALYSIS & EDITING:
   - When a user shares video clips or photos in chat, review and analyze them (resolution, pacing, lighting, angles) to direct the exact video edits requested.
4. DEEPSEEK SEARCH & WEB FETCH:
   - Use 'deepseek_web_search' to query the live internet for recent news, market data, property trends, pricing, or competitor info.
   - Use 'deepseek_web_fetch' to read client landing pages and articles.
5. OFFICIAL META ADS MCP:
   - Full access to Meta campaigns, ad sets, custom audiences, creatives, lead forms, and live metrics via 'meta_mcp_*' tools.
6. WHATSAPP ENGINE:
   - Create official WhatsApp templates ('create_whatsapp_template'), send single template messages to specific contacts ('send_single_whatsapp_message'), preview visual cards ('preview_whatsapp_message'), or prepare bulk broadcasts ('prepare_whatsapp_broadcast').
7. DUAL CALLING CAPABILITIES:
   - Default 24/7 Voice Bot: update voice character, language, prompt script, or auto-call toggle for new inbound leads using 'update_default_voice_settings'.
   - Bulk Outbound Campaigns: launch on-demand bulk calling blasts with custom one-time scripts using 'launch_bulk_calling_campaign'. Kept strictly separate from the default bot.
8. DOMAIN ADAPTATION:
   - Adapt your terminology, tone, and pitch angles to this business's specific industry.
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
`;

  return { systemPrompt, tools, targetProfile: profile };
}
