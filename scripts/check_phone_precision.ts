import fs from 'fs';
import readline from 'readline';

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
    const csvPath = 'C:\\Users\\Adrolls\\Downloads\\PROESTATEDATA2026-24-Aug-2026_13_07_32.csv';
    const fileStream = fs.createReadStream(csvPath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let headers: string[] = [];
    let count = 0;
    let nonScientificPhoneCount = 0;
    let alternatePhoneCount = 0;

    for await (const line of rl) {
        if (!line.trim()) continue;
        if (count === 0) {
            headers = parseCsvLine(line).map(h => h.replace(/^"|"$/g, '').trim());
        } else {
            const values = parseCsvLine(line).map(v => v.replace(/^"|"$/g, '').trim());
            const row: Record<string, string> = {};
            headers.forEach((h, idx) => { row[h] = values[idx] || ''; });

            if (row['Phone'] && !row['Phone'].includes('E+') && !row['Phone'].includes('e+')) {
                nonScientificPhoneCount++;
            }
            if (row['Alternate Phone'] && row['Alternate Phone'] !== '_' && row['Alternate Phone'] !== '-') {
                alternatePhoneCount++;
            }
        }
        count++;
    }

    console.log(`Total rows: ${count - 1}`);
    console.log(`Non-scientific phones: ${nonScientificPhoneCount}`);
    console.log(`Alternate phones present: ${alternatePhoneCount}`);
}

main().catch(console.error);
