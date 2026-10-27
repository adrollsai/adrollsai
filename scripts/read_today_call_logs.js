const { execSync } = require('child_process');
try {
  const out = execSync('gcloud.cmd logging read "resource.type=cloud_run_revision AND resource.labels.service_name=gemini-voice-bridge AND timestamp >= \\"2026-10-27T09:28:00Z\\"" --limit=400 --format="value(timestamp,textPayload)"', { encoding: 'utf-8' });
  console.log(out || 'No logs...');
} catch (e) {
  console.error('Error:', e.message);
}
