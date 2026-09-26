import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface AccountActivityItem {
  id: string
  timestamp: string
  category: 'transfers' | 'leads' | 'assets' | 'landing_pages' | 'campaigns' | 'credits' | 'products' | 'system'
  isCreation?: boolean
  action: string
  title: string
  description: string
  statusBadge?: {
    text: string
    variant: 'blue' | 'emerald' | 'purple' | 'amber' | 'rose' | 'slate' | 'indigo'
  }
  link?: string
  metadata?: Record<string, any>
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(req.url)
    const impersonateId = url.searchParams.get('impersonate')
    const categoryParam = url.searchParams.get('category') || 'all'
    const searchQuery = (url.searchParams.get('search') || '').trim().toLowerCase()
    const dateRange = url.searchParams.get('date_range') || 'all'
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
    const limit = Math.min(200, Math.max(10, parseInt(url.searchParams.get('limit') || '50', 10)))

    // Resolve target account
    let targetUserId = user.id
    const { data: currentProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, role, parent_id, agency_id, full_name, email')
      .eq('id', user.id)
      .single()

    const canImpersonate = ['super_admin', 'agency', 'admin'].includes(currentProfile?.role || '')

    if (impersonateId && canImpersonate) {
      targetUserId = impersonateId
    } else if (currentProfile?.parent_id || currentProfile?.agency_id) {
      targetUserId = currentProfile.parent_id || currentProfile.agency_id || user.id
    }

    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, role, agency_name')
      .eq('id', targetUserId)
      .single()

    // Date range filter helper
    const now = new Date()
    let minDate: Date | null = null
    if (dateRange === 'today') {
      minDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    } else if (dateRange === '7days') {
      minDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    } else if (dateRange === '30days') {
      minDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    }

    // Parallel fetch from all data sources
    const [
      notifsRes,
      lhRes,
      leadsRes,
      assetsRes,
      lpsRes,
      campsRes,
      voiceCampsRes,
      creditsRes,
      propsRes
    ] = await Promise.all([
      supabaseAdmin
        .from('notifications')
        .select('id, title, message, type, action_link, created_at')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(200),
      supabaseAdmin
        .from('lead_history')
        .select('id, lead_id, action_type, description, created_at')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(250),
      supabaseAdmin
        .from('leads')
        .select('id, name, email, phone, source, status, created_at')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(200),
      supabaseAdmin
        .from('assets')
        .select('id, type, status, caption, created_at, metadata, url')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(150),
      supabaseAdmin
        .from('landing_pages')
        .select('id, title, slug, product_name, created_at, updated_at')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(100),
      supabaseAdmin
        .from('campaigns')
        .select('id, name, status, created_at, total_budget, budget_type')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(100),
      supabaseAdmin
        .from('voice_campaigns')
        .select('id, name, status, created_at')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabaseAdmin
        .from('credit_transactions')
        .select('id, amount, category, description, created_at')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(200),
      supabaseAdmin
        .from('properties')
        .select('id, title, address, price, created_at')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(100)
    ])

    const allItems: AccountActivityItem[] = []

    // 1. Process Lead History (Transfers, Status Changes, Calls, Notes)
    const lhList = lhRes.data || []
    for (const lh of lhList) {
      const isTransfer = lh.action_type === 'TRANSFER' || (lh.description && lh.description.toLowerCase().includes('transferred'))
      if (isTransfer) {
        allItems.push({
          id: `lh_${lh.id}`,
          timestamp: lh.created_at,
          category: 'transfers',
          action: 'Lead Transferred',
          title: 'Lead Pipeline Transfer',
          description: lh.description || 'Lead was transferred between accounts/agents',
          statusBadge: { text: 'Transfer', variant: 'purple' },
          link: lh.lead_id ? `/dashboard/crm?leadId=${lh.lead_id}` : '/dashboard/crm',
          metadata: { lead_id: lh.lead_id, action_type: lh.action_type }
        })
      } else {
        const isCall = lh.action_type?.includes('CALL')
        allItems.push({
          id: `lh_${lh.id}`,
          timestamp: lh.created_at,
          category: 'leads',
          action: lh.action_type ? `Lead ${lh.action_type.replace(/_/g, ' ')}` : 'Lead Activity',
          title: lh.action_type || 'CRM Activity',
          description: lh.description || 'Lead interaction recorded',
          statusBadge: {
            text: lh.action_type || 'Update',
            variant: isCall ? 'indigo' : 'blue'
          },
          link: lh.lead_id ? `/dashboard/crm?leadId=${lh.lead_id}` : '/dashboard/crm',
          metadata: { lead_id: lh.lead_id, action_type: lh.action_type }
        })
      }
    }

    // 2. Process Notifications (including transfer notifications and system alerts)
    const notifs = notifsRes.data || []
    for (const n of notifs) {
      const isTransfer = n.type === 'lead_transfer' || (n.title && n.title.toLowerCase().includes('transfer'))
      if (isTransfer) {
        allItems.push({
          id: `notif_${n.id}`,
          timestamp: n.created_at,
          category: 'transfers',
          action: 'Transfer Notice',
          title: n.title,
          description: n.message,
          statusBadge: { text: 'Inbound Transfer', variant: 'purple' },
          link: n.action_link || '/dashboard/crm',
          metadata: { type: n.type }
        })
      } else {
        allItems.push({
          id: `notif_${n.id}`,
          timestamp: n.created_at,
          category: 'system',
          action: 'System Alert',
          title: n.title,
          description: n.message,
          statusBadge: { text: 'Alert', variant: 'slate' },
          link: n.action_link || undefined,
          metadata: { type: n.type }
        })
      }
    }

    // 3. Process Leads (Inflow & Creation)
    const leads = leadsRes.data || []
    for (const lead of leads) {
      allItems.push({
        id: `lead_${lead.id}`,
        timestamp: lead.created_at,
        category: 'leads',
        isCreation: true,
        action: 'Lead Captured',
        title: lead.name || 'New Inbound Lead',
        description: `Source: ${lead.source || 'Direct Entry'}${lead.phone ? ` • Phone: ${lead.phone}` : ''}${lead.email ? ` • Email: ${lead.email}` : ''}`,
        statusBadge: { text: lead.status || 'Fresh Lead', variant: 'emerald' },
        link: `/dashboard/crm?leadId=${lead.id}`,
        metadata: { phone: lead.phone, email: lead.email, source: lead.source, status: lead.status }
      })
    }

    // 4. Process Assets (AI Videos, AI Images)
    const assets = assetsRes.data || []
    for (const a of assets) {
      const isVideo = a.type === 'video'
      const dur = a.metadata?.duration ? `${Math.round(a.metadata.duration)}s` : undefined
      const model = a.metadata?.videoModel ? a.metadata.videoModel.toUpperCase() : 'AI'
      
      let headline = a.caption ? (a.caption.slice(0, 75) + (a.caption.length > 75 ? '...' : '')) : (isVideo ? 'AI Video Creative' : 'AI Image Creative')

      allItems.push({
        id: `asset_${a.id}`,
        timestamp: a.created_at,
        category: 'assets',
        isCreation: true,
        action: isVideo ? `AI Video Generated (${model}${dur ? ` • ${dur}` : ''})` : 'AI Creative Image Generated',
        title: headline,
        description: `Model: ${model}${dur ? ` • Length: ${dur}` : ''} • Status: ${a.status || 'Ready'}${a.caption ? `\n"${a.caption.slice(0, 140)}..."` : ''}`,
        statusBadge: {
          text: isVideo ? `Video (${dur || '15s'})` : 'Image',
          variant: isVideo ? 'indigo' : 'purple'
        },
        link: '/dashboard/assets',
        metadata: {
          type: a.type,
          status: a.status,
          url: a.url,
          duration: a.metadata?.duration,
          videoModel: a.metadata?.videoModel,
          thumbnailUrl: a.metadata?.thumbnailUrl
        }
      })
    }

    // 5. Process Landing Pages
    const lps = lpsRes.data || []
    for (const lp of lps) {
      allItems.push({
        id: `lp_${lp.id}`,
        timestamp: lp.created_at || lp.updated_at,
        category: 'landing_pages',
        isCreation: true,
        action: 'Landing Page Created',
        title: lp.title || lp.product_name || lp.slug || 'Landing Page',
        description: `URL: /landing/${lp.slug}${lp.product_name ? ` • Product: ${lp.product_name}` : ''}`,
        statusBadge: { text: 'Landing Page', variant: 'blue' },
        link: `/landing/${lp.slug}`,
        metadata: { slug: lp.slug, product_name: lp.product_name }
      })
    }

    // 6. Process Ad Campaigns
    const camps = campsRes.data || []
    for (const c of camps) {
      allItems.push({
        id: `camp_${c.id}`,
        timestamp: c.created_at,
        category: 'campaigns',
        isCreation: true,
        action: 'Meta Ad Campaign Launched',
        title: c.name || 'Ad Campaign',
        description: `Budget: ₹${c.total_budget || 0} (${c.budget_type || 'Daily'}) • Status: ${c.status || 'Active'}`,
        statusBadge: { text: c.status || 'Campaign', variant: 'blue' },
        link: '/dashboard/ads',
        metadata: { budget: c.total_budget, budget_type: c.budget_type, status: c.status }
      })
    }

    // 7. Process Voice Campaigns
    const vcamps = voiceCampsRes.data || []
    for (const vc of vcamps) {
      allItems.push({
        id: `vc_${vc.id}`,
        timestamp: vc.created_at,
        category: 'campaigns',
        isCreation: true,
        action: 'Voice Agent Campaign Created',
        title: vc.name || 'Outbound Voice Campaign',
        description: `AI Voice agent calling campaign • Status: ${vc.status || 'Ready'}`,
        statusBadge: { text: 'Voice Campaign', variant: 'emerald' },
        link: '/dashboard/voice-agent',
        metadata: { status: vc.status }
      })
    }

    // 8. Process Credit Transactions
    const credits = creditsRes.data || []
    for (const c of credits) {
      const isSpend = c.amount < 0
      allItems.push({
        id: `credit_${c.id}`,
        timestamp: c.created_at,
        category: 'credits',
        action: isSpend ? 'Credits Deducted' : 'Credits Added',
        title: `${isSpend ? '-' : '+'}${Math.abs(c.amount)} Credits: ${c.category || 'General'}`,
        description: c.description || (isSpend ? 'Credit charge for AI generation or voice services' : 'Account credit top-up'),
        statusBadge: {
          text: `${isSpend ? '-' : '+'}${Math.abs(c.amount)} cr`,
          variant: isSpend ? 'amber' : 'emerald'
        },
        link: '/dashboard/profile',
        metadata: { amount: c.amount, category: c.category }
      })
    }

    // 9. Process Properties / Products
    const props = propsRes.data || []
    for (const p of props) {
      allItems.push({
        id: `prop_${p.id}`,
        timestamp: p.created_at,
        category: 'products',
        isCreation: true,
        action: 'Product / Property Added',
        title: p.title || 'New Product / Property',
        description: `${p.address ? `Address: ${p.address} • ` : ''}${p.price ? `Price: ${p.price}` : ''}`,
        statusBadge: { text: 'Catalogue', variant: 'purple' },
        link: '/dashboard/catalogue',
        metadata: { price: p.price, address: p.address }
      })
    }

    // Sort all items strictly newest first
    allItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    // Date range filter
    let filteredItems = allItems
    if (minDate) {
      const minMs = minDate.getTime()
      filteredItems = filteredItems.filter(item => new Date(item.timestamp).getTime() >= minMs)
    }

    // Search filter (across action, title, description, or metadata strings)
    if (searchQuery) {
      filteredItems = filteredItems.filter(item => {
        const fullText = `${item.action} ${item.title} ${item.description} ${JSON.stringify(item.metadata || {})}`.toLowerCase()
        return fullText.includes(searchQuery)
      })
    }

    // Calculate category counts on date/search filtered items
    const counts = {
      all: filteredItems.length,
      transfers: filteredItems.filter(i => i.category === 'transfers').length,
      creations: filteredItems.filter(i => i.isCreation || ['assets', 'landing_pages', 'campaigns', 'products'].includes(i.category)).length,
      leads: filteredItems.filter(i => i.category === 'leads').length,
      assets: filteredItems.filter(i => i.category === 'assets').length,
      landing_pages: filteredItems.filter(i => i.category === 'landing_pages').length,
      campaigns: filteredItems.filter(i => i.category === 'campaigns').length,
      credits: filteredItems.filter(i => i.category === 'credits').length,
      products: filteredItems.filter(i => i.category === 'products').length
    }

    // Apply category selection filter
    if (categoryParam !== 'all') {
      if (categoryParam === 'creations') {
        filteredItems = filteredItems.filter(i => i.isCreation || ['assets', 'landing_pages', 'campaigns', 'products'].includes(i.category))
      } else {
        filteredItems = filteredItems.filter(i => i.category === categoryParam)
      }
    }

    // Pagination
    const total = filteredItems.length
    const totalPages = Math.ceil(total / limit) || 1
    const startIndex = (page - 1) * limit
    const paginatedItems = filteredItems.slice(startIndex, startIndex + limit)

    return NextResponse.json({
      success: true,
      activities: paginatedItems,
      total,
      page,
      limit,
      totalPages,
      counts,
      targetUser: {
        id: targetUserId,
        email: targetProfile?.email,
        name: targetProfile?.full_name || targetProfile?.agency_name || 'Account'
      }
    })
  } catch (error: any) {
    console.error('[API Profile History Error]:', error)
    return NextResponse.json({ error: error?.message || 'Server error fetching account history' }, { status: 500 })
  }
}
