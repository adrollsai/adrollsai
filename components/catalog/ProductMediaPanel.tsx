'use client';

import * as React from 'react';
import { createClient } from '@/utils/supabase/client';
import { uploadToR2 } from '@/utils/upload-helper';
import { toast } from 'sonner';
import {
  ChevronDown,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  MEDIA_LIMITS,
  checkUpload,
  megabytes,
  summariseProductMedia,
  type MediaKind,
  type ProductMediaRow,
} from '@/lib/catalog/product-media';

/**
 * Attach a product's own photos, footage and documents.
 *
 * WHY THIS EXISTS
 * The catalogue knew what a business SELLS and the file library knew what it OWNED, and nothing
 * joined them — so "make a creative for Batch 12" either used nothing or used whatever file was
 * newest. This is the control that turns a loose file into product context.
 *
 * WHY IT IS COLLAPSED BY DEFAULT
 * The Asset Library is already busy. A second always-open upload panel would repeat the clutter
 * this round is meant to remove, so the panel costs one line until somebody wants it.
 *
 * WHY IT REUSES THE EXISTING PIPELINE
 * `uploadToR2` is the same helper (and the same client-side image compression) the file manager
 * uses, and a row lands in `assets` exactly like any other file. Both `product_id` (what the
 * agent reads) and `property_id` (what this page's filters read) are set, so the file shows up
 * under the product in both worlds instead of being orphaned in one of them.
 *
 * THE LIMITS ARE THE SAME ONES THE AGENT SEES: `checkUpload` comes from
 * lib/catalog/product-media.ts, which is also what the agent's attach tool enforces. A limit
 * written twice drifts, and the copy that drifts is the copy nobody tests.
 */

const KIND_ICON: Record<MediaKind, typeof ImageIcon> = {
  image: ImageIcon,
  video: Film,
  document: FileText,
};

interface ProductOption {
  id: string;
  label: string;
  hint: string;
}

export default function ProductMediaPanel({ initialProductId }: { initialProductId?: string } = {}) {
  const supabase = React.useMemo(() => createClient(), []);
  const [open, setOpen] = React.useState(Boolean(initialProductId));
  const [products, setProducts] = React.useState<ProductOption[]>([]);
  const [productId, setProductId] = React.useState<string>(initialProductId ?? '');
  const [rows, setRows] = React.useState<ProductMediaRow[]>([]);
  const [loadingProducts, setLoadingProducts] = React.useState(true);
  const [loadingRows, setLoadingRows] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] = React.useState<string | null>(null);
  const [attachedTotal, setAttachedTotal] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // The offerings this business has, for the picker.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from('properties')
          .select('id, title, property_type')
          .eq('user_id', user.id)
          .limit(200);
        if (!alive) return;
        const options = (data ?? []).map((row: any) => ({
          id: String(row.id),
          label: String(row.title || 'Untitled offering'),
          hint: String(row.property_type ?? ''),
        }));
        setProducts(options);
        setProductId((current) => current || options[0]?.id || '');
      } finally {
        if (alive) setLoadingProducts(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [supabase]);

  const loadMedia = React.useCallback(async () => {
    if (!productId) {
      setRows([]);
      setAttachedTotal(0);
      return;
    }
    setLoadingRows(true);
    try {
      const { data, error } = await supabase
        .from('assets')
        .select('id, url, type, caption, product_id')
        .eq('product_id', productId)
        .limit(200);
      if (error) {
        toast.error('Could not read this product’s files');
        setRows([]);
        return;
      }
      setRows((data ?? []) as ProductMediaRow[]);
    } finally {
      setLoadingRows(false);
    }
  }, [productId, supabase]);

  // A cheap total for the collapsed line, so the panel says something useful while shut.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { count } = await supabase
        .from('assets')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .not('product_id', 'is', null);
      if (alive && typeof count === 'number') setAttachedTotal(count);
    })();
    return () => {
      alive = false;
    };
  }, [supabase]);

  React.useEffect(() => {
    if (open) void loadMedia();
  }, [open, loadMedia]);

  const summary = React.useMemo(
    () => summariseProductMedia(productId || 'none', rows),
    [productId, rows],
  );

  async function handleFiles(files: FileList | null) {
    if (!files?.length || !productId) return;
    setUploading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Please sign in again');
        return;
      }

      // Validate against a running tally, so a multi-select cannot slip past the per-product
      // cap halfway through and leave the product over its limit.
      const tally: Partial<Record<MediaKind, number>> = { ...summary.counts };
      let added = 0;

      for (const file of Array.from(files)) {
        const verdict = checkUpload({ name: file.name, size: file.size }, tally);
        if (!verdict.ok || !verdict.kind) {
          toast.error(verdict.reason ?? `Could not attach ${file.name}`);
          continue;
        }
        setProgress(`Uploading ${file.name} (${megabytes(file.size)})…`);

        const folder = `product-${productId.slice(0, 8)}`;
        const publicUrl = await uploadToR2(file, folder);
        const { error } = await supabase.from('assets').insert({
          user_id: user.id,
          product_id: productId,
          property_id: productId,
          type: verdict.kind,
          url: publicUrl,
          caption: file.name.replace(/\.[^.]+$/, ''),
          metadata: { folder, source: 'catalogue', bytes: file.size },
          status: 'ready',
        });
        if (error) {
          toast.error(`Uploaded, but could not attach ${file.name}: ${error.message}`);
          continue;
        }
        tally[verdict.kind] = (tally[verdict.kind] ?? 0) + 1;
        added++;
      }

      if (added) {
        toast.success(`Attached ${added} file${added === 1 ? '' : 's'} to this product`);
        setAttachedTotal((total) => total + added);
      }
      await loadMedia();
    } catch (error: any) {
      toast.error(String(error?.message ?? error));
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function detach(assetId: string) {
    // Detach, not delete: the file stays in the library and simply stops being this product's
    // context. Deleting storage from a catalogue line item would be a surprise.
    const { error } = await supabase
      .from('assets')
      .update({ product_id: null, property_id: null })
      .eq('id', assetId);
    if (error) {
      toast.error('Could not detach that file');
      return;
    }
    toast.success('Detached — the file is still in your library');
    setAttachedTotal((total) => Math.max(0, total - 1));
    await loadMedia();
  }

  const groups: { kind: MediaKind; title: string; entries: { id: string; url: string; caption: string }[] }[] = [
    { kind: 'image', title: 'Photos', entries: summary.images },
    { kind: 'video', title: 'Footage', entries: summary.videos },
    { kind: 'document', title: 'Documents', entries: summary.documents },
  ];

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="product-media-body"
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50/70 transition-colors"
      >
        <span className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
          <Paperclip size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-900">Product media</span>
          <span className="block text-xs text-slate-500 mt-0.5 truncate">
            {attachedTotal > 0
              ? `${attachedTotal} file${attachedTotal === 1 ? '' : 's'} attached to offerings — the agent uses these before stock imagery`
              : 'Attach photos, footage and PDFs to an offering so the agent uses the real thing'}
          </span>
        </span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div id="product-media-body" className="px-5 pb-5 border-t border-slate-100 pt-4">
          {loadingProducts ? (
            <div className="flex items-center gap-2 text-sm text-slate-500" role="status">
              <Loader2 size={16} className="animate-spin" /> Loading your offerings…
            </div>
          ) : products.length === 0 ? (
            <p className="text-sm text-slate-600">
              You have no offerings in the catalogue yet. Add one first — then its photos and
              footage can be attached here.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="product-media-select">
                  Which offering
                </label>
                <select
                  id="product-media-select"
                  value={productId}
                  onChange={(event) => {
                    setProductId(event.target.value);
                    setProgress(null);
                  }}
                  className="min-h-[42px] max-w-full sm:max-w-[280px] px-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 font-medium"
                >
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.label}
                      {product.hint ? ` · ${product.hint}` : ''}
                    </option>
                  ))}
                </select>

                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept="image/*,video/*,.pdf,.doc,.docx,.txt,.csv,.xls,.xlsx"
                  className="hidden"
                  onChange={(event) => void handleFiles(event.target.files)}
                />
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={uploading || !productId}
                  className="inline-flex items-center gap-2 min-h-[42px] px-4 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition active:scale-[0.98] disabled:opacity-50"
                >
                  {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                  {uploading ? 'Uploading…' : 'Upload files'}
                </button>
              </div>

              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                Photos up to {megabytes(MEDIA_LIMITS.image.maxBytes)} ({MEDIA_LIMITS.image.maxPerProduct}),
                footage up to {megabytes(MEDIA_LIMITS.video.maxBytes)} ({MEDIA_LIMITS.video.maxPerProduct}),
                documents up to {megabytes(MEDIA_LIMITS.document.maxBytes)} ({MEDIA_LIMITS.document.maxPerProduct}).
              </p>

              {progress && (
                <p className="mt-2 text-xs font-semibold text-blue-600 truncate" role="status">
                  {progress}
                </p>
              )}

              <div className="mt-4">
                {loadingRows ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500" role="status">
                    <Loader2 size={16} className="animate-spin" /> Loading this offering’s files…
                  </div>
                ) : summary.total === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center">
                    <p className="text-sm font-semibold text-slate-700">No files on this offering yet</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Upload photos of the real thing. The agent uses these instead of stock imagery,
                      and asks you rather than guessing when there are none.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {groups.map((group) =>
                      group.entries.length === 0 ? null : (
                        <div key={group.kind}>
                          <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">
                            {group.title} · {group.entries.length}
                          </h3>
                          <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                            {group.entries.map((entry) => {
                              const Icon = KIND_ICON[group.kind];
                              return (
                                <li
                                  key={entry.id}
                                  className="relative rounded-xl border border-slate-200 overflow-hidden bg-slate-50 group"
                                >
                                  <div className="aspect-square flex items-center justify-center bg-slate-100">
                                    {group.kind === 'image' ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={entry.url}
                                        alt={entry.caption || ''}
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <Icon size={26} className="text-slate-400" />
                                    )}
                                  </div>
                                  <div className="px-2 py-1.5">
                                    <p
                                      className="text-[11px] font-medium text-slate-700 truncate"
                                      title={entry.caption}
                                    >
                                      {entry.caption || 'Untitled'}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => void detach(entry.id)}
                                    aria-label={`Detach ${entry.caption || 'this file'} from the offering`}
                                    title="Detach from this offering"
                                    className="absolute top-1.5 right-1.5 p-1.5 rounded-lg bg-white/95 border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-200 transition"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ),
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
