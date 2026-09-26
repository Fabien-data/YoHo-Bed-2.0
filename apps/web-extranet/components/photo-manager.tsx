'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Plus, Trash } from '@phosphor-icons/react';
import {
  listPropertyPhotos,
  listRoomPhotos,
  uploadPropertyPhoto,
  uploadRoomPhoto,
  deletePhoto,
  orderPhotos,
  mediaUrl,
  ApiError,
  type Photo,
} from '@/lib/api';
import { Badge, Button, ConfirmDialog, toast } from '@yohobed/ui';

/**
 * Upload, order and remove one property's or one room type's photos (Compartment H; ordering
 * and the cover added for Configuration → Photo gallery, 2026-09-26). The first photo is the
 * cover the voucher and the channels show.
 */
export function PhotoManager({
  target,
  id,
  label,
  onChanged,
  canEdit = true,
}: {
  target: 'property' | 'room';
  id: string;
  label: string;
  onChanged?: () => void | Promise<void>;
  canEdit?: boolean;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Photo | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const list = target === 'property' ? listPropertyPhotos(id) : listRoomPhotos(id);
    try {
      setPhotos(await list);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'The photos could not be loaded');
    }
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
      await onChanged?.();
      toast.success('Photo added');
    } catch (error) {
      setErr(error instanceof ApiError ? error.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(photo: Photo) {
    setBusy(true);
    try {
      await deletePhoto(photo.id);
      await load();
      await onChanged?.();
      toast.success('Photo deleted');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The photo was not deleted');
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, by: -1 | 1) {
    const next = [...photos];
    const [photo] = next.splice(index, 1);
    next.splice(index + by, 0, photo!);
    setPhotos(next);
    try {
      await orderPhotos(
        target,
        id,
        next.map((p) => p.id),
      );
      await onChanged?.();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'The order was not saved');
      await load();
    }
  }

  if (!id) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Photos · {label}
        </span>
        <span className="font-mono text-xs tabular-nums text-ink-3">{photos.length}</span>
        <div className="flex-1" />
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={onPick}
        />
        {canEdit && (
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Plus size={14} aria-hidden /> Add photo
          </Button>
        )}
      </div>
      {err && (
        <p className="mb-2 rounded-lg bg-closed-soft px-3 py-1.5 text-xs font-medium text-closed-ink">
          {err}
        </p>
      )}
      {photos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong px-3 py-6 text-center text-xs text-ink-3">
          No photos yet. JPEG, PNG or WebP up to 5 MB; the first one is the cover.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((p, i) => (
            <li key={p.id} className="group relative overflow-hidden rounded-xl border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mediaUrl(p.storageKey)}
                alt={p.originalName}
                className="aspect-[4/3] w-full object-cover"
              />
              {i === 0 && (
                <Badge tone="brass" dot={false} className="absolute left-2 top-2">
                  Cover
                </Badge>
              )}
              {canEdit && (
                <div className="flex items-center gap-1 border-t border-line bg-surface p-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Show earlier"
                    disabled={busy || i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowLeft size={14} aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Show later"
                    disabled={busy || i === photos.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowRight size={14} aria-hidden />
                  </Button>
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${p.originalName}`}
                    disabled={busy}
                    onClick={() => setRemoving(p)}
                  >
                    <Trash size={14} aria-hidden />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Delete this photo?"
        description="It is removed from the gallery and everywhere it was shown. This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => removing && remove(removing)}
      />
    </div>
  );
}
