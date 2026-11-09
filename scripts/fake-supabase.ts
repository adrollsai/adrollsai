/**
 * In-memory PostgREST emulator â€” just enough of the Supabase query builder for
 * `lib/agent/harness/store.ts`.
 *
 * Why this exists: the harness tables are not applied to the live project yet
 * (probe returns PGRST205), so the durable path could not otherwise be
 * exercised. This lets the store's real logic â€” seq allocation, the
 * append â†’ load â†’ project round trip, availability detection, ownership
 * filtering, delete cascade â€” be verified without touching a database.
 */

export type Row = Record<string, any>;
export type Store = Record<string, Row[]>;

export interface FakeError {
  code?: string;
  message?: string;
}

const MISSING = (table: string): FakeError => ({
  code: 'PGRST205',
  message: `Could not find the table 'public.${table}' in the schema cache`,
});

let uid = 0;
const newId = () => `00000000-0000-4000-8000-${String(++uid).padStart(12, '0')}`;

class QueryBuilder implements PromiseLike<{ data: any; error: FakeError | null }> {
  private filters: Array<[string, any]> = [];
  private orders: Array<[string, boolean]> = [];
  private limitN: number | undefined;
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private payload: Row | undefined;
  private isSingle = false;
  private isMaybe = false;
  private returning: string[] | undefined;

  constructor(
    private db: Store,
    private table: string,
    private opts: { missingTables: Set<string>; onWrite?: (t: string) => void } = { missingTables: new Set() }
  ) {}

  select(cols?: string) {
    if (this.op === 'select') {
      this.returning = cols ? cols.split(',').map((c) => c.trim()) : undefined;
    } else {
      this.returning = cols ? cols.split(',').map((c) => c.trim()) : undefined;
    }
    return this;
  }

  insert(payload: Row) {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload: Row) {
    this.op = 'update';
    this.payload = payload;
    return this;
  }

  delete() {
    this.op = 'delete';
    return this;
  }

  eq(col: string, val: any) {
    this.filters.push([col, val]);
    return this;
  }

  gt(col: string, val: any) {
    this.filters.push([`__gt__${col}`, val]);
    return this;
  }

  order(col: string, o?: { ascending?: boolean }) {
    this.orders.push([col, o?.ascending !== false]);
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  single() {
    this.isSingle = true;
    return this;
  }

  maybeSingle() {
    this.isMaybe = true;
    return this;
  }

  private project(row: Row): Row {
    if (!this.returning || this.returning.includes('*')) return { ...row };
    const out: Row = {};
    for (const c of this.returning) out[c] = row[c];
    return out;
  }

  private matches(row: Row): boolean {
    return this.filters.every(([col, val]) => {
      if (col.startsWith('__gt__')) {
        const real = col.slice(6);
        return Number(row[real]) > Number(val);
      }
      return row[col] === val;
    });
  }

  then<R1 = { data: any; error: FakeError | null }, R2 = never>(
    onFulfilled?: ((value: { data: any; error: FakeError | null }) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: any) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected);
  }

  private run(): { data: any; error: FakeError | null } {
    if (this.opts.missingTables.has(this.table)) {
      return { data: null, error: MISSING(this.table) };
    }
    this.db[this.table] ||= [];
    const rows = this.db[this.table];

    if (this.op === 'insert') {
      const row: Row = { id: newId(), created_at: new Date().toISOString(), ...this.payload };
      rows.push(row);
      this.opts.onWrite?.(this.table);
      const out = this.project(row);
      return { data: this.isSingle || this.isMaybe ? out : [out], error: null };
    }

    if (this.op === 'update') {
      const hit = rows.filter((r) => this.matches(r));
      for (const r of hit) Object.assign(r, this.payload);
      if (hit.length) this.opts.onWrite?.(this.table);
      const out = hit.map((r) => this.project(r));
      return { data: this.isSingle || this.isMaybe ? out[0] ?? null : out, error: null };
    }

    if (this.op === 'delete') {
      const keep: Row[] = [];
      for (const r of rows) {
        if (this.matches(r)) this.opts.onWrite?.(this.table);
        else keep.push(r);
      }
      this.db[this.table] = keep;
      return { data: null, error: null };
    }

    let out = rows.filter((r) => this.matches(r));
    for (const [col, asc] of [...this.orders].reverse()) {
      out = out.slice().sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (asc ? 1 : -1);
      });
    }
    if (this.limitN !== undefined) out = out.slice(0, this.limitN);
    const projected = out.map((r) => this.project(r));
    return {
      data: this.isSingle || this.isMaybe ? projected[0] ?? null : projected,
      error: null,
    };
  }
}

export interface FakeSupabase {
  client: any;
  store: Store;
  /** Tables that should behave as if they do not exist. */
  missingTables: Set<string>;
}

export function createFakeSupabase(opts: { missingTables?: string[]; seed?: Store } = {}): FakeSupabase {
  const store: Store = opts.seed || {};
  const missingTables = new Set(opts.missingTables || []);

  const client = {
    from(table: string) {
      return new QueryBuilder(store, table, { missingTables });
    },
    rpc(name: string, params: Record<string, any>) {
      // Mirrors public.harness_append_event(): allocate next seq atomically,
      // insert, then touch the parent session's updated_at.
      return {
        then<R1, R2>(
          onFulfilled?: ((v: { data: any; error: FakeError | null }) => R1 | PromiseLike<R1>) | null,
          onRejected?: ((r: any) => R2 | PromiseLike<R2>) | null
        ) {
          let result: { data: any; error: FakeError | null };
          if (name !== 'harness_append_event') {
            result = { data: null, error: { code: 'PGRST202', message: 'function not found' } };
          } else if (missingTables.has('harness_events')) {
            result = { data: null, error: MISSING('harness_events') };
          } else {
            store.harness_events ||= [];
            const events = store.harness_events;
            const seq =
              events
                .filter((e) => e.session_id === params.p_session_id)
                .reduce((max, e) => Math.max(max, Number(e.seq) || 0), 0) + 1;
            const row: Row = {
              id: newId(),
              session_id: params.p_session_id,
              seq,
              type: params.p_type,
              data: params.p_data,
              created_at: new Date().toISOString(),
            };
            events.push(row);
            const parent = (store.harness_sessions || []).find((s) => s.id === params.p_session_id);
            if (parent) parent.updated_at = new Date().toISOString();
            result = { data: row, error: null };
          }
          return Promise.resolve(result).then(onFulfilled, onRejected);
        },
      };
    },
  };

  return { client, store, missingTables };
}
