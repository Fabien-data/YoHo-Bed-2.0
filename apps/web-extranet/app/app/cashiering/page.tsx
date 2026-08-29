'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Money, Plus, Receipt, Wallet } from '@phosphor-icons/react';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from '@yohobed/ui';
import {
  closeDrawerSession,
  createBusinessSource,
  createDrawer,
  createExpense,
  createLedgerAccount,
  getDrawerReport,
  getLedgerStatement,
  listBusinessSources,
  listDrawers,
  listExpenses,
  listLedgerAccounts,
  openDrawerSession,
  settleLedgerAccount,
  type LedgerAccountType,
} from '@/lib/api';
import { useActiveProperty } from '@/components/active-property';

const ACCOUNT_LABEL: Record<LedgerAccountType, string> = {
  travel_agent: 'Travel agent',
  company: 'Company',
  sales_person: 'Sales person',
  other: 'Other',
};

export default function CashieringPage() {
  const { propertyId } = useActiveProperty();

  return (
    <div>
      <PageHeader eyebrow="Cashiering" title="Cashiering centre" />

      <Tabs defaultValue="ledger">
        <TabsList className="mb-4 overflow-x-auto">
          <TabsTrigger value="ledger">City ledger</TabsTrigger>
          <TabsTrigger value="drawers">Cash drawers</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="sources">Business sources</TabsTrigger>
        </TabsList>

        <TabsContent value="ledger">
          <LedgerTab />
        </TabsContent>
        <TabsContent value="drawers">
          {propertyId && <DrawersTab propertyId={propertyId} />}
        </TabsContent>
        <TabsContent value="expenses">
          {propertyId && <ExpensesTab propertyId={propertyId} />}
        </TabsContent>
        <TabsContent value="sources">
          <SourcesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Travel agents, companies and sales people — everyone who is billed other than the guest. */
function LedgerTab() {
  const qc = useQueryClient();
  const [adding, setAdding] = React.useState(false);
  const [openFor, setOpenFor] = React.useState<string | null>(null);

  const accounts = useQuery({ queryKey: ['ledger-accounts'], queryFn: listLedgerAccounts });
  const refresh = () => qc.invalidateQueries({ queryKey: ['ledger-accounts'] });

  const rows = accounts.data ?? [];
  // Currency is per-account, so the outstanding total must be grouped by currency — summing raw
  // numbers and stamping the first row's currency on the result would fabricate a figure.
  const owedByCurrency = React.useMemo(() => {
    const totals = new Map<string, number>();
    for (const a of rows) {
      const bal = Number(a.balance);
      if (bal > 0) totals.set(a.currency, (totals.get(a.currency) ?? 0) + bal);
    }
    return [...totals.entries()].map(([c, v]) => `${c} ${v.toFixed(2)}`).join(' + ');
  }, [rows]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {rows.length > 0 && (
          <Badge tone={owedByCurrency ? 'low' : 'avail'}>
            {owedByCurrency || 'Nothing'} outstanding
          </Badge>
        )}
        <Button size="sm" className="ml-auto" onClick={() => setAdding((v) => !v)}>
          <Plus size={14} />
          New account
        </Button>
      </div>

      {adding && (
        <NewAccountForm
          onDone={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}

      {accounts.isLoading ? (
        <Skeletons />
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-3">
          No ledger accounts yet. Add a travel agent or company to bill stays to them.
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3 text-right">Credit limit</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const bal = Number(a.balance);
                return (
                  <tr key={a.id} className="border-b border-line last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <span className="font-semibold text-ink">{a.name}</span>
                      <span className="ml-2 font-mono text-xs text-ink-3">{a.code}</span>
                    </td>
                    <td className="px-4 py-3 text-ink-2">{ACCOUNT_LABEL[a.type]}</td>
                    <td className="px-4 py-3 text-xs text-ink-3">
                      {a.contactName ?? a.email ?? a.phone ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-3">
                      {Number(a.creditLimit) === 0 ? 'none' : Number(a.creditLimit).toFixed(2)}
                    </td>
                    <td
                      className={cn(
                        'px-4 py-3 text-right font-mono font-semibold tabular-nums',
                        bal > 0 ? 'text-closed-ink' : bal < 0 ? 'text-avail-ink' : 'text-ink-2',
                      )}
                    >
                      {a.currency} {bal.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setOpenFor(a.id)}>
                        Statement
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Sheet open={openFor !== null} onOpenChange={(o) => !o && setOpenFor(null)}>
        <SheetContent title="Account statement" wide>
          {openFor && <Statement accountId={openFor} onChanged={refresh} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function NewAccountForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = React.useState({
    type: 'company' as LedgerAccountType,
    code: '',
    name: '',
    contactName: '',
    creditLimit: '0',
  });
  const create = useMutation({
    mutationFn: () =>
      createLedgerAccount({
        type: form.type,
        code: form.code.trim(),
        name: form.name.trim(),
        contactName: form.contactName.trim() || undefined,
        creditLimit: Number(form.creditLimit) || 0,
      }),
    onSuccess: onDone,
  });

  return (
    <Card className="mb-3 p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Type">
            <Select
              value={form.type}
              onValueChange={(v) => setForm({ ...form, type: v as LedgerAccountType })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ACCOUNT_LABEL) as LedgerAccountType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {ACCOUNT_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Code">
            <Input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              required
            />
          </Field>
          <Field label="Name">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </Field>
          <Field label="Credit limit" hint="0 means no limit">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={form.creditLimit}
              onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
            />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create account'}
          </Button>
          {create.isError && (
            <span className="text-sm text-closed-ink">{(create.error as Error).message}</span>
          )}
        </div>
      </form>
    </Card>
  );
}

function Statement({ accountId, onChanged }: { accountId: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = React.useState('');
  const stmt = useQuery({
    queryKey: ['ledger-statement', accountId],
    queryFn: () => getLedgerStatement(accountId),
  });
  const settle = useMutation({
    mutationFn: () => settleLedgerAccount(accountId, { amount: Number(amount) }),
    onSuccess: () => {
      setAmount('');
      qc.invalidateQueries({ queryKey: ['ledger-statement', accountId] });
      onChanged();
    },
  });

  if (stmt.isLoading || !stmt.data) return <Skeletons />;
  const d = stmt.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold text-ink">{d.account.name}</span>
        <Badge tone={Number(d.balance) > 0 ? 'closed' : 'avail'}>
          {d.account.currency} {d.balance}
        </Badge>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          settle.mutate();
        }}
        className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-3"
      >
        <Field label="Record a payment from this account" className="w-44">
          <Input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={Number(d.balance) > 0 ? d.balance : ''}
          />
        </Field>
        <Button type="submit" size="sm" disabled={!amount || settle.isPending}>
          <Money size={14} />
          Settle
        </Button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Debit</th>
              <th className="px-3 py-2 text-right">Credit</th>
              <th className="px-3 py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {d.entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-ink-3">
                  Nothing posted yet.
                </td>
              </tr>
            ) : (
              d.entries.map((e) => (
                <tr key={e.id} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-3">
                    {e.createdAt.slice(0, 10)}
                  </td>
                  <td className="px-3 py-2 text-ink">
                    {e.description}
                    {e.reference && (
                      <span className="ml-1.5 font-mono text-[11px] text-ink-3">{e.reference}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-closed-ink">
                    {e.direction === 'debit' ? Number(e.amount).toFixed(2) : ''}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-avail-ink">
                    {e.direction === 'credit' ? Number(e.amount).toFixed(2) : ''}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
                    {e.balance}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Tills, shifts and the Cashier Report. */
function DrawersTab({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const [name, setName] = React.useState('');
  const [float, setFloat] = React.useState('0');
  const [reportFor, setReportFor] = React.useState<string | null>(null);

  const drawers = useQuery({
    queryKey: ['drawers', propertyId],
    queryFn: () => listDrawers(propertyId),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['drawers'] });

  const add = useMutation({
    mutationFn: () => createDrawer(propertyId, name.trim()),
    onSuccess: () => {
      setName('');
      refresh();
    },
  });
  const open = useMutation({
    mutationFn: (drawerId: string) => openDrawerSession(drawerId, Number(float) || 0),
    onSuccess: refresh,
  });

  const rows = drawers.data ?? [];

  return (
    <div>
      <Card className="mb-3 flex flex-wrap items-end gap-2 p-3">
        <Field label="New till" className="w-52">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Front desk" />
        </Field>
        <Button size="sm" onClick={() => add.mutate()} disabled={!name.trim() || add.isPending}>
          <Plus size={14} />
          Add
        </Button>
        <Field label="Opening float" className="ml-auto w-32">
          <Input
            type="number"
            step="0.01"
            min="0"
            value={float}
            onChange={(e) => setFloat(e.target.value)}
          />
        </Field>
      </Card>

      {drawers.isLoading ? (
        <Skeletons />
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-3">No tills yet.</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((d) => (
            <Card key={d.id} className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <Wallet size={16} className="text-ink-3" />
                <span className="font-semibold text-ink">{d.name}</span>
                <Badge tone={d.openSessionId ? 'avail' : 'muted'} className="ml-auto">
                  {d.openSessionId ? 'Shift open' : 'Closed'}
                </Badge>
              </div>
              {d.openSessionId ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setReportFor(d.openSessionId!)}
                >
                  <Receipt size={14} />
                  Cashier report
                </Button>
              ) : (
                <Button size="sm" onClick={() => open.mutate(d.id)} disabled={open.isPending}>
                  Open shift
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
      {open.isError && (
        <p className="mt-2 text-sm text-closed-ink">{(open.error as Error).message}</p>
      )}

      <Sheet open={reportFor !== null} onOpenChange={(o) => !o && setReportFor(null)}>
        <SheetContent title="Cashier report" wide>
          {reportFor && (
            <CashierReport
              sessionId={reportFor}
              onClosed={() => {
                setReportFor(null);
                refresh();
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CashierReport({ sessionId, onClosed }: { sessionId: string; onClosed: () => void }) {
  const [declared, setDeclared] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const report = useQuery({
    queryKey: ['drawer-report', sessionId],
    queryFn: () => getDrawerReport(sessionId),
  });
  const close = useMutation({
    mutationFn: () =>
      closeDrawerSession(sessionId, {
        declaredTotal: Number(declared),
        notes: notes.trim() || undefined,
      }),
    onSuccess: onClosed,
  });

  if (report.isLoading || !report.data) return <Skeletons />;
  const r = report.data;
  const isOpen = r.session.status === 'open';
  const variance = declared ? Number(declared) - Number(r.totals.expected) : null;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2 rounded-lg border border-line p-3 text-sm">
        <Line label="Opening float" value={r.totals.openingFloat} />
        <Line label="Cash taken" value={r.totals.cashTaken} />
        <Line label="Cash paid out" value={`−${r.totals.cashPaidOut}`} />
        <Line label="Expected in drawer" value={r.totals.expected} strong />
        <Line label="All payments taken" value={r.totals.allPaymentsTaken} muted />
      </dl>

      {r.byMethod.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-3">By method</h3>
          <div className="flex flex-wrap gap-2">
            {r.byMethod.map((m) => (
              <Badge key={m.method} tone="muted" dot={false}>
                {m.method}: {Number(m.total).toFixed(2)} ({m.n})
              </Badge>
            ))}
          </div>
        </div>
      )}

      {r.expenses.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-3">
            Paid out of this till
          </h3>
          <ul className="text-sm">
            {r.expenses.map((e) => (
              <li
                key={e.id}
                className="flex justify-between border-b border-line py-1 last:border-0"
              >
                <span className="text-ink-2">
                  <span className="font-mono text-xs text-ink-3">{e.voucherNo}</span> {e.payee}
                </span>
                <span className="font-mono tabular-nums text-ink">
                  {Number(e.amount).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isOpen ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            close.mutate();
          }}
          className="space-y-3 rounded-lg border border-line p-3"
        >
          <Field label="Counted in the drawer" hint="What is physically there right now.">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={declared}
              onChange={(e) => setDeclared(e.target.value)}
              required
            />
          </Field>
          {variance !== null && (
            <p
              className={cn(
                'text-sm font-semibold',
                variance === 0
                  ? 'text-avail-ink'
                  : variance < 0
                    ? 'text-closed-ink'
                    : 'text-low-ink',
              )}
            >
              {variance === 0
                ? 'Balances exactly.'
                : variance < 0
                  ? `Short by ${Math.abs(variance).toFixed(2)}`
                  : `Over by ${variance.toFixed(2)}`}
            </p>
          )}
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Button type="submit" size="sm" disabled={!declared || close.isPending}>
            {close.isPending ? 'Closing…' : 'Close shift'}
          </Button>
        </form>
      ) : (
        <div className="rounded-lg border border-line p-3 text-sm">
          <p className="mb-1 font-semibold text-ink">Shift closed</p>
          <p className="text-ink-2">
            Counted {r.totals.declared} against {r.totals.expected} expected — variance{' '}
            <span
              className={cn(
                'font-mono font-semibold',
                Number(r.totals.variance) === 0 ? 'text-avail-ink' : 'text-closed-ink',
              )}
            >
              {r.totals.variance}
            </span>
            .
          </p>
          {r.session.notes && <p className="mt-1 text-xs text-ink-3">{r.session.notes}</p>}
        </div>
      )}
    </div>
  );
}

function ExpensesTab({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = React.useState({ payee: '', amount: '', category: 'other', note: '' });

  const expenses = useQuery({
    queryKey: ['expenses', propertyId],
    queryFn: () => listExpenses(propertyId),
  });
  const drawers = useQuery({
    queryKey: ['drawers', propertyId],
    queryFn: () => listDrawers(propertyId),
  });
  const openSession = drawers.data?.find((d) => d.openSessionId)?.openSessionId ?? undefined;

  const add = useMutation({
    mutationFn: () =>
      createExpense(propertyId, {
        payee: form.payee.trim(),
        amount: Number(form.amount),
        category: form.category,
        note: form.note.trim() || undefined,
        drawerSessionId: openSession,
      }),
    onSuccess: () => {
      setForm({ payee: '', amount: '', category: 'other', note: '' });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['drawer-report'] });
    },
  });

  const rows = expenses.data ?? [];

  return (
    <div>
      <Card className="mb-3 p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
          className="space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Paid to">
              <Input
                value={form.payee}
                onChange={(e) => setForm({ ...form, payee: e.target.value })}
                required
              />
            </Field>
            <Field label="Amount">
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
              />
            </Field>
            <Field label="Category">
              <Select
                value={form.category}
                onValueChange={(v) => setForm({ ...form, category: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['supplies', 'maintenance', 'transport', 'staff', 'utilities', 'other'].map(
                    (c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Note">
              <Input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={add.isPending}>
              <Plus size={14} />
              Record expense
            </Button>
            <span className="text-xs text-ink-3">
              {openSession
                ? 'Will be taken out of the open till.'
                : 'No till is open, so this is recorded outside the drawer.'}
            </span>
            {add.isError && (
              <span className="text-sm text-closed-ink">{(add.error as Error).message}</span>
            )}
          </div>
        </form>
      </Card>

      {expenses.isLoading ? (
        <Skeletons />
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-3">Nothing paid out yet.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                <th className="px-4 py-3">Voucher</th>
                <th className="px-4 py-3">Paid to</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-mono text-xs text-ink-2">{e.voucherNo}</td>
                  <td className="px-4 py-3 text-ink">{e.payee}</td>
                  <td className="px-4 py-3 text-ink-2">{e.category}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-3">
                    {e.createdAt.slice(0, 10)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-ink">
                    {Number(e.amount).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/**
 * Default swatch for a new business source. `<input type="color">` only accepts a literal hex,
 * so a token class cannot be used here — this mirrors the light-theme `--info` token, the
 * nearest tone in the design system.
 */
const DEFAULT_SOURCE_COLOR = '#3e6db5';

/** Where the business came from — the colours the tape chart uses. */
function SourcesTab() {
  const qc = useQueryClient();
  const [form, setForm] = React.useState({ shortCode: '', name: '', color: DEFAULT_SOURCE_COLOR });
  const sources = useQuery({ queryKey: ['business-sources'], queryFn: listBusinessSources });
  const add = useMutation({
    mutationFn: () =>
      createBusinessSource({
        shortCode: form.shortCode.trim(),
        name: form.name.trim(),
        color: form.color,
      }),
    onSuccess: () => {
      setForm({ shortCode: '', name: '', color: DEFAULT_SOURCE_COLOR });
      qc.invalidateQueries({ queryKey: ['business-sources'] });
    },
  });

  const rows = sources.data ?? [];

  return (
    <div>
      <Card className="mb-3 p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <Field label="Code" className="w-28">
            <Input
              value={form.shortCode}
              onChange={(e) => setForm({ ...form, shortCode: e.target.value })}
              placeholder="BDC"
              required
            />
          </Field>
          <Field label="Name" className="w-52">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Booking.com"
              required
            />
          </Field>
          <Field label="Colour" className="w-28">
            <Input
              type="color"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
              className="h-9 p-1"
            />
          </Field>
          <Button type="submit" size="sm" disabled={add.isPending}>
            <Plus size={14} />
            Add source
          </Button>
          {add.isError && (
            <span className="text-sm text-closed-ink">{(add.error as Error).message}</span>
          )}
        </form>
      </Card>

      {rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-3">
          No sources yet. They colour the bars on Stay view.
        </Card>
      ) : (
        <div className="flex flex-wrap gap-2">
          {rows.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"
            >
              <span className="h-3 w-3 rounded" style={{ background: s.color }} />
              <span className="font-semibold text-ink">{s.name}</span>
              <span className="font-mono text-xs text-ink-3">{s.shortCode}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Line({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <>
      <dt className={cn('text-ink-3', strong && 'font-semibold text-ink-2')}>{label}</dt>
      <dd
        className={cn(
          'text-right font-mono tabular-nums',
          strong ? 'font-bold text-ink' : muted ? 'text-ink-3' : 'text-ink-2',
        )}
      >
        {value}
      </dd>
    </>
  );
}

function Skeletons() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
