import { NextResponse } from 'next/server'
import { callDeepSeekWithUsage } from '@/utils/external-apis'
import { createClient } from '@/utils/supabase/server'

// MCP Tool Definitions for Nobogent Flow Builder
const MCP_TOOLS = [
  {
    name: 'generate_automation_flow',
    description: 'Generates a complete multi-step automation flow (calling campaigns, deterministic qualification, admin alerts, WhatsApp brochure, CRM stages) from simple English or voice prompts using DeepSeek v4-flash.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Natural language or voice description of the workflow (e.g., "Run outbound call to existing leads in Joy Grand, qualify if they want site visit, if yes notify admin on email and whatsapp, send brochure on whatsapp")'
        }
      },
      required: ['prompt']
    }
  },
  {
    name: 'simulate_automation_flow',
    description: 'Simulates and verifies an automation flow with a test prospect before publishing, returning call status, deterministic qualification score, admin notification preview, and brochure payload.',
    inputSchema: {
      type: 'object',
      properties: {
        flow: {
          type: 'object',
          description: 'The AutomationFlow object to simulate'
        },
        testLead: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            phone: { type: 'string' },
            prospectAnswer: { type: 'string' }
          }
        }
      },
      required: ['flow']
    }
  },
  {
    name: 'publish_automation_flow',
    description: 'Publishes and activates an automation flow in the workspace CRM so it immediately processes live or scheduled campaign leads.',
    inputSchema: {
      type: 'object',
      properties: {
        flowId: {
          type: 'string',
          description: 'ID of the flow to publish'
        }
      },
      required: ['flowId']
    }
  }
]

export async function GET() {
  return NextResponse.json({
    jsonrpc: '2.0',
    name: 'nobogent-flow-builder-mcp',
    version: '1.0.0',
    tools: MCP_TOOLS
  })
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { method, params, action } = body

    // 1. Tool discovery
    if (method === 'tools/list' || action === 'list_tools') {
      return NextResponse.json({
        jsonrpc: '2.0',
        result: {
          tools: MCP_TOOLS
        }
      })
    }

    // 2. Tool execution
    const toolName = params?.name || body.tool || body.action
    const args = params?.arguments || body.args || body

    if (toolName === 'generate_automation_flow') {
      const prompt = args.prompt || ''
      if (!prompt) {
        return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
      }

      // Call our internal generator logic
      const genRes = await fetch(new URL('/api/flows/generate', req.url).toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': req.headers.get('cookie') || ''
        },
        body: JSON.stringify({ prompt })
      })
      const genData = await genRes.json()

      return NextResponse.json({
        jsonrpc: '2.0',
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(genData.flow, null, 2)
            }
          ],
          flow: genData.flow
        }
      })
    }

    if (toolName === 'simulate_automation_flow') {
      const flow = args.flow
      const lead = args.testLead || { name: 'Rohit Verma', phone: '+91 98765 43210', prospectAnswer: 'Yes, interested in visiting' }

      const logs: string[] = []
      logs.push(`[Trigger]: Fired for "${lead.name}" (${lead.phone})`)

      let qualified = false
      let score = 0

      for (const node of (flow.nodes || [])) {
        if (node.type === 'action_ai_call') {
          logs.push(`[AI Call]: Connected to ${lead.phone}. Question asked: "${node.config?.qualificationQuestion || 'Interested in visiting?'}"`)
          logs.push(`[Prospect Response]: "${lead.prospectAnswer}"`)
        } else if (node.type === 'action_qualify') {
          const matched = lead.prospectAnswer.toLowerCase().includes('yes') || lead.prospectAnswer.toLowerCase().includes('interested')
          score = matched ? 100 : 0
          qualified = score >= (node.config?.passScore || 70)
          logs.push(`[Deterministic Qualification]: Evaluated response -> Score: ${score}% (Qualified: ${qualified})`)
        } else if (node.type === 'action_notify_team' && qualified) {
          logs.push(`[Admin Notification]: Email & WhatsApp dispatched to ${node.config?.adminEmail || 'admin'} with lead payload`)
        } else if (node.type === 'action_whatsapp_msg' && qualified) {
          logs.push(`[WhatsApp Message]: Sent brochure PDF and booking links to ${lead.phone}`)
        }
      }

      return NextResponse.json({
        jsonrpc: '2.0',
        result: {
          content: [
            {
              type: 'text',
              text: `Simulation Completed:\n- Status: ${qualified ? 'QUALIFIED' : 'UNQUALIFIED'}\n- Score: ${score}%\n- Logs:\n${logs.join('\n')}`
            }
          ],
          qualified,
          score,
          logs
        }
      })
    }

    return NextResponse.json({
      error: `Unknown MCP tool: ${toolName}`
    }, { status: 400 })

  } catch (err: any) {
    console.error('[MCP FLOW ROUTE ERROR]:', err)
    return NextResponse.json({ error: err.message || 'Internal MCP Error' }, { status: 500 })
  }
}
