import { Providers } from '@/components/providers';

/** The staff console gets the same client providers as the app: queries, tooltips and toasts. */
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
