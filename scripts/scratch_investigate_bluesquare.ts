import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function investigate() {
    console.log('=== INVESTIGATION REPORT FOR BLUESQUARE INFRA ===\n');

    // 1. Get BlueSquare org / profile / users
    const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('*');

    if (pErr) console.error('Profiles error:', pErr);

    console.log('--- ALL PROFILES ---');
    const userMap = new Map();
    profiles?.forEach(p => {
        userMap.set(p.id, p);
        console.log(`User ID: ${p.id} | Email: ${p.email} | Name: ${p.name || p.full_name} | Role: ${p.role} | Org: ${p.organization || p.company_name || p.user_id}`);
    });

    // 2. Look for Bluesquare Infra team members
    const BLUESQUARE_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
    console.log(`\n--- BlueSquare Org ID (${BLUESQUARE_ID}) ---`);

    // 3. Count leads per assigned_to in BlueSquare
    let allBsLeads = [];
    let from = 0;
    while (true) {
        const { data, error } = await supabase
            .from('leads')
            .select('id, name, phone, email, assigned_to, user_id, status, pipeline_stage, created_at, custom_fields')
            .eq('user_id', BLUESQUARE_ID)
            .range(from, from + 999);

        if (error || !data || data.length === 0) break;
        allBsLeads.push(...data);
        if (data.length < 1000) break;
        from += 1000;
    }

    console.log(`Total leads in DB with user_id = BLUESQUARE_ID: ${allBsLeads.length}`);

    // Breakdown by assigned_to
    const assignedCounts = new Map();
    allBsLeads.forEach(l => {
        const a = l.assigned_to || 'UNASSIGNED';
        assignedCounts.set(a, (assignedCounts.get(a) || 0) + 1);
    });

    console.log('\n--- Leads breakdown by assigned_to in BlueSquare ---');
    for (const [assignedId, count] of assignedCounts.entries()) {
        const prof = userMap.get(assignedId);
        const name = prof ? (prof.name || prof.full_name || prof.email) : 'Unknown/Unassigned';
        console.log(`- ${name} (ID: ${assignedId}): ${count} leads`);
    }

    // 4. Check Harman backup
    const backupPath = path.join(process.cwd(), 'scripts', 'backups', 'harman_leads_backup_20260825.json');
    if (fs.existsSync(backupPath)) {
        const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
        console.log(`\n--- Harman Backup from 2026-08-25 ---`);
        console.log(`Total leads reassigned to Harman on 2026-08-25: ${backup.total_restored}`);
        const prevCounts = new Map();
        backup.leads.forEach((l: any) => {
            const prev = l.previous_assigned_to || 'NULL/UNASSIGNED';
            prevCounts.set(prev, (prevCounts.get(prev) || 0) + 1);
        });
        console.log('Breakdown of who those leads were taken from:');
        for (const [prevId, count] of prevCounts.entries()) {
            const prof = userMap.get(prevId);
            const name = prof ? (prof.name || prof.full_name || prof.email) : (prevId === 'NULL/UNASSIGNED' ? 'Unassigned' : 'Unknown');
            console.log(`  * Taken from ${name} (ID: ${prevId}): ${count} leads`);
        }
    }

    // 5. Check if any leads have user_id set to other user IDs instead of BLUESQUARE_ID
    console.log('\n--- Leads across entire DB grouped by user_id ---');
    const { data: allUsersLeads, error: lErr } = await supabase
        .from('leads')
        .select('user_id');

    if (allUsersLeads) {
        const userLeadCounts = new Map();
        allUsersLeads.forEach(l => {
            userLeadCounts.set(l.user_id, (userLeadCounts.get(l.user_id) || 0) + 1);
        });
        for (const [uId, count] of userLeadCounts.entries()) {
            const prof = userMap.get(uId);
            const name = prof ? (prof.name || prof.full_name || prof.email) : 'Unknown';
            console.log(`- user_id: ${name} (${uId}): ${count} leads`);
        }
    }
}

investigate().catch(console.error);
