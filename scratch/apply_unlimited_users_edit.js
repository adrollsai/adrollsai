const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'utils', 'subscription-server.ts');
let content = fs.readFileSync(filePath, 'utf8');

const target = `    const UNLIMITED_USERS = [
        'bc63c065-9bcc-4793-bedc-f0960406425b',
        'c890a11f-84ce-4592-ab8f-8682927b1a9d',
        '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2'
    ];`;

content = content.replace(/\r\n/g, '\n');
const normalizedTarget = target.replace(/\r\n/g, '\n');

const replacement = `    const UNLIMITED_USERS = [
        'bc63c065-9bcc-4793-bedc-f0960406425b',
        'c890a11f-84ce-4592-ab8f-8682927b1a9d',
        '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2',
        '29937131-1975-4c5f-9b78-e5b28f918d32' // The ProEstate
    ];`;

if (!content.includes(normalizedTarget)) {
    console.error("❌ Target not found in normalized content!");
    process.exit(1);
}

content = content.replace(normalizedTarget, replacement);
content = content.replace(/\n/g, '\r\n');

fs.writeFileSync(filePath, content, 'utf8');
console.log("✅ UNLIMITED_USERS edit applied successfully!");
