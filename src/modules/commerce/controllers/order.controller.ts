import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../../identity/auth/guards/access-token.guard.js';
import { Permissions } from '../../identity/rbac/decorators/permissions.decorator.js';
import { PermissionsGuard } from '../../identity/rbac/guards/permissions.guard.js';
import { CreateCheckoutDto } from '../dtos/create-checkout.dto.js';
import { QueryOrdersDto } from '../dtos/query-orders.dto.js';
import { UpdateBuyerRefundAccountDto } from '../dtos/update-buyer-refund-account.dto.js';
import { OrderRefundService } from '../services/order-refund.service.js';
import { OrderService } from '../services/order.service.js';

@Controller('api/v1/commerce/orders')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly refundService?: OrderRefundService,
  ) {}

  @Post('shipping-quote')
  @Permissions('CHECKOUT.START')
  async shippingQuote(
    @CurrentUserId() userId: string,
    @Body() dto: CreateCheckoutDto,
  ) {
    return {
      success: true as const,
      statusCode: HttpStatus.CREATED,
      data: await this.orderService.quoteCart(userId, dto),
    };
  }

  @Post('checkout')
  @Permissions('CHECKOUT.START')
  async checkout(
    @CurrentUserId() userId: string,
    @Body() dto: CreateCheckoutDto,
  ) {
    const result = await this.orderService.checkout(userId, dto);
    return {
      success: true as const,
      statusCode: HttpStatus.CREATED,
      message: 'Tạo phiên thanh toán thành công',
      data: result,
    };
  }

  @Get()
  @Permissions('ORDER.VIEW')
  async getOrders(
    @CurrentUserId() userId: string,
    @Query() query: QueryOrdersDto,
  ) {
    const result = await this.orderService.getBuyerOrders(userId, query);
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Lấy danh sách đơn hàng thành công',
      data: result.data,
      meta: result.meta,
    };
  }

  @Get(':id')
  @Permissions('ORDER.VIEW')
  async getOrderById(
    @CurrentUserId() userId: string,
    @Param('id') orderReference: string,
  ) {
    const result = await this.orderService.getOrderById(userId, orderReference);
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Lấy chi tiết đơn hàng thành công',
      data: result,
    };
  }

  @Patch(':id/cancel')
  @Permissions('ORDER.CANCEL')
  async cancelOrder(
    @CurrentUserId() userId: string,
    @Param('id', new ParseUUIDPipe()) orderId: string,
  ) {
    const result = await this.orderService.cancelOrder(userId, orderId);
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Hủy đơn hàng thành công',
      data: result,
    };
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @Permissions('ORDER.VIEW')
  async completeOrder(
    @CurrentUserId() userId: string,
    @Param('id') orderReference: string,
  ) {
    const result = await this.orderService.confirmOrderDeliveryByBuyer(
      userId,
      orderReference,
    );
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Xác nhận nhận hàng thành công. Đơn hàng đã hoàn tất.',
      data: result,
    };
  }

  @Get(':id/dispute')
  @Permissions('ORDER.VIEW')
  async getOrderDispute(
    @CurrentUserId() userId: string,
    @Param('id') orderReference: string,
  ) {
    const result = await this.orderService.getOrderDisputeByBuyer(
      userId,
      orderReference,
    );
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: result
        ? 'Lấy thông tin khiếu nại của đơn hàng thành công'
        : 'Đơn hàng chưa có khiếu nại nào',
      data: result,
    };
  }

  @Patch(':id/refund-account')
  @Permissions('ORDER.VIEW')
  async updateRefundAccount(
    @CurrentUserId() userId: string,
    @Param('id', new ParseUUIDPipe()) orderId: string,
    @Body() dto: UpdateBuyerRefundAccountDto,
  ) {
    if (!this.refundService) {
      throw new InternalServerErrorException(
        'OrderRefundService is not available',
      );
    }
    const result = await this.refundService.updateBuyerRefundAccount(
      orderId,
      userId,
      dto,
    );
    return {
      success: true as const,
      statusCode: HttpStatus.OK,
      message: 'Cập nhật thông tin tài khoản hoàn tiền thành công',
      data: result,
    };
  }
}
