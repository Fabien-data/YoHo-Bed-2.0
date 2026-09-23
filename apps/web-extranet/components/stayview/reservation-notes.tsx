'use client';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, toast } from '@yohobed/ui';
import { addBookingRemark, getBookingRemarks, getBookingTasks, describeError } from '@/lib/api';

export function ReservationNotes({
  bookingId,
  editable,
}: {
  bookingId: string;
  editable: boolean;
}) {
  const [text, setText] = React.useState('');
  const qc = useQueryClient();
  const notes = useQuery({
    queryKey: ['booking-remarks', bookingId],
    queryFn: () => getBookingRemarks(bookingId),
  });
  const tasks = useQuery({
    queryKey: ['booking-tasks', bookingId],
    queryFn: () => getBookingTasks(bookingId),
  });
  const add = useMutation({
    mutationFn: () => addBookingRemark(bookingId, { type: 'general', text: text.trim() }),
    onSuccess: () => {
      setText('');
      void notes.refetch();
      void qc.invalidateQueries({ queryKey: ['stayview'] });
      toast.success('Note added');
    },
  });
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-ink">Notes and preparation</h3>
      {notes.isLoading && <p className="text-xs text-ink-3">Loading notes…</p>}
      {notes.isError && (
        <p role="alert" className="text-sm text-closed-ink">
          {describeError(notes.error, 'Notes could not load')}
        </p>
      )}
      {notes.data?.map((note) => (
        <p key={note.id} className="rounded-lg bg-surface-2 p-2 text-sm">
          <span className="text-xs font-semibold text-ink-3">{note.type} · </span>
          {note.text}
        </p>
      ))}
      {notes.data?.length === 0 && (
        <p className="text-xs text-ink-3">No notes for this reservation.</p>
      )}
      {tasks.data?.map((task) => (
        <p key={task.id} className="text-xs text-ink-2">
          {task.title} · {task.status}
          {task.deadline ? ` · ${task.deadline.slice(0, 10)}` : ''}
        </p>
      ))}
      {tasks.isError && (
        <p role="alert" className="text-sm text-closed-ink">
          {describeError(tasks.error, 'Preparation tasks could not load')}
        </p>
      )}
      {editable && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            add.mutate();
          }}
        >
          <Input
            aria-label="Reservation note"
            value={text}
            maxLength={1000}
            onChange={(event) => setText(event.target.value)}
            placeholder="Add an operational note"
          />
          <Button size="sm" className="shrink-0" disabled={!text.trim() || add.isPending}>
            {add.isPending ? 'Saving…' : 'Add note'}
          </Button>
        </form>
      )}
      {add.isError && (
        <p role="alert" className="text-sm text-closed-ink">
          {describeError(add.error, 'Note was not saved')}
        </p>
      )}
    </section>
  );
}
