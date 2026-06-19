const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const userId = 'c890a11f-84ce-4592-ab8f-8682927b1a9d'; // Realty Nation

async function run() {
    // 1. Fix highland-mayfield-6500 from its backup
    console.log("Restoring and fixing highland-mayfield-6500...");
    const original6500Html = fs.readFileSync(path.join(__dirname, 'highland_mayfield_6500.html'), 'utf8');
    
    // Exact target block to replace
    const target6500Block = `          <div 
            id="qualification-form-container" 
            data-page-type="survey" 
            data-button-text="Start Survey"
            class="min-h-[300px] flex flex-col justify-center text-gray-200"
          >
            <!-- Auto Loader Spinner while dynamic widget initializes -->
            <div class="text-center py-12 space-y-4">
              <div class="inline-block w-10 h-10 border-4 border-brand-accent/30 border-t-brand-accent rounded-full animate-spin"></div>
              <p class="text-xs tracking-widest text-gray-500 uppercase">Securing secure registration interface...</p>
            </div>
          </div>`;
          
    const replacement6500Block = `          <div id="qualification-form-container" data-page-type="survey" data-button-text="Next"></div>`;
    
    let updated6500Html = original6500Html.replace(target6500Block, replacement6500Block);
    // Enforce light theme page background in CSS / classes
    updated6500Html = updated6500Html.replace('background-color: #0B0F17;', 'background-color: #FDFBF7;');
    updated6500Html = updated6500Html.replace('class="text-gray-300 min-h-screen antialiased"', 'class="text-slate-700 min-h-screen antialiased bg-[#FDFBF7]"');
    
    const { error: error6500 } = await supabaseAdmin
        .from('landing_pages')
        .update({ html_content: updated6500Html })
        .eq('user_id', userId)
        .eq('slug', 'highland-mayfield-6500');
        
    if (error6500) {
        console.error("Error updating 6500:", error6500);
    } else {
        console.log("Successfully updated highland-mayfield-6500!");
    }

    // 2. Fix highland-mayfield (base page slug) to convert it to survey layout
    console.log("Converting highland-mayfield to survey layout...");
    // Let's use the restructured highland-mayfield-5847 as the basis, but update its slug to 'highland-mayfield'
    const { data: page5847 } = await supabaseAdmin
        .from('landing_pages')
        .select('html_content')
        .eq('user_id', userId)
        .eq('slug', 'highland-mayfield-5847')
        .single();
        
    if (page5847) {
        // Enforce the title matches 'highland-mayfield' product details
        const { error: errorBase } = await supabaseAdmin
            .from('landing_pages')
            .update({ html_content: page5847.html_content })
            .eq('user_id', userId)
            .eq('slug', 'highland-mayfield');
            
        if (errorBase) {
            console.error("Error updating base page:", errorBase);
        } else {
            console.log("Successfully converted base page highland-mayfield to survey format!");
        }
    }
}

run().catch(console.error);
