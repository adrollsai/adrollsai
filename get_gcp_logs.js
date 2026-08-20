const { execSync } = require('child_process');

try {
  const filter = 'resource.type=cloud_run_revision';
  const cmd = `gcloud.cmd logging read "${filter}" --limit 50 --format=json`;
  const stdout = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const logs = JSON.parse(stdout);
  console.log(`Fetched ${logs.length} log entries from Cloud Run:`);
  logs.forEach(l => {
    const time = l.timestamp;
    const svc = l.resource?.labels?.service_name || 'unknown';
    const text = l.textPayload || l.jsonPayload?.message || JSON.stringify(l.jsonPayload || l.httpRequest || '');
    console.log(`[${time}] [${svc}] ${text.slice(0, 140)}`);
  });
} catch (e) {
  console.error('Error:', e.message);
}
