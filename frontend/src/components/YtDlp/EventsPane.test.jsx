import { parseUtcDate } from '../../lib/util';
import EventsPane from './EventsPane';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

const event = (timestamp, overrides = {}) => ({
  timestamp,
  jobId: 'job-1',
  jobTitle: 'https://www.youtube.com/watch?v=video-1',
  level: 'info',
  message: 'Started',
  ...overrides,
});

describe('yt-dlp events', () => {
  let container;

  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: jest.fn(),
    });
    container = document.createElement('div');
    document.body.append(container);
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  const render = (events, jobs = []) => {
    act(() => {
      ReactDOM.render(
        <EventsPane
          events={events}
          jobs={jobs}
          onClear={jest.fn()}
        />,
        container,
      );
    });
  };

  it('shows local dates and times on events across days, including track details', () => {
    const first = '2026-11-09T23:58:00';
    const second = '2026-11-11T01:02:03Z';
    render([
      event(first),
      event(second, {
        jobTitle: 'A named playlist',
        trackTitle: 'Track one',
        message: 'Completed',
      }),
    ]);

    expect(container.querySelector('.ytdlp-events-tabs').textContent).toContain(
      'A named playlist',
    );
    expect(
      container.querySelector('.ytdlp-events-tabs').textContent,
    ).not.toContain('job-1');
    const firstTime = container.querySelector(
      `.ytdlp-event-row time[datetime="${parseUtcDate(first).toISOString()}"]`,
    );
    expect(firstTime.textContent).toContain(
      parseUtcDate(first).toLocaleDateString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
    );
    expect(firstTime.textContent).toContain(
      parseUtcDate(first).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }),
    );

    act(() =>
      Simulate.click(container.querySelector('.ytdlp-event-track-header')),
    );
    expect(
      container.querySelector(
        `.ytdlp-event-track-body time[datetime="${parseUtcDate(second).toISOString()}"]`,
      ),
    ).not.toBeNull();
  });

  it('uses later event titles and current job names when filtering to errors', () => {
    const events = [
      event('2026-11-10T12:00:00Z'),
      event('2026-11-10T12:01:00Z', {
        jobTitle: 'Old event title',
        level: 'error',
        message: 'Failed',
      }),
    ];
    render(events);
    const tabs = () =>
      container.querySelector('.ytdlp-events-tabs').textContent;
    act(() =>
      Simulate.change(container.querySelector('.ytdlp-events-toolbar select'), {
        target: { value: 'errors' },
      }),
    );
    expect(tabs()).toContain('Old event title');
    render(events, [{ id: 'job-1', title: 'Current playlist name' }]);
    expect(tabs()).toContain('Current playlist name');
    expect(container.querySelectorAll('.ytdlp-event-row')).toHaveLength(1);
  });

  it('uses a recognizable source label when a job has no resolved title', () => {
    render([event('2026-11-10T12:00:00Z')]);
    expect(container.querySelector('.ytdlp-events-tabs').textContent).toContain(
      'Untitled · video-1',
    );
  });
});
