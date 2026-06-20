const fs = require('fs');
const readline = require('readline');

const transcriptPath = 'C:\\Users\\Adrolls\\.gemini\\antigravity-ide\\brain\\d0f7a12a-8674-4f1a-bc56-70b73bb6e0c2\\.system_generated\\logs\\transcript.jsonl';

async function run() {
    const fileStream = fs.createReadStream(transcriptPath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let count = 0;
    const steps = [];
    for await (const line of rl) {
        try {
            const data = JSON.parse(line);
            count++;
            steps.push({
                index: data.step_index,
                source: data.source,
                type: data.type
            });
        } catch (e) {}
    }
    console.log(`Total steps in transcript: ${count}`);
    if (steps.length > 0) {
        console.log(`First step: Index ${steps[0].index}, Source ${steps[0].source}, Type ${steps[0].type}`);
        console.log(`Last step: Index ${steps[steps.length - 1].index}, Source ${steps[steps.length - 1].source}, Type ${steps[steps.length - 1].type}`);
    }
}

run();
