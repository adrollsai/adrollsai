# Design system

## Positioning

Nobogent is an AI operating partner for a business owner, not a CRM and not a
chatbot. The interface is deliberately **calm, dense where it matters, and
media-led** — because the product's output is photographs and films, and those
should be the loudest thing on screen.

### The five rules this system enforces

1. **Hierarchy comes from type and space, not from boxes.** Most separation is a
   1px hairline. Shadows are reserved for things that genuinely float (sheets,
   sticky action surfaces, the command card).
2. **One brand gesture, used sparingly.** The violet→indigo orbital gradient marks
   *agent work* — the command entry, the working pill, the primary action. It never
   decorates a static surface.
3. **Radii stay small.** 10–18 for most surfaces; 28 only for sheets. Over-rounded
   cards are the fastest way to look like a template.
4. **Motion is short and purposeful.** 90–280ms. Nothing bounces for decoration.
   Every animation respects reduced-motion.
5. **Platform conventions beat visual uniformity.** A tab bar should feel like the
   platform's tab bar. Colours and type keep the two apps one product.

---

## Colour

Derived from the **logomark** (violet → indigo `#6020D0` → `#4840D0`), sampled
programmatically. Navy/crimson/gold from the marketing palette are secondary roles.

### Brand ramp

| Token | Hex | Use |
|---|---|---|
| `violet600` | `#5F27DC` | Primary action, brand fills (light theme) |
| `violet400` | `#9670FA` | Primary on dark (contrast-safe) |
| `indigo500` | `#5A50E2` | Gradient cool end |
| `crimson600` | `#B31B20` | Approval / irreversible / destructive |
| `gold500` | `#D4AF37` | Credits, achievement |
| `navy800` | `#003D6F` | Brand depth |

**Signature gradient** `orbit` — `#6220D8` → `#3F3FE0` at 135°. Used only on the
command card and the primary glow.

### Semantic roles (not raw colours)

Components never reference a hex. They reference a *role*, which is art-directed
separately per brightness:

`canvas · surface · surfaceSunken · surfaceRaised · border · borderStrong ·
ink · inkSecondary · inkTertiary · inkInverse · primary · primaryWash ·
accent · positive · caution · danger · credit · scrim · hairline · skeleton`

### Themes

| | Light | Dark |
|---|---|---|
| Canvas | `#F6F5FA` (violet-cast paper, never pure white) | `#0A0910` (violet-black, never grey) |
| Surface | `#FFFFFF` | `#141320` |
| Ink | `#14131C` | `#F4F2FA` |
| Primary | `#5F27DC` | `#9670FA` |

Dark is **not** an inversion: surfaces lift by tint, borders are violet-tinted, and
the primary lightens so it stays contrast-safe. Contrast: white on `violet600` is
**7.5:1** (AAA for body text).

---

## Typography

**Inter**, shipped as one bundled variable font (`assets/fonts/Inter.ttf`) so there
is no runtime fetch and no font flash. Weight is applied through `FontVariation`,
not synthetic bolding.

Negative tracking throughout, matching the web product — Inter at default tracking
reads loose and cheap.

| Role | Size/line | Weight | Tracking |
|---|---|---|---|
| `display` | 34/40 | 700 | −0.75 |
| `title` | 26/32 | 700 | −0.57 |
| `headline` | 21/27 | 600 | −0.42 |
| `subtitle` | 17/24 | 600 | −0.30 |
| `body` | 15/22 | 400 | −0.165 |
| `bodyStrong` | 15/22 | 600 | −0.165 |
| `label` | 13/18 | 600 | −0.13 |
| `caption` | 12/16 | 400 | −0.08 |
| `micro` | 11/14 | 600 | **+0.9** (uppercase eyebrows) |

Numbers use tabular figures (`NoboType.numeric`) so credit counts and prices do not
jitter as they change.

`display` appears at most once per screen.

---

## Space, shape, elevation

- **4pt grid.** Every spacing value is a `NoboSpace` constant. Page gutter is **20**
  — wide enough to breathe, tight enough to keep a 360dp device usable.
- **Radius scale** 6 / 10 / 14 / 18 / 22, sheets 28, pills 999.
- **Hairlines over shadows.** `NoboElevation.low` is barely visible by design; it
  defines an edge rather than lifting a card.
- Shadows are tinted violet-black (`#160C33`), never neutral grey — grey over a
  violet canvas reads as dirty.

---

## Motion

| Token | Duration |
|---|---|
| `instant` | 90ms — press states |
| `fast` | 140ms — selection, toggles |
| `base` | 200ms — standard transitions |
| `medium` | 280ms — sheet, expand |
| `hero` | 560ms — shared elements only |

Standard curve `Cubic(0.2, 0, 0, 1)`; `emphasized` `Cubic(0.21, 1.02, 0.35, 1)` for
confirmations.

Reduced motion is honoured: skeleton shimmering degrades to a flat block, and the
orbital indicator stops rotating.

---

## Components (`core/ui/`)

| Component | Notes |
|---|---|
| `NoboButton` | 5 variants × 3 sizes; ripple on Android, scale-dip on iOS |
| `NoboIconButton` | guaranteed ≥44pt target |
| `NoboTextField` | Material `TextField` vs `CupertinoTextField.borderless` |
| `NoboSegmented` | custom pill track vs `CupertinoSlidingSegmentedControl` |
| `NoboCard` | hairline + optional soft shadow; tap feedback is platform-correct |
| `NoboPill` | semantic tones: brand / positive / caution / danger / credit |
| `NoboBadge` | tab count |
| `NoboMediaTile` | **first-class media**: fixed aspect, scrim, play glyph, duration chip, hero-ready |
| `NoboAvatar` | deterministic tint from the name |
| `NoboSectionHeader` | tracked eyebrow + title + trailing action |
| `NoboMetaRow` | label/value pairs |
| `NoboDivider`, `NoboProgressBar` | |
| `NoboSkeleton`, `NoboLoading`, `NoboEmptyState`, `NoboErrorState`, `NoboInlineError` | every state is authored per screen, not genericised |
| `OrbitMark` | the brand mark as **live vector art**; rotates while the agent works |
| `AgentToolTimeline` | agent execution as a timeline, with plain-language tool labels |
| `ApprovalCard` | the one place a spending action is authorised |
| `QuestionCard`, `WhatsappPreviewCard`, `AgentArtifactView` | rich agent outputs |
| `NoboRefreshScroll` | `RefreshIndicator` vs `CupertinoSliverRefreshControl` |
| `AndroidNavBar`, `IosTabBar`, `IosLargeTitle`, `AndroidLargeHeader` | platform chrome |
| `showNoboSheet`, `showNoboConfirm`, `showNoboActions` | sheets and alerts per platform |

---

## Deliberate anti-patterns handled

| Avoided | Instead |
|---|---|
| Generic dashboard of stat cards | One command card + only what needs a decision |
| Overflowing nested containers | Single hairline-bounded surface per group |
| Everything rounded to 24 | 10–18 radii, 28 only for sheets |
| Random shadows | Hairlines; shadows only for floating layers |
| Oversized headings everywhere | One `display`; `title`/`headline` below it |
| Glassmorphism | One gradient, one purpose |
| Generic empty states | Authored copy that explains *why* and offers one action |
| Decorative animation | Motion only for state, navigation and feedback |
| Eleven nav items | Five tabs + secondary surfaces |

---

## Accessibility

- Minimum 44×44pt targets (`NoboSpace.minTapTarget = 48`).
- Dynamic Type supported and clamped to **1.5×**, a documented tradeoff: past that,
  dense tabular and media-grid screens stop being usable before they stop being
  readable.
- Semantic labels on buttons, tabs and icon-only actions.
- Contrast: primary/`onPrimary` 7.5:1; body ink on canvas ≈ 15:1; all semantic
  tones checked against their wash backgrounds.
- Media always carries a scrim under overlaid text, so contrast does not depend on
  the photograph.
- Cross-fade and route transitions inherit the platform's reduced-motion behaviour.
