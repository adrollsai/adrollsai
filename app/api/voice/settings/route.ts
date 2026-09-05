import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function GET(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', targetId)
            .single()

        const isNobogentMaster = profile?.email === 'rchopra489@gmail.com'

        let biKyc: any = {}
        try {
            if (profile?.business_info && typeof profile.business_info === 'string') {
                biKyc = JSON.parse(profile.business_info)
            } else if (profile?.business_info && typeof profile.business_info === 'object') {
                biKyc = profile.business_info
            }
        } catch (e) {}

        // Separate Twilio International number vs Vobiz Indian DID
        const rawSavedNumber = profile?.voice_twilio_number || ''
        const rawVobizNumber = biKyc.voice_vobiz_number || profile?.voice_vobiz_number || ''

        let twilioNumber = ''
        let vobizNumber = ''

        if (rawVobizNumber && rawVobizNumber.startsWith('+91')) {
            vobizNumber = rawVobizNumber
        }

        if (rawSavedNumber) {
            if (rawSavedNumber.startsWith('+91')) {
                // If it's an Indian number and no separate Vobiz number was set, it's a Vobiz line
                if (!vobizNumber) vobizNumber = rawSavedNumber
            } else {
                // Non-Indian number (like +16592137728) is strictly Twilio
                twilioNumber = rawSavedNumber
            }
        }

        if (isNobogentMaster && !twilioNumber) {
            twilioNumber = process.env.MASTER_TWILIO_NUMBER || '+16592137728'
        }

        // Determine telephony provider:
        // Respect explicitly stored provider in business_info or profile.
        // If not explicitly set, determine by number type:
        // If user has a Twilio number (+1...) and no Vobiz number, provider is 'twilio'
        let storedProvider = biKyc.voice_telephony_provider || profile?.voice_telephony_provider || profile?.voice_provider
        let telephonyProvider: 'twilio' | 'vobiz' = 'twilio'

        if (storedProvider === 'vobiz' && vobizNumber) {
            telephonyProvider = 'vobiz'
        } else if (storedProvider === 'twilio' || twilioNumber) {
            telephonyProvider = 'twilio'
        } else if (vobizNumber) {
            telephonyProvider = 'vobiz'
        } else {
            telephonyProvider = isNobogentMaster ? 'twilio' : 'vobiz'
        }

        const voiceNumber = telephonyProvider === 'twilio' ? twilioNumber : vobizNumber

        let kycStatus = isNobogentMaster ? 'verified' : (biKyc.kyc_status || 'not_submitted')
        let kycType = isNobogentMaster ? 'business' : (biKyc.kyc_type || 'individual')
        let kycData = isNobogentMaster 
            ? (biKyc.kyc_data || { email: 'nobogent@gmail.com', fullName: 'Nobogent', companyName: 'Nobogent', entityType: 'business' })
            : (biKyc.kyc_data || {})

        // Real-time auto-sync with Vobiz if subaccount is registered but status is not yet verified in DB
        if (!isNobogentMaster && kycStatus !== 'verified') {
            const subIdentifier = kycData?.vobizSubAuthId || biKyc.voice_vobiz_auth_id || kycData?.email || profile?.email
            if (subIdentifier) {
                try {
                    const { getVobizSubAccount } = await import('@/utils/vobiz-helper')
                    const sub = await getVobizSubAccount(subIdentifier)
                    if (sub && sub.kyc_status === 'verified') {
                        kycStatus = 'verified'
                        kycData.vobizKycStatus = 'verified'
                        kycData.vobizSubAuthId = sub.auth_id || kycData.vobizSubAuthId
                        kycData.vobizSubAccountId = String(sub.id) || kycData.vobizSubAccountId
                        biKyc.kyc_status = 'verified'
                        biKyc.kyc_data = kycData
                        biKyc.voice_vobiz_auth_id = sub.auth_id || biKyc.voice_vobiz_auth_id
                        biKyc.voice_vobiz_auth_token = sub.auth_token || biKyc.voice_vobiz_auth_token
                        biKyc.voice_vobiz_sub_account_id = String(sub.id) || biKyc.voice_vobiz_sub_account_id

                        await supabaseAdmin
                            .from('profiles')
                            .update({ business_info: JSON.stringify(biKyc) })
                            .eq('id', targetId)
                    }
                } catch (syncErr: any) {
                    console.warn('[VOICE SETTINGS] Vobiz KYC sync notice:', syncErr.message)
                }
            }
        }

        // Fetch all active claimed numbers across the platform
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

        return NextResponse.json({
            success: true,
            saasMode: true,
            voiceNumber,
            twilioNumber,
            vobizNumber,
            telephonyProvider,
            concurrencyLimit: profile?.voice_concurrency_limit || 3,
            cpsLimit: profile?.voice_cps_limit || 1,
            kycStatus,
            kycType,
            kycData,
            credits: profile?.credits || 0,
            hasClaimedVobizNumber: !!vobizNumber,
            claimedNumbers: Array.from(claimedNumbersSet)
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

        const body = await req.json()
        const {
            telephonyProvider,
            auto_call_new_leads,
            voice_provider,
            voice_name,
            voice_twilio_sid,
            voice_twilio_token,
            voice_twilio_number
        } = body

        // Fetch current profile to merge business_info safely
        const { data: currentProfile } = await supabaseAdmin
            .from('profiles')
            .select('business_info')
            .eq('id', targetId)
            .single()

        let bi: any = {}
        if (currentProfile?.business_info) {
            try {
                if (typeof currentProfile.business_info === 'string') {
                    bi = JSON.parse(currentProfile.business_info)
                } else if (typeof currentProfile.business_info === 'object') {
                    bi = currentProfile.business_info
                }
            } catch (e) {
                // If business_info was a plain markdown string, preserve it
                bi = { _raw_text: currentProfile.business_info }
            }
        }

        // Store provider in business_info JSON
        if (telephonyProvider) {
            bi.voice_telephony_provider = telephonyProvider
        }

        const updatePayload: any = {
            auto_call_new_leads: !!auto_call_new_leads,
            business_info: JSON.stringify(bi)
        }

        if (voice_provider) updatePayload.voice_provider = voice_provider
        if (voice_name) updatePayload.voice_name = voice_name

        if (telephonyProvider === 'twilio') {
            if (voice_twilio_sid !== undefined) updatePayload.voice_twilio_sid = voice_twilio_sid?.trim() || null
            if (voice_twilio_token !== undefined) updatePayload.voice_twilio_token = voice_twilio_token?.trim() || null
            if (voice_twilio_number !== undefined) updatePayload.voice_twilio_number = voice_twilio_number?.trim() || null
        }

        const { error: updateError } = await supabaseAdmin
            .from('profiles')
            .update(updatePayload)
            .eq('id', targetId)

        if (updateError) {
            console.error('[VOICE SETTINGS SAVE ERROR]', updateError)
            return NextResponse.json({ error: updateError.message }, { status: 500 })
        }

        return NextResponse.json({
            success: true,
            message: 'Voice settings saved successfully'
        })
    } catch (e: any) {
        console.error('[VOICE SETTINGS POST ERROR]', e)
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
