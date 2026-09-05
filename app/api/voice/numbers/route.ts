import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { 
    formatIndianPhoneNumber, 
    classifyNumberPattern, 
    type VobizAvailableNumber 
} from '@/utils/vobiz-catalog'

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
)

export async function GET(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(req.url)
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
        const limit = Math.max(1, Math.min(50, parseInt(url.searchParams.get('limit') || '8', 10)))
        const search = (url.searchParams.get('search') || '').trim()
        const category = url.searchParams.get('category') || 'all'

        // 1. Fetch all claimed numbers in the system to mark availability
        const { data: allClaimedProfiles } = await supabaseAdmin
            .from('profiles')
            .select('id, voice_twilio_number, business_info')

        const claimedNumbersSet = new Set<string>()
        if (allClaimedProfiles) {
            for (const p of allClaimedProfiles) {
                if (p.voice_twilio_number && p.voice_twilio_number.startsWith('+91')) {
                    claimedNumbersSet.add(p.voice_twilio_number.replace(/\s+/g, ''))
                }
                if (p.business_info) {
                    try {
                        const bi = typeof p.business_info === 'string' ? JSON.parse(p.business_info) : p.business_info
                        if (bi.voice_vobiz_number && bi.voice_vobiz_number.startsWith('+91')) {
                            claimedNumbersSet.add(bi.voice_vobiz_number.replace(/\s+/g, ''))
                        }
                    } catch (e) {}
                }
            }
        }

        // 2. Query Live Vobiz Inventory API
        const authId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86'
        const authToken = process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU'

        let vobizSearch = '%2B9179'
        const searchDigits = search.replace(/\D/g, '')
        if (searchDigits) {
            vobizSearch = encodeURIComponent(searchDigits)
        }

        // When a category filter is active, fetch a larger window from Vobiz so we can filter accurately
        const fetchPerPage = category !== 'all' ? 50 : Math.max(limit, 12)

        const vobizUrl = `https://api.vobiz.ai/api/v1/Account/${authId}/inventory/numbers?search=${vobizSearch}&page=${page}&per_page=${fetchPerPage}`
        
        let liveItems: any[] = []
        let totalLive = 0

        try {
            const vobizRes = await fetch(vobizUrl, {
                headers: {
                    'X-Auth-ID': authId,
                    'X-Auth-Token': authToken,
                    'Content-Type': 'application/json'
                },
                next: { revalidate: 30 } // cache for 30s
            })

            if (vobizRes.ok) {
                const data = await vobizRes.json()
                liveItems = data.items || []
                totalLive = data.total || liveItems.length
            } else {
                console.error(`[VOICE NUMBERS API] Vobiz error HTTP ${vobizRes.status}`)
            }
        } catch (vErr: any) {
            console.error('[VOICE NUMBERS API] Network error connecting to Vobiz:', vErr.message)
        }

        // Map live items into clean schema
        const mappedNumbers: (VobizAvailableNumber & { isClaimed: boolean })[] = liveItems.map((item: any) => {
            const e164 = item.e164 || item.phone_number
            const cat = classifyNumberPattern(e164)
            return {
                phoneNumber: e164,
                formattedNumber: formatIndianPhoneNumber(e164),
                region: '79-Series',
                state: 'India',
                type: 'Local',
                monthlyRental: 0,
                capabilities: {
                    voice: true,
                    sms: !!item.capabilities?.sms,
                    bidirectional: true
                },
                isPopular: cat === 'VIP',
                category: cat,
                isClaimed: claimedNumbersSet.has(e164.replace(/\s+/g, ''))
            }
        })

        // Apply category filter if requested
        let filtered = mappedNumbers
        if (category !== 'all') {
            filtered = filtered.filter(n => n.category === category)
        }

        const chunk = filtered.slice(0, limit)

        const categoryCounts = {
            all: totalLive || mappedNumbers.length,
            VIP: mappedNumbers.filter(n => n.category === 'VIP').length,
            easyRecall: mappedNumbers.filter(n => n.category === 'Easy Recall').length,
            standard: mappedNumbers.filter(n => n.category === 'Standard').length
        }

        return NextResponse.json({
            success: true,
            numbers: chunk,
            total: totalLive || filtered.length,
            page,
            limit,
            totalPages: Math.max(1, Math.ceil((totalLive || filtered.length) / limit)),
            hasMore: (page * limit) < (totalLive || filtered.length),
            categoryCounts
        })
    } catch (e: any) {
        console.error('[VOICE NUMBERS API ERROR]', e)
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
