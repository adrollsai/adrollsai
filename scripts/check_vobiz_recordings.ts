import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

async function main() {
    const subAuthId = 'SA_9EVCEZKC';
    const subAuthToken = 'ob4evRjgH4uuqMwKZXo2TqBM13hi2YSEPHMthrMJrKimzLjdirAv00g8xox7rzCv';

    console.log('--- Checking Sub-Account (SA_9EVCEZKC) Recordings ---');
    const subRes = await fetch(`https://api.vobiz.ai/api/v1/Account/${subAuthId}/Recording/?limit=10`, {
        headers: { 'X-Auth-ID': subAuthId, 'X-Auth-Token': subAuthToken }
    });
    console.log('Sub-account status:', subRes.status);
    const subData = await subRes.json().catch(() => ({}));
    console.log('Sub-account recordings count:', subData?.objects?.length);
    if (subData?.objects?.length > 0) {
        for (const obj of subData.objects) {
            console.log(`- Call: ${obj.call_uuid}, URL: ${obj.recording_url}, duration: ${obj.recording_duration_ms}ms, time: ${obj.add_time}`);
        }
    } else {
        console.log('No recordings found on sub-account:', subData);
    }
}

main().catch(console.error);
