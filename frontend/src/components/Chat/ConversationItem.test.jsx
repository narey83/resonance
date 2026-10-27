import { ConversationItem } from './Chat';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const renderItem = (count) => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    <ConversationItem
      conv={{ username: 'alice', unAcknowledgedMessageCount: count }}
    />,
  );
  return container;
};

describe('Private message unread indicator', () => {
  it('shows a message icon and count beside the sender', () => {
    const row = renderItem(3);
    expect(
      row.querySelector('[aria-label="3 new messages from alice"]'),
    ).not.toBeNull();
    expect(row.querySelector('.chat-conv-badge svg')).not.toBeNull();
    expect(row.querySelector('.chat-conv-badge').textContent).toBe('3');
  });
  it('clears read conversations and caps the visible count', () => {
    expect(renderItem(0).querySelector('.chat-conv-badge')).toBeNull();
    expect(renderItem(120).querySelector('.chat-conv-badge').textContent).toBe(
      '99+',
    );
    expect(
      renderItem(120).querySelector(
        '[aria-label="120 new messages from alice"]',
      ),
    ).not.toBeNull();
  });
});
