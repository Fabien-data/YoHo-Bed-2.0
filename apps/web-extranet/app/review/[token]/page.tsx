'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Star } from '@phosphor-icons/react';
import { getReviewInvite, submitReview, ApiError, type ReviewInviteInfo } from '@/lib/api';
import { longDate } from '@/lib/format';
import { Button, Field, Skeleton, Textarea, cn } from '@yohobed/ui';
import { AuthShell, AuthError } from '@/components/auth-shell';

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
    <AuthShell width="lg">
      {state === 'loading' && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {state === 'invalid' && (
        <>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            This review link isn&rsquo;t valid
          </h1>
          <p className="mt-2 text-sm text-ink-2">
            The link may be incomplete — try opening it again from your email.
          </p>
        </>
      )}

      {state === 'done' && (
        <>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Thank you!</h1>
          <p className="mt-2 text-sm text-ink-2">
            Your review{invite ? ` of ${invite.propertyName}` : ''} has been recorded. We hope to
            welcome you back soon.
          </p>
        </>
      )}

      {state === 'form' && invite && (
        <>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            How was your stay, {invite.guestName}?
          </h1>
          <p className="mt-2 text-sm text-ink-2">
            {invite.propertyName} · {longDate(invite.checkin)} → {longDate(invite.checkout)}
          </p>

          <div className="mt-5 flex items-center gap-1" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={`${n} star${n === 1 ? '' : 's'}`}
                onClick={() => setRating(n)}
                onMouseEnter={() => setHover(n)}
                className={cn(
                  'rounded-md p-0.5 transition duration-1 ease-smooth hover:scale-110',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass',
                  (hover || rating) >= n ? 'text-low' : 'text-line-strong',
                )}
              >
                <Star size={28} weight={(hover || rating) >= n ? 'fill' : 'regular'} />
              </button>
            ))}
            {rating > 0 && (
              <span className="ml-2 text-sm font-semibold text-ink-2">{rating}/5</span>
            )}
          </div>

          <div className="mt-4">
            <Field label="Tell us more (optional)">
              <Textarea
                className="min-h-[120px]"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={2000}
                placeholder="What did you enjoy? What could be better?"
              />
            </Field>
          </div>

          {error && (
            <div className="mt-3">
              <AuthError>{error}</AuthError>
            </div>
          )}

          <div className="mt-5">
            <Button className="w-full" onClick={submit} loading={busy}>
              {busy ? 'Submitting…' : 'Submit review'}
            </Button>
          </div>
        </>
      )}
    </AuthShell>
  );
}
