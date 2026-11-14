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
  actionType: 'whatsapp_broadcast' | 'bulk_call' | 'delete_data' | 'ad_spend' | 'create_asset' | 'custom';
  /** Resolved parameters the user is approving (script, voice, dimensions, template…). */
  spec?: Array<{ label: string; value: string }>;
  /** Things already produced, so the review is concrete rather than a promise. */
  previews?: Array<{ kind: 'audio' | 'image' | 'video'; url: string; caption?: string }>;
  /** Sent back to the agent when the user approves, so the job continues instead of dead-ending. */
  resumePrompt?: string;
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
