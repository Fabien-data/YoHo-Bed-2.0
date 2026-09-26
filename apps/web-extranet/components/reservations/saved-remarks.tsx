'use client';

import { useQuery } from '@tanstack/react-query';
import { ChatText } from '@phosphor-icons/react';
import { listConfigRows, type RemarkType } from '@/lib/api';

/**
 * Configuration → Remarks at the desk: the hotel's saved remarks of a type, one click to use.
 * Nothing shows when the hotel has none of that type.
 */
export function SavedRemarks({
  type,
  onPick,
}: {
  type: RemarkType;
  onPick: (text: string) => void;
}) {
  const saved = useQuery({
    queryKey: ['config', 'list', 'remarks', 'tenant'],
    queryFn: () => listConfigRows('remarks'),
    staleTime: 60_000,
  });
  const ofType = (saved.data ?? []).filter((r) => r.active && r.type === type);
  if (ofType.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Saved remarks">
      <span className="inline-flex items-center gap-1 text-xs text-ink-3">
        <ChatText size={13} aria-hidden /> Saved:
      </span>
      {ofType.map((r) => (
        <button
          key={r.id}
          type="button"
          title={r.text}
          onClick={() => onPick(r.text)}
          className="max-w-[16rem] truncate rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs text-ink-2 transition duration-1 hover:border-brass hover:text-ink"
        >
          {r.text}
        </button>
      ))}
    </div>
  );
}
