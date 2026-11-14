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

  async sendAuctionWon(input: {
    recipient: string;
    winnerName?: string;
    auctionCode: string;
    productTitle: string;
    finalPrice: string;
    currency: string;
    orderId: string;
    orderNumber: string;
    paymentDeadlineAt: Date;
  }): Promise<void> {
    const deadline = input.paymentDeadlineAt.toISOString();
    const formattedPrice = `${Number(input.finalPrice).toLocaleString('vi-VN')} ${input.currency}`;
    const name = input.winnerName ? `Chào ${input.winnerName},` : 'Xin chào,';
    try {
      await this.transporter.sendMail({
        from: this.mailFrom,
        to: input.recipient,
        subject: `[Nexus] Chúc mừng! Bạn đã trúng đấu giá phiên ${input.auctionCode}`,
        text: [
          name,
          `Chúc mừng bạn đã chiến thắng phiên đấu giá ${input.auctionCode}!`,
          `Sản phẩm: ${input.productTitle}`,
          `Giá trúng: ${formattedPrice}`,
          `Mã đơn hàng: ${input.orderNumber}`,
          `Hạn chót thanh toán: ${deadline} (trong vòng 24 giờ).`,
          'Vui lòng truy cập hệ thống để thanh toán đơn hàng trước thời hạn để không bị trừ điểm uy tín.',
        ].join('\n'),
        html: [
          '<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">',
          `<h2 style="color: #F26A21;">Chúc mừng bạn đã trúng đấu giá!</h2>`,
          `<p>${this.escapeHtml(name)}</p>`,
          `<p>Bạn đã trả mức giá cao nhất và chiến thắng phiên đấu giá <strong>${this.escapeHtml(input.auctionCode)}</strong>.</p>`,
          '<div style="background: #f9f9f9; padding: 16px; border-radius: 4px; margin: 16px 0;">',
          `<p style="margin: 4px 0;"><strong>Sản phẩm:</strong> ${this.escapeHtml(input.productTitle)}</p>`,
          `<p style="margin: 4px 0;"><strong>Giá trúng:</strong> <span style="color: #DC2626; font-size: 18px; font-weight: bold;">${this.escapeHtml(formattedPrice)}</span></p>`,
          `<p style="margin: 4px 0;"><strong>Mã đơn hàng:</strong> ${this.escapeHtml(input.orderNumber)}</p>`,
          `<p style="margin: 4px 0;"><strong>Hạn chót thanh toán:</strong> <span style="color: #C2410C; font-weight: bold;">${deadline} (24 giờ)</span></p>`,
          '</div>',
          '<p>Vui lòng đăng nhập vào Nexus và thanh toán đơn hàng trước thời hạn trên. Sau 24 giờ nếu chưa thanh toán, đơn hàng sẽ bị hủy tự động và tài khoản sẽ bị trừ 30 điểm uy tín.</p>',
          '</div>',
        ].join(''),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Đã quyết toán đấu giá nhưng không thể gửi email thông báo trúng đấu giá.',
      );
    }
  }

  async sendAuctionPaymentTimeout(input: {
    recipient: string;
    winnerName?: string;
    auctionCode: string;
    orderNumber: string;
    penaltyPoints: number;
  }): Promise<void> {
    const name = input.winnerName ? `Chào ${input.winnerName},` : 'Xin chào,';
    try {
      await this.transporter.sendMail({
        from: this.mailFrom,
        to: input.recipient,
        subject: `[Nexus] Đơn hàng đấu giá ${input.orderNumber} đã bị hủy do quá hạn thanh toán`,
        text: [
          name,
          `Đơn hàng ${input.orderNumber} thuộc phiên đấu giá ${input.auctionCode} đã bị hủy tự động do quá thời hạn 24 giờ.`,
          `Hệ thống đã áp dụng mức phạt trừ ${input.penaltyPoints} điểm uy tín vào tài khoản của bạn.`,
          'Nếu điểm uy tín dưới 50 điểm, quyền tham gia đấu giá sẽ bị hạn chế.',
          'Vui lòng đăng nhập vào tài khoản Nexus để kiểm tra trạng thái và lịch sử uy tín của bạn.',
        ].join('\n'),
        html: [
          '<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">',
          `<h2 style="color: #DC2626;">Thông báo hủy đơn hàng đấu giá do quá hạn</h2>`,
          `<p>${this.escapeHtml(name)}</p>`,
          `<p>Đơn hàng <strong>${this.escapeHtml(input.orderNumber)}</strong> cho phiên đấu giá <strong>${this.escapeHtml(input.auctionCode)}</strong> đã bị hủy do quá thời hạn thanh toán 24 giờ.</p>`,
          '<div style="background: #FFF1F2; border-left: 4px solid #DC2626; padding: 12px; margin: 16px 0;">',
          `<p style="margin: 0; color: #991B1B;"><strong>Mức phạt:</strong> Tài khoản của bạn đã bị trừ <strong>${input.penaltyPoints} điểm uy tín</strong>.</p>`,
          '</div>',
          '<p>Theo quy chế sàn thương mại điện tử Nexus, người thắng đấu giá không thanh toán trong 24 giờ sẽ bị xử phạt điểm uy tín. Nếu điểm uy tín rơi xuống dưới 50 điểm, bạn sẽ bị khóa quyền tham gia các phiên đấu giá tiếp theo.</p>',
          '<p>Vui lòng đăng nhập hệ thống để kiểm tra chi tiết thông tin tài khoản.</p>',
          '</div>',
        ].join(''),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Đã hủy đơn do quá hạn nhưng không thể gửi email thông báo phạt.',
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
