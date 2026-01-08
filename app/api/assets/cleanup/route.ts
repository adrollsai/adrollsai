import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET() {
    const supabase = await createClient()

    try {
        // 1. Authenticate User
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // 2. Calculate 7 Days Ago
        const sevenDaysAgo = new Date()
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
        const cutoffDate = sevenDaysAgo.toISOString()

        // 3. Delete Old Assets for THIS User only
        const { count, error } = await supabase
            .from('assets')
            .delete({ count: 'exact' })
            .eq('user_id', user.id) // Security: Only delete their own data
            .lt('created_at', cutoffDate)

        if (error) {
            console.error("Cleanup Error:", error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ 
            success: true, 
            deletedCount: count 
        })

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}