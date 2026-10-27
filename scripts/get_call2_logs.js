const { execSync } = require('child_process');
const out = execSync('gcloud.cmd logging read "resource.type=cloud_run_revision AND resource.labels.service_name=gemini-voice-bridge AND timestamp >= \\"2026-10-22T07:16:00Z\\" AND timestamp <= \\"2026-10-22T07:22:00Z\\"" --limit=200 --format="value(timestamp,textPayload,httpRequest.status)"', { encoding: 'utf-8' });
console.log(out);
