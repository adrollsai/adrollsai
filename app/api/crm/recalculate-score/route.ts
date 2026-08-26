import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { updateLeadScoreInDB } from '@/utils/lead-scoring'

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
    try {
        const { leadId, qualifyingQuestions } = await req.json()
        if (!leadId) {
            return NextResponse.json({ success: false, error: 'leadId is required' }, { status: 400 })
        }

        const result = await updateLeadScoreInDB(supabaseAdmin, leadId, qualifyingQuestions)

        return NextResponse.json({
            success: true,
            score: result?.score,
            tier: result?.tier,
            breakdown: result?.breakdown
        })
    } catch (err: any) {
        console.error('[RecalculateScore API] Error:', err)
        return NextResponse.json({ success: false, error: err.message }, { status: 500 })
    }
}
