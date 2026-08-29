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

async function analyzeShubha() {
    console.log('=== DEEP DIVE: SHUBHA LEADS ANALYSIS ===\n');

    // 1. Read shubha_leads.xlsx if exists
    const shubhaFile = 'C:\\Users\\Adrolls\\Downloads\\shubha_leads.xlsx';
    let shubhaExcelPhones = new Map();
    if (fs.existsSync(shubhaFile)) {
        const wb = XLSX.readFile(shubhaFile);
        const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        console.log(`shubha_leads.xlsx total rows: ${rows.length}`);
        rows.forEach(r => {
            const rawPhone = String(r['Phone'] || r['Contacts'] || r['Phone Number'] || r['Contact'] || '').replace(/\D/g, '').slice(-10);
            if (rawPhone.length >= 7) {
                shubhaExcelPhones.set(rawPhone, r);
            }
        });
        console.log(`Unique phones in shubha_leads.xlsx: ${shubhaExcelPhones.size}`);
    } else {
        console.log(`File not found: ${shubhaFile}`);
    }

    // 2. Read ALL Leads files in Downloads/data
    const dataDir = 'C:\\Users\\Adrolls\\Downloads\\data';
    const sourceFiles = [
        path.join(dataDir, 'ALL Leads 1-6000.xlsx'),
        path.join(dataDir, 'ALL Leads 6001-12000.xlsx'),
        path.join(dataDir, 'ALL Leads 12001-15591.xlsx')
    ];

    const allLeadsShubha = new Map();
    const allLeadsByOwner = new Map();

    sourceFiles.forEach(file => {
        if (fs.existsSync(file)) {
            const wb = XLSX.readFile(file);
            const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
            rows.forEach(r => {
                const owner = String(r['Lead Owner'] || r['Owner'] || 'Unknown').trim();
                const rawPhone = String(r['Contacts'] || r['Phone'] || '').replace(/\D/g, '').slice(-10);
                if (rawPhone.length >= 7) {
                    allLeadsByOwner.set(owner, (allLeadsByOwner.get(owner) || 0) + 1);
                    if (owner.toLowerCase().includes('shubha')) {
                        allLeadsShubha.set(rawPhone, { ...r, sourceFile: path.basename(file) });
                    }
                }
            });
        }
    });

    console.log('\n--- Owners count in "ALL Leads" dump files ---');
    for (const [owner, count] of allLeadsByOwner.entries()) {
        console.log(`- ${owner}: ${count} leads`);
    }
    console.log(`Total Shubha leads in "ALL Leads" dump: ${allLeadsShubha.size}`);

    // 3. Fetch ALL leads from DB for BlueSquare
    let allDbLeads: any[] = [];
    let from = 0;
    while (true) {
        const { data, error } = await supabase
            .from('leads')
            .select('id, name, phone, email, assigned_to, user_id, status, pipeline_stage, created_at, custom_fields')
            .eq('user_id', BLUESQUARE_ID)
            .range(from, from + 999);

        if (error || !data || data.length === 0) break;
        allDbLeads.push(...data);
        if (data.length < 1000) break;
        from += 1000;
    }

    console.log(`\nTotal BlueSquare leads in DB: ${allDbLeads.length}`);

    // Create DB phone index
    const dbByPhone = new Map();
    allDbLeads.forEach(l => {
        const phone = String(l.phone || '').replace(/\D/g, '').slice(-10);
        if (phone.length >= 7) {
            dbByPhone.set(phone, l);
        }
    });

    // 4. Trace what happened to Shubha's Excel leads
    console.log('\n--- Where are the leads from shubha_leads.xlsx currently? ---');
    const locationOfShubhaLeads = new Map();
    let notInDbCount = 0;

    for (const [phone, row] of shubhaExcelPhones.entries()) {
        const dbLead = dbByPhone.get(phone);
        if (!dbLead) {
            notInDbCount++;
        } else {
            const assigned = dbLead.assigned_to || 'UNASSIGNED';
            locationOfShubhaLeads.set(assigned, (locationOfShubhaLeads.get(assigned) || 0) + 1);
        }
    }

    // Profiles map
    const { data: profiles } = await supabase.from('profiles').select('id, name, full_name, email');
    const userMap = new Map();
    profiles?.forEach(p => userMap.set(p.id, p.name || p.full_name || p.email));

    for (const [assignedId, count] of locationOfShubhaLeads.entries()) {
        const name = userMap.get(assignedId) || (assignedId === 'UNASSIGNED' ? 'Unassigned' : assignedId);
        console.log(`- Assigned to ${name} (${assignedId}): ${count} leads`);
    }
    console.log(`- Not in DB at all (deleted / never imported): ${notInDbCount} leads`);

    // 5. Check if any Shubha leads were moved in recent scripts or have history entries
    console.log('\n--- Checking leads assigned to Shubha in DB ---');
    const shubhaCurrentLeads = allDbLeads.filter(l => l.assigned_to === SHUBHA_ID);
    console.log(`Currently assigned to Shubha in DB: ${shubhaCurrentLeads.length}`);

    // Check pipeline stage breakdown for Shubha
    const shubhaStages = new Map();
    shubhaCurrentLeads.forEach(l => {
        const stage = l.pipeline_stage || l.status || 'No Stage';
        shubhaStages.set(stage, (shubhaStages.get(stage) || 0) + 1);
    });
    console.log('Shubha pipeline stages:');
    for (const [st, cnt] of shubhaStages.entries()) {
        console.log(`  * ${st}: ${cnt}`);
    }

    // 6. Check ALL users in BlueSquare and their original vs current lead counts
    console.log('\n--- Summary of all agents in BlueSquare Infra ---');
    const bsAgents = [
        { name: 'Gunheer', id: 'ac1d3d22-1c96-462f-b2b5-9bc26ada4bab' },
        { name: 'Harman Bajwa', id: '7ce0408f-b03f-4af8-a32d-852b6c22da2a' },
        { name: 'Meghna', id: '399b2252-ebd6-41c6-a70f-c46a005104c5' },
        { name: 'Aashish', id: 'ab87dd53-0bfd-4270-9241-fc84c5a6fd1d' },
        { name: 'Shubha', id: '07db7180-6fac-4055-86ee-8b3748590f56' },
        { name: 'Bhavdeep', id: '59dd14ee-8af1-47fe-bec0-3b2d8914f4fe' },
        { name: 'Simran', id: '7450e6d5-6443-4078-8cbb-0939fc8619ac' },
        { name: 'Munender', id: '17cd53d4-fed6-4d71-87c3-ad69ab052553' },
        { name: 'Rahul Juneja', id: 'a2a09a5e-8a30-4bfa-81f3-53b48a27e8fc' },
        { name: 'Nirvan', id: 'c481c730-c1a5-480c-9fa3-92a923f7e5f1' },
        { name: 'Harpreet', id: '30c660c8-9474-43d1-a935-be93b88f05f0' },
        { name: 'Amish Randev', id: 'd9c567eb-1b2d-43bc-bbbc-33e0b8d05e83' }
    ];

    for (const agent of bsAgents) {
        const currentCount = allDbLeads.filter(l => l.assigned_to === agent.id).length;
        // Count in source files
        let dumpCount = 0;
        for (const [owner, count] of allLeadsByOwner.entries()) {
            if (owner.toLowerCase().includes(agent.name.toLowerCase())) {
                dumpCount += count;
            }
        }
        console.log(`Agent: ${agent.name.padEnd(15)} | Current DB: ${String(currentCount).padStart(5)} | Original Dump (15.5k dump): ${String(dumpCount).padStart(5)}`);
    }
}

analyzeShubha().catch(console.error);
