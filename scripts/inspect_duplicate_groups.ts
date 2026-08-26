import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
    const userId = '29937131-1975-4c5f-9b78-e5b28f918d32';
    let allLeads: any[] = [];
    let from = 0;
    while (true) {
        const { data } = await supabase
            .from('leads')
            .select('id, name, phone, email, custom_fields, created_at')
            .eq('user_id', userId)
            .range(from, from + 999)
            .order('created_at', { ascending: false });

        if (!data || data.length === 0) break;
        allLeads.push(...data);
        if (data.length < 1000) break;
        from += 1000;
    }

    // 1. By telecrm_lead_id
    const telecrmMap = new Map<string, any[]>();
    // 2. By email
    const emailMap = new Map<string, any[]>();
    // 3. By Exact name + phone
    const namePhoneMap = new Map<string, any[]>();
    // 4. By exact phone where phone does NOT end with 0000
    const realPhoneMap = new Map<string, any[]>();

    for (const l of allLeads) {
        const cf = typeof l.custom_fields === 'string' ? JSON.parse(l.custom_fields || '{}') : (l.custom_fields || {});
        const telecrmId = cf.telecrm_lead_id;
        if (telecrmId) {
            if (!telecrmMap.has(telecrmId)) telecrmMap.set(telecrmId, []);
            telecrmMap.get(telecrmId)!.push(l);
        }

        const email = (l.email || '').toLowerCase().trim();
        if (email && email.includes('@') && !email.includes('example.com')) {
            if (!emailMap.has(email)) emailMap.set(email, []);
            emailMap.get(email)!.push(l);
        }

        const name = (l.name || '').toLowerCase().trim();
        const phone = (l.phone || '').trim();
        const key = `${name}___${phone}`;
        if (!namePhoneMap.has(key)) namePhoneMap.set(key, []);
        namePhoneMap.get(key)!.push(l);

        if (phone && !phone.endsWith('000000')) {
            if (!realPhoneMap.has(phone)) realPhoneMap.set(phone, []);
            realPhoneMap.get(phone)!.push(l);
        }
    }

    console.log('TeleCRM ID duplicate groups:', Array.from(telecrmMap.entries()).filter(([_, v]) => v.length > 1).length);
    console.log('Email duplicate groups:', Array.from(emailMap.entries()).filter(([_, v]) => v.length > 1).length);
    console.log('Name + Phone duplicate groups:', Array.from(namePhoneMap.entries()).filter(([_, v]) => v.length > 1).length);
    console.log('Real Exact Phone duplicate groups (non-000000):', Array.from(realPhoneMap.entries()).filter(([_, v]) => v.length > 1).length);
}

main().catch(console.error);
