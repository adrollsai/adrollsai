import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendContactFormEmail } from '@/utils/email-helper'
import { sendPushNotification } from '@/utils/notification-helper'

// Initialize Supabase Admin Client using the service role key to bypass row-level security
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Searches the Supabase Profiles table and paginated Auth directory for the target email
 * to locate their User ID for CRM assignment. Includes a fallback to ensure lead storage.
 */
async function getUserIdByEmail(email: string): Promise<string | null> {
  const targetEmail = email.toLowerCase().trim();
  
  // 1. Try Profiles table first (efficient)
  const { data: pData } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('email', targetEmail)
    .maybeSingle();

  if (pData?.id) {
    console.log(`[CONTACT API] Resolved User ID from profiles table: ${pData.id}`);
    return pData.id;
  }

  // 2. Search through Auth directory (paginated fallback)
  console.log(`[CONTACT API] Querying Auth directory for: ${targetEmail}`);
  let page = 1;
  while (true) { 
    const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000
    });
    
    if (error || !users || users.length === 0) {
      if (error) console.error("[CONTACT API] Error querying auth directory:", error);
      break;
    }
    
    const found = users.find(u => u.email?.toLowerCase().trim() === targetEmail);
    if (found) {
      console.log(`[CONTACT API] Resolved User ID from Auth directory: ${found.id}`);
      return found.id;
    }
    if (users.length < 1000) break;
    page++;
  }

  // 3. Last resort fallback: grab the first profile available in the system
  console.warn(`[CONTACT API] Target email ${targetEmail} not found. Querying fallback profile.`);
  const { data: anyProfile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .limit(1)
    .maybeSingle();

  return anyProfile?.id || null;
}

export async function POST(request: Request) {
  try {
    const { name, email, phone, message, budget, timeline } = await request.json()

    if (!name || !email || !phone || !message) {
      return NextResponse.json({ error: 'All fields are required.' }, { status: 400 })
    }

    // 1. Resolve workspace owner / admin profile (no hardcoded email)
    const { data: firstAdmin } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle()

    const targetUserId = firstAdmin?.id || (await supabaseAdmin.from('profiles').select('id').limit(1).maybeSingle()).data?.id || null

    let leadId = '';
    if (targetUserId) {
      // Check if global distribution is enabled
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('enable_distribution')
        .eq('id', targetUserId)
        .single();

      let assignedAgentId: string | null = null;
      if (profile?.enable_distribution) {
        const { data: teamData } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .or(`agency_id.eq.${targetUserId},parent_id.eq.${targetUserId}`)
          .in('role', ['admin', 'agent'])
          .neq('id', targetUserId); // Exclude the owner

        if (teamData && teamData.length > 0) {
          const agentIds = teamData.map(t => t.id);
          
          // Find the last assigned agent to continue round robin
          const { data: lastAssignedLead } = await supabaseAdmin
            .from('leads')
            .select('assigned_to')
            .in('assigned_to', agentIds)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const lastAssignedId = lastAssignedLead?.assigned_to;
          let nextIndex = 0;
          if (lastAssignedId) {
            const lastIdx = agentIds.indexOf(lastAssignedId);
            if (lastIdx !== -1) {
              nextIndex = (lastIdx + 1) % agentIds.length;
            }
          }
          assignedAgentId = agentIds[nextIndex];
        }
      }

      // 2. Check if lead already exists in CRM by phone to reopen instead of creating duplicates
      const cleanPhoneDigits = phone.replace(/\D/g, '').slice(-10);
      let existingLead: any = null;
      if (cleanPhoneDigits.length >= 7) {
        const { data: existingMatches } = await supabaseAdmin
          .from('leads')
          .select('id, name, phone, email, pipeline_stage, custom_fields, assigned_to')
          .eq('user_id', targetUserId)
          .or(`phone.like.%${cleanPhoneDigits},phone.eq.${phone}`)
          .limit(1);
        if (existingMatches && existingMatches.length > 0) {
          existingLead = existingMatches[0];
        }
      }

      if (existingLead) {
        leadId = existingLead.id;
        console.log(`[CONTACT API] Contact exists in CRM (ID: ${existingLead.id}). Reopening lead.`);

        let cf = existingLead.custom_fields || {};
        if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch (e) { cf = {}; } }

        const reopenedCount = (cf.reopened_count || 0) + 1;
        cf = {
          ...cf,
          custom_question_0: budget || cf.custom_question_0 || '',
          custom_question_1: timeline || cf.custom_question_1 || '',
          last_contact_message: message,
          reopened_count: reopenedCount,
          last_reopened_at: new Date().toISOString()
        };

        await supabaseAdmin
          .from('leads')
          .update({
            custom_fields: cf,
            budget: budget || undefined,
            timeline: timeline || undefined,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingLead.id);

        const reopenDesc = `The lead was reopened from Landing Page Contact Form\nLead Name : ${name || existingLead.name}\nContact no : ${phone}\nEmail : ${email || existingLead.email || 'N/A'}\nLead Source : Landing Page Contact\nMessage / Query : ${message}\nBudget : ${budget || 'N/A'}\nTimeline : ${timeline || 'N/A'}\nLead Status : ${existingLead.pipeline_stage || 'New'}`;

        await supabaseAdmin.from('lead_history').insert({
          lead_id: existingLead.id,
          action_type: 'REOPENED',
          performed_by: 'System / Landing Page',
          actor_name: 'Landing Page Form',
          description: reopenDesc,
          details: {
            source: 'Landing Page Contact',
            message,
            budget,
            timeline,
            reopened_count: reopenedCount,
            timestamp: new Date().toISOString()
          },
          created_at: new Date().toISOString()
        });

        // Push notification for reopen
        try {
          await sendPushNotification(
            existingLead.assigned_to || assignedAgentId || targetUserId,
            "🔄 Landing Page Lead Reopened!",
            `${name || existingLead.name} • ${phone} • Landing Page Query (Reopened #${reopenedCount})`,
            `/dashboard/crm/${existingLead.id}`
          );
        } catch (pushErr) {
          console.error("[CONTACT API] Push Notification failed for reopen:", pushErr);
        }
      } else {
        // Insert new Lead directly into the CRM database
        const { data: lead, error: leadError } = await supabaseAdmin
          .from('leads')
          .insert({
            user_id: targetUserId,
            name,
            email,
            phone,
            notes: message,
            source: 'Landing Page Contact',
            pipeline_stage: 'New',
            assigned_to: assignedAgentId,
            budget: budget || '',
            timeline: timeline || '',
            custom_fields: {
              custom_question_0: budget || '',
              custom_question_1: timeline || ''
            }
          })
          .select()
          .single();

        if (leadError) {
          console.error("[CONTACT API] Supabase CRM lead insert error:", leadError)
        } else if (lead) {
          leadId = lead.id;
          console.log(`[CONTACT API] Lead created successfully: ${lead.id} assigned to ${assignedAgentId || targetUserId}`);
          
          // Dispatch web push notification to the assigned agent or workspace owner
          try {
            await sendPushNotification(
              assignedAgentId || targetUserId,
              "🔥 New Landing Page Query!",
              `${name} • ${phone} • Landing Page`,
              `/dashboard/crm/${lead.id}`
            )
          } catch (pushErr) {
            console.error("[CONTACT API] Push Notification failed:", pushErr)
          }
        }
      }
    } else {
      console.warn("[CONTACT API] No User Profile found in database to map CRM lead to.");
    }

    // 4. Send email notification copy to adrollsai@gmail.com
    const emailRes = await sendContactFormEmail(name, email, phone, message)
    if (!emailRes.success) {
      console.error("[CONTACT API] Nodemailer SMTP email dispatch failed:", emailRes.error)
    } else {
      console.log("[CONTACT API] SMTP email query notification successfully sent.");
    }

    return NextResponse.json({ success: true, leadId })
  } catch (error: any) {
    console.error("[CONTACT API] Fatal contact post handler error:", error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
