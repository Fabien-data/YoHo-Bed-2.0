'use client';

import * as React from 'react';
import { Eye, Paperclip, X } from '@phosphor-icons/react';
import {
  Button,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  cn,
} from '@yohobed/ui';
import {
  ApiError,
  deletePrivateFile,
  openPrivateFile,
  uploadPrivateFile,
  type PaymentCategory,
  type PrivateFile,
} from '@/lib/api';

/**
 * Taking money (Development Phase 02, Sprint 5): the hotel's own payment method, the amount, the
 * reference a bank transfer or card slip carries, and a photo of the slip. One set of fields for
 * the reservation form and the folio, so the rules are the same wherever money is taken.
 */

export interface PaymentMethodOption {
  id: string;
  code: string;
  name: string;
  category: PaymentCategory;
  requiresReference: boolean;
}

export interface PaymentDraft {
  /** Null: nothing taken now ("pay later"). */
  methodId: string | null;
  /** As typed. */
  amount: string;
  reference: string;
  /** A slip photo, already uploaded to the private store. */
  file: PrivateFile | null;
}

export function emptyPayment(): PaymentDraft {
  return { methodId: null, amount: '', reference: '', file: null };
}

/** What is wrong with a payment, per field. Empty when it can be sent (or when none is taken). */
export function paymentProblems(
  p: PaymentDraft,
  methods: PaymentMethodOption[],
  max: number | null,
): { amount?: string; reference?: string } {
  if (!p.methodId) return {};
  const method = methods.find((m) => m.id === p.methodId);
  const out: { amount?: string; reference?: string } = {};
  const amount = Number(p.amount);
  if (!p.amount.trim() || !Number.isFinite(amount) || amount <= 0) {
    out.amount = 'Enter the amount taken';
  } else if (max !== null && amount > max + 0.004) {
    out.amount = `At most ${max.toFixed(2)}, the amount due`;
  }
  if (method?.requiresReference && !p.reference.trim()) {
    out.reference = `${method.name} needs its reference number`;
  }
  return out;
}

const SLIP_TYPES = 'image/jpeg,image/png,image/webp,application/pdf';
const NONE = '__none';

export function PaymentFields({
  methods,
  value,
  onChange,
  currency,
  max,
  allowNone,
  showErrors,
  idPrefix,
  note,
  className,
}: {
  methods: PaymentMethodOption[];
  value: PaymentDraft;
  onChange: (next: PaymentDraft) => void;
  currency: string;
  /** The most that can be taken — the amount due. Null while it is not known. */
  max: number | null;
  /** Offer "Pay later" (nothing taken now). */
  allowNone?: boolean;
  showErrors: boolean;
  idPrefix: string;
  /** Said under the fields, e.g. which cash drawer the money goes into. */
  note?: (method: PaymentMethodOption) => React.ReactNode;
  className?: string;
}) {
  const method = methods.find((m) => m.id === value.methodId);
  const problems = paymentProblems(value, methods, max);
  const set = (patch: Partial<PaymentDraft>) => onChange({ ...value, ...patch });

  function pick(id: string) {
    if (id === NONE) {
      onChange({ ...value, methodId: null });
      return;
    }
    // A first pick fills in the whole amount due; a deposit is one edit away.
    set({
      methodId: id,
      amount: value.amount || (max !== null && max > 0 ? max.toFixed(2) : ''),
    });
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <Field label="Payment mode" htmlFor={`${idPrefix}-method`}>
        <Select value={value.methodId ?? (allowNone ? NONE : undefined)} onValueChange={pick}>
          <SelectTrigger id={`${idPrefix}-method`} aria-label="Payment mode">
            <SelectValue placeholder="Choose a method" />
          </SelectTrigger>
          <SelectContent>
            {allowNone && (
              <SelectItem value={NONE} hint="nothing taken now">
                Pay later
              </SelectItem>
            )}
            {methods.map((m) => (
              <SelectItem key={m.id} value={m.id} hint={m.code}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {method && (
        <>
          <Field
            label={`Amount (${currency})`}
            htmlFor={`${idPrefix}-amount`}
            required
            error={showErrors ? problems.amount : undefined}
          >
            <div className="flex gap-1.5">
              <Input
                id={`${idPrefix}-amount`}
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className="font-mono tabular-nums"
                value={value.amount}
                onChange={(e) => set({ amount: e.target.value })}
              />
              {max !== null && max > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0"
                  onClick={() => set({ amount: max.toFixed(2) })}
                >
                  Full
                </Button>
              )}
            </div>
          </Field>
          {method.category !== 'cash' && (
            <Field
              label={method.category === 'city_ledger' ? 'Voucher / reference' : 'Reference no.'}
              htmlFor={`${idPrefix}-reference`}
              required={method.requiresReference}
              error={showErrors ? problems.reference : undefined}
            >
              <Input
                id={`${idPrefix}-reference`}
                value={value.reference}
                maxLength={120}
                placeholder={
                  method.category === 'card'
                    ? 'Approval code'
                    : method.category === 'city_ledger'
                      ? 'e.g. TA-7781'
                      : 'Transaction ID'
                }
                onChange={(e) => set({ reference: e.target.value })}
              />
            </Field>
          )}
          {method.category !== 'city_ledger' && (
            <SlipAttach
              file={value.file}
              onChange={(file) => set({ file })}
              label={method.category === 'cash' ? 'Receipt photo' : 'Slip photo'}
            />
          )}
          {note?.(method)}
        </>
      )}
    </div>
  );
}

/**
 * Attach a photo or PDF of the slip. It is uploaded straight away to the private store — never the
 * public photo store — and sent with the payment by id.
 */
export function SlipAttach({
  file,
  onChange,
  label = 'Slip photo',
  purpose = 'payment_slip',
}: {
  file: PrivateFile | null;
  onChange: (file: PrivateFile | null) => void;
  label?: string;
  purpose?: 'payment_slip' | 'id_document';
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  async function upload(f: File) {
    setBusy(true);
    try {
      onChange(await uploadPrivateFile(purpose, f));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'The file could not be uploaded.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  function view(id: string) {
    openPrivateFile(id).catch((e) =>
      toast.error(e instanceof ApiError ? e.message : 'The file could not be opened.'),
    );
  }

  function remove() {
    if (!file) return;
    // Never attached yet, so the server lets it go; if that fails it is only an orphan.
    deletePrivateFile(file.id).catch(() => undefined);
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-2">
        {label} <span className="font-normal text-ink-3">(optional)</span>
      </span>
      <input
        ref={input}
        type="file"
        accept={SLIP_TYPES}
        className="sr-only"
        tabIndex={-1}
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      {file ? (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm">
          <Paperclip size={14} className="shrink-0 text-ink-3" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-ink" title={file.originalName}>
            {file.originalName}
          </span>
          <button
            type="button"
            aria-label="View the slip"
            onClick={() => view(file.id)}
            className="rounded p-1 text-ink-3 hover:text-ink"
          >
            <Eye size={14} />
          </button>
          <button
            type="button"
            aria-label="Remove the slip"
            onClick={remove}
            className="rounded p-1 text-ink-3 hover:text-closed-ink"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          loading={busy}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Paperclip size={14} /> Attach photo or PDF
        </Button>
      )}
    </div>
  );
}
