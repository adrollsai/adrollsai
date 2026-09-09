import React, { useState, useCallback, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Node,
  Edge,
  Handle,
  Position,
  Connection,
  BackgroundVariant,
  Panel
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  MessageSquare,
  Zap,
  Bell,
  Tag,
  TrendingUp,
  Clock,
  Split,
  Plus,
  Trash2,
  ExternalLink,
  ChevronRight,
  Sliders,
  CheckCircle,
  Copy,
  Sparkles,
  PhoneCall,
  Save,
  Play,
  RotateCcw,
  Bot,
  Send,
  SlidersHorizontal,
  Info
} from 'lucide-react'

// ============================================================================
// 1. CUSTOM NODE DEFINITIONS (ManyChat / ChatbotX style)
// ============================================================================

// --- A. WHATSAPP TEMPLATE MESSAGE NODE (Starting Step / Broadcast Trigger) ---
export function TriggerNode({ data, id }: { data: any; id: string }) {
  const buttons = data.buttons || [
    { id: 'interested', title: 'Interested 🌟' },
    { id: 'not_interested', title: 'Not Interested' }
  ]

  return (
    <div className="w-[330px] bg-white rounded-2xl border-2 border-indigo-500 shadow-xl shadow-indigo-500/15 overflow-hidden font-sans transition-all hover:shadow-2xl">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 via-indigo-700 to-violet-700 px-4 py-3 flex items-center justify-between text-white">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center">
            <Zap size={15} className="text-amber-300 fill-amber-300" />
          </div>
          <div>
            <span className="text-xs font-black tracking-wide uppercase block">WhatsApp Template</span>
            <span className="text-[10px] text-indigo-200 block font-medium">Starting Step / Broadcast</span>
          </div>
        </div>
        <span className="text-[10px] font-black bg-amber-400 text-indigo-950 px-2.5 py-0.5 rounded-full shadow-xs">
          Trigger
        </span>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* Template metadata chip */}
        <div className="bg-indigo-50/80 border border-indigo-200/80 rounded-xl px-3 py-1.5 flex items-center justify-between text-[11px]">
          <span className="text-indigo-600 font-bold uppercase tracking-wider text-[10px]">Template:</span>
          <span className="text-slate-900 font-black font-mono truncate max-w-[180px]">{data.templateName || 'client_project_announcement'}</span>
        </div>

        {/* Message bubble preview */}
        <div className="bg-[#E7F8EE] border border-emerald-200/80 rounded-xl p-3 text-xs text-slate-800 leading-relaxed relative">
          <p className="whitespace-pre-line text-slate-700">
            {data.message || 'Hi {{1}}! We just launched luxury 3 & 4 BHK residences with private terrace suites. Special inaugural pricing available for early bookings! Are you interested to explore?'}
          </p>
          <div className="text-[9px] text-emerald-700 font-bold text-right mt-1.5 flex items-center justify-end gap-1">
            <span>Template Broadcast</span>
            <span>✓✓</span>
          </div>
        </div>

        {/* Quick Reply Buttons with Dedicated Output Port on each button */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Quick Reply Buttons (Ports)
            </span>
            <span className="text-[10px] text-indigo-600 font-semibold">Connect outputs ➔</span>
          </div>
          {buttons.map((btn: any, idx: number) => (
            <div
              key={btn.id || idx}
              className="relative bg-slate-50 hover:bg-indigo-50/50 border border-slate-200 hover:border-indigo-300 rounded-xl px-3 py-2 flex items-center justify-between transition-all group"
            >
              <div className="flex items-center gap-2 min-w-0 pr-4">
                <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                <span className="text-xs font-bold text-slate-800 truncate">{btn.title}</span>
              </div>

              {/* Dedicated Connection Port for this specific button */}
              <Handle
                type="source"
                position={Position.Right}
                id={`btn_${btn.id || idx}`}
                className="!w-3.5 !h-3.5 !bg-indigo-600 !border-2 !border-white shadow-md hover:!scale-125 transition-transform !right-[-7px] cursor-crosshair"
                title={`Drag connection from ${btn.title}`}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// --- B. WHATSAPP MESSAGE NODE (Free Flow Reply + Attached Automations) ---
export function WhatsAppMessageNode({ data, id }: { data: any; id: string }) {
  const buttons = data.buttons || []

  return (
    <div className="w-[330px] bg-white rounded-2xl border-2 border-emerald-500 shadow-xl shadow-emerald-500/15 overflow-hidden font-sans transition-all hover:shadow-2xl">
      {/* Input Handle on left */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="!w-3.5 !h-3.5 !bg-emerald-600 !border-2 !border-white shadow-md hover:!scale-125 transition-transform cursor-crosshair"
      />

      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-teal-700 px-4 py-3 flex items-center justify-between text-white">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center">
            <MessageSquare size={15} className="text-white fill-white" />
          </div>
          <div>
            <span className="text-xs font-black tracking-wide uppercase block">WhatsApp Message</span>
            <span className="text-[10px] text-teal-200 block font-medium">Free Flow Reply</span>
          </div>
        </div>
        <span className="text-[10px] font-bold bg-white/25 px-2.5 py-0.5 rounded-full">Step</span>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* Message Bubble Preview */}
        <div className="bg-[#E7F8EE] border border-emerald-200/80 rounded-xl p-3 text-xs text-slate-800 leading-relaxed relative">
          <p className="whitespace-pre-line text-slate-700">
            {data.message || 'Awesome! 🌟 Here is our live property inventory, floor plans, and pricing sheet for {{business_name}}:\n\n👉 {{inventory_url}}'}
          </p>
          <div className="text-[9px] text-emerald-700 font-bold text-right mt-1.5 flex items-center justify-end gap-1">
            <span>Now</span>
            <span>✓✓</span>
          </div>
        </div>

        {/* Buttons List / CTA Button */}
        {buttons.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Interactive Buttons
            </span>
            {buttons.map((btn: any, idx: number) => (
              <div
                key={btn.id || idx}
                className="relative bg-emerald-50/70 border border-emerald-200 rounded-xl px-3 py-2 flex items-center justify-between text-xs font-bold text-emerald-900 shadow-2xs"
              >
                <span className="truncate">{btn.title}</span>
                <span className="text-[10px] text-emerald-600 font-mono font-normal">➔ {btn.url ? 'URL Link' : 'Reply'}</span>
                
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`btn_${btn.id || idx}`}
                  className="!w-3.5 !h-3.5 !bg-emerald-600 !border-2 !border-white shadow-md hover:!scale-125 transition-transform !right-[-7px] cursor-crosshair"
                />
              </div>
            ))}
          </div>
        )}

        {/* Attached Automations Badge (Notify Admin + Stage) */}
        {(data.notifyAdmin !== false || data.crmStage || data.addTag) && (
          <div className="pt-2 border-t border-slate-100 space-y-1.5">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
              Automations Triggered on Send:
            </span>
            {data.notifyAdmin !== false && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-bold">
                <Bell size={13} className="text-amber-600 shrink-0" />
                <span>Notify Admin (Push + WhatsApp)</span>
              </div>
            )}
            {data.crmStage && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-bold">
                <TrendingUp size={13} className="text-emerald-600 shrink-0" />
                <span>Move CRM Stage to "{data.crmStage}"</span>
              </div>
            )}
            {data.addTag && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-800 border border-blue-200 text-[11px] font-bold">
                <Tag size={13} className="text-blue-600 shrink-0" />
                <span>Tag: "{data.addTag}"</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Output Handle on right for continuing the flow */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="!w-3.5 !h-3.5 !bg-emerald-600 !border-2 !border-white shadow-md hover:!scale-125 transition-transform cursor-crosshair"
      />
    </div>
  )
}

// --- C. ACTION NODE (Multi-task Container) ---
export function ActionNode({ data, id }: { data: any; id: string }) {
  const actions = data.actions || []

  return (
    <div className="w-[300px] bg-white rounded-2xl border-2 border-indigo-500 shadow-xl shadow-indigo-500/10 overflow-hidden font-sans transition-all hover:shadow-2xl">
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="!w-3.5 !h-3.5 !bg-indigo-600 !border-2 !border-white shadow-md hover:!scale-125 transition-transform"
      />

      <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 flex items-center justify-between text-white">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-white/20 flex items-center justify-center">
            <Zap size={14} className="text-amber-300 fill-amber-300" />
          </div>
          <span className="text-xs font-black tracking-wide uppercase">Actions</span>
        </div>
        <span className="text-[10px] font-bold bg-white/25 px-2 py-0.5 rounded-full">{actions.length} Tasks</span>
      </div>

      <div className="p-3.5 space-y-2">
        {actions.map((act: any, idx: number) => (
          <div
            key={idx}
            className="flex items-center gap-2.5 p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs"
          >
            <div className="w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 bg-indigo-50 text-indigo-600 border-indigo-200">
              <Zap size={14} />
            </div>
            <div className="min-w-0">
              <span className="block font-bold text-slate-900 truncate">{act.title}</span>
              <span className="block text-[10px] text-slate-500 truncate">{act.detail}</span>
            </div>
          </div>
        ))}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="!w-3.5 !h-3.5 !bg-indigo-600 !border-2 !border-white shadow-md hover:!scale-125 transition-transform cursor-crosshair"
      />
    </div>
  )
}

// --- D. INVENTORY DELIVERY CARD NODE ---
export function InventoryDeliveryNode({ data, id }: { data: any; id: string }) {
  return (
    <div className="w-[320px] bg-white rounded-2xl border-2 border-blue-500 shadow-xl shadow-blue-500/10 overflow-hidden font-sans transition-all hover:shadow-2xl">
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="!w-3.5 !h-3.5 !bg-blue-600 !border-2 !border-white shadow-md hover:!scale-125 transition-transform"
      />

      <div className="bg-gradient-to-r from-blue-600 to-cyan-600 px-4 py-2.5 flex items-center justify-between text-white">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-white/20 flex items-center justify-center">
            <ExternalLink size={14} className="text-white" />
          </div>
          <span className="text-xs font-black tracking-wide uppercase">Deliver Inventory</span>
        </div>
        <span className="text-[10px] font-bold bg-white/25 px-2 py-0.5 rounded-full">Catalog</span>
      </div>

      <div className="p-3.5 space-y-2.5">
        <p className="text-xs text-slate-700 leading-relaxed">
          {data.message || 'Thank you for your interest! 🌟 Explore our latest verified property inventory and brochures:'}
        </p>

        <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-2.5 flex items-center justify-between">
          <div className="min-w-0">
            <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider block">Destination Link</span>
            <span className="text-xs font-mono font-bold text-slate-900 block truncate">
              {data.link || '{{inventory_url}}'}
            </span>
          </div>
          <span className="text-[11px] font-bold px-2.5 py-1 bg-blue-600 text-white rounded-lg shadow-sm shrink-0">
            View 🏢
          </span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="!w-3.5 !h-3.5 !bg-blue-600 !border-2 !border-white shadow-md hover:!scale-125 transition-transform cursor-crosshair"
      />
    </div>
  )
}

// --- E. CONDITION / FILTER NODE ---
export function ConditionNode({ data, id }: { data: any; id: string }) {
  return (
    <div className="w-[300px] bg-white rounded-2xl border-2 border-amber-500 shadow-xl shadow-amber-500/10 overflow-hidden font-sans transition-all hover:shadow-2xl">
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="!w-3.5 !h-3.5 !bg-amber-600 !border-2 !border-white shadow-md hover:!scale-125 transition-transform"
      />

      <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2.5 flex items-center justify-between text-white">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-white/20 flex items-center justify-center">
            <Split size={14} className="text-white" />
          </div>
          <span className="text-xs font-black tracking-wide uppercase">Condition Filter</span>
        </div>
        <span className="text-[10px] font-bold bg-white/25 px-2 py-0.5 rounded-full">Branching</span>
      </div>

      <div className="p-3.5 space-y-2.5">
        <p className="text-xs font-bold text-slate-800">{data.title || 'Check Prospect Attribute'}</p>
        <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-2 text-[11px] text-amber-900 font-medium">
          If: <span className="font-bold">{data.condition || 'Clicked Interested == True'}</span>
        </div>

        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 text-xs text-emerald-800 font-bold relative">
            <span>✓ Match (Yes)</span>
            <Handle
              type="source"
              position={Position.Right}
              id="true"
              className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-white shadow-md hover:!scale-125 transition-transform !right-[-6px]"
            />
          </div>
          <div className="flex items-center justify-between bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5 text-xs text-rose-800 font-bold relative">
            <span>✕ Else (No)</span>
            <Handle
              type="source"
              position={Position.Right}
              id="false"
              className="!w-3 !h-3 !bg-rose-500 !border-2 !border-white shadow-md hover:!scale-125 transition-transform !right-[-6px]"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// --- F. SMART DELAY NODE ---
export function DelayNode({ data, id }: { data: any; id: string }) {
  return (
    <div className="w-[280px] bg-white rounded-2xl border-2 border-slate-400 shadow-xl shadow-slate-500/10 overflow-hidden font-sans transition-all hover:shadow-2xl">
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="!w-3.5 !h-3.5 !bg-slate-600 !border-2 !border-white shadow-md hover:!scale-125 transition-transform"
      />

      <div className="bg-gradient-to-r from-slate-700 to-slate-800 px-4 py-2.5 flex items-center justify-between text-white">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-white/20 flex items-center justify-center">
            <Clock size={14} className="text-white" />
          </div>
          <span className="text-xs font-black tracking-wide uppercase">Smart Delay</span>
        </div>
        <span className="text-[10px] font-bold bg-white/25 px-2 py-0.5 rounded-full">Wait</span>
      </div>

      <div className="p-3.5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 font-black text-sm">
          {data.duration || '15m'}
        </div>
        <div>
          <span className="text-xs font-bold text-slate-900 block">Wait {data.durationLabel || '15 Minutes'}</span>
          <span className="text-[11px] text-slate-500">Then proceed down flow</span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="!w-3.5 !h-3.5 !bg-slate-600 !border-2 !border-white shadow-md hover:!scale-125 transition-transform cursor-crosshair"
      />
    </div>
  )
}

// --- G. GEMINI AI AGENT NODE ---
export function AiAgentNode({ data, id }: { data: any; id: string }) {
  return (
    <div className="w-[300px] bg-white rounded-2xl border-2 border-violet-500 shadow-xl shadow-violet-500/10 overflow-hidden font-sans transition-all hover:shadow-2xl">
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="!w-3.5 !h-3.5 !bg-violet-600 !border-2 !border-white shadow-md hover:!scale-125 transition-transform"
      />

      <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2.5 flex items-center justify-between text-white">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-white/20 flex items-center justify-center">
            <Sparkles size={14} className="text-white" />
          </div>
          <span className="text-xs font-black tracking-wide uppercase">Gemini AI Agent</span>
        </div>
        <span className="text-[10px] font-bold bg-white/25 px-2 py-0.5 rounded-full">AI Bot</span>
      </div>

      <div className="p-3.5 space-y-2">
        <p className="text-xs font-bold text-slate-900">{data.title || 'Conversational Advisor'}</p>
        <p className="text-[11px] text-slate-600 bg-violet-50/70 p-2 rounded-xl border border-violet-100">
          {data.prompt || 'Handles prospect queries, qualifies intent, and sends property brochure.'}
        </p>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="!w-3.5 !h-3.5 !bg-violet-600 !border-2 !border-white shadow-md hover:!scale-125 transition-transform cursor-crosshair"
      />
    </div>
  )
}

// Map custom node types
const nodeTypes = {
  triggerNode: TriggerNode,
  whatsappMessageNode: WhatsAppMessageNode,
  actionNode: ActionNode,
  inventoryDeliveryNode: InventoryDeliveryNode,
  conditionNode: ConditionNode,
  delayNode: DelayNode,
  aiAgentNode: AiAgentNode
}

// ============================================================================
// 2. MAIN MANYCHAT / CHATBOTX VISUAL FLOW CANVAS COMPONENT
// ============================================================================

interface ManyChatCanvasProps {
  flowName: string
  onUpdateFlowName: (name: string) => void
  isActive: boolean
  onToggleActive: () => void
  onSave: (nodes: Node[], edges: Edge[]) => void
  saving?: boolean
  initialNodes?: Node[]
  initialEdges?: Edge[]
}

export function ManyChatCanvas({
  flowName,
  onUpdateFlowName,
  isActive,
  onToggleActive,
  onSave,
  saving = false,
  initialNodes,
  initialEdges
}: ManyChatCanvasProps) {
  // CLEAN 2-NODE FUNDAMENTAL RECIPE:
  // Node 1: WhatsApp Template Message (Starting Step with [Interested] button)
  //   --> connected directly to -->
  // Node 2: WhatsApp Message (Free Flow Reply that sends Inventory link & alerts admin!)
  const defaultNodes: Node[] = useMemo(
    () => [
      {
        id: 'node_template',
        type: 'triggerNode',
        position: { x: 80, y: 140 },
        data: {
          title: 'WhatsApp Broadcast Template',
          templateName: 'client_project_announcement',
          message:
            'Hi {{1}}! We just launched luxury 3 & 4 BHK residences with private terrace suites. Special inaugural pricing available for early bookings! Are you interested to explore?',
          buttons: [
            { id: 'interested', title: 'Interested 🌟' },
            { id: 'not_interested', title: 'Not Interested' }
          ]
        }
      },
      {
        id: 'node_reply',
        type: 'whatsappMessageNode',
        position: { x: 560, y: 120 },
        data: {
          title: 'Deliver Inventory & Alert Admin',
          message:
            'Awesome! 🌟 Here is our live property inventory, floor plans, and pricing sheet for {{business_name}}:\n\n👉 {{inventory_url}}',
          buttons: [
            { id: 'btn_view_inv', title: 'View Inventory 🏢', url: '{{inventory_url}}' }
          ],
          notifyAdmin: true,
          crmStage: 'Interested',
          addTag: 'Campaign - Clicked Interested'
        }
      }
    ],
    []
  )

  const defaultEdges: Edge[] = useMemo(
    () => [
      {
        id: 'edge_interested_to_reply',
        source: 'node_template',
        sourceHandle: 'btn_interested',
        target: 'node_reply',
        targetHandle: 'input',
        animated: true,
        style: { stroke: '#10B981', strokeWidth: 3 }
      }
    ],
    []
  )

  const [nodes, setNodes] = useState<Node[]>(initialNodes && initialNodes.length > 0 ? initialNodes : defaultNodes)
  const [edges, setEdges] = useState<Edge[]>(initialEdges && initialEdges.length > 0 ? initialEdges : defaultEdges)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [isInspectorOpen, setIsInspectorOpen] = useState(false)

  const onNodesChange = useCallback((changes: any) => setNodes(nds => applyNodeChanges(changes, nds)), [])
  const onEdgesChange = useCallback((changes: any) => setEdges(eds => applyEdgeChanges(changes, eds)), [])
  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges(eds =>
        addEdge(
          {
            ...connection,
            animated: true,
            style: { stroke: '#6366F1', strokeWidth: 2.5 }
          },
          eds
        )
      ),
    []
  )

  const selectedNode = useMemo(
    () => nodes.find(n => n.id === selectedNodeId) as (Node & { data: any }) | undefined,
    [nodes, selectedNodeId]
  )

  // Update selected node data
  const handleUpdateNodeData = (field: string, value: any) => {
    if (!selectedNodeId) return
    setNodes(nds =>
      nds.map(n => {
        if (n.id === selectedNodeId) {
          return {
            ...n,
            data: {
              ...n.data,
              [field]: value
            }
          }
        }
        return n
      })
    )
  }

  // Add a new node to canvas
  const handleAddNode = (
    type: 'triggerNode' | 'whatsappMessageNode' | 'actionNode' | 'inventoryDeliveryNode' | 'conditionNode' | 'delayNode' | 'aiAgentNode'
  ) => {
    const newId = 'node_' + Date.now()
    const xPos = 400 + Math.random() * 200
    const yPos = 200 + Math.random() * 200

    let newNode: Node = {
      id: newId,
      type,
      position: { x: xPos, y: yPos },
      data: {}
    }

    if (type === 'triggerNode') {
      newNode.data = {
        title: 'WhatsApp Broadcast Template',
        templateName: 'new_campaign_template',
        message: 'Enter your template message content here...',
        buttons: [{ id: 'interested', title: 'Interested 🌟' }, { id: 'not_interested', title: 'Not Interested' }]
      }
    } else if (type === 'whatsappMessageNode') {
      newNode.data = {
        title: 'WhatsApp Reply Message',
        message: 'Thank you for your response! How can our team assist you today?',
        buttons: [{ id: 'btn_' + Date.now(), title: 'View Inventory 🏢', url: '{{inventory_url}}' }],
        notifyAdmin: true,
        crmStage: 'Interested'
      }
    } else if (type === 'actionNode') {
      newNode.data = {
        actions: [
          { type: 'notify_admin', title: 'Notify Admin Immediately', detail: 'Push alert + Bell + WhatsApp notification' },
          { type: 'crm_stage', title: 'Update CRM Stage', detail: 'Move to Interested' }
        ]
      }
    } else if (type === 'inventoryDeliveryNode') {
      newNode.data = {
        message: 'Here is our verified property catalog:\n\n👉 {{inventory_url}}',
        link: '{{inventory_url}}'
      }
    } else if (type === 'conditionNode') {
      newNode.data = {
        title: 'Check Lead Status',
        condition: 'Clicked Interested == True'
      }
    } else if (type === 'delayNode') {
      newNode.data = {
        duration: '15m',
        durationLabel: '15 Minutes'
      }
    } else if (type === 'aiAgentNode') {
      newNode.data = {
        title: 'Gemini Conversational Agent',
        prompt: 'Qualify lead intent, answer property queries, and schedule site visit.'
      }
    }

    setNodes(prev => [...prev, newNode])
    setSelectedNodeId(newId)
    setIsInspectorOpen(true)
  }

  return (
    <div className="flex flex-col h-full w-full bg-slate-50 relative font-sans select-none">
      {/* ========================================================================= */}
      {/* TOP ACTION BAR (ManyChat / ChatbotX style) */}
      {/* ========================================================================= */}
      <div className="bg-white border-b border-slate-200 px-6 py-2.5 flex items-center justify-between shadow-xs shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-emerald-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
            <Bot size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={flowName}
                onChange={e => onUpdateFlowName(e.target.value)}
                className="text-sm font-black text-slate-900 bg-transparent hover:bg-slate-100 px-2 py-0.5 rounded-lg border border-transparent hover:border-slate-200 transition-colors focus:bg-white focus:border-indigo-500 focus:outline-none"
              />
              <button
                onClick={onToggleActive}
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border transition-all cursor-pointer ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                    : 'bg-slate-100 text-slate-500 border-slate-300'
                }`}
              >
                {isActive ? '● Active' : '○ Paused'}
              </button>
            </div>
            <p className="text-[10px] text-slate-400 px-2">
              ManyChat Visual Workflow • Drag lines from button ports directly to the reply cards
            </p>
          </div>
        </div>

        {/* Action Controls & Node Palette */}
        <div className="flex items-center gap-2">
          {/* Node Palette Dropdown */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 flex-wrap">
            <button
              onClick={() => handleAddNode('triggerNode')}
              className="px-2.5 py-1.5 bg-white hover:bg-indigo-50 text-indigo-700 font-bold text-xs rounded-lg shadow-2xs border border-slate-200 flex items-center gap-1 cursor-pointer transition-colors"
              title="Add WhatsApp Broadcast Template Starting Step"
            >
              <Zap size={12} className="text-amber-500 fill-amber-500" /> + Template
            </button>
            <button
              onClick={() => handleAddNode('whatsappMessageNode')}
              className="px-2.5 py-1.5 bg-white hover:bg-emerald-50 text-emerald-700 font-bold text-xs rounded-lg shadow-2xs border border-slate-200 flex items-center gap-1 cursor-pointer transition-colors"
              title="Add WhatsApp Message free-flow reply card"
            >
              <Plus size={12} /> + Message
            </button>
            <button
              onClick={() => handleAddNode('actionNode')}
              className="px-2.5 py-1.5 bg-white hover:bg-violet-50 text-violet-700 font-bold text-xs rounded-lg shadow-2xs border border-slate-200 flex items-center gap-1 cursor-pointer transition-colors"
              title="Add Actions Block: Notify Admin, Update Stage, Tag"
            >
              <Zap size={12} /> + Actions
            </button>
            <button
              onClick={() => handleAddNode('conditionNode')}
              className="px-2.5 py-1.5 bg-white hover:bg-amber-50 text-amber-700 font-bold text-xs rounded-lg shadow-2xs border border-slate-200 flex items-center gap-1 cursor-pointer transition-colors"
              title="Add Condition / Filter logic branching"
            >
              <Split size={12} /> + Condition
            </button>
            <button
              onClick={() => handleAddNode('delayNode')}
              className="px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-lg shadow-2xs border border-slate-200 flex items-center gap-1 cursor-pointer transition-colors"
              title="Add Smart Delay wait timer"
            >
              <Clock size={12} /> + Delay
            </button>
            <button
              onClick={() => handleAddNode('aiAgentNode')}
              className="px-2.5 py-1.5 bg-white hover:bg-purple-50 text-purple-700 font-bold text-xs rounded-lg shadow-2xs border border-slate-200 flex items-center gap-1 cursor-pointer transition-colors"
              title="Add Gemini AI conversational agent"
            >
              <Sparkles size={12} /> + AI Agent
            </button>
          </div>

          {/* Reset View */}
          <button
            onClick={() => {
              setNodes(defaultNodes)
              setEdges(defaultEdges)
            }}
            className="p-2 text-slate-500 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors cursor-pointer"
            title="Reset to Recommended Recipe"
          >
            <RotateCcw size={15} />
          </button>

          {/* Save / Publish */}
          <button
            onClick={() => onSave(nodes, edges)}
            disabled={saving}
            className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs rounded-xl shadow-sm shadow-emerald-600/20 flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 disabled:opacity-50"
          >
            <Save size={13} />
            {saving ? 'Publishing...' : 'Save & Publish Flow'}
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2D CANVAS CONTAINER */}
      {/* ========================================================================= */}
      <div className="flex-1 w-full h-full relative overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          attributionPosition="bottom-left"
          onNodeClick={(_, node) => {
            setSelectedNodeId(node.id)
            setIsInspectorOpen(true)
          }}
          onPaneClick={() => {
            setSelectedNodeId(null)
            setIsInspectorOpen(false)
          }}
        >
          <Background color="#CBD5E1" gap={22} size={1.5} variant={BackgroundVariant.Dots} />
          <Controls position="bottom-left" className="!bg-white !rounded-xl !border !border-slate-200 !shadow-lg" />
          <MiniMap
            position="bottom-right"
            nodeColor="#6366F1"
            className="!bg-white !rounded-2xl !border !border-slate-200 !shadow-lg overflow-hidden"
          />

          {/* Canvas Help Callout */}
          <Panel position="top-left" className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl p-3 shadow-md max-w-xs">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 mb-1">
              <Sparkles size={14} className="text-amber-500" />
              <span>ManyChat Visual Workflow</span>
            </div>
            <p className="text-[11px] text-slate-500 leading-snug">
              When prospect taps <span className="font-bold text-indigo-600">[Interested 🌟]</span> on the template, the flow sends the reply message with the inventory link and notifies the admin! Click any node to configure.
            </p>
          </Panel>
        </ReactFlow>

        {/* ========================================================================= */}
        {/* NODE INSPECTOR DRAWER (Side Editor with Complete Form for Every Node) */}
        {/* ========================================================================= */}
        {isInspectorOpen && selectedNode && (
          <div className="absolute top-4 right-4 w-[420px] max-w-[92vw] bg-white rounded-3xl border border-slate-200 shadow-2xl z-20 overflow-hidden flex flex-col max-h-[calc(100%-32px)] animate-in slide-in-from-right duration-200 font-sans">
            {/* Drawer Header */}
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
                  <SlidersHorizontal size={16} />
                </div>
                <div>
                  <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                    {selectedNode.type === 'triggerNode' ? 'WhatsApp Template Configuration'
                      : selectedNode.type === 'whatsappMessageNode' ? 'WhatsApp Reply Configuration'
                      : selectedNode.type === 'actionNode' ? 'Actions Configuration'
                      : selectedNode.type === 'conditionNode' ? 'Condition Filter'
                      : selectedNode.type === 'delayNode' ? 'Smart Delay Configuration'
                      : selectedNode.type === 'aiAgentNode' ? 'Gemini AI Agent Configuration'
                      : 'Configure Node'}
                  </h3>
                  <p className="text-[10px] text-slate-500">Customize parameters, buttons & triggers</p>
                </div>
              </div>
              <button
                onClick={() => setIsInspectorOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Drawer Body */}
            <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              
              {/* === 1. IF WHATSAPP TEMPLATE NODE (Starting Step) === */}
              {selectedNode.type === 'triggerNode' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Step Label / Title
                    </label>
                    <input
                      type="text"
                      value={selectedNode.data.title || ''}
                      onChange={e => handleUpdateNodeData('title', e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:border-indigo-500 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      WhatsApp Template Name
                    </label>
                    <input
                      type="text"
                      value={selectedNode.data.templateName || ''}
                      onChange={e => handleUpdateNodeData('templateName', e.target.value)}
                      placeholder="e.g. client_project_announcement"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono font-bold text-indigo-700 focus:bg-white focus:border-indigo-500 outline-none"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Must match the approved Meta template identifier sent in your campaign broadcast.
                    </span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Template Message Preview
                    </label>
                    <textarea
                      rows={4}
                      value={selectedNode.data.message || ''}
                      onChange={e => handleUpdateNodeData('message', e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-900 focus:bg-white focus:border-indigo-500 outline-none leading-relaxed"
                    />
                  </div>

                  {/* Template Quick Reply Buttons */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-[11px] font-bold text-slate-700">
                        Template Quick Reply Buttons
                      </label>
                      <span className="text-[10px] text-indigo-600 font-semibold">Each button creates an output port</span>
                    </div>

                    <div className="space-y-2">
                      {(selectedNode.data.buttons || []).map((btn: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 shrink-0 ml-1" />
                          <input
                            type="text"
                            value={btn.title}
                            onChange={e => {
                              const updated = [...(selectedNode.data.buttons || [])]
                              updated[idx] = { ...updated[idx], title: e.target.value }
                              handleUpdateNodeData('buttons', updated)
                            }}
                            className="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-900"
                          />
                          <button
                            onClick={() => {
                              const updated = (selectedNode.data.buttons || []).filter((_: any, i: number) => i !== idx)
                              handleUpdateNodeData('buttons', updated)
                            }}
                            className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer"
                            title="Remove button"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={() => {
                        const updated = [
                          ...(selectedNode.data.buttons || []),
                          { id: 'btn_' + Date.now(), title: 'Quick Reply' }
                        ]
                        handleUpdateNodeData('buttons', updated)
                      }}
                      className="mt-2 w-full py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl border border-indigo-200 text-xs flex items-center justify-center gap-1 cursor-pointer transition-colors"
                    >
                      <Plus size={13} /> Add Quick Reply Button
                    </button>
                  </div>
                </div>
              )}

              {/* === 2. IF WHATSAPP MESSAGE NODE (Free Flow Reply) === */}
              {selectedNode.type === 'whatsappMessageNode' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Step Title
                    </label>
                    <input
                      type="text"
                      value={selectedNode.data.title || ''}
                      onChange={e => handleUpdateNodeData('title', e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:border-emerald-500 outline-none"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] font-bold text-slate-700">
                        Reply Message Body
                      </label>
                      <span className="text-[10px] text-slate-400">Click tag to insert:</span>
                    </div>
                    <textarea
                      rows={5}
                      value={selectedNode.data.message || ''}
                      onChange={e => handleUpdateNodeData('message', e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-900 focus:bg-white focus:border-emerald-500 outline-none leading-relaxed"
                    />
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {['{{lead_name}}', '{{inventory_url}}', '{{business_name}}'].map(tag => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => handleUpdateNodeData('message', (selectedNode.data.message || '') + ' ' + tag)}
                          className="px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-md font-mono text-[10px] font-bold border border-emerald-200 cursor-pointer"
                        >
                          + {tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Buttons / CTA Links on Message */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1.5">
                      CTA Buttons & Links
                    </label>
                    <div className="space-y-2">
                      {(selectedNode.data.buttons || []).map((btn: any, idx: number) => (
                        <div key={idx} className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={btn.title}
                              placeholder="Button Label"
                              onChange={e => {
                                const updated = [...(selectedNode.data.buttons || [])]
                                updated[idx] = { ...updated[idx], title: e.target.value }
                                handleUpdateNodeData('buttons', updated)
                              }}
                              className="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-900"
                            />
                            <button
                              onClick={() => {
                                const updated = (selectedNode.data.buttons || []).filter((_: any, i: number) => i !== idx)
                                handleUpdateNodeData('buttons', updated)
                              }}
                              className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                          <input
                            type="text"
                            value={btn.url || ''}
                            placeholder="Destination URL (e.g. {{inventory_url}})"
                            onChange={e => {
                              const updated = [...(selectedNode.data.buttons || [])]
                              updated[idx] = { ...updated[idx], url: e.target.value }
                              handleUpdateNodeData('buttons', updated)
                            }}
                            className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-[11px] font-mono text-slate-700"
                          />
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        const updated = [
                          ...(selectedNode.data.buttons || []),
                          { id: 'btn_' + Date.now(), title: 'View Inventory 🏢', url: '{{inventory_url}}' }
                        ]
                        handleUpdateNodeData('buttons', updated)
                      }}
                      className="mt-2 w-full py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold rounded-xl border border-emerald-200 text-xs flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Plus size={13} /> Add CTA Link Button
                    </button>
                  </div>

                  {/* Built-in Automations Triggered on Send */}
                  <div className="pt-3 border-t border-slate-200 space-y-2.5">
                    <span className="text-[11px] font-black text-slate-900 uppercase tracking-wider block">
                      Automations Triggered on Send
                    </span>

                    {/* Notify Admin */}
                    <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 hover:border-amber-300 bg-slate-50/70 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedNode.data.notifyAdmin !== false}
                        onChange={e => handleUpdateNodeData('notifyAdmin', e.target.checked)}
                        className="mt-0.5 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                      />
                      <div>
                        <span className="font-bold text-slate-900 block text-xs">🔔 Notify Admin Immediately</span>
                        <span className="text-[10px] text-slate-500 block">Sends high-priority push, in-app bell, and WhatsApp alert with CRM link to owner.</span>
                      </div>
                    </label>

                    {/* CRM Stage Update */}
                    <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                          <TrendingUp size={13} className="text-emerald-600" />
                          Update Lead CRM Stage
                        </span>
                      </div>
                      <select
                        value={selectedNode.data.crmStage || 'Interested'}
                        onChange={e => handleUpdateNodeData('crmStage', e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-900 cursor-pointer"
                      >
                        <option value="Interested">Interested</option>
                        <option value="Site Visit Planned">Site Visit Planned</option>
                        <option value="Contacted">Contacted</option>
                        <option value="Qualified">Qualified</option>
                        <option value="Negotiation">Negotiation</option>
                      </select>
                    </div>

                    {/* Attach Tag */}
                    <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1.5">
                      <span className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                        <Tag size={13} className="text-blue-600" />
                        Attach Contact Tag
                      </span>
                      <input
                        type="text"
                        value={selectedNode.data.addTag || ''}
                        onChange={e => handleUpdateNodeData('addTag', e.target.value)}
                        placeholder="e.g. Campaign - Clicked Interested"
                        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-900"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* === 3. IF ACTION NODE === */}
              {selectedNode.type === 'actionNode' && (
                <div className="space-y-3">
                  <label className="block text-[11px] font-bold text-slate-700">Configured Actions</label>
                  <div className="space-y-2">
                    {(selectedNode.data.actions || []).map((act: any, idx: number) => (
                      <div key={idx} className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-black text-slate-900">{act.title}</span>
                          <button
                            onClick={() => {
                              const updated = (selectedNode.data.actions || []).filter((_: any, i: number) => i !== idx)
                              handleUpdateNodeData('actions', updated)
                            }}
                            className="text-rose-500 hover:text-rose-700 p-1"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        <input
                          type="text"
                          value={act.detail}
                          onChange={e => {
                            const updated = [...(selectedNode.data.actions || [])]
                            updated[idx] = { ...updated[idx], detail: e.target.value }
                            handleUpdateNodeData('actions', updated)
                          }}
                          className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] text-slate-700"
                        />
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => {
                      const updated = [
                        ...(selectedNode.data.actions || []),
                        { type: 'notify_admin', title: 'Notify Admin', detail: 'Instant Push & WhatsApp Alert' }
                      ]
                      handleUpdateNodeData('actions', updated)
                    }}
                    className="w-full py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl border border-indigo-200 text-xs flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Plus size={13} /> Add Another Task
                  </button>
                </div>
              )}

              {/* === 4. IF CONDITION NODE === */}
              {selectedNode.type === 'conditionNode' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1.5">Condition Title</label>
                    <input
                      type="text"
                      value={selectedNode.data.title || ''}
                      onChange={e => handleUpdateNodeData('title', e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1.5">Rule / Condition</label>
                    <input
                      type="text"
                      value={selectedNode.data.condition || ''}
                      onChange={e => handleUpdateNodeData('condition', e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900"
                      placeholder="e.g. Clicked Interested == True"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Connect the <span className="text-emerald-600 font-bold">Match (Yes)</span> port or <span className="text-rose-600 font-bold">Else (No)</span> port to different action cards.
                  </p>
                </div>
              )}

              {/* === 5. IF DELAY NODE === */}
              {selectedNode.type === 'delayNode' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1.5">Wait Duration</label>
                    <select
                      value={selectedNode.data.duration || '15m'}
                      onChange={e => {
                        const val = e.target.value
                        const label = val === '5m' ? '5 Minutes' : val === '15m' ? '15 Minutes' : val === '1h' ? '1 Hour' : val === '1d' ? '1 Day' : '15 Minutes'
                        handleUpdateNodeData('duration', val)
                        handleUpdateNodeData('durationLabel', label)
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-bold"
                    >
                      <option value="5m">5 Minutes</option>
                      <option value="15m">15 Minutes</option>
                      <option value="1h">1 Hour</option>
                      <option value="4h">4 Hours</option>
                      <option value="1d">1 Day</option>
                    </select>
                  </div>
                </div>
              )}

              {/* === 6. IF AI AGENT NODE === */}
              {selectedNode.type === 'aiAgentNode' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1.5">Agent Role Title</label>
                    <input
                      type="text"
                      value={selectedNode.data.title || ''}
                      onChange={e => handleUpdateNodeData('title', e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1.5">Agent Prompt & Instructions</label>
                    <textarea
                      rows={5}
                      value={selectedNode.data.prompt || ''}
                      onChange={e => handleUpdateNodeData('prompt', e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900"
                    />
                  </div>
                </div>
              )}

              {/* === 7. IF INVENTORY DELIVERY NODE === */}
              {selectedNode.type === 'inventoryDeliveryNode' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1.5">Inventory Message</label>
                    <textarea
                      rows={4}
                      value={selectedNode.data.message || ''}
                      onChange={e => handleUpdateNodeData('message', e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1.5">Catalog URL Tag</label>
                    <input
                      type="text"
                      value={selectedNode.data.link || '{{inventory_url}}'}
                      onChange={e => handleUpdateNodeData('link', e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
                    />
                  </div>
                </div>
              )}

              {/* Delete Node Button */}
              <div className="pt-4 border-t border-slate-200">
                <button
                  onClick={() => {
                    setNodes(nds => nds.filter(n => n.id !== selectedNodeId))
                    setEdges(eds => eds.filter(e => e.source !== selectedNodeId && e.target !== selectedNodeId))
                    setIsInspectorOpen(false)
                  }}
                  className="w-full py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Trash2 size={14} /> Delete This Node
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
