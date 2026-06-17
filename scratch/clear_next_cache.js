const fs = require('fs');
const path = require('path');

const nextCachePath = path.join(__dirname, '..', '.next', 'dev', 'cache');
try {
    if (fs.existsSync(nextCachePath)) {
        console.log("Removing .next/dev/cache...");
        fs.rmSync(nextCachePath, { recursive: true, force: true });
        console.log("Successfully cleared .next/dev/cache!");
    } else {
        console.log(".next/dev/cache does not exist.");
    }
} catch (e) {
    console.error("Failed to delete .next/dev/cache:", e.message);
}

const nextServerPath = path.join(__dirname, '..', '.next', 'dev', 'server');
try {
    if (fs.existsSync(nextServerPath)) {
        console.log("Removing .next/dev/server...");
        fs.rmSync(nextServerPath, { recursive: true, force: true });
        console.log("Successfully cleared .next/dev/server!");
    } else {
        console.log(".next/dev/server does not exist.");
    }
} catch (e) {
    console.error("Failed to delete .next/dev/server:", e.message);
}
