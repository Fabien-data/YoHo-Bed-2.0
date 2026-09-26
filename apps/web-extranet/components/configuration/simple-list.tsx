'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash } from '@phosphor-icons/react';
import {
  Button,
  Card,
  ConfirmDialog,
  DataGrid,
  DatePicker,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  Switch,
  TagColorPicker,
  Textarea,
  toast,
  type ColumnDef,
} from '@yohobed/ui';
import {
  createConfigRow,
  deleteConfigRow,
  listConfigRows,
  updateConfigRow,
  type ConfigListKey,
  type ConfigListRows,
} from '@/lib/api';
import { errorMessage } from './shared';

/** One field of a list entry's editor. */
export type FieldSpec<D> =
  | {
      key: keyof D & string;
      label: string;
      kind: 'text' | 'textarea' | 'number' | 'date';
      hint?: string;
      required?: boolean;
      maxLength?: number;
      /** Fixed once saved (a code other screens refer to). */
      lockedOnEdit?: boolean;
      mono?: boolean;
      /** How many of the editor's three columns it takes. */
      span?: 1 | 2 | 3;
    }
  | {
      key: keyof D & string;
      label: string;
      kind: 'select';
      options: Array<{ value: string; label: string }>;
      hint?: string;
      span?: 1 | 2 | 3;
    }
  | { key: keyof D & string; label: string; kind: 'switch'; hint?: string }
  | { key: keyof D & string; label: string; kind: 'color' };

export interface SimpleListProps<K extends ConfigListKey, D extends Record<string, unknown>> {
  list: K;
  /** For the lists kept per property (holidays, discounts). */
  propertyId?: string;
  canEdit: boolean;
  /** What one entry is called ("holiday"), for buttons and messages. */
  noun: string;
  columns: ColumnDef<ConfigListRows[K]>[];
  fields: Array<FieldSpec<D>>;
  blank: D;
  fromRow: (row: ConfigListRows[K]) => D;
  toBody: (draft: D, editing: boolean) => Record<string, unknown>;
  /** A draft the Save button may send. */
  valid: (draft: D) => boolean;
  sheetDescription: string;
  emptyDescription: string;
  /** What deleting an entry does, said before it happens (UX-STANDARD §5). */
  deleteConsequence: (row: ConfigListRows[K]) => string;
  label: (row: ConfigListRows[K]) => string;
  /** The hotel's today, for the date picker (holidays). */
  today?: string;
}

const span = (n?: 1 | 2 | 3) =>
  n === 3 ? 'col-span-3' : n === 2 ? 'col-span-2' : 'col-span-3 sm:col-span-1';

/**
 * A Configuration list — Holidays, Guest attributes, Discounts, Remarks, Payouts (owner brief,
 * 2026-09-26): the rows in a grid, an entry opened in a side sheet to edit, a trash button to
 * delete with a confirmation that says what follows. One component, so the five read alike.
 */
export function SimpleList<K extends ConfigListKey, D extends Record<string, unknown>>(
  props: SimpleListProps<K, D>,
) {
  const qc = useQueryClient();
  const { list, propertyId, canEdit, noun } = props;
  const queryKey = ['config', 'list', list, propertyId ?? 'tenant'];
  const rows = useQuery({
    queryKey,
    queryFn: () => listConfigRows(list, propertyId),
    // A list kept per property waits for the property.
    enabled: list === 'holidays' || list === 'discounts' ? Boolean(propertyId) : true,
  });
  const [draft, setDraft] = React.useState<(D & { id?: string }) | null>(null);
  const [deleting, setDeleting] = React.useState<ConfigListRows[K] | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['config'] });
    // Holidays are marked on Stay View and the rates calendar.
    if (list === 'holidays') qc.invalidateQueries({ queryKey: ['holidays'] });
  };
  const save = useMutation({
    mutationFn: (d: D & { id?: string }) =>
      d.id
        ? updateConfigRow(list, d.id, props.toBody(d, true))
        : createConfigRow(list, props.toBody(d, false), propertyId),
    onSuccess: (_, d) => {
      toast.success(d.id ? `The ${noun} is saved` : `The ${noun} is added`);
      setDraft(null);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (row: ConfigListRows[K]) => deleteConfigRow(list, (row as { id: string }).id),
    onSuccess: (_, row) => {
      toast.success(`${props.label(row)} is deleted`);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const set = (key: string, value: unknown) =>
    setDraft((d) => (d ? ({ ...d, [key]: value } as D & { id?: string }) : d));

  return (
    <div>
      {canEdit && (
        <div className="mb-3 flex justify-end">
          <Button onClick={() => setDraft({ ...props.blank })}>
            <Plus size={16} aria-hidden /> Add {noun}
          </Button>
        </div>
      )}
      <Card className="overflow-hidden">
        <DataGrid
          data={(rows.data ?? []) as ConfigListRows[K][]}
          columns={props.columns}
          loading={rows.isLoading}
          rowKey={(r) => (r as { id: string }).id}
          onRowClick={(r) => setDraft({ ...props.fromRow(r), id: (r as { id: string }).id })}
          emptyTitle={`No ${noun}s yet`}
          emptyDescription={props.emptyDescription}
          emptyAction={
            canEdit ? (
              <Button size="sm" onClick={() => setDraft({ ...props.blank })}>
                <Plus size={14} aria-hidden /> Add {noun}
              </Button>
            ) : undefined
          }
          rowActions={
            canEdit
              ? (r) => (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${props.label(r)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleting(r);
                    }}
                  >
                    <Trash size={16} aria-hidden />
                  </Button>
                )
              : undefined
          }
        />
      </Card>

      <Sheet open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        {draft && (
          <SheetContent
            title={draft.id ? `Edit ${noun}` : `New ${noun}`}
            description={props.sheetDescription}
            footer={
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                {canEdit && (
                  <Button
                    loading={save.isPending}
                    disabled={!props.valid(draft)}
                    onClick={() => save.mutate(draft)}
                  >
                    Save
                  </Button>
                )}
              </div>
            }
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (canEdit && props.valid(draft)) save.mutate(draft);
              }}
            >
              <fieldset disabled={!canEdit} className="grid grid-cols-3 gap-3">
                {props.fields.map((f) => {
                  const id = `${list}-${f.key}`;
                  const value = draft[f.key];
                  if (f.kind === 'switch')
                    return (
                      <div
                        key={f.key}
                        className="col-span-3 flex items-center justify-between gap-4 rounded-lg border border-line px-3 py-2.5"
                      >
                        <div>
                          <div className="text-sm font-medium text-ink">{f.label}</div>
                          {f.hint && <div className="text-xs text-ink-3">{f.hint}</div>}
                        </div>
                        <Switch
                          aria-label={f.label}
                          checked={Boolean(value)}
                          onCheckedChange={(v) => set(f.key, v)}
                        />
                      </div>
                    );
                  if (f.kind === 'color')
                    return (
                      <div key={f.key} className="col-span-3">
                        <div className="mb-1.5 text-sm font-medium text-ink-2">{f.label}</div>
                        <TagColorPicker
                          value={String(value ?? 'slate')}
                          onChange={(c) => set(f.key, c)}
                          disabled={!canEdit}
                        />
                      </div>
                    );
                  if (f.kind === 'select')
                    return (
                      <Field
                        key={f.key}
                        label={f.label}
                        hint={f.hint}
                        htmlFor={id}
                        className={span(f.span)}
                      >
                        <Select value={String(value ?? '')} onValueChange={(v) => set(f.key, v)}>
                          <SelectTrigger id={id} aria-label={f.label}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {f.options.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    );
                  const locked = Boolean(f.lockedOnEdit && draft.id);
                  return (
                    <Field
                      key={f.key}
                      label={f.label}
                      required={f.required}
                      hint={locked ? `${f.label} cannot change once saved` : f.hint}
                      htmlFor={id}
                      className={span(f.span)}
                    >
                      {f.kind === 'textarea' ? (
                        <Textarea
                          id={id}
                          rows={3}
                          maxLength={f.maxLength}
                          value={String(value ?? '')}
                          onChange={(e) => set(f.key, e.target.value)}
                        />
                      ) : f.kind === 'date' ? (
                        <DatePicker
                          id={id}
                          aria-label={f.label}
                          today={props.today ?? new Date().toISOString().slice(0, 10)}
                          value={(value as string) || null}
                          onChange={(v) => set(f.key, v)}
                        />
                      ) : (
                        <Input
                          id={id}
                          type={f.kind === 'number' ? 'number' : 'text'}
                          inputMode={f.kind === 'number' ? 'decimal' : undefined}
                          min={f.kind === 'number' ? 0 : undefined}
                          maxLength={f.maxLength}
                          disabled={locked}
                          className={
                            f.mono || f.kind === 'number' ? 'font-mono tabular-nums' : undefined
                          }
                          value={String(value ?? '')}
                          onChange={(e) => set(f.key, e.target.value)}
                        />
                      )}
                    </Field>
                  );
                })}
              </fieldset>
              <button type="submit" hidden aria-hidden tabIndex={-1} />
            </form>
          </SheetContent>
        )}
      </Sheet>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? `Delete ${props.label(deleting)}?` : 'Delete?'}
        description={deleting ? props.deleteConsequence(deleting) : undefined}
        confirmLabel="Delete"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </div>
  );
}
