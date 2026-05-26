const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();

const renderTempDir = path.join(os.tmpdir(), 'adrolls_temp_renders');
if (!fs.existsSync(renderTempDir)) {
    fs.mkdirSync(renderTempDir, { recursive: true });
}

// Enable CORS and serve static files
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

// Log all incoming requests for debugging
app.use((req, res, next) => {
    console.log(`[Static Server] ${req.method} ${req.url} - Headers: ${JSON.stringify(req.headers)}`);
    next();
});

app.use('/static', express.static(renderTempDir));

const PORT = process.env.STATIC_PORT || 8081;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Static Server] Separate process running and listening on port ${PORT}`);
});
