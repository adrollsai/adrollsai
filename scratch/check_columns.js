const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkColumns() {
    const { data, error } = await supabase.from('profiles').select('*').limit(1)
    if (error) {
        console.error(error)
        return
    }
    if (data && data.length > 0) {
        console.log('Columns in profiles:', Object.keys(data[0]))
    } else {
        console.log('No data in profiles table to check columns.')
    }
}

checkColumns()
