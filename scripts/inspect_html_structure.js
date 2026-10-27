const fs = require('fs');
const html = fs.readFileSync('scripts/umang_index_dump.html', 'utf8');

console.log('=== HTML STATS ===');
console.log('Length:', html.length);

const imgTags = html.match(/<img[^>]+>/g) || [];
console.log('Total img tags:', imgTags.length);
imgTags.forEach((img, i) => console.log('Img', i, img.slice(0, 150)));

const sections = html.match(/<section[\s\S]*?<\/section>/g) || [];
console.log('\nTotal sections:', sections.length);
sections.forEach((s, i) => {
    const id = (s.match(/id="([^"]+)"/) || [])[1];
    const cls = (s.match(/class="([^"]+)"/) || [])[1];
    const h1 = (s.match(/<h1[\s\S]*?<\/h1>/) || [])[0];
    const h2 = (s.match(/<h2[\s\S]*?<\/h2>/) || [])[0];
    console.log(i, 'id:', id, 'class:', cls, 'heading:', (h1 || h2 || '').replace(/<[^>]+>/g, '').trim().slice(0, 80));
});

// Check forms
const forms = html.match(/<form[\s\S]*?<\/form>/g) || [];
console.log('\nTotal forms:', forms.length);

// Check CSS brand colors
const brandMatch = html.match(/--brand:[^;]+;/);
console.log('\nBrand CSS:', brandMatch ? brandMatch[0] : 'None');
