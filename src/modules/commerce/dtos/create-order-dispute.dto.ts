import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  DISPUTE_REASON_CATEGORIES,
  type DisputeReasonCategory,
} from '../domain/entities/order-dispute.entity.js';

export class CreateOrderDisputeDto {
  @IsIn(DISPUTE_REASON_CATEGORIES, {
    message: `Lý do khiếu nại phải là một trong các giá trị: ${DISPUTE_REASON_CATEGORIES.join(', ')}`,
  })
  reasonCategory: DisputeReasonCategory;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Mô tả khiếu nại phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Mô tả khiếu nại không được để trống' })
  @MinLength(5, { message: 'Mô tả khiếu nại phải có ít nhất 5 ký tự' })
  @MaxLength(2000, {
    message: 'Mô tả khiếu nại không được vượt quá 2000 ký tự',
  })
  evidenceDescription: string;

  @IsOptional()
  @IsArray({ message: 'Danh sách ảnh bằng chứng phải là một mảng' })
  @ArrayMaxSize(5, { message: 'Tối đa 5 ảnh bằng chứng' })
  @IsUrl(
    { require_protocol: true },
    {
      each: true,
      message:
        'Mỗi ảnh bằng chứng phải là một URL hợp lệ có giao thức (http/https)',
    },
  )
  evidenceImages?: string[];
}
