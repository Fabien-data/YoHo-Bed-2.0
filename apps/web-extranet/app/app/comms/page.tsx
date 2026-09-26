'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Card, EmptyState, InlineAlert, PageHeader } from '@yohobed/ui';
import { listMessages, listLanguages, type MessageLog, type Language } from '@/lib/api';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', hour12: false }).replace(',', '');
}

export default function CommsPage() {
  const [messages, setMessages] = useState<MessageLog[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [openMsg, setOpenMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      listMessages().catch(() => [] as MessageLog[]),
      listLanguages().catch(() => [] as Language[]),
    ])
      .then(([m, l]) => {
        setMessages(m);
        setLanguages(l);
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      <PageHeader
        eyebrow="Distribution"
        title="Guest messages"
        description="Every email sent to guests, and whether it arrived. Staff get in-app notifications too (the bell, top-right)."
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

      {/* The wording lives with the rest of the set-up (Configuration → Email templates). */}
      <InlineAlert tone="info" className="mt-6">
        The guest emails — the confirmation, the voucher, the check-out thank-you — are worded under{' '}
        <Link
          href="/app/configuration/email-templates"
          className="font-semibold text-info-ink underline"
        >
          Configuration → Email templates
        </Link>
        , with a preview and the details each one can include.
      </InlineAlert>

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
