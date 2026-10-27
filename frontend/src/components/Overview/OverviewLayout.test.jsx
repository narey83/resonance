import * as reports from '../../lib/reports';
import * as shares from '../../lib/shares';
import * as transfers from '../../lib/transfers';
import AppContext from '../AppContext';
import Overview from '.';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

/* eslint-disable unicorn/consistent-function-scoping -- Hoisted Jest module factories must remain self-contained. */
jest.mock('../../lib/reports');
jest.mock('../../lib/shares', () => ({ getFileTypeCounts: jest.fn() }));
jest.mock('../../lib/transfers', () => ({ getAll: jest.fn() }));
jest.mock('../../lib/prefs', () => ({
  get: (_key, fallback) => fallback,
  set: jest.fn(),
}));
jest.mock('./SystemStatsCard', () => () => 'CPU, memory and storage panel');
jest.mock('./CoverageCard', () => () => 'Lifetime library sharing');
jest.mock('./SocialPulse', () => () => 'Community activity panel');
jest.mock('./RatioCard', () => () => 'Sharing ratio panel');
jest.mock('./ActivityChart', () => () => null);
jest.mock('./ActivityHeatmap', () => () => null);
jest.mock('./BlockedUsersCard', () => () => null);
jest.mock('./DistributedNetworkCard', () => () => null);
jest.mock('./ErrorChart', () => () => null);
jest.mock('./GeographyCard', () => () => null);
jest.mock('./PeerRetentionCard', () => () => null);
jest.mock('./PersonalSummary', () => () => null);
jest.mock('./PopularDirectories', () => () => null);
jest.mock('./QueueWaitCard', () => () => null);
jest.mock('./RetryFunnel', () => () => null);
jest.mock('./TopFiles', () => () => null);
jest.mock('./TransferHealth', () => () => null);
jest.mock('./UserLeaderboard', () => () => null);
jest.mock('./UserReports', () => () => null);
/* eslint-enable unicorn/consistent-function-scoping */
const summary = {
  Upload: { Succeeded: { count: 2, totalBytes: 200 } },
  Download: { Succeeded: { count: 3, totalBytes: 300 } },
};

describe('Overview card placement and view changes', () => {
  let container;
  const button = (name) =>
    [...container.querySelectorAll('button')].find(
      (item) => item.textContent === name,
    );
  beforeEach(() => {
    jest.clearAllMocks();
    for (const method of Object.values(reports).filter(jest.isMockFunction))
      method.mockResolvedValue({});
    reports.getSummary.mockResolvedValue(summary);
    transfers.getAll.mockResolvedValue([]);
    shares.getFileTypeCounts.mockResolvedValue({});
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });
  const render = async () => {
    await act(async () => {
      ReactDOM.render(
        <AppContext.Provider value={{ isAdmin: true }}>
          <Overview />
        </AppContext.Provider>,
        container,
      );
    });
  };

  const click = async (name) => {
    await act(async () => {
      Simulate.click(button(name));
    });
  };

  it('keeps system resources out of transfer tabs and does not request reports on Resources', async () => {
    expect.hasAssertions();
    await render();
    expect(container.textContent).toContain('Successful uploads');
    expect(container.textContent).not.toContain(
      'CPU, memory and storage panel',
    );
    const count = reports.getSummary.mock.calls.length;
    await click('Resources');
    expect(container.textContent).toContain('CPU, memory and storage panel');
    expect(container.textContent).not.toContain('Successful uploads');
    expect(button('1h')).toBeUndefined();
    expect(reports.getSummary).toHaveBeenCalledTimes(count);
  });
  it('keeps sharing and community cards out of Uploads and Downloads', async () => {
    expect.hasAssertions();
    await render();
    expect(container.textContent).not.toContain('Lifetime library sharing');
    await click('Downloads');
    expect(container.textContent).toContain('Successful downloads');
    expect(container.textContent).not.toContain('Community activity panel');
    await click('Sharing & community');
    expect(container.textContent).toContain('Lifetime library sharing');
    expect(container.textContent).toContain('Community activity panel');
    expect(container.textContent).not.toContain('Successful downloads');
  });
});
