'use client';

import * as React from 'react';
import {
  ArrowsClockwise,
  CaretDown,
  ClipboardText,
  Crown,
  DoorOpen,
  Eraser,
  UsersThree,
} from '@phosphor-icons/react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  Field,
  InlineAlert,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  NumberStepper,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@yohobed/ui';
import type { RoomAvailability } from '@/lib/api';
import { fullLine, type FullDraft, type FullLineDraft } from './full-draft';
import { MAX_ROOMS } from './limits';

type Dlg = 'pax' | 'rooming' | 'owner' | null;

/** Rooms of each type the form has not already taken. */
function freeUnits(grid: RoomAvailability, lines: FullLineDraft[]) {
  const taken = new Set(lines.map((l) => l.roomUnitId).filter(Boolean));
  return new Map(
    grid.roomTypes.map((rt) => [
      rt.roomId,
      rt.units.filter((u) => u.free && !u.outOfService && !u.blocked && !taken.has(u.id)),
    ]),
  );
}

/**
 * Yanolja's Group Options, for a reservation of two rooms or more: make every room like the
 * first, set the guests in every room at once, give out room numbers, or paste the rooming list
 * a travel agent sent on WhatsApp.
 */
export function GroupOptions({
  draft,
  grid,
  titles,
  onDraft,
}: {
  draft: FullDraft;
  grid: RoomAvailability | undefined;
  titles: string[];
  onDraft: (patch: Partial<FullDraft>) => void;
}) {
  const [dlg, setDlg] = React.useState<Dlg>(null);
  const lines = draft.lines;

  function applyFirstToAll() {
    const first = lines[0]!;
    onDraft({
      lines: lines.map((l, i) =>
        i === 0
          ? l
          : {
              ...l,
              roomId: first.roomId,
              occupancyId: first.occupancyId,
              adults: first.adults,
              children: first.children,
              roomUnitId: '',
              rate: first.rate,
            },
      ),
    });
  }

  function autoAssign() {
    if (!grid) return;
    const pool = freeUnits(grid, lines);
    onDraft({
      lines: lines.map((l) => {
        if (l.roomUnitId || !l.roomId) return l;
        const next = pool.get(l.roomId)?.shift();
        return next ? { ...l, roomUnitId: next.id } : l;
      }),
    });
  }

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            Group options <CaretDown size={12} weight="bold" />
          </Button>
        </MenuTrigger>
        <MenuContent align="start" className="w-64">
          <MenuItem onSelect={applyFirstToAll} disabled={!lines[0]?.roomId}>
            <ArrowsClockwise size={15} /> Make every room like room 1
          </MenuItem>
          <MenuItem onSelect={() => setDlg('pax')}>
            <UsersThree size={15} /> Guests in every room…
          </MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={autoAssign} disabled={!grid || draft.kind === 'inquiry'}>
            <DoorOpen size={15} /> Assign room numbers
          </MenuItem>
          <MenuItem
            onSelect={() => onDraft({ lines: lines.map((l) => ({ ...l, roomUnitId: '' })) })}
          >
            <Eraser size={15} /> Clear room numbers
          </MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => setDlg('rooming')}>
            <ClipboardText size={15} /> Paste rooming list…
          </MenuItem>
          <MenuItem onSelect={() => setDlg('owner')}>
            <Crown size={15} /> Change group owner…
          </MenuItem>
        </MenuContent>
      </Menu>

      <PaxDialog
        open={dlg === 'pax'}
        onOpenChange={(o) => setDlg(o ? 'pax' : null)}
        onApply={(adults, children) =>
          onDraft({ lines: lines.map((l) => ({ ...l, adults, children, childAges: [] })) })
        }
      />
      <RoomingListDialog
        open={dlg === 'rooming'}
        onOpenChange={(o) => setDlg(o ? 'rooming' : null)}
        draft={draft}
        titles={titles}
        onDraft={onDraft}
      />
      <OwnerDialog
        open={dlg === 'owner'}
        onOpenChange={(o) => setDlg(o ? 'owner' : null)}
        draft={draft}
        onDraft={onDraft}
      />
    </>
  );
}

function stop(e: React.FormEvent) {
  e.preventDefault();
  e.stopPropagation();
}

function PaxDialog({
  open,
  onOpenChange,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (adults: number, children: number) => void;
}) {
  const [adults, setAdults] = React.useState(2);
  const [children, setChildren] = React.useState(0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Guests in every room" className="max-w-sm">
        <form
          className="flex flex-col gap-4 px-5 py-4"
          onSubmit={(e) => {
            stop(e);
            onApply(adults, children);
            onOpenChange(false);
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Adults" htmlFor="all-adults">
              <NumberStepper id="all-adults" value={adults} min={1} max={8} onChange={setAdults} />
            </Field>
            <Field label="Children" htmlFor="all-children">
              <NumberStepper
                id="all-children"
                value={children}
                min={0}
                max={6}
                onChange={setChildren}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Apply to every room</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One name per line, as pasted from Excel or a WhatsApp message. A tab or comma after the name
 * may carry a mobile number. The first name is room 1's guest (the reservation's guest, when it is
 * still empty); the rest fill rooms 2, 3… in order.
 */
export function parseRoomingList(text: string): Array<{ name: string; phone: string }> {
  return text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      // Drop a leading "1." / "1)" / "- " numbering.
      const clean = row.replace(/^(\d+[.)]|[-*•])\s*/, '');
      const [name = '', phone = ''] = clean.split(/\t|,|;|\s{2,}/).map((c) => c.trim());
      return { name, phone: /\d{6,}/.test(phone.replace(/\D/g, '')) ? phone : '' };
    })
    .filter((r) => r.name.length > 0);
}

function RoomingListDialog({
  open,
  onOpenChange,
  draft,
  titles,
  onDraft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: FullDraft;
  titles: string[];
  onDraft: (patch: Partial<FullDraft>) => void;
}) {
  const [text, setText] = React.useState('');
  const rows = parseRoomingList(text);
  const extra = Math.max(0, rows.length - draft.lines.length);
  const [addRooms, setAddRooms] = React.useState(true);

  function apply() {
    let lines = [...draft.lines];
    if (addRooms && extra > 0) {
      const last = lines[lines.length - 1]!;
      const room = Math.min(extra, MAX_ROOMS - lines.length);
      lines = [...lines, ...Array.from({ length: room }, () => fullLine(last))];
    }
    const country = draft.guest.phone.country;
    const guestFor = (r: { name: string; phone: string }) => ({
      customerId: null,
      title: titles[0] ?? '',
      name: r.name,
      phone: { number: r.phone, country },
      email: '',
      whatsapp: false,
      createNew: false,
    });
    const first = rows[0];
    const guest =
      first && !draft.guest.customerId && !draft.guest.name.trim()
        ? {
            ...draft.guest,
            name: first.name,
            phone: first.phone ? { number: first.phone, country } : draft.guest.phone,
          }
        : draft.guest;
    lines = lines.map((l, i) => (i > 0 && rows[i] ? { ...l, guest: guestFor(rows[i]!) } : l));
    onDraft({ lines, guest, guestList: true });
    setText('');
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Paste a rooming list" className="max-w-lg">
        <div className="flex flex-col gap-4 px-5 py-4">
          <Field
            label="One guest per line"
            htmlFor="rooming-list"
            hint="Paste from Excel or WhatsApp. A mobile number after the name (tab or comma) is kept."
          >
            <Textarea
              id="rooming-list"
              rows={8}
              value={text}
              placeholder={'Nimal Perera, 0771234567\nKamala Silva\nRavi Kumar'}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          {rows.length > 0 && (
            <p className="text-sm text-ink-2">
              {rows.length} guest{rows.length === 1 ? '' : 's'} for {draft.lines.length} room
              {draft.lines.length === 1 ? '' : 's'}.
            </p>
          )}
          {extra > 0 && (
            <InlineAlert tone="info">
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={addRooms}
                  onCheckedChange={(c) => setAddRooms(c === true)}
                  aria-label="Add rooms for the extra names"
                />
                Add {Math.min(extra, MAX_ROOMS - draft.lines.length)} more room
                {extra === 1 ? '' : 's'} like the last one for the extra names
              </label>
            </InlineAlert>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={rows.length === 0} onClick={apply}>
              Fill the rooms
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The group owner is the reservation's guest; making room N's guest the owner swaps the two. */
function OwnerDialog({
  open,
  onOpenChange,
  draft,
  onDraft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: FullDraft;
  onDraft: (patch: Partial<FullDraft>) => void;
}) {
  const candidates = draft.lines
    .map((l, i) => ({ i, guest: l.guest }))
    .filter((c) => c.i > 0 && c.guest && (c.guest.customerId || c.guest.name.trim()));
  const [pick, setPick] = React.useState<string>('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Change group owner" className="max-w-sm">
        <div className="flex flex-col gap-4 px-5 py-4">
          {candidates.length === 0 ? (
            <p className="text-sm text-ink-3">
              Turn on the Guest List and give another room its own guest first. The owner is the
              guest the whole reservation is booked under.
            </p>
          ) : (
            <Field label="New owner" htmlFor="group-owner">
              <Select value={pick || undefined} onValueChange={setPick}>
                <SelectTrigger id="group-owner">
                  <SelectValue placeholder="-Select-" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((c) => (
                    <SelectItem key={c.i} value={String(c.i)}>
                      {`${c.guest!.name} (room ${c.i + 1})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!pick}
              onClick={() => {
                const i = Number(pick);
                const other = draft.lines[i]!.guest!;
                const owner = draft.guest;
                onDraft({
                  // The profile fields (address, document) stay with the reservation's guest
                  // block; only who it is changes.
                  guest: {
                    ...owner,
                    ...other,
                    // The ID document was the old owner's.
                    document: { type: '', number: '', expiresOn: '', issuingCountry: '' },
                  },
                  lines: draft.lines.map((l, j) =>
                    j === i
                      ? {
                          ...l,
                          guest: {
                            customerId: owner.customerId,
                            title: owner.title,
                            name: owner.name,
                            phone: owner.phone,
                            email: owner.email,
                            whatsapp: owner.whatsapp,
                            createNew: owner.createNew,
                          },
                        }
                      : l,
                  ),
                });
                setPick('');
                onOpenChange(false);
              }}
            >
              Make owner
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Rate Offered → Quick Group Booking: how many of each room type, at which rate type, and
 * optionally one price per night for all of them. Adds the rooms as lines.
 */
export function QuickGroupPanel({
  grid,
  lines,
  money,
  onAdd,
}: {
  grid: RoomAvailability | undefined;
  lines: FullLineDraft[];
  money: (v: string | number) => string;
  onAdd: (lines: FullLineDraft[]) => void;
}) {
  const [counts, setCounts] = React.useState<Record<string, number>>({});
  const [rates, setRates] = React.useState<Record<string, string>>({});
  const [adults, setAdults] = React.useState(2);
  const [nightly, setNightly] = React.useState('');
  const nights = grid?.nights ?? 1;
  if (!grid) return null;

  const room = MAX_ROOMS - lines.length;
  const wanted = Object.values(counts).reduce((s, n) => s + n, 0);
  const typed = Number(nightly.replace(/,/g, ''));
  const perNight = nightly.trim() && Number.isFinite(typed) && typed >= 0 ? typed : null;

  function add() {
    const out: FullLineDraft[] = [];
    for (const rt of grid!.roomTypes) {
      const n = counts[rt.roomId] ?? 0;
      const occupancyId =
        rates[rt.roomId] ?? rt.rateTypes.find((t) => t.priced)?.occupancyId ?? null;
      for (let i = 0; i < n; i++) {
        out.push({
          ...fullLine(),
          roomId: rt.roomId,
          occupancyId,
          adults,
          children: 0,
          // One price for the whole group: typed per night, stored as the stay total per room.
          rate: perNight !== null ? String((perNight * nights).toFixed(2)) : '',
        });
      }
    }
    onAdd(out);
    setCounts({});
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Quick group booking</h3>
        <span className="text-xs text-ink-3">
          Rooms are added unassigned; give out numbers later.
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-3">
              <th className="py-1 pr-2 font-medium">Room type</th>
              <th className="py-1 pr-2 font-medium">Free</th>
              <th className="py-1 pr-2 font-medium">Rate type</th>
              <th className="py-1 font-medium">Rooms</th>
            </tr>
          </thead>
          <tbody>
            {grid.roomTypes.map((rt) => {
              const priced = rt.rateTypes.filter((t) => t.priced);
              const alreadyAsked = lines.filter((l) => l.roomId === rt.roomId).length;
              const free = Math.max(0, rt.free - alreadyAsked);
              return (
                <tr key={rt.roomId} className="border-t border-line">
                  <td className="py-1.5 pr-2 text-ink">{rt.name}</td>
                  <td className="py-1.5 pr-2 font-mono tabular-nums text-ink-2">{free}</td>
                  <td className="py-1.5 pr-2">
                    <Select
                      value={rates[rt.roomId] ?? priced[0]?.occupancyId}
                      onValueChange={(v) => setRates((r) => ({ ...r, [rt.roomId]: v }))}
                      disabled={priced.length === 0}
                    >
                      <SelectTrigger aria-label={`Rate type for ${rt.name}`} className="h-8">
                        <SelectValue placeholder="No price" />
                      </SelectTrigger>
                      <SelectContent>
                        {priced.map((t) => (
                          <SelectItem
                            key={t.occupancyId}
                            value={t.occupancyId}
                            hint={`${money(t.average!)}/night`}
                          >
                            {`${t.rateCode} · ${t.label}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-1.5">
                    <NumberStepper
                      aria-label={`Rooms of ${rt.name}`}
                      value={counts[rt.roomId] ?? 0}
                      min={0}
                      max={Math.min(free, room)}
                      disabled={free === 0 || priced.length === 0}
                      onChange={(n) => setCounts((c) => ({ ...c, [rt.roomId]: n }))}
                      className="w-24"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Adults per room" htmlFor="qg-adults" className="w-32">
          <NumberStepper id="qg-adults" value={adults} min={1} max={8} onChange={setAdults} />
        </Field>
        <Field
          label="Group price per room per night"
          htmlFor="qg-rate"
          hint="Tax inclusive. Leave empty for the rate calendar."
          className="w-60"
        >
          <Input
            id="qg-rate"
            inputMode="decimal"
            placeholder="0.00"
            value={nightly}
            onChange={(e) => setNightly(e.target.value.replace(/[^\d.,]/g, ''))}
          />
        </Field>
        <div className="flex-1" />
        <Button type="button" size="sm" disabled={wanted === 0 || wanted > room} onClick={add}>
          Add {wanted || ''} room{wanted === 1 ? '' : 's'}
        </Button>
      </div>
      {wanted > room && (
        <p className="text-xs font-medium text-closed-ink">
          A reservation holds at most {MAX_ROOMS} rooms.
        </p>
      )}
    </div>
  );
}

/**
 * Rate Offered → Book All Available Rooms: every free room of every type, at its first priced
 * rate type, left unassigned. Returns the lines to add, and how many types had to be skipped.
 */
export function allAvailableLines(
  grid: RoomAvailability,
  lines: FullLineDraft[],
): { lines: FullLineDraft[]; capped: boolean } {
  const out: FullLineDraft[] = [];
  let capped = false;
  for (const rt of grid.roomTypes) {
    const rate = rt.rateTypes.find((t) => t.priced);
    if (!rate) continue;
    const asked = lines.filter((l) => l.roomId === rt.roomId).length;
    for (let i = asked; i < rt.free; i++) {
      if (lines.length + out.length >= MAX_ROOMS) {
        capped = true;
        break;
      }
      out.push({
        ...fullLine(),
        roomId: rt.roomId,
        occupancyId: rate.occupancyId,
        adults: Math.min(2, rate.accommodates),
        children: 0,
      });
    }
  }
  return { lines: out, capped };
}
