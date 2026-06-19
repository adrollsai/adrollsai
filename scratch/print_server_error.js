async function run() {
    const url = 'http://localhost:3000/api/landing-page/generate';
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Mock-User': 'c890a11f-84ce-4592-ab8f-8682927b1a9d'
            },
            body: JSON.stringify({
                productName: "Highland Mayfield",
                context: "15 Acres of Elegance.",
                mode: "generate",
                pageType: "survey"
            })
        });
        const text = await response.text();
        const fs = require('fs');
        fs.writeFileSync('scratch/server_error.html', text);
        console.log(`Wrote server error HTML! Status: ${response.status}`);
    } catch (e) {
        console.error(e);
    }
}
run();
