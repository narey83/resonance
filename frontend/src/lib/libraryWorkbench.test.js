import { EMPTY_DJ_FILTERS } from '../components/Library/components/LibraryDjFilters';
import {
  analysisStatus,
  djQuery,
  djSummary,
  transitionHint,
} from './libraryWorkbench';

describe('collection preparation semantics', () => {
  it('does not mistake tags and waveform for enhanced analysis', () => {
    expect.hasAssertions();
    expect(
      analysisStatus({ hasWaveform: true, bpm: 128, key: 'Am' }).label,
    ).toBe('Basic ready');
    expect(analysisStatus({ djSummary: '{"complete":true}' }).kind).toBe(
      'review',
    );
    expect(
      analysisStatus({ djSummary: '{"complete":true}' }, false, true).kind,
    ).toBe('ready');
    expect(analysisStatus({}, 'queued').label).toBe('Queued');
    expect(analysisStatus({}, true).label).toBe('Analysing');
  });
  it('makes automatic arrangement usable without manual review', () => {
    expect.hasAssertions();
    const status = analysisStatus({
      djSummary: { complete: true, automaticArrangement: true },
    });
    expect(status.kind).toBe('ready');
    expect(status.label).toBe('Analysed');
    expect(status.detail).toContain('neutral labels');
  });
  it('uses server filters and includes enharmonic compatible keys', () => {
    expect.hasAssertions();
    const query = djQuery({
      ...EMPTY_DJ_FILTERS,
      key: 'Am',
      bpmMin: '120',
      bpmMax: '135',
      vocals: 'no',
    });
    expect(query.bpmMin).toBe(120);
    expect(query.bpmMax).toBe(135);
    expect(query.keys.split(',')).toEqual(
      expect.arrayContaining(['Am', 'C', 'Dm', 'Em']),
    );
    expect(query.vocals).toBe('no');
    expect(djQuery(EMPTY_DJ_FILTERS).bpmMin).toBeUndefined();
  });
  it('keeps unknown transitions explicit instead of presenting compatibility', () => {
    expect.hasAssertions();
    expect(transitionHint({}, { bpm: 128, key: 'Am' }).label).toBe(
      'BPM unknown · Key unknown',
    );
    expect(
      transitionHint({ bpm: 128, key: 'Am' }, { bpm: 130, key: 'C' }),
    ).toEqual({ delta: 2, compatible: true, label: '+2 BPM · Compatible key' });
    expect(djSummary({ djSummary: 'bad json' })).toEqual({});
  });
});
