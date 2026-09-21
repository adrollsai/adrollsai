import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkDates() {
    const authId = 'MA_HOSGFZ86';
    const authToken = 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';

    const url = `https://api.vobiz.ai/api/v1/Account/${authId}/Recording/?limit=10&offset=0`;
    const res = await fetch(url, {
        headers: { 'X-Auth-ID': authId, 'X-Auth-Token': authToken }
    });
    const data = await res.json();
    console.log("Total recordings:", data.meta?.total_count);
    for (const r of data.objects || []) {
        console.log(`Date: ${r.add_time}, To: ${r.to_number}, Duration: ${r.recording_duration_ms}ms, URL: ${r.recording_url}`);
    }
}

checkDates().catch(console.error);
