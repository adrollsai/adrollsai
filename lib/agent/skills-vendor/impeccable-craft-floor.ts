/**
 * VENDORED SKILL — do not hand-edit. Refresh with `node scripts/vendor-skills.mjs`.
 *
 *   upstream : pbakaus/impeccable
 *   path     : .claude/skills/impeccable/reference/craft-floor.md
 *   commit   : d41d9860b0094dcb68030657da63461212835aaa
 *   licence  : Apache-2.0
 *
 * The quality floor and the absolute bans. Read before writing any UI: it names what makes output look machine-made, which is the failure being fixed.
 *
 * The licence permits commercial use with attribution, which is what `attribution`
 * carries and what the gate checks. If upstream changes its licence, refresh this file
 * and update the constant — do not strip the attribution to make a test pass.
 */
export const skill = {
  name: "impeccable-craft-floor",
  description: "Load this after the direction is settled, and build without announcing the checklist. A pinned brief or the committed visual world overrides anything here except a line marked as a ban; your own habit does not. When the design hook is active it already enforces the mechanical checks below as you edit: act on its findin",
  content: "# Craft floor\n\nLoad this after the direction is settled, and build without announcing the checklist. A pinned brief or the committed visual world overrides anything here except a line marked as a ban; your own habit does not. When the design hook is active it already enforces the mechanical checks below as you edit: act on its findings instead of re-auditing each rule.\n\n## Verify\n\nEach of these is a check on the built result, not an intention. Run them together in each batched look at the render, not as separate screenshot trips; the checks share one render.\n\n- **Contrast:** body and placeholder text ≥4.5:1, large text ≥3:1. On colored surfaces tint secondary text from that hue or the foreground; never gray.\n- **Depth:** shadows carry an offset and a soft blur. A zero-offset colored halo is decoration.\n- **Spacing:** tight groups, generous separation, more space above a heading than below it. Read the computed values.\n- **Type:** body measure 65–75ch, display max 6rem, tracking floor -0.04em, balanced headings, obvious scale and weight steps. Run the real copy at every breakpoint and fix what overflows.\n- **Motion:** one authored moment, not scattered effects and not one identical entrance on every section. Exponential ease-out from an already-visible default. Reach past transform and opacity: blur, backdrop-filter, clip-path, mask, and shadow belong to the palette when they stay smooth.\n- **States:** hover, disabled, loading, error, empty. Plus real content, working controls, responsive composition, keyboard focus.\n- **Browser surfaces:** the parts you did not draw still carry the design. Text selection, the caret, custom scrollbars, focus rings, underline offset, and the numerals in tabular data all ship with browser defaults that belong to no design system. Theme them from the palette. This is the cheapest signal that a page was built rather than assembled, and the one models skip most reliably.\n- **Copy:** the product's own language. Controls name their action; errors name the problem and the recovery.\n- **Coverage:** every brief requirement present and findable within seconds.\n\n## Refuse\n\nThese are the category's defaults, not bans: the brief's own words can earn any of them. Reaching for one when the axis is free means you were not deciding; recognizing that means rewriting the element, not softening it.\n\nPage scaffolds:\n\n- Same-size cards of icon plus heading plus text as the page structure. Cards are the lazy container; nested cards are always wrong.\n- The hero-metric template: big number, small label, supporting stats, accent.\n- A kicker or eyebrow above a heading. This one is a ban, not a default: no brief earns it back. The heading carries its own weight; delete the label and let the heading speak.\n- Section numbers (01 / 02 / 03) unless the sequence itself carries information the reader needs.\n- A modal for a task that needs neither interruption nor protected focus.\n\nSurface habits:\n\n- Gradient text. Emphasis comes from weight or size.\n- Glass and blur as decoration rather than as a specific effect.\n- A colored `border-left` or `border-right` above 1px on cards, list items, callouts, or alerts.\n- Hard offset shadows (`box-shadow: 4px 4px 0`) outside a world that is actually neobrutalist. The zero-blur block shadow is a costume, not a depth system; a world that did not choose it never earns it as a default.\n- Sparklines, progress rings, and soft-shadowed rounded rectangles standing in for content.\n- Monospace as a costume for \"technical\" rather than for code, data, or measurement.\n- A system display face (Impact, Arial Black, the platform sans) as the display voice of an own-world page. Source and self-host a face whose character matches the approved lettering; the closest installed font is a failure, not a fallback.\n- Unicode glyphs or emoji standing in for an icon system. Icons are drawn, from a real library or authored SVG, in one consistent stroke and weight.\n- Geometric masks standing in for organic contours. A circle, polygon, or radial-gradient cutout approximating a photographic subject's edge is the cheap version of the effect and reads worse than omitting it. Derive an alpha matte from the actual image, or produce a cut-out asset.\n- Light or dark picked by category. Pick it from the use scene: who, where, under what ambient light.\n\nThe floor holds the mechanics; it never picks the direction. With every check green, spend the page on the committed world, and when torn between refined and committed, commit.\n",
  /**
   * What WE use it for. The router can only see text, and upstream descriptions are written
   * for a human browsing a repo — scroll-craft's never says "landing page", so it was
   * invisible to routing for exactly the task it is best at. This line is ours, it is
   * honest about our purpose, and it is what makes the skill findable.
   */
  useFor: "The quality floor and the absolute bans. Read before writing any UI: it names what makes output look machine-made, which is the failure being fixed.",
  attribution: {
    repo: "pbakaus/impeccable",
    path: ".claude/skills/impeccable/reference/craft-floor.md",
    commit: "d41d9860b0094dcb68030657da63461212835aaa",
    licence: "Apache-2.0",
    url: "https://github.com/pbakaus/impeccable/blob/d41d9860b0094dcb68030657da63461212835aaa/.claude/skills/impeccable/reference/craft-floor.md",
  },
} as const;
