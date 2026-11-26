/**
 * The platform's own rules, as skills the agent loads.
 *
 * WHY THESE LIVE IN CODE AND NOT IN `agent_skills`
 * `agent_skills` holds what a CUSTOMER uploaded — their procedures, their voice. These
 * are different: they are how THIS PLATFORM works, they are identical for every tenant,
 * they change with a deploy, and getting one wrong has already cost real renders. A
 * tenant can delete their own skill; nobody should be able to delete the rule that a
 * scene on screen at t = 0 never reveals its overlays.
 *
 * They use the same progressive-disclosure shape as the tenant skills — a cheap
 * description in the prompt, the body only when the agent decides it applies — because
 * that is what keeps a turn from carrying six documents of instructions it does not use.
 *
 * Every rule here was learned by something breaking. That is why they are written as
 * rules and not as advice.
 */
import { renderPipelineKnowledge } from './creative/video-pipelines';
import { renderVideoGateGuidance } from './video-plan';

import { PRODUCT_GUIDES } from './house-skills/product-guide';

export interface HouseSkill {
  /** Stable name. The agent calls get_skill with this exact string. */
  name: string;
  /** One line. This is all that appears in the prompt by default. */
  description: string;
  /** The full instructions, loaded on demand. */
  content: string;
}

const HOUSE_SKILLS_BASE: readonly HouseSkill[] = [
  {
    name: 'nobogent-video-gates',
    description:
      'The order of operations for ANY video: ask the resolution and quote its price (480p default), take the ' +
      'cheap approval before spending, measure a reference instead of describing it, verify every generated ' +
      'line, and stop a batch when the vendor is down. Load it BEFORE quoting credits or generating a clip.',
    content: renderVideoGateGuidance(),
  },
  {
    name: 'nobogent-video-pipelines',
    description:
      'The shape of each kind of film — offer reel, testimonial, before/after, launch, explainer, walkthrough, ' +
      'why-us, objection, occasion, recap — with its beat structure, what it needs from the owner, and how it ' +
      'fails. Load it BEFORE writing a shot list.',
    content: renderPipelineKnowledge(),
  },
  {
    name: 'nobogent-video-brief',
    description:
      'How to write a video brief that the video tool will accept: one lead-in, readable line lengths, one plate per scene, and the two speech modes (on-camera dialogue vs narration).',
    content: `# Writing a video brief

A video is described as a "beats file": a JSON object with \`beats\`, \`scenes\`, \`plates\`
and an \`endCard\`. Use the \`plan_video\` tool to check yours BEFORE promising anything —
it validates against the renderer's real contract and quotes the credits. If the brief is
one line plus a reference video, start at \`video_intake\` and ask what it lists.

## Where the speech comes from — decide this first

A film talks in one of two ways, and choosing wrongly produces something no edit can save.

**A. \`dialogue\` plates — someone on camera speaks.** The exact line goes INTO the video
prompt, so the model generates the voice and the lip movement in one pass:

\`\`\`jsonc
{ "id": "dlg-a", "source": "dialogue",
  "line": "नाम याद रखना — डॉक्टर सतीश बत्रा!",
  "speaker": "young Indian woman, bright and confident, close studio microphone",
  "seconds": 15, "resolution": "480p",
  "imageKey": "brand/founder.jpg" }
\`\`\`

* The beat that plays it keeps \`vo: ""\` — the clip speaks. A \`vo\` that disagrees with the
  plate's \`line\` is rejected when the brief is parsed, so a line is never said twice.
* One plate = one performer = exactly one beat. Two beats cannot share it.
* \`seconds\` may run to 15 (the model's ceiling); a silent \`generate\` plate stays at 1-6 s.
* \`resolution\` defaults to 480p for dialogue: a talking head is bought by the second, and
  720p/1080p cost about 2x/3x more for a shot that is mostly a face.
* The clip comes back with air around the words; the skill measures it, cuts the clip to
  the speech, and cuts the film to what the model actually said.
* Then it transcribes the clip and compares it with the line. Under ~40% of the words and
  the run records a mismatch: regenerate that plate with a shorter line, never ship it.

**B. Narration — nobody appears on camera.** Leave \`vo\` filled and use \`generate\` or
\`asset\` plates. TTS reads the line, the skill measures it, the film is cut to it.

NEVER mix the two on the SAME line: a silent talking shot plus a TTS track is a dub, the
mouths move on their own, and nothing downstream fixes that. Mixing across the film is
fine — a host speaks on camera, a narrator reads the packshot line.

## The rules the renderer will hold you to

1. **Every on-screen line must be readable.** A line needs \`0.5 s + 0.3 s per word\` on
   screen. One word = 0.8 s. Five words = 2.0 s. If a line cannot hold that long, use
   fewer words — never more beats.
2. **At most 5 words per line in 9:16** (9 in 16:9). Longer and it is cropped by the
   frame edge, which reads as a broken page, not as a long line.
3. **On-screen text is English. The voiceover is Hinglish** unless the owner asks
   otherwise. These are different fields: \`lines\` is what is READ, \`vo\` is what is SAID.
4. **The film starts with a 0.5 s plate-only lead-in (\`s0\`).** Never put type on a scene
   that is on screen at t = 0: a scene visible at the first frame never reveals its
   overlays, so the type is simply missing. \`s0\` is plate only, always.
5. **One plate per scene.** Never reuse one video file across two scenes with different
   start points — that kills the render about 70% in with a missing-frame error. If two
   scenes need the same footage, they get separate copies.
6. **Every text block is absolutely positioned** inside the safe area. A block that is
   merely centred will move when the line above it changes length.
7. **The end card carries the brand, a tagline, two numbers and an address.** It is drawn
   INSTEAD of a scene's lines, so never put lines in the end-card scene.

## Do not invent

Never write a price, an EMI, an area, a date, a discount, an approval, a guarantee or a
testimonial that the owner did not give you. If the brief needs one, ask. A film with a
gap and a question is useful; a film with a made-up price is a liability.`,
  },
  {
    name: 'nobogent-video-delivery',
    description:
      'What a finished video must pass before you deliver it: zero lint errors, measured loudness, and frames you actually looked at.',
    content: `# Delivering a video

A video is not finished when it renders. It is finished when it passes these four checks.

1. **The renderer's own lint reports zero errors.** Run it and read the number. A missing
   error count is not a pass, and warnings that are marked fatal are errors.
2. **Loudness is measured, not intended.** The film must sit near -16 LUFS with a true
   peak near -1.5 dB. The project ships its own mastering script for this; run it and read
   the number it prints. A film measured at -31 LUFS was reported by the audio section as
   having zero errors once — so measure the file on disk.
3. **Look at the frames.** Pull stills at several timecodes and actually look at them. A
   film can pass every automated check and still have a slab of background over a third
   of the picture, type clipped off the edge, or colour bars instead of footage. All three
   have happened here. If you cannot inspect frames, say the film is unverified.
4. **Say what is a placeholder.** If a line is a marked blank, a card says UNKNOWN, or the
   voice is a stand-in, say so in the same message that delivers the film.`,
  },
  {
    name: 'nobogent-reference-video',
    description:
      'Rebuilding an existing video: what can be measured, what cannot, and why the copy comes back as a blank.',
    content: `# Rebuilding a customer's reference video

Point the reverse tool at a video and it measures the cuts, the shots, the colour, where
type sits, and where the voice starts and stops. From that it produces a spec, a beats
file and a project that can be edited.

## What it CANNOT do, and must not pretend to

There is **no OCR and no speech-to-text** in this pipeline. So:

- every on-screen line comes back as the marked blank \`WORD WORD\`, sized from the
  measured type box and the measured hold;
- the voice line is \`UNKNOWN WORDS\`;
- the brand card is \`BRAND UNKNOWN\` / \`TAGLINE UNKNOWN\` / \`ADDRESS UNKNOWN\`.

**Never fill those in with anything you invented.** Ask the owner for the words, then set
them through the tool's line overrides. A film that says WORD is honest; a film that says
a made-up headline is a lie in the customer's name.

## What to tell the owner

- the runtime, the shot count and the beat count, measured;
- which measured lines did not land on a cut — reported, never silently snapped;
- every question the measurement could not answer (the words, the brand, the typeface,
  the tempo);
- that a fast-cut reference gets fewer beats than it has spoken lines, because several
  short lines are grouped so each stays readable.

## Prefer: a square reference is cropped

A 1:1 reference is rebuilt at 9:16 and the sides are cropped, because the renderer only
produces 9:16 and 16:9. Say so before delivering.`,
  },
  {
    name: 'nobogent-creative',
    description:
      'Making an image creative: full-image generation only, no HTML or background overlays, and no invented facts.',
    content: `# Making an image creative

## The one hard rule: the image IS the creative

Generate the complete picture — including any words that belong in it — as one image.
Never build a creative by laying HTML, CSS, a background image plus text on top, or a
template over a photo. That approach is banned on this platform: the overlays do not
survive resizing, they drift out of the safe area, and they read as a rendering fault.

If the model paints the words into the artwork, that is correct. The price, the phone
number and the offer must therefore be in the prompt as text, exactly as the owner gave
them.

## Reference creatives

When the owner supplies a reference image, list the reference creatives first, follow the
rules returned with them, and pass the reference to the image tool so the style carries
over. Do not describe the reference in prose and hope.

## Never invent

No price, no discount, no percentage, no EMI, no "limited seats", no certification, no
award, no testimonial, no number of customers. If a creative needs one and you were not
given it, leave it out and ask. Every ratio you offer must be a ratio the tool supports.`,
  },
  {
    name: 'nobogent-page-editing',
    description:
      'Editing a landing page one section at a time, and why an ambiguous instruction is refused instead of guessed.',
    content: `# Editing a landing page

A page is made of named sections (hero, offerings, about, cta, contact, footer). Edit ONE
section at a time.

1. **Ask what the page is made of** (the tool lists its sections). Do not guess a section
   name.
2. **To replace a whole section**, pass the section name and the new HTML.
3. **To change a piece of text**, pass the exact text and what it should become. The tool
   refuses if the text appears more than once — "Call Now" appears in the hero, the sticky
   bar and the footer of a real page — and refuses if it appears nowhere. In that case
   name the section, or quote more of the surrounding text. **Never reword the whole page
   to work around an ambiguity**: that changes things the owner did not ask about.
4. **The tool proves what it changed.** Every other section must come back byte-identical.
   If the tool reports that another section changed, stop and say so — do not save over it.

## Sections follow the industry

A page for a film academy must never carry floor plans, specifications or "possession
date" blocks. If the industry is unknown, the page gets neutral wording — never property
wording. The tool strips sections the industry may not have, and says which.

## Never invent

Do not add a price, a date, a testimonial, a guarantee or an address the owner did not
give. A landing page is the customer's promise to their customer; a made-up number on it
is a legal problem, not a copy problem.`,
  },
  {
    name: 'nobogent-never-invent',
    description:
      'The factual guard: the specific facts that must never be invented, for every industry.',
    content: `# Never invent these

If you were not given a fact, you do not have it. Ask. This applies to images, films,
pages, posts, messages and anything you say to a customer.

**Money:** prices, fees, EMIs, discounts, offers, "starting at", savings, refunds.
**Property:** carpet area, super area, floor, facing, amenities, approvals, RERA numbers,
possession dates, distances to landmarks.
**Education:** course duration, fees, certifications, placement guarantees, faculty names,
batch dates, seat counts.
**Services:** processing times, success rates, government approvals, guaranteed outcomes.
**Social proof:** testimonials, ratings, customer counts, awards, years in business.
**Anything legal or medical.**

Two habits that keep this honest:

1. If the owner gave you a fact, quote it exactly as they wrote it. Do not round it, do
   not "improve" it, do not add a unit they did not use.
2. If a deliverable needs a fact you do not have, produce it with a clearly marked gap and
   list the question. A gap is a working document; an invention is a liability.`,
  },
  {
    name: 'nobogent-ad-copy',
    description:
      'The platform rule for ad copy — headlines, primary text, offer lines and description text on any creative, ' +
      'launch or broadcast: the character budget each platform truncates at, the phrases that make copy read as ' +
      'machine-written, one argument per ad, and how to state a claim that can be proven wrong. Load it before ' +
      'writing any headline, hook or offer.',
    content: `# Writing ad copy here

This is the platform rule for every headline, offer line, description, caption and broadcast message
that will be read as an ad. It is enforced, not advised: build_ad_creative_prompt reports against it,
and a Meta launch carrying copy that breaks it is REFUSED before anything is created.

Being refused is not a failure to work around. The refusal quotes a version that fits — use it, or
write a better one.

## 1. Fit the field, or it does not run

Meta does not reject an over-long headline. It truncates it and reports nothing, so the advertiser
finds out when a customer reads a sentence that stops mid-word. The budget is per field:

- **Meta** — headline 40, primary text 125 visible, description 30.
- **Google Ads** — headline 30 (hard cap), long headline 90, description 90, display path 15.
- **LinkedIn** — intro text 150, headline 70, description 100.
- **TikTok** — ad text 80, display name 40.
- **X** — tweet text 280, card headline 70, card description 200.

The front of the field is what gets read. Put the specific claim in the first 125 characters, not a
warm-up. "Site visits open this Saturday" earns the next line; "We are pleased to announce" does not.

## 2. One ad, one argument

An ad makes ONE argument, chosen before a single word is written. Take it from a named angle — a
pain point, an outcome, social proof, a comparison, identity, or a genuine deadline — and say which
one you chose and why.

Do not stack three arguments to "cover more". A reader remembers none of them. If two arguments both
deserve testing, that is two ads, which is the point of a batch.

## 3. Never write these

They read as machine-written, and the reader can tell:

- **Stock phrases.** "Unlock the power of", "say goodbye to", "reimagined", "take it to the next
  level", "here is the thing", "game-changer", "cutting-edge", "state-of-the-art", "seamless
  experience", "get started today", "join thousands of happy customers". These are refused.
- **Cop-out hooks.** "Stop scrolling", "here is what nobody tells you", "you will not believe", and a
  bare "POV:". A POV hook is allowed only when the situation is hyper-specific to the viewer.
- **Em dashes.** Banned in ad copy. A dash between two clauses is a full stop in disguise.
- **Contrast reveals.** "It is not X, it is Y." State Y and the reason. One is a coincidence; a batch
  of them is a tic.
- **Stacked negations.** "No fees, no delays, no hassle." Keep the one absence that matters and spend
  the space on a fact.
- **Self-answered questions.** "The result? 3x faster." "The best part: it learns." Say it plainly.
- **Trailing pile-ons.** A full claim, then a comma and more restating. End the sentence at the claim.

Across a batch, vary the sentence shapes. Ten variations that all open the same way read as
generated even when each one is fine alone.

## 4. Specific beats clever

A number, a date, a place, a named outcome, a real objection handled. "Handover in March" is an ad;
"a lifestyle awaits" is a mood. If the business gave you no specific, the honest move is to ask for
one — never to invent one (see nobogent-never-invent).

## 5. Say what would prove it wrong

When you propose a variation, state a hypothesis a result can actually disprove. Name the METRIC
(CTR, cost per lead, conversion rate), what it is measured AGAINST (the current ad, a sibling
variation), and the expected DIRECTION.

"This will resonate with buyers" cannot lose, so it teaches nothing.
"Beats the current creative on CTR among site-visit leads, by 15% or more" can.

## 6. Learn from what already ran

Before proposing an angle, look at what has actually run and what happened to it. Double down on the
structure and subject that worked, in new words. Do not re-propose an angle the owner already
rejected or that already lost. Change one variable per cycle, and say which number you judged on.

## 7. Where the rest of it lives

This rule is the floor, not the whole playbook. For the full method — the angle system, the grounded
inputs corpus that puts the customer's own words into the ad, the static template library, the hook
system, the format taxonomy and the strategy loop — load the vendored skill ad-creative, then fetch
only the reference document the task needs with get_skill_reference.

Where a vendored document disagrees with anything above, THIS rule wins: it is the one enforced in
code.`,
  },
  {
    name: 'nobogent-product-media',
    description:
      "How to use a product's OWN photos, clips and documents instead of inventing them: what to list first, which plate source takes a clip, how to animate a still, and how to actually read a PDF or brochure. Load it before making any creative, film or page for a specific offering.",
    content: `# Using a product's own material

A catalogue item can carry photos, video clips and documents. Using them is what makes the
output look like the business instead of like stock. Never reach for generated footage before
you have looked at what is already attached.

## 1. Look first, always

Call \`product_media\` with the offering id before you compose anything. It returns counts plus
the first few files of each kind (images, videos, documents). If the owner's request does not
name an offering, ask which one — do not guess between two courses or two properties.

## 2. Which route can use what

There are two ways to make a video, and they are not interchangeable:

- \`composeVideo\` — one generated clip. It accepts \`photoUrls\` only, and uses them as reference
  frames. It has NO field for an existing video clip. Good for fast, cheap, single-shot.
- The film route (\`video_intake\` → \`plan_video\` → render) — a real timeline. Its plates come from
  three sources:
    - \`source: "asset"\` with \`key\` = the R2 key / URL of an existing **mp4**, plus \`mediaStart\`
      to choose where the clip starts. THIS is how a product's own footage is used.
    - \`source: "generate"\` with \`prompt\` + \`seconds\`, and \`imageKey\` pointing at one of the
      product's photos to **animate that still** (image-to-video). 1-7 stills are allowed per shot.
    - \`source: "dialogue"\` when someone must speak on camera; the line goes into the prompt so the
      voice and lip movement are one generation.

So: if the product has footage, say so and use \`asset\` plates. If it has photos only, animate the
photos with \`imageKey\` rather than generating an unrelated scene. Mix in generated motion only
where the real material cannot carry the beat.

## 3. Reading a document (PDF, DOCX, XLSX)

There is no dedicated document tool, and that is not a reason to refuse. The sandbox is a root
Linux VM with internet — install a reader in one command and use it:

\`\`\`bash
# PDF text, no install needed on most images:
apt-get update && apt-get install -y poppler-utils && curl -sL "<url>" -o doc.pdf && pdftotext -layout doc.pdf -
# or, when pdftotext is unavailable:
pip install --quiet pdfplumber && python3 -c "import pdfplumber,sys; print('\\\\n'.join((p.extract_text() or '') for p in pdfplumber.open('doc.pdf').pages))"
\`\`\`

For spreadsheets use \`parse_csv_or_excel\` instead. For a photo of a page, \`analyze_image_with_gemini\`
will read the text in it.

## 4. What you may and may not do with what you read

- Quote the document. A fee, a duration, a certification, a batch date is usable ONLY if the
  document says it. Put it in the creative's \`facts\` so the tooling knows it is verified.
- If the document is silent on something the ad needs, either ask the owner once or leave it out.
  Never fill the gap with a plausible number — see \`nobogent-never-invent\`.
- A document is the business's internal material. Do not publish it or link it publicly unless the
  owner asked for exactly that.`,
  },
];

/** House skills by name, for `get_skill`. */
/**
 * PRODUCT GUIDES, GENERATED FROM THE LIVE UI.
 *
 * The agent had no documentation of this product at all, so "how do I launch a WhatsApp broadcast" was answered by
 * improvising button names. These entries are written by `npm run ui:guide`, which walks the real interface and records
 * the routes, section headings and exact labels it finds. They load on demand like every other house skill.
 */
export const HOUSE_SKILLS: readonly HouseSkill[] = [
  ...HOUSE_SKILLS_BASE,
  ...PRODUCT_GUIDES.map((doc) => ({
    name: doc.name,
    description:
      `How to use the product: ${doc.title}. Load this before answering any "how do I…" or "where is…" question about ` +
      'it, and use its exact button labels and route.',
    content: doc.body,
  })),
];

export function houseSkill(name: string): HouseSkill | null {
  const wanted = String(name ?? '').trim().toLowerCase();
  return HOUSE_SKILLS.find((skill) => skill.name.toLowerCase() === wanted) ?? null;
}

/** The catalogue entries the prompt and `list_skills` show. */
export function houseSkillCatalogue(): { name: string; description: string }[] {
  return HOUSE_SKILLS.map((skill) => ({ name: skill.name, description: skill.description }));
}
