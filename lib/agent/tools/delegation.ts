import { tool } from 'ai';
import { z } from 'zod';
import { generateText } from 'ai';
import { getAgentModel } from '@/lib/agent/deepseek';

/**
 * Open-Ended Dynamic Sub-Agent Spawning.
 * Unlike hardcoded multi-agent systems, this allows the master harness
 * to invent and spawn ANY specialized sub-agent with arbitrary personas,
 * custom system instructions, and dedicated goals on the fly.
 */
export function createDelegationTool() {
  return {
    spawn_dynamic_subagent: tool({
      description: 'Dynamically spawns an open-ended autonomous sub-agent with ANY arbitrary role, custom instructions, and objective invented on the fly (e.g. "RERA Compliance Auditor", "Luxury Commercial Advisor", "Bengali Translation Specialist", "Spreadsheet Formula Engineer"). Solves any digital assignment autonomously.',
      inputSchema: z.object({
        agentRole: z.string().describe('The invented persona or title for this sub-agent'),
        systemInstructions: z.string().describe('Complete specialized system prompt and guidance for the sub-agent'),
        task: z.string().describe('The specific task, goal, or problem to solve'),
        contextData: z.record(z.string(), z.any()).optional().describe('Input context data, extracted text, or payload for the sub-agent'),
      }),
      execute: async ({ agentRole, systemInstructions, task, contextData }) => {
        try {
          const model = getAgentModel();

          const system = `
You are an autonomous specialized sub-agent of Nobogent.
ROLE: ${agentRole}
INSTRUCTIONS:
${systemInstructions}

EXECUTION PROTOCOL:
- Deliver extreme precision, depth, and actionable answers.
- Output clean structured findings for the master orchestrator.
          `.trim();

          const prompt = `
Task: ${task}
Context Data: ${contextData ? JSON.stringify(contextData, null, 2) : 'None provided'}

Execute this mission now and provide your final report.
          `.trim();

          const result = await generateText({
            model,
            system,
            prompt,
          });

          return {
            success: true,
            agentRole,
            status: 'completed',
            findings: result.text,
          };
        } catch (err: any) {
          return {
            success: false,
            agentRole,
            error: err.message,
          };
        }
      },
    }),
  };
}
