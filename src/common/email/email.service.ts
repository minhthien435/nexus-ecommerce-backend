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
}
