import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

const supabaseAdmin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function normalizePhoneDigits(raw: string): string | null {
    if (!raw) return null
    const digits = raw.replace(/\D/g, '')
    if (digits.length < 10) return null
    return digits.slice(-10)
}

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        let user = null
        const authHeader = req.headers.get('Authorization')
        if (authHeader?.startsWith('Bearer ')) {
            const token = authHeader.substring(7)
            const { data } = await supabaseAdmin.auth.getUser(token)
            user = data?.user
        }
        if (!user) {
            const { data } = await supabase.auth.getUser()
            user = data?.user
        }
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const url = new URL(req.url)
        let impersonateId = url.searchParams.get('impersonate')

        let targetId = user.id
        if (impersonateId) {
            const { data: authProfile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single()
            if (['super_admin', 'agency', 'admin'].includes(authProfile?.role || '')) {
                targetId = impersonateId
            }
        }

        const body = await req.json()
        const { groupName, phoneNumbers, addNewLeadsIfMissing } = body

        if (!groupName || typeof groupName !== 'string' || !groupName.trim()) {
            return NextResponse.json({ error: 'Audience Group Name is required.' }, { status: 400 })
        }

        const cleanGroupName = groupName.trim()

        if (!phoneNumbers || !Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
            return NextResponse.json({ error: 'Please provide at least one phone number.' }, { status: 400 })
        }

        // Normalize and extract unique 10-digit phone numbers
        const uniqueNumberMap = new Map<string, string>() // 10-digit -> formatted phone
        for (const raw of phoneNumbers) {
            const digits = normalizePhoneDigits(String(raw))
            if (digits && !uniqueNumberMap.has(digits)) {
                let formatted = String(raw).trim()
                if (!formatted.startsWith('+')) {
                    formatted = digits.length === 10 ? `+91${digits}` : `+${digits}`
                }
                uniqueNumberMap.set(digits, formatted)
            }
        }

        if (uniqueNumberMap.size === 0) {
            return NextResponse.json({ error: 'No valid 10-digit phone numbers were found.' }, { status: 400 })
        }

        const target10Digits = Array.from(uniqueNumberMap.keys())

        // Fetch all existing leads for targetId with pagination
        let allExistingLeads: any[] = []
        let page = 0
        const pageSize = 1000
        while (true) {
            const { data: batch, error: batchErr } = await supabaseAdmin
                .from('leads')
                .select('id, name, phone, csv_audience, custom_fields, pipeline_stage, source')
                .eq('user_id', targetId)
                .range(page * pageSize, (page + 1) * pageSize - 1)

            if (batchErr || !batch || batch.length === 0) break
            allExistingLeads = allExistingLeads.concat(batch)
            if (batch.length < pageSize) break
            page++
        }

        // Match existing leads by 10-digit phone number
        const matchedLeadIds = new Set<string>()
        const matchedPhoneDigits = new Set<string>()
        const leadsToUpdate: any[] = []

        for (const lead of allExistingLeads) {
            if (!lead.phone) continue
            const leadDigits = normalizePhoneDigits(lead.phone)
            if (leadDigits && uniqueNumberMap.has(leadDigits)) {
                matchedPhoneDigits.add(leadDigits)
                if (!matchedLeadIds.has(lead.id)) {
                    matchedLeadIds.add(lead.id)

                    // Prepare updated csv_audience & custom_fields
                    let updatedCsvAudience = lead.csv_audience || ''
                    if (!updatedCsvAudience) {
                        updatedCsvAudience = cleanGroupName
                    } else if (!updatedCsvAudience.includes(cleanGroupName)) {
                        updatedCsvAudience = `${updatedCsvAudience}, ${cleanGroupName}`
                    }

                    let cf = lead.custom_fields || {}
                    if (typeof cf === 'string') {
                        try { cf = JSON.parse(cf) } catch (e) { cf = {} }
                    }
                    const groups = Array.isArray(cf.audience_groups) 
                        ? [...cf.audience_groups] 
                        : (cf.audience_groups ? [cf.audience_groups] : [])

                    if (!groups.includes(cleanGroupName)) {
                        groups.push(cleanGroupName)
                    }
                    cf.audience_groups = groups

                    leadsToUpdate.push({
                        id: lead.id,
                        csv_audience: updatedCsvAudience,
                        custom_fields: cf
                    })
                }
            }
        }

        // Execute batch updates on matched leads
        const BATCH_SIZE = 50
        for (let i = 0; i < leadsToUpdate.length; i += BATCH_SIZE) {
            const batch = leadsToUpdate.slice(i, i + BATCH_SIZE)
            await Promise.all(batch.map(item => 
                supabaseAdmin
                    .from('leads')
                    .update({
                        csv_audience: item.csv_audience,
                        custom_fields: item.custom_fields
                    })
                    .eq('id', item.id)
            ))
        }

        // Handle non-existing phone numbers if requested
        let newlyAddedCount = 0
        if (addNewLeadsIfMissing) {
            const nonExistingDigits = target10Digits.filter(d => !matchedPhoneDigits.has(d))
            if (nonExistingDigits.length > 0) {
                const newLeadsPayload = nonExistingDigits.map(d => ({
                    user_id: targetId,
                    name: `Lead (${uniqueNumberMap.get(d)})`,
                    phone: uniqueNumberMap.get(d),
                    source: 'Audience List',
                    pipeline_stage: 'New',
                    csv_audience: cleanGroupName,
                    custom_fields: { audience_groups: [cleanGroupName] },
                    created_at: new Date().toISOString()
                }))

                for (let i = 0; i < newLeadsPayload.length; i += BATCH_SIZE) {
                    const chunk = newLeadsPayload.slice(i, i + BATCH_SIZE)
                    const { data: inserted, error: insErr } = await supabaseAdmin
                        .from('leads')
                        .insert(chunk)
                        .select('id')
                    if (!insErr && inserted) {
                        newlyAddedCount += inserted.length
                    }
                }
            }
        }

        return NextResponse.json({
            success: true,
            groupName: cleanGroupName,
            matchedCount: matchedLeadIds.size,
            addedCount: newlyAddedCount,
            totalCount: matchedLeadIds.size + newlyAddedCount,
            message: `Successfully tagged ${matchedLeadIds.size} existing leads under "${cleanGroupName}"!${newlyAddedCount > 0 ? ` (${newlyAddedCount} new leads added)` : ''}`
        })
    } catch (err: any) {
        console.error('[AUDIENCE GROUP API ERROR]:', err)
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
    }
}
