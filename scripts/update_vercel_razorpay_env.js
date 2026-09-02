require('dotenv').config({ path: '.env.local' });

const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const PROJECT_ID = process.env.VERCEL_PROJECT_ID;
const TEAM_ID = process.env.VERCEL_TEAM_ID;

const envVars = [
  { key: 'RAZORPAY_KEY_ID', value: 'rzp_live_TX4Rt0xaHogQnv' },
  { key: 'RAZORPAY_KEY_SECRET', value: 'KEUypRyeFBzuxb9xkfNU1GOe' },
  { key: 'NEXT_PUBLIC_RAZORPAY_KEY_ID', value: 'rzp_live_TX4Rt0xaHogQnv' },
  { key: 'RAZORPAY_WEBHOOK_SECRET', value: 'rzp_webhook_nobogent_secret' },
  { key: 'RAZORPAY_ENV', value: 'production' }
];

async function updateVercelEnv() {
  console.log("Fetching existing Vercel environment variables...");
  const teamParam = TEAM_ID ? `&teamId=${TEAM_ID}` : '';
  const listUrl = `https://api.vercel.com/v10/projects/${PROJECT_ID}/env?decrypt=true${teamParam}`;

  const listRes = await fetch(listUrl, {
    headers: {
      Authorization: `Bearer ${VERCEL_TOKEN}`
    }
  });

  const listData = await listRes.json();
  const existingEnvs = listData.envs || [];
  console.log(`Found ${existingEnvs.length} existing env vars on Vercel.`);

  for (const env of envVars) {
    const matched = existingEnvs.filter(e => e.key === env.key);
    for (const m of matched) {
      console.log(`Deleting existing ${env.key} (${m.id})...`);
      await fetch(`https://api.vercel.com/v10/projects/${PROJECT_ID}/env/${m.id}?${teamParam}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${VERCEL_TOKEN}` }
      });
    }

    console.log(`Adding ${env.key} to production, preview, development on Vercel...`);
    const createRes = await fetch(`https://api.vercel.com/v10/projects/${PROJECT_ID}/env?${teamParam}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        key: env.key,
        value: env.value,
        type: 'plain',
        target: ['production', 'preview', 'development']
      })
    });

    const createData = await createRes.json();
    if (createData.error) {
      console.error(`Error adding ${env.key}:`, createData.error);
    } else {
      console.log(`✅ Successfully added ${env.key} to Vercel!`);
    }
  }

  console.log("\n🎉 All Razorpay Live environment variables updated on Vercel!");
}

updateVercelEnv();
