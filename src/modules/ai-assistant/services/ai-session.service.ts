import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { readRedisBaseOptions } from '../../../config/redis.config.js';
import type { AiConversationTurn } from '../contracts/ai-assistant.types.js';

// Lưu trữ tối đa 10 lượt hội thoại gần nhất (TTL 30 phút) và lấy 6 lượt gần nhất cho mỗi prompt
const SESSION_KEY_PREFIX = 'ai:session:v1:';
const SESSION_TTL_SECONDS = 30 * 60;
const MAX_STORED_TURNS = 10;
const DEFAULT_CONTEXT_TURNS = 6;
const MAX_MEMORY_SESSIONS = 2000;
const MAX_TURN_TEXT_LENGTH = 2000;

interface MemorySessionEntry {
  turns: AiConversationTurn[];
  expiresAt: number;
}

@Injectable()
export class AiSessionService implements OnModuleDestroy {
  private readonly logger = new Logger(AiSessionService.name);
  private readonly redis: Redis;
  private readonly memoryStore = new Map<string, MemorySessionEntry>();

  constructor(config: ConfigService) {
    this.redis = new Redis({
      ...readRedisBaseOptions(config),
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    this.redis.on('error', () => undefined);
  }

  async getHistory(
    sessionId: string,
    limit: number = DEFAULT_CONTEXT_TURNS,
    ownerKey?: string,
  ): Promise<AiConversationTurn[]> {
    const storageId = this.buildStorageId(sessionId, ownerKey);
    if (!storageId || limit <= 0) return [];

    const boundedLimit = Math.min(limit, MAX_STORED_TURNS);
    const redisTurns = await this.readFromRedis(storageId);
    if (redisTurns !== null) {
      return redisTurns.slice(-boundedLimit);
    }

    return this.readFromMemory(storageId).slice(-boundedLimit);
  }

  async appendTurns(
    sessionId: string,
    newTurns: AiConversationTurn[],
    ownerKey?: string,
  ): Promise<void> {
    const storageId = this.buildStorageId(sessionId, ownerKey);
    if (!storageId || newTurns.length === 0) return;

    const sanitizedTurns = newTurns
      .map((turn) => this.sanitizeTurn(turn))
      .filter((turn): turn is AiConversationTurn => turn !== null);
    if (sanitizedTurns.length === 0) return;

    const existing = await this.getFullHistory(storageId);
    const merged = [...existing, ...sanitizedTurns].slice(-MAX_STORED_TURNS);

    const wroteToRedis = await this.writeToRedis(storageId, merged);
    if (!wroteToRedis) {
      this.writeToMemory(storageId, merged);
    }
  }

  async clearSession(sessionId: string, ownerKey?: string): Promise<void> {
    const storageId = this.buildStorageId(sessionId, ownerKey);
    if (!storageId) return;

    this.memoryStore.delete(storageId);
    try {
      await this.ensureConnected();
      await this.redis.del(this.sessionKey(storageId));
    } catch (error) {
      this.debugRedisFallback('delete', error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.memoryStore.clear();
    if (this.redis.status === 'ready') {
      await this.redis.quit();
    } else {
      this.redis.disconnect();
    }
  }

  private async getFullHistory(
    storageId: string,
  ): Promise<AiConversationTurn[]> {
    const redisTurns = await this.readFromRedis(storageId);
    if (redisTurns !== null) return redisTurns;
    return this.readFromMemory(storageId);
  }

  private async readFromRedis(
    storageId: string,
  ): Promise<AiConversationTurn[] | null> {
    try {
      await this.ensureConnected();
      const raw = await this.redis.get(this.sessionKey(storageId));
      if (raw === null) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is AiConversationTurn =>
            this.isValidTurn(item),
          )
        : [];
    } catch (error) {
      this.debugRedisFallback('read', error);
      return null;
    }
  }

  private async writeToRedis(
    storageId: string,
    turns: AiConversationTurn[],
  ): Promise<boolean> {
    try {
      await this.ensureConnected();
      await this.redis.set(
        this.sessionKey(storageId),
        JSON.stringify(turns),
        'EX',
        SESSION_TTL_SECONDS,
      );
      return true;
    } catch (error) {
      this.debugRedisFallback('write', error);
      return false;
    }
  }

  private readFromMemory(storageId: string): AiConversationTurn[] {
    const entry = this.memoryStore.get(storageId);
    if (!entry) return [];
    if (entry.expiresAt <= Date.now()) {
      this.memoryStore.delete(storageId);
      return [];
    }
    return [...entry.turns];
  }

  private writeToMemory(storageId: string, turns: AiConversationTurn[]): void {
    this.evictExpiredMemoryEntries();
    if (
      !this.memoryStore.has(storageId) &&
      this.memoryStore.size >= MAX_MEMORY_SESSIONS
    ) {
      const oldestKey = this.memoryStore.keys().next().value;
      if (oldestKey) this.memoryStore.delete(oldestKey);
    }
    this.memoryStore.set(storageId, {
      turns,
      expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
    });
  }

  private evictExpiredMemoryEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.memoryStore.entries()) {
      if (entry.expiresAt <= now) {
        this.memoryStore.delete(key);
      }
    }
  }

  private sanitizeTurn(turn: AiConversationTurn): AiConversationTurn | null {
    const text = typeof turn.text === 'string' ? turn.text.trim() : '';
    if (!text && !turn.imageUrl) return null;
    return {
      role: turn.role === 'model' ? 'model' : 'user',
      text: text.slice(0, MAX_TURN_TEXT_LENGTH),
      ...(turn.imageUrl ? { imageUrl: turn.imageUrl } : {}),
      timestamp:
        typeof turn.timestamp === 'number' ? turn.timestamp : Date.now(),
    };
  }

  private isValidTurn(value: unknown): value is AiConversationTurn {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return (
      (candidate.role === 'user' || candidate.role === 'model') &&
      typeof candidate.text === 'string' &&
      typeof candidate.timestamp === 'number'
    );
  }

  private sessionKey(storageId: string): string {
    return `${SESSION_KEY_PREFIX}${storageId}`;
  }

  private buildStorageId(sessionId: string, ownerKey?: string): string {
    const normalizedSession =
      typeof sessionId === 'string' ? sessionId.trim().slice(0, 128) : '';
    if (!normalizedSession) return '';

    if (typeof ownerKey !== 'string') return normalizedSession;
    const normalizedOwner = ownerKey
      .trim()
      .replace(/[^a-zA-Z0-9_.:-]/g, '_')
      .slice(0, 128);
    return normalizedOwner
      ? `${normalizedOwner}:${normalizedSession}`
      : normalizedSession;
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
    if (this.redis.status !== 'ready') throw new Error('Redis is unavailable');
  }

  private debugRedisFallback(operation: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.debug(
      `AI session Redis ${operation} skipped (using memory fallback): ${message}`,
    );
  }
}
