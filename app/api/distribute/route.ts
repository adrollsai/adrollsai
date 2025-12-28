import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { headers } from 'next/headers'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { masterImageUrl, agents, sendEmail } = await request.json()

    if (!masterImageUrl || !agents || !Array.isArray(agents)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // 1. Create the Batch
    const { data: batch, error: batchError } = await supabase
      .from('distribution_batches')
      .insert({
        user_id: user.id,
        master_image_url: masterImageUrl,
        total_count: agents.length,
        status: 'pending'
      })
      .select()
      .single()

    if (batchError) throw batchError

    // 2. Create Items (Bulk Insert)
    const items = agents.map((agent: any) => ({
      batch_id: batch.id,
      user_id: user.id,
      agent_data: { ...agent, sendEmail }, // Store preference in the item
      status: 'pending'
    }))

    const { error: itemsError } = await supabase.from('distribution_items').insert(items)
    if (itemsError) throw itemsError

    // 3. TRIGGER THE WORKER (Fire and Forget strategy)
    // We construct the absolute URL to call our own API
    const headersList = await headers()
    const host = headersList.get('host')
    const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https'
    const workerUrl = `${protocol}://${host}/api/distribute/worker`

    // Fire asynchronously
    fetch(workerUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        // Optional: Add a secret key here if you want to secure the worker route
      },
      body: JSON.stringify({ batchId: batch.id })
    }).catch(err => console.error("Worker trigger failed:", err))

    // 4. Return immediately to user
    return NextResponse.json({ 
      success: true, 
      message: 'Distribution started in background.', 
      batchId: batch.id 
    })

  } catch (error: any) {
    console.error("Distribution Setup Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}