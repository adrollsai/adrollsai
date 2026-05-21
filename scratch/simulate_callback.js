const { createClient } = require('@supabase/supabase-js')
// Loaded via --env-file

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

// Target Asset and User information we found in your database
const TARGET_ASSET_ID = "34341a1d-576f-4864-b978-1f5a26c0b764"
const USER_ID = "2f62a259-f23b-48ee-a920-c436f36eaa4b"

// Your actual Kie Task IDs
const KIE_TASK_1 = "7a7cacfa21eb77f146cc56cccf7bf3ac"
const KIE_TASK_2 = "e1f2eadf9e83f584490016f3b6b19de5"

// Pre-existing video URLs from Kie.ai task results
const VIDEO_1 = "https://tempfile.aiquickdraw.com/seedance/1779368793688-cyehl9avw4f.mp4"
const VIDEO_2 = "https://tempfile.aiquickdraw.com/seedance/1779368953178-kh1y4e3qfi.mp4"

// Get Next.js local host port from arguments or default to 3000
const localServerBase = process.argv[2] || "http://localhost:3000"
const callbackUrl = `${localServerBase.replace(/\/$/, '')}/api/video/callback`

async function runCallbackSimulation() {
    try {
        console.log(`[Simulate] Target local server URL: ${localServerBase}`)
        console.log(`[Simulate] Callback handler endpoint: ${callbackUrl}`)

        // 1. Reset the asset state in the database
        console.log(`\n[Simulate] Resetting asset ${TARGET_ASSET_ID} status to 'Generating'...`)
        await supabase
            .from('assets')
            .update({ status: 'Generating', url: 'https://designs.adrolls.in/processing' })
            .eq('id', TARGET_ASSET_ID)

        // 2. Clear old tasks for safety
        console.log(`[Simulate] Cleaning up existing video tasks for this asset...`)
        await supabase.from('video_tasks').delete().eq('asset_id', TARGET_ASSET_ID)

        // 3. Insert the two tasks to represent the scene queue
        const crypto = require('crypto')
        console.log(`[Simulate] Inserting Task 1 (${KIE_TASK_1}) in database...`)
        const { error: err1 } = await supabase.from('video_tasks').insert({
            id: crypto.randomUUID(),
            asset_id: TARGET_ASSET_ID,
            user_id: USER_ID,
            current_index: 0,
            status: 'Generating',
            last_task_id: KIE_TASK_1,
            prompts: ["Scene 1 Promo", "Scene 2 Promo"]
        })
        if (err1) throw err1

        console.log(`[Simulate] Inserting Task 2 (${KIE_TASK_2}) in database...`)
        const { error: err2 } = await supabase.from('video_tasks').insert({
            id: crypto.randomUUID(),
            asset_id: TARGET_ASSET_ID,
            user_id: USER_ID,
            current_index: 1,
            status: 'Generating',
            last_task_id: KIE_TASK_2,
            prompts: ["Scene 1 Promo", "Scene 2 Promo"]
        })
        if (err2) throw err2

        console.log(`\n[Simulate] Successfully inserted task states! Starting callback simulation...`)

        // 4. Fire callback 1
        console.log(`\n[Simulate] Sending webhook callback for Scene 1 (Task: ${KIE_TASK_1})...`)
        const res1 = await fetch(callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: 200,
                msg: "success",
                data: {
                    taskId: KIE_TASK_1,
                    result: VIDEO_1
                }
            })
        })
        console.log(`[Simulate] Scene 1 Callback Response status:`, res1.status)
        const json1 = await res1.json()
        console.log(`[Simulate] Response body:`, json1)

        // Give a tiny break to let the database write settle
        await new Promise(resolve => setTimeout(resolve, 3000))

        // 5. Fire callback 2 (This triggers stitching!)
        console.log(`\n[Simulate] Sending webhook callback for Scene 2 (Task: ${KIE_TASK_2})...`)
        const res2 = await fetch(callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: 200,
                msg: "success",
                data: {
                    taskId: KIE_TASK_2,
                    result: VIDEO_2
                }
            })
        })
        console.log(`[Simulate] Scene 2 Callback Response status:`, res2.status)
        const json2 = await res2.json()
        console.log(`[Simulate] Response body:`, json2)

        console.log(`\n=== Callback Simulation Completed! ===`)
        console.log("Check your Next.js terminal logs to see the callback output.")
        console.log("Check your Assets tab or run `node --env-file=.env.local scratch/check_asset_status.js` in a few seconds to verify the stitched result!")
    } catch (err) {
        console.error("[Simulate] Error during simulation:", err)
    }
}

runCallbackSimulation()
