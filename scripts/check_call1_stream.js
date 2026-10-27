async function checkCall1() {
  const authId = 'SA_9EVCEZKC';
  const authToken = 'ob4evRjgH4uuqMwKZXo2TqBM13hi2YSEPHMthrMJrKimzLjdirAv00g8xox7rzCv';
  const callUuid = 'f9ed67de-7ef7-40a2-a297-f03a0d69cd69';

  const res = await globalThis.fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Call/${callUuid}/Stream/`, {
    headers: { 'X-Auth-ID': authId, 'X-Auth-Token': authToken }
  });
  console.log(`Call 1 Stream Status ${res.status}:`);
  console.log(await res.text());
}

checkCall1().catch(console.error);
