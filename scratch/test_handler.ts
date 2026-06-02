import { GET } from '../app/shared/[user_id]/[slug]/route';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

async function run() {
    console.log("=== RUNNING IN-MEMORY ROUTE HANDLER DIAGNOSTIC ===");
    try {
        const params = Promise.resolve({
            user_id: '2f62a259-f23b-48ee-a920-c436f36eaa4b',
            slug: 'homeland-regalia-4166'
        });

        const mockRequest = new Request('http://localhost:3000/shared/2f62a259-f23b-48ee-a920-c436f36eaa4b/homeland-regalia-4166');

        console.log("Invoking GET handler...");
        const response = await GET(mockRequest, { params });

        console.log("GET Invocation completed successfully!");
        console.log("Response Status:", response.status);
        
        const body = await response.text();
        console.log("Response Body (first 400 chars):");
        console.log(body.slice(0, 400));
    } catch (err: any) {
        console.error("❌ CRASH DETECTED inside route handler:");
        console.error(err);
        if (err.stack) {
            console.error(err.stack);
        }
    }
}

run().catch(console.error);
