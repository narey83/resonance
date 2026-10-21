import { fullTrackJobs, independentSummary } from './independentSummary';

describe('independent analysis summaries', () => {
  it('new previews never hide full-track analysis', () => {
    const full = {
      jobId: 'full',
      requestedSeconds: null,
      status: 'completed',
      createdAt: '2026-10-14',
    };
    const preview = {
      jobId: 'preview',
      requestedSeconds: 30,
      status: 'completed',
      createdAt: '2026-10-15',
    };
    expect(fullTrackJobs([preview, full])).toEqual([full]);
  });
  it('stale and preview results are excluded', () => {
    expect(
      independentSummary({ contentCurrent: false, analysis: {} }),
    ).toBeNull();
    expect(
      independentSummary({
        contentCurrent: true,
        analysis: { scope: { fullTrack: false } },
      }),
    ).toBeNull();
  });
  it('counts available features and retains source values', () => {
    const r = independentSummary({
      contentCurrent: true,
      job: { jobId: 'full' },
      analysis: {
        featureAvailability: {
          beats: 'available',
          key: 'available',
          stems: 'failed',
        },
        features: {
          beats: {
            status: 'available',
            result: { bpm_median_interval: 128.2 },
          },
          key: { status: 'available', result: { key: 'Gm' } },
        },
      },
    });
    expect(r).toEqual({
      jobId: 'full',
      available: 2,
      total: 3,
      bpm: 128.2,
      key: 'Gm',
    });
  });
});
