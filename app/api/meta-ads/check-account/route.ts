import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const adAccountId = searchParams.get('adAccountId')
    const pageId = searchParams.get('pageId')
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('facebook_token, agency_id, parent_id').eq('id', user.id).single()
    
    let token = profile?.facebook_token
    if (!token && (profile?.agency_id || profile?.parent_id)) {
        const { data: parentProfile } = await supabase
            .from('profiles')
            .select('facebook_token')
            .eq('id', profile.agency_id || profile.parent_id)
            .single()
        token = parentProfile?.facebook_token
    }

    if (!token) return NextResponse.json({ error: 'No token' }, { status: 400 })

    try {
        // has_payment_method requires restricted permissions and triggers OAuthException. 
        // We query funding_source and funding_source_details which are standard public fields.
        const res = await fetch(`https://graph.facebook.com/v19.0/${adAccountId}?fields=account_status,disable_reason,funding_source,funding_source_details,balance,spend_cap,amount_spent,currency&access_token=${token}`)
        const data = await res.json()

        if (data.error) {
            console.error("[check-account API] Ad Account Graph error:", data.error)
            return NextResponse.json({ error: data.error.message || 'Meta API error' }, { status: 400 })
        }

        const hasPaymentMethod = !!(data.funding_source || data.funding_source_details)

        let leadgenTos = null
        if (pageId) {
            try {
                // leadgen_tos endpoint is deprecated/restricted in v19.0+; we query page fields directly.
                const tosRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=leadgen_tos_accepted,name&access_token=${token}`)
                const tosData = await tosRes.json()
                
                if (tosData && typeof tosData.leadgen_tos_accepted === 'boolean') {
                    leadgenTos = {
                        leadgen_tos: {
                            accepted: tosData.leadgen_tos_accepted
                        }
                    }
                } else {
                    console.error("[check-account API] Page TOS check returned unexpected format:", tosData)
                    leadgenTos = {
                        leadgen_tos: {
                            accepted: false
                        }
                    }
                }
            } catch (tosErr: any) {
                console.error("[check-account API] leadgen_tos check failed:", tosErr.message)
            }
        }

        return NextResponse.json({
            account_status: data.account_status,
            disable_reason: data.disable_reason,
            has_payment_method: hasPaymentMethod,
            balance: data.balance,
            spend_cap: data.spend_cap,
            amount_spent: data.amount_spent,
            funding_source_details: data.funding_source_details,
            currency: data.currency,
            leadgenTos
        })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}