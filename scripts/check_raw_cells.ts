import * as XLSX from 'xlsx';

const filePath = 'C:\\Users\\Adrolls\\Downloads\\PROESTATE DATA TELECRM.xlsx';

function main() {
    const workbook = XLSX.readFile(filePath, { raw: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    // Check cells B1 to B10 (Phone column is column B)
    for (let r = 1; r <= 15; r++) {
        const cellAddress = `B${r}`;
        const nameAddress = `A${r}`;
        const cell = sheet[cellAddress];
        const nameCell = sheet[nameAddress];
        if (cell) {
            console.log(`Row ${r}: Name = "${nameCell?.v}", Raw v = ${cell.v} (type: ${typeof cell.v}), Formatted w = "${cell.w}", Cell.t = "${cell.t}"`);
        }
    }
}

main();
