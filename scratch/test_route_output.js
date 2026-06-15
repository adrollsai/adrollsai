const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    // Tricity Homez page slug: '1-kanal-super-luxury-kothi-new-chandigarh-5581'
    const slug = '1-kanal-super-luxury-kothi-new-chandigarh-5581';
    const { data: page } = await supabase.from('landing_pages').select('*').eq('slug', slug).single();
    if (!page) {
        console.log("No page found.");
        return;
    }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', page.user_id).single();
    
    const brandColor = profile?.brand_color || '#2563eb';
    
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

    const isBrandLight = getContrastColor(brandColor) === '#0f172a';
    const buttonBgColor = isBrandLight ? '#0B0F19' : brandColor;
    const buttonTextColor = '#ffffff';

    console.log("Brand Color:", brandColor);
    console.log("Is Brand Light:", isBrandLight);
    console.log("Button Bg Color:", buttonBgColor);
    console.log("Button Text Color:", buttonTextColor);

    // Let's find the container in html_content
    const containerRegex = /<div\s+[^>]*id="qualification-form-container"[^>]*>([\s\S]*?)<\/div>/gi;
    const match = page.html_content.match(containerRegex);
    console.log("Matches found in html_content:", match ? match.length : 0);
    if (match) {
        console.log("First Match:", match[0]);
    }
}

run().catch(console.error);
