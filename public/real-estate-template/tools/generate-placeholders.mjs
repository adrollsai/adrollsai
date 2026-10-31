/**
 * Placeholder artwork generator for the Everline Realty template.
 * ---------------------------------------------------------------
 * Produces dependency-free SVG "photo" placeholders so the template looks
 * finished out of the box and works offline.
 *
 *   node tools/generate-placeholders.mjs
 *
 * Replace any generated file with a real .jpg/.webp and update the path in
 * assets/js/data.js (properties/agents/posts) or in the page markup.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "assets", "img");
mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ */
/* Palettes — muted, editorial, real-estate friendly                    */
/* ------------------------------------------------------------------ */
const P = {
  emerald: { a: "#0B2A26", b: "#2E6F62", c: "#E6BB72", glass: "#EAF6F1" },
  navy:    { a: "#0B1526", b: "#2C4A72", c: "#D9B36B", glass: "#E8EFF7" },
  sage:    { a: "#22291F", b: "#5C7257", c: "#DFC79A", glass: "#EDF2E8" },
  sand:    { a: "#3A2C22", b: "#9A7A57", c: "#F0D9B2", glass: "#F7EFE4" },
  slate:   { a: "#141C24", b: "#4A5F72", c: "#CBAE7D", glass: "#E9EFF3" },
  clay:    { a: "#33201C", b: "#9A5F4C", c: "#EFCBA4", glass: "#F8ECE4" },
  olive:   { a: "#20261C", b: "#6B7A4B", c: "#E3CD97", glass: "#F1F2E6" },
  teal:    { a: "#08222B", b: "#2B6B77", c: "#E2C286", glass: "#E6F2F4" },
  plum:    { a: "#241A28", b: "#5E4A6B", c: "#DDC08C", glass: "#F1EAF2" },
  forest:  { a: "#0A1F1A", b: "#3F6A4F", c: "#DCC48B", glass: "#EAF3EC" },
  dusk:    { a: "#10131F", b: "#4B4F72", c: "#E4C489", glass: "#ECEDF6" },
  moss:    { a: "#1B2118", b: "#56663F", c: "#E6D2A0", glass: "#F0F1E5" },
};

const ORDER = ["emerald", "navy", "sage", "sand", "slate", "clay", "olive", "teal", "plum", "forest", "dusk", "moss"];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const r = (n) => Math.round(n * 100) / 100;
const rand = (seed) => {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
};

/** Blend a hex colour toward white — used to keep skies luminous. */
function lighten(hex, amt = 0.5) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c + (255 - c) * amt));
  return "#" + ch.map((c) => c.toString(16).padStart(2, "0")).join("");
}

function defs(p, id, dark = false) {
  const top = dark ? p.a : lighten(p.b, 0.72);
  const mid = dark ? p.b : lighten(p.b, 0.38);
  const bottom = dark ? "#060B12" : p.b;
  return `<defs>
    <linearGradient id="sky-${id}" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="${top}"/>
      <stop offset="0.55" stop-color="${mid}"/>
      <stop offset="1" stop-color="${bottom}"/>
    </linearGradient>
    <radialGradient id="sun-${id}" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${p.c}" stop-opacity="0.95"/>
      <stop offset="0.5" stop-color="${p.c}" stop-opacity="0.3"/>
      <stop offset="1" stop-color="${p.c}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="glass-${id}" x1="0" y1="0" x2="0.2" y2="1">
      <stop offset="0" stop-color="${p.glass}" stop-opacity="${dark ? 0.75 : 0.85}"/>
      <stop offset="1" stop-color="${p.glass}" stop-opacity="${dark ? 0.22 : 0.3}"/>
    </linearGradient>
    <linearGradient id="vig-${id}" x1="0" y1="0.45" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="${dark ? 0.4 : 0.26}"/>
    </linearGradient>
  </defs>`;
}

/** grid of lit windows */
function windows({ x, y, cols, rows, w, h, gx, gy, id, lit = [] }) {
  let out = "";
  for (let c = 0; c < cols; c++) {
    for (let row = 0; row < rows; row++) {
      const isLit = lit.includes(`${c},${row}`);
      const fill = isLit ? `url(#sun-${id})` : `url(#glass-${id})`;
      out += `<rect x="${r(x + c * (w + gx))}" y="${r(y + row * (h + gy))}" width="${w}" height="${h}" rx="${Math.min(4, w / 6)}" fill="${fill}" opacity="${isLit ? "0.85" : "0.72"}"/>`;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Property "photographs"                                              */
/* ------------------------------------------------------------------ */
function propertyArt({ w = 1600, h = 1000, p, variant, seed }) {
  const id = `p${seed}`;
  const rnd = rand(seed);
  const ground = h * 0.76;
  const sunX = r(140 + rnd() * (w - 280));
  const sunY = r(h * 0.24 + rnd() * h * 0.12);
  const sunR = r(w * 0.2);

  /* distant skyline / tree line */
  let far = `<g opacity="0.22">`;
  let fx = -60;
  while (fx < w + 60) {
    const bw = 60 + rnd() * 170;
    const bh = 40 + rnd() * 170;
    far += `<rect x="${r(fx)}" y="${r(ground - bh)}" width="${r(bw)}" height="${r(bh + 40)}" fill="${p.a}" opacity="${r(0.35 + rnd() * 0.4)}"/>`;
    fx += bw + 12;
  }
  far += `</g>`;

  const glass = `url(#glass-${id})`;
  const glow = `url(#sun-${id})`;
  let house = "";

  if (variant === 0) {
    /* modern stacked block */
    const bx = w * 0.16, bw = w * 0.52, bh = h * 0.3;
    house += `<rect x="${r(bx)}" y="${r(ground - bh)}" width="${r(bw)}" height="${r(bh)}" fill="${p.a}" opacity="0.88" rx="6"/>`;
    house += `<rect x="${r(bx + bw * 0.46)}" y="${r(ground - bh * 1.62)}" width="${r(bw * 0.52)}" height="${r(bh * 0.62)}" fill="${p.a}" opacity="0.94" rx="6"/>`;
    house += `<rect x="${r(bx + bw * 0.46)}" y="${r(ground - bh * 1.62)}" width="${r(bw * 0.52)}" height="10" fill="${p.c}" opacity="0.5" rx="5"/>`;
    house += windows({ x: bx + 34, y: ground - bh + 46, cols: 4, rows: 2, w: (bw - 120) / 5.2, h: bh * 0.26, gx: 26, gy: 26, id, lit: ["2,0"] });
    house += windows({ x: bx + bw * 0.46 + 30, y: ground - bh * 1.62 + 46, cols: 2, rows: 1, w: (bw * 0.52 - 110) / 2.6, h: bh * 0.24, gx: 24, gy: 20, id, lit: ["0,0"] });
    house += `<rect x="${r(bx + bw * 0.08)}" y="${r(ground - bh * 0.52)}" width="${r(bw * 0.2)}" height="${r(bh * 0.52)}" fill="${glass}" opacity="0.5"/>`;
    /* pergola */
    house += `<g stroke="${p.glass}" stroke-opacity="0.3" stroke-width="7">`;
    for (let i = 0; i < 7; i++) {
      house += `<line x1="${r(bx + bw * 0.72 + i * 26)}" y1="${r(ground - bh * 1.62 + 10)}" x2="${r(bx + bw * 0.72 + i * 26)}" y2="${r(ground)}"/>`;
    }
    house += `</g>`;
  } else if (variant === 1) {
    /* pitched roof home */
    const bx = w * 0.2, bw = w * 0.44, bh = h * 0.26, roofH = h * 0.16;
    house += `<path d="M${r(bx - 40)} ${r(ground - bh)} L${r(bx + bw / 2)} ${r(ground - bh - roofH)} L${r(bx + bw + 40)} ${r(ground - bh)} Z" fill="${p.a}" opacity="0.95"/>`;
    house += `<rect x="${r(bx)}" y="${r(ground - bh)}" width="${r(bw)}" height="${r(bh)}" fill="${p.a}" opacity="0.85"/>`;
    house += `<rect x="${r(bx + bw * 0.62)}" y="${r(ground - bh * 0.72)}" width="${r(bw * 0.3)}" height="${r(bh * 0.72)}" fill="${glass}" opacity="0.42"/>`;
    house += windows({ x: bx + 40, y: ground - bh + 40, cols: 3, rows: 2, w: (bw - 140) / 3.6, h: bh * 0.24, gx: 22, gy: 24, id, lit: ["1,1"] });
    house += `<rect x="${r(bx + bw / 2 - 22)}" y="${r(ground - bh - roofH * 0.62)}" width="44" height="${r(roofH * 0.5)}" fill="${p.a}" opacity="0.9"/>`;
    /* chimney smoke-free stack */
    house += `<rect x="${r(bx + bw * 0.8)}" y="${r(ground - bh - roofH * 0.55)}" width="34" height="${r(roofH * 0.55)}" fill="${p.a}" opacity="0.8"/>`;
  } else if (variant === 2) {
    /* glass tower */
    const bx = w * 0.3, bw = w * 0.26, bh = h * 0.52;
    house += `<rect x="${r(bx)}" y="${r(ground - bh)}" width="${r(bw)}" height="${r(bh)}" fill="${p.a}" opacity="0.9" rx="8"/>`;
    house += `<rect x="${r(bx - w * 0.05)}" y="${r(ground - bh * 0.42)}" width="${r(w * 0.16)}" height="${r(bh * 0.42)}" fill="${p.a}" opacity="0.78" rx="6"/>`;
    house += windows({ x: bx + 22, y: ground - bh + 26, cols: 4, rows: 9, w: (bw - 70) / 4.6, h: bh * 0.068, gx: 12, gy: 14, id, lit: ["1,2", "2,5", "0,7"] });
    house += windows({ x: bx - w * 0.05 + 18, y: ground - bh * 0.42 + 24, cols: 2, rows: 3, w: (w * 0.16 - 60) / 2.6, h: bh * 0.07, gx: 14, gy: 16, id, lit: ["1,1"] });
    house += `<rect x="${r(bx)}" y="${r(ground - bh)}" width="${r(bw)}" height="8" fill="${p.c}" opacity="0.55" rx="4"/>`;
    /* reflection pool */
    house += `<ellipse cx="${r(bx + bw / 2)}" cy="${r(ground + h * 0.06)}" rx="${r(bw * 1.5)}" ry="${r(h * 0.035)}" fill="${p.glass}" opacity="0.14"/>`;
  } else {
    /* low villa with pool + palms */
    const bx = w * 0.12, bw = w * 0.62, bh = h * 0.22;
    house += `<rect x="${r(bx)}" y="${r(ground - bh)}" width="${r(bw)}" height="${r(bh)}" fill="${p.a}" opacity="0.88" rx="6"/>`;
    house += `<rect x="${r(bx - 18)}" y="${r(ground - bh - 22)}" width="${r(bw + 36)}" height="22" fill="${p.a}" opacity="0.96" rx="4"/>`;
    house += `<rect x="${r(bx - 18)}" y="${r(ground - bh - 22)}" width="${r(bw + 36)}" height="7" fill="${p.c}" opacity="0.4" rx="3"/>`;
    house += windows({ x: bx + 30, y: ground - bh + 40, cols: 5, rows: 1, w: (bw - 100) / 5.8, h: bh * 0.42, gx: 18, gy: 18, id, lit: ["3,0"] });
    house += `<rect x="${r(bx + bw * 0.06)}" y="${r(ground - bh * 0.5)}" width="${r(bw * 0.16)}" height="${r(bh * 0.5)}" fill="${glass}" opacity="0.45"/>`;
    /* pool */
    house += `<rect x="${r(bx + bw * 0.3)}" y="${r(ground + h * 0.03)}" width="${r(bw * 0.55)}" height="${r(h * 0.07)}" rx="8" fill="${p.glass}" opacity="0.22"/>`;
    house += `<rect x="${r(bx + bw * 0.3)}" y="${r(ground + h * 0.03)}" width="${r(bw * 0.55)}" height="5" rx="2" fill="${p.c}" opacity="0.3"/>`;
    /* palms */
    for (let i = 0; i < 2; i++) {
      const px = bx + bw * (0.92 + i * 0.09), py = ground - h * 0.02;
      house += `<line x1="${r(px)}" y1="${r(py)}" x2="${r(px + 10)}" y2="${r(py - h * 0.24)}" stroke="${p.a}" stroke-opacity="0.75" stroke-width="9"/>`;
      house += `<ellipse cx="${r(px + 12)}" cy="${r(py - h * 0.25)}" rx="${r(w * 0.05)}" ry="${r(h * 0.035)}" fill="${p.a}" opacity="0.6"/>`;
      house += `<ellipse cx="${r(px - 10)}" cy="${r(py - h * 0.22)}" rx="${r(w * 0.04)}" ry="${r(h * 0.028)}" fill="${p.a}" opacity="0.5"/>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Property photo placeholder">
  ${defs(p, id)}
  <rect width="${w}" height="${h}" fill="url(#sky-${id})"/>
  <circle cx="${sunX}" cy="${sunY}" r="${sunR}" fill="url(#sun-${id})"/>
  ${far}
  <rect x="0" y="${r(ground)}" width="${w}" height="${r(h - ground)}" fill="${p.a}" opacity="0.5"/>
  ${house}
  <rect width="${w}" height="${h}" fill="url(#vig-${id})"/>
  <rect x="0" y="${r(ground)}" width="${w}" height="2" fill="${p.c}" opacity="0.35"/>
</svg>`;
}

/* ------------------------------------------------------------------ */
/* Portrait / avatar art                                               */
/* ------------------------------------------------------------------ */
function portraitArt({ initials, p, w = 900, h = 1100, seed, figure = true }) {
  const id = `a${seed}`;
  const cx = w / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Agent portrait placeholder">
  ${defs(p, id, true)}
  <rect width="${w}" height="${h}" fill="url(#sky-${id})"/>
  <circle cx="${r(cx)}" cy="${r(h * 0.42)}" r="${r(w * 0.52)}" fill="url(#sun-${id})" opacity="0.7"/>
  ${
    figure
      ? `<g opacity="0.5">
    <circle cx="${r(cx)}" cy="${r(h * 0.4)}" r="${r(w * 0.17)}" fill="${p.a}" opacity="0.55"/>
    <path d="M${r(cx - w * 0.34)} ${r(h)} q${r(w * 0.06)} ${r(-h * 0.34)} ${r(w * 0.34)} ${r(-h * 0.34)} q${r(w * 0.28)} 0 ${r(w * 0.34)} ${r(h * 0.34)} Z" fill="${p.a}" opacity="0.5"/>
  </g>`
      : ""
  }
  <text x="${r(cx)}" y="${r(h * 0.57)}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="${r(w * 0.3)}" fill="${p.glass}" fill-opacity="0.34" letter-spacing="6">${initials}</text>
  <rect width="${w}" height="${h}" fill="url(#vig-${id})" opacity="0.7"/>
</svg>`;
}

/* ------------------------------------------------------------------ */
/* Abstract editorial art (blog / about / neighbourhood)                */
/* ------------------------------------------------------------------ */
function abstractArt({ p, w = 1600, h = 900, seed, label = "" }) {
  const id = `x${seed}`;
  const rnd = rand(seed);
  let shapes = "";
  const count = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < count; i++) {
    const t = rnd();
    const x = r(w * (0.1 + rnd() * 0.8));
    const y = r(h * (0.15 + rnd() * 0.7));
    const size = r(Math.min(w, h) * (0.16 + rnd() * 0.34));
    if (t < 0.4) {
      shapes += `<circle cx="${x}" cy="${y}" r="${r(size / 2)}" fill="${p.glass}" opacity="${r(0.05 + rnd() * 0.08)}"/>`;
    } else if (t < 0.75) {
      shapes += `<rect x="${r(x - size / 2)}" y="${r(y - size / 2)}" width="${r(size)}" height="${r(size * (0.5 + rnd()))}" rx="10" fill="${p.glass}" opacity="${r(0.05 + rnd() * 0.09)}" transform="rotate(${r(rnd() * 30 - 15)} ${x} ${y})"/>`;
    } else {
      shapes += `<path d="M${x} ${y} q${r(size * 0.6)} ${r(-size * 0.5)} ${r(size)} 0 t${r(size)} 0" stroke="${p.c}" stroke-opacity="${r(0.18 + rnd() * 0.22)}" stroke-width="${r(2 + rnd() * 4)}" fill="none"/>`;
    }
  }
  let skyline = `<g opacity="0.2">`;
  let fx = -40;
  while (fx < w) {
    const bw = 40 + rnd() * 120;
    const bh = 30 + rnd() * h * 0.3;
    skyline += `<rect x="${r(fx)}" y="${r(h - bh)}" width="${r(bw)}" height="${r(bh)}" fill="${p.a}"/>`;
    fx += bw + 8;
  }
  skyline += `</g>`;
  const text = label
    ? `<text x="${r(w * 0.5)}" y="${r(h * 0.52)}" text-anchor="middle" font-family="Georgia, serif" font-size="${r(Math.min(w, h) * 0.11)}" fill="${p.glass}" fill-opacity="0.2" letter-spacing="10">${label}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Editorial image placeholder">
  ${defs(p, id, true)}
  <rect width="${w}" height="${h}" fill="url(#sky-${id})"/>
  <circle cx="${r(w * 0.76)}" cy="${r(h * 0.26)}" r="${r(w * 0.3)}" fill="url(#sun-${id})"/>
  ${shapes}
  ${skyline}
  ${text}
  <rect width="${w}" height="${h}" fill="url(#vig-${id})" opacity="0.65"/>
</svg>`;
}

/* ------------------------------------------------------------------ */
/* Brand marks                                                         */
/* ------------------------------------------------------------------ */
const markSvg = (accent = "#C79A4B", ink = "#0B1220") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" role="img" aria-label="Brand mark">
  <rect width="48" height="48" rx="12" fill="${ink}"/>
  <path d="M11 30.5 24 12l13 18.5" fill="none" stroke="${accent}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M17.5 36.5V24.5h13v12" fill="none" stroke="#FBF9F6" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>
  <circle cx="24" cy="18.4" r="1.9" fill="${accent}"/>
</svg>`;

/* ------------------------------------------------------------------ */
/* Emit                                                               */
/* ------------------------------------------------------------------ */
const written = [];
function save(name, svg) {
  writeFileSync(join(OUT, name), svg.replace(/\n\s*\n/g, "\n"));
  written.push(name);
}

/* 12 property photos, 4 composition variants across the palette */
for (let i = 0; i < 12; i += 1) {
  const key = ORDER[i % ORDER.length];
  save(
    `prop-${String(i + 1).padStart(2, "0")}.svg`,
    propertyArt({ p: P[key], variant: i % 4, seed: i + 1 })
  );
}

/* hero + editorial */
save("hero-main.svg", propertyArt({ p: P.emerald, variant: 3, seed: 71, w: 1200, h: 1500 }));
save("hero-side.svg", propertyArt({ p: P.sand, variant: 0, seed: 72, w: 900, h: 700 }));
save("about-story.svg", propertyArt({ p: P.slate, variant: 1, seed: 73, w: 1400, h: 1000 }));
save("about-team.svg", abstractArt({ p: P.forest, w: 1600, h: 900, seed: 74, label: "TEAM" }));
save("map-panel.svg", mapArt());
save("cta-band.svg", abstractArt({ p: P.emerald, w: 1600, h: 700, seed: 75 }));

/* neighbourhood cards (portrait) */
for (let i = 0; i < 4; i += 1) {
  const key = ["sage", "clay", "teal", "olive"][i];
  save(`hood-${i + 1}.svg`, propertyArt({ p: P[key], variant: [1, 3, 0, 2][i], seed: 40 + i, w: 1200, h: 1500 }));
}

/* agents */
const agentInitials = ["AR", "JM", "DK", "SL", "TN", "MV"];
for (let i = 0; i < 6; i += 1) {
  const key = ORDER[(i * 3) % ORDER.length];
  save(`agent-${i + 1}.svg`, portraitArt({ initials: agentInitials[i], p: P[key], seed: 60 + i }));
}
save("testimonial-1.svg", portraitArt({ initials: "EM", p: P.sand, w: 400, h: 400, seed: 91, figure: false }));
save("testimonial-2.svg", portraitArt({ initials: "RC", p: P.teal, w: 400, h: 400, seed: 92, figure: false }));
save("testimonial-3.svg", portraitArt({ initials: "HO", p: P.plum, w: 400, h: 400, seed: 93, figure: false }));

/* blog */
const postLabels = ["MARKET", "GUIDE", "SELLING", "BUYING", "DESIGN", "FINANCE"];
for (let i = 0; i < 6; i += 1) {
  const key = ORDER[(i * 5 + 2) % ORDER.length];
  save(`post-${i + 1}.svg`, abstractArt({ p: P[key], w: 1600, h: 900, seed: 100 + i, label: postLabels[i] }));
}
save("post-body.svg", abstractArt({ p: P.sage, w: 1600, h: 900, seed: 120, label: "INSIGHT" }));

/* brand */
save("logo-mark.svg", markSvg());
save("favicon.svg", markSvg());
save("og-cover.svg", abstractArt({ p: P.emerald, w: 1200, h: 630, seed: 130, label: "" }));

/* map mock, defined after use via hoisting of function declarations */
function mapArt() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900" width="1200" height="900" role="img" aria-label="Map placeholder">
  <rect width="1200" height="900" fill="#EDEAE3"/>
  <g stroke="#DAD4C8" stroke-width="2">
    ${Array.from({ length: 18 }, (_, i) => `<line x1="0" y1="${i * 52}" x2="1200" y2="${i * 52 - 60}"/>`).join("")}
    ${Array.from({ length: 14 }, (_, i) => `<line x1="${i * 96}" y1="0" x2="${i * 96 + 70}" y2="900"/>`).join("")}
  </g>
  <path d="M-40 520 C 220 470 380 640 640 560 S 1020 420 1260 470" stroke="#BFD7D0" stroke-width="26" fill="none" opacity="0.85"/>
  <path d="M180 -40 C 240 260 140 420 320 640 S 420 820 380 960" stroke="#FFFFFF" stroke-width="18" fill="none"/>
  <path d="M-40 250 C 300 210 520 320 860 240 S 1120 180 1260 200" stroke="#FFFFFF" stroke-width="14" fill="none"/>
  <g fill="#C9C2B3" opacity="0.9">
    <rect x="600" y="600" width="120" height="80" rx="6"/>
    <rect x="760" y="640" width="90" height="70" rx="6"/>
    <rect x="480" y="380" width="110" height="90" rx="6"/>
  </g>
  <g>
    <circle cx="640" cy="470" r="17" fill="#0E5B4E"/>
    <circle cx="640" cy="470" r="5" fill="#FBF9F6"/>
    <circle cx="430" cy="300" r="11" fill="#C79A4B"/>
    <circle cx="820" cy="560" r="11" fill="#C79A4B"/>
    <circle cx="300" cy="640" r="11" fill="#C79A4B"/>
  </g>
</svg>`;
}

console.log(`Generated ${written.length} SVG placeholders in assets/img`);
