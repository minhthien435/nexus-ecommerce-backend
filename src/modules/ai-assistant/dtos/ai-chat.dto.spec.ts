import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { parseAiChat } from './ai-chat.dto.js';

const sessionId = '4f9b8c5a-1122-482a-9e58-69ebf4249a11';

describe('parseAiChat', () => {
  it('accepts context with currentPath and optional language (vi | en)', () => {
    expect(
      parseAiChat({
        sessionId,
        message: 'What Flash Deals are live?',
        context: { currentPath: '/flash-deals', language: 'en' },
      }),
    ).toMatchObject({
      sessionId,
      message: 'What Flash Deals are live?',
      context: { currentPath: '/flash-deals', language: 'en' },
    });

    expect(
      parseAiChat({
        sessionId,
        message: 'Hôm nay có Flash Sale gì?',
        context: { language: 'vi' },
      }),
    ).toMatchObject({
      context: { language: 'vi' },
    });

    expect(
      parseAiChat({
        sessionId,
        message: 'Tìm áo',
        context: { currentPath: '/products/ao-polo' },
      }),
    ).toMatchObject({
      context: { currentPath: '/products/ao-polo' },
    });
  });

  it.each([
    { currentPath: '/', language: 'fr' },
    { currentPath: '/', language: '' },
    { currentPath: '/', language: 123 },
    { currentPath: '/', extra: 'not-allowed' },
  ])('rejects invalid context payloads with 400: %j', (context) => {
    expect(() => parseAiChat({ sessionId, message: 'Hello', context })).toThrow(
      BadRequestException,
    );
  });
});
