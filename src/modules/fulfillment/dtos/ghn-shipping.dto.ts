import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export interface GhnItemPayload {
  name: string;
  code?: string;
  quantity: number;
  price?: number;
  weight?: number;
}

export interface GhnCreateOrderPayload {
  to_name: string;
  to_phone: string;
  to_address: string;
  to_ward_code: string;
  to_district_id: number;
  weight: number;
  length?: number;
  width?: number;
  height?: number;
  service_type_id?: number;
  payment_type_id?: number;
  required_note?: 'KHONGCHOXEMHANG' | 'CHOXEMHANGKHONGTHU' | 'CHOTOHANG';
  items?: GhnItemPayload[];
  client_order_code?: string;
  note?: string;
}

export interface GhnCreateOrderResponse {
  order_code: string;
  total_fee: number;
  expected_delivery_time?: string;
  trans_type?: string;
  print_url?: string;
}

export class GhnWebhookDto {
  @IsNotEmpty({ message: 'OrderCode không được để trống' })
  @IsString()
  OrderCode: string;

  @IsNotEmpty({ message: 'Status không được để trống' })
  @IsString()
  Status: string;

  @IsOptional()
  @IsString()
  Time?: string;

  @IsOptional()
  @IsNumber()
  CODAmount?: number;

  @IsOptional()
  @IsString()
  Reason?: string;

  @IsOptional()
  @IsString()
  Warehouse?: string;
}

export class GhnShipOrderResponseDto {
  orderId: string;
  status: 'SHIPPED';
  trackingCode: string;
  carrierName: string;
  totalFee?: number;
  expectedDeliveryTime?: string;
  printUrl?: string;
  updatedAt: Date;
}
