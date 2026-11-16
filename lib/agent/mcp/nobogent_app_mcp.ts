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
      description: 'Nobogent App MCP: Fetches available WhatsApp broadcast/messaging templates.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const { data, error } = await supabase
            .from('whatsapp_templates')
            .select('id, name, category, language, status, components')
            .eq('user_id', userId);

          if (error) throw error;

          return {
            success: true,
            templates: data || [],
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
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
        leadName: z.string().optional().describe('Name of the person being called'),
      }),
      execute: async ({ phone, objective, leadName }) => {
        try {
          // This used to insert a "queued" call_logs row and report "call initiated" without
          // dialling anyone. It now places the call through the same dispatcher the cron uses.
          const { dispatchVoiceCall } = await import('@/lib/agent/tools/outbound');
          const result = await dispatchVoiceCall({ supabase, userId, phone, objective, leadName });
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
  };
}

