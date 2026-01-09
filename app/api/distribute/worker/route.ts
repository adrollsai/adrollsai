import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateStampedImage } from '@/utils/stamp-helper'
import { sendDistributionEmail } from '@/utils/email-helper'
import { headers } from 'next/headers'

// Allow Vercel functions to run longer (up to 60s)
export const maxDuration = 60; 
// Force Node.js runtime for Sharp image processing
export const runtime = 'nodejs';

export async function POST(request: Request) {
  // 1. INIT ADMIN CLIENT (Bypasses RLS)
  // We use the Transaction Pooler URL (if configured in .env) automatically via standard env vars
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

  let body;
  try {
      body = await request.json()
  } catch (e) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { batchId } = body
  
  if (!batchId) {
      return NextResponse.json({ error: 'No Batch ID' }, { status: 400 })
  }

  console.log(`[Worker] Processing batch: ${batchId}`)

  // 2. Fetch PENDING items
  // MEMORY FIX: Reduced limit from 5 to 3 to prevent Vercel 1GB RAM OOM (Out Of Memory) crashes
  // Image processing is RAM heavy.
  const { data: items, error: fetchError } = await supabaseAdmin
    .from('distribution_items')
    .select('*')
    .eq('batch_id', batchId)
    .eq('status', 'pending')
    .limit(2) 

  if (fetchError) {
      console.error("[Worker] Fetch Error:", fetchError)
      return NextResponse.json({ error: fetchError.message })
  }

  // If no items left, check if we should mark batch as completed
  if (!items || items.length === 0) {
    // Check if ANY pending items exist (globally for this batch)
    const { count } = await supabaseAdmin
        .from('distribution_items')
        .select('*', { count: 'exact', head: true })
        .eq('batch_id', batchId)
        .eq('status', 'pending')
    
    if (count === 0) {
        await supabaseAdmin.from('distribution_batches').update({ status: 'completed' }).eq('id', batchId)
        return NextResponse.json({ message: 'Batch Complete' })
    }
    return NextResponse.json({ message: 'No pending items found (or locked by other workers)' })
  }

  // Update Batch Status to Processing
  await supabaseAdmin.from('distribution_batches').update({ status: 'processing' }).eq('id', batchId)

  // Get Context Data (Profile, Master Image)
  const ownerId = items[0].user_id
  const { data: profile } = await supabaseAdmin.from('profiles').select('business_name').eq('id', ownerId).single()
  const senderName = profile?.business_name || 'Partner'
  const { data: batch } = await supabaseAdmin.from('distribution_batches').select('master_image_url').eq('id', batchId).single()
  
  if (!batch) return NextResponse.json({ error: 'Batch not found' })

  // 3. Process the Chunk PARALLEL
  await Promise.all(items.map(async (item) => {
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
        userId: ownerId // Files are stored under the Org Owner's folder
      })

      // B. Save to Assets Library
      await supabaseAdmin.from('assets').insert({
        user_id: ownerId,
        url: stampedUrl,
        type: 'image',
        status: 'Distributed', 
      })

      // C. Send Email (With Jitter)
      let emailSent = false
      if (agent.sendEmail && agent.email) {
         // SMTP SAFETY: Wait random 100ms-1000ms to prevent "Spam Spike" blocking
         await new Promise(resolve => setTimeout(resolve, Math.random() * 900 + 100));

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

      // E. Increment Counter (Best Effort)
      const { error: rpcError } = await supabaseAdmin.rpc('increment_batch_counter', { row_id: batchId })
      if (rpcError) console.warn("Counter update failed:", rpcError.message)

    } catch (e: any) {
      console.error(`[Worker] Item ${item.id} failed:`, e)
      // Mark failed so we don't retry forever
      await supabaseAdmin.from('distribution_items').update({
        status: 'failed',
        error_message: e.message
      }).eq('id', item.id)
    }
  }))

  // 4. RECURSIVE TRIGGER
  // Check if there are still pending items.
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

      // Fire next worker batch
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