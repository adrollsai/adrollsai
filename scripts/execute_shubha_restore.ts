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

// Excluded agents
const EXCLUDED_USER_IDS = new Set([
    '7450e6d5-6443-4078-8cbb-0939fc8619ac', // Simran
    '17cd53d4-fed6-4d71-87c3-ad69ab052553', // Munender
    'c481c730-c1a5-480c-9fa3-92a923f7e5f1'  // Nirvan
]);

const STAGE_MAP: Record<string, string> = {
    'new lead': 'New Lead',
    'requirement taken': 'Requirement Taken',
    'visit planned': 'Visit Planned',
    'visit done': 'Visit Done',
    'revisit done': 'Revisit Done',
    'meeting planned': 'Meeting Planned',
    'meeting done': 'Meeting Done',
    'never picked': 'Never Picked',
    'negotiation': 'Negotiation',
    'deal/token': 'Deal/Token',
    'dealer': 'Dealer',
    'plan postponed': 'Plan Postponed',
    'already purchased': 'Already Purchased',
    'lost/ni': 'Lost/NI',
};

function cleanPhone(raw: any): string | null {
    if (!raw) return null;
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length < 7) return null;
    return digits.slice(-10);
}

function parseDate(dateStr: any): string | null {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const str = dateStr.trim();
    if (!str) return null;
    const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)/i);
    if (!match) return null;
    const [, day, month, year, hourRaw, minute, ampm] = match;
    let hour = parseInt(hourRaw);
    if (ampm.toLowerCase() === 'pm' && hour !== 12) hour += 12;
    if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;
    const isoStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${String(hour).padStart(2, '0')}:${minute}:00+05:30`;
    try {
        const dt = new Date(isoStr);
        return isNaN(dt.getTime()) ? null : dt.toISOString();
    } catch { return null; }
}

async function restoreShubhaLeads() {
    console.log('================================================================');
    console.log('🚀 SAFE RESTORATION OF SHUBHA BAWEJA GULATI LEADS');
    console.log('================================================================\n');

    // Step 1: Read master source files for Shubha
    const shubhaFile = 'C:\\Users\\Adrolls\\Downloads\\shubha_leads.xlsx';
    if (!fs.existsSync(shubhaFile)) {
        throw new Error(`Master file not found: ${shubhaFile}`);
    }

    const wb = XLSX.readFile(shubhaFile);
    const shubhaRows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    console.log(`Loaded ${shubhaRows.length} rows from shubha_leads.xlsx`);

    const shubhaSourceMap = new Map<string, any>();
    shubhaRows.forEach(r => {
        const p = cleanPhone(r['Contacts'] || r['Phone']);
        if (p) {
            shubhaSourceMap.set(p, r);
        }
    });
    console.log(`Unique phone numbers for Shubha: ${shubhaSourceMap.size}`);

    // Step 2: Fetch ALL BlueSquare leads from DB
    console.log('\nFetching all leads from Supabase for BlueSquare Infra...');
    let allDbLeads: any[] = [];
    let from = 0;
    while (true) {
        const { data, error } = await supabase
            .from('leads')
            .select('id, name, phone, email, assigned_to, user_id, status, pipeline_stage, notes, custom_fields, next_followup, created_at')
            .eq('user_id', BLUESQUARE_ID)
            .range(from, from + 999);

        if (error) throw error;
        if (!data || data.length === 0) break;
        allDbLeads.push(...data);
        if (data.length < 1000) break;
        from += 1000;
    }
    console.log(`Total BlueSquare leads in DB: ${allDbLeads.length}`);

    // Index DB leads by phone
    const dbPhoneMap = new Map<string, any>();
    allDbLeads.forEach(l => {
        const p = cleanPhone(l.phone);
        if (p) dbPhoneMap.set(p, l);
    });

    // Step 3: Identify displaced leads belonging to Shubha
    const leadsToRestore: any[] = [];
    const leadsAlreadyCorrect: any[] = [];
    let notInDbCount = 0;

    for (const [phone, sourceRow] of shubhaSourceMap.entries()) {
        const dbLead = dbPhoneMap.get(phone);
        if (!dbLead) {
            notInDbCount++;
            continue;
        }

        if (dbLead.assigned_to === SHUBHA_ID) {
            leadsAlreadyCorrect.push(dbLead);
            continue;
        }

        // Check if lead belongs to excluded agents (Simran, Munender, Nirvan) - do not touch if assigned to them
        if (EXCLUDED_USER_IDS.has(dbLead.assigned_to)) {
            console.log(`Skipping lead ${dbLead.id} (${dbLead.name}) currently assigned to excluded agent ${dbLead.assigned_to}`);
            continue;
        }

        // Determine stage & notes restoration logic
        const rawStatus = (sourceRow['Lead Status'] || '').trim().toLowerCase();
        const mappedExcelStage = STAGE_MAP[rawStatus] || sourceRow['Lead Status'] || 'New Lead';
        const lastRemarks = (sourceRow['Last Remarks'] || '').trim();
        const nextFollowupDate = parseDate(sourceRow['Next Followup Date']);
        const openingRemarks = (sourceRow['Openning Remarks'] || '').trim();

        // Check if DB stage is generic or needs restoring
        const currentDbStage = dbLead.pipeline_stage || dbLead.status || 'New Lead';
        // If current stage is 'New' or 'New Lead' and excel has specific stage like 'Requirement Taken', 'Lost/NI', restore it
        const shouldUpdateStage = (currentDbStage === 'New Lead' || currentDbStage === 'New') && mappedExcelStage !== 'New Lead';
        const finalStage = shouldUpdateStage ? mappedExcelStage : currentDbStage;

        leadsToRestore.push({
            id: dbLead.id,
            name: dbLead.name,
            phone: dbLead.phone,
            previous_assigned_to: dbLead.assigned_to,
            previous_pipeline_stage: dbLead.pipeline_stage,
            previous_status: dbLead.status,
            previous_notes: dbLead.notes,
            previous_next_followup: dbLead.next_followup,
            target_assigned_to: SHUBHA_ID,
            target_pipeline_stage: finalStage,
            target_status: finalStage,
            excel_status: mappedExcelStage,
            excel_remarks: lastRemarks,
            excel_next_followup: nextFollowupDate
        });
    }

    console.log(`\n--- Restoration Candidates Summary ---`);
    console.log(`Leads already correctly assigned to Shubha: ${leadsAlreadyCorrect.length}`);
    console.log(`Displaced leads to be restored to Shubha: ${leadsToRestore.length}`);
    console.log(`Leads in Excel but not in DB: ${notInDbCount}`);

    // Breakdown of where these leads are currently sitting
    const fromSources = new Map<string, number>();
    leadsToRestore.forEach(l => {
        const from = l.previous_assigned_to === GUNHEER_ID ? 'Gunheer' : (l.previous_assigned_to ? l.previous_assigned_to : 'UNASSIGNED');
        fromSources.set(from, (fromSources.get(from) || 0) + 1);
    });

    console.log('\nSources of leads being restored:');
    for (const [src, count] of fromSources.entries()) {
        console.log(`  - From ${src}: ${count} leads`);
    }

    if (leadsToRestore.length === 0) {
        console.log('\nNo displaced leads found to restore.');
        return;
    }

    // Step 4: Create Complete Backup File for Instant Revert Switch
    const backupDir = path.join(process.cwd(), 'scripts', 'backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupFilePath = path.join(backupDir, 'shubha_leads_backup_20260826.json');
    fs.writeFileSync(backupFilePath, JSON.stringify({
        timestamp: new Date().toISOString(),
        total_restored: leadsToRestore.length,
        leads: leadsToRestore
    }, null, 2));

    console.log(`\n💾 Backup saved successfully at: ${backupFilePath}`);
    console.log(`🔄 Revert script ready at: scripts/revert_shubha_restoration.js`);

    // Step 5: Execute Batch Updates to Supabase
    console.log('\n⚡ Executing Safe Database Updates...');
    const BATCH_SIZE = 100;
    let updatedCount = 0;

    for (let i = 0; i < leadsToRestore.length; i += BATCH_SIZE) {
        const chunk = leadsToRestore.slice(i, i + BATCH_SIZE);
        
        for (const item of chunk) {
            const updatePayload: any = {
                assigned_to: SHUBHA_ID,
                pipeline_stage: item.target_pipeline_stage,
                status: item.target_status
            };

            const { error: updErr } = await supabase
                .from('leads')
                .update(updatePayload)
                .eq('id', item.id);

            if (updErr) {
                console.error(`Error updating lead ${item.id}:`, updErr.message);
            } else {
                updatedCount++;
            }
        }
        process.stdout.write(`\r⏳ Restoring progress: ${updatedCount}/${leadsToRestore.length} (${Math.round((updatedCount / leadsToRestore.length) * 100)}%)...`);
    }

    console.log(`\n\n✅ RESTORATION COMPLETE!`);
    console.log(`Successfully restored ${updatedCount} leads back to Shubha Baweja Gulati!`);

    // Step 6: Verify final counts
    const { count: finalShubhaCount } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', BLUESQUARE_ID)
        .eq('assigned_to', SHUBHA_ID);

    const { count: finalGunheerCount } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', BLUESQUARE_ID)
        .eq('assigned_to', GUNHEER_ID);

    console.log('\n--- VERIFIED POST-RESTORATION COUNTS ---');
    console.log(`👤 Shubha Total Assigned Leads: ${finalShubhaCount}`);
    console.log(`👤 Gunheer Total Assigned Leads: ${finalGunheerCount}`);
}

restoreShubhaLeads().catch(console.error);
