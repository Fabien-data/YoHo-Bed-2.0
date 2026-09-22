'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChatCircleText, X } from '@phosphor-icons/react';
import { Button, SegmentedControl, Textarea, toast } from '@yohobed/ui';
import { answerUxSurvey, describeError, getUxSurvey } from '@/lib/api';
import { track } from '@/lib/ux';

/** Never in the middle of arriving: the card waits until the person has been working a while. */
const SHOW_AFTER_MS = 60_000;

const SCALE = [
  { value: '1', label: '1', ariaLabel: 'Strongly disagree' },
  { value: '2', label: '2', ariaLabel: 'Disagree' },
  { value: '3', label: '3', ariaLabel: 'Neither agree nor disagree' },
  { value: '4', label: '4', ariaLabel: 'Agree' },
  { value: '5', label: '5', ariaLabel: 'Strongly agree' },
] as const;

/**
 * The pulse survey (UX-0): four statements from the industry's own PMS research, at most once a
 * quarter per person, so "the easiest PMS to learn" is a number we can check rather than a claim.
 * It is a small card in the corner, never a modal: work always comes first, and "Not now" is
 * respected for two weeks.
 */
export function PulseSurvey() {
  const [visible, setVisible] = React.useState(false);
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [comment, setComment] = React.useState('');

  const survey = useQuery({
    queryKey: ['ux-survey'],
    queryFn: getUxSurvey,
    staleTime: Infinity,
    retry: false,
  });
  const eligible = survey.data?.eligible === true;

  React.useEffect(() => {
    if (!eligible) return;
    const t = window.setTimeout(() => {
      setVisible(true);
      track({ kind: 'survey_shown' });
    }, SHOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [eligible]);

  const send = useMutation({
    mutationFn: () =>
      answerUxSurvey({
        answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, Number(v)])),
        comment: comment.trim() || undefined,
      }),
    onSuccess: () => {
      setVisible(false);
      toast.success('Thank you — this shapes what we build next.');
    },
    onError: (e) => toast.error(describeError(e, 'Your answers could not be sent')),
  });

  if (!visible || !survey.data) return null;
  const items = survey.data.items;
  const complete = items.every((i) => answers[i.key]);

  function notNow() {
    setVisible(false);
    track({ kind: 'survey_dismissed' });
  }

  return (
    <section
      aria-label="Quick feedback"
      className="fixed bottom-4 right-4 z-40 w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-4 shadow-overlay"
    >
      <div className="flex items-start gap-2">
        <ChatCircleText size={20} weight="duotone" className="mt-0.5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink">How is YoHoBed working for you?</h2>
          <p className="text-xs text-ink-3">
            1 = strongly disagree, 5 = strongly agree. About a minute.
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Not now" onClick={notNow}>
          <X size={16} />
        </Button>
      </div>

      <ol className="mt-3 space-y-3">
        {items.map((item) => (
          <li key={item.key}>
            <p className="mb-1 text-[13px] text-ink-2">{item.text}</p>
            <SegmentedControl
              aria-label={item.text}
              options={SCALE}
              value={(answers[item.key] ?? '') as (typeof SCALE)[number]['value']}
              onChange={(v) => setAnswers((a) => ({ ...a, [item.key]: v }))}
            />
          </li>
        ))}
      </ol>

      <Textarea
        className="mt-3"
        rows={2}
        maxLength={1000}
        placeholder="Anything slowing you down? (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />

      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={notNow}>
          Not now
        </Button>
        <Button
          size="sm"
          disabled={!complete}
          loading={send.isPending}
          onClick={() => send.mutate()}
        >
          Send
        </Button>
      </div>
    </section>
  );
}
