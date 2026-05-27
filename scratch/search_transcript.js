const fs = require('fs');
const readline = require('readline');

const transcriptPath = 'C:\\Users\\USER\\.gemini\\antigravity-ide\\brain\\966137cb-c8a4-414c-8f6e-0e9f13756216\\.system_generated\\logs\\transcript.jsonl';

async function searchTranscript() {
    if (!fs.existsSync(transcriptPath)) {
        console.error("Transcript file not found");
        return;
    }

    console.log("Searching early steps in transcript.jsonl...");
    const fileStream = fs.createReadStream(transcriptPath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let foundCount = 0;
    for await (const line of rl) {
        try {
            const data = JSON.parse(line);
            if (data.step_index < 500) {
                const contentStr = data.content || '';
                const thinkingStr = data.thinking || '';
                const toolCallsStr = JSON.stringify(data.tool_calls || {});
                
                const allText = `${contentStr} ${thinkingStr} ${toolCallsStr}`;
                if (allText.includes('Launched Kie task') || allText.includes('taskIds') || allText.includes('taskId') || allText.includes('video_tasks')) {
                    foundCount++;
                    console.log(`\n=== Match ${foundCount} (Step: ${data.step_index}, Source: ${data.source}) ===`);
                    console.log(allText.substring(0, 1500));
                }
            }
        } catch (e) {
            // Ignore parse errors on empty lines
        }
    }
    console.log(`\nSearch finished. Found ${foundCount} matches.`);
}

searchTranscript();
