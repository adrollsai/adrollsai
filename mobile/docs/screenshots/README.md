# Screenshots

Captured live from the running app on an Android emulator
(AVD `Medium_Phone`, API 37, 1080×2400 @ 420 dpi = 411×914 dp), not from mockups.

The `ios-*` files are the **same app running the real Cupertino widget tree**,
forced on via `--dart-define=NOBO_FORCE_IOS=true`. That is how the iOS interface
was verified without macOS. What this proves and what it does not is spelled out
in [`../BUILD_IOS.md`](../BUILD_IOS.md).

The app runs against a seeded demo workspace (`NOBO_DEMO`) because no test-account
credentials were available. The media is genuine Nobogent property artwork.

## Android

| File | Screen |
|---|---|
| `android-00-launch.png` | Branded launch screen (violet→indigo gradient, orbital mark) |
| `android-01-home.png` | Home — command entry, blocking decisions, work in progress, recent output |
| `android-02-create.png` | Create — agent composer, fast paths, task sessions |
| `android-03-projects.png` | Projects — media-led cards (backend `properties`) |
| `android-04-inbox.png` | Inbox — approvals with cost, agent questions, updates |
| `android-05-crm.png` | Business/CRM — pipeline summary, leads, overdue flags |
| `android-06-session.png` | A task session — conversation, reasoning, artifacts, outputs shelf |

## iOS experience (Cupertino widgets)

| File | Screen |
|---|---|
| `ios-01-home.png` | Home — note the translucent `CupertinoTabBar` and SF-style icons |
| `ios-02-create.png` | Create |
| `ios-04-inbox.png` | Inbox |
| `ios-05-crm.png` | Business/CRM — note the `CupertinoSlidingSegmentedControl`, which differs visibly from Android's segmented track |

## Design decisions visible in these captures

- **One brand gesture.** The violet→indigo orbital gradient appears only on the
  command card (and the primary glow). Everything else is neutral surfaces.
- **Hairlines, not cards-on-cards.** Separation is a 1px border plus, at most, a
  barely-visible shadow.
- **Media is first-class.** Project covers and generated creatives are large,
  full-bleed and carried in fixed-aspect tiles with scrims and duration chips.
- **Agent work is legible.** Tool steps render as a plain-language timeline
  ("Checking your leads", "Rendering video"), and approvals always show the cost.
- **Five tabs, not eleven.** The web app's eleven-item bar became five native
  destinations; the rest of the surface lives inside Projects and Settings.
