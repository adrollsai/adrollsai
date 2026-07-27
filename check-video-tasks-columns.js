const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    const row = {
        id: crypto.randomUUID(),
        user_id: "42d2e0c5-4fe6-4738-8a9f-63f09be01f12",
        property_id: "8050efba-27eb-45e2-8149-28e24de74b99",
        asset_id: "884bd839-900a-4556-b7dc-6222cd6a8e75",
        prompts: ["test prompt"],
        current_index: 0,
        last_task_id: "18126a4659789297734862469957cf76",
        last_successful_task_id: "http://example.com/img.jpg",
        aspect_ratio: "9:16",
        status: "Processing",
        final_caption: "test caption"
    };

    const { data, error } = await supabaseAdmin.from('video_tasks').insert(row).select().single();
    if (error) {
        console.error("Insert Error:", error);
    } else {
        console.log("Success! Columns in video_tasks table:", Object.keys(data));
        console.log("Data row:", JSON.stringify(data, null, 2));
    }
}

main().catch(console.error);
