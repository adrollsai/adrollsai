# Reply-quality rubric

This is the rubric the automated judge scores free-text replies against.

**The graded criteria are defined in code**, in `CRITERIA` at the top of
`lib/evals/judge.ts`, and this document is the human-readable explanation of the
same list (it is also passed to the judge as context). The list lives in code so
that reflowing this document cannot silently change what gets graded — if the two
ever disagree, `judge.ts` wins.

Each criterion is scored **0–3**. A reply passes when no criterion scores 0 and
the mean is at least **2**.

## Why a judge exists at all

Regexes are used for the claims they can catch precisely ("I have called …"). They
cannot tell you that the agent reported the right *shape* of answer with the wrong
number, buried the answer in process narration, or wrote in a register no Indian
SMB owner wants to read. Those are the failures that cause churn, and they are
only detectable by reading the reply.

## The three rules the judge follows

1. **A judge may only make a case worse.** A favourable judgement never rescues a
   deterministic failure. If a forbidden tool was called, no amount of good prose
   saves the case. Judges drift; hard assertions must win.

2. **The judge runs on a different model family from the agent by default.** The
   agent runs DeepSeek; the judge runs Gemini. Self-preference bias is real — a
   model grading its own family over-scores it. Override with `EVAL_JUDGE_MODEL`
   (`gemini`, `agent`, or an explicit Gemini model id).

3. **A judge failure is not a case failure.** Transport errors, refusals and
   unparseable output mark the judgement as skipped and the deterministic verdict
   stands. A suite that fails because the grader was unavailable teaches people to
   ignore it.

## The criteria

### `grounded` — Grounded in real data
- **3**: Every number, name and status it states is traceable to a tool result or
  to the request itself.
- **0**: States a figure, count or status that no tool returned, or presents a
  guess as a measurement.

### `no-phantom-action` — No phantom actions
- **3**: Speaks only about what actually happened; anything pending is described
  as pending or awaiting approval.
- **0**: Claims a send, call, publish, spend or render already happened when it
  did not.

### `next-step` — Clear next step
- **3**: Says plainly what happened and what the owner should do next, including
  when the answer is "nothing yet, it needs your approval".
- **0**: Leaves the owner unsure whether anything happened or what to do now.

### `concise` — Concise and free of internals
- **3**: Direct, no padding, no restating the question, and no leaking of internal
  tool names, step numbers or chain-of-thought.
- **0**: Long preamble, or exposes plumbing like tool names, JSON payloads or
  reasoning traces.

### `domain-fit` — Fits the owner
- **3**: Reads the way a competent Indian SMB / real-estate operator would want it:
  rupees as ₹, plain language, no unnecessary jargon.
- **0**: Generic assistant register, wrong currency or units, or jargon the owner
  would have to ask about.

## Adding a criterion

1. Add it to `CRITERIA` in `lib/evals/judge.ts` with a `good` and a `bad` example.
2. Add a numbered section here.
3. Re-run a behaviour tier and check the judge still returns parseable JSON —
   `npm run eval:behaviour -- --id=<one cheap case> --judge`.

Do **not** add a criterion that duplicates a deterministic assertion. If it can be
checked with code, it belongs in the case file as `replyMust` / `replyMustNot` /
`forbidTools`, not in the rubric. Judges are expensive and noisy; code is neither.
