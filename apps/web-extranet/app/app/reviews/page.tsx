'use client';

import { useEffect, useState } from 'react';
import { Star } from '@phosphor-icons/react';
import { Badge, Card, EmptyState, PageHeader } from '@yohobed/ui';
import { listReviews, type Review, type ReviewSummary } from '@/lib/api';
import { longDate } from '@/lib/format';

function Stars({ rating }: { rating: number }) {
  return (
    <span
      role="img"
      className="inline-flex items-center gap-0.5 text-low-ink"
      aria-label={`${rating} out of 5`}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          size={14}
          weight="fill"
          aria-hidden
          className={i < rating ? undefined : 'text-ink-3'}
        />
      ))}
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
      <PageHeader
        eyebrow="Guest"
        title="Guest reviews"
        description="Guests are invited to review their stay when you check them out. Reviews are collected through a single-use link in the check-out email."
      />

      {/* Per-property averages */}
      {summary.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-4">
          {summary.map((s) => (
            <Card key={s.propertyId} className="min-w-[220px] p-5">
              <div className="text-sm font-semibold text-ink-2">{s.propertyName}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight tabular-nums text-ink">
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
          <EmptyState title="No reviews yet" description="They arrive after guests check out." />
        ) : (
          <div className="flex flex-col">
            {reviews.map((r) => (
              <div key={r.id} className="border-b border-line px-5 py-4 last:border-0">
                <div className="flex flex-wrap items-center gap-3">
                  <Stars rating={r.rating} />
                  <span className="font-semibold text-ink">{r.guestName}</span>
                  <Badge tone="muted">{r.propertyName}</Badge>
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
