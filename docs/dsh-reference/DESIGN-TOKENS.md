# DeepSeek Harness — extracted design system + UI architecture

Everything below was read out of the installed DSH build on this machine, not reconstructed
from screenshots. Source of truth:

- `@deepseek-ai/dsh-client-ui-theme/lib/client.js` → `--dsw-*` token definitions (light + dark)
- `@deepseek-ai/dsh-web-frontend/dist/assets/index-*.css` → how the tokens are consumed
- `@deepseek-ai/dsh-client-ui-*` package manifests → what each UI surface is responsible for

Use this file instead of "make it look like the screenshot". The screenshot is the *result*;
these tokens and this decomposition are the *cause*.

---

## 1. The actual palette

### Static scale (`--dsw-static-*`)

Neutral-bluish is the workhorse — it is what DSH's dark UI is built from, and it is
**not** pure gray. It runs slightly blue/cool.

| Token | Light | Dark use |
|---|---|---|
| `neutral-bluish-00` | `#ffffff` | base bg (light) |
| `neutral-bluish-50` | `#f9fafb` | label-primary (dark), code-block bg (light) |
| `neutral-bluish-60` | `#f9fafb` | markdown placeholder |
| `neutral-bluish-75` | `#f1f3f5` | hover-solid, code segment |
| `neutral-bluish-100` | `#ebeef2` | inline code, ghost-active |
| `neutral-bluish-150` | `#e9ecf2` | overlay bg |
| `neutral-bluish-200` | `#e1e5ee` | label-dimmed (light) |
| `neutral-bluish-300` | `#cfd3d6` | label-secondary (dark) |
| `neutral-bluish-400` | `#adb2b8` | label-tertiary (dark) / caption (light) |
| `neutral-bluish-500` | `#979da6` | ghost border |
| `neutral-bluish-600` | `#81858c` | label-caption (dark) |
| `neutral-bluish-700` | `#61666b` | label-secondary (light) |
| `neutral-bluish-750` | `#43454a` | label-dimmed (dark), tooltip/toast bg (dark) |
| `neutral-bluish-800` | `#353638` | **bg-layer-3 (dark)** |
| `neutral-bluish-850` | `#2c2c2e` | **bg-layer-2 (dark)** |
| `neutral-bluish-875` | `#232324` | **bg-layer-1 (dark)** |
| `neutral-bluish-900` | `#1b1b1c` | code block (dark) |
| `neutral-bluish-950` | `#151517` | **bg-base (dark)** |
| `neutral-bluish-1000` | `#0f1115` | label-primary (light) |

Pure neutral (used for scrollbars / multi-select): `50 #fafafa`, `100 #f5f5f5`,
`150 #ededed`, `200 #e5e5e5`, `250 #dcdcdc`, `300 #d4d4d4`, `400 #a2a4a6`,
`500 #7f8287`, `550 #65676b`, `600 #545557`, `700 #3c3c3d`, `800 #292929`,
`850 #212123`, `900 #0f0f0f`.

Accent — the only saturated colour in the chrome:

| Token | Light | Dark |
|---|---|---|
| `deepseek-50` | `#edf3fe` | |
| `deepseek-100` | `#e4edfd` | |
| `deepseek-200` | `#d3e2ff` | |
| `deepseek-300` | `#b7c8fe` | |
| `deepseek-400` | `#679efe` | info-fill / business-primary |
| `deepseek-450` | `#5686fe` | brand accent |
| `deepseek-500` | `#4176e6` | info-fill (light) |
| `deepseek-600` | `#4868b2` | |
| `deepseek-800` | `#34415b` | business-tertiary (dark) |
| `deepseek-900` | `#283142` | |

Semantic colours: `green-500 #22c55e` / `green-400 #4ed17e` (success),
`red-600 #ec1313` / `red-400 #f25a5a` (error), `amber-500 #f59e0b` / `amber-400 #f7ad31` (warn).

Blue scale exists (`#eff6ff` … `#172554`) but is **not** used for the app chrome.

### Semantic aliases (`--dsw-alias-*`) — light / dark

| Alias | Light | Dark |
|---|---|---|
| `bg-base` | `#ffffff` | `#151517` |
| `bg-layer-1` | `#ffffff` | `#232324` |
| `bg-layer-2` | `#ffffff` | `#2c2c2e` |
| `bg-layer-3` | `#ffffff` | `#353638` |
| `bg-overlay` | `#e9ecf2` | `#61666b` |
| `bg-skeleton` | `#0000000a` | `#ffffff14` |
| `bg-mask-1` | `#0000003d` | `#00000080` |
| `border-l1` | `#0000000a` | `#ffffff0f` (6 %) |
| `border-l2` | `#0000001a` | `#ffffff1f` (12 %) |
| `border-l3` | `#0000001f` | `#ffffff29` (16 %) |
| `border-l4` | `#00000029` | `#fff3` (20 %) |
| `label-primary` | `#0f1115` | `#f9fafb` |
| `label-secondary` | `#61666b` | `#cfd3d6` |
| `label-tertiary` | `#81858c` | `#adb2b8` |
| `label-caption` | `#adb2b8` | `#81858c` |
| `label-dimmed` | `#e1e5ee` | `#43454a` |
| `brand-primary` | `#0f1115` | `#f9fafb` |
| `brand-text` | `#0f1115` | `#f9fafb` |
| `button-primary-fill` | `brand-primary` | `brand-primary` |
| `button-primary-hover` | `#43454a` | `#ebeef2` |
| `button-info-fill` | `#4176e6` | `#679efe` |
| `button-floating-fill` | `#ffffff` | `#2c2c2e` |
| `interactive-bg-hover` | `#2631480f` | `#ffffff14` |
| `interactive-bg-active` | `#2631481a` | `#ffffff24` |
| `state-success-primary` | `#22c55e` | `#4ed17e` |
| `state-error-primary` | `#ec1313` | `#f25a5a` |
| `state-warn-primary` | `#f59e0b` | `#f59e0b` |
| `toast-bg` | `#353638` | `#43454a` |
| `tooltip-bg` | `#2c2c2e` | `#43454a` |
| `markdown-code-block` | `#f9fafb` | `#1b1b1c` |
| `markdown-code-block-banner` | `#f9fafb` | `#2c2c2e` |
| `markdown-inline-code` | `#ebeef2` | `#2c2c2e` |
| `scrollbar-bg-l1` | `#e5e5e5` | `#3c3c3d` |

**Two consequences that matter most:**

1. In dark mode the primary button is **near-white on dark** (`#f9fafb` fill, `#0f1115`
   text). It is *not* blue. Blue appears only for info/active accents.
2. The three dark surfaces are `#151517 → #232324 → #2c2c2e → #353638`. Radius, border and
   shadow do the layering, not big contrast jumps.

---

## 2. Shadows

```
--dsw-shadow-lv1: 0 2px 4px 0 #0000000d
--dsw-shadow-lv2: 0 4px 12px 0 #00000005, 0 2px 8px 0 #0000000a
--dsw-shadow-lv3: 0 0 1px 0 #0003, 0 0 4px 0 #00000005, 0 12px 32px 0 #00000014
```

Three levels, all very soft. Nothing else.

---

## 3. Type scale

Family: `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", …`
Code: `--ds-font-family-code`.

| Token | Spec |
|---|---|
| `xxxs-11` | 11px / 14px, 400 · strong 500 |
| `xxs-12` | 12px / 18px, 400 · strong 500 |
| `xs-13` | 13px / 20px, 400 · strong 500 |
| `s-14` | 14px / 22px, 400 · strong 500 |
| `base-16` | 16px / 24px, 400 · strong 500 |
| `m-18` | 16px / 28px, 500 |
| `l-20` | 20px / 28px, 500 |
| `xl-24` | 24px / 32px, 600 |
| `markdown-base` | 16px / 28px, 400 (strong 600, italic) |
| `markdown-h1` | 700 24px / 34px |
| `markdown-h2` | 700 22px / 32px |
| `markdown-h3` | 700 20px / 30px |
| `markdown-h4` | 600 16px / 28px |
| `markdown-small` | 14px / 24px |
| `markdown-table` | 15px / 25px (head 500) |
| `markdown-code` | 14px / 22px mono |
| `markdown-code-block` | 13px / 22px mono |
| `markdown-code-block-small` | 12px / 18px mono |

Rules that fall out of this: **body copy is 16px, never 12px.** Weight never exceeds 600,
and UI labels are 500. **Nothing is set below 11px.** Muted text is a *colour* change
(`label-secondary` / `label-tertiary` / `label-caption`), not a weight or size change.

---

## 4. Radii

12px is the standard for every code-ish surface: code blocks, terminal, file read, diff,
search results, web results. Buttons/pills/inputs sit below that; panels and the app frame
above it.

---

## 5. Why the UI/UX feels the way it does — the architecture behind it

The look is downstream of a decomposition. From the package manifests:

| Plugin | Responsibility (verbatim) |
|---|---|
| `dsh-client-ui-layout` | "Shell plugin: three-column AppFrame with drag handles, `ctx.layout` viewing-state service (navigation + panels)" |
| `dsh-client-ui-sidebar` | "Sidebar plugin: session multi-level tree, search, grouping, state dots" |
| `dsh-client-ui-conversation` | "skeleton, ordered chat flow, composer with the Host-backed busy-Enter preference, and details host" |
| `dsh-client-ui-tool` | "Client Tool call-tree renderer and **keyed per-tool presentation slot**" |
| `dsh-client-ui-trajectory` | trajectory view of the run |
| `dsh-client-ui-plan` / `-goal` / `-jobs` / `-subagent` / `-workflow-run` | one surface per agent concept |
| `dsh-client-ui-theme` | the `--dsw-*` tokens above + light/dark/system + Appearance row |
| `dsh-client-ui-brand-official` | branding (the only thing to swap for white-label) |
| `dsh-client-ui-primitives` / `-slots` | shared primitives + slot registry every plugin renders into |
| `dsh-client-ui-renderer`, `-deliverables`, `-attachment`, `-workspace`, `-skills`, `-model-selection`, `-permission-presets`, `-user-questions`, `-message-feedback`, `-commands`, `-input-trigger`, `-reference`, `-settings*` | everything else you see in the frame |

And the data plane, which is the real reason the UI can be this specific:

- `dsh-session-projection` — "the merge-extensible state and client-view type tables, the
  `ProjectionDefinition` state-driven computation unit contract, and the
  `ctx.sessionProjections` registry that DRIVES every registered unit forward eagerly over
  committed session events." Folds are **pure + synchronous**, state is **plain JSON**. A
  unit that does not care about an event must return the *same reference*.
- Whole-value event rule (load-bearing, quoted from the type docs): *"a state-carrying log
  event MUST carry the complete post-change state, never a bare delta."*
- `dsh-agent-tool-presentation` — tool results are rendered through a **presentation
  protocol**, not `JSON.stringify`.
- `dsh-client-connection` + `dsh-api-remotes` — the browser is a client of a host over a
  typed remote API. The UI is not the owner of state.

**That is the thing to copy.** A chat panel that receives AI-SDK message parts cannot
produce DSH's surface, because DSH's surface is a *view over a durable, projected event log*
with per-concept plugins and a tool-presentation registry.

---

## 6. Delta vs. the current `components/agent/AgentChat.tsx`

| Current | DSH |
|---|---|
| `bg-[#0d0e12]` (invented) | `bg-base` = `#151517`, layers `#232324` / `#2c2c2e` / `#353638` |
| whole thread rendered `font-mono text-xs` (12px) | sans 16px/28px; mono only for code |
| `font-extrabold` headings | 500 / 600 max |
| `text-[9px]`, `text-[10px]` labels | 11px floor (`xxxs-11`), then colour for hierarchy |
| `bg-blue-600` brand + `text-blue-400` icons | chrome is neutral; `#5686fe` only for info/active |
| `border-zinc-800` | `border-l1/l2` = white @6 %/12 % |
| tool `if/else` on name + `JSON.stringify` dump | keyed per-tool presentation slot |
| hardcoded row `Context injection • @nobogent/dsh-system-prompt` on every message | real projection unit output |
| `useChat` + `localStorage` session tree | host-owned event log + projection + remotes |
| 90 ad-hoc modal/drawer patterns | slot-registered panels in a 3-column frame |

---

## 7. The utility layer as implemented

The tokens above are applied through a small set of scoped classes in
`lib/ui/dsh-tokens.css`. Components must compose these rather than reintroducing a
Tailwind palette colour — **a raw `zinc-800` / `blue-600` / `slate-*` inside `.dsh`
is a bug.**

| Class | Meaning |
|---|---|
| `.dsh-surface-1` | `bg-layer-1` — the app frame |
| `.dsh-surface-2` | `bg-layer-2` — cards, bubbles, composer |
| `.dsh-surface-3` | `bg-layer-3` — inset chips, thumbnails, segmented control |
| `.dsh-border` / `-l2` / `-t` / `-b` | 1 px `border-l1` / `border-l2` / top / bottom |
| `.dsh-interactive` | the only hover background (`interactive-bg-hover`) |
| `.dsh-interactive-danger` | hover background + error label |
| `.dsh-selected` | `interactive-bg-active` (selected tab / session) |
| `.dsh-btn-primary` | near-white on dark, near-black on light; **never blue** |
| `.dsh-btn` | secondary/ghost control |
| `.dsh-chip` | inline chip (attachments, counts, badges) |
| `.dsh-card` | floating surface + `shadow-lv3` |
| `.dsh-accent` / `.dsh-danger` / `.dsh-success` / `.dsh-warn` | label colours |
| `.dsh-success-bg` / `.dsh-accent-bg` | dot / bar fills |
| `.dsh-tree-rail` | nested session-list rail |
| `.dsh-listening` | active dictation (respects `prefers-reduced-motion`) |
| `.dsh-t-xxxs…xl` | the type scale above |
| `.dsh-label-primary/secondary/tertiary/caption` | the four label levels |
| `.dsh-strong` (500) · `.dsh-mono` · `.dsh-tnum` | weight, code font, tabular numbers |

### Theme strategy

`.dsh` scopes everything and defaults to **dark**; `.dsh[data-theme='light']` opts out.
This matters because `tailwind.config.ts` sets **no `darkMode`**, so Tailwind v3 defaults
to `darkMode: 'media'` and every `dark:` variant keys off the *operating system*, not the
app. Any harness surface written with `X dark:Y` pairs therefore renders its **light**
branch inside the dark UI on a light-OS machine. That is why the components were
converted to tokens rather than left on `dark:` pairs.

