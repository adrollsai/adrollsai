require('dotenv').config({ path: '.env.local' });
const { createKieImageTask } = require('../utils/external-apis');

async function test() {
    try {
        console.log("Testing createKieImageTask with aspectRatio '4:5' using flux2/flex-text-to-image...");
        const taskId = await createKieImageTask(
            "A premium product shot, professional advertisement, 4:5 aspect ratio", 
            "gpt-image-2-text-to-image", 
            "4:5"
        );
        console.log("SUCCESS! Task ID:", taskId);
    } catch (err) {
        console.error("FAILED! Error:", err.message);
    }
}

test();
