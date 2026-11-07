# 07. Reliability and Testing

## Failure table

| # | Failure | Detection | Behavior | Result |
|---|---|---|---|---|
| 1 | Screen off / locked | n/a | Service continues | No gap |
| 2 | Call, camera, switching apps | n/a | Service continues | No gap |
| 3 | RN JS crash | Sentry | Native keeps recording. Screen rebuilds from `getSnapshot()` | No gap |
| 4 | Swipe app from recents (Android) | n/a | `stopWithTask=false`, service continues | No gap expected. Test on OEM phones |
| 5 | OS or OEM kills process | Dead-man alarm, service restart | Try to restart. If location is denied, saved pause | Gap or pause, data safe |
| 6 | Battery dies / power off, clean | `ACTION_SHUTDOWN` | Flush, then pause | Pause, ≤ ~3 s lost |
| 7 | Hard power loss | Checkpoint + boot ID at boot or launch | Closes at last checkpoint, then pause | Pause, ≤ ~3 s lost |
| 8 | Reboot | `BOOT_COMPLETED` | Saved pause + notification | Waits for Resume |
| 9 | Device hasn't been unlocked since boot | `BOOT_COMPLETED` waits until unlock | Runs after first unlock. Launch also recovers | Waits for Resume |
| 10 | Force Stop (Android) | Launch check | Nothing runs until launch, then paused | Pause, data safe |
| 11 | Task Manager "Stop" (Android 13+) | Launch check / dead-man | Same as kill | Pause, data safe |
| 12 | iOS force-quit | Dead-man notification, launch check | Paused at next launch | Pause, data safe |
| 13 | App updated during activity | `MY_PACKAGE_REPLACED` | Saved pause | Waits for Resume |
| 14 | Location permission revoked | Service health check | `permission_revoked` pause, notification | Pause, data safe |
| 15 | GPS turned off | Provider callback | Timer continues, warning shown | Distance gap only |
| 16 | No GPS signal | No fix timeout | Timer and steps continue, warning, dashed line | Distance gap only |
| 17 | Bad GPS jumps | Filter | Kept raw, rejected for distance | Accurate distance |
| 18 | Clock or time zone change | Monotonic clock | No effect | Accurate duration |
| 19 | Low storage | Check at arm; write failure caught | Warn at start. On a write failure, retry, keep buffering in memory, alert | Warn early |
| 20 | Notification dismissed | Delete intent | Reposted | No gap |
| 21 | Step sensor missing or denied | Sensor / permission check | Steps "—" | Rest unaffected |
| 22 | Step counter reset | Reading below baseline | Re-baseline | No negative or fake steps |
| 23 | Crash during import | Importer reruns | Idempotent by ID | No loss or duplicate |
| 24 | Upload response lost | Retry | Idempotent upsert | No duplicate |
| 25 | Neon asleep, cold start, or down | Timeout or 5xx | Backoff retry | Sync delayed |
| 26 | Login expired | 401, refresh fail | Local use continues, banner shown | Sync delayed |
| 27 | OpenFreeMap down | Tile errors | Route on plain background | No map background |
| 28 | SMTP down | Send error | "Couldn't send code, try again". OTP invalidated | Registration waits |
| 29 | Corrupted `app.db` | Integrity check on failure | Move aside, rebuild from server + engine retention. Tell user about anything unsynced | Rare, mostly recoverable |
| 30 | Phone lost or destroyed during an activity | n/a | That recording is lost; earlier ones are safe if synced | Accepted limit |

## Test layers

| Layer | What | When |
|---|---|---|
| Engine unit tests (JUnit / XCTest) | State machine, time calculation, GPS filter, step logic, recovery classification, shared fixtures | Every commit |
| JS unit tests (Vitest / Jest) | Importer, sync logic, stats queries, share-document logic, projection math | Every commit |
| API integration tests | All routes against a Neon test branch: auth, OTP, token rotation, upserts, retries | Every commit |
| Golden images | Render share documents, compare to approved images | Before releases |
| E2E (Maestro) | Register, track with mock GPS, stop, see in list, share | Before releases |
| Kill matrix on device | Below | Before releases that touch the engine |
| Field tests | Below | Before you rely on a release |

## Kill matrix (scripted with adb where possible)

Play a GPX route through a mock location app, then at minute 2 do the following. **Pass requires:** session recoverable, no lost finished data, correct state, active time accurate to ±5 seconds, and no duplicates after import.

```bash
adb shell am kill com.cardiomen.app                       # Kill process
adb shell am crash com.cardiomen.app                      # Simulated crash
adb shell am force-stop com.cardiomen.app                 # Force Stop
adb reboot                                                # Reboot
adb shell dumpsys deviceidle force-idle                   # Doze
adb shell am set-standby-bucket com.cardiomen.app rare    # Restricted standby
adb install -r app-release.apk                            # Update during activity
adb shell pm revoke com.cardiomen.app android.permission.ACCESS_FINE_LOCATION
```

Manual on device:

- Change the phone's clock and time zone during an activity
- Hold power and force off (no clean shutdown)
- Let battery run to 0
- Airplane mode through the entire activity
- Turn GPS off and on
- Swipe away app; swipe away notification
- Take a phone call; use the camera; navigate in Google Maps meanwhile
- Battery Saver on
- Fill storage until low

Run also while killed during each engine state: ARMED, ACTIVE, PAUSED, FINISHED, and mid-import.

## Field tests

| Test | Pass |
|---|---|
| Known 5 km route ×5, compared with a measured reference and Google Fit | Within ±2% in open sky |
| 3-hour session, screen off | No gaps, battery recorded |
| Phone in pocket during walk, jog and run | Steps within ±5% of a manual count over 500 steps |
| Dense buildings and tree cover | Plausible route; no big spikes |
| Standing still 10 minutes | Under ~20 m of phantom distance |
| **30 days of daily real use** | Zero lost activities. Every gap in diagnostics is explained |

The last one is the real test. It's what actually earns the word "reliable".

## Release gates

An engine change can't ship unless all of these hold:

1. Unit and fixture tests pass on both platforms
2. Kill matrix passes on your main phone
3. One real outdoor activity recorded on that build
4. `session` schema migration tested against a database from the previous version

Note the Android OS itself: re-run the kill matrix after a major Android update, as background rules change between versions.

## Monitoring

Keep it simple and privacy-preserving. **Never send GPS coordinates to monitoring tools.**

| Tool | Tracks |
|---|---|
| Sentry (mobile + API) | Crashes, native crashes, API exceptions |
| Vercel logs | Request errors, slow routes, structured logs without secrets |
| `GET /api/health` with free uptime monitor | API and DB reachable |
| In-app diagnostics | Engine events, gap counts, outbox status |

Add a small daily alert only if you find you need it: unsynced activity older than 7 days, shown inside the app.

## Backups and recovery on the server

- Neon's point-in-time restore. Check the retention window on your plan, as free plans have a short one.
- A weekly `pg_dump` from GitHub Actions to a private location, as an independent copy.
- Practice restoring once, because an untested backup is only a hope.
- The phone itself is also a full copy of your data, which is an extra benefit of local-first.
