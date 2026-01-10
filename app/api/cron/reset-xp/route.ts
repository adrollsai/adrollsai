// adrollsai/adrollsai/adrollsai-builder-app-local-cache/app/api/cron/reset-xp/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// --- CONFIG ---
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// --- ADMIN CLIENT ---
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function GET(request: Request) {
    // 1. Security Check
    const authHeader = request.headers.get('authorization')
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        console.log("⏳ Starting Monthly XP Reset...")

        // 2. Reset Logic (XP ONLY)
        // We reset total_xp to 0 but we DO NOT reset the level.
        // This makes 'Level' a permanent title/tier, while 'XP' becomes a monthly score.
        const { data, error } = await supabaseAdmin
            .from('profiles')
            .update({ 
                total_xp: 0
                // Level is intentionally left untouched
            })
            .gt('total_xp', 0) // Only affect users with XP
            .select('id')

        if (error) throw error

        console.log(`✅ XP Reset Complete. Affected ${data.length} users.`)

        return NextResponse.json({ 
            success: true, 
            message: 'Monthly XP reset completed successfully (Levels preserved)',
            affected_users: data.length
        })

    } catch (error: any) {
        console.error("❌ XP Reset Error:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}