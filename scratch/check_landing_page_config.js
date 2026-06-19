const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== LANDING PAGE CONFIG SCAN ===");
    
    const { data: page, error } = await supabaseAdmin
        .from('landing_pages')
        .select('*')
        .eq('slug', 'test-adrolls-1592')
        .maybeSingle();
        
    if (error) {
        console.error(error);
        return;
    }
    
    if (!page) {
        console.log("Landing page with slug 'test-adrolls-1592' not found.");
        return;
    }
    
    console.log("Found Page:", {
        id: page.id,
        slug: page.slug,
        title: page.title,
        pixel_id: page.pixel_id,
        user_id: page.user_id,
        created_at: page.created_at,
        custom_questions: page.custom_questions
    });
}

run().catch(console.error);
