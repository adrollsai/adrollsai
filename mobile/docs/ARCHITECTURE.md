# Architecture

## Principle

**The existing PWA is the source of truth for business logic.** This app is a
mobile *client*, not a re-platform. It reuses the same Supabase project, the same
GoTrue auth, the same PostgREST data, and the same Next.js API routes. Nothing in
the backend was rewritten, and no database schema was changed.

Where the backend could not support a mobile need, the gap is documented and
worked around without breaking the web app — see [AUDIT.md](AUDIT.md) and
[LIMITATIONS.md](LIMITATIONS.md).

---

## Layers

```
┌──────────────────────────────────────────────────────────────┐
│ presentation   features/*/  — screens, platform-adaptive UI  │
├──────────────────────────────────────────────────────────────┤
│ state          core/providers.dart — Riverpod graph          │
├──────────────────────────────────────────────────────────────┤
│ data           data/repositories/*  + data/local/*           │
│                data/models/* — defensive wire models         │
├──────────────────────────────────────────────────────────────┤
│ transport      supabase_flutter (PostgREST + GoTrue)         │
│                data/remote/nobo_http.dart (Next.js API)      │
└──────────────────────────────────────────────────────────────┘
        design system: core/design (tokens) + core/ui (widgets)
```

There is deliberately **no separate domain layer**. This app renders and mutates
records; inventing an entity layer between the models and the screens would add
files without adding behaviour. The `WorkspaceSource` interface is the one
seam that earns its place: it is what makes the seeded demo dataset possible.

---

## Two data paths, chosen per need

| Path | Used for | Why |
|---|---|---|
| **Supabase PostgREST** directly | profiles, projects, assets, leads, notifications | Native auth with the user's JWT, no server round-trip through Next.js, works with the existing anon key |
| **Next.js `/api/*`** with a Bearer token | AI agent chat, agent approvals, lead activity writes | These hold server-side secrets (AI provider keys, service role) and contain business logic that must not be duplicated |

### Critical: tenant scoping is done in the client

The audit found that migration `20260630000700_fix_all_rls_policies.sql` replaced
the real `auth.uid() = user_id` predicates on `leads`, `assets`, `properties` and
`notifications` with `USING (true)`. RLS is enabled but **permissive** — it will
return other tenants' rows to any authenticated user.

Therefore every query in `WorkspaceRepository` adds `.eq('user_id', uid)`
explicitly. This is a hard rule, not defensive coding.

---

## Authentication

| Concern | Decision |
|---|---|
| Provider | Supabase GoTrue — identical to the PWA, so existing accounts work |
| Methods | Email + password (implemented). Google OAuth is plumbed (`nobogent://auth-callback` scheme is registered on both platforms) but the Supabase dashboard redirect allow-list must be updated before it can complete. |
| Session storage | `supabase_flutter` persists the refresh token natively; `autoRefreshToken: true` |
| Transport to Next.js | `Authorization: Bearer <accessToken>`, refreshed proactively in `NoboHttp` |
| Cookie replay | **Rejected on purpose.** The web session is chunked `sb-*-auth-token.*` cookies that rotate; `/api/*` is excluded from the middleware refresh loop, so a cookie client dies after ~1 hour with no recovery path |

---

## State: Riverpod 3

Providers are kept alive by default (`isAutoDispose: false` in Riverpod 3), which
is what this app wants: workspace data should survive tab switches.

| Provider | Responsibility |
|---|---|
| `accountProvider` | Signed-in `NoboProfile`, sign-in/up/out, invalidates workspace caches when the user changes |
| `projectsProvider` / `assetsProvider` / `leadsProvider` / `noticesProvider` | Read models from `WorkspaceSource` |
| `sessionsProvider` | Owns every task session; persists on every completed turn |
| `attentionCountProvider` | Badge count for the Inbox tab |
| `themeModeProvider` | System / light / dark, persisted to `SharedPreferences` |
| `routerProvider` | The single `GoRouter` instance |

---

## Task sessions — the one place the schema could not be reused

**The backend has no conversation store.** Audited: `/api/agent/v2/chat` reads no
conversation id, persists nothing except one telemetry row, and the web app keeps
the transcript in `localStorage`.

Two options were available: invent `agent_sessions` / `agent_messages` tables
(forbidden by the brief, and it would fork the product's data model), or own the
transcript on the device. This app owns it:

- `SessionRepository` writes to the app's private support directory, atomically
  (temp file + rename), so a crash mid-save cannot corrupt a transcript.
- The **full message history is re-sent on every turn**, which is exactly what the
  stateless endpoint expects.
- Each session records `projectId` / `projectTitle`, so the
  workspace → project → task chain is real.
- Assets are tagged with `metadata.nobo_session_id` when created from mobile, so
  the chain survives to the output — using a `jsonb` column that already exists,
  with no schema change.

**Honest consequence:** transcripts are per-device. Session history does not sync
between phones. Outputs do, because they live in `assets`.

---

## Navigation

`go_router` with `StatefulShellRoute.indexedStack`, giving each of the five tabs
its own navigation stack that survives switching.

```
/login
/home | /create | /projects | /inbox | /business      ← 5 branches
/session/:id        /project/:id      /lead/:id
/settings           /media
```

Page transitions are chosen per platform: `CupertinoPage` on iOS (horizontal
slide + interactive back-swipe), `MaterialPage` on Android (predictive-back aware).

**Five tabs, not eleven.** The web bottom bar carries eleven role-gated items. A
native tab bar holds 3–5; the rest of the surface lives inside Projects and
Settings where a phone user will find it.

---

## Platform split

One shared token set, one shared data layer, two interfaces.

```
core/design/     shared tokens — colour, type, spacing, radius, motion
core/platform/   runtime platform resolution
core/ui/         components; each decides its own platform behaviour
```

Divergence is intentional and lives in exactly two places:

| Layer | Android | iOS |
|---|---|---|
| Navigation bar | Material 3 `NavigationBar` | `CupertinoTabBar`, translucent |
| Page transition | Material + predictive back | Cupertino slide + back-swipe |
| Touch feedback | Ink ripple | opacity/scale dip |
| Buttons | 12 radius, Material metrics | 14 continuous radius |
| Text fields | Material `TextField` | `CupertinoTextField.borderless` |
| Segmented control | custom pill track | `CupertinoSlidingSegmentedControl` |
| Sheets | Material modal sheet | Grabber-led large sheet |
| Dialogs | `AlertDialog` | `CupertinoAlertDialog` |
| Pull-to-refresh | `RefreshIndicator` | `CupertinoSliverRefreshControl` |
| Headers | compact large title, sentence case | 34pt large title, 17pt nav action |
| Haptics | `HapticFeedback` on key actions | native via the same calls |

Both draw from the same palette. Dark mode is art-directed separately, not
inverted.

---

## Performance decisions

| Concern | Approach |
|---|---|
| Media | `cached_network_image` with `memCacheWidth`; video via `video_player` (hardware decode), never on the UI thread |
| Startup | `runApp` is called before anything is awaited, so the animated splash paints on the first frame and `Supabase.initialize`, preferences and storage paths resolve underneath it |
| Lists | `SliverList` / `SliverGrid` builders — no `shrinkWrap` scrolling lists in the hot path |
| Rebuild scope | Riverpod selectors and per-widget `watch`; the streaming transcript updates one message, not the whole screen |
| Release size | R8 minify + resource shrink on; media streamed, never bundled |
| Offline | Typed `NoboFailureKind.offline` surfaces a specific message instead of a generic error; session transcripts work offline |

---

## Cold start

A launch has three visible phases, and only one of them is under the app's
control:

| Phase | What draws it | Duration |
|---|---|---|
| 1. Window background | The OS, from `launch_background.xml` | Until Flutter's first frame |
| 2. Animated splash | `NoboBootSplash`, looping | Until the data layer is ready |
| 3. The app | The router's first screen | Rest of the session |

Phase 1 cannot animate — the system draws a static drawable before any Dart
runs. So phase 2 is made to start from exactly the still image phase 1 ends on:
the finished lockup on the brand's white plate. The eye reads one continuous
image that then comes alive, instead of a logo that appears, freezes, and is
replaced by an unrelated animation.

`main()` therefore awaits nothing before `runApp`. `NoboRoot` owns the cold
start: it paints the splash immediately, does the slow work (storage paths,
preferences, Supabase) underneath, and calls
`noboBootPhaseProvider.markReady()` when it is done. The splash repeats one
dissolve-and-rebuild cycle for as long as that takes, which is seamless because
both ends of the cycle are the same finished lockup — the intro is an idle
state, not a one-shot that a slow start can outlast. A floor of 1.7 s means the
animation is always seen once, and a 12 s valve means a cold start can never
trap someone behind a logo. Tapping the splash skips it outright.

The same clock is handed to `NoboBootGate` inside `NoboApp`, so the hand-off from
"booting" to "running, splash fading" is one uninterrupted animation rather than
a restart.

---

## Loading states

Waiting is where an app looks most generic, so it is branded: `NoboMarkLoader`
draws the same mark geometry as the splash and the app icon, with a highlight
travelling the ring arc and the satellite orbiting the core. It replaces
`CircularProgressIndicator` everywhere — panel loads via `PwaLoading`, inline
button and tool-row spinners via the `size` parameter. It honours reduced
motion by holding a static frame, and it is cheap enough to run per row (no
blur, no shadows, no image assets).

---

## Error handling

Every thrown object is funnelled through `mapError()` into a `NoboFailure` with a
`kind` and an owner-readable `message`. Raw exceptions and stack traces never
reach a widget, and secrets are never logged.

The UI maps kinds to real copy — "You appear to be offline" rather than
"Something went wrong" — and the agent's `403` (super-admin gate) is a
first-class state that explains itself instead of looking like a crash.
