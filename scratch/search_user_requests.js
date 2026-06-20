const fs = require('fs');
const readline = require('readline');

const transcriptPath = 'C:\\Users\\Adrolls\\.gemini\\antigravity-ide\\brain\\d0f7a12a-8674-4f1a-bc56-70b73bb6e0c2\\.system_generated\\logs\\transcript.jsonl';

async function run() {
    const fileStream = fs.createReadStream(transcriptPath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    console.log("=== User Inputs in Conversation History ===");
    for await (const line of rl) {
        try {
            const data = JSON.parse(line);
            if (data.type === 'USER_INPUT') {
                console.log(`\n[Step ${data.step_index}] ${data.source}:`);
                console.log(data.content);
                console.log("-----------------------------------------");
            }
        } catch (e) {}
    }
}

run();
