'use client';

import * as React from 'react';
import { Dialog, DialogContent } from '../primitives/dialog';
import { Button } from '../primitives/button';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive — discarding, cancelling, deleting. */
  destructive?: boolean;
  onConfirm: () => void;
}

/**
 * "Are you sure?" — for the moments a click would throw work away, like closing a half-filled
 * reservation. The safe choice is focused first, so Enter never destroys anything by accident.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
}: ConfirmDialogProps) {
  const cancel = React.useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        hideClose
        className="max-w-md"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          cancel.current?.focus();
        }}
      >
        {description && <div className="px-5 py-4 text-sm text-ink-2">{description}</div>}
        <div className="flex justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
          <Button ref={cancel} variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
