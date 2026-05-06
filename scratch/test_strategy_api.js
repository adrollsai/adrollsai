
async function testStrategy() {
    const product = {
        title: "Green Lotus Zirakpur",
        description: "IGBC Platinum-certified luxury project with 21,000 trees and 12-acre drive-free zone."
    };
    const quantity = 5;
    const instructions = "Focus on the eco-friendly aspects.";

    try {
        const response = await fetch('http://localhost:3000/api/agent/strategy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product, quantity, instructions })
        });
        const data = await response.json();
        console.log("Response:", JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("Error:", error);
    }
}

testStrategy();
