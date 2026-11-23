# The ad-creative playbook: what we vendored, and where it is enforced

Written 2026-11-25. Covers `coreyhaines31/marketingskills` → `skills/ad-creative`, vendored at
commit `5b2b400e`, MIT (Copyright (c) 2025 Corey Haines).

## Why it was added

Everything the platform already shipped was about how a creative **looks**: `impeccable`,
`scroll-craft`, `banner-design`, `video-shotcraft`, and our own `nobogent-creative`. Nothing covered
what it **says**, or which creative to make next. That gap had three visible costs:

- A Meta headline had no length limit anywhere except `describe('Max 40 characters')` in a tool
  schema — advice to a model, not a rule. Meta truncates silently, so nothing ever failed; the
  advertiser just found out from a customer.
- Nothing checked for copy that reads as machine-written. At thirty creatives a day, a batch
  multiplies its first draft's tic thirty times.
- The results loop was one-directional. `lib/ads/launch-service.ts` could already judge an ad
  (kill/keep/scale on spend, CTR and frequency), but nothing turned that judgement into the next
  brief. **Now closed — see "The performance loop" below.**

## What is vendored

**One skill, eleven reference documents.** `ad-creative` is the body (26 KB). Its own
`references/*.md` files — platform specs, the static template library, the hook system, the format
taxonomy, the strategy loop and six more (163 KB) — are vendored separately.

They are deliberately **not** skills. Registering them would have put eleven extra lines into every
routing decision for documents one task in twenty needs, and loading them with the body would have
cost a turn the budget of a conversation. Instead:

- `get_skill('ad-creative')` returns the body **plus a pointer block** naming its companions.
  Upstream says "see `references/platform-specs.md`", and that path does not exist here — without
  the block the skill degrades into an instruction to read a file that is not there, which is worse
  than not shipping it.
- `get_skill_reference('ad-creative--platform-specs')` fetches exactly one. It resolves by the short
  name too (`platform-specs`), because that is what an agent will try after reading the body.

Slugs are identical to the upstream basenames, so the attribution URL never drifts from the file it
claims to be.

**Not vendored, on purpose:** `evals/evals.json` (their eval harness, not instructions) and
`assets/creative-review-template.html` (a delivery template that duplicates `app/review`).

## Where it is enforced

The skill is a playbook; `lib/ads/creative-specs.ts` is the part that cannot be ignored.

| Rule | Enforced by | Effect |
|---|---|---|
| Per-platform character limits | `checkAdCopy`, called from `validateLaunchRequest` | A launch whose copy does not fit is **refused** before anything is created, quoting a version that does |
| Stock phrases ("unlock the power", "reimagined", …) | `findCopyViolations`, severity `block` | Refused at launch; reported by `build_ad_creative_prompt` |
| Structural tells (contrast reveals, stacked negations, self-answered questions, `POV:`) | `findCopyViolations`, severity `warn` | Reported with a concrete alternative. **Never blocks** — a good ad can use one |
| Em dashes, curly quotes, doubled words, spacing | `sanitizeCopy`, applied in `buildCampaignJobPayload` | Repaired mechanically on the way into the payload. Refusing punctuation we are about to fix would be theatre |
| Falsifiable hypotheses | `checkTestHypothesis` | Names the missing part: metric, comparison or direction |

The **block/warn/repair split is the design**, not a detail. A checker that blocks on taste is a
checker the agent learns to route around; a checker that only warns about a truncated headline ships
the truncation. So: facts about the platform block, judgements about the writing warn, and
punctuation is fixed without asking.

## Where it is always in view

`nobogent-ad-copy` is a **house skill**, which means it is in the prompt catalogue on every turn for
every tenant — it is not optional and cannot be deleted. It carries the limits, the bans and the
one-argument discipline, and points at `ad-creative` for the full method. That is what makes the rule
apply to both the routine flow and an on-demand creation without either of them loading 190 KB.

It also reaches the daily brief: `composeRoutineBrief` prints `adCopyRulesForPrompt()` — the same
numbers the launcher enforces — so the first draft is written inside the budget instead of being
rejected after it. The numbers are never retyped into prose; there is one source of truth.

## Refreshing it

```bash
node scripts/vendor-skills.mjs --check                      # report drift, write nothing
node scripts/vendor-skills.mjs --only=ad-creative           # refresh just this family
```

`--only` exists because several repos we vendor from have moved since we last refreshed them, and
adopting upstream's newer text is a separate decision. Without it, adding one skill drags every stale
sibling into the same diff.

## The gate

`npm run verify:creative-specs` — 64 assertions. It pins the limits against the numbers readers
actually see (40, not the 255 API maximum), tests the copy checks **for false positives** against real
advertising copy, and proves the launcher refuses a bad headline while repairing a dash. Two failures
it is designed to catch: a limit "simplified" to the API maximum, and a reference layer that breaks so
the skill silently becomes advice to read a missing file.

Where the vendored document and a `nobogent-` platform rule disagree, the platform rule wins — it is
the one enforced in code.

---

# The performance loop

Written 2026-11-25. `lib/ads/creative-learning.ts`.

## The gap

Meta returns numbers against an **ad**, never against an **idea**. So a campaign that worked taught
nothing repeatable: the next batch started from zero, and the owner paid to rediscover the same lesson
every month.

## How it closes

```
launch ──► campaign_jobs.payload.creativePlan (which argument the ad made)
                    │
                    ▼
        optimize_meta_campaign ──► join the plan to Meta's rows, by ad → adset → campaign
                    │
                    ▼
        per-angle verdicts (winning / losing / promising / too_early)
                    │
                    ▼
   guidance.prefer / guidance.avoid ──► build_ad_creative_prompt (preferAngles / avoidAngles)
                    │
                    └──────────► the next launch records its angle, and the loop turns
```

The daily routine gets the same verdicts through `composeRoutineBrief`, which states them when it has
them and says "not read yet, go and look" when it does not.

## Three deliberate design choices

**Stateless, with no learnings table.** Everything is a pure function of two things already owned: the
recorded launches and Meta's numbers. There is no migration, no cache to drift, no lost update when two
readers write at once, and a corrupt or pruned input degrades to "no learnings" rather than a wrong one.
The same numbers always produce the same verdicts, which is what makes it safe to run on every pass.

**It will not learn from noise.** An angle needs 1,000+ impressions *and* real spend before it is
judged — the playbook's own impression rule, paired with `recommendOptimisation`'s spend floor so the two
halves of the loop cannot disagree. Thin data reads `too_early`, never `losing`.

**A measurement cannot outrank a person.** `preferAngles` is a tiebreak worth +10 among angles whose
facts are already supplied, so it can reorder two honest options and can never promote an angle that
would require inventing a fact (0 + 10 still loses to 100). The owner's explicit instruction beats any
measurement, and the standing `creative_directives` are untouched by all of this.

## The bug this exposed

`meta_graph_insights` formats its display rows for a human: money becomes `"₹2,000.00"`, CTR becomes
`"1.25%"`, and **the entity ids are dropped**. `recommendOptimisation` reads `row.spend`, `row.ctr` and
`row.adset_id`. Handed the display rows, it computed `NaN` against every threshold and answered
"nothing has crossed the spend threshold" no matter what the account was doing — a judgement tool that
could never judge, which is why it passed every test that only checked it did not throw.

The tool now returns `raw` (Meta's own objects, numeric and id-bearing) alongside `rows`, and
`optimize_meta_campaign` reads `raw`. A second trap sits behind it: Meta has no `results` field, only
`actions`, and the optimiser pauses anything that spent with `results === 0` — so raw rows are enriched
with a derived `results` first, or every row would read "spent money, produced nothing" and the whole
account would be recommended for pausing. Both traps are pinned in `verify:creative-learning`.

## The gate

`npm run verify:creative-learning` — 57 assertions. Half of them assert what the loop **refuses** to do
(learn from noise, hide unattributable spend, override a fact), because a loop that reports confidently
from thin data is worse than no loop: it launders noise into a budget decision.
