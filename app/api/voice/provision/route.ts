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

        // 1. Search for an available US Local phone number
        const searchUrl = `https://api.twilio.com/2010-04-01/Accounts/${masterSid}/AvailablePhoneNumbers/US/Local.json?Limit=1`
        const basicAuth = Buffer.from(`${masterSid}:${masterToken}`).toString('base64')

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

        const selectedNumber = availableNumbers[0].phone_number

        // 2. Purchase (provision) the selected number
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

        // 3. Save the number to the user's profile
        const { error: dbErr } = await supabase
            .from('profiles')
            .update({ voice_twilio_number: provisionedNumber })
            .eq('id', user.id)

        if (dbErr) {
            return NextResponse.json({ error: 'Number purchased but database save failed.' }, { status: 500 })
        }

        return NextResponse.json({ success: true, phoneNumber: provisionedNumber })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
