/**
 * The sentence the chat sends back to the agent when a human approves a staged action.
 *
 * WHY THIS IS BUILT IN CODE, NOT BY THE MODEL
 * `request_human_approval` takes a `resumePrompt` argument that the model writes. In production
 * it produced "Approved — generate the 1:1 Grand Opening image now with the staged spec". The
 * agent read that as a normal request, re-ran its planning, and staged the SAME approval again —
 * an approval loop. The owner taps Approve, nothing is produced, and a new card asks them to
 * approve what they just approved.
 *
 * The model cannot be relied on to write the one sentence that matters, because it does not know
 * it is inside an approval cycle. This module does know, so it says the three things that end the
 * cycle unambiguously:
 *
 *   1. the decision — approved (not "please do this")
 *   2. the identity — which actionId, so the gate and the transcript agree
 *   3. the instruction NOT to ask again, plus what to do if a tool still refuses
 *
 * The third part matters most: if the arguments the agent tries differ from what was approved,
 * the review gate will (correctly) refuse. The right move then is to say so plainly, not to loop
 * the owner through another approval.
 *
 * PURE: no clock, no ids of its own, no I/O — so the gate can assert the exact wording.
 */

export interface ResumePromptInput {
  actionId: string;
  actionType?: string;
  title?: string;
  /** The model's own sentence, kept as context rather than as the instruction. */
  resumePrompt?: string;
}

const HUMAN_LABEL: Record<string, string> = {
  whatsapp_broadcast: 'WhatsApp message',
  bulk_call: 'batch of calls',
  ad_spend: 'ad campaign',
  create_asset: 'creative',
  delete_data: 'deletion',
  custom: 'action',
};

export function buildResumePrompt(input: ResumePromptInput): string {
  const actionId = String(input.actionId ?? '').trim() || 'unknown';
  const kind = HUMAN_LABEL[String(input.actionType ?? 'custom')] ?? 'action';
  const title = String(input.title ?? '').trim();

  const lines = [
    `The owner has already reviewed and APPROVED this ${kind}${title ? ` ("${title.slice(0, 120)}")` : ''}.`,
    `Approval reference: ${actionId}.`,
    'This is not a new request — do not plan it again and do not call request_human_approval for it a second time.',
    'Execute it now, with exactly the details that were staged and approved.',
    'If a tool refuses because the arguments differ from what was approved, stop and tell the owner precisely what differs — never ask for the same approval twice.',
  ];

  const modelSentence = String(input.resumePrompt ?? '').trim();
  if (modelSentence) lines.push(`The staged instruction was: ${modelSentence}`);

  return lines.join('\n');
}
