/**
 * Video pipeline shapes: the beat structure of each kind of film a business actually asks for.
 *
 * WHY THIS EXISTS
 * Shot design (`video-shotcraft`) answers "what do I point the camera at". It does not answer "what is this
 * film, in what order, and how long does each part get". That second question is pipeline structure, and
 * without it every request collapses into the same film: an establishing shot, some type, a logo. A
 * testimonial and a product launch are not the same film with different footage — they argue differently.
 *
 * PROVENANCE, STATED PLAINLY BECAUSE IT MATTERS
 * The owner asked why we did not vendor OpenMontage, whose strongest asset is exactly this: twelve production
 * pipelines. It is AGPL-3.0, so its files cannot come into a closed-source product (see
 * docs/openmontage-decision.md). The owner's decision was to study the public material and write our own, which
 * is what this is: the *idea* that a testimonial has a different beat structure from a launch is not
 * copyrightable, and nothing here is copied, paraphrased line-by-line, or derived from their text. Every
 * structure below was written for this product's customers — Indian SMBs selling courses, property, clinics,
 * gyms and services on WhatsApp and Instagram — and is shaped by what those films have to do. No upstream text,
 * no attribution owed, and `verify:video-pipelines` asserts that claim stays honest.
 *
 * TIMINGS ARE FRACTIONS, NOT SECONDS
 * A 15-second reel and a 60-second film of the same kind share a structure but not a schedule, so every beat is
 * expressed as a fraction of the runtime and scaled when the duration is known. That is what makes the same
 * shape work at both lengths instead of being wrong at one of them.
 */

export type PipelineId =
  | 'offer-reel'
  | 'testimonial'
  | 'transformation'
  | 'launch'
  | 'explainer'
  | 'walkthrough'
  | 'credibility'
  | 'objection'
  | 'event'
  | 'recap';

export interface Beat {
  /** Fraction of the runtime, 0–1. */
  from: number;
  to: number;
  /** What this beat has to accomplish. */
  beat: string;
  /** What is on screen / said. */
  onScreen: string;
  /** How it is shot. */
  shot: string;
}

export interface VideoPipeline {
  id: PipelineId;
  name: string;
  /** What the film leaves the viewer with. */
  produces: string;
  /** Words in a brief that point at this pipeline. Used by choosePipeline, and shown to the agent. */
  bestFor: string[];
  /** Comfortable runtime range in seconds. */
  seconds: [number, number];
  /** Facts the film cannot be made honestly without. Missing ones are asked for, never invented. */
  needs: string[];
  beats: Beat[];
  /** Where the voice sits, and what the bed does. */
  audio: string;
  /** The one action, and the last frame. */
  cta: string;
  /** The ways this specific kind of film goes wrong. */
  never: string[];
}

export const VIDEO_PIPELINES: readonly VideoPipeline[] = [
  {
    id: 'offer-reel',
    name: 'The offer reel',
    produces: 'A viewer who knows the price of acting today and what to press.',
    bestFor: ['offer', 'discount', 'sale', 'admission open', 'batch', 'price', 'diwali', 'festival offer', 'ad'],
    seconds: [15, 30],
    needs: ['the offer in figures', 'what is being sold', 'how to respond (number or link)'],
    beats: [
      { from: 0, to: 0.13, beat: 'Stop the scroll with the offer itself', onScreen: 'The offer, in its largest type, first frame', shot: 'Already in motion — no logo, no fade in, no establishing shot' },
      { from: 0.13, to: 0.4, beat: 'Show the thing being sold, unmistakably', onScreen: 'The product, place or result', shot: 'Two or three cuts of the real thing; the strongest image of it comes first' },
      { from: 0.4, to: 0.65, beat: 'Remove the main reason to hesitate', onScreen: 'One proof line or one reassurance', shot: 'Real detail — the studio, the batch, the finished work, a face' },
      { from: 0.65, to: 0.87, beat: 'Restate the offer with its limit', onScreen: 'The offer again, plus the deadline or the count if it is real', shot: 'Hold still. This is the beat people read; nothing moves behind it' },
      { from: 0.87, to: 1, beat: 'One action', onScreen: 'Call to action and the number', shot: 'End card: brand mark, contact, one button. Nothing else moves' },
    ],
    audio: 'Narration optional but preferred; if there is no voice, the type must carry the whole argument. Bed stays under the voice, ducks by a third when the offer appears.',
    cta: 'One action only. The last frame repeats it verbatim, never introduces a second one.',
    never: [
      'Never open on a logo or a title card — the first frame is the most expensive real estate in the film.',
      'Never state an offer, discount or deadline the owner has not given you.',
      'Never add a second call to action "just in case".',
    ],
  },
  {
    id: 'testimonial',
    name: 'The customer story',
    produces: 'A viewer who believes the outcome because someone like them got it.',
    bestFor: ['testimonial', 'review', 'customer story', 'student', 'result', 'success story', 'alumni', 'case study'],
    seconds: [30, 60],
    needs: ['the customer\'s own words', 'what changed for them', 'permission to use their name or face'],
    beats: [
      { from: 0, to: 0.1, beat: 'Open on the result, in their voice', onScreen: 'The outcome as a short quote', shot: 'Present day; the person at ease, looking at the work or the place, not at a lens they are nervous about' },
      { from: 0.1, to: 0.25, beat: 'Where they started', onScreen: 'The before, simply stated', shot: 'Environment or detail that says "before" without an actor pretending' },
      { from: 0.25, to: 0.5, beat: 'What actually happened', onScreen: 'The specific thing the business did', shot: 'Real interiors of the business at work: the class, the machine, the desk' },
      { from: 0.5, to: 0.75, beat: 'The change, named', onScreen: 'The outcome with a figure or a date if they gave one', shot: 'Back to the person; the most confident frame of them in the cut' },
      { from: 0.75, to: 1, beat: 'Hand over to the viewer', onScreen: 'Business name, one line, call to action', shot: 'End card, or the person looking off-frame as the card arrives on top' },
    ],
    audio: 'Their voice is the film. Use the real recording if it exists; a TTS reading of their written words must be labelled as such. Bed low, no swell under the quote.',
    cta: 'The viewer\'s next step mirrors what the customer did: apply, book, visit.',
    never: [
      'Never write a testimonial. If there is no real customer, this pipeline is not available — choose another.',
      'Never put words in a real person\'s mouth, and never use a stock face as a "customer".',
      'Never open with the company name; the customer is the subject.',
    ],
  },
  {
    id: 'transformation',
    name: 'Before and after',
    produces: 'A viewer who can see the change and cannot unsee it.',
    bestFor: ['before after', 'transformation', 'makeover', 'renovation', 'weight loss', 'glow up', 'results'],
    seconds: [15, 30],
    needs: ['a real before', 'a real after', 'how long it took'],
    beats: [
      { from: 0, to: 0.15, beat: 'Show the after first', onScreen: 'The finished state, no label yet', shot: 'Best light, best angle of the finished thing; hold the reveal only a moment' },
      { from: 0.15, to: 0.35, beat: 'Cut to the before', onScreen: 'BEFORE, labelled plainly', shot: 'Same framing and light as the after, so only the change differs' },
      { from: 0.35, to: 0.6, beat: 'The work in between', onScreen: 'The process, briefly', shot: 'Two or three real process shots; hands, tools, progress, never a stock montage' },
      { from: 0.6, to: 0.85, beat: 'The after again, with the number', onScreen: 'AFTER plus the time it took or the measure', shot: 'Return to the opening frame so the loop closes visually' },
      { from: 0.85, to: 1, beat: 'How to get the same', onScreen: 'Call to action, contact', shot: 'Card over the held after-shot, not a black screen' },
    ],
    audio: 'Beat-anchored cuts. Bed can carry it with little or no narration; if narrated, say only what the pictures do not.',
    cta: 'Book the same transformation — one action.',
    never: [
      'Never compare two different subjects and call it a transformation.',
      'Never use a filter or a crop difference to manufacture the change — the two frames must be comparable.',
      'Never claim a timeline you were not told.',
    ],
  },
  {
    id: 'launch',
    name: 'The launch',
    produces: 'A viewer who knows something new exists, and when they can get it.',
    bestFor: ['launch', 'new', 'coming soon', 'introducing', 'unveil', 'opening', 'now available'],
    seconds: [15, 30],
    needs: ['what is new', 'when it is available', 'how to act'],
    beats: [
      { from: 0, to: 0.12, beat: 'A glimpse, unexplained', onScreen: 'Three or four words, or nothing but the image', shot: 'The most intriguing detail, tightly cropped; resist showing the whole thing' },
      { from: 0.12, to: 0.35, beat: 'Reveal what it is', onScreen: 'The name, plainly', shot: 'The first full view; movement if there is any, otherwise a slow push' },
      { from: 0.35, to: 0.65, beat: 'Why it matters to this viewer', onScreen: 'One benefit, in their terms', shot: 'It in use, or the person it is for' },
      { from: 0.65, to: 0.88, beat: 'The date and the way in', onScreen: 'Available from <when>', shot: 'Card holding still long enough to read' },
      { from: 0.88, to: 1, beat: 'One action', onScreen: 'Call to action and contact', shot: 'End card with the brand mark' },
    ],
    audio: 'The one film where a rise into the reveal earns its keep — but the reveal must land on the cut, not a second late. Narration names the thing; it does not tease twice.',
    cta: 'Register interest, or the date and the action.',
    never: [
      'Never tease twice — a launch that withholds in the last beat wastes the film.',
      'Never announce a date the owner has not fixed.',
      'Never use the word "revolutionary" or any claim the business cannot show.',
    ],
  },
  {
    id: 'explainer',
    name: 'How it works',
    produces: 'A viewer who understands the thing well enough to want it.',
    bestFor: ['explain', 'how it works', 'what is', 'process', 'difference between', 'guide', 'course details', 'syllabus'],
    seconds: [30, 60],
    needs: ['the thing being explained', 'the steps or parts', 'who it is for'],
    beats: [
      { from: 0, to: 0.12, beat: 'The question the viewer already has', onScreen: 'That question, in their words', shot: 'The subject, simply and clearly, no drama' },
      { from: 0.12, to: 0.35, beat: 'The first part or step', onScreen: 'Step one, numbered', shot: 'One clean image per idea; resist showing three things at once' },
      { from: 0.35, to: 0.6, beat: 'The middle, where the value is', onScreen: 'Steps two and three', shot: 'Continue the visual rhythm; same framing per step so the pattern reads' },
      { from: 0.6, to: 0.82, beat: 'What it means for them', onScreen: 'The outcome, one line', shot: 'The subject in use, or the result' },
      { from: 0.82, to: 1, beat: 'Who it is for, and the action', onScreen: 'For <audience> — call to action', shot: 'End card over the last real image, not a black screen; brand mark and one button' },
    ],
    audio: 'Narration-led; this is the pipeline where the voice carries the structure. Type repeats each step rather than adding to it, so the film works muted.',
    cta: 'Ask, apply, or visit — whatever matches the explanation\'s next step.',
    never: [
      'Never explain more than three things. A fourth means the film should have been two films.',
      'Never let type and voice say different things.',
      'Never explain a feature the viewer did not ask about.',
    ],
  },
  {
    id: 'walkthrough',
    name: 'The walkthrough',
    produces: 'A viewer who feels they have already been there.',
    bestFor: ['walkthrough', 'tour', 'site visit', 'inside', 'property', 'flat', 'campus', 'clinic', 'showroom', 'studio'],
    seconds: [30, 60],
    needs: ['what is being shown', 'location', 'the detail that sells it'],
    beats: [
      { from: 0, to: 0.1, beat: 'The most desirable view, immediately', onScreen: 'Location or name', shot: 'The hero space from its best corner; wide, no people blocking it' },
      { from: 0.1, to: 0.35, beat: 'Move through the space in order', onScreen: 'Room or zone names as they appear', shot: 'Continuous direction of travel — never jump back and forth; the viewer must feel a path' },
      { from: 0.35, to: 0.6, beat: 'The details that decide it', onScreen: 'One or two specifics, labelled', shot: 'Close detail: finish, light, equipment, view; the thing photos miss' },
      { from: 0.6, to: 0.85, beat: 'Pull back to the whole', onScreen: 'Space plus what it is for', shot: 'Wide return, people using the space if any exist' },
      { from: 0.85, to: 1, beat: 'How to come and see it', onScreen: 'Address, contact, call to action', shot: 'End card over the held wide shot' },
    ],
    audio: 'Ambient real sound if it exists beats music here — the space should sound like somewhere. Narration sparing; let the images work.',
    cta: 'Book a visit — the walkthrough exists to cause one.',
    never: [
      'Never show a space that is not theirs, or someone else\'s stock interior, as if it were.',
      'Never reverse the direction of travel between shots; it reads as a different building.',
      'Never label an amenity the owner did not list.',
    ],
  },
  {
    id: 'credibility',
    name: 'Why us',
    produces: 'A viewer who knows the one fact a competitor cannot copy.',
    bestFor: ['why us', 'about us', 'experience', 'award', 'certified', 'years', 'founder', 'team', 'trusted'],
    seconds: [20, 45],
    needs: ['the credential or fact', 'what it means for the customer', 'evidence it is true'],
    beats: [
      { from: 0, to: 0.15, beat: 'The fact, stated flatly', onScreen: 'The credential as a number', shot: 'The evidence itself — the wall, the certificate, the work, the person' },
      { from: 0.15, to: 0.45, beat: 'What earned it', onScreen: 'The years or the count as a short line', shot: 'Archive if they have it, real work if not; never a stock hero shot of strangers' },
      { from: 0.45, to: 0.7, beat: 'What that means for this viewer', onScreen: 'The benefit, their terms', shot: 'The team or the principal at work' },
      { from: 0.7, to: 0.9, beat: 'Proof, not adjectives', onScreen: 'One concrete instance', shot: 'A specific project, batch or case' },
      { from: 0.9, to: 1, beat: 'The action', onScreen: 'Call to action and contact', shot: 'End card held over the evidence image, so the proof stays in frame while the ask lands' },
    ],
    audio: 'Calm and unhurried; confidence reads as space, not volume. A founder\'s own voice is strong here if they are willing.',
    cta: 'Talk to us.',
    never: [
      'Never assert a credential, award, certification or year of experience that the owner did not state.',
      'Never say "trusted by thousands" without a number you were given.',
      'Never let the film be adjectives with no evidence in frame.',
    ],
  },
  {
    id: 'objection',
    name: 'The objection',
    produces: 'A viewer who has had the reason for hesitation removed.',
    bestFor: ['fees', 'expensive', 'doubt', 'worried', 'safe', 'guarantee', 'refund', 'hidden charges', 'why so', 'is it worth'],
    seconds: [15, 30],
    needs: ['the real objection', 'the true answer', 'proof of the answer'],
    beats: [
      { from: 0, to: 0.2, beat: 'Say the worry out loud', onScreen: 'The objection, in the viewer\'s words', shot: 'Quiet, direct framing; no defensive energy, no defensive music' },
      { from: 0.2, to: 0.5, beat: 'Answer it with a fact', onScreen: 'The answer as a figure or a policy', shot: 'The evidence: documents, the place, the person responsible' },
      { from: 0.5, to: 0.75, beat: 'Show it is not just a claim', onScreen: 'One instance of the answer holding', shot: 'A real example, or a process that can be seen' },
      { from: 0.75, to: 1, beat: 'The action, without pressure', onScreen: 'Call to action and contact', shot: 'End card, calm and uncluttered; no countdown, no urgency device' },
    ],
    audio: 'Speak slower than feels right. One voice, no interjections, no hard-sell bed.',
    cta: 'Ask the question directly — invite the conversation.',
    never: [
      'Never invent a guarantee, refund policy or figure to answer the objection.',
      'Never answer an objection the viewer did not raise.',
      'Never mock the worry — the viewer is the one holding it.',
    ],
  },
  {
    id: 'event',
    name: 'The occasion',
    produces: 'A viewer who feels included and knows where to be.',
    bestFor: ['diwali', 'holi', 'eid', 'christmas', 'new year', 'anniversary', 'inauguration', 'greeting', 'wishes', 'festival'],
    seconds: [10, 25],
    needs: ['the occasion', 'the business name', 'the greeting or the offer, not both'],
    beats: [
      { from: 0, to: 0.25, beat: 'The occasion, visually', onScreen: 'Its name, briefly', shot: 'Real texture of the season — lights, flowers, food — not clip art' },
      { from: 0.25, to: 0.6, beat: 'The warmth', onScreen: 'The greeting line', shot: 'Movement with a human element: hands, preparations, a gathering' },
      { from: 0.6, to: 0.85, beat: 'The business, as host', onScreen: 'Brand mark with the greeting', shot: 'Hold on the real place, dressed for the occasion if possible' },
      { from: 0.85, to: 1, beat: 'The one ask, if there is one', onScreen: 'Greeting plus contact, or the offer if this is a festival sale', shot: 'End card on the festive texture, warm and still, brand mark small' },
    ],
    audio: 'A warm bed carries this; narration is optional. If it is a greeting, no sell copy in the voice.',
    cta: 'Greeting, or one offer — pick one. A greeting with a discount in it is a sale, so call it one.',
    never: [
      'Never mix a genuine greeting with a hard sell in the same breath.',
      'Never use another brand\'s festive campaign imagery.',
      'Never state a festival offer the owner did not set.',
    ],
  },
  {
    id: 'recap',
    name: 'The recap',
    produces: 'A viewer who sees the business is busy and real.',
    bestFor: ['recap', 'highlights', 'last week', 'event coverage', 'throwback', 'what we did', 'behind the scenes'],
    seconds: [20, 45],
    needs: ['what actually happened', 'when', 'permission for any faces'],
    beats: [
      { from: 0, to: 0.15, beat: 'The strongest moment', onScreen: 'The occasion and the date', shot: 'The best frame of the day, mid-action' },
      { from: 0.15, to: 0.6, beat: 'A rhythm of real moments', onScreen: 'Short captions naming what is happening', shot: 'Fast cuts on the beat; real faces with consent, real activity, imperfect is fine' },
      { from: 0.6, to: 0.85, beat: 'One quote or number from it', onScreen: 'Attendance, results or a line someone said', shot: 'Return to the strongest frame' },
      { from: 0.85, to: 1, beat: 'Next time', onScreen: 'Call to action or the next event', shot: 'End card over the strongest frame of the day, not over a blank' },
    ],
    audio: 'Real sound from the day lifts this a lot. Music-led is fine; captions must still make it work muted.',
    cta: 'Join the next one.',
    never: [
      'Never show a face that has not agreed to appear.',
      'Never post footage of a client\'s premises without their permission.',
      'Never claim attendance or results you were not told.',
    ],
  },
];

/** How long each beat should be, in seconds, for a given runtime. Rounded to 0.5 s and made contiguous. */
export function beatsFor(id: PipelineId, seconds: number): Array<Beat & { startSec: number; endSec: number; durationSec: number }> {
  const pipeline = VIDEO_PIPELINES.find((p) => p.id === id);
  if (!pipeline) return [];
  const total = Math.max(5, Number(seconds) || pipeline.seconds[0]);
  const half = (n: number) => Math.round(n * 2) / 2;

  let cursor = 0;
  return pipeline.beats.map((beat) => {
    const startSec = cursor;
    const endSec = half(total * beat.to);
    cursor = endSec;
    return { ...beat, startSec, endSec: Math.max(endSec, startSec + 0.5), durationSec: half(endSec - startSec) };
  });
}

/**
 * Pick the pipeline a brief is asking for.
 *
 * Deterministic and explainable, for the same reason the ad compiler is: the agent must be able to say WHY this
 * structure, and a retry must not silently pick a different film. Longest matching phrase wins, so "before after
 * gym transformation" beats a stray "results" elsewhere in the sentence.
 */
export function choosePipeline(brief: string): { pipeline: VideoPipeline; why: string; runnersUp: string[] } {
  const haystack = ` ${String(brief || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')} `;

  const scored = VIDEO_PIPELINES.map((pipeline) => {
    const hits = pipeline.bestFor.filter((phrase) => haystack.includes(` ${phrase} `) || haystack.includes(` ${phrase}s `));
    const weight = hits.reduce((sum, phrase) => sum + phrase.split(' ').length, 0);
    return { pipeline, hits, weight };
  }).sort((a, b) => b.weight - a.weight || a.pipeline.name.localeCompare(b.pipeline.name));

  const best = scored[0];
  if (!best || best.weight === 0) {
    // Nothing matched: the offer reel is the shape that needs the fewest facts and most often applies to a
    // business that has just asked for a video without saying what kind.
    return {
      pipeline: VIDEO_PIPELINES[0],
      why: 'Nothing in the brief pointed at a specific kind of film, so the offer reel is the default shape — ' +
        'it needs the fewest facts and it converts.',
      runnersUp: scored.slice(1, 3).map((s) => s.pipeline.name),
    };
  }

  return {
    pipeline: best.pipeline,
    why: `The brief mentions ${best.hits.map((h) => `"${h}"`).join(', ')}, which is what the ${best.pipeline.name} ` +
      'is built for.',
    runnersUp: scored.slice(1, 3).filter((s) => s.weight > 0).map((s) => s.pipeline.name),
  };
}

/**
 * The skill text the agent loads with get_skill('nobogent-video-pipelines').
 *
 * Generated from the data above so the knowledge and the code cannot drift: a pipeline added here appears in the
 * agent's instructions with no second edit, and `verify:video-pipelines` checks the generated text.
 */
export function renderPipelineKnowledge(): string {
  const lines: string[] = [
    '# Video pipeline shapes',
    '',
    'Shot design answers "what do I point the camera at". This answers the question before it: what kind of film is',
    'this, in what order, and how long does each part get. Pick ONE shape before writing the shot list — a',
    'testimonial and a launch are not the same film with different footage, they argue differently.',
    '',
    '**Choose the shape from the brief, then keep it.** If nothing fits, the offer reel is the default. Say which',
    'shape you chose and why, in one line, in your reply.',
    '',
    '**Facts.** Each shape lists what it needs. Anything the owner has not given you is a question, never a',
    'placeholder to fill in later and never a number to invent. If a shape needs a fact you cannot get, pick a',
    'different shape instead of weakening the one you chose.',
    '',
    '**Timings.** Beats are fractions of the runtime, so the same shape works at 15 s and at 60 s. Compute the',
    'schedule from the length the owner actually asked for.',
    '',
  ];

  for (const pipeline of VIDEO_PIPELINES) {
    lines.push(
      `## ${pipeline.name} (\`${pipeline.id}\`) — ${pipeline.seconds[0]}–${pipeline.seconds[1]} s`,
      '',
      `**Leaves the viewer with:** ${pipeline.produces}`,
      '',
      `**Needs from the owner:** ${pipeline.needs.join('; ')}.`,
      '',
      '| Beat | Time | What it must do | On screen | How it is shot |',
      '| --- | --- | --- | --- | --- |',
      ...pipeline.beats.map((beat) => {
        const pct = `${Math.round(beat.from * 100)}–${Math.round(beat.to * 100)}%`;
        return `| ${beat.beat} | ${pct} | ${beat.beat} | ${beat.onScreen} | ${beat.shot} |`;
      }),
      '',
      `**Audio:** ${pipeline.audio}`,
      '',
      `**Ending:** ${pipeline.cta}`,
      '',
      `**Never:** ${pipeline.never.join(' ')}`,
      '',
    );
  }

  lines.push(
    '## Where this comes from',
    '',
    'Written for this product from the business\'s own delivered work and from studying how these formats are',
    'described publicly. No third-party text is reproduced here, and nothing in it should be treated as licensed',
    'from another project — see `docs/openmontage-decision.md` for why the AGPL-licensed alternative was not',
    'vendored and what we did instead.',
  );

  return lines.join('\n');
}
