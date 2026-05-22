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
    const { name, email, phone, message } = await request.json()

    if (!name || !email || !phone || !message) {
      return NextResponse.json({ error: 'All fields are required.' }, { status: 400 })
    }

    // 1. Resolve User ID for rchopra489@gmail.com
    const targetUserId = await getUserIdByEmail('rchopra489@gmail.com')

    let leadId = '';
    if (targetUserId) {
      // 2. Insert Lead directly into the CRM database
      const { data: lead, error: leadError } = await supabaseAdmin
        .from('leads')
        .insert({
          user_id: targetUserId,
          name,
          email,
          phone,
          notes: message,
          source: 'Landing Page Contact',
          pipeline_stage: 'New'
        })
        .select()
        .single();

      if (leadError) {
        console.error("[CONTACT API] Supabase CRM lead insert error:", leadError)
      } else if (lead) {
        leadId = lead.id;
        console.log(`[CONTACT API] Lead created successfully: ${lead.id} assigned to ${targetUserId}`);
        
        // 3. Dispatch web push notification to target user
        try {
          await sendPushNotification(
            targetUserId,
            "🔥 New Landing Page Query!",
            `${name} • ${phone} • Landing Page`,
            `/dashboard/crm/${lead.id}`
          )
        } catch (pushErr) {
          console.error("[CONTACT API] Push Notification failed:", pushErr)
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
