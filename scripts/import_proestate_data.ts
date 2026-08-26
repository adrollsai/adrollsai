import fs from 'fs';
import readline from 'readline';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PROESTATE_USER_ID = '29937131-1975-4c5f-9b78-e5b28f918d32';

function parseCsvLine(text: string): string[] {
    const result: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
            if (inQuotes && text[i + 1] === '"') {
                cur += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (c === ',' && !inQuotes) {
            result.push(cur.trim());
            cur = '';
        } else {
            cur += c;
        }
    }
    result.push(cur.trim());
    return result;
}

function normalizePhone(rawPhone: string): string {
    if (!rawPhone || rawPhone === '-' || rawPhone === '_') return '';
    let clean = String(rawPhone).trim();
    if (clean.includes('E+') || clean.includes('e+')) {
        const num = Number(clean);
        if (!isNaN(num)) {
            clean = BigInt(Math.round(num)).toString();
        }
    }
    const digits = clean.replace(/\D/g, '');
    if (!digits) return '';
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

function parseDate(dateStr: string, timeStr?: string): string {
    if (!dateStr || dateStr === '_' || dateStr === '-') return new Date().toISOString();
    try {
        // Format: DD-MM-YYYY or DD-MM-YYYY HH:mm:ss
        const parts = dateStr.trim().split(/[-/]/);
        if (parts.length === 3) {
            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            let year = parts[2];
            if (year.length === 2) year = `20${year}`;
            
            const timePart = (timeStr && timeStr !== '_' && timeStr !== '-') ? timeStr.trim() : '12:00:00';
            const isoLike = `${year}-${month}-${day}T${timePart.length === 5 ? timePart + ':00' : timePart}+05:30`;
            const d = new Date(isoLike);
            if (!isNaN(d.getTime())) {
                return d.toISOString();
            }
        }
    } catch (e) {}
    return new Date().toISOString();
}

function formatBudgetValue(val: string): { budget?: string; propertyType?: string } {
    if (!val || val === '_' || val === '-') return {};
    const lower = val.toLowerCase().trim();
    if (lower.includes('cr') || lower.includes('lacs') || lower.includes('crore') || lower.includes('lakh')) {
        const clean = val.replace(/_/g, ' ').replace(/___/g, ' - ').replace(/\bcr\b/gi, 'Cr');
        return { budget: clean };
    }
    if (['residential', 'commercial', 'plots', 'villa', 'kothi', 'farm house'].some(t => lower.includes(t))) {
        const cleanType = val.replace(/_/g, ' ');
        return { propertyType: cleanType };
    }
    return { budget: val.replace(/_/g, ' ') };
}

async function main() {
    console.log(`🚀 Starting ProEstate Leads Import into Nobogent CRM...`);
    console.log(`👤 Target User ID: ${PROESTATE_USER_ID}`);

    const csvPath = 'C:\\Users\\Adrolls\\Downloads\\PROESTATEDATA2026-24-Aug-2026_13_07_32.csv';
    const fileStream = fs.createReadStream(csvPath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let headers: string[] = [];
    let rowCount = 0;
    const leadsToInsert: any[] = [];

    for await (const line of rl) {
        if (!line.trim()) continue;
        if (rowCount === 0) {
            headers = parseCsvLine(line).map(h => h.replace(/^"|"$/g, '').trim());
        } else {
            const values = parseCsvLine(line).map(v => v.replace(/^"|"$/g, '').trim());
            const row: Record<string, string> = {};
            headers.forEach((h, idx) => { row[h] = values[idx] || ''; });

            const name = row['Name'] || 'Lead';
            const phone = normalizePhone(row['Phone']);
            const email = (row['Email'] && row['Email'] !== '_' && row['Email'] !== '-') ? row['Email'].trim() : null;
            const stage = mapStatusToStage(row['Status']);
            const createdAt = parseDate(row['Created On Date'], row['Created On Time']);

            const { budget, propertyType } = formatBudgetValue(row['Project Name']);

            const customFields: Record<string, any> = {
                imported_from: 'TeleCRM',
                original_status: row['Status'] || 'Fresh',
                batch_name: row['Batch Names'] !== '_' ? row['Batch Names'] : undefined,
                telecrm_lead_id: row['Lead id'] || row['Lead Id'] !== '_' ? (row['Lead id'] || row['Lead Id']) : undefined,
                telecrm_link: row['Lead Link'] !== '_' ? row['Lead Link'] : undefined,
            };

            if (row['City'] && row['City'] !== '_' && row['City'] !== '-') customFields.city = row['City'].trim();
            if (row['Alternate Phone'] && row['Alternate Phone'] !== '_' && row['Alternate Phone'] !== '-') {
                customFields.alternate_phone = row['Alternate Phone'].trim();
            }
            if (propertyType) customFields.property_type = propertyType;
            if (row['Remarks'] && ['within_3_months', 'within_a_month', 'immediately'].includes(row['Remarks'].toLowerCase().trim())) {
                customFields.timeline = row['Remarks'].replace(/_/g, ' ').trim();
            }

            let notes = '';
            if (row['Remarks'] && row['Remarks'] !== '_' && row['Remarks'] !== '-') {
                notes = row['Remarks'].trim();
            }
            if (row['Lost Reason'] && row['Lost Reason'] !== '_' && row['Lost Reason'] !== '-') {
                notes = notes ? `${notes} | Lost Reason: ${row['Lost Reason'].trim()}` : `Lost Reason: ${row['Lost Reason'].trim()}`;
            }

            let source = 'TeleCRM Import';
            if (row['Campaign'] && row['Campaign'] !== '_' && row['Campaign'] !== '-') {
                source = row['Campaign'].trim();
            }

            let adName = row['Batch Names'] && row['Batch Names'] !== '_' ? row['Batch Names'].trim() : null;

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
        rowCount++;
    }

    console.log(`📦 Prepared ${leadsToInsert.length} leads for insertion.`);

    // Batch insert into Supabase (batches of 250)
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
}

main().catch(console.error);
