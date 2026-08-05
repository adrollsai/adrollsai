const { execSync } = require('child_process');

try {
  const filter = 'resource.type="cloud_run_revision" AND resource.labels.service_name="gemini-voice-bridge"';
  const out = execSync(`gcloud logging read "${filter}" --limit=30 --format=json`, { encoding: 'utf-8' });
  const logs = JSON.parse(out);
  console.log("Recent GCP Logs:\n");
  logs.forEach(l => {
    console.log(`[${l.timestamp}] ${l.textPayload || JSON.stringify(l.jsonPayload)}`);
  });
} catch (e) {
  console.error("Error fetching logs:", e.message);
}
