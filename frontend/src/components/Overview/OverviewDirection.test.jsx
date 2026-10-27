import KpiCards from './KpiCards';
import RatioCard from './RatioCard';
import UserLeaderboard from './UserLeaderboard';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

jest.mock('../../lib/util', () => ({
  formatBytes: (value) => `${value} bytes`,
  formatBitrate: (value) => `${value} speed`,
}));
const summary = {
  Download: {
    Succeeded: {
      totalBytes: 100,
      count: 10,
      averageSpeed: 4_000,
      distinctUsers: 99,
    },
  },
  Upload: {
    Errored: { totalBytes: 999_999, count: 7 },
    Succeeded: {
      totalBytes: 200,
      count: 5,
      averageSpeed: 2_000,
      distinctUsers: 3,
    },
  },
};
describe('Directional overview panels', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });
  it('shows upload metrics and their full speed without download values', () => {
    expect.hasAssertions();
    act(() => {
      ReactDOM.render(
        <KpiCards
          direction="upload"
          summary={summary}
        />,
        container,
      );
    });
    expect(container.textContent).toContain('Uploaded');
    expect(container.textContent).not.toContain('Downloaded');
    expect(container.textContent).toContain('2000 speed');
    expect(container.textContent).not.toContain('99');
  });
  it('shows download metrics and their full speed without upload values', () => {
    expect.hasAssertions();
    act(() => {
      ReactDOM.render(
        <KpiCards
          direction="download"
          summary={summary}
        />,
        container,
      );
    });
    expect(container.textContent).toContain('Downloaded');
    expect(container.textContent).not.toContain('Uploaded');
    expect(container.textContent).toContain('4000 speed');
  });
  it('shows only recipients for uploads and only sources for downloads', () => {
    expect.hasAssertions();
    act(() => {
      ReactDOM.render(
        <UserLeaderboard
          direction="upload"
          leaderboard={{}}
        />,
        container,
      );
    });
    expect(container.textContent).toContain('Upload recipients');
    expect(container.textContent).not.toContain('Download sources');
    act(() => {
      ReactDOM.render(
        <UserLeaderboard
          direction="download"
          leaderboard={{}}
        />,
        container,
      );
    });
    expect(container.textContent).toContain('Download sources');
    expect(container.textContent).not.toContain('Upload recipients');
  });
  it('keeps failed attempts out of successful counts and byte totals', () => {
    expect.hasAssertions();
    act(() => {
      ReactDOM.render(
        <KpiCards
          direction="upload"
          summary={summary}
        />,
        container,
      );
    });
    const success = [...container.querySelectorAll('.kpi-group-stat')].find(
      (item) => item.textContent.includes('Successful uploads'),
    );
    expect(success.textContent).toContain('5');
    expect(success.textContent).toContain('41.7% success');
    const failures = [...container.querySelectorAll('.kpi-card')].find((item) =>
      item.textContent.includes('Failed attempts'),
    );
    expect(failures.textContent).toContain('7');
    expect(container.textContent).toContain('200 bytes');
    expect(container.textContent).not.toContain('999999');
  });
  it('calculates the sharing ratio from successful bytes only', () => {
    expect.hasAssertions();
    act(() => {
      ReactDOM.render(<RatioCard summary={summary} />, container);
    });
    expect(container.textContent).toContain('2.00');
    expect(container.textContent).toContain('200 bytes');
    expect(container.textContent).not.toContain('999999');
  });
});
