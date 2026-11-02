import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class UpdateCartItemDto {
  @IsUUID()
  skuId: string;

  @IsInt()
  @Min(0)
  @Max(2147483647)
  quantity: number;
}
