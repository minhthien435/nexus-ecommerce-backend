import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class WishlistQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(2_147_483_647) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
