const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

// Register typescript module resolver to allow import of @/utils
require('ts-node').register({
    compilerOptions: {
        module: 'commonjs'
    }
});

// Mock Next.js next/server
const mockNextServer = {
    NextResponse: {
        json: (data, init) => {
            return {
                status: init?.status || 200,
                headers: init?.headers || {},
                json: async () => data
            };
        }
    }
};
jestMock('next/server', mockNextServer);

function jestMock(moduleName, mockExport) {
    const Module = require('module');
    const originalRequire = Module.prototype.require;
    Module.prototype.require = function (name) {
        if (name === moduleName) {
            return mockExport;
        }
        return originalRequire.apply(this, arguments);
    };
}

async function run() {
    console.log("=== RUNNING IN-MEMORY ROUTE HANDLER DIAGNOSTIC ===");
    try {
        // Resolve target ts file
        const { GET } = require('../app/shared/[user_id]/[slug]/route.ts');
        
        // Mock Request and dynamic segment params
        const params = Promise.resolve({
            user_id: '2f62a259-f23b-48ee-a920-c436f36eaa4b',
            slug: 'homeland-regalia-4166'
        });
        
        const mockRequest = {};
        
        console.log("Invoking GET handler...");
        const response = await GET(mockRequest, { params });
        
        console.log("GET Invocation completed successfully!");
        console.log("Response Status:", response.status);
        
        if (response.text) {
            const body = await response.text();
            console.log("Response Body (first 400 chars):");
            console.log(body.slice(0, 400));
        } else {
            console.log("No text body returned or raw Response object.");
        }
    } catch (err) {
        console.error("❌ CRASH DETECTED inside route handler:");
        console.error(err);
    }
}

run().catch(console.error);
