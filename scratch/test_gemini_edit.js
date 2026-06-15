const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const { callGemini } = require('../utils/external-apis');

async function run() {
    const slug = '1-kanal-super-luxury-kothi-new-chandigarh-5581';
    const { data: page, error } = await supabase.from('landing_pages').select('*').eq('slug', slug).single();
    if (error || !page) {
        console.error("Failed to load page:", error);
        return;
    }

    const { data: profile } = await supabase.from('profiles').select('*').eq('id', page.user_id).single();

    const instructions = "the images in the hero section that keep changing behind are super zoomed in and are not visible properly, please adjust them and make it responsive too";
    const currentHtml = page.html_content;

    const systemPrompt = `You are a master front-end developer.
Edit the provided landing page HTML strictly according to the user's instructions.
User Instructions: "${instructions}"

CURRENT HTML:
${currentHtml}

CRITICAL RULES:
1. Preserve the structural container '<div id="qualification-form-container" ...></div>' (and all its attributes), modifying ONLY the attributes or container itself as requested by the user. Do NOT write a form element inside this container.
2. Retain all existing styling, layout elements, assets, and copywriting, modifying ONLY the parts requested by the user.
3. If the user asks to change the form button text, modify the 'data-button-text' attribute on the '<div id="qualification-form-container" ...>' element. Do NOT write button HTML inside that container, only modify the attribute.
4. Return ONLY the raw, complete, valid updated HTML string starting with "<!DOCTYPE html>" and ending with "</html>".
5. ABSOLUTELY DO NOT wrap the output in markdown code blocks. Output ONLY the pure raw updated HTML string. No conversational text.
6. DO NOT delete, alter, or omit any existing page sections, styles, JS scripts, or sections unless explicitly instructed to do so. Your edit must be a direct, surgical modification of the provided CURRENT HTML, maintaining 100% of the other page elements, structure, and images.
7. CRITICAL ACCURACY RULE: You must ONLY include, describe, or reference the exact information passed as context in this prompt. Absolutely DO NOT hallucinate, assume, or generate registration numbers, RERA IDs, approvals, or any parameters/specifications not explicitly provided. If a RERA ID or number is not explicitly provided, DO NOT mention RERA, do not write "RERA Approved", and do not show any fake/placeholder registration numbers.`;

    console.log("Calling Gemini with edit prompt...");
    try {
        const result = await callGemini(systemPrompt);
        console.log("Success! Output length:", result.length);
        console.log("Output snippet:\n", result.slice(0, 500));
    } catch (e) {
        console.error("FAIL:", e);
    }
}

run().catch(console.error);
