async function getCallDetails() {
  const authId = 'SA_9EVCEZKC';
  const authToken = 'ob4evRjgH4uuqMwKZXo2TqBM13hi2YSEPHMthrMJrKimzLjdirAv00g8xox7rzCv';

  console.log('--- CALL 1: WORKING CALL (10:09 AM IST) ---');
  const res1 = await globalThis.fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Call/f9ed67de-7ef7-40a2-a297-f03a0d69cd69/`, {
    headers: { 'X-Auth-ID': authId, 'X-Auth-Token': authToken }
  });
  console.log(await res1.json());

  console.log('\n--- CALL 2: FAILED CALL (12:46 PM IST) ---');
  const res2 = await globalThis.fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Call/9b6bf94c-fe58-492c-83d3-04ef64cb3554/`, {
    headers: { 'X-Auth-ID': authId, 'X-Auth-Token': authToken }
  });
  console.log(await res2.json());
}

getCallDetails().catch(console.error);
