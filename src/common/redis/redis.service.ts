import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * RedisService — single ioredis connection used by:
 *   - Cache layer (locations, rolling stats)
 *   - Rate-limit counters
 *   - Socket.io adapter pub/sub (separate clients in QueuesGateway)
 *
 * Non-fatal: if Redis is unavailable the app stays up but cache ops
 * silently fail. This lets Railway healthchecks pass while Redis
 * provisions or reconnects.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public client!: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.getOrThrow<string>('REDIS_URL');
    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      enableOfflineQueue: false,
      retryStrategy(times) {
        // Exponential backoff capped at 10 seconds
        return Math.min(times * 500, 10_000);
      },
    });

    this.client.on('ready', () => this.logger.log('Redis connected'));
    this.client.on('error', (e) => this.logger.warn(`Redis error: ${e.message}`));
    this.client.on('close', () => this.logger.warn('Redis connection closed'));
  }

  async onModuleDestroy() {
    await this.client?.quit().catch(() => {});
  }

  // Convenience helpers — all silently fail when Redis is down
  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      const payload = JSON.stringify(value);
      if (ttlSeconds) await this.client.set(key, payload, 'EX', ttlSeconds);
      else await this.client.set(key, payload);
    } catch {
      // Redis unavailable — skip cache write
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    try {
      const n = await this.client.incr(key);
      if (n === 1) await this.client.expire(key, ttlSeconds);
      return n;
    } catch {
      return 0;
    }
  }
}
