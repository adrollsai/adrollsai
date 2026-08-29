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

async function fullAudit() {
    console.log('====================================================');
    console.log('🔍 COMPLETE AUDIT OF BLUESQUARE INFRA & ALL LEADS');
    console.log('====================================================\n');

    // 1. Fetch all profiles
    const { data: profiles } = await supabase.from('profiles').select('*');
    const profileMap = new Map();
    profiles?.forEach(p => profileMap.set(p.id, p));

    // 2. Fetch ALL leads in the database across ALL user_ids
    let allLeads: any[] = [];
    let from = 0;
    while (true) {
        const { data, error } = await supabase
            .from('leads')
            .select('id, name, phone, email, assigned_to, user_id, status, pipeline_stage, created_at, custom_fields')
            .range(from, from + 999);

        if (error || !data || data.length === 0) break;
        allLeads.push(...data);
        if (data.length < 1000) break;
        from += 1000;
    }

    console.log(`Total Leads across entire Supabase database: ${allLeads.length}\n`);

    // Group by user_id
    const byUserId = new Map();
    allLeads.forEach(l => {
        const u = l.user_id || 'NULL_USER_ID';
        byUserId.set(u, (byUserId.get(u) || 0) + 1);
    });

    console.log('--- LEADS COUNT BY user_id (Account Owner) ---');
    for (const [uid, count] of byUserId.entries()) {
        const p = profileMap.get(uid);
        const name = p ? (p.name || p.full_name || p.email) : (uid === 'NULL_USER_ID' ? 'No user_id' : uid);
        console.log(`- ${name} (${uid}): ${count} leads`);
    }

    // BlueSquare workspace leads (user_id === BLUESQUARE_ID)
    const bsLeads = allLeads.filter(l => l.user_id === BLUESQUARE_ID);
    console.log(`\n--- BLUESQUARE INFRA (user_id = ${BLUESQUARE_ID}): ${bsLeads.length} leads ---`);

    // Breakdown by assigned_to
    const bsByAssigned = new Map();
    bsLeads.forEach(l => {
        const a = l.assigned_to || 'UNASSIGNED';
        bsByAssigned.set(a, (bsByAssigned.get(a) || 0) + 1);
    });

    console.log('\n--- LEADS ASSIGNMENT IN BLUESQUARE ---');
    for (const [aid, count] of bsByAssigned.entries()) {
        const p = profileMap.get(aid);
        const name = p ? (p.name || p.full_name || p.email) : aid;
        console.log(`- ${name} (${aid}): ${count} leads`);
    }

    // 3. Compare with Original 15.5k Dump
    const dataDir = 'C:\\Users\\Adrolls\\Downloads\\data';
    const sourceFiles = [
        path.join(dataDir, 'ALL Leads 1-6000.xlsx'),
        path.join(dataDir, 'ALL Leads 6001-12000.xlsx'),
        path.join(dataDir, 'ALL Leads 12001-15591.xlsx')
    ];

    const dumpLeads: any[] = [];
    const dumpByOwner = new Map();
    const dumpPhoneMap = new Map();

    sourceFiles.forEach(file => {
        if (fs.existsSync(file)) {
            const wb = XLSX.readFile(file);
            const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
            rows.forEach(r => {
                const owner = String(r['Lead Owner'] || r['Owner'] || 'Unknown').trim();
                const rawPhone = String(r['Contacts'] || r['Phone'] || '').replace(/\D/g, '').slice(-10);
                dumpByOwner.set(owner, (dumpByOwner.get(owner) || 0) + 1);
                if (rawPhone.length >= 7) {
                    dumpPhoneMap.set(rawPhone, { ...r, owner });
                }
                dumpLeads.push(r);
            });
        }
    });

    console.log('\n====================================================');
    console.log('📊 COMPARISON: ORIGINAL SOURCE DUMP VS CURRENT CRM');
    console.log('====================================================');
    console.log(`Total rows in 15.5k dump files: ${dumpLeads.length}`);
    console.log(`Total unique phone numbers in dump: ${dumpPhoneMap.size}`);

    // Map BlueSquare agents to their dump name
    const agentsMapping = [
        { name: 'Shubha Baweja Gulati', dumpKey: 'shubha', id: '07db7180-6fac-4055-86ee-8b3748590f56' },
        { name: 'Bhavdeep Singh', dumpKey: 'bhavdeep', id: '59dd14ee-8af1-47fe-bec0-3b2d8914f4fe' },
        { name: 'Harman Bajwa', dumpKey: 'harman', id: '7ce0408f-b03f-4af8-a32d-852b6c22da2a' },
        { name: 'Meghna', dumpKey: 'meghna', id: '399b2252-ebd6-41c6-a70f-c46a005104c5' },
        { name: 'Aashish', dumpKey: 'aashish', id: 'ab87dd53-0bfd-4270-9241-fc84c5a6fd1d' },
        { name: 'Simran', dumpKey: 'simran', id: '7450e6d5-6443-4078-8cbb-0939fc8619ac' },
        { name: 'Munender', dumpKey: 'munender', id: '17cd53d4-fed6-4d71-87c3-ad69ab052553' },
        { name: 'Rahul Juneja', dumpKey: 'rahul', id: 'a2a09a5e-8a30-4bfa-81f3-53b48a27e8fc' },
        { name: 'Nirvan', dumpKey: 'nirvan', id: 'c481c730-c1a5-480c-9fa3-92a923f7e5f1' },
        { name: 'Harpreet', dumpKey: 'harpreet', id: '30c660c8-9474-43d1-a935-be93b88f05f0' },
        { name: 'Gunheer', dumpKey: 'gunheer', id: 'ac1d3d22-1c96-462f-b2b5-9bc26ada4bab' }
    ];

    // For each agent, analyze where their dump leads are right now in DB
    const dbPhoneMap = new Map();
    bsLeads.forEach(l => {
        const p = String(l.phone || '').replace(/\D/g, '').slice(-10);
        if (p.length >= 7) dbPhoneMap.set(p, l);
    });

    console.log('\n--- DETAILED BREAKDOWN PER AGENT ---');
    for (const agent of agentsMapping) {
        // Find all dump leads for this agent
        const agentDumpLeads = Array.from(dumpPhoneMap.values()).filter(d => 
            d.owner.toLowerCase().includes(agent.dumpKey)
        );

        let correctlyAssigned = 0;
        let assignedToGunheer = 0;
        let assignedToOther = new Map();
        let unassigned = 0;
        let notInDb = 0;

        agentDumpLeads.forEach(d => {
            const p = String(d['Contacts'] || d['Phone'] || '').replace(/\D/g, '').slice(-10);
            const dbLead = dbPhoneMap.get(p);
            if (!dbLead) {
                notInDb++;
            } else if (dbLead.assigned_to === agent.id) {
                correctlyAssigned++;
            } else if (dbLead.assigned_to === 'ac1d3d22-1c96-462f-b2b5-9bc26ada4bab') {
                assignedToGunheer++;
            } else if (!dbLead.assigned_to) {
                unassigned++;
            } else {
                const otherP = profileMap.get(dbLead.assigned_to);
                const otherName = otherP ? (otherP.name || otherP.full_name) : dbLead.assigned_to;
                assignedToOther.set(otherName, (assignedToOther.get(otherName) || 0) + 1);
            }
        });

        const currentTotalInDb = bsLeads.filter(l => l.assigned_to === agent.id).length;

        console.log(`\n👤 [${agent.name}]`);
        console.log(`  - Original in Dump: ${agentDumpLeads.length}`);
        console.log(`  - Current in DB: ${currentTotalInDb}`);
        console.log(`  - Where Dump leads ended up:`);
        console.log(`      * Correctly on ${agent.name}: ${correctlyAssigned}`);
        console.log(`      * Diverted to Gunheer: ${assignedToGunheer}`);
        console.log(`      * Unassigned: ${unassigned}`);
        console.log(`      * Not in DB: ${notInDb}`);
        if (assignedToOther.size > 0) {
            for (const [oName, oCount] of assignedToOther.entries()) {
                console.log(`      * Diverted to ${oName}: ${oCount}`);
            }
        }
    }
}

fullAudit().catch(console.error);
