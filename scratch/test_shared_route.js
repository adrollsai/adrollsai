const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    // Get the most recent landing page and its profile
    const { data: page } = await supabase.from('landing_pages').select('*').order('updated_at', { ascending: false }).limit(1).single();
    if (!page) {
        console.log("No landing page found.");
        return;
    }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', page.user_id).single();
    if (!profile) {
        console.log("No profile found for user:", page.user_id);
        return;
    }

    console.log("PAGE SLUG:", page.slug);
    console.log("USER ID:", page.user_id);
    console.log("PROFILE BUSINESS NAME:", profile.business_name);
    console.log("PROFILE BRAND COLOR:", profile.brand_color);

    // Call the contrast function
    const brandColor = profile.brand_color || '#2563eb';
    function getContrastColor(hexColor) {
        if (!hexColor) return '#ffffff';
        const hex = hexColor.replace('#', '');
        if (hex.length !== 6) return '#ffffff';
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return (yiq >= 128) ? '#0f172a' : '#ffffff';
    }
    const textColor = getContrastColor(brandColor);
    console.log("CALCULATED TEXT COLOR:", textColor);
}

run().catch(console.error);
