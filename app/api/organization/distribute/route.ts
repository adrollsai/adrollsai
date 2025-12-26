import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { generateStampedImage } from '@/utils/stamp-helper' 
import { sendWhatsAppTemplate } from '@/utils/external-apis'

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user: adminUser } } = await supabase.auth.getUser()
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { targetAgentId, masterImageUrl, masterCreativeId, propertyId } = await request.json()

    // ... (Standard Data Fetching Logic) ...
    if (!targetAgentId || !masterImageUrl) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

    const { data: adminData } = await supabase
      .from('profiles')
      .select('whatsapp_access_token, whatsapp_phone_number_id, organization_id')
      .eq('id', adminUser.id)
      .single()
    const adminProfile = adminData as any

    if (!adminProfile?.whatsapp_access_token) return NextResponse.json({ error: 'Admin is not connected to WhatsApp' }, { status: 400 })

    const { data: agentData } = await supabase
      .from('profiles')
      .select('id, business_name, contact_number, logo_url, organization_id')
      .eq('id', targetAgentId)
      .single()
    const rawAgentProfile = agentData as any

    if (!rawAgentProfile || rawAgentProfile.organization_id !== adminProfile.organization_id) {
        return NextResponse.json({ error: 'Invalid Agent' }, { status: 403 })
    }

    // 1. Generate Image
    const agentProfileData = {
        id: rawAgentProfile.id,
        business_name: rawAgentProfile.business_name,
        contact_number: rawAgentProfile.contact_number,
        logo_url: rawAgentProfile.logo_url
    }

    // THIS PART IS WORKING FINE
    const finalImageUrl = await generateStampedImage({
        agentProfile: agentProfileData, 
        masterImageUrl: masterImageUrl
    })

    // 2. Save Asset
    await supabase.from('assets').insert({
        user_id: rawAgentProfile.id, 
        url: finalImageUrl,
        type: 'image',
        status: 'Distributed', 
        property_id: propertyId || null,
        master_creative_id: masterCreativeId,
        share_stats: { whatsapp: 0, facebook: 0, instagram: 0, download: 0 }
    })

    // 3. SMART PHONE NUMBER LOGIC
    let rawPhone = rawAgentProfile.contact_number || '';
    let cleanPhone = rawPhone.replace(/\D/g, ''); 
    if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

    // 4. Send WhatsApp (WRAPPED IN TRY/CATCH)
    // This ensures we report success for the image even if WhatsApp fails
    let whatsappStatus = 'skipped';
    let whatsappError = null;

    if (cleanPhone.length >= 10) {
        try {
            await sendWhatsAppTemplate(
                adminProfile.whatsapp_access_token,
                adminProfile.whatsapp_phone_number_id,
                cleanPhone,
                "new_creative_alert",
                "en_US",
                [
                    { type: "header", parameters: [{ type: "image", image: { link: finalImageUrl } }] },
                    { type: "body", parameters: [{ type: "text", text: rawAgentProfile.business_name || "Partner" }] }
                ]
            )
            whatsappStatus = 'sent';
        } catch (waError: any) {
            console.error("WhatsApp Failed (Soft Fail):", waError.message);
            whatsappStatus = 'failed';
            whatsappError = waError.message;
        }
    }

    // Return SUCCESS regardless of WhatsApp status, because the Image was made.
    return NextResponse.json({ 
        success: true, 
        url: finalImageUrl, 
        whatsapp: { status: whatsappStatus, error: whatsappError } 
    })

  } catch (error: any) {
    console.error("Distribution Critical Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}