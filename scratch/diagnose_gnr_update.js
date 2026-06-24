const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";
const GNR_HOMES_USER_ID = "42d2e0c5-4fe6-4738-8a9f-63f09be01f12";
const ADSET_ID = "52547215476044";

async function run() {
    const { data: p } = await supabaseAdmin
        .from('profiles')
        .select('facebook_token')
        .eq('id', GNR_HOMES_USER_ID)
        .single();

    const token = p.facebook_token;

    // Fetch current ad set targeting
    console.log("Fetching current ad set targeting...");
    const adsetRes = await fetch(`${FB_MARKETING_URL}/${ADSET_ID}?fields=id,name,targeting&access_token=${token}`);
    const adsetData = await adsetRes.json();
    
    if (adsetData.error) {
        console.error("❌ Fetch error:", adsetData.error);
        return;
    }

    const currentTargeting = adsetData.targeting;

    // Chandigarh City (key: "1021145"), Chandigarh Region removed
    const fields = {
        targeting: {
            geo_locations: {
                cities: [
                    { key: "1016294", radius: 20 },
                    { key: "1027716", radius: 20 },
                    { key: "1033379", radius: 20 },
                    { key: "1035473", radius: 20 },
                    { key: "1038870", radius: 20 },
                    { key: "1039228", radius: 20 },
                    { key: "1040446", radius: 20 },
                    { key: "2674292", radius: 20 },
                    { key: "1021145", radius: 20 } // Correct city key for Chandigarh
                ],
                regions: [] // Chandigarh Region removed
            }
        }
    };

    const currentGeo = currentTargeting.geo_locations || {};
    const newGeo = fields.targeting.geo_locations || {};
    
    const updatedGeo = {
        ...newGeo
    };

    if (currentGeo.location_types) {
        updatedGeo.location_types = currentGeo.location_types;
    }
    if (currentGeo.custom_audiences) {
        updatedGeo.custom_audiences = currentGeo.custom_audiences;
    }
    if (currentGeo.excluded_custom_audiences) {
        updatedGeo.excluded_custom_audiences = currentGeo.excluded_custom_audiences;
    }

    // Clean up
    if (updatedGeo.regions) {
        updatedGeo.regions = updatedGeo.regions.map(r => ({ key: r.key }));
    }
    if (updatedGeo.cities) {
        updatedGeo.cities = updatedGeo.cities.map(c => ({
            key: c.key,
            radius: c.radius || 20,
            distance_unit: c.distance_unit || 'kilometer'
        }));
    }
    if (updatedGeo.zips) {
        updatedGeo.zips = updatedGeo.zips.map(z => ({ key: z.key }));
    }

    const updatedTargeting = {
        ...currentTargeting,
        geo_locations: updatedGeo
    };

    const payload = {
        targeting: updatedTargeting,
        access_token: token
    };

    console.log("\nAttempting update with Chandigarh City (No Region Region Chandigarh):", JSON.stringify(payload, null, 2));
    const updateRes = await fetch(`${FB_MARKETING_URL}/${ADSET_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    
    const updateData = await updateRes.json();
    console.log("\nUpdate result:", JSON.stringify(updateData, null, 2));
}

run().catch(console.error);
