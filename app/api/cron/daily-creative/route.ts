/* adrollsai/adrollsai/adrollsai-builder-app-gamification/app/api/cron/daily-creative/route.ts */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js' 
import { createKieTask } from '@/utils/external-apis'

// Force Node.js runtime to support crypto and service role
export const runtime = 'nodejs'

function fillPromptTemplate(template: string, propertyData: any, orgData: any, contactNumber: string) {
    let prompt = template
        .replace(/{{Property_Title}}/gi, propertyData.title || 'Exclusive Property')
        .replace(/{{Property_Address}}/gi, propertyData.address || '')
        .replace(/{{Property_Price}}/gi, propertyData.price || 'Contact for Price')
        .replace(/{{Agent_Name}}/gi, orgData.name || 'Us')

    prompt += `
    --- MANDATORY BRANDING INSTRUCTIONS ---
    1. CONTACT INFO: Display this phone number clearly: "${contactNumber || 'DM for Info'}".
    2. BRAND COLORS: Use this color palette: "${orgData.brand_color || '#000000'}".
    3. LOGO: Incorporate the brand logo provided in the input images (if applicable).
    4. CONTEXT: The images provided are for the project "${propertyData.title}". Use them as the main visual.
    `
    return prompt
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const forceOrgId = searchParams.get('force_org')

    // 1. CRITICAL: Check Service Role Key
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
        return NextResponse.json({ 
            success: false, 
            error: "CRITICAL: SUPABASE_SERVICE_ROLE_KEY is missing from .env.local. Automation cannot bypass RLS." 
        }, { status: 500 })
    }

    // 2. Initialize Admin Client (Bypasses RLS)
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceRoleKey,
        {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
            }
        }
    )

    try {
        let orgsToProcess: { id: string; name: string; brand_color: string; master_logo_url: string }[] = []
        
        if (forceOrgId) {
            const { data } = await supabase.from('organizations').select('id, name, brand_color, master_logo_url').eq('id', forceOrgId).single()
            if (data) orgsToProcess = [data]
        } else {
            const { data } = await supabase.from('organizations').select('id, name, brand_color, master_logo_url')
            orgsToProcess = data || []
        }

        const results = []

        for (const org of orgsToProcess) {
            
            // A. Fetch Prompt
            // @ts-ignore
            const { data: prompts } = await supabase
                .from('creative_prompts')
                .select('*')
                .eq('organization_id', org.id)
                .eq('is_used', false)
                .order('created_at', { ascending: true })
                .limit(1)

            if (!prompts || prompts.length === 0) {
                results.push({ org: org.name, status: 'Skipped - Queue Empty' })
                continue
            }
            const currentPrompt = prompts[0]

            // B. Identify Admin (ROBUST VERSION)
            // We look for 'admin' OR 'owner' (case insensitive) and remove the Join to prevent crashes
            const { data: members, error: memberError } = await supabase
                .from('organization_members')
                .select('user_id, role') 
                .eq('organization_id', org.id)
                .in('role', ['admin', 'owner', 'Admin', 'Owner'])
                .limit(1)
            
            if (memberError) {
                results.push({ org: org.name, status: 'DB Error finding Admin', error: memberError.message })
                continue
            }

            if (!members || members.length === 0) {
                // DEBUG: If no admin found, what roles DO exist?
                const { data: allMembers } = await supabase.from('organization_members').select('role').eq('organization_id', org.id)
                const rolesFound = allMembers?.map(m => m.role).join(', ')
                results.push({ org: org.name, status: `Failed - No Admin Found. Roles seen: [${rolesFound}]` })
                continue
            }

            const actingUserId = members[0].user_id

            // C. Fetch Contact Number (Separate query to avoid Join issues)
            let contactNumber = ''
            const { data: profileData } = await supabase
                .from('profiles')
                .select('contact_number')
                .eq('id', actingUserId)
                .single()
            
            if (profileData) contactNumber = profileData.contact_number

            // D. Fetch Target Property
            let propertyQuery = supabase.from('properties').select('*').eq('organization_id', org.id)
            
            if (currentPrompt.property_id) {
                propertyQuery = propertyQuery.eq('id', currentPrompt.property_id)
            } else {
                propertyQuery = propertyQuery.order('created_at', { ascending: false }).limit(1)
            }
            
            const { data: properties } = await propertyQuery
            const property = properties?.[0]

            if (!property) {
                results.push({ org: org.name, status: 'Skipped - No Property Found' })
                continue
            }

            // E. Prepare Images
            let inputImages = []
            if (property.images && property.images.length > 0) {
                inputImages.push(...property.images.slice(0, 3))
            } else if (property.image_url) {
                inputImages.push(property.image_url)
            }
            if (org.master_logo_url) {
                inputImages.push(org.master_logo_url)
            }

            // F. Construct Payload
            const finalPrompt = fillPromptTemplate(currentPrompt.prompt_text, property, org, contactNumber)
            
            const payload = {
                "model": "nano-banana-pro",
                "input": {
                    "prompt": finalPrompt,
                    "image_input": inputImages,
                    "aspect_ratio": "1:1",
                    "resolution": "1K",
                    "output_format": "png"
                }
            }

            // G. Call Kie.ai
            const kieRes = await createKieTask(payload)
            
            if ('error' in kieRes) {
                 results.push({ org: org.name, status: 'Failed - Kie API Error', error: kieRes.error })
                 continue
            }

            // H. Polling
            let imageUrl = null
            for(let i=0; i<15; i++) { 
                await new Promise(r => setTimeout(r, 3000))
                
                const statusRes = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${kieRes.taskId}`, {
                    headers: { 'Authorization': `Bearer ${process.env.KIE_API_KEY}` }
                })
                const statusData = await statusRes.json()
                
                if (statusData.data?.state === 'success') {
                    try {
                        const json = JSON.parse(statusData.data.resultJson)
                        imageUrl = json.resultUrls?.[0]
                    } catch {
                        imageUrl = statusData.data.resultUrl
                    }
                    break
                }
                if (statusData.data?.state === 'fail') break
            }

            // I. Save Result
            if (imageUrl) {
                await supabase.from('assets').insert({
                    user_id: actingUserId,
                    property_id: property.id,
                    url: imageUrl,
                    type: 'image',
                    status: 'Draft'
                })

                // @ts-ignore
                await supabase.from('creative_prompts').update({
                    is_used: true,
                    used_at: new Date().toISOString()
                }).eq('id', currentPrompt.id)

                results.push({ org: org.name, status: 'Success', asset: imageUrl })
            } else {
                results.push({ org: org.name, status: 'Failed - Timeout' })
            }
        }

        return NextResponse.json({ success: true, results })

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}