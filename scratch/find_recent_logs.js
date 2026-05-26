const fs = require('fs');
const path = require('path');

function findRecentLogFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (file === 'node_modules' || file === '.git' || file === '.next') continue;
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            findRecentLogFiles(filePath, fileList);
        } else {
            // Check if file is a log, txt or has been modified today (May 26, 2026)
            const modifiedToday = stat.mtime.toDateString() === new Date('2026-05-26').toDateString() || stat.mtime > new Date(Date.now() - 24 * 60 * 60 * 1000);
            if (file.endsWith('.log') || file.endsWith('.txt') || file.endsWith('.json') || modifiedToday) {
                fileList.push({
                    path: filePath,
                    name: file,
                    size: stat.size,
                    modified: stat.mtime
                });
            }
        }
    }
    return fileList;
}

const files = findRecentLogFiles('c:\\Users\\USER\\Desktop\\adrollsai\\adrollsai');
files.sort((a, b) => b.modified - a.modified);

console.log("=== RECENT / LOG / TEXT FILES ===");
files.slice(0, 30).forEach(f => {
    console.log(`- ${f.name} (${f.size} bytes) | Modified: ${f.modified.toISOString()} | Path: ${f.path}`);
});
