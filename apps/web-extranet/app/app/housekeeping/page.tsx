'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, PageHeader } from '@yohobed/ui';
import { useActiveProperty } from '@/components/active-property';
import { todayISO } from '@/lib/format';
import {
  listCleaningTasks,
  listTeamMembers,
  setHousekeeping,
  subscribeRoomUpdates,
  updateCleaningTask,
  type CleaningTask,
} from '@/lib/api';
import { useTenantRole } from '@/lib/queries';

export default function HousekeepingTasksPage() {
  const { propertyId } = useActiveProperty();
  const role = useTenantRole();
  const qc = useQueryClient();
  const [date, setDate] = React.useState(todayISO);
  const [online, setOnline] = React.useState(true);
  const [message, setMessage] = React.useState('');
  const [filter, setFilter] = React.useState<'open' | 'all' | 'done'>('open');
  const manager = role === 'OWNER' || role === 'HOUSEKEEPING_SUPERVISOR';

  React.useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const tasks = useQuery({
    queryKey: ['cleaning-tasks', propertyId, date],
    queryFn: () => listCleaningTasks(propertyId!, date),
    enabled: !!propertyId && online,
    refetchInterval: online ? 15_000 : false,
  });
  const team = useQuery({
    queryKey: ['housekeeping-team'],
    queryFn: listTeamMembers,
    enabled: manager,
  });
  React.useEffect(() => {
    if (!propertyId || !online) return;
    const connection = subscribeRoomUpdates(propertyId, date, () => {
      void qc.invalidateQueries({ queryKey: ['cleaning-tasks', propertyId, date] });
    });
    return () => connection.abort();
  }, [propertyId, date, online, qc]);
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['cleaning-tasks', propertyId, date] }),
      qc.invalidateQueries({ queryKey: ['room-view'] }),
      qc.invalidateQueries({ queryKey: ['stayview'] }),
    ]);
  };
  const change = useMutation({
    mutationFn: ({
      task,
      body,
    }: {
      task: CleaningTask;
      body: Parameters<typeof updateCleaningTask>[1];
    }) => updateCleaningTask(task.id, body),
    onSuccess: async () => {
      await refresh();
      setMessage('Cleaning update saved.');
    },
    onError: (error) => setMessage(`Update failed: ${String(error)}`),
  });
  const inspect = useMutation({
    mutationFn: (task: CleaningTask) =>
      setHousekeeping(propertyId!, {
        roomUnitId: task.roomUnitId,
        date: task.date,
        status: 'inspected',
      }),
    onSuccess: async () => {
      await refresh();
      setMessage('Room inspected and ready.');
    },
    onError: (error) => setMessage(`Inspection failed: ${String(error)}`),
  });
  const visible = (tasks.data ?? []).filter(
    (task) =>
      filter === 'all' ||
      (filter === 'done'
        ? task.status === 'done'
        : task.status !== 'done' && task.status !== 'cancelled'),
  );
  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        eyebrow="Room operations"
        title="Housekeeping tasks"
        description="Assigned cleaning work and room readiness for the selected day."
      />
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-3">
        <label className="text-xs font-semibold text-ink-2">
          Work date
          <Input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="mt-1"
          />
        </label>
        <label className="text-xs font-semibold text-ink-2">
          Show
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as typeof filter)}
            className="mt-1 block rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm"
          >
            <option value="open">Open work</option>
            <option value="all">All tasks</option>
            <option value="done">Completed</option>
          </select>
        </label>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void tasks.refetch()}
          disabled={!online || tasks.isFetching}
        >
          Refresh
        </Button>
        <span
          className={`ml-auto text-xs font-semibold ${online ? 'text-avail-ink' : 'text-closed-ink'}`}
        >
          {online ? (tasks.isFetching ? 'Refreshing…' : 'Online') : 'Offline · updates unavailable'}
        </span>
      </div>
      {tasks.isError && (
        <Card className="p-4 text-sm text-closed-ink">
          Could not load cleaning tasks. Check the connection and retry.
        </Card>
      )}
      {message && (
        <p role="status" className="rounded-lg bg-surface-2 p-3 text-sm text-ink">
          {message}
        </p>
      )}
      {!tasks.isLoading && visible.length === 0 && !tasks.isError && (
        <Card className="p-5 text-sm text-ink-2">
          No {filter === 'open' ? 'open' : filter === 'done' ? 'completed' : ''} cleaning tasks for
          this day.
        </Card>
      )}
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {visible.map((task) => (
          <Card key={task.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-ink">
                  {task.code}
                  {task.displayName ? ` · ${task.displayName}` : ''}
                </h2>
                <p className="text-xs text-ink-3">
                  {task.floor ? `Floor ${task.floor} · ` : ''}
                  {task.kind.replaceAll('_', ' ')} · {task.guestName ?? 'No guest linked'}
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-1 text-xs font-bold ${task.rush ? 'bg-closed-soft text-closed-ink' : 'bg-surface-2 text-ink-2'}`}
              >
                {task.rush ? 'Priority' : task.status.replaceAll('_', ' ')}
              </span>
            </div>
            <p className="mt-2 text-xs text-ink-3">
              Assigned to: {task.assignedToName ?? 'Unassigned'} · Room:{' '}
              {task.roomReadiness ?? 'clean'}
            </p>
            {manager && (
              <label className="mt-2 block text-xs font-semibold text-ink-2">
                Assign to
                <select
                  value={task.assignedToUserId ?? ''}
                  disabled={!online || change.isPending}
                  onChange={(event) =>
                    change.mutate({ task, body: { assignedToUserId: event.target.value || null } })
                  }
                  className="mt-1 block w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {(team.data ?? [])
                    .filter(
                      (member) =>
                        member.status === 'active' &&
                        (member.role === 'HOUSEKEEPING_ATTENDANT' ||
                          member.role === 'HOUSEKEEPING_SUPERVISOR'),
                    )
                    .map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label className="mt-2 block text-xs font-semibold text-ink-2">
              Instructions
              <textarea
                key={`${task.id}-${task.notes ?? ''}`}
                defaultValue={task.notes ?? ''}
                disabled={!online || change.isPending}
                rows={2}
                maxLength={500}
                onBlur={(event) => {
                  const notes = event.target.value.trim();
                  if (notes !== (task.notes ?? '')) change.mutate({ task, body: { notes } });
                }}
                className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-sm"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              {task.status === 'queued' && (
                <Button
                  size="sm"
                  disabled={!online || change.isPending}
                  onClick={() => change.mutate({ task, body: { status: 'in_progress' } })}
                >
                  {change.isPending ? 'Saving…' : 'Start'}
                </Button>
              )}
              {task.status === 'in_progress' && (
                <Button
                  size="sm"
                  disabled={!online || change.isPending}
                  onClick={() => change.mutate({ task, body: { status: 'done' } })}
                >
                  {change.isPending ? 'Saving…' : 'Mark clean'}
                </Button>
              )}
              {task.status === 'done' && manager && task.roomReadiness !== 'inspected' && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!online || inspect.isPending}
                  onClick={() => inspect.mutate(task)}
                >
                  {inspect.isPending ? 'Saving…' : 'Inspect room'}
                </Button>
              )}
              {manager && task.status !== 'done' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!online || change.isPending}
                  onClick={() => change.mutate({ task, body: { rush: !task.rush } })}
                >
                  {task.rush ? 'Remove priority' : 'Mark priority'}
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
