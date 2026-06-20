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
            
            // Search for Realty Nation or Highland scripts/dialogues
            if (allText.toLowerCase().includes('highland') || 
                allText.toLowerCase().includes('amayra') || 
                allText.toLowerCase().includes('dialogue') ||
                allText.toLowerCase().includes('script')) {
                
                // Exclude matches that are just printing code files
                if (allText.includes('view_file') || allText.includes('write_to_file')) continue;
                
                foundCount++;
                console.log(`\n=== Match ${foundCount} (Step: ${data.step_index}, Source: ${data.source}, Type: ${data.type}) ===`);
                if (content) {
                    console.log("Content:", content.substring(0, 1500));
                }
            }
        } catch (e) {}
    }
    console.log(`\nSearch finished. Found ${foundCount} matches.`);
}

run();
