import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PROESTATE_USER_ID = '29937131-1975-4c5f-9b78-e5b28f918d32';
const FILE_PATH = 'C:\\Users\\Adrolls\\Downloads\\PROESTATE DATA TELECRM.xlsx';

function normalizePhone(rawPhone: any): string {
    if (!rawPhone || rawPhone === '-' || rawPhone === '_') return '';
    let str = String(rawPhone).trim();
    if (str.includes('.')) str = str.split('.')[0];
    const digits = str.replace(/\D/g, '');
    if (!digits || digits.length < 7) return '';
    if (digits.length === 10) return `+91${digits}`;
    if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.substring(1)}`;
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
    return `+${digits}`;
}

function mapStatusToStage(status: string): string {
    const s = (status || '').toLowerCase().trim();
    if (s === 'fresh') return 'New Lead';
    if (s === 'lost') return 'Lost/NI';
    if (s === 'call unanswered' || s === 'non connect') return 'Never Picked';
    if (s === 'customer asked to call again as busy' || s === 'customer will take time' || s === 'number busy') return 'Plan Postponed';
    if (s === 'interested' || s === 'hot') return 'Requirement Taken';
    if (s.includes('dealer') || s.includes('channel partner')) return 'Dealer';
    if (s === 'site visit scheduled') return 'Visit Planned';
    if (s === 'site visit done') return 'Visit Done';
    return 'New Lead';
}

function parseDate(dateStr: any, timeStr?: any): string {
    if (!dateStr || dateStr === '_' || dateStr === '-') return new Date().toISOString();
    try {
        if (dateStr instanceof Date) {
            return dateStr.toISOString();
        }
        const str = String(dateStr).trim();
        // Check MM/DD/YY or DD-MM-YYYY
        const parts = str.split(/[-/]/);
        if (parts.length === 3) {
            let year = parts[2];
            let month = parts[0];
            let day = parts[1];

            // If parts[0] > 12, it might be DD/MM/YY
            if (parseInt(parts[0], 10) > 12) {
                day = parts[0];
                month = parts[1];
            }

            if (year.length === 2) year = `20${year}`;
            month = month.padStart(2, '0');
            day = day.padStart(2, '0');

            const timePart = (timeStr && timeStr !== '_' && timeStr !== '-') ? String(timeStr).trim() : '12:00:00';
            const isoLike = `${year}-${month}-${day}T${timePart.length === 5 ? timePart + ':00' : timePart}+05:30`;
            const d = new Date(isoLike);
            if (!isNaN(d.getTime())) {
                return d.toISOString();
            }
        }
    } catch (e) {}
    return new Date().toISOString();
}

function formatBudgetValue(val: any): { budget?: string; propertyType?: string } {
    if (!val || val === '_' || val === '-') return {};
    const str = String(val).trim();
    const lower = str.toLowerCase();
    if (lower.includes('cr') || lower.includes('lacs') || lower.includes('crore') || lower.includes('lakh') || lower.includes('above') || lower.includes('under')) {
        const clean = str.replace(/_/g, ' ').replace(/___/g, ' - ').replace(/\bcr\b/gi, 'Cr');
        return { budget: clean };
    }
    if (['residential', 'commercial', 'plots', 'villa', 'kothi', 'farm house'].some(t => lower.includes(t))) {
        const cleanType = str.replace(/_/g, ' ');
        return { propertyType: cleanType };
    }
    return { budget: str.replace(/_/g, ' ') };
}

async function main() {
    console.log(`🚀 Starting Full Clean ProEstate Import from XLSX...`);
    console.log(`📁 Source File: ${FILE_PATH}`);
    console.log(`👤 Target User: ${PROESTATE_USER_ID}`);

    // 1. Clean up any existing TeleCRM imported leads for Pro Estate
    console.log(`\n🧹 Step 1: Cleaning any existing TeleCRM imported leads...`);
    const { data: existingLeads } = await supabase
        .from('leads')
        .select('id, custom_fields, source')
        .eq('user_id', PROESTATE_USER_ID);

    const oldImportIds: string[] = [];
    existingLeads?.forEach(l => {
        const cfStr = typeof l.custom_fields === 'string' ? l.custom_fields : JSON.stringify(l.custom_fields || {});
        if (l.source === 'TeleCRM Import' || cfStr.includes('TeleCRM') || cfStr.includes('telecrm_lead_id')) {
            oldImportIds.push(l.id);
        }
    });

    if (oldImportIds.length > 0) {
        console.log(`Deleting ${oldImportIds.length} old TeleCRM records...`);
        const BATCH = 250;
        for (let i = 0; i < oldImportIds.length; i += BATCH) {
            const batch = oldImportIds.slice(i, i + BATCH);
            await supabase.from('lead_history').delete().in('lead_id', batch);
            await supabase.from('leads').delete().in('id', batch);
        }
        console.log(`✅ Cleaned up old records.`);
    }

    // 2. Read and parse XLSX
    console.log(`\n📖 Step 2: Reading Excel data with raw phone numbers...`);
    const workbook = XLSX.readFile(FILE_PATH, { raw: true, cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { raw: true, defval: '' });

    console.log(`Total rows in Excel sheet: ${rawRows.length}`);

    const leadsToInsert: any[] = [];
    const seenMap = new Set<string>();

    for (const row of rawRows) {
        const name = (row['Name'] || 'Lead').toString().trim();
        const phone = normalizePhone(row['Phone']);
        const emailRaw = row['Email'] ? row['Email'].toString().trim() : '';
        const email = (emailRaw && emailRaw !== '_' && emailRaw !== '-' && emailRaw.includes('@')) ? emailRaw : null;
        const stage = mapStatusToStage(row['Status']);
        const createdAt = parseDate(row['Created On Date'], row['Created On Time']);

        const { budget, propertyType } = formatBudgetValue(row['Project Name']);

        // Deduplication key
        const telecrmId = (row['Lead id'] || row['Lead Id'] || '').toString().trim();
        const dedupKey = telecrmId && telecrmId !== '_' ? `telecrm_${telecrmId}` : (phone ? `phone_${phone}` : (email ? `email_${email}` : `name_${name}_${createdAt}`));

        if (seenMap.has(dedupKey)) {
            continue;
        }
        seenMap.add(dedupKey);

        const customFields: Record<string, any> = {
            imported_from: 'TeleCRM',
            original_status: row['Status'] || 'Fresh',
            batch_name: (row['Batch Names'] && row['Batch Names'] !== '_') ? String(row['Batch Names']).trim() : undefined,
            telecrm_lead_id: telecrmId && telecrmId !== '_' ? telecrmId : undefined,
            telecrm_link: (row['Lead Link'] && row['Lead Link'] !== '_') ? String(row['Lead Link']).trim() : undefined,
            imported_assignee: (row['Assignee name'] && row['Assignee name'] !== '_') ? String(row['Assignee name']).trim() : undefined
        };

        if (row['City'] && row['City'] !== '_' && row['City'] !== '-') customFields.city = String(row['City']).trim();
        if (row['Alternate Phone'] && row['Alternate Phone'] !== '_' && row['Alternate Phone'] !== '-') {
            customFields.alternate_phone = normalizePhone(row['Alternate Phone']) || String(row['Alternate Phone']).trim();
        }
        if (propertyType) customFields.property_type = propertyType;
        
        const remarksStr = row['Remarks'] ? String(row['Remarks']).toLowerCase().trim() : '';
        if (['within_3_months', 'within_a_month', 'immediately'].includes(remarksStr)) {
            customFields.timeline = remarksStr.replace(/_/g, ' ');
        }

        let notes = '';
        if (row['Remarks'] && row['Remarks'] !== '_' && row['Remarks'] !== '-') {
            notes = String(row['Remarks']).trim();
        }
        if (row['Lost Reason'] && row['Lost Reason'] !== '_' && row['Lost Reason'] !== '-') {
            notes = notes ? `${notes} | Lost Reason: ${String(row['Lost Reason']).trim()}` : `Lost Reason: ${String(row['Lost Reason']).trim()}`;
        }

        let source = 'TeleCRM';
        if (row['Campaign'] && row['Campaign'] !== '_' && row['Campaign'] !== '-') {
            source = String(row['Campaign']).trim();
        }

        const adName = (row['Batch Names'] && row['Batch Names'] !== '_') ? String(row['Batch Names']).trim() : null;

        leadsToInsert.push({
            user_id: PROESTATE_USER_ID,
            name: name.slice(0, 100),
            phone: phone || null,
            email: email,
            pipeline_stage: stage,
            status: stage,
            budget: budget || null,
            source: source,
            ad_name: adName,
            notes: notes || null,
            created_at: createdAt,
            facebook_created_at: createdAt,
            custom_fields: customFields
        });
    }

    console.log(`\n📦 Step 3: Prepared ${leadsToInsert.length} unique, verified leads for insertion.`);

    // 3. Batch insert in chunks of 250
    const BATCH_SIZE = 250;
    let insertedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < leadsToInsert.length; i += BATCH_SIZE) {
        const batch = leadsToInsert.slice(i, i + BATCH_SIZE);
        const { data, error } = await supabase.from('leads').insert(batch).select('id');

        if (error) {
            console.error(`❌ Batch insert error at ${i} - ${i + batch.length}:`, error.message);
            failedCount += batch.length;
        } else {
            insertedCount += (data?.length || batch.length);
            const pct = Math.round((insertedCount / leadsToInsert.length) * 100);
            process.stdout.write(`\r⏳ Progress: ${insertedCount}/${leadsToInsert.length} leads inserted (${pct}%)...`);
        }
    }

    console.log(`\n\n🎉 Import Complete!`);
    console.log(`✅ Successfully Inserted: ${insertedCount} leads`);
    if (failedCount > 0) {
        console.log(`⚠️ Failed: ${failedCount} leads`);
    }

    // 4. Verify Total Leads in Account
    const { count: finalTotal } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', PROESTATE_USER_ID);

    console.log(`\n🔒 Total leads now in Pro Estate account: ${finalTotal}`);

    // Show 10 sample imported leads with verified phone numbers
    const { data: sampleLeads } = await supabase
        .from('leads')
        .select('name, phone, email, source, pipeline_stage, created_at')
        .eq('user_id', PROESTATE_USER_ID)
        .order('created_at', { ascending: false })
        .limit(10);

    console.log('\nSample 10 newly imported leads:');
    sampleLeads?.forEach((l, i) => {
        console.log(`  ${i + 1}. ${l.name} | Phone: ${l.phone} | Stage: ${l.pipeline_stage} | Source: ${l.source} | Date: ${l.created_at}`);
    });
}

main().catch(console.error);
