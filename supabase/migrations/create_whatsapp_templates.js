const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const firstEq = trimmed.indexOf('=');
    if (firstEq === -1) return;
    const key = trimmed.substring(0, firstEq).trim();
    let val = trimmed.substring(firstEq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.substring(1, val.length - 1);
    }
    env[key] = val;
});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

// Small 1x1 transparent PNG base64 to use as sample upload
const samplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const sampleBuffer = Buffer.from(samplePngBase64, 'base64');

async function uploadSampleAndGetHandle(appId, token) {
    try {
        console.log('[UPLOAD] Initiating media upload session with Meta...');
        const initUrl = `https://graph.facebook.com/v20.0/${appId}/uploads?file_name=sample.png&file_length=${sampleBuffer.length}&file_type=image/png`;
        const initRes = await fetch(initUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const initData = await initRes.json();
        if (initData.error) {
            throw new Error(`Init upload failed: ${initData.error.message}`);
        }
        
        const uploadId = initData.id;
        console.log(`[UPLOAD] Upload session created: ${uploadId}. Uploading binary...`);
        
        const uploadRes = await fetch(`https://graph.facebook.com/v20.0/${uploadId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'image/png'
            },
            body: sampleBuffer
        });
        const uploadData = await uploadRes.json();
        if (uploadData.error) {
            throw new Error(`Binary upload failed: ${uploadData.error.message}`);
        }
        
        console.log(`[UPLOAD] Upload complete! Handle: ${uploadData.h}`);
        return uploadData.h;
    } catch (err) {
        console.error('[UPLOAD ERROR]', err.message);
        return null;
    }
}

async function run() {
    try {
        const appId = env.NEXT_PUBLIC_FACEBOOK_APP_ID;
        if (!appId) throw new Error('Missing NEXT_PUBLIC_FACEBOOK_APP_ID in env');

        console.log('Querying active WABA profiles from Supabase...');
        const { data: profiles, error } = await supabaseAdmin
            .from('profiles')
            .select('id, email, business_name, whatsapp_access_token, whatsapp_waba_id, facebook_token')
            .not('whatsapp_waba_id', 'is', null);

        if (error) throw error;

        // Filter only the active profiles (the ones with valid sessions we checked earlier)
        const activeEmails = ['khushiramrealtor@gmail.com', 'infobluesquareinfra@gmail.com', 'demo_dc85dd55@example.com'];
        const activeProfiles = profiles.filter(p => activeEmails.includes(p.email));

        console.log(`Found ${activeProfiles.length} active profiles to register templates.`);

        for (const p of activeProfiles) {
            console.log(`\n==========================================`);
            console.log(`Processing: ${p.business_name} (${p.email})`);
            console.log(`==========================================`);

            const token = p.whatsapp_access_token || p.facebook_token || env.DEV_WHATSAPP_ACCESS_TOKEN;
            const wabaId = p.whatsapp_waba_id || env.DEV_WHATSAPP_WABA_ID;

            if (!token || !wabaId) {
                console.log('Missing credentials. Skipping...');
                continue;
            }

            // Step 1: Upload a sample image to get a header handle
            const handle = await uploadSampleAndGetHandle(appId, token);
            if (!handle) {
                console.log('Could not get header upload handle. Skipping...');
                continue;
            }

            // Step 2: Register the template booking_confirmation_prospect with Meta
            console.log('[TEMPLATE] Registering booking_confirmation_prospect template...');
            const templatePayload = {
                name: 'booking_confirmation_prospect',
                category: 'UTILITY',
                language: 'en_US',
                components: [
                    {
                        type: 'HEADER',
                        format: 'IMAGE',
                        example: {
                            header_handle: [handle]
                        }
                    },
                    {
                        type: 'BODY',
                        text: 'Hi {{1}}, your appointment is confirmed for {{2}} with {{3}} from {{4}}. We look forward to connecting with you!',
                        example: {
                            body_text: [
                                ['John Doe', 'July 16, 2026 at 10:00 AM', 'Sarah Jenkins', p.business_name]
                            ]
                        }
                    }
                ]
            };

            const metaUrl = `https://graph.facebook.com/v20.0/${wabaId}/message_templates`;
            const metaRes = await fetch(metaUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(templatePayload)
            });

            const metaData = await metaRes.json();
            if (metaData.error) {
                console.error('[TEMPLATE ERROR] Registration failed:', metaData.error.message);
            } else {
                console.log(`[TEMPLATE SUCCESS] Registered successfully! Template ID: ${metaData.id}`);
            }

            // Step 3: Register the template booking_notification_admin with Meta
            console.log('[TEMPLATE] Registering booking_notification_admin template...');
            const adminTemplatePayload = {
                name: 'booking_notification_admin',
                category: 'UTILITY',
                language: 'en_US',
                components: [
                    {
                        type: 'BODY',
                        text: 'You have a new booking! {{1}} has booked an appointment for {{2}} with {{3}}. Contact details - Phone: {{4}}, Email: {{5}}. Please check your dashboard for more info.',
                        example: {
                            body_text: [
                                ['John Doe', 'July 16, 2026 at 10:00 AM', 'Sarah Jenkins', '+919999999999', 'john@example.com']
                            ]
                        }
                    }
                ]
            };

            const adminMetaRes = await fetch(metaUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(adminTemplatePayload)
            });

            const adminMetaData = await adminMetaRes.json();
            if (adminMetaData.error) {
                console.error('[TEMPLATE ERROR] Admin Registration failed:', adminMetaData.error.message);
            } else {
                console.log(`[TEMPLATE SUCCESS] Registered successfully! Template ID: ${adminMetaData.id}`);
            }
        }

    } catch (e) {
        console.error('Error in script:', e.message);
    }
}

run();
