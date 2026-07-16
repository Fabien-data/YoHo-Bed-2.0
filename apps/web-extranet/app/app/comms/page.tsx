'use client';

import { useEffect, useState } from 'react';
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
import { Button, Card, Field, Pill } from '@/components/ui';

const inputClass =
  'rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand';

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
  const [msg, setMsg] = useState<{ tone: 'avail' | 'closed'; text: string } | null>(null);

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
      setMsg(null);
    }
  }

  async function save() {
    if (!selected) return;
    setBusy(true);
    setMsg(null);
    try {
      await updateTemplate(selected.id, draft);
      await load();
      setMsg({ tone: 'avail', text: 'Template saved.' });
    } catch (e) {
      setMsg({ tone: 'closed', text: e instanceof ApiError ? e.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-1.5 font-mono text-xs uppercase tracking-widest text-ink-3">
        Communications
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-ink">Messages &amp; templates</h1>
        <div className="flex gap-1.5">
          {languages.map((l) => (
            <Pill key={l.id} tone={l.isDefault ? 'brand' : 'muted'}>
              {l.code.toUpperCase()}
            </Pill>
          ))}
        </div>
      </div>
      <p className="mt-2 max-w-2xl text-base text-ink-2">
        Confirmation emails are generated from these templates when a booking is created. Edit the
        wording per language; guests and staff get in-app notifications too (the bell, top-right).
      </p>

      {msg && (
        <div
          className="mt-5 rounded-xl px-4 py-3 text-sm font-semibold"
          style={{
            color: msg.tone === 'avail' ? 'var(--avail-ink)' : 'var(--closed-ink)',
            background: msg.tone === 'avail' ? 'var(--avail-soft)' : 'var(--closed-soft)',
          }}
        >
          {msg.text}
        </div>
      )}

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
                    ? 'border-brand text-brand-ink'
                    : 'border-line text-ink-2 hover:border-ink-3'
                }`}
                style={selId === t.id ? { background: 'var(--brand-soft)' } : undefined}
              >
                <Pill tone="muted">{t.language.toUpperCase()}</Pill>
                {t.key}
              </button>
            ))}
            {templates.length === 0 && <p className="text-sm text-ink-3">No templates.</p>}
          </div>

          <Card className="p-5">
            {selected ? (
              <>
                <Field
                  label="Subject"
                  value={draft.subject}
                  onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
                />
                <label className="mt-3 flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-ink-2">Body</span>
                  <textarea
                    className={`${inputClass} min-h-[200px] font-mono leading-relaxed`}
                    value={draft.body}
                    onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                  />
                </label>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                    Placeholders:
                  </span>
                  {PLACEHOLDERS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setDraft((d) => ({ ...d, body: `${d.body}{{${p}}}` }))}
                      className="rounded-md px-2 py-0.5 font-mono text-xs font-semibold"
                      style={{ color: 'var(--brand-ink)', background: 'var(--brand-soft)' }}
                    >
                      {`{{${p}}}`}
                    </button>
                  ))}
                  <div className="flex-1" />
                  <Button onClick={save} disabled={busy}>
                    {busy ? 'Saving…' : 'Save template'}
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
            <p className="p-8 text-center text-sm text-ink-3">No messages sent yet.</p>
          ) : (
            <div className="flex flex-col">
              {messages.map((m) => (
                <div key={m.id} className="border-b border-line last:border-0">
                  <button
                    onClick={() => setOpenMsg((o) => (o === m.id ? null : m.id))}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--surface-2)]"
                  >
                    <Pill
                      tone={
                        m.status === 'sent' ? 'avail' : m.status === 'failed' ? 'closed' : 'low'
                      }
                    >
                      {m.status}
                    </Pill>
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
