import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'node:events';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MAX_IMAGE_BYTES } from '../dtos/ai-chat.dto.js';

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));
import { AiImageService } from './ai-image.service.js';

const url =
  'https://project.supabase.co/storage/v1/object/public/media/ai/a.png';
const config = new ConfigService({
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_STORAGE_BUCKET: 'media',
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
});
afterEach(() => vi.useRealTimers());

function response(
  statusCode: number,
  chunks: Buffer[],
  headers: Record<string, string> = { 'content-type': 'image/png' },
) {
  const incoming = Object.assign(new EventEmitter(), {
    statusCode,
    headers,
    destroy: vi.fn(),
  });
  mocks.request.mockImplementation((_url, _options, callback) => {
    const req = Object.assign(new EventEmitter(), {
      end: () => {
        callback(incoming);
        if (!incoming.destroy.mock.calls.length) {
          for (const chunk of chunks) incoming.emit('data', chunk);
          incoming.emit('end');
        }
      },
    });
    return req;
  });
  return incoming;
}

it('downloads approved storage bytes with pinned public DNS and preserves MIME', async () => {
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  response(200, [png]);
  expect(
    await new AiImageService(config).prepare({
      sessionId: '4f9b8c5a-1122-482a-9e58-69ebf4249a11',
      message: '',
      image: { url, key: 'ai/a.png' },
    }),
  ).toEqual({
    mimeType: 'image/png',
    data: png.toString('base64'),
  });
  const callback = vi.fn();
  mocks.request.mock.calls[0][1].lookup('project.supabase.co', {}, callback);
  expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
  expect(mocks.lookup).toHaveBeenCalledTimes(1);
});

it.each([undefined, '', '   '])(
  'defaults to nexus-media bucket when SUPABASE_STORAGE_BUCKET is %j',
  async (bucket) => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    response(200, [png]);
    const fallbackConfig = new ConfigService({
      SUPABASE_URL: 'https://project.supabase.co',
      ...(bucket === undefined ? {} : { SUPABASE_STORAGE_BUCKET: bucket }),
    });
    expect(
      await new AiImageService(fallbackConfig).prepare({
        sessionId: '4f9b8c5a-1122-482a-9e58-69ebf4249a11',
        message: '',
        image: {
          url: 'https://project.supabase.co/storage/v1/object/public/nexus-media/ai/a.png',
          key: 'ai/a.png',
        },
      }),
    ).toEqual({
      mimeType: 'image/png',
      data: png.toString('base64'),
    });
  },
);

it('rejects mixed DNS answers before opening a socket', async () => {
  mocks.lookup.mockResolvedValue([
    { address: '8.8.8.8', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ]);
  await expect(
    new AiImageService(config).prepare({
      sessionId: '4f9b8c5a-1122-482a-9e58-69ebf4249a11',
      message: '',
      image: { url, key: 'ai/a.png' },
    }),
  ).rejects.toThrow();
  expect(mocks.request).not.toHaveBeenCalled();
});

it.each([301, 302, 307, 308])('never follows redirect %s', async (status) => {
  const stream = response(status, [], {
    'content-type': 'image/png',
    location: 'http://127.0.0.1/secret',
  });
  await expect(
    new AiImageService(config).prepare({
      sessionId: '4f9b8c5a-1122-482a-9e58-69ebf4249a11',
      message: '',
      image: { url, key: 'ai/a.png' },
    }),
  ).rejects.toThrow();
  expect(stream.destroy).toHaveBeenCalled();
  expect(mocks.request).toHaveBeenCalledTimes(1);
});

it('enforces the streamed byte cap even without content-length', async () => {
  const stream = response(200, [
    Buffer.alloc(MAX_IMAGE_BYTES),
    Buffer.alloc(1),
  ]);
  await expect(
    new AiImageService(config).prepare({
      sessionId: '4f9b8c5a-1122-482a-9e58-69ebf4249a11',
      message: '',
      image: { url, key: 'ai/a.png' },
    }),
  ).rejects.toThrow();
  expect(stream.destroy).toHaveBeenCalled();
});

it('rejects a declared oversized or unsupported response before buffering', async () => {
  const stream = response(200, [], {
    'content-type': 'image/png',
    'content-length': String(MAX_IMAGE_BYTES + 1),
  });
  await expect(
    new AiImageService(config).prepare({
      sessionId: '4f9b8c5a-1122-482a-9e58-69ebf4249a11',
      message: '',
      image: { url, key: 'ai/a.png' },
    }),
  ).rejects.toThrow();
  expect(stream.destroy).toHaveBeenCalled();
});

it('bounds stalled DNS to five seconds', async () => {
  vi.useFakeTimers();
  mocks.lookup.mockImplementation(() => new Promise(() => {}));
  const pending = new AiImageService(config).prepare({
    sessionId: '4f9b8c5a-1122-482a-9e58-69ebf4249a11',
    message: '',
    image: { url, key: 'ai/a.png' },
  });
  const assertion = expect(pending).rejects.toThrow('Invalid image');
  await vi.advanceTimersByTimeAsync(5000);
  await assertion;
  expect(mocks.request).not.toHaveBeenCalled();
});

it('rejects corrupt bytes, false MIME and truncated actual images', async () => {
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  for (const [bytes, mime] of [
    [Buffer.from('junk'), 'image/png'],
    [png, 'image/jpeg'],
    [png.subarray(0, 30), 'image/png'],
  ] as const) {
    response(200, [bytes], { 'content-type': mime });
    await expect(
      new AiImageService(config).prepare({
        sessionId: '4f9b8c5a-1122-482a-9e58-69ebf4249a11',
        message: '',
        image: { url, key: 'ai/a.png' },
      }),
    ).rejects.toThrow();
  }
});
