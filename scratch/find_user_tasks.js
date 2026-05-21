const { createClient } = require('@supabase/supabase-js')
// Loaded via --env-file

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

const TASK_1 = "7a7cacfa21eb77f146cc56cccf7bf3ac"
const TASK_2 = "e1f2eadf9e83f584490016f3b6b19de5"

async function findTasks() {
    try {
        console.log(`Searching for Task 1: ${TASK_1}...`)
        const { data: t1, error: err1 } = await supabase
            .from('video_tasks')
            .select('*')
            .eq('last_task_id', TASK_1)

        if (err1) {
            console.log(`Task 1 error: ${err1.message}`)
        } else if (t1 && t1.length > 0) {
            t1.forEach(t => {
                console.log(`Found Task 1! ID: ${t.id} | Asset ID: ${t.asset_id} | User ID: ${t.user_id} | Index: ${t.current_index} | Status: ${t.status}`)
            })
        } else {
            console.log("Task 1: No matching records found.")
        }

        console.log(`\nSearching for Task 2: ${TASK_2}...`)
        const { data: t2, error: err2 } = await supabase
            .from('video_tasks')
            .select('*')
            .eq('last_task_id', TASK_2)

        if (err2) {
            console.log(`Task 2 error: ${err2.message}`)
        } else if (t2 && t2.length > 0) {
            t2.forEach(t => {
                console.log(`Found Task 2! ID: ${t.id} | Asset ID: ${t.asset_id} | User ID: ${t.user_id} | Index: ${t.current_index} | Status: ${t.status}`)
            })
        } else {
            console.log("Task 2: No matching records found.")
        }


    } catch (e) {
        console.error("Error searching:", e)
    }
}

findTasks()
