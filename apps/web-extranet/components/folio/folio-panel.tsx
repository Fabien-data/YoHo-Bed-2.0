'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowCounterClockwise,
  ArrowsLeftRight,
  Buildings,
  Paperclip,
  Plus,
  Prohibit,
  Receipt,
  User,
  Wallet,
} from '@phosphor-icons/react';
import {
  Badge,
  Button,
  Field,
  Input,
  MoneyFooter,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
  cn,
} from '@yohobed/ui';
import {
  ApiError,
  closeFolioWindow,
  issueFolioInvoice,
  listInvoices,
  openPrivateFile,
  getBookingFolio,
  listChargeParticulars,
  type ChargeParticular,
  openFolioWindow,
  postFolioCharge,
  postRoomCharges,
  transferFolioCharges,
  voidFolioCharge,
  describeError,
  type FolioLine,
  type FolioPaymentRow,
  type FolioWindow,
} from '@/lib/api';
import Link from 'next/link';
import { useUxTask } from '@/lib/ux';
import { TakePaymentForm } from '@/components/booking/take-payment-form';
import { RefundDialog } from '@/components/booking/refund-dialog';
import { ReasonDialog } from '@/components/booking/reason-dialog';

const PAYER_LABEL = { guest: 'Guest', company: 'Company', travel_agent: 'Travel agent' } as const;
const ROUTE_LABEL: Record<string, string> = {
  manual: 'extras',
  pos: 'restaurant & bar',
  inclusion: 'inclusions',
};

/**
 * The guest bill, as it appears inside a reservation slide-over and on its own page.
 *
 * One component for both because they are the same thing: a folio read differently is a folio
 * that can disagree with itself.
 */
export function FolioPanel({ bookingId }: { bookingId: string }) {
  const qc = useQueryClient();
  const [activeWindow, setActiveWindow] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const folio = useQuery({
    queryKey: ['folio', bookingId],
    queryFn: () => getBookingFolio(bookingId),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['folio', bookingId] });
    qc.invalidateQueries({ queryKey: ['folios', 'unsettled'] });
    qc.invalidateQueries({ queryKey: ['stayview'] });
    setSelected(new Set());
  };

  const postRooms = useMutation({
    mutationFn: () => postRoomCharges(bookingId),
    onSuccess: refresh,
  });
  const addWindow = useMutation({
    mutationFn: () => openFolioWindow(bookingId),
    onSuccess: refresh,
  });

  if (folio.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (!folio.data) return <p className="text-sm text-closed-ink">Could not load the bill.</p>;

  const data = folio.data;
  const current = data.windows.find((w) => w.id === activeWindow) ?? data.windows[0];
  const roomChargesPosted = data.windows.some((w) => w.lines.some((l) => l.source === 'room'));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={Number(data.totals.balance) === 0 ? 'avail' : 'closed'}>
          Balance {data.currency} {data.totals.balance}
        </Badge>
        {!roomChargesPosted && (
          <Button size="sm" onClick={() => postRooms.mutate()} disabled={postRooms.isPending}>
            <Receipt size={14} />
            {postRooms.isPending ? 'Posting…' : 'Post room charges'}
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => addWindow.mutate()}
          disabled={addWindow.isPending}
        >
          <ArrowsLeftRight size={14} />
          Split bill
        </Button>
      </div>

      {postRooms.isError && (
        <p className="text-sm text-closed-ink">{(postRooms.error as Error).message}</p>
      )}

      {data.windows.length > 1 && (
        <Tabs value={current!.id} onValueChange={setActiveWindow}>
          <TabsList>
            {data.windows.map((w) => (
              <TabsTrigger
                key={w.id}
                value={w.id}
                count={w.lines.filter((l) => !l.voidedAt).length}
              >
                {w.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {current && (
        <WindowView
          key={current.id}
          w={current}
          currency={data.currency}
          otherWindows={data.windows.filter((x) => x.id !== current.id)}
          selected={selected}
          setSelected={setSelected}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function WindowView({
  w,
  currency,
  otherWindows,
  selected,
  setSelected,
  onChanged,
}: {
  w: FolioWindow;
  currency: string;
  otherWindows: FolioWindow[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  onChanged: () => void;
}) {
  const [adding, setAdding] = React.useState(false);
  const [paying, setPaying] = React.useState(false);
  const closed = w.status !== 'open';
  const router = useRouter();
  const qc = useQueryClient();

  // What this window has been invoiced with: a tax invoice and a bill, or one invoice.
  const documents = useQuery({
    queryKey: ['invoices', 'folio', w.id],
    queryFn: () => listInvoices({ folioId: w.id }),
  });
  const live = (documents.data ?? []).filter((d) => !d.creditedAt && d.kind !== 'credit_note');
  const invoice = useMutation({
    mutationFn: () => issueFolioInvoice(w.id),
    onSuccess: (r) => {
      const numbers = r.documents.map((d) => d.number).join(' and ');
      toast.success(`Issued ${numbers}`);
      qc.invalidateQueries({ queryKey: ['invoices'] });
      onChanged();
      router.push(`/app/invoices/${r.documents[0]!.id}`);
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : 'The invoice could not be issued.'),
  });

  // A void reverses money, so it asks why and records it (UX-STANDARD §4).
  const [voiding, setVoiding] = React.useState<FolioLine | null>(null);
  const [refunding, setRefunding] = React.useState(false);
  const voidLine = useMutation({
    mutationFn: (v: { id: string; reason: string }) => voidFolioCharge(v.id, v.reason),
    onSuccess: () => {
      setVoiding(null);
      toast.success('Charge voided');
      onChanged();
    },
  });
  const transfer = useMutation({
    mutationFn: (toFolioId: string) =>
      transferFolioCharges({ chargeIds: [...selected], toFolioId }),
    onSuccess: onChanged,
  });
  const close = useMutation({
    mutationFn: (force: boolean) => closeFolioWindow(w.id, force),
    onSuccess: onChanged,
  });

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
        {w.payerType === 'guest' ? (
          <User size={13} aria-hidden />
        ) : (
          <Buildings size={13} aria-hidden />
        )}
        <span>
          Bills{' '}
          <span className="font-medium text-ink-2">
            {w.payerName ?? PAYER_LABEL[w.payerType ?? 'guest']}
          </span>
          {w.payerType && w.payerType !== 'guest' && ` (${PAYER_LABEL[w.payerType].toLowerCase()})`}
        </span>
        {w.routes?.length > 0 && (
          <span>· takes the stay&apos;s {w.routes.map((r) => ROUTE_LABEL[r] ?? r).join(', ')}</span>
        )}
      </p>
      {closed && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-3">
          This window is closed. Reopen is deliberately not offered — a settled bill stays settled.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
              {otherWindows.length > 0 && !closed && <th className="w-8 px-2 py-2" />}
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Tax</th>
              <th className="px-3 py-2 text-right">Total</th>
              {!closed && <th className="w-8 px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {w.lines.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-ink-3">
                  Nothing posted yet.
                </td>
              </tr>
            ) : (
              w.lines.map((l) => (
                <Line
                  key={l.id}
                  l={l}
                  closed={closed}
                  otherWindows={otherWindows}
                  selected={selected}
                  onToggle={() => toggle(l.id)}
                  onVoid={() => setVoiding(l)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && otherWindows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 p-2">
          <span className="text-sm text-ink-2">Move {selected.size} to</span>
          {otherWindows.map((o) => (
            <Button
              key={o.id}
              size="sm"
              variant="secondary"
              onClick={() => transfer.mutate(o.id)}
              disabled={transfer.isPending}
            >
              {o.label}
            </Button>
          ))}
        </div>
      )}

      {w.payments.length > 0 && <Payments rows={w.payments} currency={currency} />}

      <div className="rounded-lg border border-line p-3">
        <MoneyFooter
          total={Number(w.totals.charges)}
          paid={Number(w.totals.paid)}
          balance={Number(w.totals.balance)}
          format={(n) => `${currency} ${n.toFixed(2)}`}
        />
      </div>

      {!closed && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setAdding((v) => !v)}>
            <Plus size={14} />
            Add charge
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setPaying((v) => !v)}>
            <Wallet size={14} />
            Take payment
          </Button>
          {Number(w.totals.paid) > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setRefunding(true)}>
              <ArrowCounterClockwise size={14} />
              Give money back
            </Button>
          )}
          {live.length === 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => invoice.mutate()}
              loading={invoice.isPending}
              disabled={invoice.isPending}
            >
              <Receipt size={14} />
              Invoice
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => close.mutate(Number(w.totals.balance) !== 0)}
            disabled={close.isPending}
          >
            {Number(w.totals.balance) === 0 ? 'Close window' : 'Close with balance'}
          </Button>
        </div>
      )}

      {adding && !closed && (
        <AddCharge
          folioId={w.id}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
        />
      )}
      {paying && !closed && (
        <TakePaymentForm
          folioId={w.id}
          suggested={Number(w.totals.balance)}
          currency={currency}
          onDone={() => {
            setPaying(false);
            onChanged();
          }}
        />
      )}
      <RefundDialog
        folioId={w.id}
        paid={Number(w.totals.paid)}
        suggested={Number(w.totals.balance) < 0 ? -Number(w.totals.balance) : 0}
        currency={currency}
        open={refunding}
        onOpenChange={setRefunding}
        onDone={onChanged}
      />
      <ReasonDialog
        open={voiding !== null}
        onOpenChange={(o) => !o && setVoiding(null)}
        title={`Void "${voiding?.description ?? ''}"?`}
        consequence={
          <>
            The line stays on the bill, crossed out, and stops counting — {currency}{' '}
            {Number(voiding?.total ?? 0).toFixed(2)} comes off. Who voided it and why are recorded.
          </>
        }
        confirmLabel="Void the charge"
        destructive
        suggestions={['Posted to the wrong room', 'Posted twice', 'Guest did not take it']}
        busy={voidLine.isPending}
        error={voidLine.isError ? describeError(voidLine.error) : null}
        onConfirm={(reason) => voiding && voidLine.mutate({ id: voiding.id, reason })}
      />
      {(documents.data?.length ?? 0) > 0 && (
        <ul className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-3">Documents:</span>
          {documents.data!.map((d) => (
            <li key={d.id}>
              <Link
                href={`/app/invoices/${d.id}`}
                className={cn(
                  'rounded-md border border-line-strong px-2 py-1 font-mono transition duration-1 hover:border-ink-3',
                  d.creditedAt && 'text-ink-3 line-through',
                )}
                title={d.title}
              >
                {d.number}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {close.isError && <p className="text-sm text-closed-ink">{(close.error as Error).message}</p>}
    </div>
  );
}

function Line({
  l,
  closed,
  otherWindows,
  selected,
  onToggle,
  onVoid,
}: {
  l: FolioLine;
  closed: boolean;
  otherWindows: FolioWindow[];
  selected: Set<string>;
  onToggle: () => void;
  onVoid: () => void;
}) {
  const dead = !!l.voidedAt;
  return (
    <tr className={cn('border-b border-line last:border-0', dead && 'opacity-50')}>
      {otherWindows.length > 0 && !closed && (
        <td className="px-2 py-2">
          {!dead && (
            <input
              type="checkbox"
              checked={selected.has(l.id)}
              onChange={onToggle}
              aria-label={`Select ${l.description}`}
            />
          )}
        </td>
      )}
      <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-3">{l.postedFor}</td>
      <td className="px-3 py-2 text-ink">
        <span className={cn(dead && 'line-through')}>{l.description}</span>
        {l.particularCode && (
          <span className="ml-1.5 rounded bg-surface-2 px-1 text-[10px] text-ink-3">
            {l.particularCode}
          </span>
        )}
        {l.source === 'levy' && (
          <span
            className="ml-1.5 rounded bg-info-soft px-1 text-[10px] text-info-ink"
            title="A levy per room per night stayed — not part of the room rate, and it moves between bills only as a whole"
          >
            Levy
          </span>
        )}
        {dead && (
          <span className="ml-1.5 text-[11px] text-closed-ink">
            voided{l.voidReason ? ` — ${l.voidReason}` : ''}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-ink-2">
        {Number(l.quantity)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-ink-3">
        {Number(l.tax).toFixed(2)}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
        {Number(l.total).toFixed(2)}
      </td>
      {!closed && (
        <td className="px-2 py-2">
          {!dead && (
            <button
              type="button"
              onClick={onVoid}
              aria-label={`Void ${l.description}`}
              className="text-ink-3 transition hover:text-closed-ink"
            >
              <Prohibit size={13} />
            </button>
          )}
        </td>
      )}
    </tr>
  );
}

function AddCharge({ folioId, onDone }: { folioId: string; onDone: () => void }) {
  const [particularId, setParticularId] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [unitPrice, setUnitPrice] = React.useState('');
  const [quantity, setQuantity] = React.useState('1');
  const ux = useUxTask('folio.post_charge', true);

  const particulars = useQuery({
    queryKey: ['charge-particulars'],
    queryFn: listChargeParticulars,
  });

  const post = useMutation({
    mutationFn: () =>
      postFolioCharge(folioId, {
        particularId: particularId || undefined,
        description: description.trim() || undefined,
        unitPrice: unitPrice ? Number(unitPrice) : undefined,
        quantity: Number(quantity) || 1,
      }),
    onSuccess: () => {
      ux.complete();
      onDone();
    },
  });

  /**
   * One tap posts a catalogue item at its own price (UX-2): a minibar or a laundry bag is the
   * same charge every time, and typing it out was five presses. It is posted straight away and
   * undone from the toast, the way the rest of the desk works.
   */
  const oneTap = useMutation({
    mutationFn: (p: ChargeParticular) =>
      postFolioCharge(folioId, { particularId: p.id, quantity: 1 }).then((line) => ({ p, line })),
    onSuccess: ({ p, line }) => {
      ux.complete();
      onDone();
      toast.success(`${p.name} posted`, {
        action: {
          label: 'Undo',
          onClick: () =>
            voidFolioCharge(line.id, 'Posted by mistake')
              .then(() => {
                onDone();
                toast.success(`${p.name} taken off the bill`);
              })
              .catch((e) => toast.error(describeError(e, 'It could not be taken off'))),
        },
      });
    },
    onError: (e) => toast.error(describeError(e, 'The charge could not be posted')),
  });

  const list = (particulars.data ?? []).filter((p) => p.active);
  // The handful the desk actually rings up, in the order the owner set.
  const quick = list.slice(0, 8);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        post.mutate();
      }}
      className="space-y-3 rounded-lg border border-line p-3"
    >
      {quick.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-3">One tap</p>
          <div className="flex flex-wrap gap-2">
            {quick.map((p) => (
              <Button
                key={p.id}
                type="button"
                size="sm"
                variant="secondary"
                loading={oneTap.isPending && oneTap.variables?.id === p.id}
                onClick={() => oneTap.mutate(p)}
              >
                {p.name}
                <span className="ml-1.5 font-mono text-xs text-ink-3">
                  {Number(p.defaultPrice).toFixed(2)}
                </span>
              </Button>
            ))}
          </div>
        </div>
      )}

      {list.length > 0 && (
        <Field label="From the catalogue" hint="Or leave blank and type a one-off charge below.">
          <Select value={particularId} onValueChange={setParticularId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose an item" />
            </SelectTrigger>
            <SelectContent>
              {list.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.code} · {p.name} ({Number(p.defaultPrice).toFixed(2)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Description" className="sm:col-span-1">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Unit price">
          <Input
            type="number"
            step="0.01"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
          />
        </Field>
        <Field label="Quantity">
          <Input
            type="number"
            step="0.01"
            min="0.01"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={post.isPending}>
          {post.isPending ? 'Posting…' : 'Post charge'}
        </Button>
        {post.isError && (
          <span className="text-sm text-closed-ink">{(post.error as Error).message}</span>
        )}
      </div>
    </form>
  );
}

function Payments({ rows, currency }: { rows: FolioPaymentRow[]; currency: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
            <th className="px-3 py-2">Paid</th>
            <th className="px-3 py-2">Method</th>
            <th className="px-3 py-2">Receipt</th>
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="w-8 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-b border-line last:border-0">
              <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-3">
                {new Date(p.createdAt).toLocaleDateString()}
              </td>
              <td className="px-3 py-2 text-ink">
                {p.direction === 'sent' && (
                  <span className="mr-1.5 rounded bg-low-soft px-1 text-[11px] text-low-ink">
                    Refund
                  </span>
                )}
                {p.ledgerAccountId ? 'City ledger' : (p.methodName ?? p.method)}
                {p.reference && (
                  <span className="ml-1.5 font-mono text-[11px] text-ink-3">{p.reference}</span>
                )}
                {p.direction === 'sent' && p.note && (
                  <span className="block text-xs text-ink-3">
                    {p.note.replace(/^Refund: /, '')}
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-ink-2">
                {p.receiptNo ?? '—'}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
                {p.direction === 'sent' ? '−' : ''}
                {currency} {Number(p.amount).toFixed(2)}
              </td>
              <td className="px-2 py-2">
                {p.attachmentFileId && (
                  <button
                    type="button"
                    aria-label="View the slip"
                    onClick={() =>
                      openPrivateFile(p.attachmentFileId!).catch((e) =>
                        toast.error(e instanceof ApiError ? e.message : 'Could not open the slip.'),
                      )
                    }
                    className="text-ink-3 transition hover:text-ink"
                  >
                    <Paperclip size={13} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
