import { allActivitiesLite } from '@/db/activities';
import { addNotification, computeActivityStats, getActivityStats, listGoals, markGoalAchieved } from '@/db/cardigo';
import { getDb, hasDb, notifyChange, write } from '@/db';
import { loadSettings } from '@/db/settings';
import { goalProgress, goalTitle, MIN_PACE_DISTANCE_M, summarize, inRange } from '@/lib/analytics';
import { averagePace, distanceValue, formatDuration, formatPace, TYPE_LABEL } from '@/lib/format';
import { addDays, startOfWeek, todayLocal } from '@/lib/stats';

const TOTAL_MILESTONES_KM = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const SEEDED_KEY = 'progressSeeded';

let running: Promise<void> | null = null;

/**
 * Looks for goals reached, new personal records, distance milestones and the weekly summary, and
 * adds each to Notifications once. Safe to run any number of times.
 */
export function evaluateProgress(): Promise<void> {
  if (!hasDb()) return Promise.resolve();
  if (running) return running;
  running = run()
    .catch((e) => console.warn('Progress check failed', e))
    .finally(() => {
      running = null;
    });
  return running;
}

async function run() {
  const settings = await loadSettings();
  const db = getDb();
  const seeded = !!(await db.getFirstAsync('SELECT 1 FROM sync_state WHERE key = ?', [SEEDED_KEY]));
  // The first check records what's already true without alerting, so an existing history doesn't
  // produce a burst of old news.
  const push = (enabled: boolean) => seeded && enabled;

  const list = await allActivitiesLite();
  const today = todayLocal();
  const units = settings.units;
  const u = units === 'mi' ? 'mi' : 'km';

  // Goals
  for (const g of await listGoals()) {
    if (g.paused) continue;
    const p = goalProgress(g, list, today, settings.weekStart);
    if (!p.done || g.achievedPeriod === p.periodKey) continue;
    await markGoalAchieved(g.id, p.periodKey);
    await addNotification(
      {
        kind: 'goal',
        dedupeKey: `goal:${g.id}:${p.periodKey}`,
        title: 'Goal achieved',
        body: `${goalTitle(g, units)}. Well done.`,
        activityId: null,
      },
      push(settings.notifyGoals),
    );
  }

  // Personal records, for the newest activity against everything before it.
  const [latest, ...earlier] = list;
  if (latest && earlier.length > 0) {
    const longest = Math.max(...earlier.map((a) => a.distanceM));
    if (latest.distanceM > longest && latest.distanceM >= 500) {
      await addNotification(
        {
          kind: 'record',
          dedupeKey: `record:distance:${latest.id}`,
          title: 'New longest activity',
          body: `${distanceValue(latest.distanceM, units).toFixed(2)} ${u} ${TYPE_LABEL[latest.type].toLowerCase()}. Your longest yet.`,
          activityId: latest.id,
        },
        push(settings.notifyRecords),
      );
    }
    const pace = latest.distanceM >= MIN_PACE_DISTANCE_M ? averagePace(latest.activeMs, latest.distanceM) : null;
    const earlierPaces = earlier
      .filter((a) => a.distanceM >= MIN_PACE_DISTANCE_M)
      .map((a) => averagePace(a.activeMs, a.distanceM))
      .filter((p): p is number => p != null);
    if (pace != null && earlierPaces.length > 0 && pace < Math.min(...earlierPaces)) {
      await addNotification(
        {
          kind: 'record',
          dedupeKey: `record:pace:${latest.id}`,
          title: 'New fastest pace',
          body: `${formatPace(pace, units)} /${u} average. Your fastest activity yet.`,
          activityId: latest.id,
        },
        push(settings.notifyRecords),
      );
    }
    if (latest.distanceM >= 1000) {
      const mine = (await getActivityStats(latest.id)) ?? (await computeActivityStats(latest.id));
      const best = await db.getFirstAsync<{ ms: number }>(
        `SELECT MIN(s.bestKmMs) AS ms FROM activity_stats s JOIN activities a ON a.id = s.activityId
         WHERE a.deletedAt IS NULL AND s.activityId != ? AND s.bestKmMs IS NOT NULL`,
        [latest.id],
      );
      if (mine?.bestKmMs && best?.ms && mine.bestKmMs < best.ms) {
        await addNotification(
          {
            kind: 'record',
            dedupeKey: `record:km:${latest.id}`,
            title: 'New fastest kilometre',
            body: `${formatDuration(mine.bestKmMs)} for 1 km.`,
            activityId: latest.id,
          },
          push(settings.notifyRecords),
        );
      }
    }
  }

  // Total distance milestones. Only the newest one crossed is pushed.
  const totalKm = list.reduce((n, a) => n + a.distanceM, 0) / 1000;
  const crossed = TOTAL_MILESTONES_KM.filter((km) => totalKm >= km);
  for (const km of crossed) {
    await addNotification(
      {
        kind: 'milestone',
        dedupeKey: `milestone:total:${km}`,
        title: `${km} km in total`,
        body: `You've covered ${km} km with Cardigo.`,
        activityId: null,
      },
      push(settings.notifyRecords) && km === crossed[crossed.length - 1],
    );
  }

  // Weekly summary for last week, once, if there was anything to summarize.
  const lastWeek = addDays(startOfWeek(today, settings.weekStart), -7);
  const lastWeekItems = inRange(list, lastWeek, addDays(lastWeek, 6));
  if (lastWeekItems.length > 0) {
    const s = summarize(lastWeekItems);
    await addNotification(
      {
        kind: 'weekly',
        dedupeKey: `weekly:${lastWeek}`,
        title: 'Your week in review',
        body: `${distanceValue(s.distanceM, units).toFixed(1)} ${u} over ${s.sessions} ${
          s.sessions === 1 ? 'activity' : 'activities'
        } on ${s.activeDays} ${s.activeDays === 1 ? 'day' : 'days'}, ${formatDuration(s.activeMs)} moving.`,
        activityId: null,
      },
      push(settings.notifyWeekly),
    );
  }

  notifyChange();
  if (!seeded) {
    await write('INSERT OR IGNORE INTO sync_state (key, value) VALUES (?, ?)', [SEEDED_KEY, '1']);
  }
}
