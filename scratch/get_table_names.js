const fs = require('fs');
const path = require('path');

function run() {
    const filePath = path.join(__dirname, '..', 'supabase', 'database.types.ts');
    if (!fs.existsSync(filePath)) {
        console.error("database.types.ts does not exist.");
        return;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Look for lines like "      tablename: {" under "    Tables: {"
    const tablesMatch = content.match(/Tables: \{([\s\S]*?)\n    \}/);
    if (!tablesMatch) {
        console.error("Could not find Tables definition.");
        return;
    }
    
    const tablesSection = tablesMatch[1];
    const tableNames = [];
    const lines = tablesSection.split('\n');
    lines.forEach(line => {
        const match = line.match(/^\s+(\w+):\s+\{/);
        if (match) {
            tableNames.push(match[1]);
        }
    });
    
    console.log("Database Tables:");
    tableNames.forEach(t => console.log(`- ${t}`));
}

run();
