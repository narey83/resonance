import api from '../../../lib/api';
import * as prefs from '../../../lib/prefs';
import TrackInspector from './TrackInspector';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../../lib/api', () => ({ get: jest.fn() }));
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
