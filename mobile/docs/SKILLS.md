# Skills: what was researched, what was installed, what was rejected

The brief asked for an active search of the skills ecosystem, not just a survey of
what was already installed. Every candidate below was fetched, read, and judged on
content, maintenance and licence before any decision.

---

## Method

1. Searched GitHub and skills registries for Flutter, mobile UI/UX, Material 3, iOS
   HIG and visual-QA skills.
2. For each candidate: read the actual `SKILL.md` (not the README pitch), checked
   stars, last push date, licence, and whether it genuinely applied to this task.
3. Installed only what added capability. Two were rejected outright — see below.
4. Where no adequate skill existed (platform guidance, visual QA), authored a local
   equivalent grounded in official documentation, per the brief's instruction.

---

## Installed

### `mobile-app-ui-design` — primary mobile UI/UX design skill

| | |
|---|---|
| Source | https://github.com/ceorkm/mobile-app-ui-design |
| Licence | MIT (declared in README badge; the repository has no `LICENSE` file) |
| Adoption | 522 stars, pushed 2026-10-28 — actively maintained |
| Installed to | `~/.claude/skills/mobile-app-ui-design/` (mirrored to `.agents` and `.gemini`) |

**Why:** substantive 8k `SKILL.md` plus an industry-conventions reference. It
supplies the rules that keep generated interfaces from looking generated: the
60/30/10 colour split, an 8-point spacing grid, thumb-zone placement for primary
actions, the Peak-End rule for success states, and an explicit anti-pattern list
(gradients, >4 type sizes, random spacing, label-over-value emphasis).

**Adopted:** the design process, spacing discipline, hierarchy rules, anti-patterns,
and the "empty states are a design opportunity" stance.

**Overridden, deliberately:**
- Its *Implementation Notes* target React/Tailwind/HTML artifacts. This project is
  Flutter, so those sections were ignored and replaced by the token/component
  system in `docs/DESIGN_SYSTEM.md`.
- It recommends `backdrop-blur` glassmorphism and `rounded-2xl/3xl` card
  aesthetics. Both contradict the brief's explicit warnings about glassmorphism and
  excessive rounding, so radii were tightened to 10–18 and blur was not used.
- Its "maximum 4 font sizes" rule suits a marketing screen; a data-dense business
  app needs a fuller ramp (9 roles), which is documented as a conscious exception.

---

## Rejected

### `full-stack-skills/flutter-skills`

| | |
|---|---|
| Source | https://github.com/full-stack-skills/flutter-skills |
| Licence | Apache-2.0 |
| Adoption | 1 star, pushed 2026-10-03 |

**Rejected on content.** The advertised "comprehensive Flutter skill" is a
**935-character stub**, largely in Chinese, whose substantive guidance is
"参考：https://docs.flutter.dev/" — a link to the docs. It would have consumed a
skill slot and added nothing over reading the official documentation directly,
which is freely available and authoritative.

### `euzharkov/mockup-skills`

| | |
|---|---|
| Source | https://github.com/euzharkov/mockup-skills |
| Licence | MIT |
| Adoption | 2 stars, pushed 2026-10-29 |

**Rejected on fit.** It builds HTML/CSS phone mockups as a design canvas. Valuable
when the deliverable is a mockup; the brief explicitly forbids stopping at mockups
and requires a real Flutter implementation. Its one genuinely good idea — a
`tokens.css` with a live contrast audit — was carried over as the enforced
semantic-colour system plus the documented contrast checks.

---

## Authored locally (no adequate skill existed)

The brief anticipated this: *"If a skill cannot be installed, use its documentation
as a reference and create an equivalent local skill where appropriate."*

Rather than fabricate prompt collections, the platform guidance was taken from
**official sources** and applied directly:

| Area | Source of truth used |
|---|---|
| Android | [Material 3 / M3 Expressive](https://m3.material.io) — motion-physics guidance, adaptive layouts, edge-to-edge, predictive back |
| iOS | [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/) and WWDC sessions on the current design system — tab bars, sheets, context menus, safe areas, Dynamic Type, haptics |
| Flutter | [docs.flutter.dev](https://docs.flutter.dev) plus the installed SDK's own package sources, used to verify the real API surface of Riverpod 3.5 and go_router 18 rather than relying on out-of-date online examples |
| Visual QA | Authored directly against this machine's capabilities — see below |

### Visual QA — built, not downloaded

No off-the-shelf skill could know this environment (Windows, WHPX emulator, no
macOS). The capability was therefore built:

- `test/helpers/pump_app.dart` — pumps any screen at an exact device size, in a
  chosen theme and text scale, on either platform, against the seeded demo
  workspace. Any `RenderFlex` overflow becomes a test failure.
- `test/widget/screens_render_test.dart` — every primary screen × 3 Android sizes ×
  3 iPhone sizes × light/dark × 1.3× Dynamic Type.
- `tools/generate_icons.ps1` — draws the icon set from the same vector geometry the
  app renders at runtime, so launcher and in-app marks cannot drift.
- `NOBO_FORCE_IOS` dart-define — renders the real Cupertino interface on the Android
  emulator, which is how the iOS experience was screenshotted without a Mac.

---

## Dependency hygiene

Before installing anything, the candidate's instructions were read in full and
checked for: shell commands that would execute unreviewed code, network calls to
unknown hosts, credential access, and content that conflicts with this brief. All
installed content is text (markdown); no scripts were executed from a skill.

Runtime dependencies were resolved with `flutter pub add` (so versions are
mutually compatible) and the **actual API surface was verified from the installed
packages** in the pub cache — Riverpod 3.5 and go_router 18 both have breaking
changes relative to the examples most commonly found online.
