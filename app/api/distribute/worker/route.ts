import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateStampedImage } from '@/utils/stamp-helper'
import { sendDistributionEmail } from '@/utils/email-helper'
import { headers } from 'next/headers'

// Allow Vercel functions to run longer (up to 60s)
export const maxDuration = 60; 

export async function POST(request: Request) {
  // 1. INIT ADMIN CLIENT (Bypasses RLS)
  // Required because the worker runs without an active user session
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, 
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )

  let { batchId } = await request.json()
  
  if (!batchId) {
      return NextResponse.json({ error: 'No Batch ID' }, { status: 400 })
  }

  console.log(`[Worker] Processing batch: ${batchId}`)

  // 2. Fetch PENDING items (Using Admin Client)
  // We grab 5 at a time to stay within timeout limits
  const { data: items, error: fetchError } = await supabaseAdmin
    .from('distribution_items')
    .select('*')
    .eq('batch_id', batchId)
    .eq('status', 'pending')
    .limit(5)

  if (fetchError) {
      console.error("[Worker] Fetch Error:", fetchError)
      return NextResponse.json({ error: fetchError.message })
  }

  // If no items left, check if we should mark batch as completed
  if (!items || items.length === 0) {
    const { count } = await supabaseAdmin
        .from('distribution_items')
        .select('*', { count: 'exact', head: true })
        .eq('batch_id', batchId)
        .eq('status', 'pending')
    
    if (count === 0) {
        await supabaseAdmin.from('distribution_batches').update({ status: 'completed' }).eq('id', batchId)
        return NextResponse.json({ message: 'Batch Complete' })
    }
    return NextResponse.json({ message: 'No pending items found (or locked)' })
  }

  // Update Batch Status to Processing
  await supabaseAdmin.from('distribution_batches').update({ status: 'processing' }).eq('id', batchId)

  // Get Context Data (Profile, Master Image)
  const userId = items[0].user_id
  const { data: profile } = await supabaseAdmin.from('profiles').select('business_name').eq('id', userId).single()
  const senderName = profile?.business_name || 'Partner'
  const { data: batch } = await supabaseAdmin.from('distribution_batches').select('master_image_url').eq('id', batchId).single()
  
  if (!batch) return NextResponse.json({ error: 'Batch not found' })

  // 3. Process the Chunk
  for (const item of items) {
    try {
      const agent = item.agent_data
      const masterImageUrl = batch.master_image_url

      // A. Generate Image
      const stampedUrl = await generateStampedImage({
        agentProfile: {
          business_name: agent.business_name,
          contact_number: agent.contact_number,
          email: agent.email,
          logo_url: agent.logo_url
        },
        masterImageUrl,
        userId: userId
      })

      // B. Save to Assets Library
      await supabaseAdmin.from('assets').insert({
        user_id: userId,
        url: stampedUrl,
        type: 'image',
        status: 'Distributed', 
      })

      // C. Send Email
      let emailSent = false
      if (agent.sendEmail && agent.email) {
         try {
            const res = await sendDistributionEmail(agent.email, agent.business_name, stampedUrl, senderName)
            emailSent = res.success
            if (!res.success) console.error(`[Worker] Email failed for ${agent.email}:`, res.error)
         } catch (emailErr) {
             console.error(`[Worker] Email Exception:`, emailErr)
         }
      }

      // D. Mark Item Complete
      await supabaseAdmin.from('distribution_items').update({
        status: 'completed',
        result_url: stampedUrl,
        email_sent: emailSent
      }).eq('id', item.id)

      // E. Increment Counter (Using the RPC function we created)
      const { error: rpcError } = await supabaseAdmin.rpc('increment_batch_counter', { row_id: batchId })
      if (rpcError) console.warn("Counter update failed (non-critical):", rpcError.message)

    } catch (e: any) {
      console.error(`[Worker] Item ${item.id} failed:`, e)
      await supabaseAdmin.from('distribution_items').update({
        status: 'failed',
        error_message: e.message
      }).eq('id', item.id)
    }
  }

  // 4. RECURSIVE TRIGGER
  // Check if there are still pending items. If so, call the worker again.
  const { count: pendingCount } = await supabaseAdmin
        .from('distribution_items')
        .select('*', { count: 'exact', head: true })
        .eq('batch_id', batchId)
        .eq('status', 'pending')

  if (pendingCount && pendingCount > 0) {
      const headersList = await headers()
      const host = headersList.get('host')
      const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https'
      const workerUrl = `${protocol}://${host}/api/distribute/worker`

      fetch(workerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchId })
      }).catch(e => console.error("Chain break:", e))
  } else {
      await supabaseAdmin.from('distribution_batches').update({ status: 'completed' }).eq('id', batchId)
  }

  return NextResponse.json({ success: true, processed: items.length, remaining: pendingCount })
}