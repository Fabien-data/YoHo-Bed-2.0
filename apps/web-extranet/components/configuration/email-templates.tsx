'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowCounterClockwise, EnvelopeSimple, Plus, Trash } from '@phosphor-icons/react';
import {
  EMAIL_TEMPLATES,
  emailTemplateSpec,
  isCustomCheckoutKey,
  renderTemplate,
  sampleVariables,
  unknownVariables,
} from '@yohobed/domain';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  DialogContent,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  Skeleton,
  Textarea,
  Tooltip,
  cn,
  toast,
} from '@yohobed/ui';
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  resetTemplate,
  updateTemplate,
  type Template,
} from '@/lib/api';
import { errorMessage } from './shared';

export const templatesKey = ['comms', 'templates'] as const;

const LANGUAGE: Record<string, string> = { en: 'English', si: 'Sinhala', ta: 'Tamil' };

/** The label a template is listed under: the catalogue's, or the hotel's own name. */
export function templateLabel(t: Pick<Template, 'key' | 'name' | 'language'>): string {
  const base = isCustomCheckoutKey(t.key)
    ? (t.name ?? 'Check-out email')
    : (emailTemplateSpec(t.key)?.label ?? t.key);
  return t.language === 'en' ? base : `${base} · ${LANGUAGE[t.language] ?? t.language}`;
}

/** The emails the editor shows: the ones the API sends, then the hotel's own check-out emails. */
function editable(all: Template[]): { starter: Template[]; own: Template[] } {
  const order = EMAIL_TEMPLATES.map((t) => t.key);
  const starter = all
    .filter((t) => t.channel === 'email' && order.includes(t.key))
    .sort(
      (a, b) =>
        order.indexOf(a.key) - order.indexOf(b.key) ||
        (a.language === 'en' ? -1 : b.language === 'en' ? 1 : a.language.localeCompare(b.language)),
    );
  const own = all
    .filter((t) => isCustomCheckoutKey(t.key))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  return { starter, own };
}

/**
 * Configuration → Email templates ("Email customization", owner brief 2026-09-26): the guest
 * emails in the hotel's own words — with only the variables each one is really sent with, a
 * preview as the guest reads it, and check-out emails of its own that the desk picks per
 * reservation.
 */
export function EmailTemplates({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: templatesKey, queryFn: listTemplates });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);

  const { starter, own } = editable(list.data ?? []);
  const all = [...starter, ...own];
  const selected = all.find((t) => t.id === selectedId) ?? all[0];

  if (list.isLoading) return <Skeleton className="h-96 w-full" />;
  if (list.isError) return <InlineAlert tone="error">{errorMessage(list.error)}</InlineAlert>;
  if (!selected)
    return (
      <EmptyState
        title="No email templates"
        description="Your starter emails are added when the property is set up. Ask YoHoBed support if they are missing."
      />
    );

  const item = (t: Template) => {
    const active = t.id === selected.id;
    return (
      <li key={t.id}>
        <button
          type="button"
          onClick={() => setSelectedId(t.id)}
          aria-current={active ? 'true' : undefined}
          className={cn(
            'flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm transition duration-1',
            active
              ? 'bg-brand-soft text-brand-ink'
              : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
          )}
        >
          <EnvelopeSimple size={16} aria-hidden className="mt-0.5 shrink-0" />
          <span className="min-w-0">
            <span className={cn('block truncate', active && 'font-semibold')}>
              {templateLabel(t)}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="Email templates" className="flex flex-col gap-4">
        <div>
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Guest emails
          </p>
          <ul className="flex flex-col gap-0.5">{starter.map(item)}</ul>
        </div>
        <div>
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Your check-out emails
          </p>
          {own.length ? (
            <ul className="flex flex-col gap-0.5">{own.map(item)}</ul>
          ) : (
            <p className="px-3 text-xs text-ink-3">
              None yet — add one for a VIP farewell or a corporate thank-you.
            </p>
          )}
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              className="mx-3 mt-2"
              disabled={own.length >= 20}
              onClick={() => setAdding(true)}
            >
              <Plus size={14} aria-hidden /> Add a check-out email
            </Button>
          )}
        </div>
      </nav>
      <TemplateEditor
        key={`${selected.id}:${selected.updatedAt ?? ''}`}
        template={selected}
        canEdit={canEdit}
        onDeleted={() => setSelectedId(null)}
      />
      {adding && (
        <AddCheckoutEmail
          base={starter.find((t) => t.key === 'checkout_thank_you' && t.language === 'en')}
          onClose={() => setAdding(false)}
          onAdded={(t) => {
            qc.invalidateQueries({ queryKey: templatesKey });
            setSelectedId(t.id);
          }}
        />
      )}
    </div>
  );
}

function TemplateEditor({
  template,
  canEdit,
  onDeleted,
}: {
  template: Template;
  canEdit: boolean;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const custom = isCustomCheckoutKey(template.key);
  const spec = emailTemplateSpec(template.key);
  const [name, setName] = React.useState(template.name ?? '');
  const [subject, setSubject] = React.useState(template.subject);
  const [body, setBody] = React.useState(template.body);
  const [resetting, setResetting] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const subjectRef = React.useRef<HTMLInputElement>(null);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const lastField = React.useRef<'subject' | 'body'>('body');

  const refresh = () => qc.invalidateQueries({ queryKey: templatesKey });
  const save = useMutation({
    mutationFn: () =>
      updateTemplate(template.id, {
        subject: subject.trim(),
        body,
        ...(custom ? { name: name.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success(`${custom ? name.trim() : templateLabel(template)} is saved`, {
        description: 'Guests get the new wording from the next email on.',
      });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reset = useMutation({
    mutationFn: () => resetTemplate(template.id),
    onSuccess: () => {
      toast.success(`${templateLabel(template)} is back to the starter text`);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => deleteTemplate(template.id),
    onSuccess: () => {
      toast.success(`${template.name ?? 'The check-out email'} is deleted`, {
        description: 'Reservations that chose it get the standard thank-you.',
      });
      onDeleted();
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const dirty =
    subject !== template.subject ||
    body !== template.body ||
    (custom && name.trim() !== (template.name ?? ''));
  const unknown = unknownVariables(template.key, `${subject}\n${body}`);
  const valid = subject.trim().length > 0 && body.trim().length > 0 && (!custom || name.trim());
  const vars = sampleVariables(template.key);

  /** Put `{{name}}` where the cursor was, in the field last typed in. */
  const insert = (variable: string) => {
    const token = `{{${variable}}}`;
    const target = lastField.current === 'subject' ? subjectRef.current : bodyRef.current;
    const value = lastField.current === 'subject' ? subject : body;
    const setter = lastField.current === 'subject' ? setSubject : setBody;
    const start = target?.selectionStart ?? value.length;
    const end = target?.selectionEnd ?? value.length;
    setter(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      target?.focus();
      target?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="flex min-w-0 flex-col gap-4 p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-ink">{templateLabel(template)}</h3>
            {custom && <Badge tone="brass">Your own</Badge>}
          </div>
          {spec && (
            <p className="mt-1 text-sm text-ink-3">
              <span className="font-medium text-ink-2">Sent: </span>
              {custom
                ? 'At check-out, when the desk picks this email under “Send email at check-out” on the reservation.'
                : spec.when}
            </p>
          )}
        </div>
        <fieldset disabled={!canEdit} className="flex flex-col gap-4">
          {custom && (
            <Field
              label="Name"
              required
              htmlFor="tpl-name"
              hint="What the desk sees when choosing it."
            >
              <Input
                id="tpl-name"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          )}
          <Field label="Subject" required htmlFor="tpl-subject">
            <Input
              id="tpl-subject"
              ref={subjectRef}
              value={subject}
              maxLength={200}
              onFocus={() => (lastField.current = 'subject')}
              onChange={(e) => setSubject(e.target.value)}
            />
          </Field>
          <Field label="Message" required htmlFor="tpl-body">
            <Textarea
              id="tpl-body"
              ref={bodyRef}
              rows={14}
              maxLength={5000}
              className="leading-relaxed"
              value={body}
              onFocus={() => (lastField.current = 'body')}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          {spec && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-2">
                Insert a detail — it is filled in for each guest:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {spec.variables.map((v) => (
                  <Tooltip key={v.name} label={`{{${v.name}}} — e.g. ${v.sample.split('\n')[0]}`}>
                    <button
                      type="button"
                      onClick={() => insert(v.name)}
                      className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-2 transition duration-1 hover:border-brass hover:text-ink disabled:opacity-50"
                    >
                      {v.label}
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}
          {unknown.length > 0 && (
            <InlineAlert tone="warn">
              {unknown.map((u) => `{{${u}}}`).join(', ')} {unknown.length === 1 ? 'is' : 'are'} not
              sent with this email, so {unknown.length === 1 ? 'it' : 'they'} would come out empty.
              Use the details above instead.
            </InlineAlert>
          )}
        </fieldset>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            {custom ? (
              <Button variant="ghost" onClick={() => setDeleting(true)}>
                <Trash size={15} aria-hidden /> Delete
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setResetting(true)}>
                <ArrowCounterClockwise size={15} aria-hidden /> Reset to the starter text
              </Button>
            )}
            <div className="flex-1" />
            {dirty && (
              <Button
                variant="outline"
                onClick={() => {
                  setName(template.name ?? '');
                  setSubject(template.subject);
                  setBody(template.body);
                }}
              >
                Discard changes
              </Button>
            )}
            <Button
              loading={save.isPending}
              disabled={!dirty || !valid}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
          </div>
        )}
      </Card>

      <section aria-label="Preview" className="min-w-0">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Preview · with sample details
        </p>
        <Card className="overflow-hidden">
          <div className="border-b border-line bg-surface-2 px-4 py-3">
            <p className="text-xs text-ink-3">To: {vars.guestName ?? 'the guest'}</p>
            <p className="mt-0.5 text-sm font-semibold text-ink">
              {renderTemplate(subject, vars) || '(no subject)'}
            </p>
          </div>
          <div className="whitespace-pre-wrap break-words px-4 py-4 text-sm leading-relaxed text-ink-2">
            {renderTemplate(body, vars) || '(empty)'}
          </div>
          {template.key === 'booking_voucher' && (
            <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
              The voucher PDF is attached.
            </p>
          )}
        </Card>
      </section>

      <ConfirmDialog
        open={resetting}
        onOpenChange={setResetting}
        title={`Reset ${templateLabel(template)}?`}
        description="Its subject and message go back to the text every hotel starts with. Your wording is lost."
        confirmLabel="Reset"
        cancelLabel="Keep mine"
        onConfirm={() => reset.mutate()}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${template.name ?? 'this check-out email'}?`}
        description="Reservations that chose it get the standard thank-you at check-out instead. This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

function AddCheckoutEmail({
  base,
  onClose,
  onAdded,
}: {
  base: Template | undefined;
  onClose: () => void;
  onAdded: (t: Template) => void;
}) {
  const [name, setName] = React.useState('');
  const add = useMutation({
    mutationFn: () =>
      createTemplate({
        name: name.trim(),
        subject: base?.subject ?? 'Thank you for staying at {{propertyName}}',
        body:
          base?.body ??
          'Dear {{guestName}},\n\nThank you for staying with us ({{checkin}} → {{checkout}}).\n\n{{propertyName}}',
      }),
    onSuccess: (t) => {
      toast.success(`${t.name ?? 'The check-out email'} is added`, {
        description: 'It starts from your thank-you — word it your way, then save.',
      });
      onAdded(t);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Add a check-out email"
        description="The desk can pick it on a reservation, under “Send email at check-out”."
      >
        <form
          className="flex flex-col gap-4 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) add.mutate();
          }}
        >
          <Field
            label="Name"
            required
            htmlFor="new-tpl-name"
            hint="e.g. VIP farewell, Corporate thank-you"
          >
            <Input
              id="new-tpl-name"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={add.isPending} disabled={!name.trim()}>
              Add
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
