import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function investigate() {
    console.log('--- INVESTIGATING USER rchopra489@gmail.com ---');
    
    // Find profile
    const { data: profiles, error: pErr } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .ilike('email', '%rchopra489@gmail.com%');

    if (pErr || !profiles || profiles.length === 0) {
        console.error('Profile not found:', pErr);
        // Let's search by email more broadly or in auth.users
        const { data: allP } = await supabaseAdmin.from('profiles').select('id, email, full_name, business_name').ilike('email', '%rchopra%');
        console.log('Broad profile search:', allP);
        return;
    }

    const profile = profiles[0];
    console.log('Profile found:', {
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        business_name: profile.business_name,
        whatsapp_phone_number_id: profile.whatsapp_phone_number_id,
        whatsapp_waba_id: profile.whatsapp_waba_id,
        whatsapp_business_account_id: profile.whatsapp_business_account_id,
        whatsapp_phone_number: profile.whatsapp_phone_number,
        has_access_token: !!profile.whatsapp_access_token
    });

    // Check credits if applicable
    console.log('User credits/plan info:', {
        credits: profile.credits,
        ai_credits: profile.ai_credits,
        plan: profile.plan,
        subscription_status: profile.subscription_status
    });

    // Find recent broadcasts for this user
    const { data: broadcasts, error: bErr } = await supabaseAdmin
        .from('whatsapp_broadcasts')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(5);

    console.log('\n--- BROADCASTS FOR THIS USER ---');
    console.log(JSON.stringify(broadcasts, null, 2));

    if (broadcasts && broadcasts.length > 0) {
        const latest = broadcasts[0];
        console.log('\n--- LATEST BROADCAST DETAILS ---', latest.id, latest.title, latest.status);
        
        // Count recipients by status
        const { data: recipients, error: rErr } = await supabaseAdmin
            .from('whatsapp_broadcast_recipients')
            .select('id, phone_number, status, error_message, sent_at, error_details')
            .eq('broadcast_id', latest.id);

        if (recipients) {
            console.log(`Total recipients: ${recipients.length}`);
            const statusCounts: Record<string, number> = {};
            const sampleErrors: any[] = [];
            for (const r of recipients) {
                statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
                if (r.status === 'failed' && sampleErrors.length < 10) {
                    sampleErrors.push({ phone: r.phone_number, error: r.error_message, details: (r as any).error_details });
                }
            }
            console.log('Status breakdown:', statusCounts);
            console.log('Sample errors:', JSON.stringify(sampleErrors, null, 2));
        }

        // Also check if Meta API has any account status/restrictions or template status
        const wabaId = profile.whatsapp_waba_id || profile.whatsapp_business_account_id;
        const phoneId = profile.whatsapp_phone_number_id;
        const token = profile.whatsapp_access_token;

        if (phoneId && token) {
            try {
                const phoneRes = await fetch(`https://graph.facebook.com/v20.0/${phoneId}?fields=display_phone_number,verified_name,code_verification_status,quality_rating,messaging_limit_tier,status`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const phoneData = await phoneRes.json();
                console.log('\n--- META PHONE NUMBER STATUS ---', JSON.stringify(phoneData, null, 2));
            } catch (e: any) {
                console.error('Meta phone query error:', e.message);
            }
        }

        if (wabaId && token) {
            try {
                // Check payment / account status on WABA
                const wabaRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}?fields=name,account_review_status,currency,timezone_id,message_template_namespace`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const wabaData = await wabaRes.json();
                console.log('\n--- META WABA STATUS ---', JSON.stringify(wabaData, null, 2));
            } catch (e: any) {
                console.error('Meta waba query error:', e.message);
            }
        }
    }
}

investigate().catch(console.error);
