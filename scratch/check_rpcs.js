const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

async function run() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    console.log("Fetching PostgREST schema info...");
    const url = `${supabaseUrl}/rest/v1/`;
    const res = await fetch(url, {
        headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`
        }
    });

    if (!res.ok) {
        console.error("Failed to fetch API spec:", res.status, await res.text());
        return;
    }

    const spec = await res.json();
    console.log("Paths exposed by API:");
    const paths = Object.keys(spec.paths || {});
    const rpcPaths = paths.filter(p => p.startsWith('/rpc/'));
    console.log(rpcPaths);

    // Look for anything containing sql
    const sqlRpcs = rpcPaths.filter(p => p.toLowerCase().includes('sql'));
    console.log("SQL related RPCs:", sqlRpcs);
}

run().catch(console.error);
