import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { getAvailableVobizNumbers } from '@/utils/vobiz-helper'

export async function GET(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const numbers = getAvailableVobizNumbers()
        return NextResponse.json({
            success: true,
            numbers
        })
    } catch (err: any) {
        console.error('[VOBIZ NUMBERS API] Error:', err)
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
    }
}
