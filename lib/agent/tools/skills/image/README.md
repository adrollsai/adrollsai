# `image` skill — brief + facts + references → ONE call → one finished image

One call produces one **finished image**. The prompt asks for the complete designed
poster — hero visual *and* typography — in a single pass, and what the provider
returns is the deliverable. Nothing in this skill draws on the result.

The shape this replaced (generate a bare picture, then composite HTML/CSS/SVG design
elements on top of it) is **banned**: it produced a visible composited edge, type
that did not belong to the picture, and text the model never saw. The two dead files
that did it (`utils/stamp-helper.ts`, `utils/collage-generator.ts`) are deleted, and
`npm run verify:image-skill` fails if the approach comes back.

```
brief + facts + referenceUrls + aspectRatio
        │
        ├─ buildImagePrompt ──────────────▶ one prompt   (pure, no I/O)
        │     · claim scan: a price / % / phone number not in the facts ⇒ REFUSE
        │     · brief scrub: "background", "blank space", "leave room for text" ⇒ rewritten
        │
        ├─ estimateCredits(route, 1) ─────▶ the price, from the registry only
        ├─ artefactKeyStemFor(...) ───────▶ image/<slug>/<3x4>-<sha1:8>
        │
createImage(...)
        ├─ canAfford(userId, credits)     (before any vendor call)
        ├─ createKieImageTask  ───────────▶ ONE generation (retried once, SAME model, only if transient)
        ├─ queryKieTask until the render lands
        ├─ download → R2 PUT at the planned key
        └─ UPDATE agent_runs.artefact_key / artefact_url / artefact_meta
```

| file | I/O | what it owns |
|---|---|---|
| `prompt.ts` | none | the prompt, the aspect ratios, the claim scan, the brief scrub. Pure and testable. |
| `index.ts` | all of it | plan → credits → one `createKieImageTask` → R2 → `agent_runs` |

## The call

```ts
const plan = planImageSkill({
  brief: 'Diwali launch poster for Green Meadows, a 3BHK project',
  facts: { price: 'Starting ₹1.45 Cr', location: 'Sector 82, Mohali' },
  aspectRatio: '3:4',           // 3:4 | 1:1 | 9:16 | 16:9
});
// plan.prompt        the exact prompt
// plan.model         MEDIA_MODELS.image.id  (or .imageEdit.id when a reference is supplied)
// plan.credits       estimateCredits('image' | 'imageEdit', 1)
// plan.artefactKey   'image/diwali-launch-poster-for-green-mea/3x4-6340c0c4.png'

const result = await createImage({
  runId, userId,
  input: { brief, facts, referenceUrls, aspectRatio },
});
// result.artefact.key === 'image/<slug>/3x4-6340c0c4.png'
// result.recorded     === { recorded: true, reason: null }
```

## Input

* **`brief`** — what the image is for, in the business's own words.
* **`facts`** — verified facts only (`price`, `location`, `offer`, …). Anything not
  here must not appear in the image. With no facts the prompt says so explicitly and
  forbids every numeric, price, date, discount and contact claim.
* **`referenceUrls`** — public https URLs of the real subject. **Non-empty routes the
  call to `MEDIA_MODELS.imageEdit`**, which keeps the real subject real; the prompt
  then instructs the model to reproduce that subject rather than repaint it.
* **`aspectRatio`** — one of the four the app actually offers (`3:4`, `1:1`, `9:16`,
  `16:9`). Anything else throws `ImageAspectError` naming the four. `4:5` is
  deliberately *not* a fifth: it is not a provider enum.

## Rules enforced before any spend

* **No invented facts.** `findUnverifiedClaims` extracts money, percentages and
  telephone numbers from the brief; if one is absent from `facts`,
  `buildImagePrompt` throws `InventedFactError` with the claims listed. A poster is
  the easiest place in the product to ship a fabricated price, so this refuses
  rather than guesses.
* **No bare-picture briefs.** `scrubBrief` rewrites `background`, `blank space`,
  `negative space`, `leave room for text` and `no text` phrasing into a single-pass
  design instruction before the brief reaches a model.
* **One submission, one model.** `MAX_SUBMISSIONS = 2`: the first go, plus one retry
  *on the same model* and only for a transient failure (524/429/timeout). A blind
  `withMediaFallback` walk is deliberately not used here — `imageEdit`'s fallback
  chain ends at a text-to-image model, which would silently turn "edit THIS
  building" into "invent a building".

## Money

`imageCredits(route)` is `estimateCredits(route, 1)` from
`lib/agent/media-models.ts`, and nothing else — change the price in the registry and
the quote follows. `createImage` refuses to start when `canAfford` says the balance
cannot cover it, because kie bills on completion and settlement is after the fact.

## Where the key is recorded

`agent_runs.artefact_key` / `artefact_url` / `artefact_meta`
(`supabase/migrations/20261216000000_agent_run_artefact.sql`, shared with the `video`
skill). `recordImageArtefact()` never throws: if the migration has not been applied
it returns `{ recorded: false, reason }` and logs the key, because a published image
is finished and losing a bookkeeping write must not turn it into a retry.

## Verifying

* `npm run verify:image-skill` — 115 offline checks: no banned phrasing in any
  emitted prompt, the typography clause present in all of them, references route to
  the edit model on every ratio and reference count, unknown ratios rejected, credits
  equal `estimateCredits`, no model id or vendor name in any prompt, the claim scan
  refusing, one submission per run with the key recorded, and a repo-wide scan
  proving **zero** remaining overlay/composite-on-generated-image call sites.
* `npm run proof:image-skill` — the live acceptance: ten images across the four
  aspect ratios (four editing a supplied reference) through the real
  `createKieImageTask`, saved to `D:\nobo-images\` with a `report.json`. It spends
  credits; nothing else in this directory does.
