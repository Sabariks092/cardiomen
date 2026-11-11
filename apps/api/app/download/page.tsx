import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { AndroidIcon, PageShell } from '../_components/site';
import { ANDROID_RELEASE } from '../_lib/release';

export const metadata: Metadata = {
  title: 'Download for Android',
  description: `Download Cardigo ${ANDROID_RELEASE.version} for Android.`,
};

export default function Download() {
  return (
    <PageShell>
      <section className="wrap">
        <div className="page-head">
          <p className="eyebrow">Android</p>
          <h1>Download Cardigo</h1>
          <p>
            Cardigo for Android is installed directly from this page, not from the Play Store. The download is the
            official build, served from the Cardigo GitHub repository.
          </p>
        </div>

        <div className="card download-card">
          <Image src="/brand/emblem.png" alt="" width={64} height={70} />
          <div className="download-meta">
            <h2>Cardigo for Android</h2>
            <dl>
              <div>
                <dt>Version</dt>
                <dd>{ANDROID_RELEASE.version}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{ANDROID_RELEASE.sizeMb} MB</dd>
              </div>
              <div>
                <dt>Requires</dt>
                <dd>{ANDROID_RELEASE.minAndroid} or newer, 64-bit</dd>
              </div>
            </dl>
          </div>
          <a href={ANDROID_RELEASE.url} className="button button-primary" download>
            <AndroidIcon />
            Download APK
          </a>
        </div>

        <div className="two-col">
          <div className="card">
            <h2>How to install</h2>
            <ol className="steps">
              <li>
                <div>
                  <strong>Download the APK</strong>
                  <p>Tap Download APK on your Android phone. It saves to your Downloads folder.</p>
                </div>
              </li>
              <li>
                <div>
                  <strong>Open it</strong>
                  <p>Open the file from the download notification or your Files app.</p>
                </div>
              </li>
              <li>
                <div>
                  <strong>Allow the install</strong>
                  <p>
                    If Android asks, allow your browser or Files app to install unknown apps, then go back and tap
                    Install.
                  </p>
                </div>
              </li>
              <li>
                <div>
                  <strong>Open Cardigo</strong>
                  <p>Allow location when asked, so Cardigo can record your route.</p>
                </div>
              </li>
            </ol>
          </div>

          <div className="card">
            <h2>Good to know</h2>
            <ol className="steps">
              <li>
                <div>
                  <strong>Updating</strong>
                  <p>Install a newer version over the old one. Your activities stay on your phone.</p>
                </div>
              </li>
              <li>
                <div>
                  <strong>Keep tracking reliable</strong>
                  <p>
                    In Settings, set Cardigo’s battery use to unrestricted so your phone doesn’t stop a recording.
                  </p>
                </div>
              </li>
              <li>
                <div>
                  <strong>On an iPhone?</strong>
                  <p>
                    Use the web version instead. <Link href="/ios">See how to add it to your home screen</Link>.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
