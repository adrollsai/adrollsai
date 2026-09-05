import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { logToFile } from '@/utils/logger'

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const adAccountId = searchParams.get('adAccountId')
    const pageId = searchParams.get('pageId')
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        logToFile("[Check-Account API] Unauthorized - No user session");
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const impersonateId = searchParams.get('impersonate')
    const { data: profile } = await supabase.from('profiles').select('role, facebook_token, agency_id, parent_id').eq('id', user.id).single()
    
    logToFile(`[Check-Account API] Request by User: ${user.id} (${profile?.role}), Impersonating: ${impersonateId}`);

    let targetUserId = (['admin', 'agent'].includes(profile?.role || '') && (profile?.agency_id || profile?.parent_id)) 
      ? (profile.agency_id || profile.parent_id) 
      : user.id

    if (impersonateId && impersonateId !== user.id) {
        if (['super_admin', 'agency', 'admin', 'agent'].includes(profile?.role || '')) {
            if (profile?.role !== 'super_admin') {
                const isParent = (profile?.agency_id === impersonateId || profile?.parent_id === impersonateId);
                const { data: subAccount } = await supabase
                  .from('profiles')
                  .select('id')
                  .eq('id', impersonateId)
                  .eq('agency_id', profile?.agency_id || user.id)
                  .single()

                if (isParent || subAccount) {
                    targetUserId = impersonateId
                } else {
                    logToFile(`[Check-Account API] 403 Unauthorized impersonation (isParent: ${isParent}, subAccount: ${!!subAccount})`);
                    return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
                }
            } else {
                targetUserId = impersonateId
            }
        } else {
            logToFile(`[Check-Account API] 403 Unauthorized impersonation (User role ${profile?.role} not allowed)`);
            return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
        }
    }

    logToFile(`[Check-Account API] targetUserId resolved to: ${targetUserId}`);

    const { data: targetProfile } = await supabase
      .from('profiles')
      .select('facebook_token, agency_id, parent_id, selected_page_id, business_info')
      .eq('id', targetUserId)
      .single()

    let token = targetProfile?.facebook_token
    if (!token) {
        token = profile?.facebook_token
    }

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
        const res = await fetch(`https://graph.facebook.com/v19.0/${adAccountId}?fields=account_status,disable_reason,funding_source,funding_source_details,balance,spend_cap,amount_spent,currency,capabilities&access_token=${token}`)
        const data = await res.json()

        if (data.error) {
            console.error("[check-account API] Ad Account Graph error:", data.error)
            return NextResponse.json({ error: data.error.message || 'Meta API error' }, { status: 400 })
        }

        const hasPaymentMethod = !!(
            data.funding_source || 
            data.funding_source_details || 
            (data.capabilities && data.capabilities.includes('HAS_VALID_PAYMENT_METHODS'))
        )

        const effectivePageId = pageId || targetProfile?.selected_page_id || null

        // Check if user/admin previously confirmed Lead Gen TOS acceptance in database
        let isTosConfirmedInDb = false
        if (targetProfile?.business_info) {
            try {
                const bi = typeof targetProfile.business_info === 'string'
                    ? JSON.parse(targetProfile.business_info)
                    : targetProfile.business_info
                if (bi?.leadgen_tos_accepted === true || bi?.leadgen_tos_override === true) {
                    isTosConfirmedInDb = true
                }
                if (effectivePageId && Array.isArray(bi?.leadgen_tos_accepted_pages) && bi.leadgen_tos_accepted_pages.includes(effectivePageId)) {
                    isTosConfirmedInDb = true
                }
            } catch (e) {}
        }

        let leadgenTos = null
        if (isTosConfirmedInDb) {
            leadgenTos = {
                leadgen_tos: {
                    accepted: true,
                    source: 'confirmed_by_user'
                }
            }
        } else if (effectivePageId) {
            try {
                // leadgen_tos endpoint is deprecated/restricted in v19.0+; we query page fields directly.
                const tosRes = await fetch(`https://graph.facebook.com/v19.0/${effectivePageId}?fields=leadgen_tos_accepted,name&access_token=${token}`)
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

        let prepaidBalance = null;
        if (data.funding_source_details?.display_string) {
            const ds = data.funding_source_details.display_string;
            const match = ds.match(/(?:Available\s+Balance|Balance)\s*\(?[^\d]*([\d,]+\.?\d*)/i);
            if (match) {
                prepaidBalance = parseFloat(match[1].replace(/,/g, ''));
            }
        }

        logToFile(`[Check-Account API] Success check results`, {
            account_status: data.account_status,
            has_payment_method: hasPaymentMethod,
            balance: data.balance,
            prepaid_balance: prepaidBalance,
            currency: data.currency,
            leadgenTosAccepted: leadgenTos?.leadgen_tos?.accepted
        });

        return NextResponse.json({
            account_status: data.account_status,
            disable_reason: data.disable_reason,
            has_payment_method: hasPaymentMethod,
            balance: data.balance,
            prepaid_balance: prepaidBalance,
            spend_cap: data.spend_cap,
            amount_spent: data.amount_spent,
            funding_source_details: data.funding_source_details,
            currency: data.currency,
            leadgenTos
        })
    } catch (error: any) {
        logToFile(`[Check-Account API] Catch block error: ${error.message}`);
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}