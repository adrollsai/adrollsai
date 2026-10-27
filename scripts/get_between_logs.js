const { execSync } = require('child_process');
const out = execSync('gcloud.cmd logging read "resource.type=cloud_run_revision AND resource.labels.service_name=gemini-voice-bridge AND timestamp >= \\"2026-10-22T04:41:00Z\\" AND timestamp <= \\"2026-10-22T07:16:00Z\\"" --limit=50 --format="value(timestamp,textPayload)"', { encoding: 'utf-8' });
console.log(out || 'NO LOGS BETWEEN CALL 1 AND CALL 2!');
