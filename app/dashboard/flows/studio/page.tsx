'use client';

/**
 * Flow Studio — the clean flow editor.
 *
 * Replaces the 700 KB multi-view builder with one screen:
 *   left  — flow list + create
 *   centre— the canvas
 *   right — inspector for the selected node
 *
 * Two rules shape the design:
 *  1. The palette is GENERATED from lib/flows/schema.ts, so the editor can only
 *     offer nodes the engine actually executes. That is what stops a flow from
 *     being built out of steps that silently do nothing.
 *  2. Validation is shown live, and the server refuses to activate a broken
 *     flow, so problems surface while you build instead of in production.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  BackgroundVariant,
  Handle,
  Position,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { NODE_SPECS, validateFlow, specFor, type NodeSpec } from '@/lib/flows/schema';

/* ── palette, derived from the engine contract ───────────────────────────── */
const PALETTE: NodeSpec[] = NODE_SPECS.filter((s) => s.support !== 'unsupported');

const CATEGORY_LABEL: Record<NodeSpec['category'], string> = {
  trigger: 'When this happens',
  message: 'Send something',
  logic: 'Decide',
  crm: 'Update the lead',
  notify: 'Notify',
  integration: 'Connect out',
  delay: 'Wait',
};

const CATEGORY_ORDER: NodeSpec['category'][] = ['trigger', 'message', 'logic', 'crm', 'notify', 'integration', 'delay'];

/* ── a plain, readable node ──────────────────────────────────────────────── */
function FlowNode({ data, type }: { data: any; type: string }) {
  const spec = specFor(type);
  const isTrigger = spec?.category === 'trigger';
  return (
    <div
      className="rounded-xl border bg-white text-slate-900 shadow-sm min-w-[190px] max-w-[240px]"
      style={{ borderColor: isTrigger ? '#0f172a' : '#e2e8f0' }}
    >
      {!isTrigger && <Handle type="target" position={Position.Left} />}
      <div
        className="px-3 py-1.5 rounded-t-xl text-[10px] font-semibold uppercase tracking-wide"
        style={{
          background: isTrigger ? '#0f172a' : '#f8fafc',
          color: isTrigger ? '#fff' : '#64748b',
        }}
      >
        {spec ? CATEGORY_LABEL[spec.category] : 'Step'}
      </div>
      <div className="px-3 py-2">
        <div className="text-[13px] font-semibold leading-tight">{data?.title || spec?.label || type}</div>
        {data?.message && (
          <div className="mt-1 text-[11px] text-slate-500 line-clamp-2">{String(data.message)}</div>
        )}
        {data?.stage && <div className="mt-1 text-[11px] text-slate-500">→ {data.stage}</div>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function BranchNode({ data }: { data: any }) {
  // Conditions expose two labelled exits so the branch is visible on the canvas.
  return (
    <div className="rounded-xl border border-slate-300 bg-amber-50 shadow-sm min-w-[180px]">
      <Handle type="target" position={Position.Left} />
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
        Decide
      </div>
      <div className="px-3 pb-2 text-[12px] text-slate-700">
        {data?.field ? `${data.field} ${data.operator || 'contains'} ${JSON.stringify(data.value ?? '')}` : 'No condition set'}
      </div>
      <div className="flex justify-between px-3 pb-2 text-[10px] font-semibold">
        <span className="text-emerald-600">yes</span>
        <span className="text-rose-600">no</span>
      </div>
      <Handle id="true" type="source" position={Position.Bottom} style={{ left: '30%' }} />
      <Handle id="false" type="source" position={Position.Bottom} style={{ left: '70%' }} />
    </div>
  );
}

const nodeTypes = {
  triggerNode: FlowNode,
  whatsappMessageNode: FlowNode,
  notifyNode: FlowNode,
  crmStageNode: FlowNode,
  tagNode: FlowNode,
  customApiNode: FlowNode,
  aiCallNode: FlowNode,
  emailNode: FlowNode,
  inventoryDeliveryNode: FlowNode,
  aiAgentNode: FlowNode,
  actionNode: FlowNode,
  delayNode: FlowNode,
  conditionNode: BranchNode,
  action_condition: BranchNode,
  action_qualify: FlowNode,
  action_split_traffic: FlowNode,
};

/** Canvas renderer for a palette entry — conditions use the branching node. */
function canvasTypeFor(spec: NodeSpec): string {
  if (spec.category === 'logic' && (spec.type === 'action_condition' || spec.type === 'conditionNode')) {
    return 'conditionNode';
  }
  if (nodeTypes[spec.type as keyof typeof nodeTypes]) return spec.type;
  return spec.category === 'trigger' ? 'triggerNode' : 'actionNode';
}

interface FlowSummary {
  id: string;
  name: string;
  isActive: boolean;
  nodes: any[];
  edges: any[];
  stats?: { runs?: number };
}

export default function FlowStudioPage() {
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState('Untitled flow');
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFlows = useCallback(async () => {
    try {
      const res = await fetch('/api/flows');
      const body = await res.json();
      setFlows(body.flows || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFlows();
  }, [loadFlows]);

  const openFlow = (f: FlowSummary) => {
    setActiveId(f.id);
    setName(f.name);
    setNodes((f.nodes || []).map((n: any) => ({ id: n.id, type: n.type, position: n.position || { x: 80, y: 80 }, data: n.data || {} })));
    setEdges((f.edges || []).map((e: any) => ({ id: e.id || `${e.source}-${e.target}`, source: e.source, target: e.target, sourceHandle: e.sourceHandle })));
    setSelected(null);
    setIssues([]);
  };

  const newFlow = () => {
    setActiveId(null);
    setName('Untitled flow');
    setNodes([
      {
        id: 'node_trigger',
        type: 'triggerNode',
        position: { x: 60, y: 140 },
        data: { title: 'Inbound WhatsApp message', triggerType: 'whatsapp_inbound' },
      },
    ]);
    setEdges([]);
    setSelected(null);
    setIssues([]);
  };

  const validation = useMemo(
    () => validateFlow({ nodes: nodes as any[], edges: edges as any[] }),
    [nodes, edges]
  );

  const addNode = (spec: NodeSpec) => {
    const id = `n_${Date.now().toString(36)}`;
    const triggerType = spec.category === 'trigger' ? (spec.config?.includes('campaignId') ? 'meta_ad' : 'whatsapp_inbound') : undefined;
    setNodes((cur) => [
      ...cur,
      {
        id,
        type: canvasTypeFor(spec),
        position: { x: 360, y: 60 + cur.length * 110 },
        data: { title: spec.label, ...(triggerType ? { triggerType } : {}) },
      },
    ]);
    setSelected(id);
  };

  const selectedNode = nodes.find((n) => n.id === selected) || null;
  const selectedSpec = selectedNode ? specFor(String(selectedNode.type)) : undefined;

  const patchSelected = (patch: Record<string, any>) =>
    setNodes((cur) => cur.map((n) => (n.id === selected ? { ...n, data: { ...n.data, ...patch } } : n)));

  const save = async (activate: boolean) => {
    setSaving(true);
    setIssues([]);
    try {
      const payload = {
        name,
        isActive: activate,
        nodes,
        edges,
        xyNodes: nodes,
        xyEdges: edges,
      };
      const res = await fetch('/api/flows', {
        method: activeId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activeId ? { ...payload, id: activeId } : payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setIssues(body.issues || [{ severity: 'error', message: body.error || 'Could not save' }]);
        return;
      }
      if (!activeId && body.flow?.id) setActiveId(body.flow.id);
      await loadFlows();
    } catch (err: any) {
      setIssues([{ severity: 'error', message: err?.message || 'Save failed' }]);
    } finally {
      setSaving(false);
    }
  };

  const errorCount = validation.issues.filter((i) => i.severity === 'error').length;
  const warnCount = validation.issues.filter((i) => i.severity === 'warning').length;

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-900">
      {/* ── flow list ─────────────────────────────────────────────────── */}
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="p-3 border-b border-slate-200">
          <h1 className="text-sm font-bold">Automations</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">WhatsApp flows &amp; lead automation</p>
          <button
            onClick={newFlow}
            className="mt-3 w-full rounded-lg bg-slate-900 text-white text-xs font-semibold py-2 hover:bg-slate-800 transition"
          >
            New flow
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading && <p className="text-[11px] text-slate-400 p-2">Loading…</p>}
          {!loading && flows.length === 0 && (
            <p className="text-[11px] text-slate-400 p-2">No flows yet.</p>
          )}
          {flows.map((f) => (
            <button
              key={f.id}
              onClick={() => openFlow(f)}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition ${
                activeId === f.id ? 'bg-slate-900 text-white' : 'hover:bg-slate-100 text-slate-700'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                    f.isActive ? 'bg-emerald-500' : 'bg-slate-300'
                  }`}
                />
                <span className="truncate font-medium">{f.name}</span>
              </span>
              <span className={`block text-[10px] mt-0.5 ${activeId === f.id ? 'text-slate-300' : 'text-slate-400'}`}>
                {f.nodes?.length || 0} steps · {f.isActive ? 'live' : 'draft'}
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* ── canvas ───────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-slate-200 bg-white">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-sm font-semibold bg-transparent outline-none border-b border-transparent focus:border-slate-300 px-1 py-0.5 min-w-0"
          />
          <div className="ml-auto flex items-center gap-2">
            {errorCount > 0 && (
              <span className="text-[11px] font-semibold text-rose-600">{errorCount} problem{errorCount > 1 ? 's' : ''}</span>
            )}
            {warnCount > 0 && <span className="text-[11px] text-amber-600">{warnCount} warning{warnCount > 1 ? 's' : ''}</span>}
            <button
              onClick={() => void save(false)}
              disabled={saving}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"
            >
              Save draft
            </button>
            <button
              onClick={() => void save(true)}
              disabled={saving || errorCount > 0}
              title={errorCount > 0 ? 'Fix the problems first' : 'Save and go live'}
              className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
            >
              Save &amp; activate
            </button>
          </div>
        </header>

        {(issues.length > 0 || validation.issues.length > 0) && (
          <div className="shrink-0 max-h-28 overflow-y-auto border-b border-slate-200 bg-white px-4 py-2 space-y-1">
            {(issues.length ? issues : validation.issues).slice(0, 6).map((iss: any, i: number) => (
              <p
                key={i}
                className={`text-[11px] ${iss.severity === 'warning' ? 'text-amber-700' : 'text-rose-700'}`}
              >
                {iss.severity === 'warning' ? 'Warning: ' : 'Error: '}
                {iss.message}
              </p>
            ))}
          </div>
        )}

        <div className="flex-1 min-h-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes as any}
            onNodesChange={(c) => setNodes((cur) => applyNodeChanges(c, cur))}
            onEdgesChange={(c) => setEdges((cur) => applyEdgeChanges(c, cur))}
            onConnect={(c: Connection) =>
              setEdges((cur) => addEdge({ ...c, id: `${c.source}-${c.target}-${c.sourceHandle || 'out'}` }, cur))
            }
            onNodeClick={(_, n) => setSelected(n.id)}
            onPaneClick={() => setSelected(null)}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#cbd5e1" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!bg-slate-100" />
          </ReactFlow>
        </div>
      </main>

      {/* ── inspector ────────────────────────────────────────────────── */}
      <aside className="w-72 shrink-0 border-l border-slate-200 bg-white flex flex-col">
        <div className="p-3 border-b border-slate-200">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Add a step</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {CATEGORY_ORDER.map((cat) => {
            const items = PALETTE.filter((s) => s.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat} className="mb-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 px-1.5 mb-1">
                  {CATEGORY_LABEL[cat]}
                </p>
                <div className="space-y-0.5">
                  {items.map((spec) => (
                    <button
                      key={spec.type}
                      onClick={() => addNode(spec)}
                      title={spec.note || spec.label}
                      className="w-full text-left px-2 py-1.5 rounded-md text-[12px] text-slate-700 hover:bg-slate-100 transition"
                    >
                      {spec.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {selectedNode && (
          <div className="border-t border-slate-200 p-3 max-h-[45%] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold">{selectedSpec?.label || selectedNode.type}</h3>
              <button
                onClick={() => {
                  setNodes((cur) => cur.filter((n) => n.id !== selectedNode.id));
                  setEdges((cur) => cur.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
                  setSelected(null);
                }}
                className="text-[11px] text-rose-600 hover:underline"
              >
                Delete
              </button>
            </div>

            <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">Title</label>
            <input
              value={String((selectedNode.data as any)?.title || '')}
              onChange={(e) => patchSelected({ title: e.target.value })}
              className="w-full mb-2 rounded-md border border-slate-300 px-2 py-1 text-xs outline-none focus:border-slate-500"
            />

            {(selectedSpec?.config || []).map((key) => (
              <div key={key} className="mb-2">
                <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">{key}</label>
                <input
                  value={
                    typeof (selectedNode.data as any)?.[key] === 'object'
                      ? JSON.stringify((selectedNode.data as any)?.[key])
                      : String((selectedNode.data as any)?.[key] ?? '')
                  }
                  onChange={(e) => {
                    const raw = e.target.value;
                    let value: any = raw;
                    if (key === 'percentA' || key === 'passScore' || key === 'seconds') {
                      value = raw === '' ? '' : Number(raw);
                    }
                    patchSelected({ [key]: value });
                  }}
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs outline-none focus:border-slate-500"
                  placeholder={key === 'field' ? 'message_text, lead.pipeline_stage…' : ''}
                />
              </div>
            ))}

            {selectedSpec?.note && (
              <p className="text-[10px] text-slate-500 leading-relaxed mt-1">{selectedSpec.note}</p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
