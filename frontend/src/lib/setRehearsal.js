import { mixCompatibility } from './mixCompatibility';
import { syncPlan } from './mixSync';
import { plannedMasters, setTransitionMessages, validBpm } from './setPlanner';

export const rehearsalTitle = (data, path) =>
  data?.track?.title || path?.split('/').pop() || 'Track unavailable';
export const sameRehearsalSettings = (a, b) =>
  ['bars', 'extendedTempo'].every((key) => a[key] === b[key]);
export const rehearsalTransitions = (plan, data, overrides = {}) => {
  const masters = plannedMasters(plan, data);
  return plan.items.slice(0, -1).map((item, index) => {
    const next = plan.items[index + 1];
    const a = data[item.path];
    const b = data[next.path];
    const defaults = {
      bars: plan.bars,
      extendedTempo: plan.extendedTempo,
    };
    const settings = {
      bars: [8, 16, 32].includes(overrides[index]?.bars)
        ? overrides[index].bars
        : defaults.bars,
      extendedTempo: overrides[index]?.extendedTempo ?? defaults.extendedTempo,
    };
    const master = masters[index];
    const loading = !a || !b || a.loading || b.loading;
    const missing = Boolean(a?.missing || b?.missing);
    const comparison = mixCompatibility(
      a,
      b,
      settings.bars,
      master ?? Number.NaN,
      settings.extendedTempo,
    );
    const candidate = syncPlan(
      a,
      b,
      comparison.plan,
      master,
      settings.extendedTempo,
    );
    const synced = loading
      ? { available: false, reason: 'Loading saved timing…' }
      : missing
        ? { available: false, reason: 'A track is no longer available.' }
        : !validBpm(master)
          ? {
              available: false,
              reason:
                'Choose a known master tempo before rehearsing this handover.',
            }
          : candidate;
    const messages = setTransitionMessages(
      comparison,
      synced,
      loading,
      missing,
    );
    const signature = JSON.stringify([
      item.path,
      next.path,
      master,
      settings,
      synced,
      comparison.genre.kind,
      comparison.plan?.overlapSeconds,
    ]);
    return {
      index,
      a: a?.track || { path: item.path },
      b: b?.track || { path: next.path },
      titles: [rehearsalTitle(a, item.path), rehearsalTitle(b, next.path)],
      defaults,
      settings,
      master,
      synced,
      messages,
      loading,
      missing,
      signature,
    };
  });
};

export const rehearsalStatus = (transition, progress) => {
  const saved = progress[transition.index];
  return saved?.signature === transition.signature ? saved.status : 'pending';
};

export const rehearsalCounts = (transitions, progress) => {
  const counts = {
    rehearsed: 0,
    partial: 0,
    skipped: 0,
    pending: 0,
    unavailable: 0,
  };
  for (const transition of transitions) {
    counts[rehearsalStatus(transition, progress)]++;
    if (!transition.loading && !transition.synced.available)
      counts.unavailable++;
  }

  return counts;
};
