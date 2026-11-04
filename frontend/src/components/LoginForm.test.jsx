import LoginForm from './LoginForm';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

describe('login with an animated background', () => {
  let container;
  let onLoginAttempt;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    onLoginAttempt = jest.fn();
    act(() => {
      ReactDOM.render(<LoginForm onLoginAttempt={onLoginAttempt} />, container);
    });
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  it('pauses and resumes the background without attempting to sign in', () => {
    const toggle = container.querySelector('.login-motion-toggle');
    act(() => Simulate.click(toggle));
    expect(toggle.getAttribute('aria-label')).toBe('Play background animation');
    act(() => Simulate.click(toggle));
    expect(toggle.getAttribute('aria-label')).toBe(
      'Pause background animation',
    );
    expect(onLoginAttempt).not.toHaveBeenCalled();
  });

  it('preserves entered credentials when the animation is paused', () => {
    act(() => {
      Simulate.change(container.querySelector('#login-username'), {
        target: { value: 'listener' },
      });
      Simulate.change(container.querySelector('#login-password'), {
        target: { value: 'test-password' },
      });
    });
    act(() => Simulate.click(container.querySelector('.login-motion-toggle')));
    act(() => Simulate.submit(container.querySelector('form')));
    expect(onLoginAttempt).toHaveBeenCalledWith(
      'listener',
      'test-password',
      true,
    );
  });

  it('keeps the background decorative and rejects an empty sign-in attempt', () => {
    expect(
      container.querySelector('.login-scene').getAttribute('aria-hidden'),
    ).toBe('true');
    expect(container.querySelector('.auth-submit').disabled).toBe(true);
    act(() => Simulate.submit(container.querySelector('form')));
    expect(onLoginAttempt).not.toHaveBeenCalled();
  });
});
