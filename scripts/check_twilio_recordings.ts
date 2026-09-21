import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function checkTwilio() {
    const sid = process.env.MASTER_TWILIO_SID!;
    const token = process.env.MASTER_TWILIO_TOKEN!;
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');

    console.log("Checking Twilio Calls for Ravi (+919878312154)...");
    const resRavi = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json?To=%2B919878312154`, {
        headers: { 'Authorization': `Basic ${auth}` }
    });
    const dataRavi = await resRavi.json();
    console.log("Ravi Twilio calls count:", dataRavi.calls?.length);
    for (const c of dataRavi.calls || []) {
        console.log(`Ravi Call: SID=${c.sid}, Status=${c.status}, Duration=${c.duration}, Start=${c.start_time}`);
        // Check recordings for this call
        const recRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${c.sid}/Recordings.json`, {
            headers: { 'Authorization': `Basic ${auth}` }
        });
        const recData = await recRes.json();
        console.log(`  Recordings for ${c.sid}:`, recData.recordings?.length);
        for (const r of recData.recordings || []) {
            console.log(`    Recording SID=${r.sid}, Duration=${r.duration}s, URI=${r.uri}`);
        }
    }

    console.log("\nChecking Twilio Calls for Vinita (+919781400346)...");
    const resVinita = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json?To=%2B919781400346`, {
        headers: { 'Authorization': `Basic ${auth}` }
    });
    const dataVinita = await resVinita.json();
    console.log("Vinita Twilio calls count:", dataVinita.calls?.length);
    for (const c of dataVinita.calls || []) {
        console.log(`Vinita Call: SID=${c.sid}, Status=${c.status}, Duration=${c.duration}, Start=${c.start_time}`);
        const recRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${c.sid}/Recordings.json`, {
            headers: { 'Authorization': `Basic ${auth}` }
        });
        const recData = await recRes.json();
        console.log(`  Recordings for ${c.sid}:`, recData.recordings?.length);
        for (const r of recData.recordings || []) {
            console.log(`    Recording SID=${r.sid}, Duration=${r.duration}s, URI=${r.uri}`);
        }
    }
}

checkTwilio().catch(console.error);
