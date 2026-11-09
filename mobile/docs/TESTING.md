# Testing

## Commands

```bash
flutter analyze                        # 0 issues
flutter test                           # 61 tests
flutter test --coverage                # + coverage/lcov.info
flutter build apk --debug              # Android
```

## Result on the development machine

```
flutter analyze → No issues found!
flutter test    → All tests passed!  (61 tests)
```

---

## What is covered

### `test/data/agent_stream_parser_test.dart` — 13 tests

The AI SDK UI-message SSE contract is the most brittle part of the integration, so
it is pinned frame by frame rather than verified only by running the app against a
live backend.

| Covered |
|---|
| Text deltas accumulate in order |
| Reasoning is separated from visible text |
| Empty deltas emit nothing |
| A tool is announced once even though `tool-input-start` **and** `tool-input-available` both fire |
| Video artifacts are extracted from nested tool output |
| Approval artifacts are extracted and marked pending |
| Identical artifacts nested twice are de-duplicated |
| A failed tool reports failure with no artifacts |
| Malformed JSON does not kill the stream |
| Comments / non-SSE lines are ignored |
| In-stream `error` frames surface a message |
| Unknown frame types are ignored, not fatal |
| `extractArtifacts` survives null / string / list output |

### `test/data/models_test.dart` — 20 tests

The live schema drifts from the generated TypeScript types (audited), so parsing is
defensive and pinned:

| Covered |
|---|
| `assets.status` — `Ready` **and** `Draft` are both terminal |
| The `.../processing` URL sentinel means in-flight |
| Unknown status with a real URL is treated as ready |
| Failure carries `metadata.error` |
| `duration` delivered as a numeric string |
| Missing `metadata` object does not throw |
| `leads` falls back to `status` when `pipeline_stage` is absent |
| `dnp_count` delivered as a string |
| Overdue is day-granular and never true for closed leads |
| Initials for one-word, two-word and missing names |
| Stage classification matches the server categoriser |
| Project cover falls back to the first gallery image |
| Price formatted in Indian units (Cr / L / —) |
| Session round-trip preserves messages, artifacts and state |
| **Tool calls and approval cost survive a save/load cycle** (regression guard) |
| Artifact duration and URL survive a cycle |
| `allArtifacts` returns media newest-first |
| Internal tool ids become owner-readable language |
| Unknown tools degrade to a sentence, never the raw id |

### `test/widget/screens_render_test.dart` — 23 tests

Layout verification across the real device matrix. Any `RenderFlex` overflow
thrown during layout fails the test.

Every primary screen (Home, Create, Projects, Inbox, Business/CRM) ×

| Axis | Values |
|---|---|
| Android sizes | 360×740, 412×915, 480×1000 |
| iPhone sizes | 375×667 (SE), 393×852 (15), 430×932 (Pro Max) |
| Themes | light **and** dark |
| Text scale | 1.0 and **1.3×** on the smallest device |

Plus platform-chrome tests asserting Android renders a Material `NavigationBar`
and iOS renders a `CupertinoTabBar`, and that both expose the same five
destinations.

**These tests found real bugs**, all fixed:

- `NoboPill` overflowed its inner Row when a long stage name met a large text
  size → label is now `Flexible` with ellipsis
- The fast-path cards on Create had an aspect ratio that overflowed with scaled
  text → fixed `mainAxisExtent` with a Row layout
- The CRM lead row overflowed horizontally → `Wrap`
- The CRM pipeline chip overflowed vertically → single-line pill
- The Inbox approval header overflowed with two pills → `Wrap`
- Three segment labels did not fit a 375 dp iOS control → shortened

### `test/widget_test.dart` — 5 tests

Token and theme invariants: light and dark palettes are distinct, both themes
carry the `NoboColors` extension, Material and Cupertino themes resolve to the same
brand colour, and platform detection returns the right kind.

---

## Test infrastructure notes

Two non-obvious things make widget tests possible here, both documented in code:

1. **`SessionRepository` uses synchronous file I/O.** `testWidgets` runs inside a
   fake-async zone where real asynchronous file I/O never completes — an `await`
   on it hangs the test forever with no error. Synchronous I/O is also simply
   better for a few-kilobyte payload written once per turn.

2. **`noboTestWidgets` resets the platform override inside the test body.** Flutter
   asserts that foundation debug variables are unset at the end of the body,
   *before* `tearDown` runs, so resetting in `addTearDown` fails every test with
   "The value of a foundation debug variable was changed by the test".

`pumpNobo()` also forces `disableAnimations: true`, which makes `OrbitMark` and
the skeleton shimmer deterministic. Without that, their repeating controllers mean
`pumpAndSettle` never settles.

---

## What is *not* covered

Named honestly rather than implied:

| Not tested | Why |
|---|---|
| Live backend integration | No test-account credentials. Repository code is written against the audited contracts and exercised through the demo dataset |
| Real auth round-trip | Same |
| Golden-image regression | Screenshots are reviewed by eye (see `screenshots/`); goldens would be flaky across font/impeller versions on two platforms |
| Integration tests on a device (`integration_test`) | Would duplicate the widget matrix; the emulator run covers the real-device path |
| iOS device behaviour | No macOS (see `BUILD_IOS.md`) |
| Video playback | Needs a real MP4 URL; the demo dataset intentionally ships no playable media |
