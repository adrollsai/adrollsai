import { createClient } from '@supabase/supabase-js';
import { generateText, tool, stepCountIs } from 'ai';
import { google } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { createCreativeSessionToken } from '@/utils/creative-token';
import { recordFeedbackOrIssue, getRecentLearnings } from './feedback-engine';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

/**
 * Text tasks strictly use DeepSeek v4.1-Flash ('deepseek-chat') via OpenAI-compatible chat completions
 */
function getLLMModel() {
    const rawKey = process.env.DEEPSEEK_API_KEY || '';
    const cleanKey = rawKey.replace(/^["']|["']$/g, '').trim();
    if (cleanKey) {
        const deepseek = createOpenAI({
            baseURL: 'https://api.deepseek.com/v1',
            apiKey: cleanKey,
            ...({ compatibility: 'compatible' } as any)
        });
        return deepseek.chat('deepseek-chat'); // DeepSeek v4.1-Flash via /chat/completions
    }
    console.warn('[OWNER ORCHESTRATOR] DEEPSEEK_API_KEY not found in environment, falling back to Gemini 2.5 Flash');
    return google('gemini-2.5-flash');
}

/**
 * Transcribes an incoming WhatsApp voice note using Gemini's native audio capability.
 */
export async function transcribeVoiceNote(audioBuffer: Buffer, mimeType = 'audio/ogg'): Promise<string> {
    try {
        const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
        if (!apiKey) return '';
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const base64Audio = audioBuffer.toString('base64');
        const res = await model.generateContent([
            {
                inlineData: {
                    mimeType: mimeType.includes('ogg') ? 'audio/ogg' : 'audio/mp3',
                    data: base64Audio
                }
            },
            {
                text: "Transcribe this voice note spoken by a business owner accurately. If spoken in Hindi/Hinglish or English, transcribe the exact spoken words. Output ONLY the transcription without quotes."
            }
        ]);

        return res.response.text().trim();
    } catch (err: any) {
        console.error('[OWNER BOT] Audio transcription error:', err);
        return '';
    }
}

/**
 * Handles incoming messages from business owners to the official Nobogent Master Bot.
 */
export async function processOwnerMessage(params: {
    userId: string;
    messageText: string;
    fromPhone: string;
}): Promise<string> {
    const { userId, messageText, fromPhone } = params;

    // Fetch user profile and current agent policies
    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, business_name, business_info')
        .eq('id', userId)
        .single();

    const [policyRes, learnings] = await Promise.all([
        supabaseAdmin.from('agent_policies').select('*').eq('user_id', userId).maybeSingle(),
        getRecentLearnings(userId)
    ]);
    const policy = policyRes.data;

    const businessName = profile?.business_name || 'your business';

    const systemPrompt = `
You are Nobogent, the Executive AI Sales Director for ${businessName}.
You are interacting directly with the business owner on WhatsApp.
Your job is to:
1. Provide pipeline metrics and conversion performance on demand (including WhatsApp template responses & calls).
2. Execute business commands across everything the app can do:
   - Launch full Meta (Facebook & Instagram) ad campaigns with custom daily budgets, geographic regions, selected creatives, and Instant Lead Forms with custom qualification questions.
   - Submit new WhatsApp templates (including Image Header templates) for Meta approval.
   - Send specific approved WhatsApp templates to targeted audience segments.
   - Launch or adjust voice calling campaigns for targeted audiences with specific talking points / pitch instructions.
   - Update agent policies (pausing/resuming calls, hours, intensity).
3. Search and summarize hot or qualified leads.
4. Always respond concisely, professionally, and warmly. Format cleanly with bullet points and emojis suitable for WhatsApp. Never use markdown headers (like # or ##).

LIVE TASK PROGRESS & STATUS TRACKING PROTOCOL:
When the owner asks about the current status, live progress, or results of any task (Meta ads campaign, voice calling, broadcasts):
- Use 'get_live_task_status' to fetch real-time milestone progress.
- Report the status clearly with current stage, active numbers, and live metrics.

CONTINUOUS FEEDBACK & ISSUE TRACKING PROTOCOL:
Whenever the owner corrects you, points out a mistake, expresses dissatisfaction (e.g. "That's wrong", "I asked for X not Y", "Fix this ad copy"), or if you detect an operational discrepancy:
1. DO NOT argue or get defensive.
2. ALWAYS invoke 'record_feedback_or_issue' to log the incident into the Nobogent Engineering Feedback Engine.
3. Acknowledge the correction with humility, mention the tracking ticket number returned, and adapt your response immediately according to the owner's instructions.

ASSET & CREATIVE EXPLORATION PROTOCOL (CRITICAL):
When the owner asks to see, preview, or select creatives, images, videos, floor plans, or assets for a product/project/campaign:
- DO NOT attempt to dump dozens of images/videos directly into the WhatsApp chat, as it clutters the chat and lacks selection controls.
- ALWAYS invoke 'open_creative_session_browser' with the product or campaign name.
- Present the generated session browser link clearly to the owner. Explain that they can tap the link to open the full visual browser on mobile to swipe through high-res videos/photos, filter by aspect ratio (Reels 9:16 vs Post 1:1), and multi-select or confirm their choices seamlessly.

GUARDIAN ANOMALY DETECTION & SELF-HEALING PROTOCOL (CRITICAL):
You have an autonomous Guardian Sentinel system.
1. When asked about system health, outreach status, if anything is wrong, or if you suspect calling/outreach failures, call 'detect_and_analyze_anomalies'.
2. If anomalies are found:
   - Clearly report what is wrong (symptoms)
   - Explain the root cause
   - Propose the exact recommended self-healing action (e.g. Pause calling & reset leads, Disable failing campaign, etc.)
   - Ask for confirmation: "Shall I execute this self-healing fix now?"
3. If the owner confirms (e.g. "Yes", "Fix it", "Go ahead", "Execute self-healing", "Do it"):
   - Immediately call 'execute_self_healing' with the appropriate action type.
   - Confirm the successful remediation clearly in your response!

AMBIGUITY & CLARIFICATION PROTOCOL (CRITICAL):
If the business owner gives a high-level command without all required details, DO NOT guess or fail blindly.
Instead:
1. Check available options using your inspection tools (e.g. use 'list_available_templates' to see what's approved).
2. Proactively ask for the missing parameters, listing available options clearly so the owner can reply simply.
Examples:
- If owner says "Launch an ad campaign": Ask for campaign name, budget, targeting locations, and any custom form questions if not specified.
- If owner says "Send an image template for approval": Ask for template name, the image URL or concept, and the message text.
- If owner says "Send a template to my leads": Use 'list_available_templates' to see approved templates, then ask: "Which template should I send, and which audience (e.g. All New Leads, Qualified Leads) should we target?"
- If owner says "Call our leads": Ask which audience and what specific instructions, offers, or talking points the AI caller should pitch.

CURRENT BUSINESS POLICIES:
- Calling Enabled: ${policy?.calling_enabled !== false}
- Contact Intensity: ${policy?.contact_intensity || 'medium'}
- Business Hours: ${policy?.business_hours_start || '09:30'} to ${policy?.business_hours_end || '19:00'}
- Appointment Goal: ${policy?.appointment_goal || 'site_visit'}

RECENT ADAPTATIONS & LEARNINGS FOR THIS ACCOUNT:
${learnings.length > 0 ? learnings.join('\n') : 'No previous corrections logged.'}
`;

    const result = await generateText({
        model: getLLMModel(),
        system: systemPrompt,
        prompt: messageText,
        stopWhen: stepCountIs(6),
        tools: {
            get_business_stats: tool({
                description: "Get real-time pipeline metrics (new leads, qualified, booked visits, calls) for today or this week.",
                inputSchema: z.object({
                    timeframe: z.enum(['today', 'yesterday', 'this_week']).default('today')
                }),
                execute: async ({ timeframe }) => {
                    const now = new Date();
                    let startDate = new Date();
                    if (timeframe === 'today') {
                        startDate.setHours(0, 0, 0, 0);
                    } else if (timeframe === 'yesterday') {
                        startDate.setDate(startDate.getDate() - 1);
                        startDate.setHours(0, 0, 0, 0);
                    } else {
                        startDate.setDate(startDate.getDate() - 7);
                    }

                    const [leadsCount, bookedCount, callCount] = await Promise.all([
                        supabaseAdmin.from('leads').select('*', { count: 'exact', head: true }).eq('assigned_to', userId).gte('created_at', startDate.toISOString()),
                        supabaseAdmin.from('leads').select('*', { count: 'exact', head: true }).eq('assigned_to', userId).not('booked_time', 'is', null).gte('booked_time', startDate.toISOString()),
                        supabaseAdmin.from('call_logs').select('*', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', startDate.toISOString())
                    ]);

                    return {
                        timeframe,
                        newLeads: leadsCount.count || 0,
                        bookedVisits: bookedCount.count || 0,
                        callsTriggered: callCount.count || 0
                    };
                }
            }),

            list_available_templates: tool({
                description: "Lists approved or pending WhatsApp message templates in Meta.",
                inputSchema: z.object({}),
                execute: async () => {
                    const { data: prof } = await supabaseAdmin
                        .from('profiles')
                        .select('whatsapp_waba_id, whatsapp_access_token, facebook_token')
                        .eq('id', userId)
                        .single();

                    const wabaId = prof?.whatsapp_waba_id || process.env.DEV_WHATSAPP_WABA_ID;
                    const token = prof?.whatsapp_access_token || prof?.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;
                    if (!wabaId || !token) return { error: 'No WhatsApp account connected' };

                    const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?limit=50&fields=name,status,category,components`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const d = await res.json();
                    const templates = (d.data || []).map((t: any) => ({
                        name: t.name,
                        status: t.status,
                        category: t.category,
                        hasImageHeader: t.components?.some((c: any) => c.type === 'HEADER' && c.format === 'IMAGE')
                    }));
                    return { templates };
                }
            }),

            submit_whatsapp_template: tool({
                description: "Submits a new WhatsApp message template (with optional Image Header) to Meta for approval.",
                inputSchema: z.object({
                    name: z.string().describe("Template name in lowercase_with_underscores"),
                    category: z.enum(['MARKETING', 'UTILITY']).default('MARKETING'),
                    bodyText: z.string().describe("The message text. Supports {{1}} variables."),
                    headerImageUrl: z.string().optional().describe("URL of image sample for header if image template"),
                    buttonText: z.string().optional().describe("Quick reply button text e.g. 'Interested', 'Book Visit'")
                }),
                execute: async ({ name, category, bodyText, headerImageUrl, buttonText }) => {
                    const { data: prof } = await supabaseAdmin
                        .from('profiles')
                        .select('whatsapp_waba_id, whatsapp_access_token, facebook_token')
                        .eq('id', userId)
                        .single();

                    const wabaId = prof?.whatsapp_waba_id || process.env.DEV_WHATSAPP_WABA_ID;
                    const token = prof?.whatsapp_access_token || prof?.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;
                    if (!wabaId || !token) return { success: false, error: 'No WhatsApp account connected' };

                    const cleanName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
                    const components: any[] = [];

                    if (headerImageUrl) {
                        components.push({
                            type: 'HEADER',
                            format: 'IMAGE',
                            example: { header_handle: [headerImageUrl] }
                        });
                    }

                    components.push({
                        type: 'BODY',
                        text: bodyText
                    });

                    if (buttonText) {
                        components.push({
                            type: 'BUTTONS',
                            buttons: [{ type: 'QUICK_REPLY', text: buttonText }]
                        });
                    }

                    const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: cleanName,
                            category,
                            language: 'en_US',
                            components
                        })
                    });
                    const metaRes = await res.json();
                    if (metaRes.error) {
                        return { success: false, error: metaRes.error.message || 'Meta template submission error' };
                    }
                    return { success: true, templateId: metaRes.id, status: 'PENDING_APPROVAL', name: cleanName };
                }
            }),

            send_whatsapp_broadcast: tool({
                description: "Sends an approved WhatsApp template to a specific audience segment.",
                inputSchema: z.object({
                    templateName: z.string().describe("Exact approved template name in Meta"),
                    audienceFilter: z.object({
                        pipelineStage: z.string().optional().describe("e.g. 'New', 'Qualified', 'Lost'"),
                        source: z.string().optional().describe("e.g. 'Meta', 'Manual Import'"),
                        limit: z.number().default(50)
                    })
                }),
                execute: async ({ templateName, audienceFilter }) => {
                    let q = supabaseAdmin
                        .from('leads')
                        .select('id, name, phone, pipeline_stage')
                        .eq('assigned_to', userId);

                    if (audienceFilter.pipelineStage) q = q.eq('pipeline_stage', audienceFilter.pipelineStage);
                    if (audienceFilter.source) q = q.eq('source', audienceFilter.source);
                    const { data: targetLeads } = await q.limit(audienceFilter.limit || 50);

                    if (!targetLeads || targetLeads.length === 0) {
                        return { success: false, message: 'No leads found matching the target audience.' };
                    }

                    const { data: prof } = await supabaseAdmin
                        .from('profiles')
                        .select('whatsapp_phone_number_id, whatsapp_access_token, facebook_token')
                        .eq('id', userId)
                        .single();

                    const phoneId = prof?.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID;
                    const token = prof?.whatsapp_access_token || prof?.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;

                    let sentCount = 0;
                    for (const lead of targetLeads) {
                        let cleanPhone = (lead.phone || '').replace(/\D/g, '');
                        if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
                        if (!cleanPhone) continue;

                        try {
                            const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    messaging_product: 'whatsapp',
                                    to: cleanPhone,
                                    type: 'template',
                                    template: {
                                        name: templateName,
                                        language: { code: 'en_US' }
                                    }
                                })
                            });
                            if (res.ok) sentCount++;
                        } catch (e) {}
                    }

                    return {
                        success: true,
                        templateName,
                        targetedCount: targetLeads.length,
                        sentCount,
                        message: `Dispatched template '${templateName}' to ${sentCount}/${targetLeads.length} leads in audience.`
                    };
                }
            }),

            manage_voice_campaign: tool({
                description: "Creates, updates, or triggers an AI voice calling campaign with custom instructions for a targeted audience.",
                inputSchema: z.object({
                    campaignName: z.string().describe("Campaign name e.g. 'Weekend Offer Calls'"),
                    audienceFilter: z.object({
                        pipelineStages: z.array(z.string()).optional().describe("e.g. ['New']"),
                        limit: z.number().default(50)
                    }),
                    customInstructions: z.string().describe("Specific instructions or special offers for the AI caller to pitch"),
                    startCallingNow: z.boolean().default(true).describe("Whether to immediately begin dialing the leads")
                }),
                execute: async ({ campaignName, audienceFilter, customInstructions, startCallingNow }) => {
                    const { data: campaign } = await supabaseAdmin
                        .from('voice_campaigns')
                        .upsert({
                            user_id: userId,
                            name: campaignName,
                            custom_prompt: customInstructions,
                            status: startCallingNow ? 'running' : 'paused',
                            audience_filter: audienceFilter
                        }, { onConflict: 'user_id,name' })
                        .select()
                        .single();

                    let q = supabaseAdmin.from('leads').select('id').eq('assigned_to', userId);
                    if (audienceFilter.pipelineStages && audienceFilter.pipelineStages.length > 0) {
                        q = q.in('pipeline_stage', audienceFilter.pipelineStages);
                    }
                    const { data: leads } = await q.limit(audienceFilter.limit || 50);
                    const leadIds = (leads || []).map(l => l.id);

                    if (leadIds.length > 0 && campaign) {
                        await supabaseAdmin
                            .from('leads')
                            .update({ voice_campaign_id: campaign.id })
                            .in('id', leadIds);
                    }

                    if (startCallingNow) {
                        const { dispatchNextCall } = require('@/utils/voice-helper');
                        dispatchNextCall(supabaseAdmin, userId).catch(console.error);
                    }

                    return {
                        success: true,
                        campaignName,
                        assignedLeadsCount: leadIds.length,
                        status: startCallingNow ? 'CALLING_STARTED' : 'CAMPAIGN_SAVED',
                        instructionsPitched: customInstructions
                    };
                }
            }),

            launch_meta_campaign: tool({
                description: "Launches a live Meta (Facebook/Instagram) ad campaign with target locations, daily budget, selected creatives, and an Instant Lead Form with custom questions.",
                inputSchema: z.object({
                    campaignName: z.string().describe("Descriptive campaign title e.g. 'The Marq - Sector 54 Launch'"),
                    productOrProjectName: z.string().optional().describe("Associated property or product title"),
                    campaignType: z.enum(['instant_form', 'whatsapp_chat', 'website']).default('instant_form'),
                    dailyBudget: z.number().describe("Daily budget in INR (e.g. 2000)"),
                    geographicRegions: z.array(z.string()).describe("Names of cities or regions e.g. ['Gurgaon', 'South Delhi']"),
                    formQuestions: z.array(z.object({
                        label: z.string().describe("Question label e.g. 'Preferred Unit Type?'"),
                        type: z.enum(['MULTIPLE_CHOICE', 'SHORT_ANSWER']).default('MULTIPLE_CHOICE'),
                        options: z.array(z.string()).optional().describe("Choices for MULTIPLE_CHOICE e.g. ['2BHK', '3BHK', 'Penthouse']")
                    })).optional().describe("Custom qualification questions to ask leads on the Meta instant form"),
                    creativeAssetIds: z.array(z.string()).optional().describe("Asset IDs of creatives to use"),
                    customInstructions: z.string().optional().describe("Specific ad copy instructions or pitch")
                }),
                execute: async ({ campaignName, productOrProjectName, campaignType, dailyBudget, geographicRegions, formQuestions, creativeAssetIds, customInstructions }) => {
                    const { data: prof } = await supabaseAdmin
                        .from('profiles')
                        .select('facebook_token, facebook_ad_account_id, facebook_page_id, selected_page_token, business_name, contact_number, privacy_policy_url')
                        .eq('id', userId)
                        .single();

                    const fbToken = prof?.facebook_token || process.env.DEV_META_ACCESS_TOKEN;
                    const adAccountId = prof?.facebook_ad_account_id || process.env.DEV_META_AD_ACCOUNT_ID;
                    const pageId = prof?.facebook_page_id || process.env.DEV_META_PAGE_ID;

                    if (!fbToken || !adAccountId || !pageId) {
                        return {
                            success: false,
                            error: 'Meta advertising accounts are not connected for this profile. Please connect Facebook Ad Account and Page in settings.'
                        };
                    }

                    // Format locations
                    const metaLocations = geographicRegions.map(reg => ({
                        name: reg,
                        type: 'city',
                        country: 'IN'
                    }));

                    // Format custom questions
                    const metaCustomQuestions = (formQuestions || []).map(q => ({
                        type: q.type === 'MULTIPLE_CHOICE' ? 'MULTIPLE_CHOICE' : 'CUSTOM',
                        label: q.label,
                        options: q.options || []
                    }));

                    const jobPayload: any = {
                        facebookToken: fbToken,
                        adAccountId: adAccountId.replace('act_', ''),
                        pageId,
                        selected_page_token: prof?.selected_page_token || null,
                        campaign_name: campaignName,
                        campaignType,
                        dailyBudget,
                        metaLocationsStr: JSON.stringify(metaLocations),
                        customQuestionsStr: JSON.stringify(metaCustomQuestions),
                        assetIds: creativeAssetIds || [],
                        businessName: prof?.business_name || 'Our Company',
                        contactNumber: prof?.contact_number || '',
                        privacyPolicyUrl: prof?.privacy_policy_url || 'https://adrolls.in/privacy',
                        customInstructions
                    };

                    const { data: job, error: jobErr } = await supabaseAdmin
                        .from('campaign_jobs')
                        .insert({
                            user_id: userId,
                            status: 'pending',
                            payload: jobPayload
                        })
                        .select('id')
                        .single();

                    if (jobErr || !job) {
                        return { success: false, error: jobErr?.message || 'Failed to create campaign job record' };
                    }

                    // Trigger async campaign processor in background
                    try {
                        const { runCampaignJob } = await import('@/utils/campaign-processor');
                        runCampaignJob(job.id, jobPayload).catch(e => console.error('[AGENT CAMPAIGN LAUNCH] Error:', e));
                    } catch (e: any) {
                        console.warn('[AGENT CAMPAIGN LAUNCH] Dynamic import error:', e.message);
                    }

                    return {
                        success: true,
                        jobId: job.id,
                        campaignName,
                        budget: `₹${dailyBudget}/day`,
                        regions: geographicRegions,
                        campaignType,
                        questionsConfigured: metaCustomQuestions.map(q => ({
                            question: q.label,
                            type: q.type,
                            options: q.options
                        })),
                        message: `Meta instant form campaign '${campaignName}' successfully queued with ₹${dailyBudget}/day in ${geographicRegions.join(', ')} with ${metaCustomQuestions.length} custom qualifying questions.`
                    };
                }
            }),

            open_creative_session_browser: tool({
                description: "Generates an interactive visual session browser link where the owner can view, preview, filter (images/videos/AI), and select creatives on a mobile webview.",
                inputSchema: z.object({
                    productOrCampaignName: z.string().optional().describe("Specific campaign or product title, e.g. 'The Marq' or 'Aerocity'"),
                    tab: z.enum(['creatives', 'locations']).default('creatives')
                }),
                execute: async ({ productOrCampaignName, tab }) => {
                    let campaignId: string | undefined = undefined;
                    if (productOrCampaignName) {
                        const { data: job } = await supabaseAdmin
                            .from('campaign_jobs')
                            .select('id, payload')
                            .eq('user_id', userId)
                            .ilike('payload->>campaign_name', `%${productOrCampaignName}%`)
                            .order('created_at', { ascending: false })
                            .limit(1)
                            .maybeSingle();

                        if (job) campaignId = job.id;
                    }

                    if (!campaignId) {
                        const { data: latestJob } = await supabaseAdmin
                            .from('campaign_jobs')
                            .select('id')
                            .eq('user_id', userId)
                            .order('created_at', { ascending: false })
                            .limit(1)
                            .maybeSingle();
                        if (latestJob) campaignId = latestJob.id;
                    }

                    const cleanPhone = (fromPhone || '').replace(/\D/g, '');
                    const sessionToken = createCreativeSessionToken({
                        userId,
                        campaignId,
                        phone: cleanPhone
                    });

                    let appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com';
                    if (appUrl.includes('localhost') || appUrl.includes('local.nobogent.com')) {
                        appUrl = 'https://app.nobogent.com';
                    }
                    const sessionUrl = `${appUrl}/select-creatives?token=${sessionToken}${tab === 'locations' ? '&tab=locations' : ''}`;

                    return {
                        success: true,
                        sessionUrl,
                        productName: productOrCampaignName || 'all assets',
                        instructionsForAgent: `Share this interactive session browser link with the owner: ${sessionUrl}. Mention that they can open it to visually preview, swipe through all high-res photos and videos, and multi-select or confirm their choices.`
                    };
                }
            }),

            get_whatsapp_performance: tool({
                description: "Get analytics on WhatsApp template messages: delivery counts, and customer responses/replies.",
                inputSchema: z.object({
                    templateName: z.string().optional()
                }),
                execute: async () => {
                    const { data: chatLogs } = await supabaseAdmin
                        .from('whatsapp_chats')
                        .select('id, direction, message_text, created_at')
                        .eq('user_id', userId)
                        .order('created_at', { ascending: false })
                        .limit(200);

                    const chats = chatLogs || [];
                    const inbound = chats.filter(c => c.direction === 'inbound');
                    const outbound = chats.filter(c => c.direction === 'outbound');

                    const responseRate = outbound.length > 0 ? ((inbound.length / outbound.length) * 100).toFixed(1) : '0.0';

                    return {
                        totalTemplatesOutbound: outbound.length,
                        totalCustomerResponses: inbound.length,
                        responseRatePercentage: `${responseRate}%`,
                        sampleRecentReplies: inbound.slice(0, 5).map(i => i.message_text)
                    };
                }
            }),

            update_agent_policy: tool({
                description: "Update autonomous agent policies such as calling enabled/disabled, contact intensity, or calling hours.",
                inputSchema: z.object({
                    callingEnabled: z.boolean().optional(),
                    contactIntensity: z.enum(['low', 'medium', 'high']).optional(),
                    businessHoursStart: z.string().optional(),
                    businessHoursEnd: z.string().optional(),
                    customInstructions: z.string().optional()
                }),
                execute: async (updates) => {
                    const { error } = await supabaseAdmin
                        .from('agent_policies')
                        .upsert({
                            user_id: userId,
                            ...updates,
                            updated_at: new Date().toISOString()
                        }, { onConflict: 'user_id' });

                    if (error) return { success: false, error: error.message };
                    return { success: true, updated: updates };
                }
            }),

            search_hot_leads: tool({
                description: "Searches the CRM for hot, qualified, or unreached leads.",
                inputSchema: z.object({
                    stage: z.string().optional().describe("e.g. QUALIFIED, APPOINTMENT_BOOKED, NEW"),
                    limit: z.number().default(5)
                }),
                execute: async ({ stage, limit }) => {
                    let q = supabaseAdmin
                        .from('leads')
                        .select('name, phone, budget, timeline, pipeline_stage, notes')
                        .eq('assigned_to', userId)
                        .order('created_at', { ascending: false })
                        .limit(limit);

                    if (stage) q = q.eq('pipeline_stage', stage);
                    const { data } = await q;
                    return { leads: data || [] };
                }
            }),

            detect_and_analyze_anomalies: tool({
                description: "Scans recent call logs, WhatsApp outreach, and campaigns to detect operational anomalies or failures.",
                inputSchema: z.object({
                    scope: z.enum(['all', 'voice_calls', 'whatsapp', 'campaigns']).default('all')
                }),
                execute: async ({ scope }) => {
                    const anomalies: any[] = [];
                    const now = new Date();
                    const oneDayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

                    // 1. Check Voice Calling Health
                    if (scope === 'all' || scope === 'voice_calls') {
                        const { data: recentCalls } = await supabaseAdmin
                            .from('call_logs')
                            .select('status, duration, phone_number, created_at')
                            .eq('user_id', userId)
                            .gte('created_at', oneDayAgo)
                            .order('created_at', { ascending: false })
                            .limit(25);

                        const calls = recentCalls || [];
                        if (calls.length > 0) {
                            const failedCalls = calls.filter(c => ['NOT_CONNECTED', 'REJECTED', 'FAILED', 'BUSY'].includes(c.status) || c.duration === 0);
                            const failureRate = (failedCalls.length / calls.length) * 100;

                            // Check for consecutive drops
                            let consecutiveFails = 0;
                            for (const c of calls) {
                                if (['NOT_CONNECTED', 'REJECTED', 'FAILED', 'BUSY'].includes(c.status) || c.duration === 0) {
                                    consecutiveFails++;
                                } else {
                                    break;
                                }
                            }

                            if (consecutiveFails >= 3 || (calls.length >= 5 && failureRate >= 60)) {
                                anomalies.push({
                                    component: 'VOICE_CALLING',
                                    severity: 'HIGH',
                                    title: 'High Call Drop / Rejection Rate',
                                    description: `${consecutiveFails} recent consecutive calls failed or dropped with 0s duration (Failure rate: ${failureRate.toFixed(0)}%).`,
                                    rootCause: 'Telecom trunk route rejection, unassigned caller ID, or leads numbers unreachable.',
                                    recommendedAction: 'PAUSE_AND_REQUEUE_CALLS',
                                    actionDescription: 'Temporarily pause voice dialing and reset unreached leads back to queue for a later calling window.'
                                });
                            }
                        }

                        // Check Caller Number Assignment
                        const { data: prof } = await supabaseAdmin
                            .from('profiles')
                            .select('vobiz_phone_number, voice_twilio_number')
                            .eq('id', userId)
                            .single();

                        if (!prof?.vobiz_phone_number && !prof?.voice_twilio_number) {
                            anomalies.push({
                                component: 'VOICE_CALLING',
                                severity: 'CRITICAL',
                                title: 'No Dedicated Caller ID Assigned',
                                description: 'Account does not have a dedicated outbound calling number assigned.',
                                rootCause: 'Telephony configuration missing in profile.',
                                recommendedAction: 'DISABLE_CALLING_POLICY',
                                actionDescription: 'Pause outbound calling agent until a dedicated virtual number is assigned.'
                            });
                        }
                    }

                    // 2. Check WhatsApp Outreach Health
                    if (scope === 'all' || scope === 'whatsapp') {
                        const { data: prof } = await supabaseAdmin
                            .from('profiles')
                            .select('whatsapp_phone_number_id, whatsapp_access_token, facebook_token')
                            .eq('id', userId)
                            .single();

                        const hasToken = !!(prof?.whatsapp_access_token || prof?.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN);
                        const hasPhoneId = !!(prof?.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID);

                        if (!hasToken || !hasPhoneId) {
                            anomalies.push({
                                component: 'WHATSAPP_OUTREACH',
                                severity: 'HIGH',
                                title: 'WhatsApp Meta Credentials Missing',
                                description: 'WhatsApp Business Account or Access Token is not properly linked.',
                                rootCause: 'OAuth disconnection or token expiration.',
                                recommendedAction: 'NOTIFY_ADMIN_REAUTH',
                                actionDescription: 'Prompt admin to re-authenticate Meta integration in settings.'
                            });
                        }
                    }

                    // 3. Check Stuck Leads in Intermediate Stages
                    if (scope === 'all' || scope === 'campaigns') {
                        const twoHoursAgo = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();
                        const { data: stuckLeads } = await supabaseAdmin
                            .from('leads')
                            .select('id, name')
                            .eq('assigned_to', userId)
                            .eq('pipeline_stage', 'Contacting')
                            .lte('updated_at', twoHoursAgo)
                            .limit(10);

                        if (stuckLeads && stuckLeads.length > 0) {
                            anomalies.push({
                                component: 'LEAD_PIPELINE',
                                severity: 'MEDIUM',
                                title: 'Leads Stuck in Contacting State',
                                description: `${stuckLeads.length} leads have been stuck in 'Contacting' status for over 2 hours.`,
                                rootCause: 'Worker process timeout or unhandled webhook callback.',
                                recommendedAction: 'RESET_LEAD_QUEUE',
                                actionDescription: 'Reset stuck leads back to NEW pipeline stage so the agent can retry outreach.'
                            });
                        }
                    }

                    return {
                        healthy: anomalies.length === 0,
                        detectedCount: anomalies.length,
                        anomalies
                    };
                }
            }),

            execute_self_healing: tool({
                description: "Executes an autonomous self-healing remediation action for a confirmed operational anomaly.",
                inputSchema: z.object({
                    actionType: z.enum([
                        'PAUSE_AND_REQUEUE_CALLS',
                        'DISABLE_CALLING_POLICY',
                        'RESET_LEAD_QUEUE',
                        'ENABLE_CALLING_POLICY'
                    ]).describe("The remediation action confirmed by the owner"),
                    reason: z.string().describe("Brief reason for the remediation")
                }),
                execute: async ({ actionType, reason }) => {
                    if (actionType === 'PAUSE_AND_REQUEUE_CALLS' || actionType === 'DISABLE_CALLING_POLICY') {
                        // 1. Pause calling in agent policy
                        await supabaseAdmin
                            .from('agent_policies')
                            .upsert({
                                user_id: userId,
                                calling_enabled: false,
                                updated_at: new Date().toISOString()
                            }, { onConflict: 'user_id' });

                        // 2. Pause any currently running voice campaigns
                        await supabaseAdmin
                            .from('voice_campaigns')
                            .update({ status: 'paused' })
                            .eq('user_id', userId)
                            .eq('status', 'running');

                        // 3. Reset failed leads from today back to NEW
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        const { data: resetLeads } = await supabaseAdmin
                            .from('leads')
                            .update({ pipeline_stage: 'New' })
                            .eq('assigned_to', userId)
                            .in('pipeline_stage', ['Failed', 'DNP', 'Contacting'])
                            .gte('created_at', today.toISOString())
                            .select('id');

                        return {
                            success: true,
                            actionExecuted: actionType,
                            message: `Autonomous self-healing applied successfully: Outbound calling paused to protect budget/reputation, and ${(resetLeads || []).length} unreached leads restored to 'New' queue for later dispatch.`
                        };
                    }

                    if (actionType === 'RESET_LEAD_QUEUE') {
                        const { data: restored } = await supabaseAdmin
                            .from('leads')
                            .update({ pipeline_stage: 'New' })
                            .eq('assigned_to', userId)
                            .eq('pipeline_stage', 'Contacting')
                            .select('id');

                        return {
                            success: true,
                            actionExecuted: actionType,
                            message: `Self-healing completed: ${(restored || []).length} stuck leads restored back to 'New' status in pipeline.`
                        };
                    }

                    if (actionType === 'ENABLE_CALLING_POLICY') {
                        await supabaseAdmin
                            .from('agent_policies')
                            .upsert({
                                user_id: userId,
                                calling_enabled: true,
                                updated_at: new Date().toISOString()
                            }, { onConflict: 'user_id' });

                        return {
                            success: true,
                            actionExecuted: actionType,
                            message: "Outbound calling policy re-enabled successfully."
                        };
                    }

                    return { success: false, message: 'Unrecognized action type' };
                }
            }),

            record_feedback_or_issue: tool({
                description: "Logs a user correction, dissatisfaction, complaint, or detected operational discrepancy into the Nobogent Engineering Feedback Engine for issue tracking and continuous improvement.",
                inputSchema: z.object({
                    category: z.enum(['CAMPAIGN_CREATION', 'VOICE_CALLING', 'WHATSAPP_MESSAGING', 'UNDERSTANDING_ERROR', 'TOOL_FAILURE', 'GENERAL']),
                    discrepancy: z.string().describe("What went wrong, was misunderstood, or failed"),
                    userCorrection: z.string().optional().describe("What the user actually specified or wanted"),
                    suggestedFix: z.string().optional().describe("Immediate corrective action taken or proposed")
                }),
                execute: async ({ category, discrepancy, userCorrection, suggestedFix }) => {
                    const res = await recordFeedbackOrIssue({
                        userId,
                        source: 'USER_CORRECTION',
                        category,
                        userPrompt: messageText,
                        discrepancy,
                        userCorrection,
                        suggestedFix
                    });
                    return {
                        success: true,
                        ticketNumber: res.ticketNumber,
                        message: `Issue logged under Ticket #${res.ticketNumber}. The Nobogent core team has been notified and this correction is registered for future turns.`
                    };
                }
            }),

            get_live_task_status: tool({
                description: "Gets real-time live execution status and milestone progress for recent tasks (Meta campaigns, voice campaigns, broadcasts).",
                inputSchema: z.object({
                    taskType: z.enum(['all', 'meta_campaign', 'voice_campaign', 'whatsapp_broadcast']).default('all')
                }),
                execute: async ({ taskType }) => {
                    const results: any = {};

                    // 1. Meta campaign jobs
                    if (taskType === 'all' || taskType === 'meta_campaign') {
                        const { data: recentJobs } = await supabaseAdmin
                            .from('campaign_jobs')
                            .select('id, status, payload, created_at, updated_at')
                            .eq('user_id', userId)
                            .order('created_at', { ascending: false })
                            .limit(3);

                        results.recentCampaignJobs = (recentJobs || []).map(j => ({
                            jobId: j.id,
                            campaignName: j.payload?.campaign_name || 'Ad Campaign',
                            status: j.status,
                            budget: j.payload?.dailyBudget ? `₹${j.payload.dailyBudget}/day` : 'N/A',
                            startedAt: j.created_at,
                            lastUpdated: j.updated_at
                        }));
                    }

                    // 2. Voice campaigns & calling
                    if (taskType === 'all' || taskType === 'voice_campaign') {
                        const { data: voiceCamps } = await supabaseAdmin
                            .from('voice_campaigns')
                            .select('id, name, status, created_at')
                            .eq('user_id', userId)
                            .order('created_at', { ascending: false })
                            .limit(3);

                        const { data: recentCalls } = await supabaseAdmin
                            .from('call_logs')
                            .select('status')
                            .eq('user_id', userId)
                            .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());

                        const calls = recentCalls || [];
                        results.activeVoiceCampaigns = (voiceCamps || []).map(vc => ({
                            name: vc.name,
                            status: vc.status,
                            totalCallsToday: calls.length,
                            connected: calls.filter(c => c.status === 'CONNECTED').length,
                            failedOrMissed: calls.filter(c => ['NOT_CONNECTED', 'FAILED', 'BUSY'].includes(c.status)).length
                        }));
                    }

                    return results;
                }
            })
        }
    });

    return result.text || "Understood! I've updated your settings.";
}

/**
 * Generates the Morning Executive Briefing text for 9:00 AM dispatch.
 */
export async function generateDailyMorningBriefing(userId: string): Promise<string> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [leadsToday, visitsToday] = await Promise.all([
        supabaseAdmin.from('leads').select('*', { count: 'exact', head: true }).eq('assigned_to', userId).gte('created_at', today.toISOString()),
        supabaseAdmin.from('leads').select('name, booked_time').eq('assigned_to', userId).gte('booked_time', today.toISOString()).lte('booked_time', new Date(today.getTime() + 24 * 3600 * 1000).toISOString())
    ]);

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('business_name')
        .eq('id', userId)
        .single();

    const name = profile?.business_name || 'Team';
    const visits = visitsToday.data || [];

    return `Good morning ${name}! ☀️ Here is your Nobogent update for today:\n\n• New Leads: ${leadsToday.count || 0}\n• Scheduled Visits Today: ${visits.length}\n${visits.map((v: any) => `  - ${v.name}: ${new Date(v.booked_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`).join('\n')}\n\nOur autonomous agent will commence outreach at 10:00 AM. Let me know if you would like to pause or adjust any settings!`;
}
