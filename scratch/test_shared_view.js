async function test() {
    const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
    const slug = 'adrolls-ai-for-smbs-8993';
    const url = `http://localhost:3000/shared/${userId}/${slug}`;
    
    console.log(`Sending GET request to ${url}...`);
    try {
        const res = await fetch(url);
        console.log(`Response status: ${res.status}`);
        const html = await res.text();
        
        console.log(`HTML length served: ${html.length}`);
        
        // Check if the fallback form is injected
        const hasForm = html.includes('<form class="dynamic-landing-form"');
        console.log(`Has class="dynamic-landing-form": ${hasForm}`);
        
        const hasNameInput = html.includes('name="name"');
        const hasPhoneInput = html.includes('name="phone"');
        const hasCityInput = html.includes('name="city"');
        console.log(`Has name input: ${hasNameInput}`);
        console.log(`Has phone input: ${hasPhoneInput}`);
        console.log(`Has city input: ${hasCityInput}`);
        
        if (hasForm && hasNameInput && hasPhoneInput && hasCityInput) {
            console.log("✅ SUCCESS: The default form fallback was correctly injected into the served HTML!");
        } else {
            console.log("❌ FAILURE: Form was not correctly injected.");
        }
    } catch (err) {
        console.error("Connection failed:", err.message);
    }
}

test();
