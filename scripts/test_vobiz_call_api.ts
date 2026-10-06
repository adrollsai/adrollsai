async function testRecordApi() {
  const subAuthId = 'SA_9EVCEZKC';
  const subAuthToken = 'ob4evRjgH4uuqMwKZXo2TqBM13hi2YSEPHMthrMJrKimzLjdirAv00g8xox7rzCv';
  const callUuid = '66f1cb41-4b82-4969-921e-90fb4e7a72ae';

  console.log('Testing Record API for callUuid:', callUuid);
  const res = await fetch(`https://api.vobiz.ai/api/v1/Account/${subAuthId}/Call/${callUuid}/Record/`, {
    method: 'POST',
    headers: {
      'X-Auth-ID': subAuthId,
      'X-Auth-Token': subAuthToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      file_format: 'mp3',
      time_limit: 600
    })
  });
  console.log('Status:', res.status);
  const data = await res.json().catch(() => ({}));
  console.log('Data:', data);

  // Also test GET Call detail for this call
  const callRes = await fetch(`https://api.vobiz.ai/api/v1/Account/${subAuthId}/Call/${callUuid}/`, {
    headers: {
      'X-Auth-ID': subAuthId,
      'X-Auth-Token': subAuthToken
    }
  });
  console.log('Call Detail Status:', callRes.status);
  const callData = await callRes.json().catch(() => ({}));
  console.log('Call Detail:', callData);
}

testRecordApi();
