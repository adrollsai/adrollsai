import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BLUESQUARE_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
const SHUBHA_ID = '07db7180-6fac-4055-86ee-8b3748590f56';
const GUNHEER_ID = 'ac1d3d22-1c96-462f-b2b5-9bc26ada4bab';

async function checkShubhaHistory() {
    console.log('=== CHECKING SHUBHA LEADS HISTORY & STAGE INTEGRITY ===\n');

    // 1. Read shubha_leads.xlsx
    const shubhaFile = 'C:\\Users\\Adrolls\\Downloads\\shubha_leads.xlsx';
    const wb = XLSX.readFile(shubhaFile);
    const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    console.log('Total rows in shubha_leads.xlsx:', rows.length);
    console.log('Columns:', Object.keys(rows[0]));

    const shubhaPhoneMap = new Map();
    rows.forEach(r => {
        const rawPhone = String(r['Contacts'] || r['Phone'] || '').replace(/\D/g, '').slice(-10);
        if (rawPhone.length >= 7) {
            shubhaPhoneMap.set(rawPhone, r);
        }
    });

    // 2. Fetch all leads for BlueSquare (only valid columns)
    let allLeads: any[] = [];
    let from = 0;
    while (true) {
        const { data, error } = await supabase
            .from('leads')
            .select('id, name, phone, email, assigned_to, user_id, status, pipeline_stage, notes, custom_fields, created_at')
            .eq('user_id', BLUESQUARE_ID)
            .range(from, from + 999);

        if (error) {
            console.error('Fetch error:', error);
            break;
        }
        if (!data || data.length === 0) break;
        allLeads.push(...data);
        if (data.length < 1000) break;
        from += 1000;
    }

    console.log(`Total BlueSquare leads in DB: ${allLeads.length}`);

    const dbPhoneMap = new Map();
    allLeads.forEach(l => {
        const p = String(l.phone || '').replace(/\D/g, '').slice(-10);
        if (p.length >= 7) dbPhoneMap.set(p, l);
    });

    // Check history count for Shubha's leads (assigned to Shubha, assigned to Gunheer, unassigned)
    const shubhaLeadIds: string[] = [];
    const shubhaDisplacedLeadIds: string[] = [];

    for (const [phone, row] of shubhaPhoneMap.entries()) {
        const dbLead = dbPhoneMap.get(phone);
        if (dbLead) {
            shubhaLeadIds.push(dbLead.id);
            if (dbLead.assigned_to !== SHUBHA_ID) {
                shubhaDisplacedLeadIds.push(dbLead.id);
            }
        }
    }

    console.log(`Total Shubha leads found in DB: ${shubhaLeadIds.length}`);
    console.log(`Shubha leads currently displaced (with Gunheer/Unassigned): ${shubhaDisplacedLeadIds.length}`);

    // Sample 10 displaced leads to inspect their stage, notes, and lead_history
    const sampleIds = shubhaDisplacedLeadIds.slice(0, 10);
    const { data: sampleHistory, error: hErr } = await supabase
        .from('lead_history')
        .select('*')
        .in('lead_id', sampleIds);

    if (hErr) console.error('History fetch error:', hErr);

    console.log(`\n--- Sample check of displaced Shubha leads ---`);
    for (const id of sampleIds.slice(0, 5)) {
        const l = allLeads.find(x => x.id === id);
        const p = String(l.phone || '').replace(/\D/g, '').slice(-10);
        const originalRow = shubhaPhoneMap.get(p);
        const histories = (sampleHistory || []).filter(h => h.lead_id === id);

        console.log(`\nLead: ${l.name} | Phone: ${l.phone}`);
        console.log(`  Current Assigned: ${l.assigned_to === GUNHEER_ID ? 'Gunheer' : (l.assigned_to ? l.assigned_to : 'UNASSIGNED')}`);
        console.log(`  Current DB Stage: ${l.pipeline_stage || l.status}`);
        console.log(`  Original Status in Excel: ${originalRow?.['Lead Status']}`);
        console.log(`  Original Next Followup in Excel: ${originalRow?.['Next Followup']}`);
        console.log(`  Original Last Remarks: ${originalRow?.['Last Remarks']}`);
        console.log(`  DB Notes: ${l.notes}`);
        console.log(`  DB lead_history count: ${histories.length}`);
        histories.forEach(h => {
            console.log(`    * [${h.created_at}] Type: ${h.action_type || h.type} | Notes: ${h.description?.replace(/\n/g, ' ')}`);
        });
    }

    // Check total lead_history count across all BlueSquare leads
    const { count: totalBsHistories } = await supabase
        .from('lead_history')
        .select('id', { count: 'exact', head: true });

    console.log(`\nTotal lead_history entries in DB: ${totalBsHistories}`);
}

checkShubhaHistory().catch(console.error);
