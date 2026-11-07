# 02. Research: What We Borrow

**Limit of this research:** the internal architectures of Google Fit, Strava and Apple Fitness are private, so nobody outside those companies can provide them in full. This page uses their public engineering posts, official platform docs and visible app behavior. Where something is an inference, it says so.

## Strava

**Publicly documented (Strava engineering blog):**

- Its Apple Watch recording framework is split into a **state machine** for recording states, a **writer** that saves activity data to the file system, and an **upload manager**.
- Upload is a **two-step process**: the file is sent, then the server rebuilds the activity from it. The client must handle failure at both steps.
- Its Android upload service manages a queue and schedules upload and status tasks.

**What we take:**

- The same three-part split: state machine, durable writer, upload queue
- Recording never depends on the upload succeeding
- Route over photo as the share format, and a transparent sticker overlay

**What we skip:** social graph, segments, global heatmap, asynchronous server-side processing. With one user and a clean payload, upload can be a single atomic request ([05-data-and-sync.md](05-data-and-sync.md)).

## Google Fit

**From Google's docs:** the Google Fit APIs are being deprecated in 2026. Google directs developers to Health Connect (on-device data) and the Recording API on mobile (step data).

**What we take:** your preferred flow (home with charts, + button, type, map, countdown, live stats), plus the on-device direction Google itself is moving toward.

**What we skip:** any integration with the Fit APIs. They're being retired, so building on them makes no sense. Writing activities to Health Connect is an optional later feature, not a dependency.

**What we fix (your complaint):** Google Fit offers fixed share combinations and no ratio control. Our share studio replaces this.

## Apple Fitness

**Visible behavior:** recording state survives app interruptions, and Fitness has calm activity summaries and rings.

**What we take:** the idea that the OS should treat a workout as a protected session. On iOS we achieve this with background location updates and `CLBackgroundActivitySession`.

**What we skip:** rings, trends, subscriptions.

## Platform facts that shaped the design

| Fact | Source | Effect on the design |
|---|---|---|
| Starting a `location` foreground service from the background needs a visible activity or a listed exemption. A notification interaction is an exemption; boot is not on the while-in-use exemption list | Android docs | Recovery uses "tap notification to resume". The app **doesn't** attempt to restart GPS after reboot, which also matches your rule |
| `location` isn't among the service types banned from `BOOT_COMPLETED` on Android 15, but the while-in-use rule above still applies | Android docs | Boot receiver only records state and posts a notification |
| A `START_STICKY` restart in the background isn't documented as an exemption, so GPS restart there likely fails on Android 12+ | My inference from Android docs. **Must be tested on a device** | Restart is attempted but never relied on. On failure, the activity becomes a saved pause |
| Developers report significant-location and region events no longer relaunching a force-quit app on iOS 26 | Apple forum thread, anecdotal and unconfirmed by Apple | iOS recovery doesn't depend on relaunch; it happens at next open, helped by a "dead-man" notification ([04-tracking-engine.md](04-tracking-engine.md)) |
| `react-native-background-geolocation` needs a paid license for release builds. I couldn't find its current price | Vendor docs | Custom engine is the primary plan, this is the fallback |
| MapLibre RN v11 is New Architecture only, has an Expo plugin, not usable in Expo Go, and offers `StaticMapManager.createImage` | MapLibre docs | Requires dev builds. The share map uses static images |
| OpenFreeMap is free, no key, no view limits, **no SLA**, attribution required, custom styles must be self-hosted | OpenFreeMap site | Map can never be a required dependency. Style URL is configurable. Attribution stays on shared images |
| Vercel blocks port 25 but leaves 465 and 587 open | Vercel docs | Nodemailer over 587 works |
| Prisma 7 with Neon: pooled URL through the adapter for the app, direct URL in `prisma.config.ts` for migrations | Neon guide | Two connection strings required |
| Expo SDK 58 (Oct 2026) targets React Native 0.88 and React 19.3 | Expo docs | Baseline versions, re-check when scaffolding |

## Options considered for the tracking layer

| Option | Reliability | Cost | Verdict |
|---|---|---|---|
| `expo-location` + background task | JS receives batches, so it depends on JS staying alive and doesn't handle your pause and recovery rules | Free | **Rejected** for the core recording |
| Transistorsoft background geolocation | Mature, handles its own storage | Paid license for release builds, closed native core | **Fallback** if the spike fails |
| Custom native engine | Full control over your exact recovery rules. We own the bugs | Free, more work | **Chosen** |

The custom engine is small: one service, one state machine, one small database, and no general-purpose geofencing. That's why it's realistic for one project.

## Sources

- [Strava: Apple Watch planning and overview](https://medium.com/strava-engineering/strava-for-apple-watch-planning-and-project-overview-3bbcfd3c60f)
- [Strava: A summer of Android](https://medium.com/strava-engineering/a-summer-of-android-33029fc5266e)
- [Google Fit migration FAQ](https://developer.android.com/health-and-fitness/health-connect/migration/fit/faq)
- [Health Connect migration guide](https://developer.android.com/guide/health-and-fitness/health-connect-guidelines/migrate/migration-guide)
- [Android 15 behavior changes](https://developer.android.com/about/versions/15/behavior-changes-15)
- [Android: restrictions on starting a foreground service from the background](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)
- [Apple forums: iOS 26 relaunch report](https://developer.apple.com/forums/thread/826964)
- [Apple forums: CLBackgroundActivitySession](https://developer.apple.com/forums/thread/810433)
- [Transistorsoft on npm](https://www.npmjs.com/package/react-native-background-geolocation)
- [Expo SDK reference](https://docs.expo.dev/versions/latest/)
- [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [MapLibre React Native](https://maplibre.org/maplibre-react-native/)
- [MapLibre StaticMapManager](https://maplibre.org/maplibre-react-native/docs/modules/static-map-manager)
- [OpenFreeMap](https://openfreemap.org/)
- [Vercel: serverless functions and SMTP](https://vercel.com/kb/guide/serverless-functions-and-smtp)
- [Nodemailer: using Gmail](https://nodemailer.com/usage/using-gmail)
- [Neon: Prisma guide](https://neon.com/docs/guides/prisma-migrate)
