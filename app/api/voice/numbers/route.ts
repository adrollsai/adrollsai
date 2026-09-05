import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { VOBIZ_NUMBER_CATALOG } from '@/utils/vobiz-catalog'

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

        // Fetch all claimed numbers in the system to mark availability
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

        // Global category counts across full catalog
        const categoryCounts = {
            all: VOBIZ_NUMBER_CATALOG.length,
            VIP: VOBIZ_NUMBER_CATALOG.filter(n => n.category === 'VIP').length,
            easyRecall: VOBIZ_NUMBER_CATALOG.filter(n => n.category === 'Easy Recall').length,
            standard: VOBIZ_NUMBER_CATALOG.filter(n => n.category === 'Standard').length
        }

        // Filter numbers
        let filtered = VOBIZ_NUMBER_CATALOG.filter(item => {
            if (category !== 'all' && item.category !== category) {
                return false
            }
            if (search) {
                const searchDigits = search.replace(/\D/g, '') || search.toLowerCase()
                const phoneDigits = item.phoneNumber.replace(/\D/g, '')
                const formatted = item.formattedNumber.toLowerCase()
                if (!phoneDigits.includes(searchDigits) && !formatted.includes(searchDigits)) {
                    return false
                }
            }
            return true
        })

        const total = filtered.length
        const totalPages = Math.max(1, Math.ceil(total / limit))
        const offset = (page - 1) * limit
        const chunk = filtered.slice(offset, offset + limit)

        const numbersWithStatus = chunk.map(n => ({
            ...n,
            isClaimed: claimedNumbersSet.has(n.phoneNumber.replace(/\s+/g, ''))
        }))

        return NextResponse.json({
            success: true,
            numbers: numbersWithStatus,
            total,
            page,
            limit,
            totalPages,
            hasMore: offset + chunk.length < total,
            categoryCounts
        })
    } catch (e: any) {
        console.error('[VOICE NUMBERS API ERROR]', e)
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
