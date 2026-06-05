async function runTest() {
    const url = 'http://localhost:3000/api/landing-page/generate';
    console.log(`[Test API] Sending request to ${url}...`);
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Mock-User': 'bc63c065-9bcc-4793-bedc-f0960406425b'
            },
            body: JSON.stringify({
                productName: "Adrolls Agency Automator",
                context: "We automate lead generation and WhatsApp marketing for local businesses in India to double their revenue in 30 days without expensive agency fees.",
                mode: "generate",
                customInstructions: "Generate an extremely beautiful, high-converting Hormozi-style landing page."
            })
        });
        
        console.log(`[Test API] Response status: ${response.status}`);
        const data = await response.json();
        console.log(`[Test API] Response data:`, JSON.stringify(data, null, 2));
        
        if (response.ok && data.success) {
            console.log("✅ SUCCESS: E2E landing page generation via Next.js API completed successfully!");
            console.log(`Served landing page public URL: ${data.publicUrl}`);
            
            // Now test serving the generated page to see if form is served correctly
            console.log(`[Test API] Testing page retrieval at: ${data.publicUrl}...`);
            const pageRes = await fetch(data.publicUrl);
            const pageHtml = await pageRes.text();
            console.log(`[Test API] Served page HTML retrieval status: ${pageRes.status}`);
            console.log(`[Test API] Served page HTML contains fallback form: ${pageHtml.includes('class="dynamic-landing-form"')}`);
            console.log(`[Test API] Served page HTML contains generated image: ${pageHtml.includes('https://')}`);
        } else {
            console.log("❌ FAILURE: Next.js API returned an error:", data.error || data);
        }
    } catch (err) {
        console.error("❌ E2E API Test failed:", err.message);
    }
}

runTest();
