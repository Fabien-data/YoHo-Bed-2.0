'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getReviewInvite, submitReview, ApiError, type ReviewInviteInfo } from '@/lib/api';
import { longDate } from '@/lib/format';
import { Button, Card, Logo } from '@/components/ui';
import { ThemeToggle } from '@/components/theme';

/** Public review form — reached from the single-use link in the check-out email. No login. */
export default function PublicReviewPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [invite, setInvite] = useState<ReviewInviteInfo | null>(null);
  const [state, setState] = useState<'loading' | 'form' | 'done' | 'invalid'>('loading');
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getReviewInvite(token)
      .then((info) => {
        setInvite(info);
        setState(info.used ? 'done' : 'form');
      })
      .catch(() => setState('invalid'));
  }, [token]);

  async function submit() {
    if (rating === 0) {
      setError('Pick a star rating first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await submitReview({ token, rating, comment: comment.trim() || undefined });
      setState('done');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <ThemeToggle floating />
      <div className="w-full max-w-lg">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <Card className="p-7">
          {state === 'loading' && <p className="text-center text-sm text-ink-3">Loading…</p>}

          {state === 'invalid' && (
            <>
              <h1 className="text-xl font-bold text-ink">This review link isn't valid</h1>
              <p className="mt-2 text-sm text-ink-2">
                The link may be incomplete — try opening it again from your email.
              </p>
            </>
          )}

          {state === 'done' && (
            <>
              <h1 className="text-xl font-bold text-ink">Thank you!</h1>
              <p className="mt-2 text-sm text-ink-2">
                Your review{invite ? ` of ${invite.propertyName}` : ''} has been recorded. We hope
                to welcome you back soon.
              </p>
            </>
          )}

          {state === 'form' && invite && (
            <>
              <h1 className="text-xl font-bold text-ink">How was your stay, {invite.guestName}?</h1>
              <p className="mt-2 text-sm text-ink-2">
                {invite.propertyName} · {longDate(invite.checkin)} → {longDate(invite.checkout)}
              </p>

              <div className="mt-5 flex items-center gap-1" onMouseLeave={() => setHover(0)}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    aria-label={`${n} star${n === 1 ? '' : 's'}`}
                    onClick={() => setRating(n)}
                    onMouseEnter={() => setHover(n)}
                    className="text-3xl transition"
                    style={{ color: (hover || rating) >= n ? '#f59e0b' : 'var(--line-strong)' }}
                  >
                    ★
                  </button>
                ))}
                {rating > 0 && (
                  <span className="ml-2 text-sm font-semibold text-ink-2">{rating}/5</span>
                )}
              </div>

              <label className="mt-4 flex flex-col gap-1.5">
                <span className="text-sm font-medium text-ink-2">Tell us more (optional)</span>
                <textarea
                  className="min-h-[120px] rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={2000}
                  placeholder="What did you enjoy? What could be better?"
                />
              </label>

              {error && (
                <p className="mt-3 text-sm font-semibold" style={{ color: 'var(--closed-ink)' }}>
                  {error}
                </p>
              )}

              <div className="mt-5">
                <Button className="w-full" onClick={submit} disabled={busy}>
                  {busy ? 'Submitting…' : 'Submit review'}
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
