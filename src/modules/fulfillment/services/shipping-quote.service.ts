import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GhnClientService } from './ghn-client.service.js';

@Injectable()
export class ShippingQuoteService {
  constructor(private readonly ghn: GhnClientService) {}

  async quoteNewAddress(input: {
    recipientName: string;
    recipientPhone: string;
    addressLine: string;
    provinceName: string;
    wardName: string;
    weightGrams: number;
    content: string;
  }) {
    const result = await this.ghn.previewNewAddress(input);
    return {
      ...result,
      currency: 'VND' as const,
      weightGrams: input.weightGrams,
    };
  }

  async quote(input: {
    districtId: number;
    wardCode: string;
    weightGrams: number;
  }) {
    if (
      !Number.isSafeInteger(input.districtId) ||
      input.districtId < 1 ||
      input.districtId > 2147483647 ||
      typeof input.wardCode !== 'string' ||
      !/^\d{1,20}$/.test(input.wardCode) ||
      !Number.isSafeInteger(input.weightGrams) ||
      input.weightGrams < 1 ||
      input.weightGrams > 5000000
    ) {
      throw new BadRequestException({
        errorCode: 'INVALID_SHIPPING_INPUT',
        message:
          'Valid GHN district, ward and positive parcel weight are required',
      });
    }
    const origin = await this.ghn.getShopOrigin();
    const services = await this.ghn.request<
      Array<{ service_id: number; service_type_id: number }>
    >('v2/shipping-order/available-services', {
      shop_id: origin.shopId,
      from_district: origin.districtId,
      to_district: input.districtId,
    });
    const service = Array.isArray(services)
      ? services.find(
          (entry) =>
            entry?.service_type_id === (input.weightGrams < 20000 ? 2 : 5),
        )
      : undefined;
    if (!service)
      throw new ServiceUnavailableException({
        errorCode: 'GHN_SERVICE_UNAVAILABLE',
        message: 'No supported GHN service for this route and weight',
      });
    const route = {
      from_district_id: origin.districtId,
      from_ward_code: origin.wardCode,
      to_district_id: input.districtId,
      to_ward_code: input.wardCode,
      service_type_id: service.service_type_id,
    };
    const fee = await this.ghn.request<{ total: number }>(
      'v2/shipping-order/fee',
      { ...route, weight: input.weightGrams, insurance_value: 0 },
    );
    if (!Number.isSafeInteger(fee.total) || fee.total < 0)
      throw new ServiceUnavailableException({
        errorCode: 'GHN_FEE_INVALID',
        message: 'GHN returned an invalid shipping fee',
      });
    let expectedDeliveryTime: string | null = null;
    try {
      const estimate = await this.ghn.request<{ leadtime: number }>(
        'v2/shipping-order/leadtime',
        route,
      );
      const date = new Date(estimate.leadtime * 1000);
      if (
        Number.isFinite(estimate.leadtime) &&
        estimate.leadtime > 0 &&
        Number.isFinite(date.getTime())
      )
        expectedDeliveryTime = date.toISOString();
    } catch {
      /* Estimate is optional; a validated fee is still usable. */
    }
    return {
      fee: fee.total,
      currency: 'VND' as const,
      weightGrams: input.weightGrams,
      serviceTypeId: service.service_type_id,
      expectedDeliveryTime,
    };
  }
}
