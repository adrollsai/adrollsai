/**
 * Stored extraction definitions, and the pure function that turns a document
 * into rows.
 *
 * WHY A STORED DEFINITION AND NOT A PROMPT
 *   A scrape that lives only in a prompt cannot be re-run. "The headlines from
 *   that page" produces a different parse every time, and there is nothing to
 *   diff when the numbers move. A definition is a NAMED, VERSIONED artefact:
 *
 *     { name: "newsroom-headlines", version: 1, format: "html",
 *       rows: { selector: "article.story" },
 *       fields: [ { name: "headline", required, selector: "h2 a" }, … ] }
 *
 *   Saving it gives it a fingerprint (`definitionVersion`), the run report
 *   quotes that fingerprint, and the cache is keyed by it — so re-running
 *   "newsroom-headlines@a1b2c3d4" is comparable to the last run, and a changed
 *   definition is visibly a different scrape rather than a mystery delta.
 *
 * FAILURE IS LOUD, AND NAMES THE FIELD
 *   A required field that produces nothing throws `ExtractionError` carrying the
 *   definition name, the row index and the FIELD NAME. Partial rows are worse
 *   than none: a caller that receives three good rows and a silently empty
 *   fourth quotes "no headline" to a client as if the page said so.
 *
 * PURITY
 *   `parseHtml`, `selectAll`, `queryJsonPath` and `extractRows` are pure: no
 *   network, no clock, no environment. That is the whole reason this file can be
 *   verified offline.
 *
 * INDUSTRY-NEUTRAL
 *   Nothing in here knows what a "listing" or a "property" is. A field is a
 *   field: a selector or a path, a name, and whether it may be absent.
 */

import { sha256Hex } from './cache';

// ────────────────────────────────────────────────────────────────────────────
// The definition format
// ────────────────────────────────────────────────────────────────────────────

/** Schema version of the DEFINITION FORMAT (not of the site it reads). */
export const DEFINITION_FORMAT_VERSION = 1;

export interface ScrapeField {
  /** Column name in the resulting rows. */
  name: string;
  /** Absent or false = required: a row without it is an error. */
  optional?: boolean;
  /** html: CSS-subset selector, evaluated inside the row element. */
  selector?: string;
  /** json: dot/bracket path, evaluated inside the row value. */
  path?: string;
  /** html: read this attribute instead of the text content (`href`, `content`, …). */
  attribute?: string;
  /** html: which match to take when the selector matches several (default 0). */
  index?: number;
  /** html: join EVERY match with this separator instead of taking one. */
  join?: string;
  /** Resolve a relative value against the page URL. */
  resolve?: boolean;
  /** Trim and collapse whitespace (default true). */
  trim?: boolean;
  lowercase?: boolean;
  /** Parse as a number; a value that is not numeric counts as missing. */
  number?: boolean;
}

export interface ScrapeDefinition {
  /** Definition-format version. */
  version: number;
  /** Stable name: this is what `scrape_run` is asked for. */
  name: string;
  description?: string;
  format: 'html' | 'json';
  /** One URL, optionally with `{placeholders}` filled from `inputs`. */
  urlTemplate?: string;
  /** …or an explicit list, when the pages are known and finite. */
  urls?: string[];
  /** Placeholder names `urlTemplate` may use. */
  inputs?: string[];
  rows: {
    /** html: the repeated element. */
    selector?: string;
    /** json: the path to the array of row values. */
    path?: string;
    /** Stop after this many rows. */
    limit?: number;
  };
  fields: ScrapeField[];
  policy?: {
    /** How long a fetched page may be reused, in ms. */
    cacheTtlMs?: number;
    /** Refuse a definition that would read more than this many pages. */
    maxPages?: number;
  };
}

export type ScrapeRow = Record<string, string | number | null>;

export class ExtractionError extends Error {
  readonly definition: string;
  readonly field: string;
  readonly row: number | null;
  readonly detail: string;

  constructor(args: { definition: string; field: string; row?: number | null; detail: string }) {
    const where = args.row === null || args.row === undefined ? '' : ` row ${args.row}`;
    super(`[scrape] definition "${args.definition}"${where}: ${args.detail}`);
    this.name = 'ExtractionError';
    this.definition = args.definition;
    this.field = args.field;
    this.row = args.row ?? null;
    this.detail = args.detail;
  }
}

/**
 * Validate and normalise a definition read from a store, a tool call or a JSON
 * file. Throws `ExtractionError` with the offending path — a definition that is
 * wrong is a bug in the definition, and it should fail at save/load time, not
 * halfway through a crawl.
 */
export function parseDefinition(raw: unknown, source = 'definition'): ScrapeDefinition {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ExtractionError({ definition: source, field: '#', detail: 'a definition must be a JSON object' });
  }
  const input = raw as Record<string, unknown>;

  const version = input.version === undefined ? DEFINITION_FORMAT_VERSION : Number(input.version);
  if (version !== DEFINITION_FORMAT_VERSION) {
    throw new ExtractionError({
      definition: source,
      field: 'version',
      detail: `unsupported definition format ${String(input.version)} (this build reads ${DEFINITION_FORMAT_VERSION})`,
    });
  }

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(name)) {
    throw new ExtractionError({
      definition: source,
      field: 'name',
      detail: 'name must be 2-64 chars of letters, digits, dot, dash or underscore',
    });
  }

  const format = input.format === undefined ? 'html' : String(input.format);
  if (format !== 'html' && format !== 'json') {
    throw new ExtractionError({ definition: name, field: 'format', detail: 'format must be "html" or "json"' });
  }

  const urlTemplate = typeof input.urlTemplate === 'string' ? input.urlTemplate.trim() : undefined;
  const urls = Array.isArray(input.urls) ? input.urls.map((value) => String(value)) : undefined;
  if (!urlTemplate && !urls?.length) {
    throw new ExtractionError({
      definition: name,
      field: 'urlTemplate',
      detail: 'a definition needs urlTemplate or urls — there is nothing to read otherwise',
    });
  }

  const inputs = Array.isArray(input.inputs) ? input.inputs.map((value) => String(value)) : undefined;
  if (urlTemplate) {
    const placeholders = placeholdersOf(urlTemplate);
    const undeclared = placeholders.filter((key) => !(inputs ?? []).includes(key));
    if (undeclared.length) {
      throw new ExtractionError({
        definition: name,
        field: 'inputs',
        detail:
          `urlTemplate uses {${undeclared.join('}, {')}} but inputs does not declare ` +
          `${undeclared.length === 1 ? 'it' : 'them'} — a run would have no value to substitute`,
      });
    }
  }

  const rowsRaw = (input.rows ?? {}) as Record<string, unknown>;
  const rows: ScrapeDefinition['rows'] = {};
  if (typeof rowsRaw.selector === 'string' && rowsRaw.selector.trim()) rows.selector = rowsRaw.selector.trim();
  if (typeof rowsRaw.path === 'string' && rowsRaw.path.trim()) rows.path = rowsRaw.path.trim();
  if (rowsRaw.limit !== undefined) {
    const limit = Number(rowsRaw.limit);
    if (!Number.isFinite(limit) || limit <= 0) {
      throw new ExtractionError({ definition: name, field: 'rows.limit', detail: 'limit must be a positive number' });
    }
    rows.limit = Math.floor(limit);
  }
  if (format === 'html' && !rows.selector) {
    throw new ExtractionError({
      definition: name,
      field: 'rows.selector',
      detail: 'an html definition needs rows.selector (the repeated element, e.g. "article.story")',
    });
  }
  if (format === 'json' && !rows.path) {
    throw new ExtractionError({
      definition: name,
      field: 'rows.path',
      detail: 'a json definition needs rows.path (e.g. "$.items[*]")',
    });
  }

  const fieldsRaw = input.fields;
  if (!Array.isArray(fieldsRaw) || fieldsRaw.length === 0) {
    throw new ExtractionError({
      definition: name,
      field: 'fields',
      detail: 'a definition needs at least one field — an empty schema extracts nothing',
    });
  }

  const seen = new Set<string>();
  const fields: ScrapeField[] = fieldsRaw.map((entry, index) => {
    const field = (entry ?? {}) as Record<string, unknown>;
    const fieldName = typeof field.name === 'string' ? field.name.trim() : '';
    if (!fieldName) {
      throw new ExtractionError({ definition: name, field: `fields[${index}].name`, detail: 'field needs a name' });
    }
    if (seen.has(fieldName)) {
      throw new ExtractionError({
        definition: name,
        field: `fields[${index}].name`,
        detail: `field "${fieldName}" is declared twice`,
      });
    }
    seen.add(fieldName);

    const out: ScrapeField = { name: fieldName };
    if (field.optional !== undefined) out.optional = Boolean(field.optional);
    if (typeof field.selector === 'string' && field.selector.trim()) out.selector = field.selector.trim();
    if (typeof field.path === 'string' && field.path.trim()) out.path = field.path.trim();
    if (typeof field.attribute === 'string' && field.attribute.trim()) out.attribute = field.attribute.trim().toLowerCase();
    if (field.index !== undefined) {
      const value = Number(field.index);
      if (!Number.isFinite(value) || value < 0) {
        throw new ExtractionError({
          definition: name,
          field: `fields[${index}].index`,
          detail: 'index must be zero or a positive integer',
        });
      }
      out.index = Math.floor(value);
    }
    if (typeof field.join === 'string') out.join = field.join;
    if (field.resolve !== undefined) out.resolve = Boolean(field.resolve);
    if (field.trim !== undefined) out.trim = Boolean(field.trim);
    if (field.lowercase !== undefined) out.lowercase = Boolean(field.lowercase);
    if (field.number !== undefined) out.number = Boolean(field.number);

    const locator = out.selector ?? out.path;
    if (!locator) {
      throw new ExtractionError({
        definition: name,
        field: `fields[${index}].selector`,
        detail: `field "${fieldName}" needs a selector (html) or a path (json)`,
      });
    }
    if (format === 'html' && !out.selector) {
      throw new ExtractionError({
        definition: name,
        field: `fields[${index}].selector`,
        detail: `field "${fieldName}" is missing a selector on an html definition`,
      });
    }
    if (format === 'json' && !out.path) {
      throw new ExtractionError({
        definition: name,
        field: `fields[${index}].path`,
        detail: `field "${fieldName}" is missing a path on a json definition`,
      });
    }
    return out;
  });

  const policy: ScrapeDefinition['policy'] = {};
  if (input.policy && typeof input.policy === 'object') {
    const rawPolicy = input.policy as Record<string, unknown>;
    if (rawPolicy.cacheTtlMs !== undefined) {
      const ttl = Number(rawPolicy.cacheTtlMs);
      if (!Number.isFinite(ttl) || ttl < 0) {
        throw new ExtractionError({
          definition: name,
          field: 'policy.cacheTtlMs',
          detail: 'cacheTtlMs must be zero or a positive number',
        });
      }
      policy.cacheTtlMs = Math.floor(ttl);
    }
    if (rawPolicy.maxPages !== undefined) {
      const maxPages = Number(rawPolicy.maxPages);
      if (!Number.isFinite(maxPages) || maxPages <= 0) {
        throw new ExtractionError({
          definition: name,
          field: 'policy.maxPages',
          detail: 'maxPages must be a positive number',
        });
      }
      policy.maxPages = Math.floor(maxPages);
    }
  }

  return {
    version,
    name,
    ...(typeof input.description === 'string' && input.description.trim()
      ? { description: input.description.trim() }
      : {}),
    format,
    ...(urlTemplate ? { urlTemplate } : {}),
    ...(urls?.length ? { urls } : {}),
    ...(inputs?.length ? { inputs } : {}),
    rows,
    fields,
    ...(Object.keys(policy).length ? { policy } : {}),
  };
}

function placeholdersOf(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(/\{([a-zA-Z0-9_.-]+)\}/g)) found.add(match[1]);
  return [...found];
}

/**
 * The definition's fingerprint: what "the same scrape" means.
 *
 * It hashes the NORMALISED definition, so re-saving the same JSON with different
 * key order or a trailing space produces the same fingerprint, while changing a
 * selector produces a new one. This is the string that goes into the cache key
 * and into the run report, which is what makes two runs diffable.
 */
export function definitionVersion(definition: ScrapeDefinition): string {
  return sha256Hex(canonicalise(definition)).slice(0, 16);
}

/** Stable JSON: sorted keys, no undefined. */
export function canonicalise(value: unknown): string {
  const walk = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(walk);
    if (input && typeof input === 'object') {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(input as Record<string, unknown>).sort()) {
        const entry = (input as Record<string, unknown>)[key];
        if (entry === undefined) continue;
        out[key] = walk(entry);
      }
      return out;
    }
    return input;
  };
  return JSON.stringify(walk(value));
}

/** A human diff of two definitions: what changed, by field. */
export function diffDefinitions(
  before: ScrapeDefinition,
  after: ScrapeDefinition,
): { changed: string[]; added: string[]; removed: string[] } {
  const flat = (definition: ScrapeDefinition): Record<string, string> => {
    const out: Record<string, string> = {
      name: definition.name,
      format: definition.format,
      urlTemplate: definition.urlTemplate ?? '',
      urls: (definition.urls ?? []).join(','),
      'rows.selector': definition.rows.selector ?? '',
      'rows.path': definition.rows.path ?? '',
    };
    for (const field of definition.fields) {
      out[`field.${field.name}`] = canonicalise(field);
    }
    return out;
  };

  const a = flat(before);
  const b = flat(after);
  const changed = Object.keys(a).filter((key) => key in b && a[key] !== b[key]);
  const added = Object.keys(b).filter((key) => !(key in a));
  const removed = Object.keys(a).filter((key) => !(key in b));
  return { changed, added, removed };
}

/**
 * The URLs a definition reads for one set of inputs.
 *
 * A placeholder may be given as a single value or an array; arrays fan out
 * (one page per value). A missing input is an error naming the input, not a
 * request to a URL with `{section}` still in it.
 */
export function definitionUrls(definition: ScrapeDefinition, inputs: Record<string, string | string[]> = {}): string[] {
  const declared = definition.inputs ?? [];
  const fromTemplate = definition.urlTemplate ? placeholdersOf(definition.urlTemplate) : [];

  for (const key of declared) {
    if (inputs[key] === undefined) {
      throw new ExtractionError({
        definition: definition.name,
        field: `inputs.${key}`,
        detail: `the definition needs input "${key}" and the run did not supply it`,
      });
    }
  }

  if (!definition.urlTemplate) {
    const explicit = definition.urls ?? [];
    if (!explicit.length) {
      throw new ExtractionError({
        definition: definition.name,
        field: 'urls',
        detail: 'the definition lists no urls and has no urlTemplate',
      });
    }
    return dedupe(explicit);
  }

  const valueLists = fromTemplate.map((key) => {
    const value = inputs[key];
    const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
    if (!list.length) {
      throw new ExtractionError({
        definition: definition.name,
        field: `inputs.${key}`,
        detail: `input "${key}" was empty, so there is no page to read`,
      });
    }
    return { key, list };
  });

  let urls = [definition.urlTemplate];
  for (const { key, list } of valueLists) {
    urls = urls.flatMap((template) => list.map((value) => template.split(`{${key}}`).join(String(value))));
  }
  return dedupe(urls);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

// ────────────────────────────────────────────────────────────────────────────
// HTML: a small parser and a documented selector subset
// ────────────────────────────────────────────────────────────────────────────

export interface HtmlNode {
  /** Lowercased tag name; `#document` for the root and `#text` for text. */
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
  /** Text content, for `#text` nodes only. */
  text?: string;
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const RAW_TEXT_TAGS = new Set(['script', 'style', 'noscript', 'template']);

/**
 * Parse HTML into a node tree.
 *
 * Deliberately forgiving and deliberately small: static documents, malformed
 * markup, and no DOM. `<script>`/`<style>` bodies are dropped at parse time so
 * no field can ever extract JavaScript as content, and unclosed tags are closed
 * by their parent's end tag rather than swallowing the rest of the page.
 */
export function parseHtml(html: string): HtmlNode {
  const root: HtmlNode = { tag: '#document', attrs: {}, children: [] };
  const stack: HtmlNode[] = [root];
  const source = String(html ?? '');
  let index = 0;

  const top = () => stack[stack.length - 1];

  while (index < source.length) {
    const lt = source.indexOf('<', index);
    if (lt === -1) {
      pushText(top(), source.slice(index));
      break;
    }
    if (lt > index) pushText(top(), source.slice(index, lt));

    // Comments, doctype, CDATA.
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      index = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<!', lt) || source.startsWith('<?', lt)) {
      const end = source.indexOf('>', lt);
      index = end === -1 ? source.length : end + 1;
      continue;
    }

    const gt = findTagEnd(source, lt);
    if (gt === -1) {
      pushText(top(), source.slice(lt));
      break;
    }
    const raw = source.slice(lt + 1, gt);
    index = gt + 1;

    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim().toLowerCase();
      for (let depth = stack.length - 1; depth > 0; depth--) {
        if (stack[depth].tag === name) {
          stack.length = depth;
          break;
        }
      }
      continue;
    }

    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameMatch = body.match(/^([a-zA-Z][a-zA-Z0-9:-]*)/);
    if (!nameMatch) continue;
    const tag = nameMatch[1].toLowerCase();
    const node: HtmlNode = { tag, attrs: parseAttributes(body.slice(nameMatch[0].length)), children: [] };
    top().children.push(node);

    if (selfClosing || VOID_TAGS.has(tag)) continue;

    if (RAW_TEXT_TAGS.has(tag)) {
      const closer = new RegExp(`</${tag}\\s*>`, 'i');
      const rest = source.slice(index);
      const match = rest.match(closer);
      index = match && match.index !== undefined ? index + match.index + match[0].length : source.length;
      continue;
    }

    stack.push(node);
  }

  return root;
}

function findTagEnd(source: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') return i;
  }
  return -1;
}

function parseAttributes(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const key = match[1].toLowerCase();
    if (!key) continue;
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    attrs[key] = decodeEntities(value);
  }
  return attrs;
}

function pushText(parent: HtmlNode, text: string) {
  if (!text) return;
  parent.children.push({ tag: '#text', attrs: {}, children: [], text });
}

/**
 * The selector subset, and nothing beyond it:
 *
 *   `article`          tag
 *   `.story`           class
 *   `#main`            id
 *   `a.link`           tag + class
 *   `[data-kind]`      attribute present
 *   `[rel=canonical]`  attribute equals (quotes optional)
 *   `article h2 a`     descendant chain (space separated)
 *
 * No child (`>`), sibling (`+`, `~`), pseudo-class or comma selectors. A subset
 * that is documented is usable; a subset that silently ignores half a selector
 * is a wrong answer that looks right.
 */
export interface CompoundSelector {
  tag: string | null;
  id: string | null;
  classes: string[];
  attrs: { name: string; value: string | null }[];
}

export function parseSelector(selector: string): CompoundSelector[] {
  const text = String(selector ?? '').trim();
  if (!text) throw new ExtractionError({ definition: 'selector', field: 'selector', detail: 'empty selector' });
  if (/[>+~,]/.test(text)) {
    throw new ExtractionError({
      definition: 'selector',
      field: 'selector',
      detail: `selector "${text}" uses >, +, ~ or , — this subset supports tag, .class, #id, [attr], [attr=value] and descendant chains`,
    });
  }
  return text.split(/\s+/).map(parseCompound);
}

function parseCompound(part: string): CompoundSelector {
  const compound: CompoundSelector = { tag: null, id: null, classes: [], attrs: [] };
  const re = /([a-zA-Z][a-zA-Z0-9:-]*)|\.([\w-]+)|#([\w-]+)|\[([\w:-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\]\s]*)))?\]/g;
  let match: RegExpExecArray | null;
  let consumed = 0;
  while ((match = re.exec(part))) {
    consumed += match[0].length;
    if (match[1]) compound.tag = match[1].toLowerCase();
    else if (match[2]) compound.classes.push(match[2]);
    else if (match[3]) compound.id = match[3];
    else if (match[4]) compound.attrs.push({ name: match[4].toLowerCase(), value: match[6] ?? match[7] ?? match[8] ?? null });
  }
  if (consumed !== part.length) {
    throw new ExtractionError({
      definition: 'selector',
      field: 'selector',
      detail: `could not parse selector part "${part}"`,
    });
  }
  return compound;
}

function matchesCompound(node: HtmlNode, compound: CompoundSelector): boolean {
  if (compound.tag && node.tag !== compound.tag) return false;
  if (compound.id && node.attrs.id !== compound.id) return false;
  if (compound.classes.length) {
    const classes = (node.attrs.class ?? '').split(/\s+/).filter(Boolean);
    if (!compound.classes.every((name) => classes.includes(name))) return false;
  }
  for (const attr of compound.attrs) {
    const value = node.attrs[attr.name];
    if (value === undefined) return false;
    if (attr.value !== null && value !== attr.value) return false;
  }
  return true;
}

function matchesChain(node: HtmlNode, chain: CompoundSelector[], ancestors: HtmlNode[]): boolean {
  if (!matchesCompound(node, chain[chain.length - 1])) return false;
  let depth = chain.length - 2;
  for (let i = ancestors.length - 1; i >= 0 && depth >= 0; i--) {
    if (matchesCompound(ancestors[i], chain[depth])) depth--;
  }
  return depth < 0;
}

/** Every descendant of `root` matching `selector`, in document order. */
export function selectAll(root: HtmlNode, selector: string): HtmlNode[] {
  const chain = parseSelector(selector);
  const out: HtmlNode[] = [];
  const visit = (node: HtmlNode, ancestors: HtmlNode[]) => {
    for (const child of node.children) {
      if (child.tag === '#text') continue;
      if (matchesChain(child, chain, ancestors)) out.push(child);
      visit(child, [...ancestors, child]);
    }
  };
  visit(root, []);
  return out;
}

/** The first match, or null. */
export function selectOne(root: HtmlNode, selector: string): HtmlNode | null {
  return selectAll(root, selector)[0] ?? null;
}

/** Visible text of a node, whitespace-collapsed, entities decoded. */
export function textOf(node: HtmlNode): string {
  if (node.tag === '#text') return node.text ?? '';
  if (RAW_TEXT_TAGS.has(node.tag)) return '';
  return node.children.map(textOf).join(' ');
}

export function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
    hellip: '…',
    rsquo: '’',
    lsquo: '‘',
    ldquo: '“',
    rdquo: '”',
  };
  return String(text ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return named[body.toLowerCase()] ?? whole;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// JSON: a documented path subset
// ────────────────────────────────────────────────────────────────────────────

export type PathStep = { kind: 'key'; key: string } | { kind: 'index'; index: number } | { kind: 'all' };

/**
 * `$`, `.name`, `[0]`, `[*]` — that is the whole path language.
 * `$.items[*].title`, `.items[0].title` and `items.title` mean the same thing:
 * a bare leading name is read as `.name`, because that is how everyone writes it
 * in a six-field definition.
 */
export function parseJsonPath(path: string): PathStep[] {
  const text = String(path ?? '').trim();
  if (!text) throw new ExtractionError({ definition: 'path', field: 'path', detail: 'empty JSON path' });
  const body = text.startsWith('$') ? text.slice(1) : text;
  if (!body) return [];
  const normalised = body.startsWith('.') || body.startsWith('[') ? body : `.${body}`;
  const steps: PathStep[] = [];
  // Groups: 1 = .key, 2 = [index], 3 = quoted key ("…"), 4 = quoted key ('…').
  const re = /\.([\w$-]+)|\[\s*(\d+)\s*\]|\[\s*\*\s*\]|\[\s*"([^"]*)"\s*\]|\[\s*'([^']*)'\s*\]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(normalised))) {
    if (match.index !== cursor) break;
    cursor = match.index + match[0].length;
    if (match[1] !== undefined) steps.push({ kind: 'key', key: match[1] });
    else if (match[2] !== undefined) steps.push({ kind: 'index', index: Number(match[2]) });
    else if (match[0].includes('*')) steps.push({ kind: 'all' });
    else if (match[3] !== undefined) steps.push({ kind: 'key', key: match[3] });
    else if (match[4] !== undefined) steps.push({ kind: 'key', key: match[4] });
  }
  if (cursor !== normalised.length) {
    throw new ExtractionError({
      definition: 'path',
      field: 'path',
      detail: `could not parse JSON path "${text}" — supported: .name, [0], [*]`,
    });
  }
  return steps;
}

/** Every value `path` selects out of `root`. */
export function queryJsonPath(root: unknown, path: string): unknown[] {
  let current: unknown[] = [root];
  for (const step of parseJsonPath(path)) {
    const next: unknown[] = [];
    for (const value of current) {
      if (step.kind === 'key') {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const entry = (value as Record<string, unknown>)[step.key];
          if (entry !== undefined) next.push(entry);
        }
      } else if (step.kind === 'index') {
        if (Array.isArray(value) && step.index < value.length) next.push(value[step.index]);
      } else if (Array.isArray(value)) {
        next.push(...value);
      }
    }
    current = next;
  }
  return current;
}

// ────────────────────────────────────────────────────────────────────────────
// The pure extraction
// ────────────────────────────────────────────────────────────────────────────

/**
 * Turn one document into rows, or throw naming the field that failed.
 *
 * `options.url` is used for `resolve: true` fields (relative hrefs) and for the
 * error text, never for I/O.
 */
export function extractRows(
  definition: ScrapeDefinition,
  document: string,
  options: { url?: string; now?: () => number } = {},
): ScrapeRow[] {
  if (definition.format === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(document);
    } catch (err: any) {
      throw new ExtractionError({
        definition: definition.name,
        field: 'rows.path',
        detail: `the response is not JSON (${String(err?.message ?? err).slice(0, 120)}); the definition declares format "json"`,
      });
    }
    const values = queryJsonPath(parsed, definition.rows.path ?? '$');
    const limit = definition.rows.limit;
    const rows: ScrapeRow[] = [];
    for (let index = 0; index < values.length; index++) {
      if (limit && rows.length >= limit) break;
      const value = values[index];
      if (value === null || value === undefined) continue;
      rows.push(readJsonRow(definition, value, index, options.url));
    }
    if (!rows.length) {
      throw new ExtractionError({
        definition: definition.name,
        field: 'rows.path',
        detail: `rows.path "${definition.rows.path}" selected no values from the JSON document`,
      });
    }
    return rows;
  }

  const tree = parseHtml(document);
  const rowNodes = selectAll(tree, definition.rows.selector ?? '');
  if (!rowNodes.length) {
    throw new ExtractionError({
      definition: definition.name,
      field: 'rows.selector',
      detail: `rows.selector "${definition.rows.selector}" matched no elements in ${options.url ?? 'the document'}`,
    });
  }
  const limit = definition.rows.limit;
  const rows: ScrapeRow[] = [];
  for (let index = 0; index < rowNodes.length; index++) {
    if (limit && rows.length >= limit) break;
    rows.push(readHtmlRow(definition, rowNodes[index], index, options.url));
  }
  return rows;
}

function readHtmlRow(definition: ScrapeDefinition, node: HtmlNode, index: number, pageUrl?: string): ScrapeRow {
  const row: ScrapeRow = {};
  for (const field of definition.fields) {
    const matches = selectAll(node, field.selector ?? '');
    const value = valueFromHtmlMatches(field, matches, pageUrl);
    if (value === null) {
      if (field.optional) {
        row[field.name] = null;
        continue;
      }
      throw new ExtractionError({
        definition: definition.name,
        field: field.name,
        row: index,
        detail: missingDetail(field, matches.length, pageUrl),
      });
    }
    row[field.name] = value;
  }
  return row;
}

function valueFromHtmlMatches(field: ScrapeField, matches: HtmlNode[], pageUrl?: string): string | number | null {
  if (!matches.length) return null;
  const read = (node: HtmlNode): string => {
    if (field.attribute) {
      const raw = node.attrs[field.attribute];
      return raw === undefined ? '' : raw;
    }
    return textOf(node);
  };

  let value: string;
  if (field.join !== undefined) {
    value = matches.map(read).map((part) => finalise(field, part, pageUrl) ?? '').filter(Boolean).join(field.join);
  } else {
    const chosen = matches[Math.min(field.index ?? 0, matches.length - 1)];
    value = finalise(field, read(chosen), pageUrl) ?? '';
  }
  if (field.number) {
    const numeric = Number(value.replace(/[^0-9.+-]/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
  }
  return value === '' ? null : value;
}

function finalise(field: ScrapeField, value: string, pageUrl?: string): string | null {
  let out = value;
  if (field.resolve && pageUrl) {
    try {
      out = new URL(out.trim(), pageUrl).toString();
    } catch {
      /* leave it as written */
    }
  }
  if (field.trim !== false) out = out.replace(/\s+/g, ' ').trim();
  if (field.lowercase) out = out.toLowerCase();
  return out === '' ? null : out;
}

function readJsonRow(definition: ScrapeDefinition, value: unknown, index: number, pageUrl?: string): ScrapeRow {
  const row: ScrapeRow = {};
  for (const field of definition.fields) {
    const hits = queryJsonPath(value, field.path ?? '');
    const first = hits.find((entry) => entry !== null && entry !== undefined && entry !== '');
    const missing = first === undefined;

    if (missing) {
      if (field.optional) {
        row[field.name] = null;
        continue;
      }
      throw new ExtractionError({
        definition: definition.name,
        field: field.name,
        row: index,
        detail: `required field "${field.name}" is absent at path "${field.path}" (row ${index + 1} of the document)`,
      });
    }

    if (field.number) {
      const numeric = typeof first === 'number' ? first : Number(String(first).replace(/[^0-9.+-]/g, ''));
      if (!Number.isFinite(numeric)) {
        if (field.optional) {
          row[field.name] = null;
          continue;
        }
        throw new ExtractionError({
          definition: definition.name,
          field: field.name,
          row: index,
          detail: `required field "${field.name}" at path "${field.path}" is not a number: ${JSON.stringify(first).slice(0, 80)}`,
        });
      }
      row[field.name] = numeric;
      continue;
    }

    if (typeof first === 'string') {
      row[field.name] = finalise(field, first, pageUrl);
    } else if (typeof first === 'number' || typeof first === 'boolean') {
      row[field.name] = String(first);
    } else {
      row[field.name] = JSON.stringify(first);
    }
  }
  return row;
}

function missingDetail(field: ScrapeField, matchCount: number, pageUrl?: string): string {
  const where = pageUrl ? ` in ${pageUrl}` : '';
  if (field.attribute) {
    return matchCount === 0
      ? `required field "${field.name}": selector "${field.selector}" matched nothing${where}, so attribute "${field.attribute}" could not be read`
      : `required field "${field.name}": selector "${field.selector}" matched ${matchCount} element(s) but none carried attribute "${field.attribute}"${where}`;
  }
  return `required field "${field.name}" produced no value: selector "${field.selector}" ${matchCount === 0 ? 'matched nothing' : 'matched element(s) with no text'}${where}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Persistence: a stored definition can be re-run and diffed
// ────────────────────────────────────────────────────────────────────────────

export interface StoredDefinition {
  name: string;
  definition: ScrapeDefinition;
  /** Fingerprint, as in the cache key. */
  version: string;
  updatedAt: string;
  source: 'file' | 'supabase';
}

export interface DefinitionStore {
  list(): Promise<StoredDefinition[]>;
  get(name: string): Promise<StoredDefinition | null>;
  save(raw: unknown): Promise<StoredDefinition>;
  /** Keep the old body around so two definitions can be diffed after a save. */
  history?(name: string): Promise<StoredDefinition[]>;
}

/** Wrap a validated definition as a stored one. */
export function toStored(
  definition: ScrapeDefinition,
  source: StoredDefinition['source'],
  updatedAt = new Date().toISOString(),
): StoredDefinition {
  return { name: definition.name, definition, version: definitionVersion(definition), updatedAt, source };
}

/**
 * File-backed definitions, under `.nobogent/scraping/definitions/<name>.json`.
 *
 * This is the store the scripts and the offline verification use, and the
 * fallback when the process has no Supabase credentials. Each save also writes
 * `<name>.history/<version>.json` when `history` is asked for, which is what
 * makes "re-run and diff" possible for a definition that has been edited.
 */
export class FileDefinitionStore implements DefinitionStore {
  private readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? defaultDefinitionDir();
  }

  async list(): Promise<StoredDefinition[]> {
    const { readdir } = await import('node:fs/promises');
    try {
      const entries = await readdir(this.dir, { withFileTypes: true });
      const out: StoredDefinition[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const stored = await this.get(entry.name.replace(/\.json$/, ''));
        if (stored) out.push(stored);
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  async get(name: string): Promise<StoredDefinition | null> {
    const { readFile } = await import('node:fs/promises');
    try {
      const text = await readFile(this.pathFor(name), 'utf8');
      const parsed = JSON.parse(text) as { definition?: unknown; updatedAt?: string };
      const definition = parseDefinition(parsed.definition ?? parsed, name);
      return toStored(definition, 'file', parsed.updatedAt ?? new Date().toISOString());
    } catch {
      return null;
    }
  }

  async save(raw: unknown): Promise<StoredDefinition> {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const definition = parseDefinition(raw);
    const stored = toStored(definition, 'file');
    await mkdir(this.dir, { recursive: true });
    await writeFile(
      this.pathFor(definition.name),
      `${JSON.stringify({ definition, version: stored.version, updatedAt: stored.updatedAt }, null, 2)}\n`,
      'utf8',
    );
    return stored;
  }

  async history(name: string): Promise<StoredDefinition[]> {
    const { readdir, readFile, mkdir, writeFile } = await import('node:fs/promises');
    const dir = `${this.dir}/${name}.history`;
    try {
      const files = await readdir(dir);
      const out: StoredDefinition[] = [];
      for (const file of files.filter((entry) => entry.endsWith('.json')).sort()) {
        const parsed = JSON.parse(await readFile(`${dir}/${file}`, 'utf8')) as { definition?: unknown };
        const definition = parseDefinition(parsed.definition, name);
        out.push(toStored(definition, 'file', file.replace(/\.json$/, '')));
      }
      return out;
    } catch {
      await mkdir(dir, { recursive: true }).catch(() => {});
      await writeFile(`${dir}/.keep`, '', 'utf8').catch(() => {});
      return [];
    }
  }

  private pathFor(name: string): string {
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(name)) {
      throw new ExtractionError({ definition: name, field: 'name', detail: 'refusing an unsafe definition name' });
    }
    return `${this.dir}/${name}.json`;
  }
}

export function defaultDefinitionDir(): string {
  return (
    (process.env.SCRAPE_DEFINITION_DIR || '').trim() ||
    `${process.cwd().replace(/\\/g, '/')}/.nobogent/scraping/definitions`
  );
}

/**
 * The PostgREST chain this store uses, typed locally.
 *
 * `SupabaseClient` is not imported here on purpose: this module is bundled into
 * scripts that never construct one, and a type-level dependency on the SDK is not
 * worth a runtime one.
 */
interface PostgrestResult {
  data: unknown;
  error: { message?: string; code?: string } | null;
}

interface PostgrestQuery {
  eq: (column: string, value: string) => PostgrestQuery;
  order: (column: string, options?: { ascending?: boolean }) => PromiseLike<PostgrestResult>;
  maybeSingle: () => PromiseLike<PostgrestResult>;
}

/**
 * Supabase-backed definitions (`sql/migrations/18_scrape_definitions.sql`).
 *
 * A missing table is reported with the migration name rather than thrown as an
 * opaque PostgREST error: the usual cause is a database that has not had the
 * migration applied, and that is fixable in one command.
 */
export class SupabaseDefinitionStore implements DefinitionStore {
  constructor(
    private readonly supabase: unknown,
    private readonly userId: string,
    private readonly table = 'agent_scrape_definitions',
  ) {}

  private client(): {
    select: (columns?: string) => PostgrestQuery;
    upsert: (row: Record<string, unknown>, options?: Record<string, unknown>) => PromiseLike<PostgrestResult>;
  } {
    const db = this.supabase as { from?: (table: string) => unknown } | null;
    if (!db || typeof db.from !== 'function') throw new Error('[scrape] no Supabase client for definitions');
    return db.from(this.table) as {
      select: (columns?: string) => PostgrestQuery;
      upsert: (row: Record<string, unknown>, options?: Record<string, unknown>) => PromiseLike<PostgrestResult>;
    };
  }

  async list(): Promise<StoredDefinition[]> {
    const { data, error } = await this.client()
      .select('name, definition, version, updated_at')
      .eq('user_id', this.userId)
      .order('name', { ascending: true });
    if (error) throw new Error(this.explain(error));
    return ((data ?? []) as Record<string, unknown>[]).map((row) => this.hydrate(row));
  }

  async get(name: string): Promise<StoredDefinition | null> {
    const { data, error } = await this.client()
      .select('name, definition, version, updated_at')
      .eq('user_id', this.userId)
      .eq('name', name)
      .maybeSingle();
    if (error) throw new Error(this.explain(error));
    return data ? this.hydrate(data as Record<string, unknown>) : null;
  }

  async save(raw: unknown): Promise<StoredDefinition> {
    const definition = parseDefinition(raw);
    const stored = toStored(definition, 'supabase');
    const { error } = await this.client().upsert(
      {
        user_id: this.userId,
        name: definition.name,
        definition,
        version: stored.version,
        updated_at: stored.updatedAt,
      },
      { onConflict: 'user_id,name' },
    );
    if (error) throw new Error(this.explain(error));
    return stored;
  }

  private hydrate(row: Record<string, unknown>): StoredDefinition {
    const definition = parseDefinition(row.definition, String(row.name ?? 'definition'));
    return {
      name: definition.name,
      definition,
      version: String(row.version ?? definitionVersion(definition)),
      updatedAt: String(row.updated_at ?? ''),
      source: 'supabase',
    };
  }

  private explain(error: { message?: string; code?: string }): string {
    const text = `${error.code ?? ''} ${error.message ?? ''}`.trim();
    if (/PGRST204|42P01|does not exist|schema cache/i.test(text)) {
      return (
        `[scrape] the ${this.table} table is not available (${text}). Apply ` +
        'sql/migrations/18_scrape_definitions.sql — until then, definitions can only be stored as files.'
      );
    }
    return `[scrape] definition store error: ${text}`;
  }
}

/** Supabase when we have a client and a user, files otherwise. */
export function defaultDefinitionStore(options: { supabase?: unknown; userId?: string; dir?: string } = {}): DefinitionStore {
  if (options.supabase && options.userId && typeof (options.supabase as { from?: unknown }).from === 'function') {
    return new SupabaseDefinitionStore(options.supabase, options.userId);
  }
  return new FileDefinitionStore(options.dir);
}
