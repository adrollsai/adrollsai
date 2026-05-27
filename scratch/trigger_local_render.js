const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const originalAssetId = '548e73d6-ecd4-447f-bf7b-8caa168a9df7';
    const stuckAssetId = '1b9c230f-2f46-4bf9-9f2e-e2ebb7426430';

    console.log("Loading original asset...");
    const { data: originalAsset, error: assetErr } = await supabase
        .from('assets')
        .select('*')
        .eq('id', originalAssetId)
        .single();

    if (assetErr || !originalAsset) {
        console.error("Error loading asset:", assetErr);
        return;
    }

    console.log("Loading profile...");
    const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', originalAsset.user_id)
        .single();

    const theme = {
        fontFamily: 'Inter',
        fontSize: 84,
        color: '#FFFFFF',
        highlightColor: '#FFFF00',
        animation: 'pop',
        position: 'center',
        glow: true,
        outlineColor: '#000000'
    };

    const payload = {
        assetId: stuckAssetId,
        videoUrl: originalAsset.url,
        captions: originalAsset.metadata.captions,
        effects: originalAsset.metadata.effects,
        theme: theme,
        profile: profile || {}
    };

    console.log("=== Dispatching local render request to local service on port 8080 ===");
    console.log(`Asset to render: ${stuckAssetId}`);
    
    try {
        const response = await fetch('http://127.0.0.1:8080/render', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const resData = await response.json();
        console.log("Response from local renderer service:", response.status, resData);
    } catch (e) {
        console.error("Failed to connect to local renderer service:", e.message);
    }
}

run();
