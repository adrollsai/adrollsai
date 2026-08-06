const { execSync } = require('child_process');

function runCmd(cmd) {
  try {
    console.log("RUNNING:", cmd);
    const out = execSync(cmd, { encoding: 'utf8', stdio: 'inherit' });
  } catch (e) {
    console.warn("CMD failed or warning:", e.message);
  }
}

async function updateVercel() {
  const newKie = process.env.KIE_API_KEY;
  const newGemini = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (!newKie || !newGemini) {
    console.error("Missing KIE_API_KEY or GEMINI_API_KEY in environment variables.");
    return;
  }

  console.log("Updating Vercel Environment Variables...");

  // 1. Remove old env vars if existing
  runCmd('vercel env rm KIE_API_KEY production -y');
  runCmd('vercel env rm GEMINI_API_KEY production -y');
  runCmd('vercel env rm GOOGLE_GENERATIVE_AI_API_KEY production -y');

  // 2. Add new env vars
  runCmd(`echo ${newKie} | vercel env add KIE_API_KEY production`);
  runCmd(`echo ${newGemini} | vercel env add GEMINI_API_KEY production`);
  runCmd(`echo ${newGemini} | vercel env add GOOGLE_GENERATIVE_AI_API_KEY production`);

  console.log("Environment variables updated on Vercel!");
}

updateVercel();
