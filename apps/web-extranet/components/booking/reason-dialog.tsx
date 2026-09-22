'use client';

import * as React from 'react';
import { Button, Dialog, DialogContent, Field, Textarea, cn } from '@yohobed/ui';

/**
 * "Why?" — for every action that reverses money or inventory, or overrides a safety rule
 * (docs/UX-STANDARD.md §4–5). The reason is recorded with the action. Suggested reasons are one
 * tap, because the desk has a guest in front of them and the reason should not cost a paragraph.
 * The safe choice (keep things as they are) is focused first.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  destructive,
  suggestions = [],
  busy,
  error,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What will happen — the sentence that replaces "Are you sure?". */
  consequence: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Tap-to-fill reasons for the common cases. */
  suggestions?: string[];
  busy?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
  /** Extra fields shown above the reason (a date, an amount). */
  children?: React.ReactNode;
}) {
  const [reason, setReason] = React.useState('');
  const keep = React.useRef<HTMLButtonElement>(null);
  const id = React.useId();

  React.useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const valid = reason.trim().length >= 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        className="max-w-md"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          keep.current?.focus();
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // A dialog's submit must not reach the page's form behind it (React portals bubble).
            e.stopPropagation();
            if (valid) onConfirm(reason.trim());
          }}
          className="flex flex-col gap-4 px-5 py-4"
        >
          <div className="text-sm text-ink-2">{consequence}</div>
          {children}
          <Field label="Reason" htmlFor={id} hint="Saved with the action, for whoever asks later.">
            <Textarea
              id={id}
              rows={2}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {suggestions.length > 0 && (
            <div className="-mt-2 flex flex-wrap gap-1.5" aria-label="Suggested reasons">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setReason(s)}
                  className={cn(
                    'rounded-full border border-line-strong px-2.5 py-1 text-xs text-ink-2 transition duration-1',
                    'hover:border-ink-3 hover:text-ink',
                    reason === s && 'border-brand bg-brand-soft text-brand-ink',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {error && <p className="text-sm text-closed-ink">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <Button ref={keep} type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Keep as it is
            </Button>
            <Button
              type="submit"
              variant={destructive ? 'danger' : 'primary'}
              disabled={!valid}
              loading={busy}
            >
              {confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
