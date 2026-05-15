import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    try {
        const email = 'support@yourlocalagency.ca'
        
        // 1. Get the user's current profile
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('id, parent_id')
            .eq('email', email)
            .single()

        if (!profile) return NextResponse.json({ error: 'Profile not found' })
        if (!profile.parent_id) return NextResponse.json({ error: 'User has no parent/owner assigned' })

        // 2. FORCE the agency_id to match the parent_id
        const { error: updateError } = await supabaseAdmin
            .from('profiles')
            .update({ agency_id: profile.parent_id })
            .eq('id', profile.id)

        if (updateError) throw updateError

        return NextResponse.json({ 
            success: true, 
            message: `Successfully linked ${email} to Agency ${profile.parent_id}` 
        })

    } catch (e: any) {
        return NextResponse.json({ error: e.message })
    }
}
