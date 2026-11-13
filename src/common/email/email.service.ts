import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly transporter: Transporter;
  private readonly mailFrom: string;

  constructor(private readonly config: ConfigService) {
    const port = Number(this.config.getOrThrow<string>('SMTP_PORT'));
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error('SMTP_PORT must be a valid TCP port');
    }

    const secureValue = this.config
      .getOrThrow<string>('SMTP_SECURE')
      .trim()
      .toLowerCase();
    if (!['true', 'false'].includes(secureValue)) {
      throw new Error('SMTP_SECURE must be true or false');
    }

    const user = this.config.getOrThrow<string>('SMTP_USER');
    this.mailFrom = this.config.getOrThrow<string>('MAIL_FROM');
    this.transporter = nodemailer.createTransport({
      host: this.config.getOrThrow<string>('SMTP_HOST'),
      port,
      secure: secureValue === 'true',
      auth: {
        user,
        pass: this.config.getOrThrow<string>('SMTP_PASSWORD'),
      },
    });
  }

  async sendPasswordResetOtp(
    recipient: string,
    otp: string,
    expiresInMinutes: number,
  ): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.mailFrom,
        to: recipient,
        subject: 'Mã xác minh đặt lại mật khẩu Nexus',
        text: [
          `Mã OTP của bạn là: ${otp}`,
          `Mã có hiệu lực trong ${expiresInMinutes} phút.`,
          'Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.',
        ].join('\n'),
        html: [
          '<div style="font-family: Arial, sans-serif">',
          '<h2>Đặt lại mật khẩu Nexus</h2>',
          '<p>Mã xác minh của bạn là:</p>',
          `<p style="font-size: 28px; font-weight: bold; letter-spacing: 6px">${otp}</p>`,
          `<p>Mã có hiệu lực trong ${expiresInMinutes} phút.</p>`,
          '<p>Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.</p>',
          '</div>',
        ].join(''),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Không thể gửi email xác minh. Vui lòng thử lại sau.',
      );
    }
  }

  async sendShopStatusChanged(input: {
    recipient: string;
    shopName: string;
    status: string;
    reason: string;
    statusChangedAt: Date;
  }): Promise<void> {
    const changedAt = input.statusChangedAt.toISOString();
    const appealGuidance =
      'Nếu bạn cho rằng quyết định này chưa chính xác, vui lòng liên hệ bộ phận hỗ trợ Nexus để gửi yêu cầu khiếu nại.';
    try {
      await this.transporter.sendMail({
        from: this.mailFrom,
        to: input.recipient,
        subject: `Trạng thái cửa hàng ${input.shopName} đã thay đổi`,
        text: [
          `Trạng thái mới: ${input.status}`,
          `Lý do: ${input.reason}`,
          `Thời gian thay đổi: ${changedAt}`,
          appealGuidance,
        ].join('\n'),
        html: [
          '<div style="font-family: Arial, sans-serif">',
          `<h2>Trạng thái cửa hàng ${this.escapeHtml(input.shopName)} đã thay đổi</h2>`,
          `<p><strong>Trạng thái mới:</strong> ${this.escapeHtml(input.status)}</p>`,
          `<p><strong>Lý do:</strong> ${this.escapeHtml(input.reason)}</p>`,
          `<p><strong>Thời gian thay đổi:</strong> ${changedAt}</p>`,
          `<p>${appealGuidance}</p>`,
          '</div>',
        ].join(''),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Đã cập nhật trạng thái cửa hàng nhưng không thể gửi email thông báo.',
      );
    }
  }

  async sendRefundCompleted(input: {
    recipient: string;
    refundCode: string;
    amount: string;
    currency: string;
    buyerBankName: string | null;
    accountLastFour: string | null;
    bankReferenceCode: string;
    processedAt: Date;
  }): Promise<void> {
    const processedAt = input.processedAt.toISOString();
    const bankName = input.buyerBankName ?? 'Chưa cung cấp';
    const account = input.accountLastFour
      ? `****${input.accountLastFour}`
      : 'Chưa cung cấp';
    try {
      await this.transporter.sendMail({
        from: this.mailFrom,
        to: input.recipient,
        subject: `Hoàn tiền ${input.refundCode} đã được chuyển`,
        text: [
          `Mã hoàn tiền: ${input.refundCode}`,
          `Số tiền: ${input.amount} ${input.currency}`,
          `Ngân hàng: ${bankName}`,
          `Tài khoản nhận: ${account}`,
          `Mã giao dịch ngân hàng: ${input.bankReferenceCode}`,
          `Thời gian xử lý: ${processedAt}`,
        ].join('\n'),
        html: [
          '<div style="font-family: Arial, sans-serif">',
          '<h2>Hoàn tiền đã được chuyển</h2>',
          `<p><strong>Mã hoàn tiền:</strong> ${this.escapeHtml(input.refundCode)}</p>`,
          `<p><strong>Số tiền:</strong> ${this.escapeHtml(input.amount)} ${this.escapeHtml(input.currency)}</p>`,
          `<p><strong>Ngân hàng:</strong> ${this.escapeHtml(bankName)}</p>`,
          `<p><strong>Tài khoản nhận:</strong> ${this.escapeHtml(account)}</p>`,
          `<p><strong>Mã giao dịch ngân hàng:</strong> ${this.escapeHtml(input.bankReferenceCode)}</p>`,
          `<p><strong>Thời gian xử lý:</strong> ${processedAt}</p>`,
          '</div>',
        ].join(''),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Đã hoàn tất chuyển khoản nhưng không thể gửi email thông báo.',
      );
    }
  }

  async sendNotification(input: {
    recipient: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.mailFrom,
        to: input.recipient,
        subject: input.subject,
        text: input.text,
        html:
          input.html ??
          `<div style="font-family: Arial, sans-serif"><p>${this.escapeHtml(input.text)}</p></div>`,
      });
    } catch {
      throw new ServiceUnavailableException(
        'Không thể gửi email thông báo. Vui lòng thử lại sau.',
      );
    }
  }

  private escapeHtml(value: string): string {
    return value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[character]!,
    );
  }
}
