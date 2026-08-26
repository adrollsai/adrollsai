import * as XLSX from 'xlsx';

const filePath = 'C:\\Users\\Adrolls\\Downloads\\PROESTATE DATA TELECRM.xlsx';

function normalizePhone(rawPhone: any): string {
    if (!rawPhone || rawPhone === '-' || rawPhone === '_') return '';
    let str = String(rawPhone).trim();
    
    // Remove decimal if any (e.g. from float)
    if (str.includes('.')) {
        str = str.split('.')[0];
    }
    
    const digits = str.replace(/\D/g, '');
    if (!digits || digits.length < 5) return '';
    if (digits.length === 10) return `+91${digits}`;
    if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.substring(1)}`;
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
    return `+${digits}`;
}

function main() {
    console.log(`📖 Loading ${filePath}...`);
    const workbook = XLSX.readFile(filePath, { raw: true, cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { raw: true, defval: '' });

    console.log(`Total Rows: ${rows.length}`);

    let validPhones = 0;
    let emptyPhones = 0;
    let shortPhones = 0;

    console.log('\nSample 15 normalized phones:');
    rows.slice(0, 15).forEach((r, idx) => {
        const norm = normalizePhone(r['Phone']);
        console.log(`Row ${idx + 1}: Name = "${r['Name']}" | Raw = ${r['Phone']} | Normalized = "${norm}"`);
    });

    rows.forEach(r => {
        const norm = normalizePhone(r['Phone']);
        if (!norm) {
            emptyPhones++;
        } else if (norm.length >= 12) {
            validPhones++;
        } else {
            shortPhones++;
        }
    });

    console.log(`\nPhone Stats:`);
    console.log(`  - Full Valid Phones (10+ digits): ${validPhones}`);
    console.log(`  - Short / Invalid: ${shortPhones}`);
    console.log(`  - Empty: ${emptyPhones}`);
}

main();
