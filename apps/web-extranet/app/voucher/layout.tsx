import type { Metadata } from 'next';

/**
 * The guest booking page is reached only from its own link. It is never indexed: the API sends
 * `X-Robots-Tag: noindex` with the data, and this says the same to a crawler that finds the page.
 */
export const metadata: Metadata = {
  title: 'Your booking',
  robots: { index: false, follow: false, nocache: true },
};

export default function VoucherLayout({ children }: { children: React.ReactNode }) {
  return children;
}
