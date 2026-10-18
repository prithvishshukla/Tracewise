import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Tracewise: know what breaks before your APIs do', template: '%s · Tracewise' },
  description:
    'Tracewise connects upstream API changes to the code that uses them, so teams can investigate deprecations before they become incidents.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg font-sans text-fg antialiased">{children}</body>
    </html>
  );
}
