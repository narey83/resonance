import { RoomListItem } from './Rooms';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const renderItem = (unreadCount) => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    <RoomListItem
      joined
      room={{ name: 'music', userCount: 12 }}
      unreadCount={unreadCount}
    />,
  );
  return container;
};

describe('Room unread message indicator', () => {
  it('shows new messages beside the room without replacing the user count', () => {
    const row = renderItem(3);
    expect(
      row.querySelector('[aria-label="3 new messages in music"]'),
    ).not.toBeNull();
    expect(row.querySelector('.sr-search-item-count').textContent).toBe('12');
  });
  it('omits the indicator for read rooms and caps large displayed counts', () => {
    expect(renderItem(0).querySelector('.room-unread-badge')).toBeNull();
    expect(
      renderItem(150).querySelector('.room-unread-badge').textContent,
    ).toBe('99+');
    expect(
      renderItem(150).querySelector('[aria-label="150 new messages in music"]'),
    ).not.toBeNull();
  });
});
