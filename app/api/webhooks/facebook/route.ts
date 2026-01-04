import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendLeadEmail } from '@/utils/email-helper';
import { sendNotification } from '@/utils/notification-helper';

const VERIFY_TOKEN = 'ADROLLS_SECURE_TOKEN_2024'; 

// --- ADMIN CLIENT FOR WEBHOOKS ---
// Bypasses RLS so we can search all campaigns and assign leads to anyone
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, 
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

// 1. VERIFICATION
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('hub.mode');
    const token = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        return new NextResponse(challenge, { status: 200 });
    }
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// 2. EVENT NOTIFICATION
export async function POST(request: Request) {
    console.log("🔥 Webhook HIT! Method: POST");
    try {
        const body = await request.json();
        
        for (const entry of body.entry) {
            for (const change of entry.changes) {
                if (change.field === 'leadgen') {
                    await processLead(change.value);
                }
            }
        }

        return NextResponse.json({ success: true });
    } catch (e: any) {
        console.error("Webhook Error:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

async function processLead(value: any) {
    const { leadgen_id, page_id, campaign_id, ad_id } = value;
    const supabase = supabaseAdmin; // Use Admin Client

    // 1. Find Admin (Page Owner) to get the Page Access Token
    const { data: profile } = await supabase
        .from('profiles')
        .select('facebook_token, id, organization_id')
        .eq('selected_page_id', page_id)
        .not('facebook_token', 'is', null)
        .limit(1)
        .single();

    if (!profile || !profile.facebook_token) {
        console.error(`No profile found for Page ID: ${page_id}`);
        return;
    }

    let assignedUserId = profile.id; // Default: Admin
    let source = 'Organic Page';
    let adName = 'Organic';

    // 2. SMART ASSIGNMENT (For Real Ads)
    if (campaign_id || ad_id) {
        const { data: campaignOwner } = await supabase
            .from('campaigns')
            .select('user_id, name')
            .or(`meta_campaign_id.eq.${campaign_id},meta_ad_id.eq.${ad_id}`)
            .limit(1)
            .single();
        
        if (campaignOwner && campaignOwner.user_id) {
            assignedUserId = campaignOwner.user_id;
            source = 'Facebook Ad';
            adName = campaignOwner.name;
            console.log(`🎯 Smart Assign: Lead from Campaign ${campaign_id} assigned to Agent ${campaignOwner.user_id}`);
        }
    }

    // 3. Fetch Lead Details from Facebook
    const fbUrl = `https://graph.facebook.com/v19.0/${leadgen_id}?fields=created_time,field_data&access_token=${profile.facebook_token}`;
    const fbRes = await fetch(fbUrl);
    const leadData = await fbRes.json();

    if (leadData.error) throw new Error(leadData.error.message);

    // 4. Parse Fields
    const fields = leadData.field_data || [];
    let name = 'New Lead';
    let email = '';
    let phone = '';
    let notes = '';

    fields.forEach((f: any) => {
        if (f.name === 'full_name' || f.name.includes('name')) name = f.values[0];
        if (f.name === 'email') email = f.values[0];
        if (f.name === 'phone_number') phone = f.values[0];
        if (!['full_name', 'email', 'phone_number'].includes(f.name)) {
            notes += `${f.name}: ${f.values[0]}\n`;
        }
    });

    // --- 5. DEBUG / TEST OVERRIDE (The Cheat Code) ---
    if (name.toLowerCase().includes('agent test')) {
        console.log("🕵️ DETECTED TEST LEAD! Searching for an Agent to assign...");
        
        const { data: lastAgentCampaign } = await supabase
            .from('campaigns')
            .select('user_id, name')
            .neq('user_id', profile.id) // Exclude Admin
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (lastAgentCampaign) {
            assignedUserId = lastAgentCampaign.user_id;
            source = 'Test Simulation';
            adName = lastAgentCampaign.name;
            notes += `\n[SYSTEM]: Simulated assignment to Agent via Cheat Code.`;
            console.log(`✅ Re-assigned to Agent: ${assignedUserId}`);
        } else {
            console.log("⚠️ No Agent campaigns found to simulate assignment.");
        }
    }

    // 6. Insert into DB
    const { error } = await supabase.from('leads').insert({
        user_id: assignedUserId, 
        facebook_lead_id: leadgen_id,
        name,
        email,
        phone,
        notes: notes.trim(),
        source,
        ad_name: adName,
        pipeline_stage: 'New',
        status: 'OPEN'
    });

    if (error && error.code !== '23505') {
        console.error("DB Insert Error:", error);
    } else if (!error) {
        // 7. NOTIFICATIONS (Push + Email)
        console.log(`✅ Lead Saved. Notifying User: ${assignedUserId}`);
        
        // A. PUSH NOTIFICATION (High ROI - Instant Alert)
        await sendNotification(
            supabase,
            assignedUserId,
            "🔥 New Lead!",
            `${name} just signed up via ${source}. Tap to call them instantly!`,
            'lead',
            '/dashboard/crm'
        );

        // B. EMAIL NOTIFICATION
        const { data: agentProfile } = await supabase
            .from('profiles')
            .select('email, business_name')
            .eq('id', assignedUserId)
            .single();

        if (agentProfile?.email) {
            await sendLeadEmail(
                agentProfile.email, 
                agentProfile.business_name || 'Agent', 
                name, 
                phone, 
                source
            );
        }
    }
}