'use client';

import { useMemo, useState } from 'react';

/**
 * Pick creatives by looking at them.
 *
 * A list of filenames asks the owner to remember what they called each image; a grid asks them to
 * look, which is the whole point of having an asset library. This renders inside the chat's input
 * card, so the answer travels the same route a tapped option does: the chosen labels are joined into
 * one message and handed to the agent, which is already able to parse "use A and B".
 *
 * Earns its own file for two reasons: the transcript row is memoised and re-renders on every streamed
 * token, so the selection state must live somewhere small and stable; and the image handling deserves
 * to be readable rather than buried in a 300-line renderer.
 */

export interface PickerItem {
  id: string;
  label: string;
  url?: string | null;
  kind?: string | null;
}

interface Props {
  items: PickerItem[];
  /** Called with the chosen labels, in the order the owner tapped them. */
  onConfirm: (labels: string[]) => void;
  /** Show the "or attach new images in the chat" hint. */
  allowUpload?: boolean;
}

export default function AssetPickerInline({ items, onConfirm, allowUpload = true }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  // Images that failed to load are hidden rather than shown as a broken tile: a grey rectangle says
  // nothing, and tapping one would select a creative the owner cannot see.
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  const visible = useMemo(() => items.filter((item) => !broken[item.id]), [items, broken]);

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]));
  };

  const confirm = () => {
    const labels = selected
      .map((id) => items.find((item) => item.id === id)?.label)
      .filter(Boolean) as string[];
    if (!labels.length) return;
    onConfirm(labels);
    setSelected([]);
  };

  if (!visible.length) {
    return (
      <p className="dsh-t-xs dsh-label-tertiary">
        None of your library images could be shown. Attach the ones you want in the chat instead.
      </p>
    );
  }

  return (
    <div className="space-y-2 pt-1">
      <div className="grid grid-cols-4 gap-1.5">
        {visible.map((item) => {
          const isSelected = selected.includes(item.id);
          const isVideo = item.kind === 'video';
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => toggle(item.id)}
              title={item.label}
              aria-pressed={isSelected}
              className={`relative overflow-hidden rounded-[8px] dsh-border dsh-interactive ${
                isSelected ? 'dsh-accent-bg' : 'dsh-surface-2'
              }`}
            >
              {isVideo ? (
                /**
                 * An <img> pointed at an mp4 fails to load, and the failure handler would then hide the
                 * tile — silently making every video in the library un-pickable. Videos get a tile of
                 * their own instead: selectable, labelled, and honest about what they are.
                 */
                <span className="flex h-14 w-full items-center justify-center dsh-t-xs dsh-label-secondary">
                  video
                </span>
              ) : (
                <img
                  src={String(item.url)}
                  alt={item.label}
                  loading="lazy"
                  className="h-14 w-full object-cover"
                  onError={() => setBroken((prev) => ({ ...prev, [item.id]: true }))}
                />
              )}
              {isSelected && (
                <span className="absolute inset-0 flex items-center justify-center dsh-t-xs dsh-strong">
                  selected
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={confirm}
          disabled={selected.length === 0}
          className="rounded-full px-2.5 py-1 dsh-chip dsh-interactive dsh-t-xs disabled:opacity-50"
        >
          {selected.length === 0 ? 'Tap the ones to run' : `Use ${selected.length} selected`}
        </button>
        {allowUpload && (
          <span className="dsh-t-xs dsh-label-tertiary">or attach new images in the chat</span>
        )}
      </div>
    </div>
  );
}
