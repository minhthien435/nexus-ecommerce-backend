import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const RESOLVE_DISPUTE_DECISIONS = [
  'ACCEPTED_REFUND',
  'REJECTED_PAY_SELLER',
] as const;

export type ResolveDisputeDecision = (typeof RESOLVE_DISPUTE_DECISIONS)[number];

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ResolveOrderDisputeDto {
  @IsIn(RESOLVE_DISPUTE_DECISIONS, {
    message: `Quyết định phải là một trong các giá trị: ${RESOLVE_DISPUTE_DECISIONS.join(', ')}`,
  })
  decision: ResolveDisputeDecision;

  @Transform(trim)
  @IsString({ message: 'Ghi chú quyết định phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Ghi chú quyết định không được để trống' })
  @MinLength(5, { message: 'Ghi chú quyết định phải có ít nhất 5 ký tự' })
  @MaxLength(2000, {
    message: 'Ghi chú quyết định không được vượt quá 2000 ký tự',
  })
  staffDecisionNote: string;
}
