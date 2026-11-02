import { toast } from '../../lib/activityNotices';
import { lookup } from '../../lib/metadataLookup';
import { getTagged, getUntagged, writeTags } from '../../lib/tags';
import TagEditor from './TagEditor';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../lib/metadataLookup', () => ({ lookup: jest.fn() }));
jest.mock('../../lib/tags', () => ({
  getTagged: jest.fn(),
  getUntagged: jest.fn(),
  writeTags: jest.fn(),
}));
jest.mock('../../context/TagEditActivityContext', () => ({
  useTagEditActivity: () => ({ jobs: {} }),
}));
jest.mock('../../lib/activityNotices', () => ({
  toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() },
}));
const files = ['one', 'two'].map((name) => ({
  maskedFilename: name,
  directory: 'share',
  filename: name + '.mp3',
  tags: { artist: 'Artist', title: name },
}));

describe('Saving an online tag preview', () => {
  let container;
  const button = (name) =>
    [...container.querySelectorAll('button')].find(
      (element) => element.textContent.trim() === name,
    );
  beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    getTagged.mockResolvedValue(files);
    getUntagged.mockResolvedValue([]);
    writeTags.mockResolvedValue();
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });
  const render = async () => {
    await act(async () => {
      ReactDOM.render(
        <MemoryRouter
          initialEntries={[
            { pathname: '/tags', state: { maskedFilenames: ['one', 'two'] } },
          ]}
        >
          <TagEditor />
        </MemoryRouter>,
        container,
      );
    });
  };

  it('only passes server provenance on save, and clears it when selecting the next track', async () => {
    expect.hasAssertions();
    lookup.mockResolvedValue([
      {
        lookupId: 'server-candidate',
        source: 'Discogs',
        album: 'Online Album',
      },
    ]);
    await render();
    await act(async () => {
      Simulate.click(button('Look up online'));
    });
    expect(writeTags).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      'Filled from Discogs — review, then save.',
    );
    await act(async () => {
      Simulate.submit(container.querySelector('form'));
    });
    expect(writeTags).toHaveBeenLastCalledWith(
      expect.objectContaining({
        maskedFilename: 'one',
        lookupId: 'server-candidate',
        tags: expect.objectContaining({ album: 'Online Album' }),
      }),
    );
    await act(async () => {
      Simulate.submit(container.querySelector('form'));
    });
    expect(writeTags).toHaveBeenLastCalledWith(
      expect.objectContaining({ maskedFilename: 'two', lookupId: null }),
    );
  });
  it('discards a late online response after moving to another track', async () => {
    expect.hasAssertions();
    let resolveLookup;
    lookup.mockReturnValue(
      new Promise((resolve) => {
        resolveLookup = resolve;
      }),
    );
    await render();
    await act(async () => {
      Simulate.click(button('Look up online'));
    });
    await act(async () => {
      Simulate.click(button('Skip'));
    });
    await act(async () => {
      resolveLookup([{ lookupId: 'old-candidate', album: 'Wrong Album' }]);
    });
    expect(container.querySelector('[name="album"]').value).toBe('');
    await act(async () => {
      Simulate.submit(container.querySelector('form'));
    });
    expect(writeTags).toHaveBeenCalledWith(
      expect.objectContaining({ maskedFilename: 'two', lookupId: null }),
    );
  });
});
