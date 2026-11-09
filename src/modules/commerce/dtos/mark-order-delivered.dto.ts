import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class MarkOrderDeliveredDto {
  @IsString({ message: 'Lý do xác nhận giao hàng phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Lý do xác nhận giao hàng không được để trống' })
  @MinLength(5, { message: 'Lý do phải có ít nhất 5 ký tự' })
  @MaxLength(500, { message: 'Lý do không được vượt quá 500 ký tự' })
  reason: string;
}
