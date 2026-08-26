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
    if (!digits || digits.length < 5) return digits ? `+${digits}` : '';
    if (digits.length === 10) return `+91${digits}`;
    if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.substring(1)}`;
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
    return `+${digits}`;
}

async function main() {
    const csvPath = 'C:\\Users\\Adrolls\\Downloads\\PROESTATEDATA2026-24-Aug-2026_13_07_32.csv';
    const fileStream = fs.createReadStream(csvPath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let headers: string[] = [];
    let count = 0;
    const phoneSamples: any[] = [];

    for await (const line of rl) {
        if (!line.trim()) continue;
        if (count === 0) {
            headers = parseCsvLine(line).map(h => h.replace(/^"|"$/g, '').trim());
        } else {
            const values = parseCsvLine(line).map(v => v.replace(/^"|"$/g, '').trim());
            const row: Record<string, string> = {};
            headers.forEach((h, idx) => { row[h] = values[idx] || ''; });

            if (count % 300 === 0 || count <= 15) {
                phoneSamples.push({
                    raw: row['Phone'],
                    normalized: normalizePhone(row['Phone']),
                    name: row['Name']
                });
            }
        }
        count++;
    }

    console.log('Sample Normalized Phones:', phoneSamples.slice(0, 20));
}

main().catch(console.error);
