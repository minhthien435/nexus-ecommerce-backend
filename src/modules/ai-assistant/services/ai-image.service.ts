import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import sharp from 'sharp';
import {
  IMAGE_MIMES,
  MAX_IMAGE_BYTES,
  parseAiChat,
  type AiChatDto,
  type ImageMime,
} from '../dtos/ai-chat.dto.js';

export type ValidatedImage = { mimeType: ImageMime; data: string };
const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');

export function isPublicV4(address: string): boolean {
  return isIP(address) === 4 && !blocked.check(address, 'ipv4');
}

@Injectable()
export class AiImageService {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async prepare(value: AiChatDto): Promise<ValidatedImage | undefined> {
    const dto = parseAiChat(value);
    if (!dto.imageUrl && !dto.imageBase64) return undefined;
    try {
      let bytes: Buffer;
      let mime: string;
      if (dto.imageBase64) {
        const encoded = dto.imageBase64;
        if (encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(encoded))
          throw new Error();
        bytes = Buffer.from(encoded, 'base64');
        // Round-trip enforces canonical padding without recursive regex groups
        // that can exhaust the regex engine stack on valid multi-megabyte input.
        if (bytes.toString('base64') !== encoded) throw new Error();
        mime = dto.imageMimeType!;
      } else {
        ({ bytes, mime } = await this.download(this.storageUrl(dto.imageUrl!)));
      }
      if (
        !bytes.length ||
        bytes.length > MAX_IMAGE_BYTES ||
        !IMAGE_MIMES.includes(mime as ImageMime)
      )
        throw new Error();
      // Full decoding rejects truncated files; pixel/frame limits contain decompression bombs.
      const decoder = sharp(bytes, {
        failOn: 'warning',
        limitInputPixels: 16_000_000,
        animated: true,
      });
      const metadata = await decoder.metadata();
      if ((metadata.pages ?? 1) !== 1 || `image/${metadata.format}` !== mime)
        throw new Error();
      await decoder.raw().toBuffer();
      return { mimeType: mime as ImageMime, data: bytes.toString('base64') };
    } catch {
      throw new BadRequestException(
        'Invalid image or unavailable approved storage image',
      );
    }
  }

  private storageUrl(input: string): URL {
    const url = new URL(input);
    const origin = new URL(this.config.get<string>('SUPABASE_URL') ?? '');
    const bucket = this.config.get<string>('SUPABASE_STORAGE_BUCKET') ?? '';
    if (
      !/^[a-zA-Z0-9_-]+$/.test(bucket) ||
      origin.protocol !== 'https:' ||
      !/^[a-z0-9-]+\.supabase\.co$/.test(origin.hostname) ||
      url.origin !== origin.origin ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith(`/storage/v1/object/public/${bucket}/`) ||
      /%|\\/.test(url.pathname)
    )
      throw new Error();
    return url;
  }

  private async download(url: URL): Promise<{ bytes: Buffer; mime: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      return await new Promise((resolve, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(new Error('Image timeout')),
          { once: true },
        );
        // Resolve once, reject private addresses, and pin the selected public address to the TLS socket.
        void lookup(url.hostname, { family: 4, all: true })
          .then((addresses) => {
            if (
              controller.signal.aborted ||
              !addresses.length ||
              addresses.some(({ address }) => !isPublicV4(address))
            )
              throw new Error();
            const req = request(
              url,
              {
                signal: controller.signal,
                family: 4,
                lookup: (_host, _options, callback) =>
                  callback(null, addresses[0].address, 4),
                headers: { Accept: IMAGE_MIMES.join(', ') },
              },
              (res) => {
                const mime = (res.headers['content-type'] ?? '')
                  .split(';')[0]
                  .trim()
                  .toLowerCase();
                if (
                  res.statusCode !== 200 ||
                  !IMAGE_MIMES.includes(mime as ImageMime) ||
                  Number(res.headers['content-length'] ?? 0) >
                    MAX_IMAGE_BYTES ||
                  res.headers['content-encoding']
                ) {
                  res.destroy();
                  reject(new Error());
                  return;
                }
                const chunks: Buffer[] = [];
                let size = 0;
                res.on('data', (chunk: Buffer) => {
                  size += chunk.length;
                  if (size > MAX_IMAGE_BYTES) {
                    res.destroy();
                    reject(new Error());
                    return;
                  }
                  chunks.push(chunk);
                });
                res.on('error', reject);
                res.on('end', () =>
                  resolve({ bytes: Buffer.concat(chunks), mime }),
                );
              },
            );
            req.on('error', reject);
            req.end();
          })
          .catch(reject);
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
