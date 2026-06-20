const fs = require('fs');
const readline = require('readline');

const transcriptPath = 'C:\\Users\\Adrolls\\.gemini\\antigravity-ide\\brain\\d0f7a12a-8674-4f1a-bc56-70b73bb6e0c2\\.system_generated\\logs\\transcript.jsonl';

async function run() {
    const fileStream = fs.createReadStream(transcriptPath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    console.log("=== Searching for Highland Mayfield script and generation configs ===");
    for await (const line of rl) {
        try {
            const data = JSON.parse(line);
            const content = data.content || '';
            const toolCallsStr = JSON.stringify(data.tool_calls || {});
            
            // Check if this step has tool calls with fetch or route requests to generate/script
            const hasGenerationCall = toolCallsStr.includes('/api/video/generate') || 
                                      toolCallsStr.includes('/api/video/script') ||
                                      content.includes('/api/video/generate') ||
                                      content.includes('/api/video/script');
                                      
            const hasHighland = content.toLowerCase().includes('highland') || 
                                toolCallsStr.toLowerCase().includes('highland') ||
                                content.toLowerCase().includes('mayfield') ||
                                toolCallsStr.toLowerCase().includes('mayfield');

            if (hasHighland && (content.includes('dialogue') || toolCallsStr.includes('dialogue') || content.includes('scenes') || toolCallsStr.includes('scenes'))) {
                console.log(`\n=== Match (Step: ${data.step_index}, Source: ${data.source}, Type: ${data.type}) ===`);
                if (data.tool_calls) {
                    console.log("Tool Calls:", JSON.stringify(data.tool_calls, null, 2));
                } else {
                    console.log("Content:", content.substring(0, 3000));
                }
                console.log("-----------------------------------------");
            }
        } catch (e) {}
    }
}

run();
