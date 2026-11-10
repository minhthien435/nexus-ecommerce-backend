import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsMimeType,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class OpenConversationDto {
  @IsUUID() shopId: string;
  @IsOptional() @IsString() @MaxLength(180) productSlug?: string;
  @IsOptional() @IsString() @MaxLength(50) orderNumber?: string;
}

export class ChatImageDto {
  @IsUrl({ require_protocol: true }) url: string;
  @IsString() @MaxLength(500) key: string;
  @IsInt() @Min(1) @Max(5 * 1024 * 1024) size: number;
  @IsMimeType() mimeType: string;
}

export class SendMessageDto {
  @IsUUID() clientMessageId: string;
  @IsIn(['TEXT', 'IMAGE']) type: 'TEXT' | 'IMAGE';
  @ValidateIf((o: SendMessageDto) => o.type === 'TEXT')
  @IsString()
  @Length(1, 4000)
  text?: string;
  @ValidateIf((o: SendMessageDto) => o.type === 'IMAGE')
  @ValidateNested()
  @Type(() => ChatImageDto)
  image?: ChatImageDto;
}

export class SocketSendMessageDto {
  @IsUUID() conversationId: string;
  @ValidateNested() @Type(() => SendMessageDto) message: SendMessageDto;
}

export class HistoryQueryDto {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 30;
}
