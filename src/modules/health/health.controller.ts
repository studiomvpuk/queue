import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Lightweight liveness probe — always returns HTTP 200.
   * Railway hits this to decide if the container is alive.
   * Even if DB/Redis are still warming up, we report 200
   * with status: 'degraded' so Railway doesn't kill the pod.
   */
  @Public()
  @Get()
  async check() {
    const started = Date.now();

    // Wrap each dependency check so a crash in either can't 500 the endpoint
    const dbCheck = async () => {
      try { return await this.prisma.$queryRaw`SELECT 1`; } catch { return 'error'; }
    };
    const redisCheck = async () => {
      try { return await this.redis.client.ping(); } catch { return 'error'; }
    };
    const [db, cache] = await Promise.allSettled([dbCheck(), redisCheck()]);

    return {
      status:
        db.status === 'fulfilled' && cache.status === 'fulfilled'
          ? 'ok'
          : 'degraded',
      db: db.status,
      redis: cache.status,
      uptimeSec: Math.round(process.uptime()),
      latencyMs: Date.now() - started,
      version: process.env.npm_package_version ?? '0.0.0',
    };
  }
}
