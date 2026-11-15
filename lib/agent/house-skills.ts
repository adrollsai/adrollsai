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

export interface HouseSkill {
  /** Stable name. The agent calls get_skill with this exact string. */
  name: string;
  /** One line. This is all that appears in the prompt by default. */
  description: string;
  /** The full instructions, loaded on demand. */
  content: string;
}

export const HOUSE_SKILLS: readonly HouseSkill[] = [
  {
    name: 'nobogent-video-brief',
    description:
      'How to write a video brief that the video tool will accept: one lead-in, readable line lengths, one plate per scene.',
    content: `# Writing a video brief

A video is described as a "beats file": a JSON object with \`beats\`, \`scenes\`, \`plates\`
and an \`endCard\`. Use the \`plan_video\` tool to check yours BEFORE promising anything —
it validates against the renderer's real contract and quotes the credits.

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
];

/** House skills by name, for `get_skill`. */
export function houseSkill(name: string): HouseSkill | null {
  const wanted = String(name ?? '').trim().toLowerCase();
  return HOUSE_SKILLS.find((skill) => skill.name.toLowerCase() === wanted) ?? null;
}

/** The catalogue entries the prompt and `list_skills` show. */
export function houseSkillCatalogue(): { name: string; description: string }[] {
  return HOUSE_SKILLS.map((skill) => ({ name: skill.name, description: skill.description }));
}
