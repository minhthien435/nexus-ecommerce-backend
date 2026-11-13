import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationService } from './notification.service.js';

const userId = '3ad127eb-609e-4c91-a865-81e8ea924310';
const notificationId = '118dc57d-9132-4b0e-976b-8efb25d02688';
const sourceEventId = '71577522-22b3-48c9-8f93-20b59632001d';

function fixture() {
  const notificationRepo = {
    create: vi.fn((value) => ({
      id: notificationId,
      createdAt: new Date('2026-11-13T00:00:00Z'),
      ...value,
    })),
    save: vi.fn(async (value) => value),
    count: vi.fn().mockResolvedValue(1),
    findAndCount: vi.fn().mockResolvedValue([[], 0]),
    findOne: vi.fn(),
    update: vi.fn(),
  };
  const preferenceRepo = {
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockResolvedValue([]),
    upsert: vi.fn(),
  };
  const gateway = {
    emitToUser: vi.fn(),
    emitUnreadCount: vi.fn(),
  };
  const email = { sendNotification: vi.fn() };
  const service = new NotificationService(
    notificationRepo as never,
    preferenceRepo as never,
    gateway as never,
    email as never,
  );
  return { service, notificationRepo, preferenceRepo, gateway, email };
}

const input = {
  userId,
  type: 'ORDER_PAID',
  title: 'Đơn hàng đã thanh toán',
  content: 'Đơn hàng của bạn đã được thanh toán.',
  sourceEventId,
};

describe('NotificationService', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('stores and emits a PUSH notification with the current unread count', async () => {
    const f = fixture();
    await f.service.notify(input);

    expect(f.notificationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        sourceEventId,
        channel: 'PUSH',
        status: 'SENT',
      }),
    );
    expect(f.gateway.emitToUser).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ id: notificationId, type: 'ORDER_PAID' }),
      1,
    );
  });

  it('skips a disabled preference', async () => {
    const f = fixture();
    f.preferenceRepo.findOne.mockResolvedValue({ isEnabled: false });

    await f.service.notify(input);

    expect(f.notificationRepo.save).not.toHaveBeenCalled();
    expect(f.gateway.emitToUser).not.toHaveBeenCalled();
  });

  it('treats a duplicate source event as an idempotent success', async () => {
    const f = fixture();
    f.notificationRepo.save.mockRejectedValue({ code: '23505' });

    await expect(f.service.notify(input)).resolves.toBeUndefined();
    expect(f.gateway.emitToUser).not.toHaveBeenCalled();
  });

  it('does not propagate database failures to a business caller', async () => {
    const f = fixture();
    f.notificationRepo.save.mockRejectedValue(new Error('database offline'));

    await expect(f.service.notify(input)).resolves.toBeUndefined();
  });

  it('returns 404 when a notification does not belong to the user', async () => {
    const f = fixture();
    f.notificationRepo.findOne.mockResolvedValue(null);

    await expect(
      f.service.markAsRead(userId, notificationId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('marks only unread PUSH notifications for the current user', async () => {
    const f = fixture();
    await f.service.markAllAsRead(userId);

    expect(f.notificationRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ userId, channel: 'PUSH' }),
      expect.objectContaining({ readAt: expect.any(Date) }),
    );
    expect(f.gateway.emitUnreadCount).toHaveBeenCalledWith(userId, 0);
  });

  it('persists and sends an EMAIL delivery when requested', async () => {
    const f = fixture();
    await f.service.notify({
      ...input,
      channels: ['EMAIL'],
      emailPayload: { to: 'buyer@example.com' },
    });

    expect(f.email.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: 'buyer@example.com' }),
    );
    expect(f.notificationRepo.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ channel: 'EMAIL', status: 'SENT' }),
    );
  });
});
