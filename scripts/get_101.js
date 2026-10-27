const { execSync } = require('child_process');
const out = execSync('gcloud.cmd logging read "resource.type=cloud_run_revision AND resource.labels.service_name=gemini-voice-bridge AND httpRequest.status=101 AND timestamp >= \\"2026-10-22T04:38:00Z\\" AND timestamp <= \\"2026-10-22T04:42:00Z\\"" --limit=5 --format=json', { encoding: 'utf-8' });
console.log(out);
