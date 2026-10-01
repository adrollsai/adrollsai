export type ArtifactType = 'html_sandbox' | 'progress_tracker' | 'action_confirmation' | 'media_preview';

export interface HtmlSandboxArtifact {
  type: 'html_sandbox';
  title: string;
  html: string;
  description?: string;
}

export interface ProgressTrackerArtifact {
  type: 'progress_tracker';
  title: string;
  current: number;
  total: number;
  label?: string;
  stats?: Array<{ label: string; value: string | number }>;
  status: 'running' | 'completed' | 'failed' | 'paused';
}

export interface ActionConfirmationArtifact {
  type: 'action_confirmation';
  actionId: string;
  title: string;
  description: string;
  impactSummary?: string;
  estimatedCost?: string;
  actionType: 'whatsapp_broadcast' | 'bulk_call' | 'delete_data' | 'ad_spend' | 'custom';
  payload: Record<string, any>;
  status: 'pending' | 'approved' | 'rejected';
}

export interface MediaPreviewArtifact {
  type: 'media_preview';
  mediaType: 'image' | 'video' | 'audio' | 'pdf';
  url: string;
  title?: string;
  caption?: string;
}

export type AgentArtifact =
  | HtmlSandboxArtifact
  | ProgressTrackerArtifact
  | ActionConfirmationArtifact
  | MediaPreviewArtifact;

export interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  artifacts?: AgentArtifact[];
  toolCalls?: Array<{
    name: string;
    args: Record<string, any>;
    result?: any;
    state?: 'executing' | 'completed' | 'failed';
  }>;
  createdAt: string;
}
