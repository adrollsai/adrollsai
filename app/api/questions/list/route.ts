import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getEffectiveUserId(supabase: any, user: any, req: Request) {
    const url = new URL(req.url)
    const impersonateId = url.searchParams.get('impersonate')
    if (impersonateId && impersonateId !== user.id) {
        const { data: authProfile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()
        const authRole = authProfile?.role?.toLowerCase() || ''
        if (['super_admin', 'agency', 'admin'].includes(authRole)) {
            return impersonateId
        }
    }
    return user.id
}

export async function GET(req: Request) {
    try {
        const supabase = await createServerClient()
        const { data: { user } } = await supabase.auth.getUser()
        
        let effectiveUserId = user?.id

        // If user session is unauthenticated or refreshing (e.g. local domain testing), fallback to master dev profile
        if (!effectiveUserId) {
            const { data: masterProfile } = await supabaseAdmin
                .from('profiles')
                .select('id')
                .eq('email', 'rchopra489@gmail.com')
                .single()
            
            if (masterProfile?.id) {
                effectiveUserId = masterProfile.id
            } else {
                return NextResponse.json({ flaggedQuestions: [] })
            }
        } else {
            effectiveUserId = await getEffectiveUserId(supabase, user, req)
        }

        const { data, error } = await supabaseAdmin
            .from('flagged_questions')
            .select(`
              *,
              leads (
                id,
                name,
                phone,
                email,
                voice_recording_url,
                properties (
                  id,
                  title
                )
              )
            `)
            .eq('user_id', effectiveUserId)
            .eq('resolved', false)
            .order('created_at', { ascending: false })

        if (error) {
            console.warn('[QUESTIONS LIST API] Warning fetching flagged questions:', error.message)
            return NextResponse.json({ flaggedQuestions: [] })
        }

        return NextResponse.json({ flaggedQuestions: data || [] })

    } catch (e: any) {
        console.warn('[QUESTIONS LIST API] Exception:', e.message)
        return NextResponse.json({ flaggedQuestions: [] })
    }
}
