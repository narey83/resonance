import api from '../../../lib/api';
import * as prefs from '../../../lib/prefs';
import TrackInspector from './TrackInspector';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../../lib/api', () => ({ get: jest.fn(), put: jest.fn() }));
jest.mock('../../../lib/prefs', () => ({
  get: jest.fn(() => ({})),
  set: jest.fn(),
}));
describe('track inspector analysis timestamps', () => {
  it('auditions cue proposals and processed voice using their saved timestamps', async () => {
    expect.hasAssertions();
    const container = document.createElement('div');
    document.body.append(container);
    const onSeek = jest.fn();
    prefs.get.mockReturnValue({});
    api.get.mockResolvedValue({
      data: {
        available: true,
        djPhrases: [],
        musicalPhrases: [],
        singing: [],
        processedVoice: [{ startSeconds: 24, endSeconds: 27 }],
        cues: {
          cueProposals: [{ seconds: 13.4, reason: 'Section change candidate' }],
        },
      },
    });
    await act(async () => {
      ReactDOM.render(
        <TrackInspector
          onClose={() => {}}
          onReview={() => {}}
          onSeek={onSeek}
          reviewed={false}
          track={{
            path: 'song',
            title: 'Song',
            djSummary: '{"complete":true,"analysisId":"v1"}',
          }}
        />,
        container,
      );
    });
    const cue = [...container.querySelectorAll('button')].find((button) =>
      button.textContent.includes('Section change candidate'),
    );
    const voice = [...container.querySelectorAll('button')].find((button) =>
      button.textContent.includes('Processed voice'),
    );
    act(() => {
      Simulate.click(cue);
      Simulate.click(voice);
    });
    expect(onSeek.mock.calls).toEqual([[13.4], [24]]);
    expect(container.textContent).toContain('Independent predictions');
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
});

describe('synced track preparation', () => {
  it('shows phone bookmarks and preserves them and the revision when desktop notes are saved', async () => {
    const container = document.createElement('div'); document.body.append(container);
    prefs.get.mockReturnValue({});
    const preparation = { path: 'song', role: 'opener', notes: 'Phone note', bookmarks: [{ id: 'one', seconds: 42, label: 'Bass arrives' }], revision: 3 };
    api.get.mockImplementation(url => Promise.resolve({ data: url.includes('/discovery/notes') ? [preparation] : { available: false } }));
    api.put.mockResolvedValue({ data: { ...preparation, notes: 'Desktop note', revision: 4 } });
    const onSeek = jest.fn();
    await act(async () => { ReactDOM.render(<TrackInspector track={{ path: 'song', title: 'Song' }} onClose={() => {}} onSeek={onSeek} />, container); });
    expect(container.querySelector('textarea').value).toBe('Phone note');
    const marker = [...container.querySelectorAll('button')].find(button => button.textContent.includes('Bass arrives'));
    act(() => Simulate.click(marker)); expect(onSeek).toHaveBeenCalledWith(42);
    act(() => Simulate.change(container.querySelector('textarea'), { target: { value: 'Desktop note' } }));
    const save = [...container.querySelectorAll('button')].find(button => button.textContent.includes('Save notes'));
    await act(async () => Simulate.click(save));
    expect(api.put).toHaveBeenCalledWith('/musiclibrary/discovery/notes', { ...preparation, notes: 'Desktop note' });
    expect(container.textContent).toContain('Notes saved');
    act(() => { ReactDOM.unmountComponentAtNode(container); }); container.remove();
  });
});
