import * as path from 'path';
import * as Module from 'module';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

// Mock createClient in '@/utils/supabase/server'
const mockSupabase = {
    auth: {
        getUser: async () => ({
            data: {
                user: { id: 'c890a11f-84ce-4592-ab8f-8682927b1a9d' }
            }
        })
    },
    from: (table: string) => {
        return {
            select: (cols: string) => ({
                eq: (col: string, val: any) => ({
                    single: async () => {
                        if (table === 'profiles') {
                            return {
                                data: {
                                    id: 'c890a11f-84ce-4592-ab8f-8682927b1a9d',
                                    role: 'admin',
                                    business_name: 'Realty Nation',
                                    contact_number: '+91 98725 00094',
                                    logo_url: 'https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/logos/c890a11f-84ce-4592-ab8f-8682927b1a9d-1778916086679.png'
                                },
                                error: null
                            };
                        }
                        return { data: null, error: null };
                    }
                })
            })
        };
    }
};

// Dynamic resolver hook for Next.js path aliases
const originalRequire = (Module.prototype as any).require;
(Module.prototype as any).require = function (name: string) {
    if (name === '@/utils/supabase/server') {
        return {
            createClient: async () => mockSupabase
        };
    }
    if (name === '@/utils/subscription-server') {
        return {
            checkLimitAndIncrement: async () => {},
            refundLimit: async () => {},
            checkStorageLimit: async () => {}
        };
    }
    if (name.startsWith('@/')) {
        const resolvedPath = path.resolve(__dirname, '..', name.slice(2));
        return originalRequire.call(this, resolvedPath);
    }
    return originalRequire.apply(this, arguments);
};

async function run() {
    console.log("=== RUNNING IN-MEMORY /api/chat POST DIAGNOSTIC ===");
    try {
        const payload = {
            propertyTitle: "Test Homeland Regalia",
            propertyDescription: "Ultra-luxury residences in Mohali. ANGLE: Stop Waiting: Move into Mohali's premier eco-friendly paradise.",
            userInstructions: "make it premium",
            propImages: ["https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/properties/2f62a259-f23b-48ee-a920-c436f36eaa4b-1777546450659-2gcs4q.png"],
            isOrganic: true,
            aspectRatio: "4:5",
            model: "image-2.0",
            contactNumber: "+91 98725 00094",
            logoUrl: "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/logos/c890a11f-84ce-4592-ab8f-8682927b1a9d-1778916086679.png"
        };

        const mockRequest = new Request('http://localhost:3000/api/chat', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        console.log("Invoking POST handler...");
        const { POST } = await import('../app/api/chat/route');
        const response = await POST(mockRequest);

        console.log("POST Invocation completed!");
        console.log("Response Status:", response.status);
        
        const body = await response.json();
        console.log("Response Body:", JSON.stringify(body, null, 2));
    } catch (err: any) {
        console.error("❌ CRASH DETECTED inside /api/chat route handler:");
        console.error(err);
    }
}

run().catch(console.error);
