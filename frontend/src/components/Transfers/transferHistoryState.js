const OUTCOMES = [
  ['Errored', 'Failed', 'th-state-error'],
  ['TimedOut', 'Timed out', 'th-state-error'],
  ['Rejected', 'Rejected', 'th-state-error'],
  ['Aborted', 'Aborted', 'th-state-error'],
  ['Cancelled', 'Cancelled', 'th-state-cancelled'],
  ['Succeeded', 'Succeeded', 'th-state-ok'],
];

// Completed is a terminal-state flag, not a successful outcome.
export const historyOutcome = (description) => {
  const flags = new Set(
    (description ?? '').split(',').map((flag) => flag.trim()),
  );
  const outcome = OUTCOMES.find(([flag]) => flags.has(flag));
  return outcome
    ? { label: outcome[1], className: outcome[2] }
    : { label: 'Outcome unknown', className: '' };
};
