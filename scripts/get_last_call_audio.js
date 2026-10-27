const fs = require('fs');
const path = require('path');

const authId = 'MA_HOSGFZ86';
const authToken = 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';
const callUuid = 'cd3e7d74-f3b4-495e-a2e6-61c25e83f933';

async function fetchCallAndRecording() {
  console.log(`Checking Call ${callUuid}...`);

  // 1. Check Call
  const callRes = await fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Call/${callUuid}/`, {
    headers: { 'X-Auth-ID': authId, 'X-Auth-Token': authToken }
  });
  const callData = await callRes.json();
  console.log('Call CDR:', callData);

  // 2. Check Recording
  const recRes = await fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Recording/?call_uuid=${callUuid}`, {
    headers: { 'X-Auth-ID': authId, 'X-Auth-Token': authToken }
  });
  const recData = await recRes.json();
  console.log('Recording by call_uuid:', recData);

  // 3. Check Recent Recordings
  const recentRec = await fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Recording/?limit=5`, {
    headers: { 'X-Auth-ID': authId, 'X-Auth-Token': authToken }
  });
  const recentData = await recentRec.json();
  console.log('Recent Recordings:', recentData);

  // Check subauth ID as well if empty
  const subAuthId = 'SA_9EVCEZKC';
  const subAuthToken = 'ob4evRjgH4uuqMwKZXo2TqBM13hi2YSEPHMthrMJrKimzLjdirAv00g8xox7rzCv';
  const subRec = await fetch(`https://api.vobiz.ai/api/v1/Account/${subAuthId}/Recording/?limit=5`, {
    headers: { 'X-Auth-ID': subAuthId, 'X-Auth-Token': subAuthToken }
  });
  console.log('SubAccount Recent Recordings:', await subRec.json());
}

fetchCallAndRecording().catch(console.error);
