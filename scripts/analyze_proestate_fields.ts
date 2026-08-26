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
    let rowCount = 0;
    const statuses = new Set<string>();
    const assignees = new Set<string>();
    const projectNames = new Set<string>();
    const remarks = new Set<string>();
    const batchNames = new Set<string>();

    for await (const line of rl) {
        if (!line.trim()) continue;
        if (rowCount === 0) {
            headers = parseCsvLine(line).map(h => h.replace(/^"|"$/g, '').trim());
        } else {
            const values = parseCsvLine(line).map(v => v.replace(/^"|"$/g, '').trim());
            const row: Record<string, string> = {};
            headers.forEach((h, idx) => { row[h] = values[idx] || ''; });

            if (row['Status']) statuses.add(row['Status']);
            if (row['Assignee emailid']) assignees.add(`${row['Assignee name']} (${row['Assignee emailid']})`);
            if (row['Project Name']) projectNames.add(row['Project Name']);
            if (row['Remarks']) remarks.add(row['Remarks']);
            if (row['Batch Names']) batchNames.add(row['Batch Names']);
        }
        rowCount++;
    }

    console.log(`📊 Total Records: ${rowCount - 1}`);
    console.log('\n📌 Statuses:', Array.from(statuses));
    console.log('\n👥 Assignees:', Array.from(assignees));
    console.log('\n🏢 Project Name / Budget values:', Array.from(projectNames).slice(0, 20));
    console.log('\n💬 Remarks / Timeline values:', Array.from(remarks).slice(0, 20));
    console.log('\n📦 Batch Names / Campaign sources:', Array.from(batchNames).slice(0, 10));
}

main().catch(console.error);
