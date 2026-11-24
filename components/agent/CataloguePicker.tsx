'use client';

import * as React from 'react';
import { Package, Search, X, Check, Loader2 } from 'lucide-react';

/**
 * Pick catalogue items to give the agent as context.
 *
 * WHY A PICKER AND NOT A SENTENCE
 * The agent can already search the catalogue with a tool, but it has to guess what to search for. When the
 * owner is looking at "the November batch" or "Ananta Aspire" on their own screen, typing the name and hoping
 * the search matches is a worse interface than pointing at the row. A picked item is unambiguous: it carries
 * the id, which is what every downstream tool (creative prompts, campaign launches, per-item rules) keys on.
 *
 * ONE OR MANY. A creative is often about several items at once ("these three plots"), and a campaign can
 * target a set, so selection is a set rather than a single value.
 *
 * The items themselves come from the same endpoint the Catalogue tab uses (`/api/inventory`), so this can
 * never show a different catalogue from the one the owner browses.
 */
export interface CatalogueItem {
  id: string;
  title: string;
  subtitle?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Items already chosen, so reopening shows the current selection. */
  selected: CatalogueItem[];
  onConfirm: (items: CatalogueItem[]) => void;
  impersonateId?: string | null;
}

export default function CataloguePicker({ open, onClose, selected, onConfirm, impersonateId }: Props) {
  const [items, setItems] = React.useState<CatalogueItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [chosen, setChosen] = React.useState<CatalogueItem[]>(selected);

  // Reopening starts from what is already attached, not from scratch.
  React.useEffect(() => {
    if (open) setChosen(selected);
  }, [open, selected]);

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError(null);
    const url = impersonateId
      ? `/api/inventory?impersonate=${encodeURIComponent(impersonateId)}`
      : '/api/inventory';
    fetch(url)
      .then((res) => res.json())
      .then((body) => {
        if (!alive) return;
        const rows: any[] = Array.isArray(body) ? body : Array.isArray(body?.properties) ? body.properties : Array.isArray(body?.inventory) ? body.inventory : [];
        const mapped = rows
          .map((row) => ({
            id: String(row?.id ?? ''),
            title: String(row?.title ?? row?.name ?? row?.property_name ?? 'Untitled'),
            subtitle: row?.location ?? row?.city ?? row?.price ?? null,
          }))
          .filter((row) => row.id);
        setItems(mapped);
        if (!mapped.length && !error) setError('No catalogue items on this account yet.');
      })
      .catch((e) => alive && setError(e?.message || 'Could not read the catalogue'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, impersonateId]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((item) => `${item.title} ${item.subtitle ?? ''}`.toLowerCase().includes(q)) : items;
  const isChosen = (id: string) => chosen.some((item) => item.id === id);
  const toggle = (item: CatalogueItem) =>
    setChosen((prev) => (prev.some((entry) => entry.id === item.id) ? prev.filter((entry) => entry.id !== item.id) : [...prev, item]));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Pick catalogue items">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Package size={15} className="text-indigo-600" /> Give it catalogue context
          </h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-slate-100 px-4 py-2.5">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the catalogue…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-xs text-slate-800 outline-none transition focus:border-indigo-400 focus:bg-white"
              autoFocus
            />
          </div>
        </div>

        <div className="min-h-[8rem] flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500">
              <Loader2 size={14} className="animate-spin" /> Reading the catalogue…
            </div>
          ) : error ? (
            <p className="px-2 py-6 text-center text-xs text-slate-500">{error}</p>
          ) : !shown.length ? (
            <p className="px-2 py-6 text-center text-xs text-slate-500">Nothing matches “{query}”.</p>
          ) : (
            <ul className="space-y-1">
              {shown.map((item) => {
                const picked = isChosen(item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => toggle(item)}
                      className={`flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition ${
                        picked ? 'border-indigo-300 bg-indigo-50' : 'border-transparent hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          picked ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300'
                        }`}
                      >
                        {picked ? <Check size={11} strokeWidth={3} /> : null}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px] font-semibold text-slate-800">{item.title}</span>
                        {item.subtitle ? <span className="block truncate text-[10.5px] text-slate-500">{String(item.subtitle)}</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
          <span className="text-[11px] font-semibold text-slate-500">
            {chosen.length ? `${chosen.length} selected` : 'Nothing selected'}
          </span>
          <div className="flex items-center gap-2">
            {chosen.length > 0 && (
              <button type="button" onClick={() => setChosen([])} className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-slate-500 hover:text-rose-600">
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onConfirm(chosen);
                onClose();
              }}
              className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-[11.5px] font-bold text-white transition hover:bg-indigo-700"
            >
              Use {chosen.length === 1 ? 'this item' : chosen.length ? `these ${chosen.length}` : 'nothing'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
