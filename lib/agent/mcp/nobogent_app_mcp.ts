import { tool } from 'ai';
import { z } from 'zod';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Nobogent App MCP Plugin Suite
 * Exposes Nobogent's core capabilities (CRM, Catalog/Inventory, WhatsApp, AI Voice, Brand & Assets)
 * as a modular, standardized Model Context Protocol (MCP) toolset.
 */
export function createNobogentAppMcpTools(supabase: SupabaseClient, userId: string) {
  return {
    nobogent_brand_get_profile: tool({
      description: 'Nobogent App MCP: Retrieves the business brand identity (business name, hero tagline, description, primary brand color, logo URL, contact number, and currency). Always call this when composing on-brand creatives, videos, or marketing copy.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const { data: profile, error } = await supabase
            .from('profiles')
            .select(`
              business_name, mission_statement, currency, business_info,
              role, email, ad_account_id, logo_url, brand_color, contact_number, address,
              business_landing_hero_title, business_landing_hero_subtitle
            `)
            .eq('id', userId)
            .maybeSingle();

          if (error) throw error;

          return {
            success: true,
            brand: {
              businessName: profile?.business_name || 'Nobogent',
              tagline: profile?.business_landing_hero_title || 'Autonomous Business Operator',
              description: profile?.business_landing_hero_subtitle || profile?.business_info || '',
              brandColor: profile?.brand_color || '#0F172A',
              logoUrl: profile?.logo_url || null,
              contactNumber: profile?.contact_number || '+91 98726 69935',
              address: profile?.address || 'Mohali, Punjab',
              currency: profile?.currency || 'INR',
              adAccountId: profile?.ad_account_id || null,
            },
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    nobogent_crm_query_leads: tool({
      description: 'Nobogent App MCP: Queries leads from the CRM with flexible filters: stage/status, source (ads, website, whatsapp), date timeframe, text search, and limit.',
      inputSchema: z.object({
        stage: z.string().optional().describe('Filter by pipeline stage or status (e.g. New Lead, Qualified, Site Visit, Booking, Won, Lost)'),
        source: z.string().optional().describe('Filter by lead source or ad channel (e.g. "ads", "facebook", "whatsapp", "website")'),
        timeframe: z.enum(['today', 'yesterday', 'this_week', 'all']).default('all').describe('Filter leads by created date'),
        search: z.string().optional().describe('Search query for lead name, phone number, notes, or ad campaign name'),
        limit: z.number().default(50).describe('Maximum number of leads to return (max 100)'),
      }),
      execute: async ({ stage, source, timeframe, search, limit }) => {
        try {
          let query = supabase
            .from('leads')
            .select('id, name, phone, email, pipeline_stage, status, source, ad_name, notes, created_at, budget, summary')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(Math.min(limit || 50, 100));

          if (stage) {
            query = query.or(`pipeline_stage.ilike.%${stage}%,status.ilike.%${stage}%`);
          }

          if (source) {
            const sLower = source.toLowerCase();
            if (sLower === 'ads' || sLower === 'ad' || sLower === 'meta' || sLower === 'facebook') {
              query = query.or('source.ilike.%ad%,source.ilike.%facebook%,source.ilike.%meta%,ad_name.not.is.null');
            } else {
              query = query.ilike('source', `%${source}%`);
            }
          }

          if (timeframe === 'today') {
            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            query = query.gte('created_at', startOfToday.toISOString());
          } else if (timeframe === 'yesterday') {
            const startOfYesterday = new Date();
            startOfYesterday.setDate(startOfYesterday.getDate() - 1);
            startOfYesterday.setHours(0, 0, 0, 0);
            const endOfYesterday = new Date();
            endOfYesterday.setHours(0, 0, 0, 0);
            query = query.gte('created_at', startOfYesterday.toISOString()).lt('created_at', endOfYesterday.toISOString());
          } else if (timeframe === 'this_week') {
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            query = query.gte('created_at', weekAgo.toISOString());
          }

          if (search) {
            query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,notes.ilike.%${search}%,ad_name.ilike.%${search}%`);
          }

          const { data, error } = await query;
          if (error) throw error;

          return {
            success: true,
            count: data?.length || 0,
            leads: data || [],
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    nobogent_crm_create_lead: tool({
      description: 'Nobogent App MCP: Creates a new lead in the Nobogent CRM.',
      inputSchema: z.object({
        name: z.string().describe('Full name of the lead'),
        phone: z.string().describe('Phone number with country code (e.g. +91 9876543210)'),
        email: z.string().optional().describe('Email address'),
        pipeline_stage: z.string().default('New Lead').describe('Initial pipeline stage'),
        source: z.string().default('AI Agent').describe('Lead source'),
        notes: z.string().optional().describe('Initial notes or qualification details'),
      }),
      execute: async ({ name, phone, email, pipeline_stage, source, notes }) => {
        try {
          const { data, error } = await supabase
            .from('leads')
            .insert({
              user_id: userId,
              name,
              phone,
              email: email || null,
              pipeline_stage,
              status: 'new',
              source,
              notes: notes || null,
            })
            .select()
            .single();

          if (error) throw error;

          return {
            success: true,
            lead: data,
            message: `Lead ${name} (${phone}) successfully added to CRM.`,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    nobogent_inventory_search: tool({
      description: 'Nobogent App MCP: Searches company catalog, offerings, products, or property listings.',
      inputSchema: z.object({
        query: z.string().optional().describe('Search query in title or description'),
        category: z.string().optional().describe('Category filter'),
        limit: z.number().default(20).describe('Max results to return'),
      }),
      execute: async ({ query, category, limit }) => {
        try {
          // These column names are the table's REAL ones. This select used to ask for `location`
          // and filter on `category`, neither of which exists on `properties` (they are `address`
          // and `property_type`), so PostgREST rejected the whole query. The error handler then
          // re-issued the SAME broken select as a "fallback" and reported its null data as
          // `success: true, count: 0` — so the agent was truthfully told the catalogue was empty
          // while four live products sat in it, and said so to the owner.
          const COLUMNS =
            'id, title, description, price, address, property_type, status, image_url, images, configurations, created_at';

          let q = supabase
            .from('properties')
            .select(COLUMNS)
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

          if (query && query.trim()) {
            const cleanQ = query.trim().replace(/[%_,]/g, ' ');
            q = q.or(`title.ilike.%${cleanQ}%,description.ilike.%${cleanQ}%`);
          }
          if (category && category.trim()) {
            q = q.ilike('property_type', `%${category.trim()}%`);
          }

          const { data, error } = await q;

          if (error) {
            // A read that FAILED is not an empty catalogue. Saying "0 items" here is how the agent
            // ends up telling an owner their catalogue is empty and then inventing a product.
            const unfiltered = await supabase
              .from('properties')
              .select(COLUMNS)
              .eq('user_id', userId)
              .limit(limit);

            if (unfiltered.error) {
              return {
                success: false,
                error:
                  `Could not read the catalogue: ${error.message}. ` +
                  `The fallback read failed too: ${unfiltered.error.message}.`,
              };
            }

            return {
              success: true,
              count: unfiltered.data?.length || 0,
              items: unfiltered.data || [],
              note:
                'The filtered search failed, so these are ALL items in the catalogue with no filter applied.',
            };
          }

          return {
            success: true,
            count: data?.length || 0,
            items: data || [],
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    nobogent_whatsapp_list_templates: tool({
      description:
        'Nobogent App MCP: Lists the WhatsApp templates you can actually send, with each one\'s approved ' +
        'language, status, and body text so you can see how many {{n}} variables it takes. Reads them from ' +
        'Meta (the source of truth for sending) and merges any this business added locally.',
      inputSchema: z.object({
        approvedOnly: z.boolean().default(true).describe('Only templates Meta has approved, which are the only ones that can be sent'),
      }),
      execute: async ({ approvedOnly }) => {
        // WHY THIS READS FROM META
        // It used to read only the `whatsapp_templates` table, which is empty for an account that has never
        // imported into it — so a business with 35 APPROVED templates on its WABA was told there were none, and
        // "send a test template" was impossible. The templates that can actually be sent live on Meta; the table
        // is a convenience copy. Reading the copy and calling it the list is how that bug happened.
        const sources: string[] = [];
        let templates: any[] = [];
        let warning: string | undefined;

        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('whatsapp_waba_id, whatsapp_access_token')
            .eq('id', userId)
            .maybeSingle();

          const wabaId = String(profile?.whatsapp_waba_id ?? '').trim();
          const token = String(profile?.whatsapp_access_token ?? '').trim();

          if (wabaId && token) {
            const res = await fetch(
              `https://graph.facebook.com/v20.0/${wabaId}/message_templates` +
                '?fields=name,language,status,category,components&limit=250',
              { headers: { Authorization: `Bearer ${token}` } },
            );
            const body: any = await res.json().catch(() => ({}));
            if (body?.error) {
              warning = `Meta refused the template list: ${body.error.message}`;
            } else {
              templates = (body?.data ?? []).map((template: any) => {
                const bodyComponent = (template.components ?? []).find((c: any) => String(c?.type).toUpperCase() === 'BODY');
                const text = String(bodyComponent?.text ?? '');
                const components = template.components ?? [];
                const header = components.find((c: any) => String(c?.type).toUpperCase() === 'HEADER');
                return {
                  name: template.name,
                  language: template.language,
                  languageCode: template.language,
                  status: template.status,
                  category: template.category,
                  body: text,
                  // The count the caller needs: how many values this template will ask for.
                  variables: (text.match(/\{\{\d+\}\}/g) || []).length,
                  hasHeader: Boolean(header),
                  headerFormat: header?.format ?? null,
                  source: 'meta',
                };
              });
              sources.push(`meta (${templates.length})`);
            }
          } else {
            warning = 'WhatsApp is not connected for this account, so Meta could not be asked for templates.';
          }
        } catch (err: any) {
          warning = `Could not reach Meta for the template list: ${err?.message || err}`;
        }

        try {
          const { data } = await supabase
            .from('whatsapp_templates')
            .select('id, name, category, language, status, components')
            .eq('user_id', userId);
          const local = (data ?? []).map((row: any) => ({
            name: row.name,
            language: row.language,
            languageCode: row.language,
            status: row.status,
            category: row.category,
            body: String((row.components ?? []).find?.((c: any) => String(c?.type).toUpperCase() === 'BODY')?.text ?? ''),
            variables: 0,
            source: 'local',
          }));
          if (local.length) sources.push(`local (${local.length})`);
          // Locally-imported rows are older copies of the same templates; Meta wins on a name collision.
          const known = new Set(templates.map((t) => `${t.name}:${t.language}`));
          templates = [...templates, ...local.filter((t) => !known.has(`${t.name}:${t.language}`))];
        } catch {
          /* the local table is optional */
        }

        const filtered = approvedOnly
          ? templates.filter((t) => String(t.status).toUpperCase() === 'APPROVED')
          : templates;

        return {
          success: true,
          count: filtered.length,
          total: templates.length,
          templates: filtered,
          sources,
          ...(warning ? { warning } : {}),
          ...(filtered.length
            ? {}
            : {
                error:
                  'There is no approved template to send. A template must be approved by Meta before it can be used; ' +
                  'pick none and tell the owner rather than inventing a template name.',
              }),
        };
      },
    }),

    nobogent_whatsapp_send_template: tool({
      description:
        'Nobogent App MCP: Sends a WhatsApp template message to a phone number or lead. This really ' +
        'sends — it returns the Meta message id on success and the provider error on failure. ' +
        'Requires human approval first.',
      inputSchema: z.object({
        phone: z.string().describe('Recipient phone number (e.g. +91 9876543210)'),
        templateName: z.string().describe('Name of the approved template to send'),
        variables: z.array(z.string()).default([]).describe('List of replacement values for template parameters like {{1}}, {{2}}'),
        languageCode: z
          .string()
          .optional()
          .describe(
            "The template's approved locale, e.g. en_US. Omit it and the locale is resolved from " +
              'Meta, which is almost always right — a wrong locale is rejected as "template name ' +
              'does not exist in the translation".',
          ),
      }),
      execute: async ({ phone, templateName, variables, languageCode }) => {
        try {
          // Previously this returned "queued for delivery" and posted nothing at all.
          const { sendWhatsAppTemplate } = await import('@/lib/agent/tools/outbound');
          const result = await sendWhatsAppTemplate({
            supabase,
            userId,
            phone,
            templateName,
            variables,
            languageCode,
          });
          if (!result.success) {
            return { success: false, error: result.error, templateName, attemptedTo: result.to ?? phone };
          }
          return {
            success: true,
            to: result.to,
            messageId: result.messageId,
            templateName: result.templateName,
            testModeRedirect: result.redirected || undefined,
            message: `WhatsApp template "${templateName}" accepted by Meta for ${result.to} (id ${result.messageId}).`,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    nobogent_voice_dispatch_call: tool({
      description:
        'Nobogent App MCP: Dispatches an outbound AI phone call to a lead using the 24/7 AI Voice ' +
        'caller. This really dials — it returns the provider call id, or the reason it could not ' +
        'call. Requires human approval first.',
      inputSchema: z.object({
        phone: z.string().describe('Phone number to call'),
        objective: z.string().describe('Call goal (e.g. "Follow up on luxury villa inquiry, verify budget and schedule site visit")'),
        reason: z
          .string()
          .optional()
          .describe(
            'What the call is about, in a FEW WORDS — "your marketing", "the November batch". This becomes the ' +
              'opening line, so a sentence here means a long monologue the person interrupts. Omit it and the first ' +
              'eight words of the objective are used.',
          ),
        leadName: z.string().optional().describe('Name of the person being called'),
      }),
      execute: async ({ phone, objective, reason, leadName }) => {
        try {
          // This used to insert a "queued" call_logs row and report "call initiated" without
          // dialling anyone. It now places the call through the same dispatcher the cron uses.
          const { dispatchVoiceCall } = await import('@/lib/agent/tools/outbound');
          const result = await dispatchVoiceCall({ supabase, userId, phone, objective, reason, leadName });
          if (!result.success) {
            return { success: false, error: result.error, attemptedTo: result.to ?? phone };
          }
          return {
            success: true,
            callId: result.callId,
            callSid: result.callSid,
            to: result.to,
            scheduled: result.scheduled,
            message: result.scheduled
              ? `Call to ${result.to} is scheduled rather than dialled now (outside calling hours).`
              : `Call placed to ${result.to}${leadName ? ` (${leadName})` : ''} with objective: "${objective}".`,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    nobogent_assets_list: tool({
      description: 'Nobogent App MCP: Lists the company media library assets (videos, images, logos, documents) uploaded to Cloudflare R2.',
      inputSchema: z.object({
        type: z.enum(['all', 'video', 'image']).default('all').describe('Filter by asset type'),
        limit: z.number().default(20).describe('Max assets to return'),
      }),
      execute: async ({ type, limit }) => {
        try {
          let q = supabase
            .from('assets')
            .select('id, caption, type, url, metadata, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

          if (type !== 'all') {
            q = q.eq('type', type);
          }

          const { data, error } = await q;
          if (error) throw error;

          const assets = (data || []).map((a: any) => ({
            id: a.id,
            title: a.caption || a.metadata?.title || 'Asset',
            type: a.type,
            url: a.url,
            metadata: a.metadata,
            created_at: a.created_at,
          }));

          return {
            success: true,
            count: assets.length,
            assets,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),

    /**
     * "What does my balance actually buy?"
     *
     * The pricing table already knew how to say this — `describeTier` renders
     * "₹9,999 — 5,000 credits: 500 images, or 375s of video, or 1000 call minutes" — but only the
     * admin ledger route ever called it. So an owner asking "what do 5,000 credits buy?" either got
     * a number with no units, or the agent did the arithmetic itself and got it wrong.
     *
     * The unit prices come from CREDIT_COSTS through the tiers module, not from here, so this tool
     * cannot drift from the ledger. Balance is the owner's spendable credits (open holds subtracted),
     * and it is reported as unknown rather than as zero when it cannot be read.
     */
    nobogent_credits_explainer: tool({
      description:
        'Nobogent App MCP: What the account\'s credits actually buy, and what each plan costs. Reads the REAL ' +
        'credit unit prices (image, 15s of video, call minute, piece of copy) and the real plan table, plus this ' +
        'account\'s spendable balance. Use it whenever the owner asks what credits buy, what a plan includes, ' +
        'how much a video or a call costs, or whether they have enough left — never do that arithmetic yourself.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          // Imported lazily: these modules reach the ledger, and a tool registry build must not.
          const { CREDIT_TIERS, RECOMMENDED_TIER_ID, describeTier, tierCapacity, paisePerCredit, formatInr } =
            await import('@/lib/automation/credit-tiers');
          const { availableCredits, CREDIT_COSTS } = await import('@/utils/credits');

          const balance = await availableCredits(supabase, userId);

          const unitPrices = {
            image: CREDIT_COSTS.AI_IMAGE_GENERATION,
            video15s: CREDIT_COSTS.AI_VIDEO_15SEC_CHUNK,
            callMinute: CREDIT_COSTS.VOICE_CALL_MINUTE,
            copy: CREDIT_COSTS.AI_COPY_GENERATION,
          };

          // What THIS balance buys, on the same "alternatives, not a bundle" basis the plans use.
          const buys =
            balance === null
              ? null
              : {
                  images: Math.floor(balance / unitPrices.image),
                  videoSeconds: Math.floor(balance / unitPrices.video15s) * 15,
                  callMinutes: Math.floor(balance / unitPrices.callMinute),
                  copy: Math.floor(balance / unitPrices.copy),
                };

          return {
            success: true,
            balance,
            balanceKnown: balance !== null,
            balanceNote:
              balance === null
                ? 'The balance could not be read. Say that plainly; do not assume zero and do not guess.'
                : 'Spendable credits after open reservations.',
            unitPrices,
            unitNote:
              'Each figure is the whole units the balance pays for, floored. They are ALTERNATIVES, not a ' +
              'combined bundle — the same credit is not spent on an image and on a call.',
            thisBalanceBuys: buys,
            plans: CREDIT_TIERS.map((tier: any) => ({
              id: tier.id,
              price: formatInr(tier.pricePaise),
              credits: tier.monthlyCredits,
              paisePerCredit: paisePerCredit(tier),
              includes: tierCapacity(tier),
              recommended: tier.id === RECOMMENDED_TIER_ID,
              summary: describeTier(tier),
            })),
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    }),
  };
}

