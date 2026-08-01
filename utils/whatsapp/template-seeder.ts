import { createClient } from '@supabase/supabase-js'

const samplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const sampleBuffer = Buffer.from(samplePngBase64, 'base64');

async function uploadSampleAndGetHandle(appId: string, token: string) {
    try {
        console.log('[TEMPLATE SEEDER][UPLOAD] Initiating media upload session with Meta...');
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
        console.log(`[TEMPLATE SEEDER][UPLOAD] Upload session created: ${uploadId}. Uploading binary...`);
        
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
        
        console.log(`[TEMPLATE SEEDER][UPLOAD] Upload complete! Handle: ${uploadData.h}`);
        return uploadData.h;
    } catch (err: any) {
        console.error('[TEMPLATE SEEDER][UPLOAD ERROR]', err.message);
        return null;
    }
}

export async function registerDefaultTemplates(
    supabaseAdmin: any,
    userId: string,
    whatsappToken: string,
    whatsappWabaId: string
) {
    try {
        const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
        if (!appId) {
            console.error('[TEMPLATE SEEDER] Missing NEXT_PUBLIC_FACEBOOK_APP_ID in env');
            return { success: false, error: 'Missing facebook app id configuration' };
        }

        console.log(`[TEMPLATE SEEDER] Checking existing templates for WABA: ${whatsappWabaId}...`);
        
        // 1. Fetch current templates from Meta to prevent duplicates
        const getMetaUrl = `https://graph.facebook.com/v20.0/${whatsappWabaId}/message_templates?limit=1000`;
        const getRes = await fetch(getMetaUrl, {
            headers: { 'Authorization': `Bearer ${whatsappToken}` }
        });
        const getParsed = await getRes.json();
        
        if (getParsed.error) {
            console.error('[TEMPLATE SEEDER] Meta GET templates failed:', getParsed.error);
            return { success: false, error: getParsed.error.message };
        }

        const existingNames = new Set((getParsed.data || []).map((t: any) => t.name.toLowerCase()));
        console.log('[TEMPLATE SEEDER] Existing templates on Meta:', Array.from(existingNames));

        const results: any[] = [];
        const postMetaUrl = `https://graph.facebook.com/v20.0/${whatsappWabaId}/message_templates`;

        // A. booking_confirmation_prospect
        if (!existingNames.has('booking_confirmation_prospect')) {
            console.log('[TEMPLATE SEEDER] Registering booking_confirmation_prospect template...');
            const handle = await uploadSampleAndGetHandle(appId, whatsappToken);
            if (handle) {
                const payload = {
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
                                    ['John Doe', 'July 16, 2026 at 10:00 AM', 'Sarah Jenkins', 'Nobogent']
                                ]
                            }
                        }
                    ]
                };

                const res = await fetch(postMetaUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${whatsappToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                results.push({ name: 'booking_confirmation_prospect', success: !data.error, error: data.error?.message || null });
            } else {
                results.push({ name: 'booking_confirmation_prospect', success: false, error: 'Could not upload header handle' });
            }
        } else {
            results.push({ name: 'booking_confirmation_prospect', success: true, cached: true });
        }

        // A2. booking_confirmation_generic (Text-only generic confirmation)
        if (!existingNames.has('booking_confirmation_generic')) {
            console.log('[TEMPLATE SEEDER] Registering booking_confirmation_generic template...');
            const genericPayload = {
                name: 'booking_confirmation_generic',
                category: 'UTILITY',
                language: 'en_US',
                components: [
                    {
                        type: 'BODY',
                        text: 'Hi {{1}}, your appointment has been confirmed for {{2}} with {{3}} from {{4}}. We look forward to connecting with you!',
                        example: {
                            body_text: [
                                ['John Doe', 'August 2, 2026 at 03:00 PM', 'Sarah Jenkins', 'Nobogent']
                            ]
                        }
                    }
                ]
            };

            const genericRes = await fetch(postMetaUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${whatsappToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(genericPayload)
            });
            const genericData = await genericRes.json();
            results.push({ name: 'booking_confirmation_generic', success: !genericData.error, error: genericData.error?.message || null });
        } else {
            results.push({ name: 'booking_confirmation_generic', success: true, cached: true });
        }

        // B. booking_notification_admin
        if (!existingNames.has('booking_notification_admin')) {
            console.log('[TEMPLATE SEEDER] Registering booking_notification_admin template...');
            const payload = {
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

            const res = await fetch(postMetaUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${whatsappToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            results.push({ name: 'booking_notification_admin', success: !data.error, error: data.error?.message || null });
        } else {
            results.push({ name: 'booking_notification_admin', success: true, cached: true });
        }

        // C. expert_connection_notification
        if (!existingNames.has('expert_connection_notification')) {
            console.log('[TEMPLATE SEEDER] Registering expert_connection_notification template...');
            const payload = {
                name: 'expert_connection_notification',
                category: 'UTILITY',
                language: 'en_US',
                components: [
                    {
                        type: 'BODY',
                        text: 'Lead Notification: {{1}} (Phone: {{2}}) has requested to connect with an expert immediately. Please contact them as soon as possible.',
                        example: {
                            body_text: [
                                ['John Doe', '+919999999999']
                            ]
                        }
                    }
                ]
            };

            const res = await fetch(postMetaUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${whatsappToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            results.push({ name: 'expert_connection_notification', success: !data.error, error: data.error?.message || null });
        } else {
            results.push({ name: 'expert_connection_notification', success: true, cached: true });
        }

        // D. instant_lead_catalog_welcome
        if (!existingNames.has('instant_lead_catalog_welcome')) {
            console.log('[TEMPLATE SEEDER] Registering instant_lead_catalog_welcome template with Meta...');
            const payload = {
                name: 'instant_lead_catalog_welcome',
                category: 'MARKETING',
                language: 'en_US',
                components: [
                    {
                        type: 'BODY',
                        text: 'Hi {{1}}, thank you for showing interest in {{2}}! We have received your inquiry. Click the button below to view our complete inventory catalog and current listings:',
                        example: {
                            body_text: [
                                ['John', 'Nobogent']
                            ]
                        }
                    },
                    {
                        type: 'BUTTONS',
                        buttons: [
                            {
                                type: 'URL',
                                text: 'View Listings',
                                url: 'https://app.nobogent.com/shared/{{1}}',
                                example: [
                                    'default'
                                ]
                            }
                        ]
                    }
                ]
            };

            const res = await fetch(postMetaUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${whatsappToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            results.push({ name: 'instant_lead_catalog_welcome', success: !data.error, error: data.error?.message || null });
        } else {
            results.push({ name: 'instant_lead_catalog_welcome', success: true, cached: true });
        }

        return { success: true, results };
    } catch (err: any) {
        console.error('[TEMPLATE SEEDER] Seeding failed:', err);
        return { success: false, error: err.message };
    }
}
