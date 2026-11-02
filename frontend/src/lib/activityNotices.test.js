import { subscribeNotices, toast } from './activityNotices';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  formatNotification,
} from './notificationTypes';

describe('action notices', () => {
  it('delivers all action severities as readable notification centre events', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeNotices(listener);
    for (const [method, type] of [
      ['success', 'ActionSuccess'],
      ['info', 'ActionInfo'],
      ['warn', 'ActionWarning'],
      ['error', 'ActionError'],
    ]) {
      toast[method]('Action details', { autoClose: 1_500 });
      expect(listener).toHaveBeenLastCalledWith(type, {
        message: 'Action details',
      });
      expect(DEFAULT_NOTIFICATION_SETTINGS[type]).toBe(true);
      expect(formatNotification(type, { message: 'Action details' }).text).toBe(
        'Action details',
      );
    }

    unsubscribe();
    listener.mockClear();
    toast.error('After unmount');
    expect(listener).not.toHaveBeenCalled();
  });

  it('converts errors and structured responses to readable text', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeNotices(listener);
    toast.error(new Error('Failed'));
    expect(listener).toHaveBeenLastCalledWith('ActionError', {
      message: 'Failed',
    });
    toast.error({ detail: 'Rejected' });
    expect(listener).toHaveBeenLastCalledWith('ActionError', {
      message: '{"detail":"Rejected"}',
    });
    unsubscribe();
  });
});
