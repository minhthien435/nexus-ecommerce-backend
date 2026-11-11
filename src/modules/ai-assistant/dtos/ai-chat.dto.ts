import { isUUID } from 'class-validator';
import { BadRequestException } from '@nestjs/common';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMime = (typeof IMAGE_MIMES)[number];

export class AiChatDto {
  sessionId!: string;
  message!: string;
  image?: { url: string; key: string };
  context?: { currentPath?: string };
}

export function strictObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new BadRequestException('Invalid or unknown arguments');
  }
  return value as Record<string, unknown>;
}

export function optionalText(value: unknown, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new BadRequestException('Invalid text value');
  }
  return value.trim();
}

export function parseAiChat(value: unknown): AiChatDto {
  try {
    const raw = value as Record<string, unknown> | null;
    if (
      raw &&
      typeof raw === 'object' &&
      ['imageUrl', 'imageBase64', 'imageMimeType'].some((key) => key in raw)
    )
      throw new BadRequestException({
        errorCode: 'AI_IMAGE_INVALID',
        message: 'Ảnh phải được tải lên kho ai/ của Nexus.',
      });
    const input = strictObject(value, [
      'sessionId',
      'message',
      'image',
      'context',
    ]);
    const dto = new AiChatDto();
    if (typeof input.sessionId !== 'string' || !isUUID(input.sessionId))
      throw new Error('sessionId');
    dto.sessionId = input.sessionId;
    if (input.image !== undefined) {
      try {
        const image = strictObject(input.image, ['url', 'key']);
        const url = optionalText(image.url, 2048);
        const key = optionalText(image.key, 512);
        if (!url || !key) throw new Error();
        dto.image = { url, key };
      } catch {
        throw new BadRequestException({
          errorCode: 'AI_IMAGE_INVALID',
          message: 'Ảnh không hợp lệ.',
        });
      }
    }
    if (
      typeof input.message !== 'string' ||
      input.message.length > 1000 ||
      (!input.message.trim() && !dto.image)
    )
      throw new Error('message');
    dto.message = input.message.trim();
    if (input.context !== undefined) {
      const context = strictObject(input.context, ['currentPath']);
      const path = optionalText(context.currentPath, 2048);
      if (path) {
        const decoded = decodeURIComponent(path);
        if (
          !path.startsWith('/') ||
          path.startsWith('//') ||
          decoded.startsWith('//') ||
          /[\\\s]/.test(path) ||
          [...decoded].some(
            (char) =>
              char === '\\' ||
              char.charCodeAt(0) < 32 ||
              char.charCodeAt(0) === 127,
          )
        )
          throw new Error('context');
      }
      dto.context = { currentPath: path };
    }
    return dto;
  } catch (error) {
    if (
      error instanceof BadRequestException &&
      typeof error.getResponse() === 'object' &&
      'errorCode' in (error.getResponse() as object)
    )
      throw error;
    throw new BadRequestException({
      errorCode: 'AI_MESSAGE_INVALID',
      message:
        'Vui lòng gửi sessionId UUID và tin nhắn tối đa 1000 ký tự (có thể rỗng khi gửi ảnh).',
    });
  }
}
