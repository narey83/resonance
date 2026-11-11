import {
  createHubAccessTokenFactory,
  createInfiniteRetryPolicy,
} from './hubFactory';

describe('hub session scope', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('never supplies a new session token to a hub created by an older session', async () => {
    expect.hasAssertions();
    sessionStorage.setItem('resonance-token', 'old-access');
    sessionStorage.setItem('resonance-session-id', 'old-session');
    const accessTokenFactory = createHubAccessTokenFactory();
    await expect(accessTokenFactory()).resolves.toBe('old-access');

    sessionStorage.setItem('resonance-token', 'new-access');
    sessionStorage.setItem('resonance-session-id', 'new-session');
    await expect(accessTokenFactory()).resolves.toBeNull();
  });

  it('stops reconnecting a hub after its session is replaced', () => {
    expect.hasAssertions();
    sessionStorage.setItem('resonance-session-id', 'old-session');
    const policy = createInfiniteRetryPolicy(null, 'old-session');
    const retry = { elapsedMilliseconds: 0, previousRetryCount: 0 };
    expect(policy.nextRetryDelayInMilliseconds(retry)).toBe(500);
    sessionStorage.setItem('resonance-session-id', 'new-session');
    expect(policy.nextRetryDelayInMilliseconds(retry)).toBeNull();
  });
});
