import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import './globals.css';

const poppins = localFont({
  src: [
    { path: './fonts/Poppins-Regular.ttf', weight: '400' },
    { path: './fonts/Poppins-Medium.ttf', weight: '500' },
    { path: './fonts/Poppins-SemiBold.ttf', weight: '600' },
    { path: './fonts/Poppins-Bold.ttf', weight: '700' },
  ],
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://cardiomen.vercel.app'),
  title: { default: 'Cardigo: walk, jog and run tracker', template: '%s · Cardigo' },
  description:
    'Cardigo records your walks, jogs and runs reliably, even with the screen off, and turns them into progress you can see and share.',
};

export const viewport: Viewport = { themeColor: '#F4F4F4' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={poppins.className}>
      <body>{children}</body>
    </html>
  );
}
