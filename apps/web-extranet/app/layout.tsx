import type { Metadata } from 'next';
import { ThemeScript } from '@/components/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'YoHoBed Extranet',
  description: 'Property management — rates, availability & bookings',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: ThemeScript sets data-theme before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeScript />
        {children}
      </body>
    </html>
  );
}
