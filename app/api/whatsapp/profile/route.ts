import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function GET(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const url = new URL(req.url);
        const impersonateId = url.searchParams.get('impersonate');

        // Resolve effective user ID (support impersonation for super_admin/agency)
        let effectiveUserId = user.id;
        if (impersonateId && impersonateId !== user.id) {
            const { data: authProfile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single();
            const authRole = authProfile?.role?.toLowerCase() || '';
            if (['super_admin', 'agency', 'admin'].includes(authRole)) {
                effectiveUserId = impersonateId;
            }
        }

        // Fetch WABA credentials
        const { data: profile } = await supabase
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_phone_number_id, facebook_token')
            .eq('id', effectiveUserId)
            .single();

        const whatsappToken = profile?.whatsapp_access_token || profile?.facebook_token;
        const whatsappPhoneId = profile?.whatsapp_phone_number_id;

        if (!whatsappToken || !whatsappPhoneId) {
            return NextResponse.json({ error: 'WhatsApp integration not configured.' }, { status: 400 });
        }

        // Fetch profile info from Meta Graph API
        const metaUrl = `https://graph.facebook.com/v20.0/${whatsappPhoneId}/whatsapp_business_profile?fields=about,address,description,email,vertical,websites,profile_picture_url`;
        const res = await fetch(metaUrl, {
            headers: {
                'Authorization': `Bearer ${whatsappToken}`
            }
        });

        const data = await res.json();

        if (!res.ok) {
            console.error('[WHATSAPP PROFILE GET] Meta API error:', data);
            return NextResponse.json({ error: data.error?.message || 'Failed to fetch WhatsApp profile info.' }, { status: res.status });
        }

        return NextResponse.json({ success: true, profile: data.data?.[0] || {} });
    } catch (e: any) {
        console.error('[WHATSAPP PROFILE GET] Exception:', e);
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const url = new URL(req.url);
        const impersonateId = url.searchParams.get('impersonate');

        // Resolve effective user ID (support impersonation for super_admin/agency)
        let effectiveUserId = user.id;
        if (impersonateId && impersonateId !== user.id) {
            const { data: authProfile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single();
            const authRole = authProfile?.role?.toLowerCase() || '';
            if (['super_admin', 'agency', 'admin'].includes(authRole)) {
                effectiveUserId = impersonateId;
            }
        }

        // Fetch WABA credentials
        const { data: profile } = await supabase
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_phone_number_id, facebook_token')
            .eq('id', effectiveUserId)
            .single();

        const whatsappToken = profile?.whatsapp_access_token || profile?.facebook_token;
        const whatsappPhoneId = profile?.whatsapp_phone_number_id;

        if (!whatsappToken || !whatsappPhoneId) {
            return NextResponse.json({ error: 'WhatsApp integration not configured.' }, { status: 400 });
        }

        const contentType = req.headers.get('content-type') || '';
        
        // 1. If updating profile photo (multipart/form-data)
        if (contentType.includes('multipart/form-data')) {
            const formData = await req.formData();
            const file = formData.get('file') as File | null;
            
            if (!file) {
                return NextResponse.json({ error: 'No image file provided for profile picture.' }, { status: 400 });
            }

            const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
            if (!appId) {
                return NextResponse.json({ error: 'Meta Facebook App ID is not configured on the server.' }, { status: 500 });
            }

            // Step 1: Initialize Resumable Upload Session
            console.log(`[WHATSAPP PROFILE PHOTO] Initializing upload session: name=${file.name}, size=${file.size}, type=${file.type}`);
            const initUrl = `https://graph.facebook.com/v20.0/${appId}/uploads?file_name=${encodeURIComponent(file.name)}&file_length=${file.size}&file_type=${encodeURIComponent(file.type)}&access_token=${whatsappToken}`;
            
            const initRes = await fetch(initUrl, { method: 'POST' });
            const initData = await initRes.json();

            if (!initRes.ok) {
                console.error('[WHATSAPP PROFILE PHOTO] Failed to initialize upload session:', initData);
                return NextResponse.json({ error: initData.error?.message || 'Failed to start file upload session with Meta.' }, { status: initRes.status });
            }

            const uploadSessionId = initData.id;
            if (!uploadSessionId) {
                return NextResponse.json({ error: 'Failed to retrieve upload session ID from Meta.' }, { status: 500 });
            }

            // Step 2: Upload the binary file data
            console.log(`[WHATSAPP PROFILE PHOTO] Uploading file binary data to session: ${uploadSessionId}`);
            const uploadUrl = `https://graph.facebook.com/v20.0/${uploadSessionId}`;
            const fileBuffer = await file.arrayBuffer();

            const uploadRes = await fetch(uploadUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `OAuth ${whatsappToken}`,
                    'file_offset': '0',
                    'Content-Type': file.type
                },
                body: fileBuffer
            });

            const uploadData = await uploadRes.json();

            if (!uploadRes.ok) {
                console.error('[WHATSAPP PROFILE PHOTO] Binary upload failed:', uploadData);
                return NextResponse.json({ error: uploadData.error?.message || 'Binary upload to Meta failed.' }, { status: uploadRes.status });
            }

            const profilePictureHandle = uploadData.h;
            if (!profilePictureHandle) {
                return NextResponse.json({ error: 'Failed to retrieve profile picture handle from Meta.' }, { status: 500 });
            }

            // Step 3: Apply the profile picture handle to the WhatsApp Business Profile
            console.log(`[WHATSAPP PROFILE PHOTO] Setting profile picture using handle: ${profilePictureHandle}`);
            const setProfileUrl = `https://graph.facebook.com/v20.0/${whatsappPhoneId}/whatsapp_business_profile`;
            const setProfileRes = await fetch(setProfileUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${whatsappToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    profile_picture_handle: profilePictureHandle
                })
            });

            const setProfileData = await setProfileRes.json();

            if (!setProfileRes.ok) {
                console.error('[WHATSAPP PROFILE PHOTO] Setting profile picture failed:', setProfileData);
                return NextResponse.json({ error: setProfileData.error?.message || 'Failed to update WhatsApp profile picture.' }, { status: setProfileRes.status });
            }

            return NextResponse.json({ success: true, data: setProfileData });
        }

        // 2. Otherwise, update text profile fields (JSON payload)
        const body = await req.json();
        const { address, description, email, vertical, websites, about } = body;

        // Meta only accepts valid business verticals
        // Standard vertical list: OTHER, AUTO, BEAUTY, APPAREL, EDU, ENTERTAIN, EVENT, FINANCE, GROCERY, GOVT, HOTEL, HEALTH, NONPROFIT, PROF_SERVICES, RETAIL, TRAVEL, RESTAURANT
        const payload: any = {
            messaging_product: 'whatsapp'
        };

        if (address !== undefined) payload.address = address;
        if (description !== undefined) payload.description = description;
        if (email !== undefined) payload.email = email;
        if (vertical !== undefined) payload.vertical = vertical || 'OTHER';
        if (websites !== undefined) payload.websites = Array.isArray(websites) ? websites : [websites].filter(Boolean);

        console.log(`[WHATSAPP PROFILE UPDATE] Updating fields for phoneId=${whatsappPhoneId}:`, payload);
        const updateUrl = `https://graph.facebook.com/v20.0/${whatsappPhoneId}/whatsapp_business_profile`;
        const updateRes = await fetch(updateUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${whatsappToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const updateData = await updateRes.json();

        if (!updateRes.ok) {
            console.error('[WHATSAPP PROFILE TEXT UPDATE] Meta API error:', updateData);
            return NextResponse.json({ error: updateData.error?.message || 'Failed to update WhatsApp profile info.' }, { status: updateRes.status });
        }

        // Optionally update the "About" status (different endpoint)
        if (about !== undefined) {
            try {
                const aboutUrl = `https://graph.facebook.com/v20.0/${whatsappPhoneId}/settings`;
                await fetch(aboutUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${whatsappToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        about: about
                    })
                });
            } catch (aboutErr) {
                console.error('[WHATSAPP PROFILE ABOUT] Failed to update About section:', aboutErr);
            }
        }

        return NextResponse.json({ success: true, data: updateData });
    } catch (e: any) {
        console.error('[WHATSAPP PROFILE POST] Exception:', e);
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 });
    }
}
