import TrackingEngine, { ActivityType } from '@engine';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalQuery } from '@/db';
import { ActivitySort, allActivitiesLite, queryActivities, setDeleted } from '@/db/activities';
import { useSettings } from '@/db/settings';
import { formatDay } from '@/lib/format';
import { addDays, startOfWeek, todayLocal } from '@/lib/stats';
import { requestSync } from '@/sync/worker';
import {
  Button,
  colors,
  EmptyState,
  Enter,
  Field,
  fonts,
  LoadingState,
  Pills,
  RoundButton,
  Screen,
  Segmented,
  shadow,
  Sheet,
  space,
  T,
  Tap,
} from '@/ui';
import { AppBar } from '@/ui/appbar';
import { ActivityCard, TAB_BAR_SPACE, useOpenActivityPicker } from '@/ui/activity';

const TYPES = [
  { value: 'all', label: 'All' },
  { value: 'walk', label: 'Walk' },
  { value: 'jog', label: 'Jog' },
  { value: 'run', label: 'Run' },
] as const;

type DateFilter = 'any' | 'today' | 'week' | 'month' | 'custom';
const DATES = [
  { value: 'any', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom' },
] as const;

const SORTS: { value: ActivitySort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'longest', label: 'Longest distance' },
  { value: 'shortest', label: 'Shortest distance' },
  { value: 'fastest', label: 'Fastest pace' },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function Activities() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const openPicker = useOpenActivityPicker();
  const settings = useSettings();
  const params = useLocalSearchParams<{ date?: string }>();
  const [type, setType] = useState<ActivityType | 'all'>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('any');
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [sort, setSort] = useState<ActivitySort>('newest');
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [deletedView, setDeletedView] = useState(false);
  const [sortSheet, setSortSheet] = useState(false);
  const [rangeSheet, setRangeSheet] = useState(false);
  const [interrupted, setInterrupted] = useState<Set<string>>(new Set());

  // The engine's log knows which recordings were interrupted (phone off, app stopped).
  useFocusEffect(
    useCallback(() => {
      TrackingEngine.getEvents(500)
        .then((events) =>
          setInterrupted(
            new Set(
              events
                .filter((e) => e.kind === 'pause' && e.detail && e.detail !== 'user' && e.detail !== 'auto')
                .map((e) => e.sessionId),
            ),
          ),
        )
        .catch(() => undefined);
    }, []),
  );

  const today = todayLocal();
  const range = useMemo(() => {
    if (params.date) return { from: params.date, to: params.date };
    switch (dateFilter) {
      case 'today':
        return { from: today, to: today };
      case 'week': {
        const from = startOfWeek(today, settings.weekStart);
        return { from, to: addDays(from, 6) };
      }
      case 'month':
        return { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-31` };
      case 'custom':
        return { from: custom.from || null, to: custom.to || null };
      default:
        return { from: null, to: null };
    }
  }, [params.date, dateFilter, custom, today, settings.weekStart]);

  const { data } = useLocalQuery(
    () => queryActivities({ type, from: range.from, to: range.to, search, sort, deleted: deletedView }),
    [type, range.from, range.to, search, sort, deletedView],
  );
  const { data: total } = useLocalQuery(() => allActivitiesLite().then((l) => l.length), []);

  const filtered = type !== 'all' || !!range.from || !!range.to || !!search.trim();

  const confirmDelete = (id: string) =>
    Alert.alert('Delete this activity?', 'It will move to Recently deleted, where you can restore it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => setDeleted(id, true).then(requestSync) },
    ]);

  const restore = (id: string) =>
    Alert.alert('Restore this activity?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Restore', onPress: () => setDeleted(id, false).then(requestSync) },
    ]);

  return (
    <Screen>
      <FlatList
        data={data ?? []}
        keyExtractor={(a) => a.id}
        initialNumToRender={8}
        windowSize={7}
        removeClippedSubviews
        renderItem={({ item, index }) => (
          <Enter i={Math.min(index, 6)}>
            <ActivityCard
              activity={item}
              units={settings.units}
              tag={deletedView ? 'Deleted' : interrupted.has(item.id) ? 'Interrupted' : null}
              onPress={() =>
                deletedView ? restore(item.id) : router.push({ pathname: '/activity/[id]', params: { id: item.id } })
              }
              onLongPress={deletedView ? undefined : () => confirmDelete(item.id)}
            />
          </Enter>
        )}
        contentContainerStyle={{
          paddingTop: insets.top + space.md,
          paddingHorizontal: space.lg,
          paddingBottom: insets.bottom + TAB_BAR_SPACE,
          gap: space.md,
        }}
        ListHeaderComponent={
          <View style={{ gap: space.md }}>
            <AppBar />
            <Enter style={styles.header}>
              <View style={{ flex: 1 }}>
                <T v="title">{deletedView ? 'Recently deleted' : 'Activities'}</T>
                <T v="small" muted>
                  {deletedView
                    ? 'Tap one to restore it'
                    : total != null
                      ? `${total} recorded ${total === 1 ? 'activity' : 'activities'}`
                      : ' '}
                </T>
              </View>
              {!deletedView ? (
                <>
                  <RoundButton label="Search" onPress={() => setSearching((s) => !s)}>
                    <Ionicons name={searching ? 'close' : 'search'} size={19} color={colors.ink} />
                  </RoundButton>
                  <RoundButton label="Sort" onPress={() => setSortSheet(true)}>
                    <Ionicons name="swap-vertical" size={19} color={colors.ink} />
                  </RoundButton>
                </>
              ) : (
                <RoundButton label="Back to activities" onPress={() => setDeletedView(false)}>
                  <Ionicons name="close" size={20} color={colors.ink} />
                </RoundButton>
              )}
            </Enter>

            {searching && !deletedView ? (
              <Animated.View entering={FadeIn.duration(200)} style={styles.search}>
                <Ionicons name="search" size={18} color={colors.textMuted} />
                <TextInput
                  autoFocus
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search by name, note, type or date"
                  placeholderTextColor={colors.textMuted}
                  style={styles.searchInput}
                  returnKeyType="search"
                  accessibilityLabel="Search activities"
                />
              </Animated.View>
            ) : null}

            {params.date ? (
              <Tap accessibilityRole="button" onPress={() => router.setParams({ date: '' })} style={styles.dateChip}>
                <T v="small">Showing {formatDay(params.date, true)}</T>
                <Ionicons name="close" size={14} color={colors.ink} />
              </Tap>
            ) : null}

            {!deletedView ? (
              <>
                <Segmented options={TYPES} value={type} onChange={setType} />
                <Pills
                  options={DATES}
                  value={dateFilter}
                  onChange={(v) => {
                    if (params.date) router.setParams({ date: '' });
                    if (v === 'custom') setRangeSheet(true);
                    setDateFilter(v);
                  }}
                />
                {dateFilter === 'custom' && (custom.from || custom.to) ? (
                  <T v="small" muted>
                    {custom.from ? formatDay(custom.from, true) : 'Any start'} – {custom.to ? formatDay(custom.to, true) : 'today'}
                  </T>
                ) : null}
                {sort !== 'newest' ? (
                  <T v="small" muted>
                    Sorted by {SORTS.find((s) => s.value === sort)?.label.toLowerCase()}
                  </T>
                ) : null}
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          data === undefined ? (
            <LoadingState />
          ) : deletedView ? (
            <EmptyState icon="trash-outline" title="Nothing deleted" body="Deleted activities wait here so you can restore them." />
          ) : filtered ? (
            <EmptyState icon="filter-outline" title="Nothing matches" body="Try another filter or search." />
          ) : (
            <EmptyState
              title="No activities yet"
              body="Start a walk, jog or run. Every session you finish is saved here."
              action="Start an activity"
              onAction={openPicker}
            />
          )
        }
        ListFooterComponent={
          !deletedView ? (
            <Tap accessibilityRole="button" onPress={() => setDeletedView(true)} style={styles.footer}>
              <Ionicons name="trash-outline" size={15} color={colors.textMuted} />
              <T v="small" muted>
                Recently deleted
              </T>
            </Tap>
          ) : undefined
        }
      />

      <Sheet visible={sortSheet} onClose={() => setSortSheet(false)} title="Sort activities">
        {SORTS.map((s) => (
          <Tap
            key={s.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: sort === s.value }}
            onPress={() => {
              setSort(s.value);
              setSortSheet(false);
            }}
            style={styles.sortRow}
          >
            <T style={{ flex: 1, fontWeight: sort === s.value ? '600' : '400' }}>{s.label}</T>
            {sort === s.value ? <Ionicons name="checkmark" size={20} color={colors.ink} /> : null}
          </Tap>
        ))}
      </Sheet>

      <RangeSheet
        visible={rangeSheet}
        initial={custom}
        onClose={() => setRangeSheet(false)}
        onApply={(r) => {
          setCustom(r);
          setRangeSheet(false);
        }}
      />
    </Screen>
  );
}

function RangeSheet({
  visible,
  initial,
  onClose,
  onApply,
}: {
  visible: boolean;
  initial: { from: string; to: string };
  onClose: () => void;
  onApply: (r: { from: string; to: string }) => void;
}) {
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const bad = (v: string) => v !== '' && !DATE_RE.test(v);
  const invalid = bad(from) || bad(to) || (!!from && !!to && from > to);
  return (
    <Sheet visible={visible} onClose={onClose} title="Custom dates">
      <Field label="From (YYYY-MM-DD)" value={from} onChangeText={setFrom} placeholder="2026-01-01" keyboardType="numbers-and-punctuation" maxLength={10} />
      <Field label="To (YYYY-MM-DD)" value={to} onChangeText={setTo} placeholder={todayLocal()} keyboardType="numbers-and-punctuation" maxLength={10} />
      {invalid ? (
        <T v="small">Use dates like 2026-11-01, with the start before the end.</T>
      ) : null}
      <Button title="Apply" disabled={invalid} onPress={() => onApply({ from, to })} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: 999,
    backgroundColor: colors.card,
    boxShadow: shadow.card,
  },
  searchInput: { flex: 1, minHeight: 46, fontFamily: fonts.regular, fontSize: 14, color: colors.text },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.card,
    boxShadow: shadow.card,
  },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, minHeight: 48 },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: space.md,
    borderRadius: 16,
    backgroundColor: colors.card,
  },
});
