const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envConfig = dotenv.parse(fs.readFileSync(path.join(__dirname, '.env.local')));
process.env.AWS_ACCESS_KEY_ID = envConfig.REMOTION_AWS_ACCESS_KEY_ID || envConfig.AWS_ACCESS_KEY_ID;
process.env.AWS_SECRET_ACCESS_KEY = envConfig.REMOTION_AWS_SECRET_ACCESS_KEY || envConfig.AWS_SECRET_ACCESS_KEY;
process.env.REMOTION_AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
process.env.REMOTION_AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;

console.log('AWS_ACCESS_KEY_ID set:', !!process.env.AWS_ACCESS_KEY_ID);
console.log('AWS_SECRET_ACCESS_KEY set:', !!process.env.AWS_SECRET_ACCESS_KEY);

try {
    console.log('Deploying Remotion site to Lambda...');
    const output = execSync(
        'npx remotion lambda sites create remotion/index.ts --site-name=nobogent-site',
        { env: process.env, stdio: 'pipe', cwd: __dirname }
    ).toString();
    console.log(output);
    console.log('SUCCESS: Remotion site deployed!');
} catch (err) {
    console.error('Deploy failed:', err.stdout?.toString() || err.message);
    process.exit(1);
}
