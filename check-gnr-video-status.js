const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const kieApiKey = env.KIE_API_KEY;

async function checkKie(taskId) {
    if (!taskId) return null;
    try {
        const res = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
            headers: { 'Authorization': `Bearer ${kieApiKey}` }
        });
        return await res.json();
    } catch (e) {
        return { error: e.message };
    }
}

async function main() {
    console.log("=== LATEST 5 ASSETS ===");
    const { data: assets } = await supabaseAdmin
        .from('assets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

    console.log(JSON.stringify(assets, null, 2));

    if (assets && assets.length > 0) {
        const latest = assets[0];
        console.log(`\n=== CHECKING TASKS FOR LATEST ASSET ${latest.id} (${latest.status}) ===`);
        const { data: tasks } = await supabaseAdmin
            .from('video_tasks')
            .select('*')
            .eq('asset_id', latest.id);

        console.log(`Found ${tasks?.length || 0} task(s):`);
        if (tasks) {
            for (const t of tasks) {
                console.log(`\nTask ID: ${t.id}`);
                console.log(`  Index: ${t.current_index}`);
                console.log(`  Kie Task ID: ${t.last_task_id}`);
                console.log(`  Audio URL: ${t.audio_url}`);
                console.log(`  Status: ${t.status}`);
                if (t.last_task_id) {
                    const info = await checkKie(t.last_task_id);
                    console.log(`  Kie State: ${info?.data?.state}`);
                    if (info?.data?.failMsg) console.log(`  Kie Fail Msg: ${info.data.failMsg}`);
                }
            }
        }
    }
}

main().catch(console.error);
