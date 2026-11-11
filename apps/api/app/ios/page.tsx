import type { Metadata } from 'next';
import { AppleIcon, PageShell } from '../_components/site';
import { WEB_APP_URL } from '../_lib/release';

export const metadata: Metadata = {
  title: 'Use on iPhone',
  description: 'Add the Cardigo web version to your iPhone home screen.',
};

function ShareIcon() {
  return (
    <svg className="inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Share icon">
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M6 11H5a2 2 0 00-2 2v6a2 2 0 002 2h14a2 2 0 002-2v-6a2 2 0 00-2-2h-1" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-label="Add icon">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

export default function Ios() {
  const host = new URL(WEB_APP_URL).host;
  return (
    <PageShell>
      <section className="wrap">
        <div className="page-head">
          <p className="eyebrow">iPhone</p>
          <h1>Add Cardigo to your home screen</h1>
          <p>
            Cardigo isn’t on the App Store yet. On iPhone you can use the web version, and add it to your home screen so
            it opens like an app, with its own icon.
          </p>
        </div>

        <div className="two-col">
          <div className="card">
            <h2>Steps in Safari</h2>
            <ol className="steps">
              <li>
                <div>
                  <strong>Open the web version in Safari</strong>
                  <p>
                    On your iPhone, open <span className="url-chip">{host}</span> in Safari. Other browsers can’t add
                    it to the home screen on every iOS version, so Safari is the safest choice.
                  </p>
                </div>
              </li>
              <li>
                <div>
                  <strong>
                    Tap Share <ShareIcon />
                  </strong>
                  <p>It’s the square with an arrow, in the toolbar at the bottom of the screen (at the top on iPad).</p>
                </div>
              </li>
              <li>
                <div>
                  <strong>
                    Choose Add to Home Screen <PlusIcon />
                  </strong>
                  <p>Scroll down the share options if you don’t see it straight away.</p>
                </div>
              </li>
              <li>
                <div>
                  <strong>Tap Add</strong>
                  <p>Keep the name Cardigo, or change it, then tap Add in the top corner.</p>
                </div>
              </li>
              <li>
                <div>
                  <strong>Open Cardigo from your home screen</strong>
                  <p>Look for the Cardigo icon, then sign in with your email.</p>
                </div>
              </li>
            </ol>
            <div className="button-row" style={{ marginTop: 24 }}>
              <a href={WEB_APP_URL} className="button button-primary">
                <AppleIcon />
                Open the web version
              </a>
            </div>
          </div>

          <div className="card">
            <h2>What works on iPhone</h2>
            <ol className="steps">
              <li>
                <div>
                  <strong>Your activities and progress</strong>
                  <p>See your activity history, stats, charts and settings.</p>
                </div>
              </li>
              <li>
                <div>
                  <strong>Your account</strong>
                  <p>Sign in with the same email as on Android to see the activities you backed up.</p>
                </div>
              </li>
            </ol>
            <div className="notice">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16h.01" />
              </svg>
              <p>
                Recording routes, maps and the share studio need the Android app for now. A web browser can’t keep GPS
                running in the background the way Cardigo’s tracking engine does.
              </p>
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
