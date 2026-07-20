import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const { searchParams } = new URL(request.url)
        const leadId = searchParams.get('leadId')
        const adId = searchParams.get('adId')

        if (!adId && !leadId) {
            return NextResponse.json({ error: 'adId or leadId is required' }, { status: 400 })
        }

        // Get profile Meta access token
        const { data: profile } = await supabase
            .from('profiles')
            .select('facebook_token, selected_page_token')
            .eq('id', user.id)
            .single()

        const token = profile?.facebook_token || profile?.selected_page_token || process.env.META_SYSTEM_USER_TOKEN

        if (!token) {
            return NextResponse.json({ error: 'No Meta token available' }, { status: 400 })
        }

        let targetAdId = adId

        // If leadId is provided, fetch lead details from Supabase & Meta
        if (!targetAdId && leadId) {
            const { data: lead } = await supabase
                .from('leads')
                .select('facebook_lead_id, custom_fields')
                .eq('id', leadId)
                .single()

            if (lead?.facebook_lead_id) {
                const fbLeadRes = await fetch(`https://graph.facebook.com/v20.0/${lead.facebook_lead_id}?fields=ad_id&access_token=${token}`)
                const fbLeadData = await fbLeadRes.json()
                if (fbLeadData?.ad_id) {
                    targetAdId = fbLeadData.ad_id
                }
            }
        }

        if (!targetAdId) {
            return NextResponse.json({ error: 'Could not resolve Meta Ad ID' }, { status: 404 })
        }

        // Fetch Ad Creative details
        const adUrl = `https://graph.facebook.com/v20.0/${targetAdId}?fields=id,name,adset{name},campaign{name},creative{id,name,title,body,image_url,thumbnail_url,object_story_spec,asset_feed_spec}&access_token=${token}`
        const adRes = await fetch(adUrl)
        const adData = await adRes.json()

        if (!adData || adData.error) {
            return NextResponse.json({ error: adData?.error?.message || 'Failed to fetch Ad Creative' }, { status: 400 })
        }

        const spec = adData.creative?.object_story_spec
        const assetFeed = adData.creative?.asset_feed_spec
        const videoId = spec?.video_data?.video_id

        let videoMp4Url: string | null = null

        if (videoId) {
            const vidUrl = `https://graph.facebook.com/v20.0/${videoId}?fields=source,picture&access_token=${token}`
            const vidRes = await fetch(vidUrl)
            const vidData = await vidRes.json()
            if (vidData?.source) {
                videoMp4Url = vidData.source
            }
        }

        const headlineText = spec?.link_data?.name || spec?.video_data?.title || adData.creative?.title || assetFeed?.titles?.[0]?.text || adData.name || ''
        const bodyText = spec?.link_data?.message || spec?.video_data?.message || adData.creative?.body || assetFeed?.bodies?.[0]?.text || ''
        const creativeImg = spec?.video_data?.image_url || spec?.link_data?.picture || spec?.photo_data?.url || adData.creative?.image_url || adData.creative?.thumbnail_url || assetFeed?.images?.[0]?.url || null

        // If leadId was passed, save updated meta_ad_origin to Supabase
        if (leadId && videoMp4Url) {
            const { data: lead } = await supabase.from('leads').select('custom_fields').eq('id', leadId).single()
            if (lead) {
                let cf = lead.custom_fields || {}
                if (typeof cf === 'string') {
                    try { cf = JSON.parse(cf) } catch (e) { cf = {} }
                }
                const origin = cf.meta_ad_origin || {}
                cf = {
                    ...cf,
                    meta_ad_origin: {
                        ...origin,
                        ad_id: targetAdId,
                        ad_name: adData.name || origin.ad_name,
                        headline: headlineText || origin.headline,
                        body: bodyText || origin.body,
                        image_url: creativeImg || origin.image_url,
                        video_url: videoMp4Url,
                        source_url: `https://www.facebook.com/ads/library/?id=${targetAdId}`
                    }
                }
                await supabase.from('leads').update({ custom_fields: cf }).eq('id', leadId)
            }
        }

        return NextResponse.json({
            success: true,
            video_url: videoMp4Url,
            headline: headlineText,
            body: bodyText,
            image_url: creativeImg
        })

    } catch (err: any) {
        console.error("[video-source API error]:", err)
        return NextResponse.json({ error: err.message }, { status: 500 })
    }
}
