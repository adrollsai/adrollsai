const { execSync } = require('child_process');
try {
  const out = execSync('gcloud.cmd logging read "resource.type=cloud_run_revision AND resource.labels.service_name=gemini-voice-bridge AND timestamp >= \\"2026-10-27T00:00:00Z\\" AND textPayload:\\"interruption\\"" --limit=50 --format="value(timestamp,textPayload)"', { encoding: 'utf-8' });
  console.log(out || 'No interruption');
} catch (e) {
  console.error('Error:', e.message);
}
