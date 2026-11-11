import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AndroidIcon, AppleIcon, PageShell } from './_components/site';

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

const FEATURES: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: 'Tracking that keeps going',
    body: 'A native engine records your route with the screen off, the phone locked or other apps open. If the phone dies mid-run, you get a paused activity with your time and distance kept.',
    icon: icon(<><path d="M12 22s7-6.1 7-12a7 7 0 10-14 0c0 5.9 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></>),
  },
  {
    title: 'Walk, jog or run',
    body: 'Pick an activity and go. Live distance, time, pace and steps, with auto-pause when you stop and spoken updates at the distance you choose.',
    icon: icon(<path d="M3 12h4l3-8 4 16 3-8h4" />),
  },
  {
    title: 'Progress you can see',
    body: 'Charts for distance, duration and pace, a year-long activity heatmap, weekly consistency and personal records that update themselves.',
    icon: icon(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>),
  },
  {
    title: 'Goals and saved routes',
    body: 'Set a weekly distance, a number of active days or a first 5 km, and Cardigo tracks it for you. Save the routes you repeat and compare your times.',
    icon: icon(<><path d="M5 22V4M5 4h11l-2 4 2 4H5" /></>),
  },
  {
    title: 'A share studio, not a screenshot',
    body: 'Put your route outline over your own photos, choose from seven sizes for posts and stories, add filters and move every layer.',
    icon: icon(<><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="9" cy="9" r="2" /><path d="M21 16l-5-5L5 21" /></>),
  },
  {
    title: 'Private by default',
    body: 'Activities live on your phone first and work offline. Shared images can hide the first and last 200 m, so your home stays off the map.',
    icon: icon(<><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V7a4 4 0 018 0v3" /></>),
  },
];

const USE_CASES = [
  {
    title: 'The daily walker',
    body: 'Log your morning or evening walk in one tap and watch your weekly kilometres and active days add up.',
  },
  {
    title: 'The new runner',
    body: 'Start with a walk-jog mix, set a first 5 km goal, and let spoken pace updates keep you honest without looking at your phone.',
  },
  {
    title: 'The routine runner',
    body: 'Save your regular loops, compare times on the same route and spot your fastest splits and personal records.',
  },
  {
    title: 'The sharer',
    body: 'Turn a run into a story-ready image with your photo, route and stats, styled the way you want, in a couple of taps.',
  },
  {
    title: 'The privacy-minded',
    body: 'Keep everything on your phone, back up only if you sign in, and hide where your routes start and end before you share.',
  },
  {
    title: 'The commuter',
    body: 'Record a walk to work with the phone in your pocket. Calls, music and other apps don’t interrupt the recording.',
  },
];

export default function Home() {
  return (
    <PageShell>
      <section className="wrap hero">
        <div>
          <p className="eyebrow">Your cardio. Your progress.</p>
          <h1>Walk. Jog. Run. Nothing else.</h1>
          <p className="hero-lead">
            Cardigo is a focused tracker for walking, jogging and running. It records every route reliably, shows how
            you’re improving, and turns your activities into images worth sharing.
          </p>
          <div className="button-row">
            <Link href="/download" className="button button-primary">
              <AndroidIcon />
              Download for Android
            </Link>
            <Link href="/ios" className="button button-secondary">
              <AppleIcon />
              Use on iPhone
            </Link>
          </div>
          <p className="hero-note">Free. Android app, plus a web version you can add to your iPhone home screen.</p>
        </div>
        <div className="phone">
          <Image
            src="/brand/app-home.webp"
            alt="The Cardigo home screen, with walk, jog and run options and today's distance, duration and steps"
            width={560}
            height={1115}
            priority
          />
        </div>
      </section>

      <section id="features" className="wrap section">
        <div className="section-head">
          <p className="eyebrow">What Cardigo does</p>
          <h2>Everything you need for cardio, nothing you don’t</h2>
          <p>No feeds, no ads, no endless menus. Just the tools that help you move more and see it.</p>
        </div>
        <div className="grid">
          {FEATURES.map((f) => (
            <article key={f.title} className="card">
              <div className="icon-badge">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="use-cases" className="wrap section">
        <div className="section-head">
          <p className="eyebrow">Who it’s for</p>
          <h2>Made for the way you move</h2>
          <p>Whether you walk to clear your head or train for your next race, Cardigo fits around your day.</p>
        </div>
        <div className="grid">
          {USE_CASES.map((u, i) => (
            <article key={u.title} className="card case">
              <span className="case-number">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <h3>{u.title}</h3>
                <p>{u.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="wrap">
        <div className="cta-band">
          <div>
            <h2>Start your next walk with Cardigo</h2>
            <p>Get the Android app, or add the web version to your iPhone.</p>
          </div>
          <div className="button-row">
            <Link href="/download" className="button button-secondary">
              <AndroidIcon />
              Android
            </Link>
            <Link href="/ios" className="button button-outline">
              <AppleIcon />
              iPhone
            </Link>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
