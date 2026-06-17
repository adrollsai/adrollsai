const fs = require('fs');
const path = require('path');

const nextPath = path.join(__dirname, '..', '.next');

try {
    if (fs.existsSync(nextPath)) {
        console.log("Removing .next directory...");
        fs.rmSync(nextPath, { recursive: true, force: true });
        console.log("Successfully deleted .next directory!");
    } else {
        console.log(".next directory does not exist.");
    }
} catch (e) {
    console.error("Failed to delete .next directory (it may be locked by a running process):", e.message);
}
