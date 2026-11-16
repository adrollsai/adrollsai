# Why Nobogent does not vendor OpenMontage

**Decision: we do not vendor OpenMontage. We build the video craft in-house.**
Owner's call, 16 Nov: _"i don't necessarily want you to use open montage, but our agent should create
good high converting and visually appealing videos using all the models it has access to... it's your
choice whether you want to use open montage or not."_

## What it is

[github.com/OpenMontageInc/OpenMontage](https://github.com/OpenMontageInc/OpenMontage) — an
open-source agentic video production system: 12 production pipelines, 100+ tools, ~700 agent
skill/production-knowledge files. 2,747 tracked paths, 141 of them `SKILL.md` under `.agents/skills/`.

## The blocker is the licence, not the size

Its licence is **AGPL-3.0**. Not MIT, which is what the three skills already vendored
(`scroll-craft`, `ui-ux-pro-max`, `banner-marketing`) use, and which is the only licence
`scripts/vendor-skills.mjs` accepts.

Re-verified 17 Nov against GitHub's licence API rather than against the repo's own claim, because a
decision this consequential should not rest on a README: `GET /repos/OpenMontageInc/OpenMontage/license`
returns `{"key":"agpl-3.0","name":"GNU Affero General Public License v3.0","spdx_id":"AGPL-3.0"}`, and
the `LICENSE` blob (`be3f7b28e564e7dd05eaf59d64adba1a4065ac0e`) opens with "GNU AFFERO GENERAL PUBLIC
LICENSE Version 3". The `calesthio/OpenMontage` fork carries the **same blob sha**, so it is the same
licence, not a permissive escape hatch.

AGPL-3.0 is strong copyleft with a **network clause**: if you modify the Program and let users
interact with it over a network, you must offer those users the Corresponding Source. Nobogent is a
closed-source commercial SaaS. Incorporating AGPL code into it — or into the knowledge files we
compile into the agent's prompt — is a legal exposure the owner would have to accept deliberately,
on advice, rather than by accident. Vendoring it quietly because the files are "just markdown" is
exactly the kind of thing that is cheap now and expensive later.

`lib/agent/skill-router.ts` was written against "the OpenMontage repository the owner pointed at
carries roughly 700 skill files" and says a router is the answer to that volume. That reasoning
still stands on its own — the router is worth having whatever we feed it. It is not an argument for
this particular source.

## What we do instead

`lib/agent/orchestrator.ts`, in the `media` group, carries a **REFERENCE-FIRST VIDEO** doctrine:

1. **Find the reference before designing.** Search the live web for how the format is working in
   that vertical (hook, pacing, shot list, caption style), and read the app's own 35 reference
   creatives. Name the reference and what is being taken from it.
2. **Then shoot it with every model we have**, not one: Grok Imagine for footage (and image-to-video
   over the business's own photographs), Gemini TTS for narration, the sandbox for the cut, music,
   mix and captions, HyperFrames for typography, offers and the end card.
3. **The voice is narration, not a talking head.** No avatar unless the owner explicitly asks for
   one or supplies real footage of a person to camera. No synthetic presenter standing in for the
   owner. Supplied clips win, with the voiceover over them.
4. **Aim at conversion**: the offer stated plainly, the reason to believe shown, one call to action
   held long enough to read, the real phone number, and the last frame repeats the ask.

To make step 1 possible, `media` now pulls in the `research` group (`tool-groups.ts`), because the
agent cannot search for a reference without the web tools and a doctrine it cannot follow is worse
than no doctrine.

## If this is revisited

Vendoring becomes available if any of these change:

- the owner accepts AGPL-3.0 exposure on advice (then vendor the `SKILL.md` knowledge files only,
  never `tools/`, `lib/`, `pipeline_defs/`, `remotion-composer/`, with repo + commit + licence pinned
  in each generated module, the way `scripts/vendor-skills.mjs` already does);
- upstream relicenses to MIT or Apache-2.0;
- a permissively-licensed fork of the knowledge files appears.

`scripts/vendor-skills.mjs` stays MIT-only until one of those happens. It is the gate that keeps
this honest.

## The route that needs no licence decision at all

Worth stating because it is the one people forget: **copyright protects the expression, not the
technique.** Vendoring their files is the thing to avoid; reading their published README, pipeline
list and public documentation to understand *how* a beat-matched montage is assembled, then writing
our own knowledge files from that understanding, is ordinary research. The output would be our words,
our structure, our examples — nothing to attribute because nothing was copied.

That is the option to take if the 12 pipelines and ~700 knowledge files represent craft we are
missing, and it is the option that costs nothing legally. What it must never become is "paste the
markdown and change a few words", which is a derivative work with extra steps.

## What we actually give up by not using it

Being honest about the trade, since a licence decision hides one:

- 12 named production pipelines (their packaging of a shoot), against our one media doctrine plus
  `video-shotcraft`'s 124 shot cards and the HyperFrames registry's ~450 blocks;
- ~100 tool wrappers, most of which duplicate calls we already make directly to Grok, Gemini TTS,
  FFmpeg and HyperFrames;
- ~700 knowledge files, of which a single turn could ever use a handful — which is exactly what
  `lib/agent/skill-router.ts` exists for, and why the router was worth building whatever we feed it.

The parts we would genuinely want are the pipeline-level recipes: how a testimonial, a product
launch, a before/after and an explainer are each structured beat by beat. `video-shotcraft` covers
shot design; pipeline structure is the gap.
