'use client';

import type { CatalogueGroup } from '@yohobed/domain';
import { Checkbox, cn } from '@yohobed/ui';

/**
 * Pick from a fixed catalogue — the property's or a room type's amenities — as ticks grouped the
 * way a guest reads them. Codes, not free text: the same amenity reads the same everywhere.
 */
export function CataloguePicker({
  groups,
  value,
  onChange,
  disabled,
  idPrefix,
}: {
  groups: CatalogueGroup[];
  value: string[];
  onChange: (codes: string[]) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const picked = new Set(value);
  const toggle = (code: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(code);
    else next.delete(code);
    // Catalogue order, so the saved list reads the same however it was ticked.
    onChange(groups.flatMap((g) => g.items.map((i) => i.code)).filter((c) => next.has(c)));
  };
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {groups.map((g) => {
        const count = g.items.filter((i) => picked.has(i.code)).length;
        return (
          <fieldset key={g.key} disabled={disabled} className="min-w-0">
            <legend className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-2">
              {g.label}
              {count > 0 && (
                <span className="rounded-full bg-brand-soft px-1.5 font-mono text-[11px] tabular-nums text-brand-ink">
                  {count}
                </span>
              )}
            </legend>
            <ul className="flex flex-col gap-1.5">
              {g.items.map((i) => {
                const id = `${idPrefix}-${i.code}`;
                const on = picked.has(i.code);
                return (
                  <li key={i.code}>
                    <label
                      htmlFor={id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm',
                        on ? 'text-ink' : 'text-ink-2',
                        disabled && 'cursor-default',
                      )}
                    >
                      <Checkbox
                        id={id}
                        checked={on}
                        onCheckedChange={(c) => toggle(i.code, c === true)}
                      />
                      {i.label}
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}
