'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listPropertyPhotos,
  listRoomPhotos,
  uploadPropertyPhoto,
  uploadRoomPhoto,
  deletePhoto,
  mediaUrl,
  ApiError,
  type Photo,
} from '@/lib/api';
import { Button } from '@/components/ui';

/** Upload + gallery for one property's or one room's photos (Compartment H). */
export function PhotoManager({
  target,
  id,
  label,
}: {
  target: 'property' | 'room';
  id: string;
  label: string;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const list = target === 'property' ? listPropertyPhotos(id) : listRoomPhotos(id);
    setPhotos(await list.catch(() => []));
  }, [target, id]);

  useEffect(() => {
    if (id) load();
    else setPhotos([]);
  }, [id, load]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !id) return;
    setBusy(true);
    setErr(null);
    try {
      await (target === 'property' ? uploadPropertyPhoto(id, file) : uploadRoomPhoto(id, file));
      await load();
    } catch (error) {
      setErr(error instanceof ApiError ? error.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(photoId: string) {
    setBusy(true);
    try {
      await deletePhoto(photoId);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!id) return null;
  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[0.6rem] uppercase tracking-widest text-ink-3">
          Photos · {label}
        </span>
        <span className="text-xs text-ink-3">{photos.length}</span>
        <div className="flex-1" />
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={onPick}
        />
        <Button
          variant="secondary"
          className="!px-2 !py-1 text-xs"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? 'Working…' : '+ Add photo'}
        </Button>
      </div>
      {err && (
        <p
          className="mb-2 rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{ color: 'var(--closed-ink)', background: 'var(--closed-soft)' }}
        >
          {err}
        </p>
      )}
      {photos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-xs text-ink-3">
          No photos yet. JPEG, PNG or WebP up to 5 MB.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <div key={p.id} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mediaUrl(p.storageKey)}
                alt={p.originalName}
                className="h-20 w-28 rounded-lg border border-line object-cover"
              />
              <button
                title="Delete photo"
                disabled={busy}
                onClick={() => remove(p.id)}
                className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-white group-hover:flex"
                style={{ background: 'rgba(0,0,0,0.55)' }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
