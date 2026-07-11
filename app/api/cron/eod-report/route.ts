import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendDailyEodReportEmail } from '@/utils/email-helper'

// Force dynamic execution to bypass Vercel static build cache
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

export async function GET(request: Request) {
    return handleEodReport(request);
}

export async function POST(request: Request) {
    return handleEodReport(request);
}

async function handleEodReport(request: Request) {
  const diagnostics: Record<string, any> = {
    step: 'start',
    timestamp: new Date().toISOString(),
    processedUsers: [],
    errors: []
  };

  try {
    const url = new URL(request.url);
    const authHeader = request.headers.get('Authorization');
    const cronSecret = url.searchParams.get('cronSecret') || (authHeader ? authHeader.replace('Bearer ', '') : null);

    console.log(`[EOD Report Cron] Triggered at ${diagnostics.timestamp}`);

    // Enforce security verification using our global environment CRON_SECRET if configured
    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
      console.warn(`[EOD Report Cron] Unauthorized access attempt.`);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        global: { fetch: fetch }
      }
    )

    // Fetch all main profiles with active email addresses (ignore agent roles)
    diagnostics.step = 'fetch_profiles';
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, business_name, facebook_token, ad_account_id, enable_eod_report, role')
      .neq('role', 'agent')

    if (profileError) throw profileError;

    if (!profiles || profiles.length === 0) {
      diagnostics.step = 'end_no_profiles';
      return NextResponse.json({ 
        success: true, 
        processed: 0, 
        message: "No admin profiles found in database",
        diagnostics
      })
    }

    const startOfToday = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24h

    for (const profile of profiles) {
      // Respect EOD toggle settings (default: true)
      if (profile.enable_eod_report === false || !profile.email) {
        continue;
      }

      console.log(`[EOD Report Cron] Processing EOD report for: ${profile.business_name || profile.email} (${profile.id})`);
      diagnostics.step = `process_user_${profile.id}`;

      // 1. Query CRM Leads data
      const { data: leads, error: leadsErr } = await supabaseAdmin
        .from('leads')
        .select('id, created_at, pipeline_stage')
        .eq('user_id', profile.id);

      if (leadsErr) {
        console.error(`Error querying leads for user ${profile.id}:`, leadsErr);
        diagnostics.errors.push(`Leads query error for ${profile.id}: ${leadsErr.message}`);
        continue;
      }

      const totalLeads = leads?.length || 0;
      const leadsToday = leads?.filter(l => new Date(l.created_at) >= startOfToday).length || 0;

      // Pipeline stage counts
      const stageCounts: Record<string, number> = {};
      leads?.forEach(l => {
        const stage = l.pipeline_stage || 'New';
        stageCounts[stage] = (stageCounts[stage] || 0) + 1;
      });

      // 2. Query today's Voice Calls activity
      const { data: callHistory, error: callsErr } = await supabaseAdmin
        .from('lead_history')
        .select('id, created_at, description, lead_id, leads!inner(user_id)')
        .eq('leads.user_id', profile.id)
        .eq('action_type', 'REMARK')
        .like('description', '🎙️ CALL_JSON:%')
        .gte('created_at', startOfToday.toISOString());

      if (callsErr) {
        console.error(`Error querying call history for user ${profile.id}:`, callsErr);
      }

      const callsTodayCount = callHistory?.length || 0;

      // 3. Query today's WhatsApp Messages activity
      const { data: waMessages, error: waErr } = await supabaseAdmin
        .from('whatsapp_messages')
        .select('direction, created_at, whatsapp_chats!inner(user_id)')
        .eq('whatsapp_chats.user_id', profile.id)
        .gte('created_at', startOfToday.toISOString());

      if (waErr) {
        console.error(`Error querying WhatsApp messages for user ${profile.id}:`, waErr);
      }

      const inboundWaToday = waMessages?.filter(m => m.direction === 'inbound').length || 0;
      const outboundWaToday = waMessages?.filter(m => m.direction === 'outbound').length || 0;
      const totalWaToday = waMessages?.length || 0;

      // 4. Analyze Meta Campaigns (if connected)
      let campaignsHtml = `<p style="color: #64748b; font-size: 14px; font-style: italic;">No Meta Ad Account linked to this workspace. Link your Facebook profile to analyze live campaigns.</p>`;
      
      const facebookToken = profile.facebook_token;
      const adAccountId = profile.ad_account_id;

      if (facebookToken && adAccountId) {
        try {
          const cleanAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
          const fbUrl = `https://graph.facebook.com/v19.0/${cleanAdAccountId}/campaigns?fields=id,name,status,effective_status,objective,start_time,insights{results,spend,actions}&limit=10&access_token=${facebookToken}`;
          const fbRes = await fetch(fbUrl);
          
          if (fbRes.ok) {
            const fbData = await fbRes.json();
            if (fbData.data && Array.isArray(fbData.data) && fbData.data.length > 0) {
              campaignsHtml = `
                <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px;">
                  <thead>
                    <tr style="background-color: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left;">
                      <th style="padding: 10px 8px; font-weight: bold; color: #475569;">Campaign Name</th>
                      <th style="padding: 10px 8px; font-weight: bold; color: #475569;">Status</th>
                      <th style="padding: 10px 8px; font-weight: bold; color: #475569;">Spent</th>
                      <th style="padding: 10px 8px; font-weight: bold; color: #475569;">Results</th>
                    </tr>
                  </thead>
                  <tbody>
              `;

              fbData.data.forEach((c: any) => {
                let spend = "0.00";
                let results = "0";
                if (c.insights?.data?.[0]) {
                  spend = c.insights.data[0].spend || "0.00";
                  results = c.insights.data[0].results?.[0]?.value || "0";
                }
                const isActive = (c.effective_status || c.status) === 'ACTIVE';

                campaignsHtml += `
                  <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 12px 8px; font-weight: 600; color: #1e293b;">${c.name}</td>
                    <td style="padding: 12px 8px;">
                      <span style="display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: bold; ${isActive ? 'background-color: #ecfdf5; color: #047857;' : 'background-color: #f1f5f9; color: #64748b;'}">
                        ${c.effective_status || c.status}
                      </span>
                    </td>
                    <td style="padding: 12px 8px; font-weight: bold; color: #0f172a;">Rs. ${spend}</td>
                    <td style="padding: 12px 8px; font-weight: bold; color: #2563eb;">${results} leads</td>
                  </tr>
                `;
              });

              campaignsHtml += `
                  </tbody>
                </table>
              `;
            } else {
              campaignsHtml = `<p style="color: #64748b; font-size: 14px; font-style: italic;">No active ad campaigns running currently on Facebook.</p>`;
            }
          } else {
            campaignsHtml = `<p style="color: #ef4444; font-size: 14px; font-style: italic;">Failed to sync Meta campaigns: Meta API credentials expired or invalid.</p>`;
          }
        } catch (fbErr: any) {
          console.error(`Meta campaigns fetch error for user ${profile.id}:`, fbErr);
          campaignsHtml = `<p style="color: #ef4444; font-size: 14px; font-style: italic;">Exception loading Meta campaigns analysis.</p>`;
        }
      }

      // 5. Compose HTML Email content
      const businessName = profile.business_name || "Your Workspace";
      
      let pipelineHtml = ``;
      Object.entries(stageCounts).forEach(([stage, count]) => {
        pipelineHtml += `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background-color: #f8fafc; border-radius: 8px; margin-bottom: 6px; font-size: 13px;">
            <strong style="color: #475569; text-transform: capitalize;">${stage}</strong>
            <span style="background-color: #e2e8f0; color: #1e293b; padding: 2px 8px; border-radius: 9999px; font-weight: bold;">${count}</span>
          </div>
        `;
      });
      if (!pipelineHtml) {
        pipelineHtml = `<p style="color: #64748b; font-size: 13px; font-style: italic;">No leads in pipeline yet.</p>`;
      }

      const emailHtml = `
        <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 650px; margin: 0 auto; padding: 32px 24px; border: 1px solid #e2e8f0; border-radius: 20px; background-color: #ffffff; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.02);">
          
          <!-- Gradient Header -->
          <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 30px; border-radius: 16px; color: #ffffff; text-align: center; margin-bottom: 30px;">
            <span style="font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.9;">End of Day Operations Report</span>
            <h1 style="margin: 8px 0 0 0; font-size: 26px; font-weight: bold; letter-spacing: -0.02em;">${businessName}</h1>
            <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.85;">Summary for ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>

          <!-- Key Metrics Grid -->
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 30px;">
            
            <div style="background-color: #eff6ff; border: 1px solid #dbeafe; padding: 16px; border-radius: 16px; text-align: center;">
              <span style="display: block; font-size: 11px; font-weight: 800; color: #1e40af; text-transform: uppercase; letter-spacing: 0.05em;">New Leads</span>
              <strong style="display: block; font-size: 28px; color: #1e3a8a; margin-top: 6px;">+${leadsToday}</strong>
              <span style="display: block; font-size: 11px; color: #60a5fa; margin-top: 4px; font-weight: bold;">captured today</span>
            </div>

            <div style="background-color: #f0fdf4; border: 1px solid #dcfce7; padding: 16px; border-radius: 16px; text-align: center;">
              <span style="display: block; font-size: 11px; font-weight: 800; color: #15803d; text-transform: uppercase; letter-spacing: 0.05em;">WhatsApp Chats</span>
              <strong style="display: block; font-size: 28px; color: #14532d; margin-top: 6px;">${totalWaToday}</strong>
              <span style="display: block; font-size: 11px; color: #4ade80; margin-top: 4px; font-weight: bold;">${inboundWaToday} in / ${outboundWaToday} out</span>
            </div>

            <div style="background-color: #fdf2f8; border: 1px solid #fce7f3; padding: 16px; border-radius: 16px; text-align: center;">
              <span style="display: block; font-size: 11px; font-weight: 800; color: #be185d; text-transform: uppercase; letter-spacing: 0.05em;">Voice Calls</span>
              <strong style="display: block; font-size: 28px; color: #831843; margin-top: 6px;">${callsTodayCount}</strong>
              <span style="display: block; font-size: 11px; color: #f472b6; margin-top: 4px; font-weight: bold;">completed today</span>
            </div>

          </div>

          <!-- Section: Today's Summary -->
          <div style="margin-bottom: 30px;">
            <h2 style="font-size: 17px; font-weight: 800; color: #0f172a; border-left: 4px solid #3b82f6; padding-left: 10px; margin: 0 0 14px 0; text-transform: uppercase; letter-spacing: 0.02em;">Today's Activity Summary</h2>
            <div style="background-color: #fafafa; border: 1px solid #f3f3f3; border-radius: 16px; padding: 20px; font-size: 14px; color: #334155; line-height: 1.6;">
              <p style="margin: 0 0 10px 0;">Today was a productive day for <strong>${businessName}</strong>. Here is the operational digest:</p>
              <ul style="margin: 0; padding-left: 20px; color: #475569;">
                <li>Captured <strong>${leadsToday} new leads</strong>. Your database now holds <strong>${totalLeads} total leads</strong>.</li>
                <li>Exchanged <strong>${totalWaToday} WhatsApp messages</strong> with prospective leads via WABA automation.</li>
                <li>Completed <strong>${callsTodayCount} AI Voice Calls</strong> matching schedule requests and triggers.</li>
              </ul>
            </div>
          </div>

          <!-- Section: Campaign Performance Analysis -->
          <div style="margin-bottom: 30px;">
            <h2 style="font-size: 17px; font-weight: 800; color: #0f172a; border-left: 4px solid #3b82f6; padding-left: 10px; margin: 0 0 14px 0; text-transform: uppercase; letter-spacing: 0.02em;">Ad Campaign Analysis</h2>
            <div style="border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; overflow-hidden: true;">
              ${campaignsHtml}
            </div>
          </div>

          <!-- Section: Pipeline Breakdown -->
          <div style="margin-bottom: 35px;">
            <h2 style="font-size: 17px; font-weight: 800; color: #0f172a; border-left: 4px solid #3b82f6; padding-left: 10px; margin: 0 0 14px 0; text-transform: uppercase; letter-spacing: 0.02em;">CRM Pipeline Distribution</h2>
            <div style="border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px;">
              ${pipelineHtml}
            </div>
          </div>

          <!-- Footer Settings Info -->
          <div style="border-top: 1px solid #f1f5f9; padding-top: 24px; text-align: center;">
            <p style="margin: 0; font-size: 11px; color: #94a3b8; line-height: 1.5; font-weight: 600;">
              You received this operations digest because daily summaries are enabled for your email.
              <br/>
              To opt-out or modify report settings, update your settings inside your <a href="https://app.nobogent.com/dashboard/profile" style="color: #3b82f6; text-decoration: underline;">Profile Settings Panel</a>.
            </p>
            <p style="margin: 12px 0 0 0; font-size: 10px; color: #cbd5e1; font-weight: bold; letter-spacing: 0.05em; text-transform: uppercase;">
              Powered by Nobogent AI CRM System
            </p>
          </div>

        </div>
      `;

      // Dispatch daily EOD email
      const emailResult = await sendDailyEodReportEmail(profile.email, businessName, emailHtml);
      diagnostics.processedUsers.push({
        id: profile.id,
        email: profile.email,
        businessName,
        success: emailResult.success,
        messageId: emailResult.messageId || null,
        error: emailResult.error || null
      });
    }

    diagnostics.step = 'completed';
    return NextResponse.json({ 
      success: true, 
      processed: diagnostics.processedUsers.length, 
      diagnostics
    });

  } catch (error: any) {
    console.error("[EOD Report Cron] Fatal Error:", error)
    diagnostics.fatalError = error.message;
    return NextResponse.json({ error: error.message, diagnostics }, { status: 500 })
  }
}
