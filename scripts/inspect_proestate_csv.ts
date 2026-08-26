import fs from 'fs';
import readline from 'readline';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

async function main() {
    // 1. Fetch Pro Estate profile
    const { data: profile, error: profErr } = await supabase
        .from('profiles')
        .select('id, email, business_name')
        .or('email.ilike.%proestate%,business_name.ilike.%pro%estate%,email.ilike.%aditijhanjisood%')
        .limit(5);

    console.log('🏢 Found Profiles matching Pro Estate:', profile);

    // 2. Read CSV lines
    const csvPath = 'C:\\Users\\Adrolls\\Downloads\\PROESTATEDATA2026-24-Aug-2026_13_07_32.csv';
    const fileStream = fs.createReadStream(csvPath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let headers: string[] = [];
    let rowCount = 0;
    const sampleRows: any[] = [];

    for await (const line of rl) {
        if (!line.trim()) continue;
        if (rowCount === 0) {
            headers = parseCsvLine(line).map(h => h.replace(/^"|"$/g, '').trim());
            console.log('\n📋 Headers (' + headers.length + ' columns):');
            console.log(headers);
        } else {
            if (rowCount <= 5) {
                const values = parseCsvLine(line).map(v => v.replace(/^"|"$/g, '').trim());
                const rowObj: Record<string, string> = {};
                headers.forEach((h, idx) => {
                    rowObj[h] = values[idx] || '';
                });
                sampleRows.push(rowObj);
            }
        }
        rowCount++;
    }

    console.log(`\n📊 Total Rows in CSV (including header): ${rowCount}`);
    console.log('\n📝 Sample Row 1:');
    console.log(sampleRows[0]);
    console.log('\n📝 Sample Row 2:');
    console.log(sampleRows[1]);
}

main().catch(console.error);
