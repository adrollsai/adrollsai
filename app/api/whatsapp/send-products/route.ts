import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

function isRealPublicImageUrl(url: string | null | undefined): boolean {
    if (!url) return false;
    const lower = url.toLowerCase();
    if (lower.includes('placehold.co') || lower.includes('placeholder') || lower.includes('via.placeholder')) {
        return false;
    }
    return url.startsWith('http://') || url.startsWith('https://');
}

export async function GET(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const url = new URL(req.url)
        const impersonateId = url.searchParams.get('impersonate')

        // Resolve the owner user ID (for agents, use parent's credentials and inventory; for impersonation, use impersonated user)
        let ownerUserId = user.id
        if (impersonateId && impersonateId !== user.id) {
            const { data: authProfile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single()
            const authRole = authProfile?.role?.toLowerCase() || ''
            if (['super_admin', 'agency', 'admin'].includes(authRole)) {
                ownerUserId = impersonateId
            }
        } else {
            const { data: profile } = await supabase
                .from('profiles')
                .select('role, parent_id, agency_id')
                .eq('id', user.id)
                .single()

            const role = profile?.role?.toLowerCase() || 'admin'
            const parentId = profile?.parent_id || profile?.agency_id
            ownerUserId = (role === 'agent' && parentId) ? parentId : user.id
        }

        // Fetch properties for the owner
        const { data: properties, error: propErr } = await supabase
            .from('properties')
            .select('id, title, price, address, configurations, youtube_url, image_url, images, tags')
            .eq('user_id', ownerUserId)
            .order('created_at', { ascending: false })

        if (propErr) {
            return NextResponse.json({ error: 'Failed to fetch products: ' + propErr.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, properties })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { chatId, propertyId } = await req.json()
        if (!chatId || !propertyId) {
            return NextResponse.json({ error: 'Missing chatId or propertyId' }, { status: 400 })
        }

        // Resolve the owner user ID (for agents, use parent's credentials and inventory)
        const { data: profile } = await supabase
            .from('profiles')
            .select('role, parent_id, agency_id')
            .eq('id', user.id)
            .single()

        const role = profile?.role?.toLowerCase() || 'admin'
        const parentId = profile?.parent_id || profile?.agency_id
        const ownerUserId = (role === 'agent' && parentId) ? parentId : user.id

        // Fetch chat details — RLS handles access control
        const { data: chat, error: chatErr } = await supabase
            .from('whatsapp_chats')
            .select('*')
            .eq('id', chatId)
            .single()

        if (chatErr || !chat) {
            return NextResponse.json({ error: 'Chat not found or access denied' }, { status: 404 })
        }

        // Fetch WABA credentials from the owner profile
        const { data: ownerProfile } = await supabase
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_phone_number_id, facebook_token, business_name, custom_domain, email')
            .eq('id', ownerUserId)
            .single()

        const isMasterDefaultUser = ownerProfile?.email === 'rchopra489@gmail.com' || ownerProfile?.email === 'infobluesquareinfra@gmail.com'
        const whatsappToken = ownerProfile?.whatsapp_access_token || ownerProfile?.facebook_token || (isMasterDefaultUser ? process.env.DEV_WHATSAPP_ACCESS_TOKEN : null)
        const whatsappPhoneId = ownerProfile?.whatsapp_phone_number_id || (isMasterDefaultUser ? process.env.DEV_WHATSAPP_PHONE_ID : null)

        if (!whatsappToken || !whatsappPhoneId) {
            return NextResponse.json({ error: 'WhatsApp integration not configured.' }, { status: 400 })
        }

        // Fetch the specific property/product
        const { data: prop, error: propErr } = await supabase
            .from('properties')
            .select('id, title, price, address, description, configurations, image_url, images, brochure_url, youtube_url')
            .eq('id', propertyId)
            .eq('user_id', ownerUserId)
            .single()

        if (propErr || !prop) {
            return NextResponse.json({ error: 'Product not found: ' + (propErr?.message || 'Not found in inventory') }, { status: 404 })
        }

        const cleanRecipient = chat.recipient_phone.replace(/\D/g, '')
        const metaUrl = `https://graph.facebook.com/v20.0/${whatsappPhoneId}/messages`
        const sentMessages: any[] = []
        let errorCount = 0

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com'
        let productUrl = ownerProfile?.custom_domain 
            ? `https://${ownerProfile.custom_domain}?property=${prop.id}` 
            : `${appUrl}/shared/${ownerUserId}?property=${prop.id}`

        // Build a formatted product details message (omitting address & config as per user request)
        const lines: string[] = []
        if (prop.title) lines.push(`🏷️ *${prop.title}*`)
        if (prop.price) lines.push(`💰 Price: ${prop.price}`)
        if (prop.description) {
            const shortDesc = prop.description.length > 300 ? prop.description.substring(0, 300) + '...' : prop.description
            lines.push(`\n${shortDesc}`)
        }
        if (prop.youtube_url) lines.push(`\n🎥 Video Tour: ${prop.youtube_url}`)
        lines.push(`\n🌐 View Details & Photos: ${productUrl}`)
        if (prop.brochure_url) lines.push(`📄 Brochure: ${prop.brochure_url}`)

        const productText = lines.join('\n')

        // Determine the best image to send
        const imageUrl = prop.image_url || (prop.images && prop.images.length > 0 ? prop.images[0] : null)

        // If we have an image, send as image message with caption
        if (imageUrl && isRealPublicImageUrl(imageUrl)) {
            const imagePayload = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: cleanRecipient,
                type: 'image',
                image: {
                    link: imageUrl,
                    caption: productText
                }
            }

            const imgRes = await fetch(metaUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${whatsappToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(imagePayload)
            })

            const imgData = await imgRes.json()
            if (!imgRes.ok) {
                console.error(`[SEND PRODUCTS] Failed to send image for ${prop.title}:`, imgData)
                // Fallback: send as text only
                const textPayload = {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: cleanRecipient,
                    type: 'text',
                    text: { body: productText }
                }
                const fallbackRes = await fetch(metaUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${whatsappToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(textPayload)
                })
                if (!fallbackRes.ok) {
                    const fallbackData = await fallbackRes.json()
                    console.error(`[SEND PRODUCTS] Fallback text failed too:`, fallbackData)
                    errorCount = 2
                } else {
                    errorCount = 0
                }
            } else {
                errorCount = 0
            }
        } else {
            // No image or image is a placeholder — send as text
            const textPayload = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: cleanRecipient,
                type: 'text',
                text: { body: productText }
            }

            const textRes = await fetch(metaUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${whatsappToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(textPayload)
            })

            if (!textRes.ok) {
                const textData = await textRes.json()
                console.error(`[SEND PRODUCTS] Failed to send text for ${prop.title}:`, textData)
                errorCount++
            } else {
                errorCount = 0
            }
        }

        if (errorCount > 0) {
            return NextResponse.json({ error: 'WhatsApp service failed to deliver message. Please check logs and WABA connection status.' }, { status: 500 })
        }

        // Log to whatsapp_messages
        const logText = `📦 Product: ${prop.title || 'Untitled'}\n${productText}`
        const { data: msgRecord } = await supabase
            .from('whatsapp_messages')
            .insert({
                chat_id: chatId,
                direction: 'outbound',
                message_text: logText,
                media_url: (imageUrl && isRealPublicImageUrl(imageUrl)) ? imageUrl : null,
                media_type: (imageUrl && isRealPublicImageUrl(imageUrl)) ? 'image' : null
            })
            .select('*')
            .single()
        if (msgRecord) sentMessages.push(msgRecord)

        // Update chat's last message
        await supabase
            .from('whatsapp_chats')
            .update({
                last_message_text: `📦 Sent product: ${prop.title || 'Untitled'}`,
                unread_count: 0,
                updated_at: new Date().toISOString()
            })
            .eq('id', chatId)

        console.log(`[SEND PRODUCTS] Sent product ${prop.title} to chat ${chatId}. Errors: ${errorCount}`)

        return NextResponse.json({ 
            success: true, 
            errorCount,
            messages: sentMessages
        })
    } catch (e: any) {
        console.error('[SEND PRODUCTS] Error:', e)
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
