const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const userId = 'c890a11f-84ce-4592-ab8f-8682927b1a9d'; // Realty Nation

function restructureHtml(html) {
    if (!html) return html;

    // 1. Ensure page type is survey
    // Find <div id="qualification-form-container" ...> or similar
    const containerRegex = /<div\s+[^>]*id="qualification-form-container"([^>]*?)>([\s\S]*?)<\/div>/i;
    const match = html.match(containerRegex);
    if (!match) {
        console.log("Could not find qualification form container in HTML.");
        return html;
    }

    let attrs = match[1];
    // Add/replace data-page-type="survey" and data-button-text="Next"
    if (!attrs.includes('data-page-type')) {
        attrs += ' data-page-type="survey"';
    } else {
        attrs = attrs.replace(/data-page-type="[^"]*"/i, 'data-page-type="survey"');
        attrs = attrs.replace(/data-page-type='[^']*'/i, 'data-page-type="survey"');
    }

    if (!attrs.includes('data-button-text')) {
        attrs += ' data-button-text="Next"';
    } else {
        attrs = attrs.replace(/data-button-text="[^"]*"/i, 'data-button-text="Next"');
        attrs = attrs.replace(/data-button-text='[^']*'/i, 'data-button-text="Next"');
    }

    const cleanAttrs = attrs.trim();
    const newFormContainer = `<div id="qualification-form-container" ${cleanAttrs}></div>`;

    // 2. Reposition the container directly below the slider
    // Let's identify the elements to extract
    // First, let's remove the original form wrapper block or container from the HTML
    // In our generated layout, the form wrapper block looks like:
    // <!-- Dynamic Survey Form Insertion Point --> ... </div>
    // OR it might just be the container.
    let formBlockRegex = /<!-- Dynamic Survey Form Insertion Point -->[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/i;
    let hasFormBlock = html.match(formBlockRegex);
    let formBlockText = "";

    if (hasFormBlock) {
        formBlockText = hasFormBlock[0];
        // Replace form container inside it
        formBlockText = formBlockText.replace(containerRegex, newFormContainer);
        // Remove from original place
        html = html.replace(formBlockRegex, '');
    } else {
        // Fallback: just use the form container itself
        formBlockText = `<div class="px-6 pt-6 pb-2 sm:px-8 flex-grow">
            <div class="bg-slate-50/50 rounded-2xl p-4 border border-slate-100 shadow-inner">
                ${newFormContainer}
            </div>
        </div>`;
        // Remove original container
        html = html.replace(containerRegex, '');
    }

    // Now, find the slider/visuals block:
    // <!-- Premium Visual Showcase (Autoplay Slider) --> ... </div>
    const sliderRegex = /(<!-- Premium Visual Showcase \(Autoplay Slider\) -->[\s\S]*?<\/div>)\s*(<!-- Elegant Project Highlights)/i;
    const hasSlider = html.match(sliderRegex);

    if (hasSlider) {
        // Insert directly between the slider and the highlights
        const replacement = `${hasSlider[1]}\n\n        ${formBlockText}\n\n        ${hasSlider[2]}`;
        html = html.replace(sliderRegex, replacement);
        console.log("Successfully restructured with slider regex.");
    } else {
        // Fallback: insert right after <main ...> or after the first large block inside main
        const mainRegex = /(<main[^>]*>[\s\S]*?<\/div>)/i;
        const hasMain = html.match(mainRegex);
        if (hasMain) {
            const replacement = `${hasMain[1]}\n\n        ${formBlockText}`;
            html = html.replace(mainRegex, replacement);
            console.log("Restructured using fallback <main> placement.");
        } else {
            console.log("Could not find insertion point.");
        }
    }

    // 3. Fix background and colors (enforce light theme details)
    // Make sure body has light theme colors
    html = html.replace(/body class="bg-brand-bg text-slate-300/i, 'body class="bg-[#FDFBF7] text-slate-700');
    // Replace light theme configurations
    html = html.replace(/background-color:\s*#0B0F17/gi, 'background-color: #FDFBF7');

    return html;
}

async function run() {
    // Slugs to update
    const slugs = ['highland-mayfield', 'highland-mayfield-5847', 'highland-mayfield-6500', 'highland-mayfield-4167'];

    for (const slug of slugs) {
        console.log(`Processing page: ${slug}...`);
        const { data: page, error } = await supabaseAdmin
            .from('landing_pages')
            .select('*')
            .eq('user_id', userId)
            .eq('slug', slug)
            .maybeSingle();

        if (error || !page) {
            console.log(`Page not found or error for ${slug}`);
            continue;
        }

        const updatedHtml = restructureHtml(page.html_content);
        
        // Save back
        const { error: updateError } = await supabaseAdmin
            .from('landing_pages')
            .update({ html_content: updatedHtml })
            .eq('id', page.id);

        if (updateError) {
            console.error(`Error updating page ${slug}:`, updateError);
        } else {
            console.log(`Successfully updated page: ${slug}`);
        }
    }
}

run().catch(console.error);
