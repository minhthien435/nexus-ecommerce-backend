import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailService } from './email.service.js';

const mailMocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: mailMocks.createTransport },
}));

describe('EmailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mailMocks.createTransport.mockReturnValue({
      sendMail: mailMocks.sendMail,
    });
  });

  const createService = () =>
    new EmailService(
      new ConfigService({
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_PORT: '465',
        SMTP_SECURE: 'true',
        SMTP_USER: 'sender@example.com',
        SMTP_PASSWORD: 'app-password',
        MAIL_FROM: 'Nexus <sender@example.com>',
      }),
    );

  it('creates a secure SMTP transport and sends the password-reset OTP', async () => {
    mailMocks.sendMail.mockResolvedValue({ messageId: 'message-1' });
    const service = createService();

    await service.sendPasswordResetOtp('user@example.com', '123456', 15);

    expect(mailMocks.createTransport).toHaveBeenCalledWith({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: 'sender@example.com',
        pass: 'app-password',
      },
    });
    expect(mailMocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Nexus <sender@example.com>',
        to: 'user@example.com',
        subject: 'Mã xác minh đặt lại mật khẩu Nexus',
        text: expect.stringContaining('123456'),
        html: expect.stringContaining('123456'),
      }),
    );
  });

  it('returns a sanitized service-unavailable error when SMTP fails', async () => {
    mailMocks.sendMail.mockRejectedValue(
      new Error('authentication failed for app-password'),
    );
    const service = createService();

    await expect(
      service.sendPasswordResetOtp('user@example.com', '123456', 15),
    ).rejects.toEqual(
      new ServiceUnavailableException(
        'Không thể gửi email xác minh. Vui lòng thử lại sau.',
      ),
    );
  });

  it.each([
    ['SMTP_PORT', 'invalid', 'SMTP_PORT must be a valid TCP port'],
    ['SMTP_SECURE', 'sometimes', 'SMTP_SECURE must be true or false'],
  ])('rejects invalid %s configuration', (key, value, message) => {
    expect(
      () =>
        new EmailService(
          new ConfigService({
            SMTP_HOST: 'smtp.gmail.com',
            SMTP_PORT: '465',
            SMTP_SECURE: 'true',
            SMTP_USER: 'sender@example.com',
            SMTP_PASSWORD: 'app-password',
            MAIL_FROM: 'Nexus <sender@example.com>',
            [key]: value,
          }),
        ),
    ).toThrow(message);
  });
});
