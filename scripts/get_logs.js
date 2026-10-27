const { execSync } = require('child_process');
const out = execSync('gcloud.cmd logging read "resource.type=cloud_run_revision AND resource.labels.service_name=gemini-voice-bridge AND timestamp >= \\"2026-10-22T07:16:10Z\\" AND timestamp <= \\"2026-10-22T07:16:40Z\\"" --limit=200 --format=json', { encoding: 'utf-8' });
const logs = JSON.parse(out);
console.log(`Found ${logs.length} entries`);
logs.forEach(l => {
  const msg = l.textPayload || l.jsonPayload?.message || JSON.stringify(l.jsonPayload) || '';
  console.log(`${l.timestamp} [${l.severity}]: ${msg.slice(0, 150)}`);
});
