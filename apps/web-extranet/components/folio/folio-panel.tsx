'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowsLeftRight, Plus, Prohibit, Receipt, Wallet } from '@phosphor-icons/react';
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
  cn,
} from '@yohobed/ui';
import {
  closeFolioWindow,
  getBookingFolio,
  listChargeParticulars,
  openFolioWindow,
  postFolioCharge,
  postRoomCharges,
  recordFolioPayment,
  transferFolioCharges,
  voidFolioCharge,
  type FolioLine,
  type FolioWindow,
} from '@/lib/api';

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

  const voidLine = useMutation({
    mutationFn: (id: string) => voidFolioCharge(id),
    onSuccess: onChanged,
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
                  onVoid={() => voidLine.mutate(l.id)}
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
        <TakePayment
          folioId={w.id}
          suggested={Number(w.totals.balance)}
          currency={currency}
          onDone={() => {
            setPaying(false);
            onChanged();
          }}
        />
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
    onSuccess: onDone,
  });

  const list = (particulars.data ?? []).filter((p) => p.active);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        post.mutate();
      }}
      className="space-y-3 rounded-lg border border-line p-3"
    >
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

function TakePayment({
  folioId,
  suggested,
  currency,
  onDone,
}: {
  folioId: string;
  suggested: number;
  currency: string;
  onDone: () => void;
}) {
  const [amount, setAmount] = React.useState(suggested > 0 ? suggested.toFixed(2) : '');
  const [method, setMethod] = React.useState('cash');
  const [reference, setReference] = React.useState('');

  const pay = useMutation({
    mutationFn: () =>
      recordFolioPayment(folioId, {
        amount: Number(amount),
        method,
        reference: reference.trim() || undefined,
      }),
    onSuccess: onDone,
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        pay.mutate();
      }}
      className="space-y-3 rounded-lg border border-line p-3"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={`Amount (${currency})`}>
          <Input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>
        <Field label="Method">
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['cash', 'card', 'bank', 'online'].map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Reference">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pay.isPending || !amount}>
          {pay.isPending ? 'Recording…' : 'Record payment'}
        </Button>
        {pay.isError && (
          <span className="text-sm text-closed-ink">{(pay.error as Error).message}</span>
        )}
      </div>
    </form>
  );
}
