const { createClient } = require('@supabase/supabase-js')
// Loaded via --env-file


const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

// The recent failed asset ID
const TARGET_ASSET_ID = "34341a1d-576f-4864-b978-1f5a26c0b764"
const CLOUD_RUN_URL = "https://adrolls-stitcher-worker-805895515412.us-central1.run.app"

// Real pre-existing video clips from your Kie.ai task results
const VIDEO_1 = "https://tempfile.aiquickdraw.com/seedance/1779368793688-cyehl9avw4f.mp4"
const VIDEO_2 = "https://tempfile.aiquickdraw.com/seedance/1779368953178-kh1y4e3qfi.mp4"

async function triggerTest() {
    try {
        console.log(`[Test] Fetching target asset ${TARGET_ASSET_ID}...`)
        const { data: asset, error: fetchErr } = await supabase
            .from('assets')
            .select('*')
            .eq('id', TARGET_ASSET_ID)
            .single()

        if (fetchErr || !asset) {
            console.error("[Test] Failed to find target asset in Supabase:", fetchErr)
            return
        }

        const userId = asset.user_id
        console.log(`[Test] Found asset. User ID: ${userId}.`)

        // Set status to Generating so we can see it transition to Draft on success
        console.log(`[Test] Resetting asset status to 'Generating' for test tracking...`)
        await supabase
            .from('assets')
            .update({ status: 'Generating', url: 'https://designs.adrolls.in/processing' })
            .eq('id', TARGET_ASSET_ID)

        // Make sure a temporary video task exists for safety if cleanup expects it
        const crypto = require('crypto')
        console.log(`[Test] Inserting temporary video_task to satisfy cleanups...`)
        await supabase
            .from('video_tasks')
            .upsert({
                id: crypto.randomUUID(),
                asset_id: TARGET_ASSET_ID,
                user_id: userId,
                current_index: 0,
                status: 'Completed',
                last_successful_task_id: VIDEO_1,
                last_task_id: "mock-task-1",
                prompts: ["Scene 1 prompt"]
            })

        // Call the Cloud Run stitcher endpoint
        const endpoint = `${CLOUD_RUN_URL.replace(/\/$/, '')}/stitch`
        console.log(`[Test] Dispatching POST request to Cloud Run: ${endpoint}...`)

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                siblings: [
                    { current_index: 0, last_successful_task_id: VIDEO_1 },
                    { current_index: 1, last_successful_task_id: VIDEO_2 }
                ],
                videoTask: {
                    asset_id: TARGET_ASSET_ID,
                    user_id: userId
                }
            })
        })

        const result = await response.json()
        console.log("[Test] Server responded with:", result)
        console.log("\n[Test] Cloud Run stitching has been triggered! Wait ~10-20 seconds and check your Assets tab for changes.")
    } catch (err) {
        console.error("[Test] Error triggering test:", err)
    }
}

triggerTest()
