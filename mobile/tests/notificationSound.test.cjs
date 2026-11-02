const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mobileModules } = require('./helpers.cjs');

test('disabled message notifications stay silent; enabled alerts request sound on separate channels', async () => {
  const scheduled = [], channels = [];
  const settings = { privateMessage: false, roomMention: false, downloadsComplete: false };
  const mocks = {
    expo: { requireOptionalNativeModule: () => ({}) },
    'expo-notifications': {
      AndroidImportance: { HIGH: 4 },
      setNotificationHandler() {},
      setNotificationChannelAsync: async (id) => channels.push(id),
      getPermissionsAsync: async () => ({ status: 'granted' }),
      scheduleNotificationAsync: async (notification) => scheduled.push(notification),
    },
    'src/store/appSettingsStore.ts': { useAppSettings: { getState: () => ({ notifications: settings }) } },
  };
  for (const path of ['services/messagingSync', 'lib/serverConnection', 'api/application', 'lib/sessionScope', 'store/auth', 'api/applicationHub', 'api/remoteLogger', 'store/roomStore', 'store/blockedUsersStore']) mocks[`src/${path}.ts`] = {};
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
});
