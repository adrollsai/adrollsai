import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

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
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const effectiveUserId = await getEffectiveUserId(supabase, user, req)

        const { data: flows, error } = await supabase
            .from('whatsapp_question_flows')
            .select('*')
            .eq('user_id', effectiveUserId)
            .order('created_at', { ascending: true })

        if (error) {
            console.error('[QUESTION FLOWS API] Error fetching:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, flows: flows || [] })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const effectiveUserId = await getEffectiveUserId(supabase, user, req)

        const body = await req.json()
        const { name, questions, linked_campaign_id, is_active } = body

        if (!name || !questions || !Array.isArray(questions) || questions.length === 0) {
            return NextResponse.json({ error: 'Name and at least one question are required.' }, { status: 400 })
        }

        // Validate question structure
        for (const q of questions) {
            if (!q.question || !q.field_name) {
                return NextResponse.json({ error: 'Each question must have a "question" text and a "field_name".' }, { status: 400 })
            }
        }

        // If activating this flow, deactivate all others for this user
        if (is_active) {
            await supabase
                .from('whatsapp_question_flows')
                .update({ is_active: false })
                .eq('user_id', effectiveUserId)
        }

        const { data: newFlow, error: insertErr } = await supabase
            .from('whatsapp_question_flows')
            .insert({
                user_id: effectiveUserId,
                name,
                questions,
                is_active: is_active || false,
                linked_campaign_id: linked_campaign_id || null
            })
            .select()
            .single()

        if (insertErr) {
            console.error('[QUESTION FLOWS API] Error creating:', insertErr)
            return NextResponse.json({ error: insertErr.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, flow: newFlow })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}

export async function PUT(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const effectiveUserId = await getEffectiveUserId(supabase, user, req)

        const body = await req.json()
        const { id, name, questions, linked_campaign_id, is_active } = body

        if (!id) {
            return NextResponse.json({ error: 'Missing flow ID' }, { status: 400 })
        }

        const updateData: any = {}
        if (name !== undefined) updateData.name = name
        if (questions !== undefined) updateData.questions = questions
        if (linked_campaign_id !== undefined) updateData.linked_campaign_id = linked_campaign_id || null

        // If activating this flow, deactivate all others first
        if (is_active === true) {
            await supabase
                .from('whatsapp_question_flows')
                .update({ is_active: false })
                .eq('user_id', effectiveUserId)
            updateData.is_active = true
        } else if (is_active === false) {
            updateData.is_active = false
        }

        const { data: updatedFlow, error: updateErr } = await supabase
            .from('whatsapp_question_flows')
            .update(updateData)
            .eq('id', id)
            .eq('user_id', effectiveUserId)
            .select()
            .single()

        if (updateErr) {
            console.error('[QUESTION FLOWS API] Error updating:', updateErr)
            return NextResponse.json({ error: updateErr.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, flow: updatedFlow })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}

export async function DELETE(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const effectiveUserId = await getEffectiveUserId(supabase, user, req)

        const { searchParams } = new URL(req.url)
        const id = searchParams.get('id')

        if (!id) {
            return NextResponse.json({ error: 'Missing flow ID' }, { status: 400 })
        }

        const { error: deleteErr } = await supabase
            .from('whatsapp_question_flows')
            .delete()
            .eq('id', id)
            .eq('user_id', effectiveUserId)

        if (deleteErr) {
            console.error('[QUESTION FLOWS API] Error deleting:', deleteErr)
            return NextResponse.json({ error: deleteErr.message }, { status: 500 })
        }

        return NextResponse.json({ success: true })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
