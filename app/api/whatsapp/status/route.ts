import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
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

        const { data: profile } = await supabase
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_waba_id, whatsapp_business_account_id, role, email')
            .eq('id', targetId)
            .single()

        if (!profile) {
            return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
        }

        const wabaId = profile.whatsapp_waba_id || profile.whatsapp_business_account_id
        
        const isMasterDefaultUser = profile.email === 'rchopra489@gmail.com' || profile.email === 'infobluesquareinfra@gmail.com'
        const token = profile.whatsapp_access_token || (isMasterDefaultUser ? process.env.DEV_WHATSAPP_ACCESS_TOKEN : null)

        if (!wabaId || !token) {
            return NextResponse.json({ 
                success: false, 
                message: 'WhatsApp Business Account not connected' 
            })
        }

        // 1. Fetch WABA Basic info (Name, Currency, timezone)
        const wabaRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}?fields=id,name,currency,timezone_id&access_token=${token}`)
        const wabaData = await wabaRes.json()

        if (wabaData.error) {
            console.error('[WhatsApp Status API] WABA fetch error:', wabaData.error)
            return NextResponse.json({ 
                success: false, 
                error: wabaData.error.message || 'Failed to fetch WABA details'
            })
        }

        // 2. Fetch payment configurations
        const payRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/payment_configurations?access_token=${token}`)
        const payData = await payRes.json()

        let hasPaymentMethod = false
        let tosAccepted = true
        let pendingTosUrl = null
        let errorMessage = null

        if (payData.error) {
            console.warn('[WhatsApp Status API] Payment config fetch error:', payData.error)
            errorMessage = payData.error.message

            // Parse TOS pending error
            if (payData.error.error_data?.details && payData.error.error_data.details.includes('Terms of Service acceptance pending')) {
                tosAccepted = false
                // Extract TOS Link from details if possible
                const match = payData.error.error_data.details.match(/https?:\/\/[^\s]+/);
                if (match) {
                    pendingTosUrl = match[0]
                } else {
                    pendingTosUrl = 'https://fb.me/2bcZ0cOTE9VAxqQ'
                }
            }
            hasPaymentMethod = false
        } else {
            // No error means the account is active and billing is set up successfully
            hasPaymentMethod = true
        }

        return NextResponse.json({
            success: true,
            waba_id: wabaId,
            waba_name: wabaData.name,
            currency: wabaData.currency || 'INR',
            has_payment_method: hasPaymentMethod,
            tos_accepted: tosAccepted,
            pending_tos_url: pendingTosUrl,
            error_message: errorMessage
        })

    } catch (e: any) {
        console.error('[WhatsApp Status API] Exception:', e)
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
