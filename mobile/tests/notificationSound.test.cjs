const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules } = require('./helpers.cjs');

test('disabled message notifications stay silent; enabled alerts request sound on separate channels', async () => {
  const scheduled = [], channels = [], badges = [];
  const settings = { privateMessage: false, roomMention: false, backgroundChat: false, downloadsComplete: false };
  const appState = { currentState: 'active' };
  const mocks = {
    'react-native': { AppState: appState, Platform: { OS: 'android' }, NativeModules: { BackgroundChat: { isRunning: async () => true } } },
    'src/lib/sessionScope.ts': { getSessionScope: () => 'account', sessionGuard: () => () => true },
    expo: { requireOptionalNativeModule: () => ({}) },
    'expo-notifications': {
      AndroidImportance: { HIGH: 4 },
      setNotificationHandler() {},
      setNotificationChannelAsync: async (id) => channels.push(id),
      getPermissionsAsync: async () => ({ status: 'granted' }),
      scheduleNotificationAsync: async (notification) => scheduled.push(notification),
      setBadgeCountAsync: async (count) => { badges.push(count); return true; },
    },
    'src/store/appSettingsStore.ts': { useAppSettings: { getState: () => ({ notifications: settings }) } },
    'src/store/conversationStore.ts': {},
  };
  for (const path of ['services/messagingSync', 'lib/serverConnection', 'api/application', 'store/auth', 'api/applicationHub', 'api/remoteLogger', 'store/roomStore', 'store/blockedUsersStore']) mocks[`src/${path}.ts`] = {};
  const service = mobileModules(mocks)('src/services/notificationService.ts');
  await service.initNotifications();
  await service.notifyPrivateMessage('peer', 'test');
  await service.notifyRoomMention('room', 'peer', 'test');
  await service.notifyDownloadComplete('test');
  assert.equal(scheduled.length, 0);
  Object.assign(settings, { privateMessage: true, roomMention: true, downloadsComplete: true });
  await service.notifyPrivateMessage('peer', 'test');
  await service.notifyRoomMention('room', 'peer', 'test');
  await service.notifyDownloadComplete('test');
  assert.deepEqual(scheduled.map(n => n.content.sound), ['default', 'default', 'default']);
  assert.equal(new Set(scheduled.map(n => n.trigger.channelId)).size, 3);
  assert.ok(scheduled.every(n => channels.includes(n.trigger.channelId)));
  settings.backgroundChat = true;
  appState.currentState = 'background';
  await service.notifyPrivateMessage('peer', 'background');
  await service.notifyRoomMention('room', 'peer', 'background');
  assert.equal(scheduled.length, 3, 'native service owns background chat alerts');
  await Promise.all([service.updateMessageBadge(1), service.updateMessageBadge(4)]);
  assert.deepEqual(badges, [4]);
  await service.updateMessageBadge(0);
  assert.deepEqual(badges, [4, 0]);
});

test('reading a thread dismisses only its older delivered alerts', async () => {
  let account = 'one';
  let now = 100;
  const presented = [];
  const dismissed = [];
  const load = mobileModules({
    expo: { requireOptionalNativeModule: () => ({}) },
    'expo-notifications': {
      getPresentedNotificationsAsync: async () => presented,
      dismissNotificationAsync: async (id) => { dismissed.push(id); },
    },
    'src/lib/sessionScope.ts': { getSessionScope: () => account, sessionGuard: () => () => true },
  }, { Date: { now: () => now } });
  const { dismissMessageAlerts, messageAlertData, wasMessageAlertRead } = load('src/services/messageAlerts.ts');
  const present = (identifier, data) => presented.push({ request: { identifier, content: { data } } });
  const older = messageAlertData('pm', 'alice');
  present('pm', older);
  present('room', messageAlertData('room', 'alice'));
  present('other-peer', messageAlertData('pm', 'bob'));
  present('transfer', {});
  account = 'two';
  present('other-account', messageAlertData('pm', 'alice'));
  account = 'one';
  now = 101;
  present('newer', messageAlertData('pm', 'alice'));
  await dismissMessageAlerts('pm', 'alice', 100);
  assert.deepEqual(dismissed, ['pm']);
  assert.equal(wasMessageAlertRead(older), true);
  assert.equal(wasMessageAlertRead(presented.at(-1).request.content.data), false);
  await dismissMessageAlerts('room', 'alice');
  assert.deepEqual(dismissed, ['pm', 'room']);
});
