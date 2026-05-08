import path from 'path';

export function logToFile(message: string, data?: any) {
    try {
        const timestamp = new Date().toISOString();
        const dataStr = data ? JSON.stringify(data, null, 2) : '';
        const logEntry = `\n[${timestamp}] ${message}\n${dataStr}\n------------------------------------------------\n`;
        
        // Log to standard console for cloud environments (Vercel/Next.js)
        // File system writing (fs.appendFileSync) is disabled here because serverless 
        // functions use a read-only file system (EROFS error).
        console.log(`[META AI] ${message}`, data ? JSON.stringify(data) : '');
        
    } catch (e) {
        console.error("Logging failed:", e);
    }
}

export function clearLogFile() {
    // No-op in serverless environments
    console.log("[Logger] Log clearing requested (No-op in production)");
}
