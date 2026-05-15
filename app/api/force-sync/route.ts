import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    try {
        // 1. Find the Owner (The one you just changed to 'agency')
        const { data: owner } = await supabaseAdmin
            .from('profiles')
            .select('id, email')
            .eq('role', 'agency')
            .limit(1)
            .single()

        if (!owner) return NextResponse.json({ error: 'No account with role "agency" found. Please ensure your main account is set to "agency".' })

        // 2. Find everyone who lists this owner as their parent
        const { data: staff } = await supabaseAdmin
            .from('profiles')
            .select('id, email')
            .eq('parent_id', owner.id)

        if (!staff || staff.length === 0) {
            return NextResponse.json({ message: `Found Agency Owner (${owner.email}), but no staff members are linked to them yet.` })
        }

        // 3. Update all staff to have the correct agency_id
        const staffIds = staff.map(s => s.id)
        const { error: updateError } = await supabaseAdmin
            .from('profiles')
            .update({ agency_id: owner.id })
            .in('id', staffIds)

        if (updateError) throw updateError

        return NextResponse.json({ 
            success: true, 
            message: `Successfully linked ${staff.length} staff members to Agency ${owner.email}`,
            staffProcessed: staff.map(s => s.email)
        })

    } catch (e: any) {
        return NextResponse.json({ error: e.message })
    }
}
