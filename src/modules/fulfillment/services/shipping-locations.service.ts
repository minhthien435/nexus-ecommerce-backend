import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GhnClientService } from './ghn-client.service.js';
import { ShippingLocationCacheService } from './shipping-location-cache.service.js';

export type ShippingLocation = { code: string; name: string };

@Injectable()
export class ShippingLocationsService {
  constructor(
    private readonly ghn: GhnClientService,
    private readonly cache: ShippingLocationCacheService,
  ) {}

  provinces() {
    return this.lookup('province');
  }
  districts(provinceId: number) {
    return this.lookup('district', provinceId);
  }
  wards(districtId: number) {
    return this.lookup('ward', districtId);
  }

  private async lookup(
    kind: 'province' | 'district' | 'ward',
    parentId?: number,
  ): Promise<ShippingLocation[]> {
    if (
      kind !== 'province' &&
      (!Number.isSafeInteger(parentId) ||
        parentId! < 1 ||
        parentId! > 2147483647)
    )
      throw new BadRequestException('A positive GHN parent ID is required');
    const key = `shipping:locations:v1:${kind}:${parentId ?? 'all'}`;
    const cached = await this.cache.get<ShippingLocation[]>(key);
    if (cached) return cached;
    const query =
      kind === 'province'
        ? ''
        : `?${kind === 'district' ? 'province' : 'district'}_id=${parentId}`;
    const data = await this.ghn.request<Array<Record<string, unknown>>>(
      `master-data/${kind}${query}`,
    );
    const fields = {
      province: ['ProvinceID', 'ProvinceName'],
      district: ['DistrictID', 'DistrictName'],
      ward: ['WardCode', 'WardName'],
    }[kind];
    if (
      !Array.isArray(data) ||
      data.some(
        (row) =>
          !row ||
          !/^\d+$/.test(String(row[fields[0]])) ||
          typeof row[fields[1]] !== 'string' ||
          !row[fields[1]],
      )
    )
      throw new ServiceUnavailableException(
        'GHN returned invalid location data',
      );
    const result = data.map((row) => ({
      code: String(row[fields[0]]),
      name: row[fields[1]] as string,
    }));
    await this.cache.set(key, result);
    return result;
  }
}
