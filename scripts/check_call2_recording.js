async function checkRecording() {
  const authId = 'SA_9EVCEZKC';
  const authToken = 'ob4evRjgH4uuqMwKZXo2TqBM13hi2YSEPHMthrMJrKimzLjdirAv00g8xox7rzCv';
  const res = await globalThis.fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Recording/?call_uuid=9b6bf94c-fe58-492c-83d3-04ef64cb3554`, {
    headers: { 'X-Auth-ID': authId, 'X-Auth-Token': authToken }
  });
  console.log(await res.json());
}
checkRecording().catch(console.error);
