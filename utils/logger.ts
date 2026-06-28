import path from 'path';
import fs from 'fs';

const LOG_FILE = path.join(process.cwd(), 'launch_debug.log');

export function logToFile(message: string, data?: any) {
    try {
        const timestamp = new Date().toISOString();
        const dataStr = data ? JSON.stringify(data, null, 2) : '';
        const logEntry = `[${timestamp}] ${message}${dataStr ? '\n' + dataStr : ''}\n------------------------------------------------\n`;

        // Log to standard console for cloud environments (Vercel/Next.js)
        console.log(`[META AI] ${message}`, data ? JSON.stringify(data) : '');

        // In local development, also append to launch_debug.log file
        if (!process.env.VERCEL) {
            fs.appendFileSync(LOG_FILE, logEntry, 'utf-8');
        }

    } catch (e) {
        console.error("Logging failed:", e);
    }
}

export function clearLogFile() {
    if (!process.env.VERCEL) {
        try {
            fs.writeFileSync(LOG_FILE, '', 'utf-8');
            console.log("[Logger] Cleared launch_debug.log locally");
        } catch (e) {
            console.error("Failed to clear log file:", e);
        }
    } else {
        console.log("[Logger] Log clearing requested (No-op in production)");
    }
}
