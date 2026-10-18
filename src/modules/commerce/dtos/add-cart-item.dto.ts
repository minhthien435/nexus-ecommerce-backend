import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class AddCartItemDto {
  @IsUUID()
  skuId: string;

  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity: number;
}
