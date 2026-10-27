const { execSync } = require('child_process');
const out = execSync('gcloud.cmd logging read "resource.type=cloud_run_revision AND resource.labels.service_name=gemini-voice-bridge AND timestamp >= \\"2026-10-24T06:12:00Z\\"" --limit=100 --format="value(timestamp,textPayload)"', { encoding: 'utf-8' });
console.log(out || 'No logs...');
