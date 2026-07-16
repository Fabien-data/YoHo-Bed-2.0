'use client';

import { useEffect, useState } from 'react';
import { listReviews, type Review, type ReviewSummary } from '@/lib/api';
import { longDate } from '@/lib/format';
import { Card, Pill } from '@/components/ui';

function Stars({ rating }: { rating: number }) {
  return (
    <span
      className="font-mono text-sm tracking-tight"
      style={{ color: 'var(--amber-ink, #b45309)' }}
      aria-label={`${rating} out of 5`}
    >
      {'★'.repeat(rating)}
      <span className="text-ink-3">{'★'.repeat(5 - rating)}</span>
    </span>
  );
}

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [summary, setSummary] = useState<ReviewSummary[]>([]);

  useEffect(() => {
    listReviews()
      .then((r) => {
        setReviews(r.reviews);
        setSummary(r.summary);
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      <div className="mb-1.5 font-mono text-xs uppercase tracking-widest text-ink-3">
        Reputation
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-ink">Guest reviews</h1>
      <p className="mt-2 max-w-2xl text-base text-ink-2">
        Guests are invited to review their stay when you check them out. Reviews are collected
        through a single-use link in the check-out email.
      </p>

      {/* Per-property averages */}
      {summary.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-4">
          {summary.map((s) => (
            <Card key={s.propertyId} className="min-w-[220px] p-5">
              <div className="text-sm font-semibold text-ink-2">{s.propertyName}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums text-ink">
                  {s.average.toFixed(1)}
                </span>
                <Stars rating={Math.round(s.average)} />
              </div>
              <div className="mt-1 text-xs text-ink-3">
                {s.count} review{s.count === 1 ? '' : 's'}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="mt-6 overflow-hidden">
        {reviews.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-3">
            No reviews yet — they arrive after guests check out.
          </p>
        ) : (
          <div className="flex flex-col">
            {reviews.map((r) => (
              <div key={r.id} className="border-b border-line px-5 py-4 last:border-0">
                <div className="flex flex-wrap items-center gap-3">
                  <Stars rating={r.rating} />
                  <span className="font-semibold text-ink">{r.guestName}</span>
                  <Pill tone="muted">{r.propertyName}</Pill>
                  <span className="font-mono text-xs text-ink-3">{r.bookingReference}</span>
                  <span className="ml-auto font-mono text-xs text-ink-3">
                    {longDate(r.createdAt.slice(0, 10))}
                  </span>
                </div>
                {r.comment && (
                  <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-2">{r.comment}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
