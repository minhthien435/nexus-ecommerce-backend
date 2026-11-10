import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { FunctionDeclaration } from '@google/genai';
import { optionalText, strictObject } from '../dtos/ai-chat.dto.js';
export const TRACK_MY_ORDER_DECLARATION: FunctionDeclaration = {
  name: 'track_my_order',
  description:
    'Read status and GHN tracking code of an order owned by the authenticated buyer.',
  parametersJsonSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { orderNumber: { type: 'string', maxLength: 50 } },
    required: ['orderNumber'],
  },
};
@Injectable()
export class TrackMyOrderTool {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async execute(value: unknown, verifiedUserId?: string) {
    if (!verifiedUserId)
      throw new UnauthorizedException({
        errorCode: 'AI_ORDER_LOGIN_REQUIRED',
        message: 'Vui lòng đăng nhập để tra đơn hàng.',
      });
    const args = strictObject(value, ['orderNumber']);
    const orderNumber = optionalText(args.orderNumber, 50);
    if (!orderNumber) throw new BadRequestException('orderNumber is required');
    const rows = await this.db.query<
      Array<{ status: string; trackingCode: string | null }>
    >(
      `SELECT status, CASE WHEN upper(carrier_name) = 'GHN' THEN tracking_code ELSE NULL END AS "trackingCode"
       FROM commerce.orders WHERE order_number = $1 AND buyer_id = $2::uuid LIMIT 1`,
      [orderNumber, verifiedUserId],
    );
    return rows[0] ?? null;
  }
}
