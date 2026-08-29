'use client';

import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Textarea,
  toast,
} from '@yohobed/ui';
import {
  listTemplates,
  updateTemplate,
  listMessages,
  listLanguages,
  ApiError,
  type Template,
  type MessageLog,
  type Language,
} from '@/lib/api';

const PLACEHOLDERS = ['guestName', 'reference', 'amount', 'checkin', 'checkout', 'nights'];

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', hour12: false }).replace(',', '');
}

export default function CommsPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [messages, setMessages] = useState<MessageLog[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [selId, setSelId] = useState('');
  const [draft, setDraft] = useState({ subject: '', body: '' });
  const [openMsg, setOpenMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = templates.find((t) => t.id === selId) ?? null;

  async function load() {
    const [t, m, l] = await Promise.all([
      listTemplates().catch(() => [] as Template[]),
      listMessages().catch(() => [] as MessageLog[]),
      listLanguages().catch(() => [] as Language[]),
    ]);
    setTemplates(t);
    setMessages(m);
    setLanguages(l);
    setSelId((prev) => {
      const keep = t.find((x) => x.id === prev) ?? t[0];
      if (keep) setDraft({ subject: keep.subject, body: keep.body });
      return keep?.id ?? '';
    });
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  function select(id: string) {
    const t = templates.find((x) => x.id === id);
    if (t) {
      setSelId(id);
      setDraft({ subject: t.subject, body: t.body });
    }
  }

  async function save() {
    if (!selected) return;
    setBusy(true);
    try {
      await updateTemplate(selected.id, draft);
      await load();
      toast.success('Template saved.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Distribution"
        title="Messages & templates"
        description="Confirmation emails are generated from these templates when a booking is created. Edit the wording per language; guests and staff get in-app notifications too (the bell, top-right)."
        actions={
          <div className="flex gap-1.5">
            {languages.map((l) => (
              <Badge key={l.id} tone={l.isDefault ? 'brand' : 'muted'}>
                {l.code.toUpperCase()}
              </Badge>
            ))}
          </div>
        }
      />

      {/* Templates */}
      <section className="mt-6">
        <h2 className="text-lg font-bold tracking-tight text-ink">Templates</h2>
        <div className="mt-3 grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="flex flex-col gap-1.5">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => select(t.id)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition ${
                  selId === t.id
                    ? 'border-brand bg-brand-soft text-brand-ink'
                    : 'border-line text-ink-2 hover:border-ink-3'
                }`}
              >
                <Badge tone="muted">{t.language.toUpperCase()}</Badge>
                {t.key}
              </button>
            ))}
            {templates.length === 0 && <p className="text-sm text-ink-3">No templates.</p>}
          </div>

          <Card className="p-5">
            {selected ? (
              <>
                <Field label="Subject">
                  <Input
                    value={draft.subject}
                    onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
                  />
                </Field>
                <Field label="Body" className="mt-3">
                  <Textarea
                    className="min-h-[200px] font-mono leading-relaxed"
                    value={draft.body}
                    onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                  />
                </Field>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                    Placeholders:
                  </span>
                  {PLACEHOLDERS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setDraft((d) => ({ ...d, body: `${d.body}{{${p}}}` }))}
                      className="rounded-md bg-brand-soft px-2 py-0.5 font-mono text-xs font-semibold text-brand-ink"
                    >
                      {`{{${p}}}`}
                    </button>
                  ))}
                  <div className="flex-1" />
                  <Button onClick={() => void save()} loading={busy}>
                    Save template
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-ink-3">Select a template.</p>
            )}
          </Card>
        </div>
      </section>

      {/* Message log */}
      <section className="mt-8">
        <h2 className="text-lg font-bold tracking-tight text-ink">Outbound messages</h2>
        <Card className="mt-3 overflow-hidden">
          {messages.length === 0 ? (
            <EmptyState title="No messages sent yet." />
          ) : (
            <div className="flex flex-col">
              {messages.map((m) => (
                <div key={m.id} className="border-b border-line last:border-0">
                  <button
                    onClick={() => setOpenMsg((o) => (o === m.id ? null : m.id))}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-2"
                  >
                    <Badge
                      tone={
                        m.status === 'sent' ? 'avail' : m.status === 'failed' ? 'closed' : 'low'
                      }
                    >
                      {m.status}
                    </Badge>
                    <span className="text-sm font-semibold text-ink">{m.subject}</span>
                    <span className="font-mono text-xs text-ink-3">
                      {m.toAddress || 'no address'}
                    </span>
                    <div className="flex-1" />
                    <span className="font-mono text-[0.65rem] uppercase text-ink-3">
                      {m.channel} · {m.language}
                    </span>
                    <span className="font-mono text-xs text-ink-3">{when(m.createdAt)}</span>
                  </button>
                  {openMsg === m.id && (
                    <pre className="whitespace-pre-wrap border-t border-line bg-surface-2 px-5 py-4 font-mono text-xs leading-relaxed text-ink-2">
                      {m.body}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
