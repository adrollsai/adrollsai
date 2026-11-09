# Known limitations

Written to be accurate rather than flattering. Everything here is a real
constraint of this build or of the backend it talks to.

---

## What is proven vs. not proven

| Claim | Status |
|---|---|
| Compiles for Android; debug APK builds and installs | **Proven** — built and run on the emulator |
| `flutter analyze` passes with zero issues | **Proven** |
| Automated test suite passes | **Proven** — run and reported below |
| Every primary screen lays out without overflow on 6 device sizes, both platforms, both themes, 1.3× text | **Proven** — automated |
| Visual quality verified from screenshots | **Proven** — screenshots captured from the running app, in [screenshots/](screenshots/) |
| Supabase auth (email + password) works end to end | **Not exercised** — no test account credentials. Code path matches the PWA's own call 1:1 |
| Live data loads (projects, assets, leads, notifications) | **Not exercised** — implemented against audited contracts; verified against the real schema shape only via fixtures |
| The AI agent streams a real response | **Not exercised** — see the 403 gate below |
| Approving an agent action dispatches a WhatsApp broadcast | **Not true, by backend design** — see below |
| iOS builds and runs | **Not possible on this machine** — no macOS/Xcode. See [BUILD_IOS.md](BUILD_IOS.md) |
| Native push notifications | **Not implemented** — no backend support; see below |

---

## 1. The AI agent is super-admin only

`POST /api/agent/v2/chat` returns `403 "Nobo is restricted to Super Admin only"`
for every role except `super_admin` (plus one hard-coded founder email).

This was **not changed**. Loosening it would alter the security posture of a
production system, and it is a product/billing decision, not an engineering one.

**What the app does instead:** the composer is read-only for non-owner roles, with
a plain explanation ("Nobogent AI is currently limited to workspace owners"). A
`403` mid-session is a typed failure that renders a specific banner and charges
nothing — never a raw error.

**To open it up** (a small, additive backend change, not done here):

```ts
// app/api/agent/v2/chat/route.ts
// 1. Accept a Bearer token, as `crm/lead-action` already does:
const auth = request.headers.get('authorization');
if (auth?.startsWith('Bearer ')) {
  const { data, error } = await supabaseAdmin.auth.getUser(auth.slice(7));
  user = error ? null : data.user;
}
// 2. Replace the super_admin gate with a per-tenant permission check, and
//    bill the agent tool usage to the caller's credits.
```

Until then the mobile agent works only for owner accounts.

---

## 2. Approving does not execute

`POST /api/agent/v2/action` updates status and returns a synthesised result
(`{dispatched:true, recipientsCount:116}`) but **dispatches no WhatsApp message and
places no call**. It is a state-machine placeholder.

The UI reflects this: it says **"Approved"**, never "Sent". The approval card
carries the line *"Nobogent will not send anything until you approve"*, and the
confirmation is *"Approved. Nobogent recorded your decision."*

---

## 3. Task sessions are per-device

The backend has no conversation store (`/api/agent/v2/chat` persists nothing and
reads no conversation id), so transcripts live on the device — see
[ARCHITECTURE.md](ARCHITECTURE.md).

**Consequence:** sessions do not sync between phones, and reinstalling clears them.
Generated assets *do* persist, because they live in `assets`.

A proper server-side session store would need new tables (`agent_sessions`,
`agent_messages`). That was explicitly out of scope: the brief forbids inventing
incompatible database structures.

---

## 4. No native push notifications

`push_subscriptions` is a **web-push** table (`endpoint`, `p256dh`, `auth`). There
is no FCM registration token or APNs column anywhere in the schema, and no device
registration endpoint.

Implementing native push therefore needs backend work first:

1. A `device_tokens` table (user id, token, platform, created_at).
2. A registration route.
3. FCM + APNs credentials, and APNs requires an Apple Developer account.

Not implemented rather than faked. The Inbox is the in-app substitute and is fully
functional.

---

## 5. Google OAuth is plumbed but not completable

The `nobogent://auth-callback` scheme is registered in `AndroidManifest.xml` and
would be in `Info.plist`, and `AuthRepository` exposes the reset flow. But the
Supabase project's **redirect allow-list is a dashboard setting** and currently only
allows localhost URLs, so an OAuth round-trip cannot complete until
`nobogent://auth-callback` is added there.

Email + password sign-in works today.

---

## 6. Video playback needs a real URL

Generated videos are MP4s on Cloudflare R2 and play through the native player
(`video_player` → ExoPlayer/AVPlayer). The **demo dataset** contains no playable
media, so demo video tiles show poster art with a "poster only" note. That is a
demo-data limitation, not a player limitation.

---

## 7. iOS is configured but unverified

Everything that can be authored on Windows is authored: bundle identifier, display
name, orientations, usage descriptions, URL scheme, icon set. Nothing was compiled
or launched. Exact steps and gaps are in [BUILD_IOS.md](BUILD_IOS.md).

The iOS *interface* was render-verified on the Android emulator using
`NOBO_FORCE_IOS=true` — that proves layout, typography and overflow behaviour of
the Cupertino widget tree, but it is **not** a substitute for an iPhone for native
behaviour such as back-swipe feel, keyboard avoidance, or safe-area insets on
notched hardware.

---

## 8. Features of the PWA that were intentionally not ported

Eleven web nav destinations were reduced to five native tabs. These surfaces have
**no mobile screen yet** and are reachable only through the agent or the web:

Analytics · Ads Manager · WhatsApp portal · GBP Suite · GBP Audit · Flows ·
Automations Studio · Voice Agent · Landing Pages · Audience groups · Team · Billing ·
Video editor

Each is a candidate for a follow-up phase. Billing in particular must go through the
platform stores (StoreKit / Play Billing) rather than Razorpay for a native app, and
that requires product decisions well beyond a UI port.

---

## 9. Environment constraints encountered

Recorded because they affect reproducing this build:

- Machine has **7.7 GB RAM total**. The Flutter template's default
  `org.gradle.jvmargs=-Xmx8G` crashed the Gradle daemon with a native OOM; it is
  now `-Xmx1536m` with Kotlin compiled in-process. The emulator must be stopped
  while building.
- Kotlin incremental caching became corrupt after that JVM crash and was disabled
  (`kotlin.incremental=false`); builds are therefore a little slower but reliable.
- `compileSdk` had to be raised to **37** because `permission_handler_android`
  targets 37.
- The Android build takes ~8–13 minutes on this hardware, cold or warm.

---

## 10. Not implemented from the brief

| Item | Why |
|---|---|
| Voice input in the composer | Needs a speech-recognition plugin and a permission flow; the backend has no transcription route for arbitrary audio |
| File attachments from the composer | `POST /api/upload` is **unauthenticated** (audited) and therefore unsafe to call; the signed-URL route is cookie-only. Needs a Bearer-capable upload route first |
| Biometric authentication | Supabase has no device-biometric factor; would need `local_auth` guarding the persisted session. Straightforward follow-up, not a blocker |
| Deep-link routing beyond auth callbacks | Link targets for sessions/assets do not exist server-side |
| Offline mutations queue | Reads degrade honestly; writes require connectivity |
