import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkVobiz() {
    const authId = 'MA_HOSGFZ86';
    const authToken = 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';

    console.log('Querying Vobiz Recordings list...');
    try {
        const res = await fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Recording/?limit=20`, {
            headers: {
                'X-Auth-ID': authId,
                'X-Auth-Token': authToken
            }
        });
        console.log('Vobiz Recordings response status:', res.status);
        const data = await res.json();
        console.log('Recordings count:', data.objects?.length || data.recordings?.length || 0);
        console.log(JSON.stringify(data, null, 2).slice(0, 2000));
    } catch (e: any) {
        console.error('Vobiz recordings error:', e.message);
    }

    console.log('\nQuerying Vobiz Calls list...');
    try {
        const res = await fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Call/?limit=20`, {
            headers: {
                'X-Auth-ID': authId,
                'X-Auth-Token': authToken
            }
        });
        console.log('Vobiz Calls response status:', res.status);
        const data = await res.json();
        console.log('Calls count:', data.objects?.length || data.calls?.length || 0);
        const calls = data.objects || data.calls || [];
        for (const c of calls.slice(0, 10)) {
            console.log(`Call: To: ${c.to}, From: ${c.from}, UUID: ${c.call_uuid || c.uuid}, Status: ${c.call_status || c.status}, Rec: ${c.recording_url || c.record_url || 'NONE'}`);
        }
    } catch (e: any) {
        console.error('Vobiz calls error:', e.message);
    }
}

checkVobiz().catch(console.error);
