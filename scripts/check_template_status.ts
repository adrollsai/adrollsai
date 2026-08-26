import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
    const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, business_name, whatsapp_waba_id, whatsapp_access_token, facebook_token')
        .not('whatsapp_waba_id', 'is', null);

    const uniqueWabas = new Map<string, { token: string; email: string; business: string }>();
    for (const p of profiles || []) {
        const token = p.whatsapp_access_token || p.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;
        if (p.whatsapp_waba_id && token && !uniqueWabas.has(p.whatsapp_waba_id)) {
            uniqueWabas.set(p.whatsapp_waba_id, {
                token,
                email: p.email || 'N/A',
                business: p.business_name || 'N/A'
            });
        }
    }

    for (const [wabaId, info] of uniqueWabas.entries()) {
        try {
            const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?name=tailored_inventory_qualify`, {
                headers: { 'Authorization': `Bearer ${info.token}` }
            });
            const data = await res.json();
            console.log(`\n🏢 ${info.business} (${info.email}):`);
            if (data.data && data.data.length > 0) {
                for (const t of data.data) {
                    console.log(`  - Template: ${t.name} | Status: ${t.status} | Category: ${t.category} | Language: ${t.language}`);
                }
            } else {
                console.log(`  - No template named 'tailored_inventory_qualify' found (or not approved). Raw:`, data);
            }
        } catch (e: any) {
            console.error(`Error checking ${info.business}:`, e.message);
        }
    }
}

main().catch(console.error);
