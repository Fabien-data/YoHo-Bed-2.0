import * as React from 'react';

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 font-bold tracking-tight text-ink">
      <span
        className="relative inline-block rounded-lg"
        style={{
          width: size,
          height: size,
          background: 'linear-gradient(135deg, var(--brand), var(--teal))',
        }}
      >
        <span
          className="absolute rounded-full bg-surface"
          style={{ width: size * 0.3, height: size * 0.3, top: size * 0.26, right: size * 0.26 }}
        />
      </span>
      YoHoBed <span className="font-semibold text-ink-3">Extranet</span>
    </span>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
};
export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold px-4 py-2 transition disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
  const variants: Record<string, string> = {
    primary: 'bg-brand text-white hover:brightness-110 shadow-sm',
    secondary: 'bg-surface-2 text-ink border border-line-strong hover:border-ink-3',
    ghost: 'text-brand-ink hover:bg-[var(--brand-soft)]',
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function Card({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(20,22,31,0.05),0_8px_24px_rgba(20,22,31,0.06)] ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <input
        className="rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        {...props}
      />
    </label>
  );
}

type Tone = 'avail' | 'low' | 'closed' | 'brand' | 'muted';
const toneStyle: Record<Tone, { color: string; bg: string }> = {
  avail: { color: 'var(--avail-ink)', bg: 'var(--avail-soft)' },
  low: { color: 'var(--low-ink)', bg: 'var(--low-soft)' },
  closed: { color: 'var(--closed-ink)', bg: 'var(--closed-soft)' },
  brand: { color: 'var(--brand-ink)', bg: 'var(--brand-soft)' },
  muted: { color: 'var(--ink-2)', bg: 'var(--surface-2)' },
};
export function Pill({ tone = 'muted', children }: { tone?: Tone; children: React.ReactNode }) {
  const s = toneStyle[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{ color: s.color, background: s.bg }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
      {children}
    </span>
  );
}
