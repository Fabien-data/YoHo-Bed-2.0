'use client';

import * as React from 'react';
import {
  AirplaneLanding,
  AirplaneTakeoff,
  Baby,
  CaretDown,
  ChatText,
  ClipboardText,
  ForkKnife,
  Gift,
  Lock,
  Trash,
} from '@phosphor-icons/react';
import {
  Badge,
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  DialogContent,
  Field,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  NumberStepper,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SegmentedControl,
  SelectValue,
  Textarea,
  TimePicker,
  Tooltip,
} from '@yohobed/ui';
import { formatDate } from '@yohobed/locale';
import type {
  InclusionInput,
  InclusionRhythm,
  RemarkInput,
  RemarkType,
  ReservationConfig,
  TaskDepartment,
  TaskInput,
  TaskTrigger,
  TransferDirection,
  TransferInput,
} from '@/lib/api';
import { holdInstant } from '../composer/draft';
import { SavedRemarks } from '../saved-remarks';
import type { FullLineDraft } from './full-draft';

export const REMARK_LABEL: Record<RemarkType, string> = {
  general: 'General',
  front_desk: 'Front desk',
  housekeeping: 'Housekeeping',
  accounts: 'Accounts',
  kitchen: 'Kitchen',
  preference: 'Guest preference',
};

export const DEPARTMENT_LABEL: Record<TaskDepartment, string> = {
  front_desk: 'Front desk',
  housekeeping: 'Housekeeping',
  maintenance: 'Maintenance',
  food_beverage: 'Food & beverage',
  transport: 'Transport',
  other: 'Other',
};

export const TRIGGER_LABEL: Record<TaskTrigger, string> = {
  instant: 'Now',
  checkin: 'At check-in',
  checkout: 'At check-out',
};

export const RHYTHM_LABEL: Record<InclusionRhythm, string> = {
  once: 'Once per stay',
  per_night: 'Per night',
  per_guest_per_night: 'Per guest, per night',
  per_adult_per_night: 'Per adult, per night',
  per_child_per_night: 'Per child, per night',
};

export const DIRECTION_LABEL: Record<TransferDirection, string> = {
  pickup: 'Pick-up',
  dropoff: 'Drop-off',
};

/** Common add-ons, as one-click starting points. Driver/guide rooms are everyday in Sri Lanka. */
const INCLUSION_PRESETS: Array<{ name: string; rhythm: InclusionRhythm }> = [
  { name: 'Breakfast', rhythm: 'per_guest_per_night' },
  { name: 'Dinner', rhythm: 'per_guest_per_night' },
  { name: 'Driver accommodation', rhythm: 'per_night' },
  { name: 'Guide accommodation', rhythm: 'per_night' },
  { name: 'Extra bed', rhythm: 'per_night' },
  { name: 'Early check-in', rhythm: 'once' },
];

type Panel = 'occasion' | 'remarks' | 'task' | 'children' | 'inclusion' | 'transfer' | null;

/**
 * The ⌄ menu at the end of a room line — Yanolja's Inclusion, Remarks, Create Task and Pick Up /
 * Drop Off, and (ours) child ages and extra beds. What a line carries shows as small chips under
 * it, so nothing hides in the menu.
 */
export function LineExtras({
  index,
  line,
  onChange,
  canTask,
  stayDates,
  transportModes,
  currency,
  timeFormat,
}: {
  index: number;
  line: FullLineDraft;
  onChange: (patch: Partial<FullLineDraft>) => void;
  /** Tasks are work orders: Pro. */
  canTask: boolean;
  stayDates: { checkin: string; checkout: string; today: string };
  transportModes: ReservationConfig['transportModes'];
  currency: string;
  timeFormat: '12h' | '24h';
}) {
  const [panel, setPanel] = React.useState<Panel>(null);
  const n = index + 1;
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label={`More for room ${n}`}
            className="mt-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-line-strong text-ink-3 transition duration-1 hover:border-ink-3 hover:text-ink"
          >
            <CaretDown size={12} weight="bold" />
          </button>
        </MenuTrigger>
        <MenuContent align="end" className="w-56">
          <MenuItem onSelect={() => setPanel('occasion')}>
            <Gift size={15} /> Guest occasion
          </MenuItem>
          <MenuItem onSelect={() => setPanel('inclusion')}>
            <ForkKnife size={15} /> Inclusion
          </MenuItem>
          <MenuItem onSelect={() => setPanel('transfer')}>
            <AirplaneLanding size={15} /> Pick-up / drop-off
          </MenuItem>
          <MenuItem onSelect={() => setPanel('remarks')}>
            <ChatText size={15} /> Remarks
          </MenuItem>
          <MenuItem disabled={!canTask} onSelect={() => setPanel('task')}>
            <ClipboardText size={15} /> Create task
            {!canTask && <Lock size={12} className="ml-auto" aria-label="Pro plan" />}
          </MenuItem>
          <MenuItem onSelect={() => setPanel('children')}>
            <Baby size={15} /> Child ages & extra beds
          </MenuItem>
        </MenuContent>
      </Menu>

      <OccasionDialog
        open={panel === 'occasion'}
        onOpenChange={(o) => setPanel(o ? 'occasion' : null)}
        roomNumber={n}
        line={line}
        canTask={canTask}
        currency={currency}
        stayDates={stayDates}
        onChange={onChange}
      />

      <RemarksDialog
        open={panel === 'remarks'}
        onOpenChange={(o) => setPanel(o ? 'remarks' : null)}
        title={`Remarks · room ${n}`}
        remarks={line.remarks}
        onChange={(remarks) => onChange({ remarks })}
      />
      <TaskDialog
        open={panel === 'task'}
        onOpenChange={(o) => setPanel(o ? 'task' : null)}
        roomNumber={n}
        tasks={line.tasks}
        stayDates={stayDates}
        onChange={(tasks) => onChange({ tasks })}
      />
      <ChildrenDialog
        open={panel === 'children'}
        onOpenChange={(o) => setPanel(o ? 'children' : null)}
        roomNumber={n}
        line={line}
        onChange={onChange}
      />
      <InclusionDialog
        open={panel === 'inclusion'}
        onOpenChange={(o) => setPanel(o ? 'inclusion' : null)}
        roomNumber={n}
        inclusions={line.inclusions}
        currency={currency}
        onChange={(inclusions) => onChange({ inclusions })}
      />
      <TransferDialog
        open={panel === 'transfer'}
        onOpenChange={(o) => setPanel(o ? 'transfer' : null)}
        roomNumber={n}
        transfers={line.transfers}
        stayDates={stayDates}
        transportModes={transportModes}
        currency={currency}
        timeFormat={timeFormat}
        onChange={(transfers) => onChange({ transfers })}
      />
    </>
  );
}

const OCCASION_LABEL = {
  birthday: 'Birthday',
  honeymoon: 'Honeymoon',
  anniversary: 'Anniversary',
  preference: 'Guest preference',
  other: 'Other occasion',
} as const;

type OccasionType = keyof typeof OCCASION_LABEL;

/**
 * An occasion is a guided shortcut over the records the hotel already operates: a visible guest
 * remark, an optional preparation work order, and an optional once-per-stay charge.
 */
function OccasionDialog({
  open,
  onOpenChange,
  roomNumber,
  line,
  canTask,
  currency,
  stayDates,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomNumber: number;
  line: FullLineDraft;
  canTask: boolean;
  currency: string;
  stayDates: { checkin: string; checkout: string; today: string };
  onChange: (patch: Partial<FullLineDraft>) => void;
}) {
  const [occasion, setOccasion] = React.useState<OccasionType>('birthday');
  const [date, setDate] = React.useState('');
  const [details, setDetails] = React.useState('');
  const [createTask, setCreateTask] = React.useState(canTask);
  const [extraName, setExtraName] = React.useState('');
  const [extraPrice, setExtraPrice] = React.useState('');
  const extraValid =
    (!extraName.trim() && !extraPrice) || Boolean(extraName.trim() && Number(extraPrice) > 0);
  const apply = () => {
    const label = OCCASION_LABEL[occasion];
    const context = [date ? `on ${date}` : '', details.trim()].filter(Boolean).join(' · ');
    const note = `${label}${context ? ` · ${context}` : ''}`;
    const task: TaskInput = {
      title: `Prepare for ${label.toLocaleLowerCase()}`,
      description: details.trim() || undefined,
      department: occasion === 'birthday' ? 'food_beverage' : 'housekeeping',
      trigger: 'checkin',
      deadline: stayDates.checkin,
      priority: 'medium',
    };
    const inclusion: InclusionInput = {
      name: extraName.trim(),
      rhythm: 'once',
      unitPrice: Number(extraPrice),
    };
    onChange({
      remarks: [
        ...line.remarks,
        { type: occasion === 'preference' ? 'preference' : 'general', text: note },
      ],
      tasks: createTask && canTask ? [...line.tasks, task] : line.tasks,
      inclusions: extraName.trim() ? [...line.inclusions, inclusion] : line.inclusions,
    });
    setDate('');
    setDetails('');
    setExtraName('');
    setExtraPrice('');
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Guest occasion · room ${roomNumber}`} className="max-w-lg">
        <form
          className="flex flex-col gap-4 px-5 py-4"
          onSubmit={(event) => {
            stop(event);
            if (extraValid) apply();
          }}
        >
          <p className="text-sm text-ink-2">
            Record the guest context, prepare the room, and add an optional charge in one step.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Occasion" htmlFor={`occasion-${roomNumber}`} required>
              <Select
                value={occasion}
                onValueChange={(value) => setOccasion(value as OccasionType)}
              >
                <SelectTrigger id={`occasion-${roomNumber}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(OCCASION_LABEL) as OccasionType[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {OCCASION_LABEL[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Occasion date" htmlFor={`occasion-date-${roomNumber}`} hint="Optional">
              <DatePicker
                id={`occasion-date-${roomNumber}`}
                aria-label="Occasion date"
                value={date || null}
                today={stayDates.today}
                onChange={setDate}
              />
            </Field>
          </div>
          <Field
            label="Guest preferences or preparation notes"
            htmlFor={`occasion-details-${roomNumber}`}
          >
            <Textarea
              id={`occasion-details-${roomNumber}`}
              rows={3}
              maxLength={1000}
              value={details}
              placeholder="Cake message, flowers, dietary needs, room preparation…"
              onChange={(event) => setDetails(event.target.value)}
            />
          </Field>
          <label className="flex items-start gap-2 text-sm text-ink-2">
            <Checkbox
              checked={createTask && canTask}
              disabled={!canTask}
              onCheckedChange={(checked) => setCreateTask(checked === true)}
              aria-label="Create preparation task"
              className="mt-0.5"
            />
            <span>
              Create a preparation task due at check-in
              {!canTask ? ' · task permission required' : ''}
            </span>
          </label>
          <div className="rounded-lg border border-line p-3">
            <p className="mb-2 text-sm font-semibold text-ink">Optional chargeable extra</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Extra"
                htmlFor={`occasion-extra-${roomNumber}`}
                hint="Leave blank for no charge"
              >
                <Input
                  id={`occasion-extra-${roomNumber}`}
                  value={extraName}
                  placeholder="Cake, flowers, decoration"
                  onChange={(event) => setExtraName(event.target.value)}
                />
              </Field>
              <Field label={`Price (${currency})`} htmlFor={`occasion-price-${roomNumber}`}>
                <Input
                  id={`occasion-price-${roomNumber}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={extraPrice}
                  onChange={(event) => setExtraPrice(event.target.value)}
                />
              </Field>
            </div>
            {!extraValid && (
              <p className="mt-2 text-xs text-closed-ink">
                Enter both an extra name and a price greater than zero.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!extraValid}>
              Add occasion
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** What a line carries, as chips under it. */
export function LineExtrasSummary({
  line,
  onRemoveTask,
  onChange,
  money,
}: {
  line: FullLineDraft;
  onRemoveTask?: (i: number) => void;
  onChange?: (patch: Partial<FullLineDraft>) => void;
  money?: (v: string | number) => string;
}) {
  const ages = line.childAges.slice(0, line.children);
  if (
    !line.remarks.length &&
    !line.tasks.length &&
    !ages.length &&
    !line.extraBeds &&
    !line.inclusions.length &&
    !line.transfers.length
  ) {
    return null;
  }
  const price = (v: number) => (money ? money(v) : v.toFixed(2));
  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-1 text-xs">
      {line.inclusions.map((inc, i) => (
        <Badge key={`i${i}`} tone="brand" dot={false}>
          <ForkKnife size={11} /> {inc.name} ·{' '}
          {inc.includedInRate
            ? 'in rate'
            : `${price(inc.unitPrice)} ${RHYTHM_LABEL[inc.rhythm].toLowerCase()}`}
          {onChange && (
            <button
              type="button"
              aria-label={`Remove inclusion ${inc.name}`}
              onClick={() => onChange({ inclusions: line.inclusions.filter((_, j) => j !== i) })}
              className="ml-0.5 opacity-70 hover:opacity-100"
            >
              ×
            </button>
          )}
        </Badge>
      ))}
      {line.transfers.map((t, i) => (
        <Badge key={`x${i}`} tone="brand" dot={false}>
          {t.direction === 'pickup' ? <AirplaneLanding size={11} /> : <AirplaneTakeoff size={11} />}{' '}
          {DIRECTION_LABEL[t.direction]}
          {t.flightNo && ` · ${t.flightNo}`}
          {t.amount ? ` · ${price(t.amount)}` : ' · free'}
          {onChange && (
            <button
              type="button"
              aria-label={`Remove ${DIRECTION_LABEL[t.direction].toLowerCase()}`}
              onClick={() => onChange({ transfers: line.transfers.filter((_, j) => j !== i) })}
              className="ml-0.5 opacity-70 hover:opacity-100"
            >
              ×
            </button>
          )}
        </Badge>
      ))}
      {line.remarks.map((r, i) => (
        <Tooltip key={`r${i}`} label={r.text}>
          <span>
            <Badge tone="muted" dot={false}>
              <ChatText size={11} /> {REMARK_LABEL[r.type]}
            </Badge>
          </span>
        </Tooltip>
      ))}
      {line.tasks.map((t, i) => (
        <Badge key={`t${i}`} tone="brand" dot={false}>
          <ClipboardText size={11} /> {t.title} · {TRIGGER_LABEL[t.trigger]}
          {onRemoveTask && (
            <button
              type="button"
              aria-label={`Remove task ${t.title}`}
              onClick={() => onRemoveTask(i)}
              className="ml-0.5 opacity-70 hover:opacity-100"
            >
              ×
            </button>
          )}
        </Badge>
      ))}
      {ages.length > 0 && (
        <Badge tone="muted" dot={false}>
          <Baby size={11} /> Ages {ages.join(', ')}
        </Badge>
      )}
      {line.extraBeds > 0 && (
        <Badge tone="muted" dot={false}>
          +{line.extraBeds} extra bed{line.extraBeds === 1 ? '' : 's'}
        </Badge>
      )}
    </div>
  );
}

/** A dialog's own form must not submit the reservation form it sits in (React bubbles through portals). */
function stop(e: React.FormEvent) {
  e.preventDefault();
  e.stopPropagation();
}

export function RemarksDialog({
  open,
  onOpenChange,
  title,
  remarks,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  remarks: RemarkInput[];
  onChange: (next: RemarkInput[]) => void;
}) {
  const [type, setType] = React.useState<RemarkType>('general');
  const [text, setText] = React.useState('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} className="max-w-lg">
        <form
          className="flex flex-col gap-4 px-5 py-4"
          onSubmit={(e) => {
            stop(e);
            if (!text.trim()) return;
            onChange([...remarks, { type, text: text.trim() }]);
            setText('');
          }}
        >
          {remarks.length > 0 && (
            <ul className="flex flex-col gap-2">
              {remarks.map((r, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
                >
                  <Badge tone="muted" dot={false} className="shrink-0">
                    {REMARK_LABEL[r.type]}
                  </Badge>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap text-ink">{r.text}</span>
                  <button
                    type="button"
                    aria-label="Remove remark"
                    onClick={() => onChange(remarks.filter((_, j) => j !== i))}
                    className="rounded p-1 text-ink-3 hover:text-closed-ink"
                  >
                    <Trash size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Field label="Type" htmlFor="remark-type">
            <Select value={type} onValueChange={(v) => setType(v as RemarkType)}>
              <SelectTrigger id="remark-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(REMARK_LABEL) as RemarkType[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {REMARK_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Remark"
            htmlFor="remark-text"
            hint="Housekeeping remarks show on the housekeeping board; accounts remarks on the folio."
          >
            <Textarea
              id="remark-text"
              rows={3}
              maxLength={1000}
              value={text}
              placeholder="e.g. Honeymoon couple, arrange a cake"
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <SavedRemarks type={type} onPick={setText} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Done
            </Button>
            <Button type="submit" disabled={!text.trim()}>
              Add remark
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TaskDialog({
  open,
  onOpenChange,
  roomNumber,
  tasks,
  stayDates,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomNumber: number;
  tasks: TaskInput[];
  stayDates: { checkin: string; checkout: string; today: string };
  onChange: (next: TaskInput[]) => void;
}) {
  const [title, setTitle] = React.useState('');
  const [department, setDepartment] = React.useState<TaskDepartment>('housekeeping');
  const [trigger, setTrigger] = React.useState<TaskTrigger>('checkin');
  const [deadline, setDeadline] = React.useState('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Create task · room ${roomNumber}`} className="max-w-lg">
        <form
          className="flex flex-col gap-4 px-5 py-4"
          onSubmit={(e) => {
            stop(e);
            if (!title.trim()) return;
            onChange([
              ...tasks,
              {
                title: title.trim(),
                department,
                trigger,
                ...(deadline ? { deadline } : {}),
              },
            ]);
            setTitle('');
            setDeadline('');
            onOpenChange(false);
          }}
        >
          <Field label="Task" htmlFor="task-title" required>
            <Input
              id="task-title"
              value={title}
              maxLength={200}
              placeholder="e.g. Flowers and a cake in the room"
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Department" htmlFor="task-department">
              <Select value={department} onValueChange={(v) => setDepartment(v as TaskDepartment)}>
                <SelectTrigger id="task-department">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(DEPARTMENT_LABEL) as TaskDepartment[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {DEPARTMENT_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Due" htmlFor="task-trigger">
              <Select value={trigger} onValueChange={(v) => setTrigger(v as TaskTrigger)}>
                <SelectTrigger id="task-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TRIGGER_LABEL) as TaskTrigger[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {TRIGGER_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field
            label="Finish by"
            htmlFor="task-deadline"
            hint="A task due at check-in waits off the work list until the guest arrives."
          >
            <DatePicker
              id="task-deadline"
              aria-label="Task deadline"
              value={deadline || null}
              today={stayDates.today}
              min={stayDates.today}
              onChange={setDeadline}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              Add task
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChildrenDialog({
  open,
  onOpenChange,
  roomNumber,
  line,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomNumber: number;
  line: FullLineDraft;
  onChange: (patch: Partial<FullLineDraft>) => void;
}) {
  const ages = Array.from({ length: line.children }, (_, i) => line.childAges[i] ?? null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Children & extra beds · room ${roomNumber}`} className="max-w-md">
        <div className="flex flex-col gap-4 px-5 py-4">
          {line.children === 0 ? (
            <p className="text-sm text-ink-3">
              No children in this room. Set Child on the room line first.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {ages.map((age, i) => (
                <Field key={i} label={`Child ${i + 1} age`} htmlFor={`child-age-${i}`}>
                  <Select
                    value={age === null ? undefined : String(age)}
                    onValueChange={(v) => {
                      const next = ages.map((a, j) => (j === i ? Number(v) : a));
                      // Ages are sent only once every child has one.
                      onChange({
                        childAges: next.every((a) => a !== null) ? (next as number[]) : [],
                      });
                    }}
                  >
                    <SelectTrigger id={`child-age-${i}`}>
                      <SelectValue placeholder="Age" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 18 }, (_, a) => (
                        <SelectItem key={a} value={String(a)}>
                          {a === 0 ? 'Under 1' : `${a} yr${a === 1 ? '' : 's'}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ))}
            </div>
          )}
          <Field
            label="Extra beds"
            htmlFor="extra-beds"
            hint="Recorded for housekeeping; not priced yet."
          >
            <NumberStepper
              id="extra-beds"
              aria-label="Extra beds"
              value={line.extraBeds}
              min={0}
              max={4}
              onChange={(extraBeds) => onChange({ extraBeds })}
              className="w-28"
            />
          </Field>
          <div className="flex justify-end">
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function InclusionDialog({
  open,
  onOpenChange,
  roomNumber,
  inclusions,
  currency,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomNumber: number;
  inclusions: InclusionInput[];
  currency: string;
  onChange: (next: InclusionInput[]) => void;
}) {
  const [name, setName] = React.useState('');
  const [rhythm, setRhythm] = React.useState<InclusionRhythm>('per_guest_per_night');
  const [price, setPrice] = React.useState('');
  const [discount, setDiscount] = React.useState('');
  const [tax, setTax] = React.useState('');
  const [inRate, setInRate] = React.useState(false);
  const ready = name.trim() !== '' && (inRate || Number(price) > 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Inclusion · room ${roomNumber}`} className="max-w-lg">
        <form
          className="flex flex-col gap-4 px-5 py-4"
          onSubmit={(e) => {
            stop(e);
            if (!ready) return;
            onChange([
              ...inclusions,
              {
                name: name.trim(),
                rhythm,
                unitPrice: inRate ? 0 : Number(price) || 0,
                ...(!inRate && Number(discount) > 0 ? { discountPct: Number(discount) } : {}),
                ...(!inRate && Number(tax) > 0 ? { taxRatePct: Number(tax) } : {}),
                ...(inRate ? { includedInRate: true } : {}),
              },
            ]);
            setName('');
            setPrice('');
            setDiscount('');
            setTax('');
            setInRate(false);
          }}
        >
          {inclusions.length > 0 && (
            <ul className="flex flex-col gap-2">
              {inclusions.map((inc, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
                >
                  <ForkKnife size={14} className="shrink-0 text-ink-3" aria-hidden />
                  <span className="min-w-0 flex-1 text-ink">
                    {inc.name}
                    <span className="block text-xs text-ink-3">
                      {RHYTHM_LABEL[inc.rhythm]}
                      {inc.includedInRate
                        ? ' · in the room rate'
                        : ` · ${currency} ${inc.unitPrice.toFixed(2)}`}
                      {inc.discountPct ? ` · ${inc.discountPct}% off` : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${inc.name}`}
                    onClick={() => onChange(inclusions.filter((_, j) => j !== i))}
                    className="rounded p-1 text-ink-3 hover:text-closed-ink"
                  >
                    <Trash size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-1.5">
            {INCLUSION_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => {
                  setName(p.name);
                  setRhythm(p.rhythm);
                }}
                className="rounded-full border border-line-strong px-2.5 py-1 text-xs text-ink-2 transition duration-1 hover:border-ink-3 hover:text-ink"
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="inc-name" required>
              <Input
                id="inc-name"
                value={name}
                maxLength={120}
                placeholder="e.g. Breakfast"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Charged" htmlFor="inc-rhythm">
              <Select value={rhythm} onValueChange={(v) => setRhythm(v as InclusionRhythm)}>
                <SelectTrigger id="inc-rhythm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(RHYTHM_LABEL) as InclusionRhythm[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {RHYTHM_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label={`Price (${currency})`} htmlFor="inc-price" hint="Tax inclusive">
              <Input
                id="inc-price"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className="font-mono"
                disabled={inRate}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </Field>
            <Field label="Discount %" htmlFor="inc-discount">
              <Input
                id="inc-discount"
                type="number"
                min={0}
                max={100}
                className="font-mono"
                disabled={inRate}
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </Field>
            <Field label="Tax % in price" htmlFor="inc-tax">
              <Input
                id="inc-tax"
                type="number"
                min={0}
                max={100}
                className="font-mono"
                disabled={inRate}
                value={tax}
                onChange={(e) => setTax(e.target.value)}
              />
            </Field>
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-ink-2">
            <Checkbox
              checked={inRate}
              onCheckedChange={(c) => setInRate(c === true)}
              aria-label="Already included in the room rate"
              className="mt-0.5"
            />
            <span>
              Already included in the room rate
              <span className="block text-xs text-ink-3">
                Nothing extra is charged; the bill can show it on its own line.
              </span>
            </span>
          </label>
          <p className="text-xs text-ink-3">
            Night audit posts it to the bill each night the guest is in the house.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Done
            </Button>
            <Button type="submit" disabled={!ready}>
              Add inclusion
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TransferDialog({
  open,
  onOpenChange,
  roomNumber,
  transfers,
  stayDates,
  transportModes,
  currency,
  timeFormat,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomNumber: number;
  transfers: TransferInput[];
  stayDates: { checkin: string; checkout: string; today: string };
  transportModes: ReservationConfig['transportModes'];
  currency: string;
  timeFormat: '12h' | '24h';
  onChange: (next: TransferInput[]) => void;
}) {
  const [direction, setDirection] = React.useState<TransferDirection>('pickup');
  const [modeId, setModeId] = React.useState('');
  const [date, setDate] = React.useState('');
  const [time, setTime] = React.useState<string | null>(null);
  const [place, setPlace] = React.useState('');
  const [flightNo, setFlightNo] = React.useState('');
  const [pax, setPax] = React.useState(1);
  const [amount, setAmount] = React.useState('');
  const [vehicle, setVehicle] = React.useState('');
  const [driver, setDriver] = React.useState('');
  // A pick-up meets the guest on arrival day, a drop-off takes them on departure day.
  const day = date || (direction === 'pickup' ? stayDates.checkin : stayDates.checkout);

  function reset() {
    setModeId('');
    setDate('');
    setTime(null);
    setPlace('');
    setFlightNo('');
    setPax(1);
    setAmount('');
    setVehicle('');
    setDriver('');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Pick-up / drop-off · room ${roomNumber}`} className="max-w-lg">
        <form
          className="flex flex-col gap-4 px-5 py-4"
          onSubmit={(e) => {
            stop(e);
            onChange([
              ...transfers,
              {
                direction,
                ...(modeId ? { transportModeId: modeId } : {}),
                ...(time ? { scheduledAt: holdInstant(day, time) } : {}),
                ...(place.trim()
                  ? direction === 'pickup'
                    ? { fromPlace: place.trim() }
                    : { toPlace: place.trim() }
                  : {}),
                ...(flightNo.trim() ? { flightNo: flightNo.trim().toUpperCase() } : {}),
                pax,
                ...(vehicle.trim() ? { vehicle: vehicle.trim() } : {}),
                ...(driver.trim() ? { driver: driver.trim() } : {}),
                amount: Number(amount) || 0,
              },
            ]);
            reset();
            onOpenChange(false);
          }}
        >
          {transfers.length > 0 && (
            <ul className="flex flex-col gap-2">
              {transfers.map((t, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
                >
                  {t.direction === 'pickup' ? (
                    <AirplaneLanding size={14} className="shrink-0 text-ink-3" aria-hidden />
                  ) : (
                    <AirplaneTakeoff size={14} className="shrink-0 text-ink-3" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 text-ink">
                    {DIRECTION_LABEL[t.direction]}
                    {t.flightNo && ` · ${t.flightNo}`}
                    <span className="block text-xs text-ink-3">
                      {t.scheduledAt ? new Date(t.scheduledAt).toLocaleString() : 'Time to confirm'}
                      {' · '}
                      {t.amount ? `${currency} ${t.amount.toFixed(2)}` : 'free'}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${DIRECTION_LABEL[t.direction].toLowerCase()}`}
                    onClick={() => onChange(transfers.filter((_, j) => j !== i))}
                    className="rounded p-1 text-ink-3 hover:text-closed-ink"
                  >
                    <Trash size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <SegmentedControl
            aria-label="Pick-up or drop-off"
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'pickup', label: 'Pick-up' },
              { value: 'dropoff', label: 'Drop-off' },
            ]}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label={direction === 'pickup' ? 'Arrives' : 'Leaves'}
              htmlFor="tr-date"
              className="sm:col-span-2"
              hint={time ? undefined : `${formatDate(day)} · add the time once it is known`}
            >
              <div className="flex">
                <DatePicker
                  id="tr-date"
                  aria-label="Transfer date"
                  value={day}
                  today={stayDates.today}
                  min={stayDates.today}
                  attach="right"
                  className="w-40"
                  onChange={setDate}
                />
                <TimePicker
                  aria-label="Transfer time"
                  value={time}
                  format={timeFormat}
                  minuteStep={5}
                  attach="left"
                  className="-ml-px w-36"
                  onChange={setTime}
                />
              </div>
            </Field>
            <Field label="Vehicle type" htmlFor="tr-mode">
              <Select
                value={modeId || undefined}
                onValueChange={(v) => {
                  setModeId(v);
                  const m = transportModes.find((x) => x.id === v);
                  if (m && !amount && Number(m.defaultPrice) > 0) {
                    setAmount(Number(m.defaultPrice).toFixed(2));
                  }
                }}
              >
                <SelectTrigger id="tr-mode">
                  <SelectValue placeholder={transportModes.length ? 'Choose' : 'None set up'} />
                </SelectTrigger>
                <SelectContent>
                  {transportModes.map((m) => (
                    <SelectItem key={m.id} value={m.id} hint={m.code}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={direction === 'pickup' ? 'From' : 'To'} htmlFor="tr-place">
              <Input
                id="tr-place"
                value={place}
                maxLength={200}
                placeholder="e.g. Bandaranaike Airport (CMB)"
                onChange={(e) => setPlace(e.target.value)}
              />
            </Field>
            <Field label="Flight no." htmlFor="tr-flight">
              <Input
                id="tr-flight"
                value={flightNo}
                maxLength={20}
                className="font-mono uppercase"
                placeholder="UL 504"
                onChange={(e) => setFlightNo(e.target.value)}
              />
            </Field>
            <Field label="Passengers" htmlFor="tr-pax">
              <NumberStepper
                id="tr-pax"
                aria-label="Passengers"
                value={pax}
                min={1}
                max={60}
                onChange={setPax}
                className="w-28"
              />
            </Field>
            <Field label={`Charge (${currency})`} htmlFor="tr-amount" hint="0 for a free transfer">
              <Input
                id="tr-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className="font-mono"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Vehicle no." htmlFor="tr-vehicle">
              <Input
                id="tr-vehicle"
                value={vehicle}
                maxLength={60}
                placeholder="e.g. CAB-4521"
                onChange={(e) => setVehicle(e.target.value)}
              />
            </Field>
            <Field label="Driver" htmlFor="tr-driver">
              <Input
                id="tr-driver"
                value={driver}
                maxLength={120}
                onChange={(e) => setDriver(e.target.value)}
              />
            </Field>
          </div>
          <p className="text-xs text-ink-3">
            Charged to the guest when it is marked done, from the reservation.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Add {DIRECTION_LABEL[direction].toLowerCase()}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
