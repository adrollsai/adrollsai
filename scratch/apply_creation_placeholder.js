const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'app', 'dashboard', 'creation', 'page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

const target = `                 {/* Map user's personal reference library creatives */}
                 {userReferences.map(ref => (`;

content = content.replace(/\r\n/g, '\n');
const normalizedTarget = target.replace(/\r\n/g, '\n');

const replacement = `                 {/* Map user's personal reference library creatives */}
                 {userReferences.length === 0 && (
                      <span className="text-[9px] font-bold text-slate-400 border border-dashed border-slate-200 px-3 rounded-2xl h-16 flex items-center justify-center bg-slate-50/50 flex-shrink-0">
                          Library Empty (Manage in Profile)
                      </span>
                 )}
                 {userReferences.map(ref => (`;

if (!content.includes(normalizedTarget)) {
    console.error("❌ Target not found in normalized content!");
    process.exit(1);
}

content = content.replace(normalizedTarget, replacement);
content = content.replace(/\n/g, '\r\n');

fs.writeFileSync(filePath, content, 'utf8');
console.log("✅ Placeholder edit applied successfully!");
