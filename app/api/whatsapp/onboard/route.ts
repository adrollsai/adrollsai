import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { code, wabaId, phone_number_id } = await req.json();
        if (!code) {
            return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 });
        }

        const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
        const appSecret = process.env.FACEBOOK_CLIENT_SECRET;

        if (!appId || !appSecret) {
            return NextResponse.json({ error: 'Meta application configurations are missing on server.' }, { status: 500 });
        }

        // 1. Exchange OAuth code for access token
        const tokenUrl = `https://graph.facebook.com/v20.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${code}`;
        const tokenRes = await fetch(tokenUrl);
        const tokenData = await tokenRes.json();

        if (tokenData.error) {
            console.error('[WHATSAPP ONBOARD] Meta Token Exchange Error:', tokenData.error);
            return NextResponse.json({ error: tokenData.error.message || 'Failed to exchange authorization code.' }, { status: 400 });
        }

        const accessToken = tokenData.access_token;

        let finalWabaId = wabaId;
        let finalPhoneId = phone_number_id;
        let displayPhoneNumber = '';

        // If frontend didn't pass WABA / Phone IDs or they were empty, inspect token using debug_token
        if (!finalWabaId || !finalPhoneId) {
            try {
                const appAccessToken = `${appId}|${appSecret}`;
                const debugUrl = `https://graph.facebook.com/v20.0/debug_token?input_token=${accessToken}&access_token=${appAccessToken}`;
                const debugRes = await fetch(debugUrl);
                const debugData = await debugRes.json();
                
                if (debugData && debugData.data && debugData.data.granular_scopes) {
                    const wabaScope = debugData.data.granular_scopes.find(
                        (s: any) => s.scope === 'whatsapp_business_management'
                    );
                    if (wabaScope && wabaScope.target_ids && wabaScope.target_ids.length > 0) {
                        finalWabaId = wabaScope.target_ids[0];
                        console.log('[WHATSAPP ONBOARD] Discovered WABA ID via debug_token:', finalWabaId);
                    }
                }

                if (finalWabaId) {
                    const phoneUrl = `https://graph.facebook.com/v20.0/${finalWabaId}/phone_numbers?access_token=${accessToken}`;
                    const phoneRes = await fetch(phoneUrl);
                    const phoneData = await phoneRes.json();
                    
                    if (phoneData && phoneData.data && phoneData.data.length > 0) {
                        finalPhoneId = phoneData.data[0].id;
                        displayPhoneNumber = phoneData.data[0].display_phone_number || '';
                        console.log('[WHATSAPP ONBOARD] Discovered Phone ID & Number:', finalPhoneId, displayPhoneNumber);
                    }
                }
            } catch (discoverErr) {
                console.error('[WHATSAPP ONBOARD] Failed to auto-discover WABA and phone details:', discoverErr);
            }
        }

        // If phone_number_id was provided/resolved but displayPhoneNumber is still empty, fetch it
        if (finalPhoneId && !displayPhoneNumber) {
            try {
                const phoneUrl = `https://graph.facebook.com/v20.0/${finalPhoneId}?access_token=${accessToken}`;
                const phoneRes = await fetch(phoneUrl);
                const phoneData = await phoneRes.json();
                
                if (phoneData && phoneData.display_phone_number) {
                    displayPhoneNumber = phoneData.display_phone_number;
                }
            } catch (phoneErr) {
                console.error('[WHATSAPP ONBOARD] Failed to fetch phone number details:', phoneErr);
            }
        }

        // 3. Save details to Supabase
        const { error: dbError } = await supabase
            .from('profiles')
            .update({
                whatsapp_access_token: accessToken,
                whatsapp_waba_id: finalWabaId || null,
                whatsapp_phone_number_id: finalPhoneId || null,
                whatsapp_phone_number: displayPhoneNumber || null,
                whatsapp_connected_at: new Date().toISOString()
            } as any) // cast as any to handle possible temporary typescript schema desync
            .eq('id', user.id);

        if (dbError) {
            console.error('[WHATSAPP ONBOARD] Supabase Save Error:', dbError);
            return NextResponse.json({ error: 'Failed to save WhatsApp credentials to database.' }, { status: 500 });
        }

        // 3b. Register the phone number with WhatsApp Cloud API
        // This is REQUIRED — without it the number exists in Meta's WABA but is not active on WhatsApp's messaging network.
        // Users trying to message this number will see "this number does not exist on WhatsApp".
        if (finalPhoneId && accessToken) {
            try {
                const registerRes = await fetch(`https://graph.facebook.com/v20.0/${finalPhoneId}/register`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        messaging_product: 'whatsapp',
                        pin: '123456'
                    })
                });
                const registerData = await registerRes.json();
                if (registerRes.ok && registerData.success) {
                    console.log('[WHATSAPP ONBOARD] ✅ Phone number registered successfully with WhatsApp Cloud API.');
                } else {
                    console.error('[WHATSAPP ONBOARD] ⚠️ Phone registration response:', registerData);
                }
            } catch (regErr) {
                console.error('[WHATSAPP ONBOARD] ⚠️ Phone registration failed (non-fatal):', regErr);
            }
        }

        // 3c. Subscribe the WABA to the app's webhooks so we receive incoming messages
        if (finalWabaId && accessToken) {
            try {
                const subscribeRes = await fetch(`https://graph.facebook.com/v20.0/${finalWabaId}/subscribed_apps`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                const subscribeData = await subscribeRes.json();
                if (subscribeRes.ok && subscribeData.success) {
                    console.log('[WHATSAPP ONBOARD] ✅ WABA webhook subscription activated successfully.');
                } else {
                    console.error('[WHATSAPP ONBOARD] ⚠️ WABA webhook subscription response:', subscribeData);
                }
            } catch (subErr) {
                console.error('[WHATSAPP ONBOARD] ⚠️ WABA webhook subscription failed (non-fatal):', subErr);
            }
        }

        // 4. Auto-seed default WhatsApp real-estate flows
        try {
            const { count } = await supabase
                .from('whatsapp_flows')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', user.id);

            if (count === 0 || count === null) {
                const defaultFlows = [
                    {
                        user_id: user.id,
                        title: 'Instant Lead Welcome',
                        description: 'Send a welcome template 2 mins after lead capture from ads/pages.',
                        icon_name: 'MessageCircle',
                        is_active: false,
                        template_name: 'real_estate_welcome_1',
                        template_body: 'Hi {{1}}, thanks for showing interest in {{2}}! I am Harman from {{3}}. Would you like to receive the digital brochure or schedule a quick site visit?',
                        delay_minutes: 2
                    },
                    {
                        user_id: user.id,
                        title: 'Site Visit Coordinator',
                        description: 'Reminds leads 24 hours before a scheduled site visit appointment.',
                        icon_name: 'CalendarClock',
                        is_active: false,
                        template_name: 'real_estate_reminder_1',
                        template_body: 'Hello {{1}}, this is a quick reminder for our scheduled site visit to {{2}} tomorrow at {{3}}. Let me know if you need location details!',
                        delay_minutes: 1440
                    },
                    {
                        user_id: user.id,
                        title: 'New Launch Alert',
                        description: 'Alert leads immediately about new project phases or pricing updates.',
                        icon_name: 'BellRing',
                        is_active: false,
                        template_name: 'real_estate_alert_1',
                        template_body: 'Hi {{1}}, we just launched a new inventory phase at {{2}} with starting prices at {{3}}. Would you like to get the floor plans?',
                        delay_minutes: 0
                    }
                ];

                const { error: seedError } = await supabase
                    .from('whatsapp_flows')
                    .insert(defaultFlows);

                if (seedError) {
                    console.error('[WHATSAPP ONBOARD] Failed to seed default flows:', seedError);
                } else {
                    console.log('[WHATSAPP ONBOARD] Default flows seeded successfully.');
                }
            }
        } catch (seedErr) {
            console.error('[WHATSAPP ONBOARD] Exception during seeding default flows:', seedErr);
        }

        return NextResponse.json({ 
            success: true, 
            phone: displayPhoneNumber,
            wabaId: finalWabaId,
            phone_number_id: finalPhoneId
        });
    } catch (err: any) {
        console.error('[WHATSAPP ONBOARD] Unexpected Server Error:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}
