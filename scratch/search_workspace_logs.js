const fs = require('fs');
const path = require('path');

function searchLogs(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (file === 'node_modules' || file === '.git' || file === '.next') continue;
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            searchLogs(filePath);
        } else {
            if (file.endsWith('.log') || file.endsWith('.txt') || file.endsWith('.json')) {
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    if (content.includes('c890a11f-84ce-4592-ab8f-8682927b1a9d') || content.includes('1781854790292-videoad')) {
                        console.log(`Found match in file: ${filePath}`);
                        // Print lines that match
                        const lines = content.split('\n');
                        lines.forEach((line, idx) => {
                            if (line.includes('c890a11f-84ce-4592-ab8f-8682927b1a9d') || line.includes('1781854790292-videoad')) {
                                console.log(`  Line ${idx + 1}: ${line.trim().substring(0, 500)}`);
                            }
                        });
                    }
                } catch (e) {
                    // Ignore read errors
                }
            }
        }
    }
}

console.log("=== Searching workspace for logs matching Realty Nation ID ===");
searchLogs('c:\\Users\\Adrolls\\Desktop\\adrolls\\adrollsai');
