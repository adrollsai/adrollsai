import fs from 'fs';
import path from 'path';

// Store jobs in a local 'jobs_store' directory inside the workspace
const JOBS_DIR = path.join(process.cwd(), 'jobs_store');

export type JobStatus = {
    id: string;
    user_id?: string;
    target_user_id?: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    payload?: any;
    campaign_id?: string | null;
    message?: string | null;
    created_at: string;
    updated_at: string;
};

function ensureJobsDir() {
    if (!fs.existsSync(JOBS_DIR)) {
        fs.mkdirSync(JOBS_DIR, { recursive: true });
    }
}

export function writeJobLocal(jobId: string, data: Partial<JobStatus>) {
    try {
        ensureJobsDir();
        const filePath = path.join(JOBS_DIR, `${jobId}.json`);
        let existing: Partial<JobStatus> = {
            id: jobId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        if (fs.existsSync(filePath)) {
            try {
                existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            } catch (e) {}
        }
        const updated = {
            ...existing,
            ...data,
            updated_at: new Date().toISOString()
        };
        fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8');
        console.log(`[JobStore] Wrote local status for job ${jobId}`);
    } catch (err: any) {
        console.error(`[JobStore] Failed to write local job ${jobId}:`, err.message);
    }
}

export function readJobLocal(jobId: string): JobStatus | null {
    try {
        ensureJobsDir();
        const filePath = path.join(JOBS_DIR, `${jobId}.json`);
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(content) as JobStatus;
        }
    } catch (err: any) {
        console.error(`[JobStore] Failed to read local job ${jobId}:`, err.message);
    }
    return null;
}
