const fs = require('fs');
const path = require('path');

function run() {
    const filePath = path.join(__dirname, '..', 'supabase', 'database.types.ts');
    if (!fs.existsSync(filePath)) {
        console.error("database.types.ts does not exist.");
        return;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    
    const tablesMatch = content.match(/creative_prompts:\s*\{([\s\S]*?)\n      \}/);
    if (!tablesMatch) {
        console.error("Could not find creative_prompts table definition.");
        return;
    }
    console.log("creative_prompts Definition:");
    console.log(tablesMatch[0]);
}

run();
