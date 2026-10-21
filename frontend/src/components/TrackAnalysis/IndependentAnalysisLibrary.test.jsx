import api from '../../lib/api';
import IndependentAnalysisLibrary from './IndependentAnalysisLibrary';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/api', () => ({ get: jest.fn() }));
jest.mock('../../lib/usePagedList', () => {
  const items = Array.from({ length: 15 }, (_, i) => ({
    path: `track-${i}`,
    title: `Track ${i}`,
  }));
  return {
    usePagedList: () => ({
      items,
      total: 15,
      loading: false,
      loadingMore: false,
      loadMore: jest.fn(),
    }),
  };
});
jest.mock('./CandidateAnalysisPanel', () => ({ initialJobId, path }) => (
  <p>
    Opened {path}: {initialJobId}
  </p>
));
describe('independent library results', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    api.get.mockImplementation(async (url, config) =>
      url === '/analysis/candidates'
        ? {
            data: {
              jobs: [
                {
                  jobId: config.params.path,
                  status: 'completed',
                  requestedSeconds: null,
                  createdAt: '2026-10-15',
                },
              ],
            },
          }
        : {
            data: {
              contentCurrent: true,
              job: { jobId: url.split('/').pop() },
              analysis: {
                scope: { fullTrack: true },
                featureAvailability: { beats: 'available', key: 'available' },
                features: {
                  beats: {
                    status: 'available',
                    result: { bpm_median_interval: 128 },
                  },
                  key: { status: 'available', result: { key: 'Gm' } },
                },
              },
            },
          },
    );
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.clearAllMocks();
  });
  it('shows all 15 analyses and opens the corresponding full-track result', async () => {
    expect.hasAssertions();
    await act(async () => {
      ReactDOM.render(<IndependentAnalysisLibrary />, container);
      for (let i = 0; i < 40; i++) await Promise.resolve();
    });
    expect(container.textContent).toContain('15 of 15 loaded tracks');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(15);
    act(() => Simulate.click(container.querySelector('tbody button')));
    expect(container.textContent).toContain('Opened track-0: track-0');
  });
});
