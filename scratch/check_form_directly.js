const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

async function run() {
    const userId = 'c890a11f-84ce-4592-ab8f-8682927b1a9d'; // Realty Nation
    const formId = '2429512620881849';

    const { data: p } = await supabase
        .from('profiles')
        .select('facebook_token')
        .eq('id', userId)
        .single();

    const token = p.facebook_token;

    console.log("Querying lead form:", formId);
    const formRes = await fetch(`${FB_MARKETING_URL}/${formId}?fields=id,name,status,locale,questions,leads_count&access_token=${token}`);
    const formData = await formRes.json();
    console.log("Form Details:", JSON.stringify(formData, null, 2));
}

run().catch(console.error);
