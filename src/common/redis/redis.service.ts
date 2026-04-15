import { Injectable, OnModuleDestroy, OnModuleInit, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * RedisService — single ioredis connection used by:
 *   - Cache layer (locations, rolling stats)
 *   - Rate-limit counters (some routes use Redis-backed throttler)
 *   - Socket.io adapter pub/sub (separate clients created in QueuesGateway)
 *   - BullMQ job queues (separate connection created in BullMQ config)
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
      reconnectOnError: (err) => {
        this.logger.warn(`Redis reconnect on: ${err.message}`);
        return true;
      },
    });

    this.client.on('ready', () => this.logger.log('Redis connected'));
    this.client.on('error', (e) => this.logger.error(`Redis error: ${e.message}`));
  }

  async onModuleDestroy() {
    await this.client?.quit();
  }

  // Convenience helpers
  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const payload = JSON.stringify(value);
    if (ttlSeconds) await this.client.set(key, payload, 'EX', ttlSeconds);
    else await this.client.set(key, payload);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /** Atomic counter for things like OTP attempts, throttle counters. */
  async increment(key: string, ttlSeconds: number): Promise<number> {
    const n = await this.client.incr(key);
    if (n === 1) await this.client.expire(key, ttlSeconds);
    return n;
  }
}
