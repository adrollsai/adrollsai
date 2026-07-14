import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    try {
        // We use an RPC call or a direct SQL query if the extension is enabled
        // Since we can't run raw SQL easily via the client without an RPC, 
        // we'll try to use a common pattern or a helper.
        
        // If you have the 'postgres' extension enabled, we can run:
        // ALTER TABLE profiles ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR';

        const { error } = await supabaseAdmin.rpc('run_sql', {
            sql_query: "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR'; ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS csv_audience TEXT;"
        })

        if (error) {
            return NextResponse.json({ 
                error: "RPC 'run_sql' not found.",
                instruction: "Please go to your Supabase Dashboard -> SQL Editor and run:\n\nALTER TABLE profiles ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR';\nALTER TABLE public.leads ADD COLUMN IF NOT EXISTS csv_audience TEXT;"
            })
        }

        return NextResponse.json({ success: true, message: "Currency column added successfully!" })

    } catch (e: any) {
        return NextResponse.json({ error: e.message })
    }
}
