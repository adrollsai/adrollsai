const { execSync } = require('child_process');

try {
  const output = execSync('gcloud.cmd logging read "resource.type=cloud_run_revision AND resource.labels.service_name=gemini-voice-bridge" --limit 50 --format="json"', { encoding: 'utf8' });
  const logs = JSON.parse(output);
  console.log("=== GCP LOGS FOR GEMINI VOICE BRIDGE ===");
  logs.forEach(log => {
    if (log.textPayload) console.log(`[${log.timestamp}] ${log.textPayload}`);
    else if (log.jsonPayload) console.log(`[${log.timestamp}]`, JSON.stringify(log.jsonPayload));
  });
} catch (e) {
  console.error("Error fetching logs:", e.message);
}
