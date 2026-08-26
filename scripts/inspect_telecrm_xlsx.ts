import * as XLSX from 'xlsx';

const filePath = 'C:\\Users\\Adrolls\\Downloads\\PROESTATE DATA TELECRM.xlsx';

function main() {
    console.log(`📖 Reading ${filePath}...`);
    const workbook = XLSX.readFile(filePath, { raw: false, cellDates: true });
    
    console.log(`Sheet Names:`, workbook.SheetNames);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    const data: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });

    console.log(`Total Rows Found: ${data.length}`);
    if (data.length > 0) {
        console.log(`\nColumns:`, Object.keys(data[0]));
        console.log(`\nFirst 5 Rows Sample:`);
        data.slice(0, 5).forEach((row, i) => {
            console.log(`\n--- Row ${i + 1} ---`);
            console.log(JSON.stringify(row, null, 2));
        });
    }
}

main();
