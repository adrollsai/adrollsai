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

        const { data: flows, error: flowsErr } = await supabase
            .from('whatsapp_flows')
            .select('*')
            .eq('user_id', effectiveUserId)
            .order('created_at', { ascending: true })

        if (flowsErr) {
            console.error('[FLOWS API] Error fetching flows:', flowsErr)
            return NextResponse.json({ error: flowsErr.message }, { status: 500 })
        }

        // Fetch properties to match names in frontend
        const { data: properties } = await supabase
            .from('properties')
            .select('id, title')
            .eq('user_id', effectiveUserId)

        const resolvedFlows = (flows || []).map(flow => {
            const property = (properties || []).find(p => p.id === flow.property_id)
            return {
                ...flow,
                property_title: property ? property.title : 'Default / All Projects'
            }
        })

        return NextResponse.json({ success: true, flows: resolvedFlows })
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
        const { 
            title, 
            description, 
            icon_name, 
            template_name, 
            template_body, 
            delay_minutes, 
            property_id,
            campaign_name,
            variables_mapping,
            header_media_url
        } = body

        if (!title || !template_name || !template_body) {
            return NextResponse.json({ error: 'Missing required flow details (title, template_name, template_body)' }, { status: 400 })
        }

        const { data: newFlow, error: insertErr } = await supabase
            .from('whatsapp_flows')
            .insert({
                user_id: effectiveUserId,
                title,
                description: description || '',
                icon_name: icon_name || 'MessageCircle',
                template_name,
                template_body,
                delay_minutes: delay_minutes !== undefined ? parseInt(delay_minutes) : 2,
                property_id: property_id || null,
                campaign_name: campaign_name || 'All',
                variables_mapping: variables_mapping || {},
                header_media_url: header_media_url || null,
                is_active: false
            })
            .select()
            .single()

        if (insertErr) {
            console.error('[FLOWS API] Error creating flow:', insertErr)
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
        const { 
            id, 
            title, 
            description, 
            icon_name, 
            template_name, 
            template_body, 
            delay_minutes, 
            property_id, 
            campaign_name,
            variables_mapping,
            header_media_url,
            is_active 
        } = body

        if (!id) {
            return NextResponse.json({ error: 'Missing flow ID' }, { status: 400 })
        }

        const updateData: any = {}
        if (title !== undefined) updateData.title = title
        if (description !== undefined) updateData.description = description
        if (icon_name !== undefined) updateData.icon_name = icon_name
        if (template_name !== undefined) updateData.template_name = template_name
        if (template_body !== undefined) updateData.template_body = template_body
        if (delay_minutes !== undefined) updateData.delay_minutes = parseInt(delay_minutes)
        if (property_id !== undefined) updateData.property_id = property_id || null
        if (campaign_name !== undefined) updateData.campaign_name = campaign_name || 'All'
        if (variables_mapping !== undefined) updateData.variables_mapping = variables_mapping || {}
        if (header_media_url !== undefined) updateData.header_media_url = header_media_url || null
        if (is_active !== undefined) updateData.is_active = is_active

        const { data: updatedFlow, error: updateErr } = await supabase
            .from('whatsapp_flows')
            .update(updateData)
            .eq('id', id)
            .eq('user_id', effectiveUserId)
            .select()
            .single()

        if (updateErr) {
            console.error('[FLOWS API] Error updating flow:', updateErr)
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
            .from('whatsapp_flows')
            .delete()
            .eq('id', id)
            .eq('user_id', effectiveUserId)

        if (deleteErr) {
            console.error('[FLOWS API] Error deleting flow:', deleteErr)
            return NextResponse.json({ error: deleteErr.message }, { status: 500 })
        }

        return NextResponse.json({ success: true })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
