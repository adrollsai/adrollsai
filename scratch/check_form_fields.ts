import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const { data: page, error } = await supabaseAdmin
        .from('landing_pages')
        .select('html_content')
        .eq('slug', 'test-adrolls-1592')
        .maybeSingle();

    if (error) {
        console.error("Error fetching landing page:", error);
        return;
    }

    if (!page) {
        console.log("No page found.");
        return;
    }

    const html = page.html_content;
    
    // Find all hidden inputs in the HTML content
    const hiddenInputs = html.match(/<input[^>]*type="hidden"[^>]*>/gi) || [];
    console.log("=== Hidden Inputs in HTML ===");
    hiddenInputs.forEach((input: string) => {
        console.log(input);
    });

    // Also let's extract the form container if any
    const formContainer = html.match(/<div[^>]*id="qualification-form-container"[^>]*>([\s\S]*?)<\/div>/gi);
    console.log("\n=== Form Container in HTML ===");
    console.log(formContainer);
}

run().catch(console.error);
