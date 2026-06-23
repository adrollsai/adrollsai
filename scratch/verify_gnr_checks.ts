import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

import { checkLimitAndIncrement } from '../utils/subscription-server';

async function run() {
    console.log("=== VERIFYING GNR HOMES QUOTA LIMIT BYPASS ===");
    
    // GNR Admin Account ID
    const gnrAdminId = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';
    // GNR Agent Account ID (Balraj)
    const gnrAgentId = 'ecee58d3-b402-47be-8f55-cbd5ad044a9a';
    
    console.log("Checking checkLimitAndIncrement for Admin (should return true immediately)...");
    const adminResult = await checkLimitAndIncrement(gnrAdminId, 'videos');
    console.log("Admin Result:", adminResult);
    
    console.log("Checking checkLimitAndIncrement for Agent (should resolve primaryUserId and return true immediately)...");
    const agentResult = await checkLimitAndIncrement(gnrAgentId, 'videos');
    console.log("Agent Result:", agentResult);
    
    console.log("✅ Verification script execution completed successfully!");
}

run().catch(console.error);
