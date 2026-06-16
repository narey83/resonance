const urlBase = (window.urlBase === '/' ? '' : window.urlBase) || '';
const rootUrl = urlBase;
// eslint-disable-next-line n/no-process-env
const apiBaseUrl = process.env.REACT_APP_API_URL || `${rootUrl}/api/v0`;
// eslint-disable-next-line n/no-process-env
const hubBaseUrl = process.env.REACT_APP_HUB_URL || `${rootUrl}/hub`;
// eslint-disable-next-line n/no-process-env
const castAppId = process.env.REACT_APP_CAST_APP_ID || null;
const tokenKey = 'resonance-token';
const refreshTokenKey = 'resonance-refresh-token';
const sessionIdKey = 'resonance-session-id';
const tokenPassthroughValue = 'n/a';
const activeChatKey = 'resonance-active-chat';
const activeRoomKey = 'resonance-active-room';
const activeUserInfoKey = 'resonance-active-user';

export {
  activeChatKey,
  activeRoomKey,
  activeUserInfoKey,
  apiBaseUrl,
  castAppId,
  hubBaseUrl,
  refreshTokenKey,
  rootUrl,
  sessionIdKey,
  tokenKey,
  tokenPassthroughValue,
  urlBase,
};
