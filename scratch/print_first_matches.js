const fs = require('fs');
const readline = require('readline');

const transcriptPath = 'C:\\Users\\Adrolls\\.gemini\\antigravity-ide\\brain\\d0f7a12a-8674-4f1a-bc56-70b73bb6e0c2\\.system_generated\\logs\\transcript.jsonl';

async function run() {
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
            
            if (allText.includes('c890a11f-84ce-4592-ab8f-8682927b1a9d') || 
                allText.includes('createTask') || 
                allText.includes('bytedance') || 
                allText.includes('kie.ai')) {
                
                foundCount++;
                if (foundCount <= 12) {
                    console.log(`\n=== Match ${foundCount} (Step: ${data.step_index}, Source: ${data.source}, Type: ${data.type}) ===`);
                    if (data.tool_calls) {
                        console.log("Tool Calls:", JSON.stringify(data.tool_calls, null, 2));
                    } else if (content) {
                        console.log("Content:", content.substring(0, 2000));
                    }
                }
            }
        } catch (e) {}
    }
}

run();
