async function checkLatestCall() {
  const authId = 'SA_9EVCEZKC';
  const authToken = 'ob4evRjgH4uuqMwKZXo2TqBM13hi2YSEPHMthrMJrKimzLjdirAv00g8xox7rzCv';

  const res = await globalThis.fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Call/?limit=3`, {
    headers: { 'X-Auth-ID': authId, 'X-Auth-Token': authToken }
  });
  const data = await res.json();
  console.log(data.objects?.map(o => ({
    call_uuid: o.call_uuid,
    to: o.to_number,
    state: o.call_state,
    hangup_cause: o.hangup_cause,
    hangup_source: o.hangup_source,
    duration: o.bill_duration,
    answer_time: o.answer_time,
    created_at: o.created_at
  })));
}

checkLatestCall().catch(console.error);
