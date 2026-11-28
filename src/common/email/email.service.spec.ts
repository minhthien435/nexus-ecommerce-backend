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
      connectionTimeout: 3_000,
      greetingTimeout: 3_000,
      socketTimeout: 5_000,
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

  it('sends complete, escaped shop-status notification content', async () => {
    mailMocks.sendMail.mockResolvedValue({ messageId: 'message-2' });
    const service = createService();
    const statusChangedAt = new Date('2026-11-08T03:00:00.000Z');

    await service.sendShopStatusChanged({
      recipient: 'seller@example.com',
      shopName: '<Shop>',
      status: 'SUSPENDED',
      reason: 'Policy <review>',
      statusChangedAt,
    });

    expect(mailMocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'seller@example.com',
        text: expect.stringMatching(
          /SUSPENDED[\s\S]*Policy <review>[\s\S]*2026-11-08T03:00:00.000Z[\s\S]*khiếu nại/,
        ),
        html: expect.stringMatching(/&lt;Shop&gt;[\s\S]*Policy &lt;review&gt;/),
      }),
    );
  });

  it('sends refund completion details without exposing the full account number', async () => {
    mailMocks.sendMail.mockResolvedValue({ messageId: 'message-3' });
    const service = createService();

    await service.sendRefundCompleted({
      recipient: 'buyer@example.com',
      refundCode: 'REF-ORD-1',
      amount: '150000.00',
      currency: 'VND',
      buyerBankName: 'Vietcombank',
      accountLastFour: '6789',
      bankReferenceCode: 'BANK-REF-1',
      processedAt: new Date('2026-11-12T02:00:00.000Z'),
    });

    const mail = mailMocks.sendMail.mock.calls[0][0];
    expect(mail).toEqual(
      expect.objectContaining({
        to: 'buyer@example.com',
        subject: expect.stringContaining('REF-ORD-1'),
        text: expect.stringMatching(
          /150000\.00 VND[\s\S]*Vietcombank[\s\S]*\*\*\*\*6789[\s\S]*BANK-REF-1[\s\S]*2026-11-12T02:00:00.000Z/,
        ),
      }),
    );
    expect(JSON.stringify(mail)).not.toContain('0123456789');
  });

  it('returns a sanitized service-unavailable error when refund email fails', async () => {
    mailMocks.sendMail.mockRejectedValue(new Error('SMTP credential leaked'));
    const service = createService();

    await expect(
      service.sendRefundCompleted({
        recipient: 'buyer@example.com',
        refundCode: 'REF-ORD-1',
        amount: '150000.00',
        currency: 'VND',
        buyerBankName: 'Vietcombank',
        accountLastFour: '6789',
        bankReferenceCode: 'BANK-REF-1',
        processedAt: new Date('2026-11-12T02:00:00.000Z'),
      }),
    ).rejects.toEqual(
      new ServiceUnavailableException(
        'Đã hoàn tất chuyển khoản nhưng không thể gửi email thông báo.',
      ),
    );
  });

  it('sends auction won email with formatted price, deadline and orderNumber', async () => {
    mailMocks.sendMail.mockResolvedValue({ messageId: 'message-4' });
    const service = createService();
    const deadline = new Date('2026-11-15T10:00:00.000Z');

    await service.sendAuctionWon({
      recipient: 'winner@example.com',
      winnerName: 'Duy Nguyen',
      auctionCode: 'AUC-12345',
      productTitle: 'Vintage Watch <Gold Edition>',
      finalPrice: '5000000.00',
      currency: 'VND',
      orderId: '00000000-0000-0000-0000-000000000001',
      orderNumber: 'ORD-AUC-12345',
      paymentDeadlineAt: deadline,
    });

    const mail = mailMocks.sendMail.mock.calls[0][0];
    expect(mail).toEqual(
      expect.objectContaining({
        to: 'winner@example.com',
        subject: expect.stringContaining('AUC-12345'),
        text: expect.stringMatching(
          /Chào Duy Nguyen[\s\S]*Vintage Watch <Gold Edition>[\s\S]*ORD-AUC-12345[\s\S]*2026-11-15T10:00:00.000Z/,
        ),
        html: expect.stringMatching(/Vintage Watch &lt;Gold Edition&gt;/),
      }),
    );
  });

  it('returns a sanitized service-unavailable error when auction won email fails', async () => {
    mailMocks.sendMail.mockRejectedValue(new Error('Connection lost'));
    const service = createService();

    await expect(
      service.sendAuctionWon({
        recipient: 'winner@example.com',
        auctionCode: 'AUC-12345',
        productTitle: 'Vintage Watch',
        finalPrice: '5000000.00',
        currency: 'VND',
        orderId: '00000000-0000-0000-0000-000000000001',
        orderNumber: 'ORD-AUC-12345',
        paymentDeadlineAt: new Date(),
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('sends auction payment timeout email with penalty information', async () => {
    mailMocks.sendMail.mockResolvedValue({ messageId: 'message-5' });
    const service = createService();

    await service.sendAuctionPaymentTimeout({
      recipient: 'winner@example.com',
      winnerName: 'Duy Nguyen',
      auctionCode: 'AUC-12345',
      orderNumber: 'ORD-AUC-12345',
      penaltyPoints: 30,
    });

    const mail = mailMocks.sendMail.mock.calls[0][0];
    expect(mail).toEqual(
      expect.objectContaining({
        to: 'winner@example.com',
        subject: expect.stringContaining('ORD-AUC-12345'),
        text: expect.stringMatching(/AUC-12345[\s\S]*30 điểm uy tín/),
        html: expect.stringMatching(/30 điểm uy tín/),
      }),
    );
  });

  it('skips SMTP delivery immediately when EMAIL_DISABLED is true', async () => {
    const service = new EmailService(
      new ConfigService({
        EMAIL_DISABLED: 'true',
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_PORT: '465',
        SMTP_SECURE: 'true',
        SMTP_USER: 'sender@example.com',
        SMTP_PASSWORD: 'app-password',
        MAIL_FROM: 'Nexus <sender@example.com>',
      }),
    );

    await service.sendRefundCompleted({
      recipient: 'buyer@example.com',
      refundCode: 'REF-ORD-1',
      amount: '150000.00',
      currency: 'VND',
      buyerBankName: 'Vietcombank',
      accountLastFour: '6789',
      bankReferenceCode: 'BANK-REF-1',
      processedAt: new Date('2026-11-12T02:00:00.000Z'),
    });

    expect(mailMocks.sendMail).not.toHaveBeenCalled();
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
