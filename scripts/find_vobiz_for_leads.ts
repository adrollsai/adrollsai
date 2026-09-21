import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function searchRecordings() {
    const authId = 'MA_HOSGFZ86';
    const authToken = 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';

    let offset = 0;
    const limit = 50;
    let found = [];

    const targetNumbers = ['9878312154', '9781400346'];

    for (let page = 0; page < 4; page++) {
        const url = `https://api.vobiz.ai/api/v1/Account/${authId}/Recording/?limit=${limit}&offset=${offset}`;
        const res = await fetch(url, {
            headers: { 'X-Auth-ID': authId, 'X-Auth-Token': authToken }
        });
        const data = await res.json();
        const recs = data.objects || [];
        if (recs.length === 0) break;

        for (const r of recs) {
            const toNum = String(r.to_number || '');
            for (const target of targetNumbers) {
                if (toNum.includes(target)) {
                    found.push(r);
                }
            }
        }
        offset += limit;
    }

    console.log(`Found ${found.length} recordings matching target numbers!`);
    console.log(JSON.stringify(found, null, 2));
}

searchRecordings().catch(console.error);
