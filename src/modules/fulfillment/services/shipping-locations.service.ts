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

  newProvinces() {
    return this.lookupNew('province');
  }

  newWards(provinceId: number) {
    return this.lookupNew('ward', provinceId);
  }

  private async lookupNew(
    kind: 'province' | 'ward',
    provinceId?: number,
  ): Promise<ShippingLocation[]> {
    if (
      kind === 'ward' &&
      (!Number.isSafeInteger(provinceId) ||
        provinceId! < 1 ||
        provinceId! > 2147483647)
    )
      throw new BadRequestException('A positive GHN province ID is required');
    const key = `shipping:locations:v3:${kind}:${provinceId ?? 'all'}`;
    const cached = await this.cache.get<ShippingLocation[]>(key);
    if (cached) return cached;
    const path =
      kind === 'province'
        ? 'v3/master-data/province/all?limit=200'
        : `v3/master-data/ward/all-by-province-id?province_id=${provinceId}&limit=200`;
    const data =
      await this.ghn.request<
        Array<{ _id: number; name: string; status: number }>
      >(path);
    if (
      !Array.isArray(data) ||
      data.some(
        (row) =>
          !row ||
          !Number.isSafeInteger(row._id) ||
          row._id < 1 ||
          typeof row.name !== 'string' ||
          !row.name.trim(),
      )
    )
      throw new ServiceUnavailableException(
        'GHN returned invalid location data',
      );
    const locations = data
      .filter((row) => row.status === 1)
      .map((row) => ({ code: String(row._id), name: row.name }));
    await this.cache.set(key, locations);
    return locations;
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
    if (cached) return this.filterSandboxProvince(kind, cached);
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
    const result = this.filterSandboxProvince(
      kind,
      data.map((row) => ({
        code: String(row[fields[0]]),
        name: row[fields[1]] as string,
      })),
    );
    await this.cache.set(key, result);
    return result;
  }

  private filterSandboxProvince(kind: string, locations: ShippingLocation[]) {
    if (kind !== 'province') return locations;
    return locations.filter(
      ({ name }) =>
        !['test - alert - tỉnh - 001', 'hà nội 02'].includes(
          name.trim().toLocaleLowerCase('vi'),
        ),
    );
  }
}
