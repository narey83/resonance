import { makeSetTrack } from '../lib/__fixtures__/setPlannerData';
import api from '../lib/api';
import { resolveLibraryTracks } from '../lib/libraryWorkbench';
import { seedSignatures } from '../lib/streamSignatures';
import useSetPlanAnalysis from './useSetPlanAnalysis';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

jest.mock('../context/LibraryActivityContext', () => ({
  useLibraryActivity: () => ({ libraryRevision: 0 }),
}));
jest.mock('../lib/api', () => ({ get: jest.fn() }));
jest.mock('../lib/libraryWorkbench', () => ({
  resolveLibraryTracks: jest.fn(),
}));
jest.mock('../lib/streamSignatures', () => ({ seedSignatures: jest.fn() }));
let result;
const Probe = ({ items: selection }) => {
  result = useSetPlanAnalysis(selection);
  return <div>{Object.keys(result).length}</div>;
};

const records = Array.from({ length: 15 }, (_, i) =>
  makeSetTrack(`Track-${i}`),
);
const items = records.map(({ track }) => ({ path: track.path }));

describe('selected-set analysis reads', () => {
  let container;
  beforeEach(() => {
    jest.clearAllMocks();
    resolveLibraryTracks.mockResolvedValue(
      records.map((record) => record.track),
    );
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
  const render = async (next = items) => {
    await act(async () => {
      ReactDOM.render(<Probe items={next} />, container);
    });
  };

  it('reads only the selected paths with four concurrent cached-analysis requests and no job submissions', async () => {
    expect.hasAssertions();
    let active = 0;
    let peak = 0;
    api.get.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return { data: { available: true } };
    });
    await render();
    expect(resolveLibraryTracks).toHaveBeenCalledWith(
      items.map((item) => item.path).sort(),
    );
    expect(seedSignatures).toHaveBeenCalledWith(
      records.map((record) => record.track),
    );
    expect(api.get).toHaveBeenCalledTimes(15);
    expect(peak).toBeLessThanOrEqual(4);
    expect(
      api.get.mock.calls.every(
        ([url]) => url === '/analysis/candidates/enhanced',
      ),
    ).toBe(true);
    expect(Object.values(result).map((row) => row.loading)).toEqual(
      Array.from({ length: 15 }).fill(false),
    );
    expect(Object.values(result).map((row) => row.enhanced.available)).toEqual(
      Array.from({ length: 15 }).fill(true),
    );
    await render([...items].reverse());
    expect(api.get).toHaveBeenCalledTimes(15);
  });
  it('distinguishes missing tracks from an unavailable metadata service', async () => {
    expect.hasAssertions();
    resolveLibraryTracks.mockResolvedValueOnce([]);
    await render([items[0]]);
    expect(result[items[0].path].missing).toBe(true);
    expect(api.get).not.toHaveBeenCalled();
    resolveLibraryTracks.mockRejectedValueOnce(new Error('Offline'));
    await render([items[1]]);
    expect(result[items[1].path].missing).not.toBe(true);
    expect(result[items[1].path].error).toContain('could not refresh');
  });
  it('ignores an old analysis response after the selection changes', async () => {
    expect.hasAssertions();
    let finish;
    resolveLibraryTracks
      .mockResolvedValueOnce([records[0].track])
      .mockResolvedValueOnce([records[1].track]);
    api.get
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({ data: { available: true, marker: 'current' } });
    await render([items[0]]);
    const firstSignal = api.get.mock.calls[0][1].signal;
    await render([items[1]]);
    expect(firstSignal.aborted).toBe(true);
    await act(async () => {
      finish({ data: { marker: 'old' } });
    });
    expect(result[items[0].path]).toBeUndefined();
    expect(result[items[1].path].enhanced.marker).toBe('current');
  });
});
