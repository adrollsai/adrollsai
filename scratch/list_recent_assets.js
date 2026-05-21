const { createClient } = require('@supabase/supabase-js')
// Loaded via --env-file


const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function getRecentData() {
    console.log("Fetching recent assets...")
    const { data: assets, error: assetsErr } = await supabase
        .from('assets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5)
    
    if (assetsErr) {
        console.error("Error fetching assets:", assetsErr)
    } else {
        console.log("\n=== RECENT ASSETS ===")
        assets.forEach(a => {
            console.log(`ID: ${a.id} | Status: ${a.status} | URL: ${a.url || 'None'} | Created: ${a.created_at}`)
        })
    }

    console.log("\nFetching recent video tasks...")
    const { data: tasks, error: tasksErr } = await supabase
        .from('video_tasks')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10)

    if (tasksErr) {
        console.error("Error fetching video tasks:", tasksErr)
    } else {
        console.log("\n=== RECENT VIDEO TASKS ===")
        tasks.forEach(t => {
            console.log(`ID: ${t.id} | Asset ID: ${t.asset_id} | Index: ${t.current_index} | Status: ${t.status} | Last URL: ${t.last_successful_task_id || 'None'}`)
        })
    }
}

getRecentData()
