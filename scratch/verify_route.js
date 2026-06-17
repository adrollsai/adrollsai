const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'app', 'shared', '[user_id]', '[slug]', 'route.ts');
const content = fs.readFileSync(filePath, 'utf8');

console.log("=== Verifying route.ts content ===");
console.log("File length:", content.length);

const matchIndex = content.indexOf('Fire server-side CAPI PageView event via proxy');
if (matchIndex !== -1) {
    console.log("✅ Found the CAPI PageView proxy script in route.ts!");
    
    // Print lines around the match
    const start = Math.max(0, matchIndex - 300);
    const end = Math.min(content.length, matchIndex + 400);
    console.log("\nSnippet of injected script:\n");
    console.log(content.slice(start, end));
} else {
    console.error("❌ Could not find CAPI PageView proxy script in route.ts!");
}
