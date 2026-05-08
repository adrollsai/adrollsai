import * as fs from 'fs';
import path from 'path';

const LOG_FILE_PATH = path.join(process.cwd(), 'meta_ads_debug.txt');

export function logToFile(message: string, data?: any) {
    try {
        const timestamp = new Date().toISOString();
        const dataStr = data ? JSON.stringify(data, null, 2) : '';
        const logEntry = `\n[${timestamp}] ${message}\n${dataStr}\n------------------------------------------------\n`;
        fs.appendFileSync(LOG_FILE_PATH, logEntry);
        console.log(`[META AI] ${message}`, data ? JSON.stringify(data) : '');
    } catch (e) {
        console.error("Logging failed:", e);
    }
}

export function clearLogFile() {
    try {
        fs.writeFileSync(LOG_FILE_PATH, '');
    } catch (e) {}
}
