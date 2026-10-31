/**
 * Template integrity check.
 *   node tools/check.mjs
 * Verifies that every internal link and asset reference in the HTML resolves,
 * every data-* hook app.js relies on exists somewhere, and the JS files parse.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pages = readdirSync(root).filter((f) => f.endsWith(".html"));

let problems = 0;
const fail = (msg) => {
  problems += 1;
  console.log("✗ " + msg);
};

/* ---------- 1. links + assets ---------- */
for (const page of pages) {
  const html = readFileSync(join(root, page), "utf8");
  const refs = [...html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    if (/^(https?:|mailto:|tel:|sms:|data:|\/\/)/.test(ref)) continue;
    const clean = decodeURIComponent(ref.split("?")[0].split("#")[0]);
    if (!clean) continue;
    const target = resolve(root, clean);
    if (!existsSync(target)) fail(`${page} → missing ${clean}`);
  }
}

/* ---------- 2. links coming from config.js / data.js ---------- */
for (const jsFile of ["assets/js/config.js", "assets/js/data.js"]) {
  const src = readFileSync(join(root, jsFile), "utf8");
  const hrefs = [...src.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
  const images = [...src.matchAll(/(?:image|photo|mark|avatar):\s*"([^"]+)"/g)].map((m) => m[1]);
  const gallery = [...src.matchAll(/images:\s*\[([^\]]+)\]/g)].flatMap((m) =>
    [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
  );
  for (const ref of [...hrefs, ...images, ...gallery]) {
    if (/^(https?:|mailto:|tel:|sms:)/.test(ref)) continue;
    const clean = decodeURIComponent(ref.split("?")[0].split("#")[0]);
    if (clean && !existsSync(resolve(root, clean))) fail(`${jsFile} → missing ${clean}`);
  }
}

/* ---------- 3. svg sanity ---------- */
const imgDir = join(root, "assets/img");
for (const file of readdirSync(imgDir)) {
  if (!file.endsWith(".svg")) continue;
  const svg = readFileSync(join(imgDir, file), "utf8");
  const open = (svg.match(/<svg/g) || []).length;
  const close = (svg.match(/<\/svg>/g) || []).length;
  if (open !== close) fail(`assets/img/${file} → unbalanced <svg>`);
  if (/url\(#[^)]+\)\s+opacity=/.test(svg)) fail(`assets/img/${file} → malformed fill attribute`);
  if (/NaN|undefined/.test(svg)) fail(`assets/img/${file} → contains NaN/undefined`);
}

/* ---------- 4. duplicated ids in markup ---------- */
for (const page of pages) {
  const html = readFileSync(join(root, page), "utf8");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) fail(`${page} → duplicate id #${id}`);
    seen.add(id);
  }
}

/* ---------- 5. required boot hooks ---------- */
const shared = ['id="siteHeader"', 'id="siteFooter"', "assets/js/config.js", "assets/js/data.js", "assets/js/app.js", "assets/css/style.css"];
for (const page of pages) {
  const html = readFileSync(join(root, page), "utf8");
  for (const hook of shared) {
    if (!html.includes(hook)) fail(`${page} → missing ${hook}`);
  }
}

/* ---------- 6. JS parses ---------- */
for (const jsFile of ["assets/js/app.js", "assets/js/config.js", "assets/js/data.js"]) {
  try {
    new Function(readFileSync(join(root, jsFile), "utf8"));
  } catch (err) {
    fail(`${jsFile} → ${err.message}`);
  }
}

console.log(
  problems === 0
    ? `✓ ${pages.length} pages, all links, assets and data hooks check out`
    : `\n${problems} problem(s) found`
);
process.exit(problems === 0 ? 0 : 1);
