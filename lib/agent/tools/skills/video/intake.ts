/**
 * The intake: what to ask BEFORE writing a beats file.
 *
 * THE PROBLEM THIS SOLVES
 * A brief is usually one sentence — "make a video like this for my project" with a
 * reference film attached. From that, a planner has to decide the things that cost
 * money and cannot be guessed:
 *
 *   - does the film have people SPEAKING on camera (and so must be lip-synced), or is
 *     it a narrator over b-roll?
 *   - who speaks, in what language, while the on-screen copy may be a different one
 *   - which facts are allowed on screen (a phone number is a promise; so is a price)
 *   - the aspect, the length floor, and which existing assets must appear
 *
 * Guessing any of those quietly produces a film that is wrong in a way the owner only
 * notices at delivery. So this module does two honest things:
 *
 *   1. Picks the SPEECH MODE from evidence — does the reference have speech, are there
 *      people on camera, does the brief name a presenter — and says why.
 *   2. Emits the list of questions that are still OPEN, each with a default, so the
 *      agent asks a short, relevant set instead of interrogating or inventing answers.
 *
 * Pure and synchronous: no vendor, no sandbox, no charge, and testable without a model.
 */

import {
  DEFAULT_VIDEO_RESOLUTION,
  resolutionChoices,
  resolutionQuestion,
  type VideoResolution,
} from '../../../video-plan';

export type SpeechMode =
  /** People on camera speak; the line goes into the video prompt so lips match the words. */
  | 'dialogue-clips'
  /** No one speaks on camera: a TTS narrator over b-roll. Cheaper and easier, but it cannot be lip-synced. */
  | 'tts-narration'
  /** Not enough evidence yet — ask before planning. */
  | 'undecided';

export interface IntakeEvidence {
  /** The owner's exact words. */
  brief?: string;
  /** A reference film was supplied. */
  referenceVideo?: boolean;
  /**
   * What the reference's audio stream turned out to be, from the analyser / the file
   * probe: speech is what makes lip-sync the whole job.
   */
  referenceHasSpeech?: boolean | null;
  /** The reference shows people talking to camera. */
  referenceHasTalkingHeads?: boolean | null;
  /** Second, on-screen language if it differs from the spoken one. */
  onScreenLanguage?: string;
  aspect?: string;
  /**
   * The resolution the owner chose. Absent means NOT YET ASKED — which is why the intake asks
   * rather than defaulting silently: 1080p costs 3.33x the same seconds at 480p.
   */
  resolution?: VideoResolution;
  targetSeconds?: number;
  brand?: { name?: string; phone?: string; logo?: string; tagline?: string };
  /** Assets the owner already pointed at (photos of the founder, a CRM export, a logo). */
  assets?: number;
}

export interface IntakeQuestion {
  id: string;
  question: string;
  /** Why the answer changes the film — stated so the owner can answer quickly. */
  why: string;
  options?: string[];
  /** What the plan will assume if the owner says "you decide". */
  fallback: string;
  /** True when a wrong guess changes the credits by more than noise. */
  mattersForCost: boolean;
}

export interface IntakeResult {
  /** What the film will render at if the owner says "you decide". 480p unless they chose. */
  resolution: VideoResolution;
  speechMode: SpeechMode;
  /** One line the agent can show the owner to prove it understood. */
  understanding: string;
  /** Evidence behind the speech mode, in words. */
  reasoning: string;
  questions: IntakeQuestion[];
  /** A beats.json skeleton with the parts that ARE known filled in. */
  skeleton: Record<string, unknown>;
  nextStep: string;
}

const TALKING_HEAD_WORDS = [
  'podcast',
  'interview',
  'talking head',
  'testimonial',
  'founder',
  'coach',
  'host',
  'anchor',
  'speaks',
  'speaking',
  'conversation',
  'q&a',
  'q and a',
  'talking',
];

const hasTalkingSignal = (text: string): boolean => {
  const t = text.toLowerCase();
  return TALKING_HEAD_WORDS.some((word) => t.includes(word));
};

/** Pick the mode from evidence, and say why in one sentence. */
export function decideSpeechMode(evidence: IntakeEvidence): { mode: SpeechMode; reasoning: string } {
  const brief = evidence.brief ?? '';
  const hasSpeech = evidence.referenceHasSpeech ?? null;
  const talkingHeads = evidence.referenceHasTalkingHeads ?? null;

  if (talkingHeads === true) {
    return {
      mode: 'dialogue-clips',
      reasoning:
        'the reference shows people speaking on camera, so the words have to come out of the same ' +
        'generation as the mouth — a narrator laid over a talking head is the failure mode to avoid',
    };
  }
  if (talkingHeads === false && hasSpeech === true) {
    return {
      mode: 'tts-narration',
      reasoning:
        'the reference has speech but nobody speaks on camera: it is a narrator over footage, so a ' +
        'single measured voice is the right tool and costs less than generated performances',
    };
  }
  if (talkingHeads === null && hasSpeech === true) {
    return {
      mode: 'undecided',
      reasoning:
        'the reference has a speech track — that changes everything, so establish first whether people ' +
        'speak on camera or a narrator talks over b-roll',
    };
  }
  if (hasTalkingSignal(brief)) {
    return {
      mode: 'dialogue-clips',
      reasoning: `the brief names a speaking format ("${brief.trim().slice(0, 80)}"), which means on-camera delivery`,
    };
  }
  if (evidence.referenceVideo && hasSpeech === false) {
    return {
      mode: 'tts-narration',
      reasoning: 'the reference is silent footage, so the film needs a voice laid over it',
    };
  }
  return {
    mode: 'undecided',
    reasoning:
      'nothing in the brief or the reference says whether anyone speaks on camera; asking is cheaper ' +
      'than generating the wrong kind of film twice',
  };
}

/**
 * The questions that are still open.
 *
 * Ordered: the two that decide the whole shape first, then the facts that go on screen,
 * then the format. Anything already answered is omitted — an intake that re-asks what
 * the owner already said reads as not listening.
 */
export function intakeQuestions(evidence: IntakeEvidence, mode: SpeechMode): IntakeQuestion[] {
  const questions: IntakeQuestion[] = [];

  if (mode === 'undecided') {
    questions.push({
      id: 'speech',
      question:
        'Does anyone speak on camera in this film, or is it a narrator over the footage?',
      why:
        'On-camera speech is generated by the video model with the line inside the prompt, so the lips ' +
        'match the words and no TTS is used. A narrator is cheaper but can never be lip-synced.',
      options: ['people speak on camera', 'narrator over b-roll', 'no voice at all, type and music'],
      fallback: 'people speak on camera if the brief mentions a host or a podcast, otherwise a narrator',
      mattersForCost: true,
    });
  }

  // Resolution is asked every time and priced inline. It is the single biggest cost lever in
  // a video job (1080p is 3.33x 480p for the same seconds), so it cannot be defaulted in
  // silence — but it also must not become an interrogation, hence one question with numbers.
  if (!evidence.resolution) {
    const estimateSeconds = evidence.targetSeconds ?? 60;
    const options = resolutionChoices(estimateSeconds);
    questions.push({
      id: 'resolution',
      question: resolutionQuestion(estimateSeconds),
      why:
        `A draft usually gets revised. ${DEFAULT_VIDEO_RESOLUTION} costs ` +
        `${options[0]?.credits ?? 0} credits for ~${estimateSeconds}s of footage, 1080p costs ` +
        `${options[options.length - 1]?.credits ?? 0}. Drafting at ${DEFAULT_VIDEO_RESOLUTION} and ` +
        're-generating only the shots you keep is cheaper than generating every shot final and ' +
        're-doing most of them.',
      options: options.map((o) => `${o.label} — ${o.credits} credits (${o.useWhen})`),
      fallback: `${DEFAULT_VIDEO_RESOLUTION} for a draft, 1080p for a film that ships as-is`,
      mattersForCost: true,
    });
  }

  if (mode === 'dialogue-clips') {
    questions.push({
      id: 'speakers',
      question: 'How many people speak, and who are they (founder, broker, two hosts, a customer)?',
      why:
        'One generated clip is one performance by one speaker, so the cast decides how many plates the ' +
        'film needs and how the dialogue is split.',
      fallback: 'two hosts, one man and one woman, as in the reference',
      mattersForCost: true,
    });
    questions.push({
      id: 'spokenLanguage',
      question: 'What language do they speak — Hindi, Hinglish, English, something else?',
      why:
        'The line goes into the prompt verbatim in that language and script; mixing scripts inside one ' +
        'line is what makes a model stumble mid-sentence.',
      fallback: 'Hinglish (Hindi sentence, English trade words), as in the reference',
      mattersForCost: false,
    });
  } else if (mode === 'tts-narration') {
    questions.push({
      id: 'spokenLanguage',
      question: 'What language should the narrator speak, and should it be a man or a woman?',
      why: 'Both are fixed at generation time and cannot be swapped afterwards without paying again.',
      fallback: 'Hinglish, a confident male voice',
      mattersForCost: false,
    });
  }

  const brand = evidence.brand ?? {};
  if (!brand.phone || !/\+?\d[\d\s-]{6,}/.test(brand.phone)) {
    questions.push({
      id: 'phone',
      question: 'Which phone number (or WhatsApp) should appear as the call to action?',
      why:
        'A number on screen is a promise: the film is unwatchable if it is wrong, and I will not invent ' +
        'one. If there is no number, the CTA becomes the brand name instead.',
      fallback: 'no number — the CTA is the brand name and the tagline',
      mattersForCost: false,
    });
  }
  if (!brand.name) {
    questions.push({
      id: 'brand',
      question: 'What is the exact brand name, and is there a logo file I should use?',
      why: 'The end card and the brand bug are set from it, and a logo file is required for the bug.',
      fallback: 'use the business name already on file, no logo',
      mattersForCost: false,
    });
  }
  if (evidence.onScreenLanguage === undefined) {
    questions.push({
      id: 'onScreenLanguage',
      question: 'Should the on-screen text be in the same language as the speech, or a different one?',
      why:
        'Spoken and written language are chosen separately: many briefs want Hindi speech with English ' +
        'type, and the renderer enforces one written script per film.',
      fallback: 'same as the spoken language',
      mattersForCost: false,
    });
  }
  if (!evidence.aspect) {
    questions.push({
      id: 'aspect',
      question: 'Where will this run — a feed/status (9:16) or YouTube/site (16:9)?',
      why: 'Aspect decides the type sizes and how long each line can be; it is fixed for the whole film.',
      fallback: 'match the reference aspect',
      mattersForCost: false,
    });
  }
  if (!evidence.targetSeconds) {
    questions.push({
      id: 'length',
      question: 'How long should it be, roughly? Anything from 30 s up is fine.',
      why:
        'The film is cut to the measured speech, so the real length comes from the script; this sets the ' +
        'floor and how much breathing room the end card gets.',
      fallback: 'the length of the reference',
      mattersForCost: true,
    });
  }
  if (!evidence.assets) {
    questions.push({
      id: 'assets',
      question: 'Do you have photos or footage I must use — the founder, the office, real projects?',
      why:
        'Real photographs of real people should never be replaced by a generated face; they are ' +
        'outpainted to the film aspect and animated instead.',
      fallback: 'generate everything except the brand mark',
      mattersForCost: false,
    });
  }

  return questions;
}

/** The whole intake in one pure call. */
export function planVideoIntake(evidence: IntakeEvidence): IntakeResult {
  const { mode, reasoning } = decideSpeechMode(evidence);
  const resolution = evidence.resolution ?? DEFAULT_VIDEO_RESOLUTION;
  const questions = intakeQuestions(evidence, mode);

  const understanding = [
    evidence.brief ? `brief: "${evidence.brief.trim().slice(0, 140)}"` : 'brief: (none given)',
    evidence.referenceVideo ? 'reference film supplied' : 'no reference film',
    `speech: ${
      mode === 'dialogue-clips'
        ? 'on-camera dialogue generated with the picture'
        : mode === 'tts-narration'
          ? 'narrator over footage'
          : 'not yet established'
    }`,
  ].join(' · ');

  const skeleton: Record<string, unknown> = {
    version: 1,
    resolution,
    jobId: '<seeded-lowercase-id>',
    aspect: evidence.aspect ?? '16:9',
    fps: 30,
    targetSeconds: evidence.targetSeconds ?? 60,
    onScreenLanguage: evidence.onScreenLanguage ?? 'en',
    logoOnScreen: Boolean(evidence.brand?.logo),
    voice: {
      language: 'hinglish',
      speaker: 'Charon',
      scene: 'Confident Indian narrator, warm authority, no shouting.',
    },
    endCard: {
      name: evidence.brand?.name ?? '<brand>',
      tagline: evidence.brand?.tagline ?? '<tagline>',
      numbers: [evidence.brand?.phone ?? '<number>', '<number>'],
      address: ['<line 1>'],
      ...(evidence.brand?.logo ? { logo: evidence.brand.logo } : {}),
    },
    plates:
      mode === 'dialogue-clips'
        ? [
            {
              id: 'dlg-a',
              source: 'dialogue',
              line: '<the exact words this person says>',
              speaker: '<young Indian woman, bright and confident, close studio microphone>',
              seconds: 15,
              resolution: '480p',
              ...(evidence.assets ? { imageKey: '<r2 key or https url of the still to animate>' } : {}),
            },
            { id: 'broll-a', source: 'generate', prompt: '<one slow move, no cuts, no text>', seconds: 5 },
          ]
        : [
            { id: 'broll-a', source: 'generate', prompt: '<one slow move, no cuts, no text>', seconds: 5 },
          ],
    beats: [
      {
        id: 'p01',
        vo: mode === 'dialogue-clips' ? '' : '<what the narrator says>',
        lines: ['<ON-SCREEN LINE>'],
        label: '<OPTIONAL KICKER>',
        plate: mode === 'dialogue-clips' ? 'dlg-a' : 'broll-a',
      },
    ],
    scenes: [
      { id: 's1', kind: 'hook', beats: ['p01'], plate: mode === 'dialogue-clips' ? 'dlg-a' : 'broll-a' },
      { id: 's2', kind: 'endcard', beats: [], dur: 2.6, plate: 'broll-a' },
    ],
  };

  const nextStep =
    questions.length === 0
      ? 'Nothing is open: call plan_video with this beats file, show the owner the credits, then render.'
      : `Ask the owner these ${questions.length} question(s) in ONE message (they are the ones the ` +
        'evidence cannot answer), then call plan_video. Do not generate anything before the plan is approved.';

  return { speechMode: mode, resolution, understanding, reasoning, questions, skeleton, nextStep };
}
