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
 *   3. the exact shape of the retry — the same tool, the same arguments, plus the approvalId
 *
 * WHY THE ARGUMENTS ARE STILL REQUIRED, EVEN THOUGH THEY ARE IGNORED
 * The gate runs the STORED payload when an approvalId matches, so the caller's arguments cannot
 * change what executes. It is tempting to say "pass only the approvalId", and that is what this
 * sentence used to say. It is wrong: every gated tool's own schema still marks its real fields
 * required, so a call carrying nothing but an id is rejected by validation and never reaches
 * `execute` at all. Measured: 0 of 11 gated tools accept a bare approvalId.
 *
 * The cost of getting this wrong is silent. In a live video run the agent did exactly as told, the
 * `generate_voiceover { approvalId }` call produced no tool result at all, the agent moved on, and
 * the delivered film had no soundtrack — with no error anywhere to explain it. So the instruction
 * now asks for both: the id AND the arguments.
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
    `Execute it now: call the same tool again, pass this approvalId: ${actionId}, and repeat the arguments you ` +
      'originally staged.',
    'With a matching approvalId the APPROVED arguments are what actually run, so the ones you repeat cannot ' +
      'change the job — but they must still be present, because the tool rejects a call that omits its required ' +
      'fields. A call carrying only the approvalId will fail before it reaches the gate.',
    'If a tool still refuses, stop and tell the owner exactly what it said — never ask for the same approval twice.',
  ];

  const modelSentence = String(input.resumePrompt ?? '').trim();
  if (modelSentence) lines.push(`The staged instruction was: ${modelSentence}`);

  return lines.join('\n');
}
