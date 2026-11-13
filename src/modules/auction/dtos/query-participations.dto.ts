import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const PARTICIPATION_TABS = ['ALL', 'BIDDING', 'WON'] as const;
export type ParticipationTab = (typeof PARTICIPATION_TABS)[number];

export class QueryParticipationsDto {
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(PARTICIPATION_TABS)
  tab?: ParticipationTab;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) =>
    value === undefined || value === '' ? 1 : Number(value),
  )
  page = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Transform(({ value }) =>
    value === undefined || value === '' ? 12 : Number(value),
  )
  limit = 12;
}
