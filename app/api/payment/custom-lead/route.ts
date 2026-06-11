import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { sendContactFormEmail } from '@/utils/email-helper';
import { sendPushNotification } from '@/utils/notification-helper';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        // Standard lead capture from body
        const { 
            name, 
            companyName, 
            email, 
            phone, 
            teamSize, 
            budget, 
            requirements 
        } = await req.json();

        if (!name || !companyName || !email || !phone || !teamSize || !budget || !requirements) {
            return NextResponse.json({ error: "All fields are required." }, { status: 400 });
        }

        // 1. Resolve Admin / Parent User
        let targetUserId: string = user?.id || '';
        if (!targetUserId) {
            // Unauthenticated/Visitor fallback: Find any primary admin to assign
            const { data: anyAdmin } = await supabaseAdmin
                .from('profiles')
                .select('id')
                .eq('role', 'admin')
                .limit(1)
                .maybeSingle();
            targetUserId = anyAdmin?.id || (await supabaseAdmin.from('profiles').select('id').limit(1).maybeSingle()).data?.id || '';
        }

        // Format detailed lead profile notes for the CRM
        const messageBody = `
            Company Name: ${companyName}
            Target Team Size: ${teamSize} Members
            Monthly Marketing Budget: ₹${budget}
            Key Requirements: ${requirements}
        `.trim().replace(/ +/g, ' ');

        // 2. Insert Lead directly into Supabase CRM database
        const { data: lead, error: leadError } = await supabaseAdmin
            .from('leads')
            .insert({
                user_id: targetUserId,
                name,
                email,
                phone,
                notes: messageBody,
                source: 'Custom Plan Request',
                pipeline_stage: 'New'
            })
            .select()
            .single();

        if (leadError) {
            console.error("[Custom Lead API] CRM insert error:", leadError);
            return NextResponse.json({ error: "Failed to store lead submission." }, { status: 500 });
        }

        // 3. Dispatch web push notification to the admin
        try {
            await sendPushNotification(
                targetUserId,
                "💎 High-Value Custom Plan Lead!",
                `${name} (${companyName}) • Budget: ₹${budget}`,
                `/dashboard/crm/${lead.id}`
            );
        } catch (pushErr) {
            console.error("[Custom Lead API] Push failed:", pushErr);
        }

        // 4. Send email notification copy to adrollsai@gmail.com
        const emailSubject = `💎 New Custom Plan Request from ${name} (${companyName})`;
        const emailContent = `
            <h3>💎 New Custom Plan Lead Details</h3>
            <p><strong>Full Name:</strong> ${name}</p>
            <p><strong>Company:</strong> ${companyName}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Phone:</strong> ${phone}</p>
            <p><strong>Team Size:</strong> ${teamSize} Members</p>
            <p><strong>Monthly Budget:</strong> ₹${budget}</p>
            <p><strong>Requirements:</strong> ${requirements}</p>
        `;
        
        const emailRes = await sendContactFormEmail(name, email, phone, messageBody);
        if (!emailRes.success) {
            console.error("[Custom Lead API] SMTP email notification failed:", emailRes.error);
        } else {
            console.log("[Custom Lead API] SMTP email notification sent.");
        }

        return NextResponse.json({ success: true, leadId: lead.id });

    } catch (error: any) {
        console.error("Custom Lead API Fatal Error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
