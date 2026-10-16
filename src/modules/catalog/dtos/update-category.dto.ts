import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class UpdateCategoryDto {
  @IsOptional()
  @IsString({ message: 'Tên danh mục phải là chuỗi' })
  name?: string;

  @IsOptional()
  @IsString({ message: 'Slug danh mục phải là chuỗi' })
  slug?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Mã danh mục cha (parentId) phải là UUID hợp lệ' })
  parentId?: string | null;

  @IsOptional()
  @IsInt({ message: 'Thứ tự sắp xếp phải là số nguyên' })
  @Min(0, { message: 'Thứ tự sắp xếp phải lớn hơn hoặc bằng 0' })
  sortOrder?: number;

  @IsOptional()
  @IsBoolean({ message: 'Trạng thái hoạt động phải là boolean' })
  isActive?: boolean;
}
