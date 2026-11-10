import { BadRequestException } from '@nestjs/common';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMime = (typeof IMAGE_MIMES)[number];

/** Parsed explicitly at the boundary, including when called outside HTTP. */
export class AiChatDto {
  sessionId?: string;
  message?: string;
  imageUrl?: string;
  imageBase64?: string;
  imageMimeType?: ImageMime;
  context?: { currentUrl?: string; currentProductSlug?: string };
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
  const input = strictObject(value, [
    'sessionId',
    'message',
    'imageUrl',
    'imageBase64',
    'imageMimeType',
    'context',
  ]);
  const dto = new AiChatDto();
  dto.sessionId = optionalText(input.sessionId, 128);
  if (dto.sessionId && !/^[a-zA-Z0-9_-]+$/.test(dto.sessionId))
    throw new BadRequestException('Invalid sessionId');
  dto.message = optionalText(input.message, 4000);
  dto.imageUrl = optionalText(input.imageUrl, 2048);
  dto.imageBase64 = optionalText(
    input.imageBase64,
    4 * Math.ceil(MAX_IMAGE_BYTES / 3),
  );
  if (dto.imageUrl && dto.imageBase64)
    throw new BadRequestException('Provide only one image source');
  if (input.imageMimeType !== undefined) {
    if (!IMAGE_MIMES.includes(input.imageMimeType as ImageMime))
      throw new BadRequestException('Unsupported image MIME');
    dto.imageMimeType = input.imageMimeType as ImageMime;
  }
  if (Boolean(dto.imageBase64) !== Boolean(dto.imageMimeType))
    throw new BadRequestException(
      'Base64 images require imageMimeType; URL images use response MIME',
    );
  if (!dto.message && !dto.imageUrl && !dto.imageBase64)
    throw new BadRequestException('Provide a message or image');
  if (input.context !== undefined) {
    const context = strictObject(input.context, [
      'currentUrl',
      'currentProductSlug',
    ]);
    const currentUrl = optionalText(context.currentUrl, 2048);
    if (currentUrl) {
      try {
        if (
          [...currentUrl].some(
            (character) => character.charCodeAt(0) <= 32 || character === '\\',
          ) ||
          currentUrl.startsWith('//')
        )
          throw new Error();
        const url = currentUrl.startsWith('/')
          ? new URL(currentUrl, 'https://context.invalid')
          : new URL(currentUrl);
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw new Error();
      } catch {
        throw new BadRequestException('Invalid context URL');
      }
    }
    const currentProductSlug = optionalText(context.currentProductSlug, 200);
    if (
      currentProductSlug &&
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(currentProductSlug)
    )
      throw new BadRequestException('Invalid context product slug');
    dto.context = { currentUrl, currentProductSlug };
  }
  return dto;
}
