const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    const { data, error } = await supabaseAdmin
        .from('video_tasks')
        .insert({
            id: crypto.randomUUID(),
            user_id: "d838c956-1761-4bce-9d91-32f3abecc222",
            property_id: "3cdaf778-753e-4d70-b45f-0969b0648b0a",
            asset_id: "9c9a846f-7e0b-4616-afef-717c14a212e4",
            prompts: ["A professional male real estate advisor speaking directly to camera."],
            current_index: 0,
            last_task_id: "f64a3da7638354e7ed2805ff8d848d81",
            last_successful_task_id: "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/d838c956-1761-4bce-9d91-32f3abecc222/trimmed_ref_v2_29f6070be413c5e8f2325ec493644486.mp4",
            aspect_ratio: "9:16",
            status: "Processing",
            final_caption: "Looking to build secure, long-term wealth in Mohali..."
        })
        .select()
        .single();

    if (error) {
        console.error("Error inserting without video_model:", error);
    } else {
        console.log("SUCCESS! Created video_task:", data.id);
    }
}

main().catch(console.error);
