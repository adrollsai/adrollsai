import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createHash } from 'crypto';

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

// Hashing Helpers for Meta Custom Audience User Uploads
const cleanAndHashPhone = (phoneStr: string) => {
    const digits = phoneStr.replace(/[^0-9]/g, '');
    if (!digits) return '';
    return createHash('sha256').update(digits).digest('hex');
};

const hashEmail = (emailStr: string) => {
    const clean = emailStr.trim().toLowerCase();
    if (!clean) return '';
    return createHash('sha256').update(clean).digest('hex');
};

// GET: Fetch existing custom audiences
export async function GET(request: Request) {
    const supabase = await createClient();
    
    // Auth Check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Get Target User (support Impersonation)
    const url = new URL(request.url);
    const impersonateId = url.searchParams.get('impersonate');

    const { data: profile } = await supabase.from('profiles').select('role, facebook_token, agency_id, parent_id').eq('id', user.id).single();
    
    let targetUserId = (['admin', 'agent'].includes(profile?.role || '') && (profile?.agency_id || profile?.parent_id)) 
      ? (profile.agency_id || profile.parent_id) 
      : user.id;

    if (impersonateId) {
        if (['super_admin', 'agency', 'admin'].includes(profile?.role || '')) {
            if (profile?.role !== 'super_admin') {
                const isParent = (profile?.agency_id === impersonateId || profile?.parent_id === impersonateId);
                const { data: subAccount } = await supabase
                  .from('profiles')
                  .select('id')
                  .eq('id', impersonateId)
                  .eq('agency_id', profile?.agency_id || user.id)
                  .single();

                if (isParent || subAccount) {
                    targetUserId = impersonateId;
                } else {
                    return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 });
                }
            } else {
                targetUserId = impersonateId;
            }
        } else {
            return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 });
        }
    }

    const { data: targetProfile } = await supabase
      .from('profiles')
      .select('facebook_token, ad_account_id')
      .eq('id', targetUserId)
      .single();

    let token = targetProfile?.facebook_token || profile?.facebook_token;
    const adAccountId = targetProfile?.ad_account_id;

    if (!token || !adAccountId) {
        return NextResponse.json({ audiences: [] });
    }

    try {
        const fbUrl = `${FB_MARKETING_URL}/${adAccountId}/customaudiences?fields=id,name,subtype,description,time_created,approximate_count_lower_bound,approximate_count_upper_bound&limit=100&access_token=${token}`;
        const res = await fetch(fbUrl);
        const data = await res.json();

        if (data.error) {
            return NextResponse.json({ error: data.error.message }, { status: 400 });
        }

        return NextResponse.json({ audiences: data.data || [] });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// POST: Create a new custom audience (and optionally upload users)
export async function POST(request: Request) {
    const supabase = await createClient();
    
    // Auth Check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(request.url);
    const impersonateId = url.searchParams.get('impersonate');

    const { data: profile } = await supabase.from('profiles').select('role, facebook_token, agency_id, parent_id').eq('id', user.id).single();
    
    let targetUserId = (['admin', 'agent'].includes(profile?.role || '') && (profile?.agency_id || profile?.parent_id)) 
      ? (profile.agency_id || profile.parent_id) 
      : user.id;

    if (impersonateId) {
        if (['super_admin', 'agency', 'admin'].includes(profile?.role || '')) {
            if (profile?.role !== 'super_admin') {
                const isParent = (profile?.agency_id === impersonateId || profile?.parent_id === impersonateId);
                const { data: subAccount } = await supabase
                  .from('profiles')
                  .select('id')
                  .eq('id', impersonateId)
                  .eq('agency_id', profile?.agency_id || user.id)
                  .single();

                if (isParent || subAccount) {
                    targetUserId = impersonateId;
                } else {
                    return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 });
                }
            } else {
                targetUserId = impersonateId;
            }
        } else {
            return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 });
        }
    }

    const { data: targetProfile } = await supabase
      .from('profiles')
      .select('facebook_token, ad_account_id, pixel_id')
      .eq('id', targetUserId)
      .single();

    const token = targetProfile?.facebook_token || profile?.facebook_token;
    const adAccountId = targetProfile?.ad_account_id;
    const defaultPixelId = targetProfile?.pixel_id;

    if (!token || !adAccountId) {
        return NextResponse.json({ error: 'Meta integrations not fully connected' }, { status: 400 });
    }

    try {
        const body = await request.json();
        const { name, subtype, description, retention_seconds, url_contains, contacts } = body;

        if (!name || !subtype) {
            return NextResponse.json({ error: 'Missing name or subtype' }, { status: 400 });
        }

        // Create Custom Audience payload
        const audiencePayload: any = {
            name,
            subtype,
            description: description || '',
            access_token: token
        };

        if (subtype === 'CUSTOM') {
            audiencePayload.customer_file_source = 'USER_PROVIDED_ONLY';
        } else if (subtype === 'WEBSITE') {
            const pixelId = defaultPixelId;
            if (!pixelId) {
                return NextResponse.json({ error: 'Meta Pixel ID not configured in profile' }, { status: 400 });
            }

            const websiteRule = {
                inclusions: {
                    operator: "or",
                    rules: [
                        {
                            event_sources: [
                                {
                                    id: pixelId,
                                    type: "pixel"
                                }
                            ],
                            retention_seconds: retention_seconds || 15552000, // default to 180 days max
                            filter: {
                                operator: "and",
                                filters: url_contains ? [
                                    {
                                        field: "url",
                                        operator: "i_contains",
                                        value: url_contains
                                    }
                                ] : []
                            }
                        }
                    ]
                }
            };
            audiencePayload.rule = JSON.stringify(websiteRule);
            audiencePayload.prefill = 1;
        }

        const audienceRes = await fetch(`${FB_MARKETING_URL}/${adAccountId}/customaudiences`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(audiencePayload)
        });

        const audienceData = await audienceRes.json();

        if (!audienceRes.ok) {
            return NextResponse.json({ error: audienceData.error?.message || 'Meta custom audience creation failed' }, { status: 400 });
        }

        const customAudienceId = audienceData.id;

        // If subtype is CUSTOM and contacts are provided, hash and upload them
        if (subtype === 'CUSTOM' && Array.isArray(contacts) && contacts.length > 0) {
            const hashedRows: string[][] = [];
            for (const contact of contacts) {
                const emailHash = contact.email ? hashEmail(contact.email) : '';
                const phoneHash = contact.phone ? cleanAndHashPhone(contact.phone) : '';
                if (emailHash || phoneHash) {
                    hashedRows.push([emailHash, phoneHash]);
                }
            }

            if (hashedRows.length > 0) {
                const uploadPayload = {
                    payload: {
                        schema: ["EMAIL", "PHONE"],
                        data: hashedRows
                    },
                    access_token: token
                };

                const uploadRes = await fetch(`${FB_MARKETING_URL}/${customAudienceId}/users`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(uploadPayload)
                });

                const uploadData = await uploadRes.json();
                if (!uploadRes.ok) {
                    return NextResponse.json({ 
                        success: true, 
                        id: customAudienceId, 
                        uploadError: uploadData.error?.message || 'Failed to upload user contacts' 
                    });
                }

                return NextResponse.json({ 
                    success: true, 
                    id: customAudienceId, 
                    num_received: uploadData.num_received 
                });
            }
        }

        return NextResponse.json({ success: true, id: customAudienceId });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
