import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { sendCAPIEvent } from '@/utils/external-apis'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leadId, newStage, notes } = await request.json()

  try {
    // 1. Update DB
    const { data: lead, error } = await supabase
        .from('leads')
        .update({ 
            pipeline_stage: newStage, 
            notes: notes || undefined 
        })
        .eq('id', leadId)
        .eq('user_id', user.id)
        .select()
        .single()

    if (error) throw error;

    // 2. Trigger CAPI if stage warrants it
    const { data: profile } = await supabase
        .from('profiles')
        .select('facebook_token, pixel_id')
        .eq('id', user.id)
        .single()

    if (profile?.facebook_token && profile?.pixel_id) {
        let eventName = '';
        if (newStage === 'Site Visit Done') eventName = 'Schedule';
        if (newStage === 'Qualified') eventName = 'Lead';
        if (newStage === 'Closed') eventName = 'Purchase';

        if (eventName) {
            await sendCAPIEvent(
                profile.facebook_token, 
                profile.pixel_id, 
                eventName, 
                { email: lead.email, phone: lead.phone },
                newStage === 'Closed' ? 10000 : 0 // Arbitrary value for purchase
            );
        }
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}