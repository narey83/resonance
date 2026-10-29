import MusicWorkspaceHeader from './MusicWorkspaceHeader';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const renderHeader = (page) => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    <MemoryRouter>
      <MusicWorkspaceHeader page={page} />
    </MemoryRouter>,
  );
  return container;
};

describe('Music workspace header', () => {
  it.each([
    'library',
    'trackanalysis',
    'export',
    'networklink',
    'tags',
    'duplicates',
    'converter',
  ])('omits the header export shortcut on %s', (page) => {
    const header = renderHeader(page);
    expect(header.querySelector('h1').textContent).not.toBe('');
    expect(header.textContent).not.toContain('Export set');
    expect(header.querySelector('a[href$="/export"]')).toBeNull();
  });

  it('preserves analysis navigation and the return to collection', () => {
    expect(renderHeader('library').textContent).toContain('Analyse');
    expect(renderHeader('trackanalysis').querySelector('a')).toBeNull();
    expect(renderHeader('networklink').textContent).not.toContain('Analyse');
    expect(renderHeader('export').textContent).toContain('Back to collection');
    expect(renderHeader('export').textContent).not.toContain('Analyse');
    expect(
      renderHeader('export').querySelector(
        'a[href="http://127.0.0.1:55460/usb#eject"]',
      ).textContent,
    ).toContain('Safely eject in Bridge');
  });
});
