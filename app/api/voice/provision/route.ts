import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        // Retrieve master Twilio credentials from environment variables
        const masterSid = process.env.MASTER_TWILIO_SID || process.env.DEV_TWILIO_SID
        const masterToken = process.env.MASTER_TWILIO_TOKEN || process.env.DEV_TWILIO_TOKEN

        if (!masterSid || !masterToken) {
            return NextResponse.json({ 
                error: 'SaaS Platform Twilio credentials are not configured on the server. Please add MASTER_TWILIO_SID to environment variables.' 
            }, { status: 501 })
        }

        const url = new URL(req.url)
        const impersonateId = url.searchParams.get('impersonate')

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

        // Fetch user's previous voice twilio configuration to support recovery
        const { data: targetProfile } = await supabase
            .from('profiles')
            .select('voice_twilio_number, old_voice_twilio_number')
            .eq('id', targetId)
            .single()

        const oldNumber = targetProfile?.voice_twilio_number || targetProfile?.old_voice_twilio_number
        let selectedNumber = ''
        const basicAuth = Buffer.from(`${masterSid}:${masterToken}`).toString('base64')

        if (oldNumber) {
            // 1. Check if we already own it in Twilio
            try {
                const checkUrl = `https://api.twilio.com/2010-04-01/Accounts/${masterSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(oldNumber)}`
                const checkRes = await fetch(checkUrl, {
                    headers: { 'Authorization': `Basic ${basicAuth}` }
                })
                if (checkRes.ok) {
                    const checkData = await checkRes.json()
                    const incomingNumbers = checkData.incoming_phone_numbers || []
                    if (incomingNumbers.length > 0) {
                        // We already own this number! Restoring connection.
                        await supabase
                            .from('profiles')
                            .update({ 
                                voice_twilio_number: oldNumber,
                                old_voice_twilio_number: null
                            })
                            .eq('id', targetId)
                        return NextResponse.json({ success: true, phoneNumber: oldNumber, message: 'Number restored successfully.' })
                    }
                }
            } catch (checkErr) {
                console.error('[PROVISION] Error checking number ownership:', checkErr)
            }

            // 2. Try to reclaim from Twilio AvailablePhoneNumbers
            try {
                const cleanOldNumber = oldNumber.replace(/\D/g, '')
                const reclaimUrl = `https://api.twilio.com/2010-04-01/Accounts/${masterSid}/AvailablePhoneNumbers/US/Local.json?Contains=${cleanOldNumber}&Limit=1`
                const reclaimRes = await fetch(reclaimUrl, {
                    headers: { 'Authorization': `Basic ${basicAuth}` }
                })
                if (reclaimRes.ok) {
                    const reclaimData = await reclaimRes.json()
                    const availableReclaim = reclaimData.available_phone_numbers || []
                    if (availableReclaim.length > 0) {
                        selectedNumber = availableReclaim[0].phone_number
                    }
                }
            } catch (reclaimErr) {
                console.error('[PROVISION] Error attempting number reclaim search:', reclaimErr)
            }
        }

        // If old number is not reclaimable, search for a new available local US number
        if (!selectedNumber) {
            const searchUrl = `https://api.twilio.com/2010-04-01/Accounts/${masterSid}/AvailablePhoneNumbers/US/Local.json?Limit=1`
            const searchRes = await fetch(searchUrl, {
                headers: { 'Authorization': `Basic ${basicAuth}` }
            })

            if (!searchRes.ok) {
                const searchErr = await searchRes.json()
                console.error('[PROVISION] Twilio number search failed:', searchErr)
                return NextResponse.json({ error: searchErr.message || 'Failed to search available numbers.' }, { status: 400 })
            }

            const searchData = await searchRes.json()
            const availableNumbers = searchData.available_phone_numbers || []

            if (availableNumbers.length === 0) {
                return NextResponse.json({ error: 'No available phone numbers found to provision.' }, { status: 404 })
            }

            selectedNumber = availableNumbers[0].phone_number
        }

        // 3. Purchase the selected number
        const purchaseUrl = `https://api.twilio.com/2010-04-01/Accounts/${masterSid}/IncomingPhoneNumbers.json`
        const params = new URLSearchParams()
        params.append('PhoneNumber', selectedNumber)

        const purchaseRes = await fetch(purchaseUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${basicAuth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params
        })

        if (!purchaseRes.ok) {
            const purchaseErr = await purchaseRes.json()
            console.error('[PROVISION] Twilio number purchase failed:', purchaseErr)
            return NextResponse.json({ error: purchaseErr.message || 'Failed to purchase phone number.' }, { status: 400 })
        }

        const purchaseData = await purchaseRes.json()
        const provisionedNumber = purchaseData.phone_number

        // 4. Save the purchased number to the user's profile and clear backup
        const { error: dbErr } = await supabase
            .from('profiles')
            .update({ 
                voice_twilio_number: provisionedNumber,
                old_voice_twilio_number: null
            })
            .eq('id', targetId)

        if (dbErr) {
            return NextResponse.json({ error: 'Number purchased but database save failed.' }, { status: 500 })
        }

        return NextResponse.json({ success: true, phoneNumber: provisionedNumber })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
