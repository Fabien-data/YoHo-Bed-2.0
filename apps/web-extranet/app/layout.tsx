import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'YoHoBed Extranet',
  description: 'Property management — rates, availability & bookings',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
