# Nobogent Mobile

The Nobogent AI business command center, as genuine native apps for Android and
iOS — one Flutter codebase, two deliberately different interfaces.

This is **not** a WebView wrapper. The existing Capacitor shell that lives at the
repository root embeds the PWA; this app is a separate native client that talks to
the same Supabase project and the same Next.js API, and re-implements every screen
in Flutter with platform-native navigation, controls and motion.

---

## What it does

| Area | Screen | What the owner can do |
|---|---|---|
| **Home** | `HomeScreen` | See what needs them, instruct Nobogent, review recent output |
| **Create** | `CreateScreen` | Brief the agent in plain language; open any task session |
| **Task session** | `SessionScreen` | Watch the agent work step by step, approve actions, review artifacts |
| **Projects** | `ProjectsScreen` / `ProjectScreen` | Browse projects (backend `properties`), their assets and tasks |
| **Inbox** | `InboxScreen` | Clear approvals and agent questions; read workspace updates |
| **Business / CRM** | `CrmScreen` / `LeadScreen` | Work leads: call, WhatsApp, move stage, log follow-ups |
| **Settings** | `SettingsScreen` | Account, workspace, light/dark appearance, sign out |

---

## Quick start

```bash
# 1. Configure. The two required values already exist in the PWA's .env.local,
#    so this reads them instead of asking you for secrets.
pwsh -File tools/sync_env.ps1

# 2. Run on a device or emulator
flutter run --dart-define-from-file=dart_defines.json
```

To explore the interface with **no credentials at all**, run the seeded demo
workspace:

```bash
flutter run --dart-define=NOBO_DEMO=true
```

To verify the **iOS interface on a non-Apple machine**:

```bash
flutter run --dart-define=NOBO_DEMO=true --dart-define=NOBO_FORCE_IOS=true
```

---

## Requirements

| Tool | Version used |
|---|---|
| Flutter | 3.47.9 (stable), Dart 3.13.7 |
| Android SDK | API 36 compile / 37 tested, minSdk from Flutter (24) |
| JDK | 17+ (developed against the Android Studio JBR, JDK 25) |
| iOS | Xcode 16+ on macOS — **not available on the machine this was built on** |

---

## Repository layout

```
mobile/
  lib/
    main.dart                  entry point, Supabase init, QA switches
    app/                       MaterialApp + GoRouter, adaptive shell
    core/
      config/                  compile-time configuration
      design/                  tokens: colour, type, metrics, themes
      platform/                runtime platform resolution
      ui/                      the component library (~20 widgets)
      utils/                   formatting, defensive JSON readers
      providers.dart           Riverpod graph
    data/
      models/                  wire models (defensive parsing)
      repositories/            auth, workspace, agent (+ SSE parser)
      local/                   device-local task session store
      demo/                    seeded workspace for design review
    features/                  one folder per product area
  test/                        unit, widget and layout tests
  docs/                        architecture, design system, build guides
  tools/                       icon generation, env sync
```

---

## Documentation

| Document | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layering, state, navigation, data flow, platform split |
| [`docs/AUDIT.md`](docs/AUDIT.md) | Technical audit of the existing PWA this client targets |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | Tokens, components, typography, motion, per-platform rules |
| [`docs/BUILD_ANDROID.md`](docs/BUILD_ANDROID.md) | Emulator setup, builds, signing, release checklist |
| [`docs/BUILD_IOS.md`](docs/BUILD_IOS.md) | What is configured, and exactly what needs a Mac |
| [`docs/TESTING.md`](docs/TESTING.md) | What the 61 tests cover, and what they do not |
| [`docs/SKILLS.md`](docs/SKILLS.md) | Design/engineering skills researched, vetted and installed |
| [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) | Known gaps, backend constraints, honest caveats |

---

## Status

The application builds, analyzes clean, and is verified by an automated test suite
and by screenshots taken from a running emulator. Backend-facing behaviour is
implemented against the real API contracts, but **was not exercised against live
credentials** — see [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) for the precise
list of what is and is not proven.
