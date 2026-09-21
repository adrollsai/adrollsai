import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkSubAccount() {
    const subAuthId = "SA_5USUA60B";
    const subAuthToken = "QaHZT4bjxpUdu1iokTsMXn2xN2X8slvKuox2hy7JKgcZvnlYSg8vaazw7nAIbMjz";

    console.log("Querying Vobiz Sub-Account Recordings...");
    const recRes = await fetch(`https://api.vobiz.ai/api/v1/Account/${subAuthId}/Recording/?limit=20`, {
        headers: {
            'X-Auth-ID': subAuthId,
            'X-Auth-Token': subAuthToken
        }
    });
    console.log("Sub-Account Recordings status:", recRes.status);
    const recData = await recRes.json();
    console.log("Recordings count:", recData.meta?.total_count || recData.objects?.length || 0);
    console.log(JSON.stringify(recData, null, 2));

    console.log("\nQuerying Vobiz Sub-Account Calls...");
    const callRes = await fetch(`https://api.vobiz.ai/api/v1/Account/${subAuthId}/Call/?limit=20`, {
        headers: {
            'X-Auth-ID': subAuthId,
            'X-Auth-Token': subAuthToken
        }
    });
    console.log("Sub-Account Calls status:", callRes.status);
    const callData = await callRes.json();
    console.log("Calls count:", callData.objects?.length || 0);
    for (const c of callData.objects || []) {
        console.log(`Call: To: ${c.to_number || c.to}, Duration: ${c.duration || c.call_duration}, UUID: ${c.call_uuid || c.uuid}`);
    }
}

checkSubAccount().catch(console.error);
