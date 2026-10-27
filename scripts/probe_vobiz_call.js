async function checkVobizSubResources() {
  const authId = 'SA_RUY0ZNCH';
  const authToken = 'kbcjLH5cXccdZkbbgkcucE2L2Jeul0vvXrhRuVQo0YxFQAfbFnQ5bzfReUSqs3oi';
  const callUuid = '5ac38d2a-b6bb-4de7-a5c1-e2dcd46d9ad2';

  const res = await globalThis.fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Call/${callUuid}/`, {
    headers: { 'X-Auth-ID': authId, 'X-Auth-Token': authToken }
  });
  console.log(`Call details: Status ${res.status}`);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

checkVobizSubResources().catch(console.error);
