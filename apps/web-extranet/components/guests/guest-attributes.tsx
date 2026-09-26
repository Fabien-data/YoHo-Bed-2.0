'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PencilSimple } from '@phosphor-icons/react';
import {
  Button,
  Checkbox,
  Popover,
  PopoverContent,
  PopoverTrigger,
  TagChip,
  toast,
} from '@yohobed/ui';
import { getGuestAttributes, listConfigRows, setGuestAttributes } from '@/lib/api';
import { errorMessage } from '@/components/configuration/shared';

export const guestAttributesKey = (customerId: string) => ['guest-attributes', customerId] as const;

/**
 * Configuration → Guest attributes on a guest: the labels the hotel keeps about them — repeat
 * guest, allergy, no-smoking — shown on every stay, set with a tick.
 */
export function GuestAttributes({
  customerId,
  canEdit = true,
}: {
  customerId: string;
  canEdit?: boolean;
}) {
  const qc = useQueryClient();
  const mine = useQuery({
    queryKey: guestAttributesKey(customerId),
    queryFn: () => getGuestAttributes(customerId),
  });
  const all = useQuery({
    queryKey: ['config', 'list', 'guest-attributes', 'tenant'],
    queryFn: () => listConfigRows('guest-attributes'),
    staleTime: 60_000,
  });
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (open) setPicked((mine.data ?? []).map((a) => a.id));
  }, [open, mine.data]);
  const save = useMutation({
    mutationFn: () => setGuestAttributes(customerId, picked),
    onSuccess: (rows) => {
      qc.setQueryData(guestAttributesKey(customerId), rows);
      toast.success(rows.length ? 'Guest attributes saved' : 'Guest attributes cleared');
      setOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const choices = (all.data ?? []).filter((a) => a.active || picked.includes(a.id));
  if (!mine.data?.length && choices.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(mine.data ?? []).map((a) => (
        <TagChip key={a.id} color={a.color} title={a.description ?? undefined}>
          {a.name}
        </TagChip>
      ))}
      {canEdit && choices.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs">
              <PencilSimple size={12} aria-hidden />
              {mine.data?.length ? 'Attributes' : 'Add attributes'}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">
              Guest attributes
            </p>
            <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
              {choices.map((a) => (
                <li key={a.id}>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
                    <Checkbox
                      checked={picked.includes(a.id)}
                      onCheckedChange={(c) =>
                        setPicked((p) => (c === true ? [...p, a.id] : p.filter((x) => x !== a.id)))
                      }
                    />
                    <TagChip color={a.color}>{a.name}</TagChip>
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-end">
              <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
