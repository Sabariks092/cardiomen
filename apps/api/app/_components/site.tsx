import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="wrap site-header-inner">
        <Link href="/" aria-label="Cardigo home">
          <Image src="/brand/logo-horizontal.png" alt="Cardigo" width={135} height={48} priority />
        </Link>
        <nav className="site-nav" aria-label="Main">
          <Link href="/#features">Features</Link>
          <Link href="/#use-cases">Use cases</Link>
          <Link href="/download" className="nav-cta">
            Get the app
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap site-footer-inner">
        <Image src="/brand/emblem.png" alt="" width={28} height={31} />
        <p>Cardigo. Your cardio. Your progress.</p>
        <nav aria-label="Footer">
          <Link href="/download">Android</Link>
          <Link href="/ios">iPhone</Link>
        </nav>
      </div>
    </footer>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </>
  );
}

export function AndroidIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
      <path d="M17.6 9.48l1.84-3.18a.38.38 0 00-.66-.38l-1.86 3.22a11.43 11.43 0 00-9.84 0L5.22 5.92a.38.38 0 10-.66.38L6.4 9.48A10.78 10.78 0 001 18h22a10.78 10.78 0 00-5.4-8.52zM7 15.25a1.25 1.25 0 111.25-1.25A1.25 1.25 0 017 15.25zm10 0A1.25 1.25 0 1118.25 14 1.25 1.25 0 0117 15.25z" />
    </svg>
  );
}

export function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
      <path d="M16.37 12.68c-.03-2.68 2.19-3.97 2.29-4.03a4.92 4.92 0 00-3.87-2.1c-1.65-.17-3.22.97-4.06.97s-2.13-.95-3.5-.92a5.19 5.19 0 00-4.38 2.66c-1.87 3.24-.48 8.04 1.34 10.67.89 1.29 1.95 2.73 3.34 2.68s1.84-.86 3.45-.86 2.07.86 3.48.84 2.36-1.31 3.24-2.61a11.53 11.53 0 001.47-3.02 4.67 4.67 0 01-2.8-4.28zM13.7 4.81a4.67 4.67 0 001.07-3.35 4.76 4.76 0 00-3.08 1.59 4.45 4.45 0 00-1.1 3.24 3.93 3.93 0 003.11-1.48z" />
    </svg>
  );
}
