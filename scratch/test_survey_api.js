async function runTest() {
    const url = 'http://localhost:3000/api/landing-page/generate';
    console.log(`[Test API] Sending survey generation request to ${url}...`);
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Mock-User': 'c890a11f-84ce-4592-ab8f-8682927b1a9d'
            },
            body: JSON.stringify({
                productName: "Highland Mayfield",
                context: "15 Acres of Elegance. Discover iconic architectural masterpieces with direct access from PR6 & PR7. Construction has officially commenced with excavation started.",
                mode: "generate",
                pageType: "survey",
                customInstructions: "Generate a centered single-card survey layout, placing the survey form directly below the main images/slider."
            })
        });
        
        console.log(`[Test API] Response status: ${response.status}`);
        const data = await response.json();
        console.log(`[Test API] Response data:`, JSON.stringify(data, null, 2));
        
        if (response.ok && data.success) {
            console.log("✅ SUCCESS: Survey landing page generated successfully!");
            
            // Inspect the generated HTML
            const html = data.page.html_content;
            
            // Check for survey attributes
            const hasSurveyAttr = html.includes('data-page-type="survey"');
            const hasFormContainer = html.includes('id="qualification-form-container"');
            console.log(`[Test API] Generated page contains data-page-type="survey": ${hasSurveyAttr}`);
            console.log(`[Test API] Generated page contains qualification-form-container: ${hasFormContainer}`);
            
            // Verify structure: qualification-form-container should be positioned before project highlights/configurations
            const formIndex = html.indexOf('id="qualification-form-container"');
            const highlightsIndex = html.indexOf('Available Luxury Configurations') || html.indexOf('Experience Ultra-Luxury Living');
            
            console.log(`[Test API] Form Container index: ${formIndex}`);
            console.log(`[Test API] Highlights/Configurations index: ${highlightsIndex}`);
            
            if (formIndex < highlightsIndex && formIndex !== -1 && highlightsIndex !== -1) {
                console.log("✅ SUCCESS: Form container is correctly positioned above highlights and configurations (directly below the images)!");
            } else {
                console.log("❌ WARNING: Form container is positioned below highlights/configurations or one of them is missing.");
            }
        } else {
            console.log("❌ FAILURE: Next.js API returned an error:", data.error || data);
        }
    } catch (err) {
        console.error("❌ E2E API Test failed:", err.message);
    }
}

runTest();
