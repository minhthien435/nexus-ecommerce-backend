import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';

export class QuerySellerDashboardDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([7, 30], { message: 'days must be either 7 or 30' })
  days?: number = 7;
}
