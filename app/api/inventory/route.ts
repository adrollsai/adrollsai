import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    
    // 1. Authenticate requester
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { action, propertyId, targetUserId, propertyData, autoGenerate } = body

    if (!action) {
      return NextResponse.json({ error: 'Missing action' }, { status: 400 })
    }

    // 2. Fetch requester profile for RBAC validation
    const { data: requesterProfile } = await supabase
      .from('profiles')
      .select('role, agency_id, parent_id')
      .eq('id', user.id)
      .single()

    const requesterRole = requesterProfile?.role || 'admin'
    const requesterAgencyId = requesterProfile?.agency_id || requesterProfile?.parent_id || user.id

    // Setup Admin client to bypass RLS
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    let authorized = false
    let resolvedOwnerId = ''

    if (action === 'insert') {
      if (!targetUserId || !propertyData) {
        return NextResponse.json({ error: 'Missing targetUserId or propertyData for insert' }, { status: 400 })
      }
      resolvedOwnerId = targetUserId

      // Authorization checks
      if (user.id === targetUserId) {
        authorized = true
      } else if (requesterRole === 'super_admin') {
        authorized = true
      } else if (requesterAgencyId === targetUserId) {
        authorized = true
      } else if (['agency', 'admin', 'agent'].includes(requesterRole)) {
        // Verify relationship: is targetUserId a subaccount/client of this agency/admin/agent?
        const { data: subAccount } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', targetUserId)
          .eq('agency_id', requesterAgencyId)
          .single()
        
        if (subAccount) {
          authorized = true
        }
      }
    } else {
      // For update, delete, toggle: fetch existing property to resolve owner first
      if (!propertyId) {
        return NextResponse.json({ error: 'Missing propertyId' }, { status: 400 })
      }

      const { data: existingProp, error: fetchPropError } = await supabaseAdmin
        .from('properties')
        .select('user_id')
        .eq('id', propertyId)
        .single()

      if (fetchPropError || !existingProp) {
        return NextResponse.json({ error: 'Property not found' }, { status: 404 })
      }

      resolvedOwnerId = existingProp.user_id

      // Authorization checks
      if (user.id === resolvedOwnerId) {
        authorized = true
      } else if (requesterRole === 'super_admin') {
        authorized = true
      } else if (requesterAgencyId === resolvedOwnerId) {
        authorized = true
      } else if (['agency', 'admin', 'agent'].includes(requesterRole)) {
        // Verify relationship: is resolvedOwnerId a subaccount/client of this agency?
        const { data: subAccount } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', resolvedOwnerId)
          .eq('agency_id', requesterAgencyId)
          .single()
        
        if (subAccount) {
          authorized = true
        }
      }
    }

    if (!authorized) {
      return NextResponse.json({ error: 'Forbidden: Unauthorized inventory modification' }, { status: 403 })
    }

    // 3. Execute actions using service role client
    if (action === 'insert') {
      const { data, error } = await supabaseAdmin
        .from('properties')
        .insert({
          user_id: resolvedOwnerId,
          title: propertyData.title,
          description: propertyData.description || '',
          address: propertyData.address || '',
          price: propertyData.price || '',
          property_type: propertyData.property_type || 'Generic',
          status: propertyData.status || 'Active',
          image_url: propertyData.image_url || '',
          images: propertyData.images || [],
          youtube_url: propertyData.youtube_url || null,
          auto_generate: false
        })
        .select()
        .single()

      if (error) throw error
      return NextResponse.json({ success: true, property: data })

    } else if (action === 'update') {
      if (!propertyData) {
        return NextResponse.json({ error: 'Missing propertyData for update' }, { status: 400 })
      }

      const { data, error } = await supabaseAdmin
        .from('properties')
        .update({
          title: propertyData.title,
          description: propertyData.description,
          image_url: propertyData.image_url,
          images: propertyData.images,
          youtube_url: propertyData.youtube_url
        })
        .eq('id', propertyId)
        .select()
        .single()

      if (error) throw error
      return NextResponse.json({ success: true, property: data })

    } else if (action === 'delete') {
      const { error } = await supabaseAdmin
        .from('properties')
        .delete()
        .eq('id', propertyId)

      if (error) throw error
      return NextResponse.json({ success: true })

    } else if (action === 'toggle-auto-generate') {
      if (autoGenerate === undefined) {
        return NextResponse.json({ error: 'Missing autoGenerate status' }, { status: 400 })
      }

      const { data, error } = await supabaseAdmin
        .from('properties')
        .update({ auto_generate: autoGenerate })
        .eq('id', propertyId)
        .select()
        .single()

      if (error) throw error
      return NextResponse.json({ success: true, property: data })

    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

  } catch (error: any) {
    console.error("[Inventory API] Error executing action:", error)
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 })
  }
}
