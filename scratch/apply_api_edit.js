const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'app', 'api', 'chat', 'route.ts');
let content = fs.readFileSync(filePath, 'utf8');

const target = `            const { data: refItems, error: refError } = await supabaseAdmin
                .from('reference_creatives')
                .select('url')
                .eq('category', normalizedCategory);`;

content = content.replace(/\r\n/g, '\n');
const normalizedTarget = target.replace(/\r\n/g, '\n');

const replacement = `            const { data: refItems, error: refError } = await supabaseAdmin
                .from('reference_creatives')
                .select('url')
                .eq('category', normalizedCategory)
                .is('user_id', null);`;

if (!content.includes(normalizedTarget)) {
    console.error("❌ Target not found in normalized content!");
    process.exit(1);
}

content = content.replace(normalizedTarget, replacement);
content = content.replace(/\n/g, '\r\n');

fs.writeFileSync(filePath, content, 'utf8');
console.log("✅ API edit applied successfully!");
