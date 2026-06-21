const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userId = '2b0312dc-c1fc-4798-ab1c-339939271229'; // Adrolls Realty profile
    const sourceVideoId = '1723490788888503'; // Video ID from source campaign
    const linkUrl = 'https://www.adrolls.in/';
    
    console.log("=== Testing Custom Audience Creation on Meta ===");
    const { data: prof, error: pErr } = await supabase
        .from('profiles')
        .select('facebook_token, ad_account_id, pixel_id')
        .eq('id', userId)
        .single();

    if (pErr || !prof) {
        console.error("Profile query error:", pErr);
        return;
    }

    const token = prof.facebook_token;
    const adAccountId = prof.ad_account_id;
    const finalPixelId = prof.pixel_id;

    console.log("Using Ad Account:", adAccountId);
    console.log("Using Pixel ID:", finalPixelId);

    // 1. Test Video Custom Audience
    console.log("\n--- Testing Video Custom Audience ---");
    const videoAudienceName = `Test Video Watchers 95% - ${Date.now()}`;
    const videoRule = {
        inclusions: {
            operator: "or",
            rules: [
                {
                    event_sources: [
                        {
                            id: sourceVideoId,
                            type: "video"
                        }
                    ],
                    retention_seconds: 31536000,
                    filter: {
                        operator: "and",
                        filters: [
                            {
                                field: "event",
                                operator: "eq",
                                value: "video_watched_95_percent"
                            }
                        ]
                    }
                }
            ]
        }
    };

    try {
        const res = await fetch(`https://graph.facebook.com/v19.0/${adAccountId}/customaudiences`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: videoAudienceName,
                subtype: "VIDEO",
                rule: JSON.stringify(videoRule),
                prefill: 1,
                access_token: token
            })
        });
        const resData = await res.json();
        console.log("Video Audience Response:", JSON.stringify(resData, null, 2));
    } catch (e) {
        console.error("Video Audience Exception:", e.message);
    }

    // 2. Test Website Custom Audience
    console.log("\n--- Testing Website Custom Audience ---");
    if (finalPixelId) {
        const websiteAudienceName = `Test Website Visitors - ${Date.now()}`;
        const websiteRule = {
            inclusions: {
                operator: "or",
                rules: [
                    {
                        event_sources: [
                            {
                                id: finalPixelId,
                                type: "pixel"
                            }
                        ],
                        retention_seconds: 15552000,
                        filter: {
                            operator: "and",
                            filters: [
                                {
                                    field: "url",
                                    operator: "i_contains",
                                    value: "adrolls.in"
                                }
                            ]
                        }
                    }
                ]
            }
        };

        try {
            const res = await fetch(`https://graph.facebook.com/v19.0/${adAccountId}/customaudiences`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: websiteAudienceName,
                    rule: JSON.stringify(websiteRule),
                    prefill: 1,
                    access_token: token
                })
            });
            const resData = await res.json();
            console.log("Website Audience Response:", JSON.stringify(resData, null, 2));
        } catch (e) {
            console.error("Website Audience Exception:", e.message);
        }
    } else {
        console.log("No Pixel ID found to test Website Custom Audience.");
    }
}

run().catch(console.error);
