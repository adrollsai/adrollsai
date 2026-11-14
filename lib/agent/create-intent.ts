/**
 * The chat message a Create panel submission turns into.
 *
 * Kept out of the component and pure so it can be asserted: the panel must always
 * produce an unambiguous brief, and must always ask for the single pre-flight review
 * before any billable generation, whatever combination of options the user picked.
 */

export type CreateKind = 'image' | 'video' | 'voiceover';

export interface CreateIntent {
  kind: CreateKind;
  ratio?: string;
  resolution?: '480p' | '720p';
  seconds?: number;
  refMode?: 'random' | 'pick' | 'none';
  reference?: { id: string; name: string; category?: string } | null;
  brief?: string;
  businessName?: string;
}

const LABEL: Record<CreateKind, string> = {
  image: 'image creative',
  video: 'video reel',
  voiceover: 'voiceover',
};

export function buildCreateIntent(intent: CreateIntent): string {
  const lines: string[] = [];
  lines.push(`New creation — ${LABEL[intent.kind]}`);

  if (intent.ratio) lines.push(`Dimensions: ${intent.ratio}`);
  if (intent.kind === 'video') {
    const res = intent.resolution || '720p';
    const secs = intent.seconds || 15;
    lines.push(`Resolution: ${res}, about ${secs}s`);
  }

  if (intent.kind !== 'voiceover') {
    if (intent.refMode === 'pick' && intent.reference) {
      const cat = intent.reference.category ? `, ${intent.reference.category}` : '';
      lines.push(
        `Reference: "${intent.reference.name}" (${intent.reference.id}${cat}) — keep its layout and type treatment, replace the place and brand with mine.`
      );
    } else if (intent.refMode === 'none') {
      lines.push('Reference: none — design it from the brand profile.');
    } else {
      lines.push(
        'Reference: none given — pick one reference creative that fits the brief, say which you picked and why, and keep its layout and type treatment while replacing the place and brand with mine.'
      );
    }
  }

  const brief = (intent.brief || '').trim();
  lines.push(
    `Brief: ${
      brief || `use my business profile${intent.businessName ? ` (${intent.businessName})` : ''}`
    }`
  );

  // What counts as "prepared" differs per kind: the point is that the user reviews real
  // material, not a promise, and that the expensive artefact is the thing behind the gate.
  const prepare =
    intent.kind === 'video'
      ? 'Write the script, choose the voice and generate the voiceover audio as a preview, pick the dimensions and the reference, and list the shots.'
      : intent.kind === 'image'
      ? 'Write the exact headline and sub-copy, choose the reference creative, and state the dimensions and the layout you will follow.'
      : 'Write the script and state the voice, language and read speed you will use.';

  lines.push(
    `${prepare} Then stop exactly once — right before the first paid generation — and call request_human_approval with the whole plan (script, voice, dimensions, reference, cost) so I can approve it. ` +
      'A sandbox or HTML mock-up is not the deliverable for this job: the real asset is the generated image/video/audio, and that waits for my approval.'
  );

  return lines.join('\n');
}
