# Cardiomen: Architecture Plan

A minimal tracker for walking, jogging and running, with a fully customizable share studio.
Same core flow as Google Fit, without the extras, and with more share control than Strava.

**Status:** in development, Android first. Last updated 2026-11-07. See "Where the build differs from this plan" below.

## The four big decisions

| # | Decision | Why |
|---|---|---|
| 1 | **Tracking runs in a small native engine (Kotlin / Swift), not in React Native JavaScript.** | The OS can stop JS at any time. A native foreground service writes GPS points straight to disk, so the UI can die without affecting the recording. |
| 2 | **Local-first with a durable on-device database. Not a cache.** | A cache can be thrown away. This database is the source of truth, and the server is a backup and sync target. The app tracks and shows history with no internet. |
| 3 | **Any interruption becomes a saved pause. Nothing ever ends the activity except you pressing Stop.** | This is your "even if the phone switches off" rule. See below. |
| 4 | **The share studio is a layered canvas (Skia) driven by a JSON document.** | Ratio, layers, colors, collage and filters are all just edits to that document, so options don't have to be hard-coded like in Google Fit. |

## Your question: "cache system or no?"

**No cache for activity data.** The write path is:

```
GPS / step sensor → Native engine → tracking.db (SQLite, fsync every 3 s)
                                          │  on Stop, atomic and repeatable import
                                          ▼
                                     app.db (SQLite) → all screens read from here
                                          │  background outbox with safe retries
                                          ▼
                              Next.js API → Neon Postgres (backup and multi-device)
```

The only real caches are map tiles and rendered share previews. Both can be lost without losing any data.

## "Zero failure": what it honestly means

No software can record GPS on a phone that is off, or see satellites in a tunnel. So "zero failure" is defined as guarantees we can test:

| Guarantee | Target |
|---|---|
| A recorded activity is never lost by app crash, OS kill, reboot, or dead battery | Everything except, at most, the last ~3 seconds of points before the sudden stop |
| An interrupted activity is never ended automatically | 100%. It stays paused until you press Resume or Stop, even days later |
| Downtime is never counted as active time | Error of at most ~5 seconds per interruption |
| Internet, backend or login problems never affect tracking | Tracking makes zero network calls |
| Sync never duplicates or loses an activity | Client-generated IDs and idempotent writes |
| Screen off, other apps, calls, locked phone | Tracking continues without a gap (tested on your actual phone) |

**What cannot be guaranteed, and how the app responds:**

- **Phone off:** nothing can record. On restart the activity shows as paused, with a notification. You press Resume. The route shows a gap and that time isn't counted.
- **Force Stop in Android settings, or swiping the app away on iPhone:** the OS kills the app and it can't restart itself. The activity is safe and paused when you next open it.
- **Aggressive phone brands (Xiaomi, Oppo, Vivo, some Samsung settings):** they may kill even legitimate services. The app guides you through the battery settings, and we test on your device.
- **Poor GPS:** time and steps continue. Distance is a best effort, and the gap is drawn honestly.

The full list is in [07-reliability-and-testing.md](07-reliability-and-testing.md).

## Stack

| Layer | Choice |
|---|---|
| Mobile | React Native through Expo SDK 58 (RN 0.88) with dev builds, TypeScript, Expo Router |
| Tracking | Custom local Expo Module: Android foreground service, iOS CoreLocation + CoreMotion |
| Local DB | SQLite: native access for `tracking.db`, `expo-sqlite` + Drizzle for `app.db` |
| Map | MapLibre React Native + OpenFreeMap tiles (free, no API key) |
| Canvas and charts | React Native Skia, Victory Native XL |
| Backend | Next.js route handlers on Vercel |
| Database | Neon Postgres, Prisma 7 with the Neon adapter |
| Auth | Google Sign-In; email + password + OTP via Nodemailer; our own JWT + rotating refresh tokens |

## Documents

| File | Contents |
|---|---|
| [01-product-and-flows.md](01-product-and-flows.md) | Scope, screens, every user flow |
| [02-research-what-we-borrow.md](02-research-what-we-borrow.md) | What's publicly known about Strava, Google Fit and Apple, and what we take or skip |
| [03-system-architecture.md](03-system-architecture.md) | Whole-system diagram, repo layout, modules, dependency rules |
| [04-tracking-engine.md](04-tracking-engine.md) | **The core.** State machine, zero-interruption design, power-off recovery |
| [05-data-and-sync.md](05-data-and-sync.md) | Local schemas, Prisma schema, sync protocol |
| [06-share-studio.md](06-share-studio.md) | Share customization: ratios, layers, colors, collage, filters, export |
| [07-reliability-and-testing.md](07-reliability-and-testing.md) | Failure table, test plan, monitoring |
| [08-backend-and-auth.md](08-backend-and-auth.md) | Auth flows, OTP, API list, security, environment variables |
| [09-roadmap.md](09-roadmap.md) | Build order, risky spikes first, exit criteria |

## Where the build differs from this plan

| Plan | Build | Why |
|---|---|---|
| pnpm, Drizzle, Victory Native, bottom-sheet library | npm workspaces, plain `expo-sqlite` with hand-written migrations, charts from plain views | Fewer dependencies, in line with the minimal brief |
| Delete wins over edits | Newest action wins, and an older delete still applies | Undo needs to work across sync. The failure direction is restoring an activity, never losing one |
| 30-second grace for reused refresh tokens | A retired token works until its replacement has been used | A phone offline for hours after a lost response shouldn't look like theft |
| `PATCH` and `DELETE /activities/{id}`, `DELETE /presets/{id}` | One idempotent `PUT` handles create, edit, delete and restore | Less code, and retries are always safe |
| `GET /map-style`, `GET /config` | Not built. Map styles are generated on the device | MapLibre accepts a style object. The tile source can't change without an app update for now |
| Engine records all pause reasons per plan | Each recording also stores its owner's account ID | One account's recording can never import into another |
| Verify sign-up with the code alone | `verify-otp` also needs the password | Otherwise anyone could pre-set the password on someone else's pending sign-up |
| Build from the project folder | Native builds run from a short mapped drive (`subst Z:`) | The C++ build hits the Windows path limit from the long project path |

**Not built yet:** iOS engine, CI, Sentry, background sync task, settings sync, battery brand guide, studio snap guides, map in a collage cell. The 30-day reliability run hasn't started.

## Assumptions to confirm

I chose defaults so the plan is complete. Each one is cheap to change now and more expensive later.

1. **Heatmap means a calendar heatmap** (GitHub-style squares, one per day, showing days you were active). You wrote "activities tracked there", which could instead mean a geographic map of where you go. If that's what you meant, the home screen design changes, though the data already supports it.
2. **Android first, iOS second.** You develop on Windows and iOS builds need EAS cloud plus a paid Apple account ($99/year) to test on a real iPhone. The architecture covers both.
3. **Personal use first, not a public launch.** If you publish later, see the store checklist in [09-roadmap.md](09-roadmap.md). Sign in with Apple is the most likely extra requirement.
4. **No calories, heart rate, social feed, goals or wearables.** You asked for minimal.

## What I need from you later

- Neon connection strings: pooled and direct (two URLs, see [08-backend-and-auth.md](08-backend-and-auth.md))
- Google Cloud OAuth client IDs
- SMTP account for Nodemailer
- **Your phone's make and model.** It decides which battery-killer behavior we must test against.
