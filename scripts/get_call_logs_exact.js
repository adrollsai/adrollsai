const { execSync } = require('child_process');
const filter = 'resource.type="cloud_run_revision" AND resource.labels.service_name="gemini-voice-bridge"';
const cmd = `gcloud.cmd logging read ${JSON.stringify(filter)} --limit 80 --format="value(timestamp,textPayload)"`;
try {
  const res = execSync(cmd, { encoding: 'utf-8' });
  console.log(res);
} catch (e) {
  console.error(e.message);
}
