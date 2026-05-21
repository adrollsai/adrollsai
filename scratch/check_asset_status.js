const { createClient } = require('@supabase/supabase-js')
// Loaded via --env-file

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

const TARGET_ASSET_ID = "34341a1d-576f-4864-b978-1f5a26c0b764"

async function checkStatus() {
    try {
        console.log(`Checking status of asset ${TARGET_ASSET_ID}...`)
        const { data: asset, error: fetchErr } = await supabase
            .from('assets')
            .select('*')
            .eq('id', TARGET_ASSET_ID)
            .single()

        if (fetchErr || !asset) {
            console.error("Failed to find target asset in Supabase:", fetchErr)
            return
        }

        console.log("\n=== CURRENT ASSET STATUS ===")
        console.log(`ID: ${asset.id}`)
        console.log(`Status: ${asset.status}`)
        console.log(`URL: ${asset.url}`)
        console.log(`Updated At: ${asset.updated_at || 'None'}`)
    } catch (err) {
        console.error("Error checking asset status:", err)
    }
}

checkStatus()
