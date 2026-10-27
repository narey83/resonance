import { historyOutcome } from './transferHistoryState';

describe('History outcome labels', () => {
  it.each([
    ['Completed, Succeeded', 'Succeeded'],
    ['Completed, Errored', 'Failed'],
    ['Completed, Cancelled', 'Cancelled'],
    ['Completed, TimedOut', 'Timed out'],
    ['Completed, Rejected', 'Rejected'],
    ['Completed, Aborted', 'Aborted'],
    ['Completed', 'Outcome unknown'],
    [null, 'Outcome unknown'],
  ])(
    'explains %s without treating the terminal flag as success',
    (description, label) => {
      expect.hasAssertions();
      expect(historyOutcome(description).label).toBe(label);
    },
  );
  it('does not show a malformed error/success combination as successful', () => {
    expect.hasAssertions();
    expect(historyOutcome('Completed, Errored, Succeeded').label).toBe(
      'Failed',
    );
  });
});
