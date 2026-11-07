# 09. Roadmap

**Order rule: risky things first.** The tracker and the map-share rendering are where this project could fail, so they get proven before any polish. Time ranges are rough estimates for one focused developer working with AI help. Real time depends on your hours and on what the spikes reveal.

## Phase 0: Spikes (1 to 2 weeks)

Throwaway code to answer questions that could change the plan.

| Spike | Question | If it fails |
|---|---|---|
| **S1. Engine** | Can a bare Expo dev build with a Kotlin foreground service record a 1-hour screen-off walk on your phone, write to SQLite, and survive kill, reboot and force-off? Does a `START_STICKY` restart regain location? Real battery and storage use? | Try the listed OEM settings. Last resort: Transistorsoft license |
| **S2. Windows pipeline** | Can you build and install through EAS and local Android Studio from Windows, including a local Expo Module with its manifest entries? | Fix the toolchain before anything else |
| **S3. Map image** | Does `StaticMapManager.createImage` work off-screen? Accept a generated style? Does a Skia route align perfectly? What pixel ratio does it use? How fast at 1080 × 1920? | Use the backend style endpoint, or duotone fallback. If `createImage` is unusable, capture a hidden MapView |
| **S4. Skia export** | Can an off-screen 2160 × 3840 image with 6 photos and filters export on your phone without running out of memory? | Lower the limits |

**Exit:** every spike has a written result, and this plan is updated.

## Phase 1: Foundations (1 week)

- Monorepo, `packages/contracts`, CI (typecheck, lint, tests)
- Next.js on Vercel, Prisma + Neon, first migration, `/health`, `/config`
- Expo app shell, navigation, theme, Sentry, EAS profiles
- `app.db` with migrations

**Exit:** dev build connects to a deployed API, migrations run from CI.

## Phase 2: Tracking engine, Android (2 to 3 weeks)

- Production engine from spike S1: state machine, storage, recovery, receivers, dead-man alarm, GPS filter, steps, notification
- Unit tests with shared fixtures
- Live tracking UI: map, start, countdown, stats, pause, hold to stop
- Summary, importer, a basic activity list

**Exit: the kill matrix passes on your phone, and you've used it for 5 real activities.** Nothing else starts until this passes. It's the entire reason the app exists.

## Phase 3: Home and activities (1 week)

- Heatmap, charts, filters, totals
- Activity detail, splits, edit, delete, undo
- Settings, battery guide, diagnostics, GPX export

**Exit:** the full app works with no account and no internet (auth gate temporarily off).

## Phase 4: Auth and sync (1 to 2 weeks)

- All auth routes, OTP, Nodemailer, Google Sign-In, token rotation
- Outbox, push, pull, restore after reinstall, per-user databases
- Account deletion

**Exit:**
- Airplane-mode activity syncs exactly once when back online
- Reinstall fully restores
- Network cut during upload makes no duplicates
- Integration tests pass

## Phase 5: Share studio (3 to 4 weeks)

Build in layers, each usable by itself:

1. Document model, renderer, ratios, background, export and share
2. Metrics layer: choose, color, move, fonts
3. Map and route layers, colors, themes, attribution, privacy trim
4. Photos, collage, gestures, filters
5. Layer management, undo, drafts, presets, golden image tests

**Exit:** you can reproduce every Google Fit format and a Strava-style overlay, at any ratio, and a design you save reapplies correctly to a new activity.

## Phase 6: Hardening (2 weeks, plus the 30 days running alongside)

- Full failure table run on your device
- Battery tuning, GPS threshold tuning from your recordings
- Accessibility and readability in sunlight
- Backup restore practice

**Exit: 30 days of daily use with zero lost activities.** Any failure resets this to a fix plus another pass.

## Phase 7: iOS (2 to 3 weeks)

Swift engine with the same contract and fixtures, then permissions, Google Sign-In config, and kill matrix for iOS.

Needs: Apple Developer account and a physical iPhone. Everything else is shared. Do it earlier if you use an iPhone as your main phone. **Tell me if that's the case, because then this phase swaps places with the Android engine.**

## Overall estimate

Roughly **3 to 4 months** for Android at a focused pace, plus the 30-day reliability run overlapping the end.

## Later, only if you want them

Each one is deliberately absent from the first version:

- Direct Instagram Stories sharing
- Writing activities to Health Connect / Apple Health
- GPX import
- Home-screen widget
- Offline map regions (OpenFreeMap allows up to 3,000 tiles or 50 MB per download)
- Geographic heatmap of your routes
- Audio cues

## If you publish to app stores

| Item | Store | Why |
|---|---|---|
| Foreground service location declaration, with a demo video | Google Play | Required for this permission type |
| Health apps declaration, data safety form | Google Play | Location and fitness data |
| Prominent disclosure and clear permission reasons | Both | Location |
| Privacy policy URL | Both | Required |
| In-app account deletion | Both | Already planned |
| **Sign in with Apple** | App Store | Likely required, since we offer Google login. Check guideline 4.8 before submitting |
| Justification for background location mode | App Store | Review will ask |
| Replace Gmail SMTP with a real provider | n/a | Volume and deliverability |
| Consider self-hosting tiles or a paid tile plan | n/a | OpenFreeMap has no SLA |

## Biggest risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Phone brand's battery manager kills the service | Medium, brand-dependent | S1 on your phone, guidance screen, saved pause as a safe fallback |
| Native engine bugs, since you're writing Kotlin and Swift | Medium | Small scope, fixtures, kill matrix. Transistorsoft fallback |
| Share studio grows too large | **High** | Phased delivery. Each layer ships separately |
| Map snapshot and route misalignment or style limits | Medium | S3 before commitment, with two fallbacks |
| OpenFreeMap reliability | Low to medium | `/config` makes the source swappable; maps are never required |
| Gmail SMTP blocks Vercel | Medium | Env-only switch to another SMTP provider |
| Expo or RN upgrade breaks native behavior | Medium | Pin versions. Rerun the kill matrix on upgrades |
| GPS accuracy disappoints compared with Google Fit | Medium | Raw points saved, so distances can be recalculated after tuning |
