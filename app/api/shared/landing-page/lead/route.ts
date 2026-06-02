import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { 
            name, 
            phone, 
            city, 
            landing_page_id, 
            user_id, 
            slug 
        } = body

        if (!name || !phone || !user_id) {
            return NextResponse.json({ error: "Missing required contact details." }, { status: 400 })
        }

        // We use an admin client to bypass RLS so that external landing page submissions
        // are allowed to insert records into public.leads without having an active dashboard auth session.
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        // Parse custom questions answers
        const customFields: Record<string, any> = { city: city || '' }
        
        // Collect any custom_question_X inputs
        Object.keys(body).forEach(key => {
            if (key.startsWith('custom_question_')) {
                customFields[key] = body[key]
            }
        })

        // Insert new lead into public.leads
        const { data: newLead, error: insertError } = await supabaseAdmin
            .from('leads')
            .insert({
                name,
                phone,
                user_id,
                source: slug ? `Landing Page - ${slug}` : 'Landing Page',
                pipeline_stage: 'New',
                custom_fields: customFields,
                status: 'active'
            })
            .select()
            .single()

        if (insertError) {
            console.error("❌ Failed to capture landing page lead:", insertError)
            return NextResponse.json({ error: "Failed to submit details. Please try again." }, { status: 500 })
        }

        console.log(`✅ Landing Page Lead Captured: ${newLead.id} for Owner: ${user_id}`)

        // Trigger CRM round-robin or staff notifications if needed
        try {
            const forwardedHost = request.headers.get('x-forwarded-host');
            const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
            const requestOrigin = new URL(request.url).origin;
            let baseUrl = requestOrigin;
            if (forwardedHost && !forwardedHost.includes('localhost')) {
                baseUrl = `${forwardedProto}://${forwardedHost}`;
            }

            // Call CRM notification API asynchronously
            fetch(`${baseUrl}/api/crm/notify-assignment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    leadId: newLead.id,
                    leadName: name,
                    agentId: user_id
                })
            }).catch(err => console.warn("Staff notification error:", err.message))
        } catch(notifErr) {
            console.warn("Failed to dispatch notifications:", notifErr)
        }

        return NextResponse.json({ 
            success: true, 
            leadId: newLead.id 
        })

    } catch (e: any) {
        console.error("Lander Lead API Error:", e)
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 })
    }
}
