const { execSync } = require('child_process');
const out = execSync('gcloud.cmd logging read "resource.type=cloud_run_revision AND resource.labels.service_name=gemini-voice-bridge AND textPayload:\\"Listening on port 8080\\"" --limit=20 --format="value(timestamp,resource.labels.revision_name,textPayload)"', { encoding: 'utf-8' });
console.log(out);
