const fs = require('fs');
const readline = require('readline');

const transcriptPath = 'C:\\Users\\Adrolls\\.gemini\\antigravity-ide\\brain\\80457c45-273e-490b-8fec-b94c42d3ba14\\.system_generated\\logs\\transcript.jsonl';

async function searchTranscript() {
    if (!fs.existsSync(transcriptPath)) {
        console.error("Transcript file not found");
        return;
    }

    console.log("Searching in transcript.jsonl for ALTER TABLE statements...");
    const fileStream = fs.createReadStream(transcriptPath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let foundCount = 0;
    for await (const line of rl) {
        try {
            const data = JSON.parse(line);
            const content = data.content || '';
            const toolCallsStr = JSON.stringify(data.tool_calls || {});
            const allText = content + ' ' + toolCallsStr;
            
            if (allText.toLowerCase().includes('alter table') || allText.toLowerCase().includes('add column')) {
                foundCount++;
                console.log(`\n=== Match ${foundCount} (Step: ${data.step_index}, Source: ${data.source}) ===`);
                if (data.tool_calls) {
                    console.log("Tool Calls:", JSON.stringify(data.tool_calls).substring(0, 1000));
                } else {
                    console.log("Content:", content.substring(0, 1000));
                }
            }
        } catch (e) {
            // Ignore parse errors
        }
    }
    console.log(`\nSearch finished. Found ${foundCount} matches.`);
}

searchTranscript();
